import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installBundle } from '../harness/install-bundle.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, entries = [
  { path: '.codex/agents/worker.toml', kind: 'role', target: 'codex', roleId: 'worker', body: 'name = "worker"\n' },
  { path: '.agents/skills/testing/SKILL.md', kind: 'skill', skillId: 'testing', body: '# Testing\n' },
]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-install-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true, force: true }); });
  const project = path.join(root, 'consumer'), bundle = path.join(root, 'bundle');
  await mkdir(project); await mkdir(bundle);
  execFileSync('git', ['init', '-q', project]);
  await writeFile(path.join(project, 'README.md'), 'trial fixture\n');
  const manifestEntries = [];
  for (const entry of entries) {
    const { body, ...metadata } = entry;
    const file = path.join(bundle, ...entry.path.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    manifestEntries.push({ ...metadata, sha256: hash(Buffer.from(body)),
      sourcePath: entry.kind === 'role' ? `harness/agents/${entry.roleId}.md` : entry.path,
      sourceSha256: hash(Buffer.from(body)) });
  }
  const manifest = { schemaVersion: 1, generator: 'pure-harness-candidate-export', status: 'unverified', profile: 'core', targets: ['codex'], roleIds: ['worker'], skillIds: ['testing'], limits: {}, entries: manifestEntries };
  await writeFile(path.join(bundle, 'bundle-manifest.json'), JSON.stringify(manifest));
  return { project, bundle, manifest };
}
async function rejectsWithoutWriting(fx, expected, options = {}) {
  await assert.rejects(installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply', trial: true, ...options }), expected);
  assert.deepEqual(await readdir(path.join(fx.project, 'harness-adapter')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
}

test('candidate bundle needs explicit trial and installs only into disposable checkout', async t => {
  const fx = await fixture(t);
  await assert.rejects(installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply' }), /unverified/);
  await assert.rejects(lstat(path.join(fx.project, 'harness-adapter')), /ENOENT/);
  const plan = await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'plan', trial: true });
  assert.equal(plan.actions.length, 2);
  await assert.rejects(readFile(path.join(fx.project, '.codex/agents/worker.toml')), /ENOENT/);
  const applied = await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply', trial: true });
  assert.equal(applied.actions.length, 2);
  assert.equal(await readFile(path.join(fx.project, '.codex/agents/worker.toml'), 'utf8'), 'name = "worker"\n');
  assert.equal((await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'check' })).ok, true);
  assert.equal((await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply', trial: true })).actions.length, 0);
  await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'rollback' });
  await assert.rejects(readFile(path.join(fx.project, '.codex/agents/worker.toml')), /ENOENT/);
  assert.equal(await readFile(path.join(fx.project, 'README.md'), 'utf8'), 'trial fixture\n');
});

test('modified installed bytes block check and rollback without removing unrelated files', async t => {
  const fx = await fixture(t);
  await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply', trial: true });
  await writeFile(path.join(fx.project, '.codex/agents/worker.toml'), 'user edit\n');
  await writeFile(path.join(fx.project, 'probe.txt'), 'other\n');
  await assert.rejects(installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'check' }), /modified|mismatch/);
  await assert.rejects(installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'rollback' }), /modified|mismatch/);
  assert.equal(await readFile(path.join(fx.project, '.agents/skills/testing/SKILL.md'), 'utf8'), '# Testing\n');
  assert.equal(await readFile(path.join(fx.project, 'probe.txt'), 'utf8'), 'other\n');
});

