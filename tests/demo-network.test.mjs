import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { demoRuntimePath, prepareDemo, resetDemo, runDemo } from '../scripts/demo-network.mjs';

const fixtureRoot = fileURLToPath(new URL('./fixtures/agent-network-demo/.ai/runtime/', import.meta.url));

test('demo preparation and reset touch only the exact demo runtime', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-network-demo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const realRuntime = path.join(root, '.ai', 'runtime');
  await mkdir(realRuntime, { recursive: true });
  await writeFile(path.join(realRuntime, 'sentinel.txt'), 'keep');
  await prepareDemo(root, fixtureRoot);
  assert.equal(await readFile(path.join(realRuntime, 'sentinel.txt'), 'utf8'), 'keep');
  const status = JSON.parse(await readFile(path.join(demoRuntimePath(root), 'status.json')));
  assert.equal(status.current_goal, 'Inspect agent collaboration');
  await resetDemo(root);
  assert.equal(existsSync(demoRuntimePath(root)), false);
  assert.equal(await readFile(path.join(realRuntime, 'sentinel.txt'), 'utf8'), 'keep');
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
  assert.deepEqual(status.signals.map(signal => signal.kind), ['delegate', 'delegate', 'delegate', 'result', 'handoff', 'result', 'verify', 'result', 'retry', 'verify', 'review']);
  assert.deepEqual(status.signals.slice(1, 3).map(signal => signal.to), ['worker-ui', 'worker-api']);
  assert.ok(status.signals.every(signal => signal.time && signal.summary && signal.id));
  assert.ok(Date.parse(status.signals[8].time) > Date.parse(status.signals[7].time));
  assert.ok(tasks.tasks.some(task => task.id === 'api' && task.owner === 'worker-api'));
  assert.ok(claims.claims.some(claim => claim.agent_id === 'worker-api'));
  assert.ok(status.verification.checks.some(check => check.name === 'api-tests'));
  assert.ok(status.artifact_preview_links.some(link => link.href === '/preview/demo-ui.html'));
  assert.ok(events.some(event => /retry/i.test(event.message)));
});

test('demo server serves fixture runtime from an isolated directory', async t => {
  const root = path.resolve('.');
  const target = demoRuntimePath(root);
  const server = await runDemo(root, '127.0.0.1', 0);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await resetDemo(root); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/runtime/snapshot`);
  const snapshot = await response.json();
  assert.equal(snapshot.status.current_goal, 'Inspect agent collaboration');
  assert.equal(snapshot.status.signals.length, 11);
  assert.equal(existsSync(target), true);
});
