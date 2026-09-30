import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectProjectBinding } from '../scripts/project-diagnostic.mjs';
import { checkRepository } from '../scripts/self-check.mjs';
import { RuntimeStore } from '../scripts/runtime-state.mjs';

const diagnosticScript = path.resolve('scripts/project-diagnostic.mjs');
const statusScript = path.resolve('scripts/status.mjs');
const manifest = { schemaVersion: 1, id: 'alpha', displayName: 'Alpha', paths: {
  tasks: 'projects/alpha/tasks', memory: 'projects/alpha/memory', runtime: 'projects/alpha/runtime'
}, adapters: {} };

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-diagnostic-'));
  const checkoutRoot = path.join(root, 'checkout');
  const harnessRoot = path.join(root, 'installation');
  const bindingPath = path.join(root, 'binding.json');
  await mkdir(path.join(checkoutRoot, 'harness-adapter'), { recursive: true });
  await mkdir(harnessRoot);
  execFileSync('git', ['init', '-q'], { cwd: checkoutRoot });
  await writeFile(path.join(checkoutRoot, 'harness-adapter', 'project.json'), JSON.stringify(manifest));
  await writeFile(bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [{ projectId: 'alpha', harnessRoot, projectRoot: checkoutRoot }] }));
  return { root, checkoutRoot, harnessRoot, bindingPath };
}

test('diagnostic does not create runtime', async () => {
  const f = await fixture();
  const before = await readdir(f.harnessRoot);
  const result = await inspectProjectBinding({ checkoutRoot: f.checkoutRoot, bindingPath: f.bindingPath, projectId: 'alpha' });
  assert.deepEqual(result, { ok: true, code: 'OK', message: 'Project context is valid', projectId: 'alpha' });
  assert.deepEqual(await readdir(f.harnessRoot), before);
  const cli = spawnSync(process.execPath, [diagnosticScript, '--checkout', f.checkoutRoot, '--binding', f.bindingPath, '--project', 'alpha'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Project context is valid/);
  assert.deepEqual(await readdir(f.harnessRoot), before);
});

test('unbound hook is read only', async () => {
  const f = await fixture();
  const missing = path.join(f.root, 'missing.json');
  const before = await readdir(f.root);
  const result = await inspectProjectBinding({ checkoutRoot: f.checkoutRoot, bindingPath: missing, projectId: 'alpha' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_FILE');
  assert.match(result.message, /^binding:/);
  assert.deepEqual(await readdir(f.root), before);
  const cli = spawnSync(process.execPath, [diagnosticScript, '--checkout', f.checkoutRoot, '--binding', missing, '--project', 'alpha'], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /binding:/);
  assert.deepEqual(await readdir(f.root), before);
});

test('diagnostic identifies invalid field without echoing binding', async () => {
  const f = await fixture();
  const secret = 'PRIVATE_BINDING_PAYLOAD_123';
  await writeFile(f.bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [{ projectId: 'alpha', harnessRoot: path.join(f.root, secret), projectRoot: f.checkoutRoot }] }));
  const before = await readdir(f.root);
  const result = await inspectProjectBinding({ checkoutRoot: f.checkoutRoot, bindingPath: f.bindingPath, projectId: 'alpha' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNAVAILABLE_ROOT');
  assert.match(result.message, /^harnessRoot:/);
  assert.ok(result.message.length <= 160);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BINDING|pure-diagnostic-/);
  assert.deepEqual(await readdir(f.root), before);
  const cli = spawnSync(process.execPath, [diagnosticScript, '--checkout', f.checkoutRoot, '--binding', f.bindingPath, '--project', 'alpha'], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.doesNotMatch(cli.stdout + cli.stderr, /PRIVATE_BINDING|pure-diagnostic-/);
  assert.deepEqual(await readdir(f.root), before);
});

test('ambiguous registration exits nonzero without project writes', async () => {
  const f = await fixture();
  const binding = JSON.parse(await readFile(f.bindingPath, 'utf8'));
  binding.registrations.push({ ...binding.registrations[0] });
  await writeFile(f.bindingPath, JSON.stringify(binding));
  const before = await readdir(f.harnessRoot);
  const cli = spawnSync(process.execPath, [diagnosticScript, '--checkout', f.checkoutRoot, '--binding', f.bindingPath, '--project', 'alpha'], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /binding\.registrations: duplicate registration/i);
  assert.deepEqual(await readdir(f.harnessRoot), before);
});

test('legacy runtime remains an explicit read fixture after context cutover', async () => {
  const f = await fixture();
  const store = RuntimeStore.legacyFixture(f.checkoutRoot);
  await store.setGoal('Legacy fixture goal', 'execution');
  const oldStatus = await readFile(path.join(f.checkoutRoot, '.ai', 'runtime', 'status.json'), 'utf8');
  const unbound = spawnSync(process.execPath, [statusScript], { cwd: f.checkoutRoot, encoding: 'utf8' });
  assert.notEqual(unbound.status, 0);
  assert.match(unbound.stderr, /project, checkout, and binding are required/);
  assert.equal((await store.readStatus()).current_goal, 'Legacy fixture goal');
  assert.equal(await readFile(path.join(f.checkoutRoot, '.ai', 'runtime', 'status.json'), 'utf8'), oldStatus);
  assert.deepEqual(await readdir(f.harnessRoot), []);
});

test('self-check optionally reports binding diagnostics without creating project runtime', async () => {
  const f = await fixture();
  const before = await readdir(f.harnessRoot);
  const report = await checkRepository(path.resolve('.'), { exerciseRuntime: false, exerciseHttp: false,
    spawnCodex: () => ({ status: 0, stdout: '{"checks":{"config.load":{"status":"ok"}}}', stderr: '' }),
    projectBinding: { checkoutRoot: f.checkoutRoot, bindingPath: f.bindingPath, projectId: 'alpha' } });
  assert.ok(report.checks.some(item => item.includes('alpha') && item.includes('binding')));
  assert.deepEqual(await readdir(f.harnessRoot), before);
});

test('self-check reports a stale binding as a failure', async () => {
  const f = await fixture();
  const report = await checkRepository(path.resolve('.'), { exerciseRuntime: false, exerciseHttp: false,
    spawnCodex: () => ({ status: 0, stdout: '{"checks":{"config.load":{"status":"ok"}}}', stderr: '' }),
    projectBinding: { checkoutRoot: f.checkoutRoot, bindingPath: path.join(f.root, 'missing.json'), projectId: 'alpha' } });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some(item => item.includes('MISSING_FILE') && item.includes('binding:')));
  assert.deepEqual(await readdir(f.harnessRoot), []);
});
