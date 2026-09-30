import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkCutover, inventoryRuntime } from '../scripts/project-cutover.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-cutover-'));
  const checkoutRoot = path.join(root, 'checkout');
  const harnessRoot = path.join(root, 'installation');
  const legacyRuntimeRoot = path.join(root, 'legacy-runtime');
  const bindingPath = path.join(root, 'binding.json');
  await mkdir(path.join(checkoutRoot, 'harness-adapter'), { recursive: true });
  await mkdir(path.join(harnessRoot, 'projects', 'alpha'), { recursive: true });
  await mkdir(legacyRuntimeRoot);
  execFileSync('git', ['init', '-q'], { cwd: checkoutRoot });
  await writeFile(path.join(checkoutRoot, 'harness-adapter', 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'alpha', displayName: 'Alpha', paths: { tasks: 'projects/alpha/tasks', memory: 'projects/alpha/memory', runtime: 'projects/alpha/runtime' }, adapters: {} }));
  await writeFile(bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [{ projectId: 'alpha', harnessRoot, projectRoot: checkoutRoot }] }));
  await writeFile(path.join(legacyRuntimeRoot, 'status.json'), '{"old":true}\n');
  const options = { projectId: 'alpha', checkoutRoot, bindingPath, legacyRuntimeRoot, validationReport: { ok: true }, discoveryEvidence: { roles: ['worker'], skills: ['testing'], hookEvents: ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop'] }, quiescence: { legacySessions: 0, legacyWriters: 0, activeClaims: 0 }, verifiedCommands: ['status', 'preview', 'claim', 'release-claim'] };
  options.legacyInventory = await inventoryRuntime(legacyRuntimeRoot);
  return { root, options };
}

async function disposableFixture(t) {
  const result = await fixture();
  t.after(() => rm(result.root, { recursive: true, force: true }));
  return result;
}

test('cutover refuses live legacy session', async () => {
  const { options } = await fixture();
  const report = await checkCutover({ ...options, quiescence: { ...options.quiescence, legacySessions: 1 } });
  assert.equal(report.ok, false);
  assert.match(report.failures.join(' '), /session|quiescence/i);
});

test('cutover refuses missing binding', async () => {
  const { root, options } = await fixture();
  const report = await checkCutover({ ...options, bindingPath: path.join(root, 'missing.json') });
  assert.equal(report.ok, false);
  assert.match(report.failures.join(' '), /binding/i);
});

test('cutover leaves old runtime intact', async () => {
  const { options } = await fixture();
  const before = await readFile(path.join(options.legacyRuntimeRoot, 'status.json'));
  const report = await checkCutover(options);
  assert.equal(report.ok, false);
  assert.match(report.failures.join(' '), /native|fresh.session/i);
  assert.deepEqual(await readFile(path.join(options.legacyRuntimeRoot, 'status.json')), before);
  assert.deepEqual(await inventoryRuntime(options.legacyRuntimeRoot), options.legacyInventory);
});

test('no dual runtime fallback', async () => {
  const { root, options } = await fixture();
  const before = await readdir(options.legacyRuntimeRoot);
  const failed = await checkCutover({ ...options, bindingPath: path.join(root, 'missing.json'), quiescence: { ...options.quiescence, legacyWriters: 1 } });
  assert.equal(failed.ok, false);
  assert.match(failed.failures.join(' '), /binding/i);
  assert.deepEqual(await readdir(options.legacyRuntimeRoot), before);
});

test('cutover rejects legacy runtime aliased to selected runtime', async () => {
  const { options } = await fixture();
  const selected = path.join(options.legacyRuntimeRoot, '..', 'installation', 'projects', 'alpha', 'runtime');
  await mkdir(selected, { recursive: true });
  const report = await checkCutover({ ...options, legacyRuntimeRoot: selected, legacyInventory: await inventoryRuntime(selected) });
  assert.equal(report.ok, false);
  assert.match(report.failures.join(' '), /dual|runtime|separate/i);
});

test('cutover requires fresh discovery and verified commands', async () => {
  const { options } = await fixture();
  const report = await checkCutover({ ...options, discoveryEvidence: { roles: [], skills: [], hookEvents: [] }, verifiedCommands: [] });
  assert.equal(report.ok, false);
  assert.match(report.failures.join(' '), /discovery|hook|command/i);
});

test('caller-supplied forged native evidence cannot authorize cutover', async () => {
  const { options } = await fixture();
  const report = await checkCutover({
    ...options,
    validationReport: { ok: true, failures: [] },
    discoveryEvidence: { roles: ['worker'], skills: ['testing'], hookEvents: ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop'], sessionId: 'forged' },
    quiescence: { legacySessions: 0, legacyWriters: 0, activeClaims: 0 },
    verifiedCommands: ['status', 'preview', 'claim', 'release-claim'],
  });
  assert.equal(report.ok, false);
  assert.match(report.failures.join(' '), /native|fresh.session/i);
});

test('cutover detects same-size runtime content changed after initial inventory', async t => {
  const { options } = await disposableFixture(t);
  await writeFile(path.join(options.legacyRuntimeRoot, 'status.json'), '{"old":null}\n');
  const report = await checkCutover(options);
  assert.equal(report.ok, false);
  assert.match(report.failures.join(' '), /inventory.*changed|inventory.*unreadable/i);
});

test('cutover detects a nested runtime entry added after initial inventory', async t => {
  const { options } = await disposableFixture(t);
  await mkdir(path.join(options.legacyRuntimeRoot, 'nested'));
  await writeFile(path.join(options.legacyRuntimeRoot, 'nested', 'new.json'), '{}\n');
  const report = await checkCutover(options);
  assert.equal(report.ok, false);
  assert.match(report.failures.join(' '), /inventory.*changed|inventory.*unreadable/i);
});

test('inventory rejects a linked runtime root', async t => {
  const { root, options } = await disposableFixture(t);
  const linkedRoot = path.join(root, 'linked-runtime');
  try { await symlink(options.legacyRuntimeRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('link creation unavailable'); return; } throw error; }
  await assert.rejects(inventoryRuntime(linkedRoot), /link/i);
});

test('cutover rejects a linked child added after initial inventory', async t => {
  const { root, options } = await disposableFixture(t);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.json'), '{}\n');
  try { await symlink(outside, path.join(options.legacyRuntimeRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('link creation unavailable'); return; } throw error; }
  await assert.rejects(inventoryRuntime(options.legacyRuntimeRoot), /link/i);
  const report = await checkCutover(options);
  assert.equal(report.ok, false);
  assert.match(report.failures.join(' '), /inventory.*unreadable/i);
});

test('inventory rejects a non-directory runtime root', async t => {
  const { options } = await disposableFixture(t);
  await assert.rejects(inventoryRuntime(path.join(options.legacyRuntimeRoot, 'status.json')));
});

test('inventory rejects unsupported FIFO entries', { skip: process.platform === 'win32' }, async t => {
  const { options } = await disposableFixture(t);
  execFileSync('mkfifo', [path.join(options.legacyRuntimeRoot, 'queue')]);
  await assert.rejects(inventoryRuntime(options.legacyRuntimeRoot), /unsupported entry/i);
});
