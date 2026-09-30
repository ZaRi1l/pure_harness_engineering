import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseRole } from '../harness/schema.mjs';
import * as codex from '../harness/targets/codex.mjs';
import * as claude from '../harness/targets/claude.mjs';
import * as opencode from '../harness/targets/opencode.mjs';
import * as antigravity from '../harness/targets/antigravity.mjs';
import { makeGeneratedFile } from '../harness/ownership.mjs';

const repository = path.resolve('.');

function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repository, script), ...args], { cwd: repository });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

async function snapshotTree(root) {
  const rows = [];
  async function visit(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort()) {
      const relative = path.posix.join(prefix, name);
      const absolute = path.join(directory, name);
      const metadata = await stat(absolute);
      if (metadata.isDirectory()) await visit(absolute, relative);
      else rows.push({ path: relative, sha256: createHash('sha256').update(await readFile(absolute)).digest('hex'), mtimeMs: metadata.mtimeMs });
    }
  }
  await visit(root);
  return rows;
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'harness'), { recursive: true });
  await mkdir(path.join(root, '.agents'), { recursive: true });
  await cp(path.join(repository, 'harness/agents'), path.join(root, 'harness/agents'), { recursive: true });
  await cp(path.join(repository, 'harness/compatibility.json'), path.join(root, 'harness/compatibility.json'));
  await cp(path.join(repository, '.agents/skills'), path.join(root, '.agents/skills'), { recursive: true });
  return root;
}

async function changeRole(root, id, change) {
  const file = path.join(root, `harness/agents/${id}.md`);
  await writeFile(file, change(await readFile(file, 'utf8')));
}

async function generatedFixture(root, adapter, roleId, change = body => body) {
  const sourcePath = `harness/agents/${roleId}.md`;
  const role = parseRole(await readFile(path.join(root, sourcePath), 'utf8'), sourcePath);
  const compatibility = JSON.parse(await readFile(path.join(root, 'harness/compatibility.json'), 'utf8'));
  const rendered = adapter.renderRole(role, { compatibility, profile: 'core' });
  const body = change(rendered.body);
  await mkdir(path.dirname(path.join(root, rendered.path)), { recursive: true });
  const generated = makeGeneratedFile({ path: rendered.path, target: adapter.targetId, roleId, sourcePath, sourceSha256: role.sourceSha256, body });
  await writeFile(path.join(root, rendered.path), generated.file);
  const entry = generated.entry;
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [entry] }));
  return { entry, body };
}

async function validationReport(root, target = 'codex') {
  const result = await runNode('scripts/validate.mjs', ['--root', root, '--targets', target, '--profile', 'core', '--json']);
  assert.equal(result.code, 1);
  return JSON.parse(result.stdout);
}

test('validation requires explicit unique known targets and never infers selection', async t => {
  const root = await fixture(t);
  for (const args of [[], ['--targets', 'codex,codex'], ['--targets', 'unknown']]) {
    const result = await runNode('scripts/validate.mjs', ['--root', root, ...args, '--profile', 'core', '--json']);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /targets/i);
  }
});

test('duplicate source ID fails validation without changing files', async t => {
  const root = await fixture(t);
  await cp(path.join(root, 'harness/agents/planner.md'), path.join(root, 'harness/agents/zzz-planner.md'));
  const before = await snapshotTree(root);
  const result = await runNode('scripts/validate.mjs', ['--root', root, '--targets', 'all', '--profile', 'core', '--json']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /duplicate id.*planner/i);
  assert.deepEqual(await snapshotTree(root), before);
});

