import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planSync, applyPlan, makeGeneratedFile, recoverPartial } from '../harness/ownership.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-own-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'harness'));
  return root;
}
async function snapshotTree(root) {
  const rows = [];
  async function visit(dir, prefix = '') {
    for (const name of (await readdir(dir)).sort()) {
      const relative = path.posix.join(prefix, name);
      const absolute = path.join(dir, name);
      const meta = await stat(absolute);
      if (meta.isDirectory()) await visit(absolute, relative);
      else rows.push({ path: relative, sha256: sha(await readFile(absolute)), mtimeMs: meta.mtimeMs });
    }
  }
  await visit(root);
  return rows;
}
const render = (id = 'planner', target = 'claude', body = `---\nname: ${id}\n---\nbody\n`) => ({
  path: target === 'codex' ? `.codex/agents/${id}.toml` : `.claude/agents/${id}.md`,
  target, roleId: id, sourcePath: `harness/agents/${id}.md`, sourceSha256: sha(id), body,
});
const args = (root, rendered, manifest = { entries: [] }) => ({ root, targets: ['claude'], profile: 'core', rendered, manifest });
async function install(root, item) {
  const { file, entry } = makeGeneratedFile(item);
  await mkdir(path.dirname(path.join(root, entry.path)), { recursive: true });
  await writeFile(path.join(root, entry.path), file);
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [entry] }));
  return entry;
}

test('creates only declared output, then no-op preserves bytes and mtimes', async t => {
  const root = await fixture(t), item = render();
  const planned = await planSync(args(root, [item]));
  assert.deepEqual(planned.actions.map(a => a.kind), ['create']);
  assert.deepEqual((await applyPlan(planned)).changedPaths, [item.path, 'harness/generated-manifest.json']);
  const before = await snapshotTree(root);
  const manifest = JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json')));
  const second = await planSync(args(root, [item], manifest));
  assert.deepEqual(second.actions.map(a => a.kind), ['unchanged']);
  assert.deepEqual((await applyPlan(second)).changedPaths, []);
  assert.deepEqual(await snapshotTree(root), before);
});

test('owned update and stale prune require exact prior bytes and header', async t => {
  const root = await fixture(t), old = render(), entry = await install(root, old);
  const updated = render('planner', 'claude', 'new body\n');
  const plan = await planSync(args(root, [updated], { entries: [entry] }));
  assert.deepEqual(plan.actions.map(a => a.kind), ['update']);
  await applyPlan(plan);
  const next = JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json')));
  const prune = await planSync(args(root, [], next));
  assert.deepEqual(prune.actions.map(a => a.kind), ['prune']);
  await applyPlan(prune);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json'))).entries, []);
});

test('unowned collision blocks an entire target before writes', async t => {
  const root = await fixture(t), item = render();
  await mkdir(path.dirname(path.join(root, item.path)), { recursive: true });
  await writeFile(path.join(root, item.path), 'human');
  const before = await snapshotTree(root);
  const plan = await planSync(args(root, [item, render('worker')]));
  assert.equal(plan.writable, false);
  assert.ok(plan.actions.some(a => a.kind === 'conflict'));
  await assert.rejects(applyPlan(plan), /conflict/);
  assert.deepEqual(await snapshotTree(root), before);
});

test('hash-matched headerless, forged, or field-mismatched files are not owned', async t => {
  for (const mutate of [
    file => file.replace(/^<!--.*?-->\n/, ''),
    file => file.replace('"generator":"pure-harness"', '"generator":"forged"'),
    file => file.replace('"sourcePath":"harness/agents/planner.md"', '"sourcePath":"harness/agents/worker.md"'),
  ]) {
    const root = await fixture(t), item = render(), entry = await install(root, item);
    const file = mutate(await readFile(path.join(root, item.path), 'utf8'));
    await writeFile(path.join(root, item.path), file);
    entry.fileSha256 = sha(file);
    await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [entry] }));
    const plan = await planSync(args(root, [item], { entries: [entry] }));
    assert.deepEqual(plan.actions.map(a => a.kind), ['conflict']);
  }
});

