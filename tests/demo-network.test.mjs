import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { demoRuntimePath, prepareDemo, resetDemo, runDemo } from '../scripts/demo-network.mjs';

const fixtureRoot = fileURLToPath(new URL('./fixtures/agent-network-demo/.ai/runtime/', import.meta.url));
const previewRoot = fileURLToPath(new URL('../preview/', import.meta.url));

async function treeBytes(root) {
  const result = {};
  async function visit(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) { result[name] = 'directory'; await visit(path.join(directory, entry.name), name); }
      else result[name] = (await readFile(path.join(directory, entry.name))).toString('base64');
    }
  }
  await visit(root);
  return result;
}

async function tempProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-network-demo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'preview'));
  for (const name of ['index.html', 'agent-network.js', 'artifact-tabs.js', 'demo-ui.html']) {
    await copyFile(path.join(previewRoot, name), path.join(root, 'preview', name));
  }
  return root;
}

test('demo preparation and reset touch only the exact demo runtime', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-network-demo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const realRuntime = path.join(root, '.ai', 'runtime');
  await mkdir(realRuntime, { recursive: true });
  await mkdir(path.join(realRuntime, 'nested'));
  await writeFile(path.join(realRuntime, 'status.json'), '{"real":true}\n');
  await writeFile(path.join(realRuntime, 'events.jsonl'), 'real event\n');
  await writeFile(path.join(realRuntime, 'nested', 'payload.bin'), Buffer.from([0, 1, 255, 42]));
  const before = await treeBytes(realRuntime);
  await prepareDemo(root, fixtureRoot);
  assert.deepEqual(await treeBytes(realRuntime), before);
  const status = JSON.parse(await readFile(path.join(demoRuntimePath(root), 'status.json')));
  assert.equal(status.current_goal, 'Inspect agent collaboration');
  await resetDemo(root);
  assert.equal(existsSync(demoRuntimePath(root)), false);
  assert.deepEqual(await treeBytes(realRuntime), before);
});

test('reset rejects an override outside the exact demo runtime before deletion', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-network-demo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const other = path.join(root, '.ai', 'runtime');
  await mkdir(other, { recursive: true });
  await writeFile(path.join(other, 'sentinel.txt'), 'keep');
  await assert.rejects(resetDemo(root, other), /unsafe demo runtime path/);
  assert.equal(await readFile(path.join(other, 'sentinel.txt'), 'utf8'), 'keep');
});

test('fixture stores a complete ordered collaboration and supported details', async () => {
  const files = ['status.json', 'tasks.json', 'claims.json', 'events.jsonl'];
  for (const name of files) assert.equal(existsSync(path.join(fixtureRoot, name)), true, name);
  const status = JSON.parse(await readFile(path.join(fixtureRoot, 'status.json')));
  const tasks = JSON.parse(await readFile(path.join(fixtureRoot, 'tasks.json')));
  const claims = JSON.parse(await readFile(path.join(fixtureRoot, 'claims.json')));
  const events = (await readFile(path.join(fixtureRoot, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(status.agents.map(agent => agent.id).sort(), ['integrator-1', 'planner-1', 'reviewer-1', 'verifier-1', 'worker-api', 'worker-ui']);
  assert.deepEqual(new Set(status.agents.map(agent => agent.status)), new Set(['completed', 'running', 'failed', 'blocked', 'stopped']));
  assert.deepEqual(status.active_agents.map(agent => agent.id).sort(), ['reviewer-1', 'worker-api']);
  assert.deepEqual(status.signals.map(({ from, to, kind, status, task_id, verification_name }) => [from, to, kind, status, task_id, verification_name]), [
    ['main', 'planner-1', 'delegate', 'completed', 'plan', undefined],
    ['main', 'worker-ui', 'delegate', 'completed', 'ui', undefined],
    ['main', 'worker-api', 'delegate', 'active', 'api', undefined],
    ['worker-ui', 'main', 'result', 'completed', 'ui', undefined],
    ['worker-ui', 'integrator-1', 'handoff', 'completed', 'integration', undefined],
    ['worker-api', 'main', 'result', 'failed', 'api', undefined],
    ['integrator-1', 'verifier-1', 'verify', 'completed', 'verification', 'integration-tests'],
    ['verifier-1', 'worker-api', 'result', 'failed', 'api', 'api-tests'],
    ['main', 'worker-api', 'retry', 'active', 'api', undefined],
    ['worker-api', 'verifier-1', 'verify', 'completed', 'api', 'api-tests'],
    ['verifier-1', 'main', 'result', 'completed', 'api', 'api-tests'],
    ['verifier-1', 'reviewer-1', 'review', 'active', 'review', undefined]
  ]);
  assert.deepEqual(status.signals.slice(1, 3).map(signal => signal.to), ['worker-ui', 'worker-api']);
  assert.equal(status.signals[3].artifact_href, '/preview/demo-ui.html');
  assert.ok(status.signals.every(signal => signal.time && signal.summary && signal.id));
  assert.ok(Date.parse(status.signals[8].time) > Date.parse(status.signals[7].time));
  assert.ok(Date.parse(status.signals[10].time) > Date.parse(status.signals[9].time));
  assert.ok(tasks.tasks.some(task => task.id === 'api' && task.owner === 'worker-api'));
  assert.ok(claims.claims.some(claim => claim.agent_id === 'worker-api'));
  assert.equal(status.verification.status, 'passed');
  assert.ok(status.verification.checks.some(check => check.name === 'api-tests' && check.status === 'passed'));
  assert.deepEqual(status.blockers, []);
  assert.ok(status.artifact_preview_links.some(link => link.href === '/preview/demo-ui.html'));
  assert.ok(events.some(event => /retry/i.test(event.message)));
  assert.ok(events.some(event => event.type === 'verification' && /API tests passed/i.test(event.message)));
});

test('demo server serves fixture runtime from an isolated directory', async t => {
  const root = await tempProject(t);
  const realRuntime = path.join(root, '.ai', 'runtime');
  await mkdir(path.join(realRuntime, 'nested'), { recursive: true });
  await writeFile(path.join(realRuntime, 'status.json'), '{"real":true}\n');
  await writeFile(path.join(realRuntime, 'nested', 'payload.bin'), Buffer.from([0, 1, 255, 42]));
  const before = await treeBytes(realRuntime);
  const target = demoRuntimePath(root);
  const server = await runDemo(root, '127.0.0.1', 0);
  try {
    assert.deepEqual(await treeBytes(realRuntime), before);
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/runtime/snapshot`);
    const snapshot = await response.json();
    assert.equal(snapshot.status.current_goal, 'Inspect agent collaboration');
    assert.equal(snapshot.status.signals.length, 12);
    assert.equal(existsSync(target), true);
    const artifact = await fetch(`${base}/preview/demo-ui.html`);
    assert.equal(artifact.status, 200);
    assert.match(await artifact.text(), /Demo UI Preview/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await resetDemo(root);
  }
  assert.deepEqual(await treeBytes(realRuntime), before);
  assert.equal(existsSync(target), false);
});