test('invalid target model and unsupported enforcement identify role, target, and field', async t => {
  const root = await fixture(t);
  await changeRole(root, 'worker', source => source.replace('antigravity: inherit', 'antigravity: gpt-6-sol')
    .replace('requiresEnforcement: []', 'requiresEnforcement:\n  - shell'));
  const before = await snapshotTree(root);
  const result = await runNode('scripts/validate.mjs', ['--root', root, '--targets', 'all', '--profile', 'core', '--json']);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.issues.some(issue => issue.roleId === 'worker' && issue.target === 'antigravity' && issue.sourceField === 'modelPolicy'));
  assert.ok(report.issues.some(issue => issue.roleId === 'worker' && issue.target === 'opencode' && issue.sourceField === 'requiresEnforcement'));
  assert.ok(report.capabilities.some(row => row.roleId === 'worker' && row.target === 'opencode' && row.capability === 'shell' && row.status === 'unsupported'));
  assert.deepEqual(await snapshotTree(root), before);
});

test('unavailable skill discovery is an explicit issue with current version evidence', async t => {
  const root = await fixture(t);
  const result = await runNode('scripts/validate.mjs', ['--root', root, '--targets', 'all', '--profile', 'core', '--json']);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.issues.some(issue => issue.target === 'claude' && issue.sourceField === 'skills' && /unverified|not verified/i.test(issue.reason)));
  assert.equal(report.inventory.targets.opencode.testedCliVersion, 'unverified');
  assert.equal(report.inventory.targets.codex.testedCliVersion, 'codex-cli 0.153.4');
  assert.deepEqual([...report.issues].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), report.issues);
  assert.deepEqual([...new Set(report.capabilities.map(row => row.target))].sort(), ['antigravity', 'claude', 'codex', 'opencode']);
});

test('missing canonical core skill is an inventory failure, not an empty success', async t => {
  const root = await fixture(t);
  await rm(path.join(root, '.agents/skills/task-routing/SKILL.md'));
  const result = await runNode('scripts/validate.mjs', ['--root', root, '--targets', 'all', '--profile', 'core', '--json']);
  assert.equal(result.code, 1);
  assert.ok(JSON.parse(result.stdout).issues.some(issue => issue.sourceField === 'source' && /task-routing/.test(issue.reason)));
});

test('manifest-owned generated field drift fails with path and role while remaining read-only', async t => {
  const root = await fixture(t);
  const sourcePath = 'harness/agents/planner.md';
  const role = parseRole(await readFile(path.join(root, sourcePath), 'utf8'), sourcePath);
  await mkdir(path.join(root, '.codex/agents'), { recursive: true });
  const body = 'name = "planner"\nundocumented_field = "bad"\n';
  const generated = makeGeneratedFile({ path: '.codex/agents/planner.toml', target: 'codex', roleId: 'planner', sourcePath, sourceSha256: role.sourceSha256, body });
  await writeFile(path.join(root, '.codex/agents/planner.toml'), generated.file);
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [
    generated.entry,
  ] }));
  const before = await snapshotTree(root);
  const result = await runNode('scripts/validate.mjs', ['--root', root, '--targets', 'codex', '--profile', 'core', '--json']);
  assert.equal(result.code, 1);
  assert.ok(JSON.parse(result.stdout).issues.some(issue => issue.target === 'codex' && issue.roleId === 'planner' && issue.sourceField === 'generated' && /undocumented_field/.test(issue.reason)));
  assert.deepEqual(await snapshotTree(root), before);
});

test('validator rejects hash-matched headerless and forged generated files', async t => {
  for (const mutate of [
    file => file.replace(/^# @pure-harness-generated .*\n/, ''),
    file => file.replace('"generator":"pure-harness"', '"generator":"forged"'),
    file => file.replace('"sourcePath":"harness/agents/planner.md"', '"sourcePath":"harness/agents/worker.md"'),
  ]) {
    const root = await fixture(t);
    const { entry } = await generatedFixture(root, codex, 'planner');
    const filePath = path.join(root, entry.path);
    const changed = mutate(await readFile(filePath, 'utf8'));
    await writeFile(filePath, changed);
    entry.fileSha256 = createHash('sha256').update(changed).digest('hex');
    await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [entry] }));
    const report = await validationReport(root);
    assert.ok(report.issues.some(item => item.target === 'codex' && item.roleId === 'planner' && item.sourceField === 'generated' && /ownership header/i.test(item.reason)));
  }
});