test('invalid manifest, traversal, case collision, and symlink ancestors are rejected', async t => {
  const root = await fixture(t);
  await assert.rejects(planSync(args(root, [render()], { entries: [{ path: '.claude/agents/planner.md' }] })), /manifest/i);
  await assert.rejects(planSync(args(root, [{ ...render(), path: '.claude/agents/../evil.md' }])), /path|traversal/i);
  await assert.rejects(planSync(args(root, [{ ...render(), path: '.claude/agents/other.md' }])), /declared output path/i);
  await assert.rejects(planSync(args(root, [render(), render()])), /case collision/i);
  const outside = await fixture(t);
  await mkdir(path.join(root, '.claude'));
  try { await symlink(outside, path.join(root, '.claude/agents'), 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return; throw error; }
  await assert.rejects(planSync(args(root, [render()])), /symlink/i);
});

test('dirty owned bytes and malformed ownership header block stale pruning', async t => {
  const root = await fixture(t), item = render(), entry = await install(root, item);
  await writeFile(path.join(root, item.path), 'local edit');
  const dirty = await planSync(args(root, [], { entries: [entry] }));
  assert.deepEqual(dirty.actions.map(action => action.kind), ['conflict']);
  const file = (await readFile(path.join(root, item.path), 'utf8')).replace('"generator":"pure-harness"', '"generator":"forged"');
  await writeFile(path.join(root, item.path), file);
  entry.fileSha256 = sha(file);
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [entry] }));
  const forged = await planSync(args(root, [], { entries: [entry] }));
  assert.deepEqual(forged.actions.map(action => action.kind), ['conflict']);
});

test('injected later write failure returns exact changed paths', async t => {
  const root = await fixture(t), planned = await planSync(args(root, [render(), render('worker')]));
  const result = await applyPlan(planned, { beforeWrite: relative => { if (relative.endsWith('worker.md')) throw new Error('injected'); } });
  assert.equal(result.partialFailure, true);
  assert.deepEqual(result.changedPaths, ['harness/.sync-journal.json', '.claude/agents/planner.md']);
  assert.match(result.error, /injected/);
  await assert.rejects(planSync(args(root, [render(), render('worker')])), /recovery journal/i);
  const recovered = await recoverPartial({ root, targets: ['claude'] });
  assert.equal(recovered.partialFailure, false);
  assert.deepEqual(recovered.changedPaths, ['.claude/agents/worker.md', 'harness/generated-manifest.json']);
  const manifest = JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json')));
  assert.deepEqual((await planSync(args(root, [render(), render('worker')], manifest))).actions.map(action => action.kind), ['unchanged', 'unchanged']);
});

test('manifest-write failure leaves a recoverable, hash-checked journal', async t => {
  const root = await fixture(t), planned = await planSync(args(root, [render()]));
  const result = await applyPlan(planned, { beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('manifest injection'); } });
  assert.equal(result.partialFailure, true);
  assert.deepEqual(result.changedPaths, ['harness/.sync-journal.json', '.claude/agents/planner.md']);
  assert.match(result.error, /manifest injection/);
  const recovered = await recoverPartial({ root, targets: ['claude'] });
  assert.equal(recovered.partialFailure, false);
  assert.deepEqual(recovered.changedPaths, ['harness/generated-manifest.json']);
  const manifest = JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json')));
  const second = await planSync(args(root, [render()], manifest));
  assert.equal(second.actions[0].kind, 'unchanged');
});

test('recovery refuses a locally edited partial output without overwriting it', async t => {
  const root = await fixture(t), planned = await planSync(args(root, [render(), render('worker')]));
  await applyPlan(planned, { beforeWrite: relative => { if (relative.endsWith('worker.md')) throw new Error('injected'); } });
  await writeFile(path.join(root, '.claude/agents/planner.md'), 'local edit');
  const before = await snapshotTree(root);
  const result = await recoverPartial({ root, targets: ['claude'] });
  assert.equal(result.partialFailure, true);
  assert.deepEqual(result.changedPaths, []);
  assert.match(result.error, /drift|tamper|mismatch/i);
  assert.deepEqual(await snapshotTree(root), before);
});

test('recovery completes a stale prune only when the prior generated file matched', async t => {
  const root = await fixture(t), old = render(), entry = await install(root, old);
  const plan = await planSync(args(root, [render('worker')], { entries: [entry] }));
  const failed = await applyPlan(plan, { beforeWrite: relative => { if (relative.endsWith('worker.md')) throw new Error('injected'); } });
  assert.equal(failed.partialFailure, true);
  assert.deepEqual(failed.changedPaths, ['harness/.sync-journal.json', old.path]);
  const recovered = await recoverPartial({ root, targets: ['claude'] });
  assert.equal(recovered.partialFailure, false);
  assert.deepEqual(recovered.changedPaths, ['.claude/agents/worker.md', 'harness/generated-manifest.json']);
  const finalManifest = JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json')));
  assert.deepEqual(finalManifest.entries.map(value => value.roleId), ['worker']);
});