test('existing user file and non-disposable checkout reject candidate with no writes', async t => {
  const fx = await fixture(t);
  await mkdir(path.join(fx.project, '.codex/agents'), { recursive: true });
  await writeFile(path.join(fx.project, '.codex/agents/worker.toml'), 'user-owned\n');
  await assert.rejects(installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply', trial: true }), /existing|disposable/);
  assert.equal(await readFile(path.join(fx.project, '.codex/agents/worker.toml'), 'utf8'), 'user-owned\n');
  await assert.rejects(lstat(path.join(fx.project, 'harness-adapter')), /ENOENT/);
  const fy = await fixture(t);
  await writeFile(path.join(fy.project, 'app.js'), 'app\n');
  await rejectsWithoutWriting(fy, /disposable/);
});

test('invalid or tampered manifest and path never write', async t => {
  for (const mutate of [
    m => { m.entries[0].sha256 = '0'.repeat(64); },
    m => { m.entries[0].path = '../escape'; },
    m => { m.entries.push({ ...m.entries[0], path: '.CODEX/agents/WORKER.toml' }); },
    m => { m.entries.push({ ...m.entries[0], path: 'AGENTS.md' }); },
  ]) {
    const fx = await fixture(t);
    mutate(fx.manifest);
    await writeFile(path.join(fx.bundle, 'bundle-manifest.json'), JSON.stringify(fx.manifest));
    await rejectsWithoutWriting(fx, /hash|path|collision|allow|invalid|missing/);
  }
});

test('symlinked bundle or consumer ancestor and wrong Git root fail closed', async t => {
  const fx = await fixture(t);
  const real = path.join(fx.bundle, '.codex/agents/worker.toml');
  const { unlink } = await import('node:fs/promises');
  await unlink(real);
  try {
    await symlink(path.join(fx.bundle, '.agents/skills/testing/SKILL.md'), real);
    await rejectsWithoutWriting(fx, /symlink/);
  } catch (error) { if (error.code !== 'EPERM') throw error; }
  const fy = await fixture(t);
  await mkdir(path.join(fy.project, 'nested'));
  await assert.rejects(installBundle({ bundleRoot: fy.bundle, projectRoot: path.join(fy.project, 'nested'), mode: 'plan', trial: true }), /Git root/);
  const fz = await fixture(t);
  try {
    await symlink(path.join(fz.bundle, '.agents'), path.join(fz.project, '.agents'), 'junction');
    await assert.rejects(installBundle({ bundleRoot: fz.bundle, projectRoot: fz.project, mode: 'apply', trial: true }), /symlink|disposable/);
    assert.ok((await lstat(path.join(fz.project, '.agents'))).isSymbolicLink());
  } catch (error) { if (error.code !== 'EPERM') throw error; }
});

test('all four role layouts plus native Claude skill copy can be trial-installed', async t => {
  const entries = [
    { path: '.codex/agents/worker.toml', kind: 'role', target: 'codex', roleId: 'worker', body: 'codex' },
    { path: '.claude/agents/worker.md', kind: 'role', target: 'claude', roleId: 'worker', body: 'claude' },
    { path: '.opencode/agents/worker.md', kind: 'role', target: 'opencode', roleId: 'worker', body: 'opencode' },
    { path: '.agents/agents/worker/agent.md', kind: 'role', target: 'antigravity', roleId: 'worker', body: 'antigravity' },
    { path: '.agents/skills/testing/SKILL.md', kind: 'skill', skillId: 'testing', body: 'skill' },
    { path: '.claude/skills/testing/SKILL.md', kind: 'skill', target: 'claude', skillId: 'testing', body: 'skill' },
    { path: '.codex/config.toml', kind: 'registry', target: 'codex', body: '[agents.worker]\n' },
  ];
  const fx = await fixture(t, entries);
  fx.manifest.targets = ['codex', 'claude', 'opencode', 'antigravity'];
  fx.manifest.entries[5].sourcePath = '.agents/skills/testing/SKILL.md';
  delete fx.manifest.entries[6].sourcePath;
  delete fx.manifest.entries[6].sourceSha256;
  await writeFile(path.join(fx.bundle, 'bundle-manifest.json'), JSON.stringify(fx.manifest));
  const result = await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply', trial: true });
  assert.equal(result.actions.length, 7);
  assert.equal(await readFile(path.join(fx.project, '.claude/skills/testing/SKILL.md'), 'utf8'), 'skill');
  assert.equal((await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'check' })).ok, true);
});

test('CLI defaults to read-only plan and rejects missing required args', async t => {
  const fx = await fixture(t);
  const script = fileURLToPath(new URL('../scripts/install-target.mjs', import.meta.url));
  const plan = execFileSync(process.execPath, [script, '--bundle', fx.bundle, '--project', fx.project], { encoding: 'utf8' });
  assert.match(plan, /"status": "unverified"/);
  await assert.rejects(readFile(path.join(fx.project, '.codex/agents/worker.toml')), /ENOENT/);
  assert.throws(() => execFileSync(process.execPath, [script, '--bundle', fx.bundle], { encoding: 'utf8', stdio: 'pipe' }), /project/);
});

test('forged installer state cannot claim unrelated user files', async t => {
  const fx = await fixture(t);
  await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply', trial: true });
  const stateFile = path.join(fx.project, 'harness-adapter/install-state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.entries.push({ path: 'README.md', sha256: hash(Buffer.from('trial fixture\n')) });
  await writeFile(stateFile, JSON.stringify(state));
  await assert.rejects(installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'rollback' }), /state.*bundle|mismatch/);
  assert.equal(await readFile(path.join(fx.project, 'README.md'), 'utf8'), 'trial fixture\n');
});

test('partial interrupted state can be rolled back without touching unrelated files', async t => {
  const fx = await fixture(t);
  await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply', trial: true });
  const stateFile = path.join(fx.project, 'harness-adapter/install-state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.phase = 'applying';
  await writeFile(stateFile, JSON.stringify(state));
  const { unlink } = await import('node:fs/promises');
  await unlink(path.join(fx.project, '.agents/skills/testing/SKILL.md'));
  await writeFile(path.join(fx.project, 'probe.txt'), 'unrelated\n');
  await assert.rejects(installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'apply', trial: true }), /partial/);
  await installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'rollback' });
  await assert.rejects(readFile(path.join(fx.project, '.codex/agents/worker.toml')), /ENOENT/);
  assert.equal(await readFile(path.join(fx.project, 'probe.txt'), 'utf8'), 'unrelated\n');
});

test('rollback without installer ownership leaves checkout untouched', async t => {
  const fx = await fixture(t);
  await assert.rejects(installBundle({ bundleRoot: fx.bundle, projectRoot: fx.project, mode: 'rollback' }), /no installer-owned state/);
  await assert.rejects(lstat(path.join(fx.project, 'harness-adapter')), /ENOENT/);
});