test('native smoke remains unverified rather than an implicit passing capability', async t => {
  const root = await fixture(t);
  const result = await runNode('scripts/validate.mjs', ['--root', root, '--targets', 'codex', '--profile', 'core', '--json']);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.issues.some(issue => issue.target === 'codex' && issue.sourceField === 'nativeSmoke' && /unverified/.test(issue.reason)));
  assert.equal(report.inventory.targets.codex.nativeSmoke, 'unverified');
});

test('an existing manifest cannot silently omit requested role outputs', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [] }));
  const result = await runNode('scripts/validate.mjs', ['--root', root, '--targets', 'codex', '--profile', 'core', '--json']);
  assert.equal(result.code, 1);
  assert.ok(JSON.parse(result.stdout).issues.some(issue => issue.target === 'codex' && issue.roleId === 'planner' && issue.sourceField === 'manifest'));
});

test('a hash-matched generated file still fails when its canonical source changes', async t => {
  const root = await fixture(t);
  await generatedFixture(root, codex, 'planner');
  await changeRole(root, 'planner', source => source.replace('Plans bounded work', 'Plans reviewed work'));
  const before = await snapshotTree(root);
  const report = await validationReport(root);
  assert.ok(report.issues.some(item => item.target === 'codex' && item.roleId === 'planner' && item.sourceField === 'generated' && /sourceSha256|source.*drift/i.test(item.reason)));
  assert.deepEqual(await snapshotTree(root), before);
});

test('manifest metadata must match source path, body hash, and renderer version', async t => {
  const root = await fixture(t);
  const { entry } = await generatedFixture(root, codex, 'planner');
  entry.sourcePath = 'harness/agents/worker.md';
  entry.bodySha256 = '0'.repeat(64);
  entry.rendererVersion = 'obsolete';
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [entry] }));
  const report = await validationReport(root);
  for (const field of ['sourcePath', 'bodySha256', 'rendererVersion']) {
    assert.ok(report.issues.some(item => item.roleId === 'planner' && item.sourceField === 'generated' && item.reason.includes(field)), field);
  }
});

test('validator rejects extra manifest fields and unsorted entries before treating files as ready', async t => {
  const root = await fixture(t);
  const planner = (await generatedFixture(root, codex, 'planner')).entry;
  const worker = (await generatedFixture(root, codex, 'worker')).entry;
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [{ ...planner, extra: 'unowned' }] }));
  const extra = await validationReport(root);
  assert.ok(extra.issues.some(item => item.sourceField === 'manifest' && /schema|extra/i.test(item.reason)));
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [worker, planner] }));
  const unsorted = await validationReport(root);
  assert.ok(unsorted.issues.some(item => item.sourceField === 'manifest' && /sort/i.test(item.reason)));
});

test('hash-matched malformed Codex TOML fails strict field, type, and required-field checks', async t => {
  for (const [bodyChange, diagnostic] of [
    [body => body.replace('name = "planner"', 'name = "planner"\nname = "planner"'), /duplicate.*name/i],
    [body => body.replace('name = "planner"', 'name = ["planner"]'), /name.*string|invalid.*name/i],
    [body => body.replace(/^description = .*\n/m, ''), /missing.*description/i],
    [body => body.replace('name = "planner"', '[agent]\nname = "planner"'), /invalid TOML|section/i],
  ]) {
    const root = await fixture(t);
    await generatedFixture(root, codex, 'planner', bodyChange);
    const report = await validationReport(root);
    assert.ok(report.issues.some(item => item.roleId === 'planner' && item.sourceField === 'generated' && diagnostic.test(item.reason)), diagnostic);
  }
});