test('a concurrent manifest edit at the final write is preserved for manual reconciliation', async t => {
  const root = await fixture(t), plan = await planSync(args(root, [render()]));
  const changed = '{"entries":[],"human":"edit"}';
  const result = await applyPlan(plan, { beforeWrite: async relative => {
    if (relative === 'harness/generated-manifest.json') await writeFile(path.join(root, relative), changed);
  } });
  assert.equal(result.partialFailure, true);
  assert.match(result.error, /manifest.*changed|manifest.*drift/i);
  assert.equal(await readFile(path.join(root, 'harness/generated-manifest.json'), 'utf8'), changed);
  const recovery = await recoverPartial({ root, targets: ['claude'] });
  assert.equal(recovery.partialFailure, true);
  assert.match(recovery.error, /manifest.*drift/i);
});

test('competing applies cannot reserve the same root before either journal write', async t => {
  const root = await fixture(t);
  const firstPlan = await planSync(args(root, [render()]));
  const secondPlan = await planSync(args(root, [render('worker')]));
  let competitor;
  const first = await applyPlan(firstPlan, { beforeWrite: async relative => {
    if (relative === 'harness/.sync-journal.json') competitor = await applyPlan(secondPlan);
  } });
  assert.equal(first.partialFailure, false);
  assert.equal(competitor.partialFailure, true);
  assert.match(competitor.error, /sync lock/i);
  const manifest = JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json')));
  assert.deepEqual(manifest.entries.map(entry => entry.roleId), ['planner']);
});

test('recovery rechecks manifest before its final write and preserves a concurrent edit', async t => {
  const root = await fixture(t), plan = await planSync(args(root, [render()]));
  await applyPlan(plan, { beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('injected'); } });
  const edited = '{"entries":[],"human":"edit"}';
  const recovery = await recoverPartial({ root, targets: ['claude'] }, { beforeWrite: async relative => {
    if (relative === 'harness/generated-manifest.json') await writeFile(path.join(root, relative), edited);
  } });
  assert.equal(recovery.partialFailure, true);
  assert.match(recovery.error, /manifest.*drift|manifest.*changed/i);
  assert.equal(await readFile(path.join(root, 'harness/generated-manifest.json'), 'utf8'), edited);
});

test('an existing sync lock fails closed without touching outputs', async t => {
  const root = await fixture(t), plan = await planSync(args(root, [render()]));
  await writeFile(path.join(root, 'harness/.sync.lock'), 'stale or live');
  const before = await snapshotTree(root);
  const result = await applyPlan(plan);
  assert.equal(result.partialFailure, true);
  assert.match(result.error, /sync lock/i);
  assert.deepEqual(await snapshotTree(root), before);
});

test('a manifest changed after planning blocks all output writes', async t => {
  const root = await fixture(t), plan = await planSync(args(root, [render()]));
  await writeFile(path.join(root, 'harness/generated-manifest.json'), '{"entries":[]}');
  const before = await snapshotTree(root);
  const result = await applyPlan(plan);
  assert.equal(result.partialFailure, true);
  assert.deepEqual(result.changedPaths, []);
  assert.match(result.error, /manifest.*changed/i);
  assert.deepEqual(await snapshotTree(root), before);
});

test('sync CLI dry-run/check are read-only and normal sync becomes byte-stable', async t => {
  const root = await fixture(t), repository = path.resolve('.');
  await cp(path.join(repository, 'harness/agents'), path.join(root, 'harness/agents'), { recursive: true });
  const compatibility = JSON.parse(await readFile(path.join(repository, 'harness/compatibility.json'), 'utf8'));
  compatibility.targets.codex.nativeSmoke = 'passed';
  await writeFile(path.join(root, 'harness/compatibility.json'), JSON.stringify(compatibility));
  await cp(path.join(repository, '.agents/skills'), path.join(root, '.agents/skills'), { recursive: true });
  async function run(...flags) {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(repository, 'scripts/sync.mjs'), '--root', root, '--targets', 'codex', '--profile', 'core', ...flags]);
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', code => resolve({ code, stdout, stderr }));
    });
  }
  const initial = await snapshotTree(root);
  assert.equal((await run('--dry-run')).code, 0);
  assert.equal((await run('--check')).code, 1);
  assert.deepEqual(await snapshotTree(root), initial);
  assert.equal((await run()).code, 0);
  const after = await snapshotTree(root);
  assert.equal((await run('--check')).code, 0);
  assert.equal((await run()).code, 0);
  assert.deepEqual(await snapshotTree(root), after);
  assert.equal((await run('--force')).code, 1);
});