test('hash-matched malformed YAML fails target-specific required, duplicate, and nested checks', async t => {
  for (const [adapter, bodyChange, diagnostic] of [
    [claude, body => body.replace('name: planner', 'name: planner\nname: planner'), /duplicate.*name/i],
    [claude, body => body.replace(/^description: .*\n/m, ''), /missing.*description/i],
    [opencode, body => body.replace('mode: subagent', 'mode:\n  - subagent'), /mode.*string|mode.*scalar/i],
    [opencode, body => body.replace('permission:\n  edit: deny', 'permission:\n    edit: deny'), /indentation|nesting|syntax/i],
    [antigravity, body => body.replace('subagent: true', 'subagent: "true"'), /subagent.*boolean/i],
    [antigravity, body => body.replace('tools:\n  - view_file', 'tools:\n  wrong: view_file'), /tools.*list/i],
  ]) {
    const root = await fixture(t);
    await generatedFixture(root, adapter, 'planner', bodyChange);
    const report = await validationReport(root, adapter.targetId);
    assert.ok(report.issues.some(item => item.roleId === 'planner' && item.sourceField === 'generated' && diagnostic.test(item.reason)), `${adapter.targetId}: ${diagnostic}`);
  }
});

test('all four adapters emit syntax accepted by validation before manifest adoption', async t => {
  for (const adapter of [codex, claude, opencode, antigravity]) {
    const root = await fixture(t);
    await generatedFixture(root, adapter, 'planner');
    const report = await validationReport(root, adapter.targetId);
    assert.ok(!report.issues.some(item => item.target === adapter.targetId && item.roleId === 'planner' && item.sourceField === 'generated'), adapter.targetId);
  }
});

test('missing manifest and unknown-target manifest entry are explicit failures', async t => {
  const root = await fixture(t);
  const missing = await validationReport(root);
  assert.ok(missing.issues.some(item => item.sourceField === 'manifest' && /missing/i.test(item.reason)));
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [
    { path: '.evil/agents/planner.md', target: 'evil', roleId: 'planner' },
  ] }));
  const unknown = await validationReport(root);
  assert.ok(unknown.issues.some(item => item.sourceField === 'manifest' && /unknown target.*evil/i.test(item.reason)));
});

test('manifest-owned path cannot escape through a symlink ancestor', async t => {
  const root = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'harness-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(path.join(root, '.codex'), { recursive: true });
  try { await symlink(outside, path.join(root, '.codex/agents'), 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip(`symlink unavailable: ${error.code}`); return; } throw error; }
  const sourcePath = 'harness/agents/planner.md';
  const role = parseRole(await readFile(path.join(root, sourcePath), 'utf8'), sourcePath);
  const body = 'name = "planner"\n';
  await writeFile(path.join(outside, 'planner.toml'), body);
  const digest = createHash('sha256').update(body).digest('hex');
  await writeFile(path.join(root, 'harness/generated-manifest.json'), JSON.stringify({ entries: [
    { path: '.codex/agents/planner.toml', target: 'codex', roleId: 'planner', sourcePath, sourceSha256: role.sourceSha256,
      rendererVersion: '1', bodySha256: digest, fileSha256: digest },
  ] }));
  const report = await validationReport(root);
  assert.ok(report.issues.some(item => item.roleId === 'planner' && item.sourceField === 'generated' && /symlink/i.test(item.reason)));
});

test('detection reports repository evidence only and does not select or touch targets', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, '.opencode/agents'), { recursive: true });
  await writeFile(path.join(root, '.opencode/agents/local.md'), 'local');
  const before = await snapshotTree(root);
  const detected = await runNode('scripts/detect-targets.mjs', ['--root', root, '--json']);
  assert.equal(detected.code, 0);
  const rows = JSON.parse(detected.stdout);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.find(row => row.target === 'opencode'), { target: 'opencode', present: true, evidence: ['.opencode/agents'] });
  assert.equal(rows.find(row => row.target === 'codex').present, false);
  const validation = await runNode('scripts/validate.mjs', ['--root', root, '--profile', 'core', '--json']);
  assert.equal(validation.code, 1);
  assert.match(validation.stdout, /targets/);
  assert.deepEqual(await snapshotTree(root), before);
});

test('detection does not treat an agent-directory marker file as an integration', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, '.opencode'), { recursive: true });
  await writeFile(path.join(root, '.opencode/agents'), 'not a directory');
  const result = await runNode('scripts/detect-targets.mjs', ['--root', root, '--json']);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).find(row => row.target === 'opencode').present, false);
});