test('ordinary sync refuses unverified native smoke without writing a manifest or output', async t => {
  const root = await fixture(t), repository = path.resolve('.');
  await cp(path.join(repository, 'harness/agents'), path.join(root, 'harness/agents'), { recursive: true });
  await cp(path.join(repository, 'harness/compatibility.json'), path.join(root, 'harness/compatibility.json'));
  await cp(path.join(repository, '.agents/skills'), path.join(root, '.agents/skills'), { recursive: true });
  const before = await snapshotTree(root);
  for (const flag of ['--dry-run', '--check']) {
    const readOnly = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(repository, 'scripts/sync.mjs'), '--root', root, '--targets', 'codex', '--profile', 'core', flag]);
      child.once('error', reject);
      child.once('close', code => resolve(code));
    });
    assert.equal(readOnly, flag === '--dry-run' ? 0 : 1);
  }
  assert.deepEqual(await snapshotTree(root), before);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repository, 'scripts/sync.mjs'), '--root', root, '--targets', 'codex', '--profile', 'core']);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /native smoke.*unverified/i);
  assert.deepEqual(await snapshotTree(root), before);
});

test('ordinary sync refuses unverified skill discovery despite passed native smoke', async t => {
  const root = await fixture(t), repository = path.resolve('.');
  await cp(path.join(repository, 'harness/agents'), path.join(root, 'harness/agents'), { recursive: true });
  await cp(path.join(repository, '.agents/skills'), path.join(root, '.agents/skills'), { recursive: true });
  const compatibility = JSON.parse(await readFile(path.join(repository, 'harness/compatibility.json'), 'utf8'));
  compatibility.targets.codex.nativeSmoke = 'passed';
  compatibility.targets.codex.skillDiscoveryEvidence.status = 'unverified';
  await writeFile(path.join(root, 'harness/compatibility.json'), JSON.stringify(compatibility));
  const before = await snapshotTree(root);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repository, 'scripts/sync.mjs'), '--root', root, '--targets', 'codex', '--profile', 'core']);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /skill discovery.*unverified/i);
  assert.deepEqual(await snapshotTree(root), before);
});

test('mixed target sync does not write a verified target when another target is unverified', async t => {
  const root = await fixture(t), repository = path.resolve('.');
  await cp(path.join(repository, 'harness/agents'), path.join(root, 'harness/agents'), { recursive: true });
  await cp(path.join(repository, '.agents/skills'), path.join(root, '.agents/skills'), { recursive: true });
  const compatibility = JSON.parse(await readFile(path.join(repository, 'harness/compatibility.json'), 'utf8'));
  compatibility.targets.codex.nativeSmoke = 'passed';
  await writeFile(path.join(root, 'harness/compatibility.json'), JSON.stringify(compatibility));
  const before = await snapshotTree(root);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repository, 'scripts/sync.mjs'), '--root', root, '--targets', 'codex,claude', '--profile', 'core']);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stderr }));
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /claude: native smoke unverified/i);
  assert.deepEqual(await snapshotTree(root), before);
});

test('sync CLI exposes explicit recovery without requiring a new render or force', async t => {
  const root = await fixture(t), repository = path.resolve('.');
  const compatibility = JSON.parse(await readFile(path.join(repository, 'harness/compatibility.json'), 'utf8'));
  compatibility.targets.codex.nativeSmoke = 'passed';
  await writeFile(path.join(root, 'harness/compatibility.json'), JSON.stringify(compatibility));
  await cp(path.join(repository, '.agents/skills'), path.join(root, '.agents/skills'), { recursive: true });
  const item = render('planner', 'codex', 'name = "planner"\n');
  const plan = await planSync({ ...args(root, [item]), targets: ['codex'] });
  await applyPlan(plan, { beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('injected'); } });
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repository, 'scripts/sync.mjs'), '--root', root, '--targets', 'codex', '--recover']);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).changedPaths, ['harness/generated-manifest.json']);
});

test('sync CLI refuses forward recovery writes without native readiness', async t => {
  const root = await fixture(t), repository = path.resolve('.');
  await cp(path.join(repository, 'harness/compatibility.json'), path.join(root, 'harness/compatibility.json'));
  await cp(path.join(repository, '.agents/skills'), path.join(root, '.agents/skills'), { recursive: true });
  const item = render('planner', 'codex', 'name = "planner"\n');
  const plan = await planSync({ ...args(root, [item]), targets: ['codex'] });
  await applyPlan(plan, { beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('injected'); } });
  const before = await snapshotTree(root);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repository, 'scripts/sync.mjs'), '--root', root, '--targets', 'codex', '--recover']);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stderr }));
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /native smoke.*unverified/i);
  assert.deepEqual(await snapshotTree(root), before);
});
