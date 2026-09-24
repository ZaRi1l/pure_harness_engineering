import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RuntimeStore, findRoot, runCli } from '../scripts/runtime-state.mjs';

async function temporaryRoot() {
  return mkdtemp(path.join(tmpdir(), 'pure-harness-'));
}

test('initializes empty deterministic runtime state', async () => {
  const root = await temporaryRoot();
  const store = new RuntimeStore(root);
  await store.initialize();
  const status = await store.readStatus();
  assert.equal(status.phase, 'idle');
  assert.deepEqual(status.active_agents, []);
  assert.deepEqual(status.agents, []);
  assert.deepEqual(status.signals, []);
  assert.equal(status.progress, null);
});

test('derives task progress from real task transitions', async () => {
  const store = new RuntimeStore(await temporaryRoot());
  await store.initialize();
  await store.upsertTask('t1', 'Implement', 'in_progress', 'worker');
  await store.upsertTask('t2', 'Review', 'pending', 'reviewer');
  await store.upsertTask('t1', 'Implement', 'completed', 'worker');
  const status = await store.readStatus();
  assert.deepEqual(status.progress, { completed: 1, total: 2 });
  assert.deepEqual(status.completed_tasks.map(task => task.id), ['t1']);
  assert.deepEqual(status.next_tasks.map(task => task.id), ['t2']);
});

test('records lifecycle and explicit agent signals without message bodies', async () => {
  const store = new RuntimeStore(await temporaryRoot());
  await store.initialize();
  await store.agentStarted('worker-1', 'worker', 'Implement core');
  await store.addSignal('planner-1', 'worker-1', 'handoff', 'Task spec ready');
  await store.agentStopped('worker-1', 'completed');
  const status = await store.readStatus();
  assert.equal(status.agents[0].status, 'completed');
  assert.deepEqual(status.signals.map(signal => signal.kind), ['delegate', 'handoff', 'result']);
  assert.equal('body' in status.signals[1], false);
});

test('signal metadata is optional, allowlisted, and backward compatible', async () => {
  const store = new RuntimeStore(await temporaryRoot());
  await store.initialize();
  await store.addSignal('main', 'worker-ui', 'handoff', 'Implement UI');
  await store.addSignal('worker-ui', 'verifier', 'verify', 'Verify UI', {
    task_id: 'ui-task', status: 'running', artifact_href: '/preview/ui.html',
    verification_name: 'ui-tests', body: 'must not persist', empty: ''
  });
  await store.addSignal('verifier', 'main', 'result', 'Verified', {
    task_id: '', status: null, artifact_href: undefined, verification_name: 42
  });
  const signals = (await store.readStatus()).signals;
  assert.deepEqual(Object.keys(signals[0]).sort(), ['from', 'kind', 'summary', 'time', 'to']);
  assert.deepEqual(signals[1], {
    time: signals[1].time, from: 'worker-ui', to: 'verifier', kind: 'verify', summary: 'Verify UI',
    task_id: 'ui-task', status: 'running', artifact_href: '/preview/ui.html', verification_name: 'ui-tests'
  });
  assert.deepEqual(Object.keys(signals[2]).sort(), ['from', 'kind', 'summary', 'time', 'to', 'verification_name']);
  assert.equal(signals[2].verification_name, '42');
});

test('an injected runtime directory never initializes the default runtime', async () => {
  const root = await temporaryRoot();
  const isolated = path.join(root, '.ai', 'demo', 'network-runtime');
  const store = new RuntimeStore(root, { runtimeDir: isolated });
  await store.initialize();
  for (const name of ['status.json', 'tasks.json', 'events.jsonl', 'claims.json']) {
    assert.equal(existsSync(path.join(isolated, name)), true, name);
  }
  assert.equal(existsSync(path.join(root, '.ai', 'runtime')), false);
});

test('signal CLI forwards optional metadata', async () => {
  const root = await temporaryRoot();
  await runCli(['signal', 'main', 'worker-ui', 'handoff', 'Implement UI', '--root', root,
    '--task', 'ui-task', '--status', 'running', '--artifact', '/preview/ui.html', '--verification', 'ui-tests']);
  const signal = (await new RuntimeStore(root).readStatus()).signals[0];
  assert.deepEqual({ task_id: signal.task_id, status: signal.status,
    artifact_href: signal.artifact_href, verification_name: signal.verification_name }, {
    task_id: 'ui-task', status: 'running', artifact_href: '/preview/ui.html', verification_name: 'ui-tests'
  });
});

test('aggregate verification cannot hide an outstanding failed check', async () => {
  const store = new RuntimeStore(await temporaryRoot());
  await store.initialize();
  await store.setVerification('failed', 'tests', '1 failed');
  await store.setVerification('passed', 'lint', 'clean');
  assert.equal((await store.readStatus()).verification.status, 'failed');
  await store.setVerification('passed', 'tests', 'all pass');
  assert.equal((await store.readStatus()).verification.status, 'passed');
});

test('migrates active agents into the durable agent registry', async () => {
  const root = await temporaryRoot();
  const runtime = path.join(root, '.ai', 'runtime');
  await mkdir(runtime, { recursive: true });
  const active = { id: 'worker-1', role: 'worker', status: 'running', current_task: 'Migrate' };
  await writeFile(path.join(runtime, 'status.json'), JSON.stringify({ schema_version: 1, active_agents: [active] }));
  const store = new RuntimeStore(root);
  await store.initialize();
  assert.deepEqual((await store.readStatus()).agents, [active]);
});

test('operating process exit does not permanently block runtime updates', async () => {
  const root = await temporaryRoot();
  const store = new RuntimeStore(root);
  await store.initialize();
  await mkdir(store.lockPath);
  await writeFile(path.join(store.lockPath, 'owner.json'), JSON.stringify({ pid: 2147483647, token: 'abandoned' }));
  await store.addEvent('recovered', 'lock recovered');
  assert.equal((await store.readEvents()).at(-1).message, 'lock recovered');
});

test('concurrent stale-lock recovery loses no updates', async () => {
  const store = new RuntimeStore(await temporaryRoot());
  await store.initialize();
  await mkdir(store.lockPath);
  await writeFile(path.join(store.lockPath, 'owner.json'), JSON.stringify({ pid: 2147483647, token: 'abandoned' }));
  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    store.addEvent('parallel', `event-${index}`)));
  assert.equal((await store.readEvents()).filter(event => event.type === 'parallel').length, 12);
});

test('findRoot prefers the Git root over nested AGENTS.md', async () => {
  const root = await temporaryRoot();
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, 'src', 'deep'), { recursive: true });
  await writeFile(path.join(root, 'src', 'AGENTS.md'), 'nested');
  assert.equal(findRoot(path.join(root, 'src', 'deep')), root);
});

test('event history stays readable during atomic capped updates', async () => {
  const store = new RuntimeStore(await temporaryRoot(), { eventLimit: 3 });
  await store.initialize();
  await store.addEvent('seed', 'event-0');
  let done = false, writerError = null;
  const writer = (async () => { for (let index = 1; index <= 12; index += 1) await store.addEvent('test', `event-${index}`); })().catch(error => { writerError = error; }).finally(() => { done = true; });
  while (!done) assert.ok((await store.readEvents()).length > 0);
  await writer;
  if (writerError) throw writerError;
  assert.deepEqual((await store.readEvents()).map(event => event.message), ['event-10', 'event-11', 'event-12']);
});

test('snapshot reads expose one consistent runtime generation', async () => {
  const store = new RuntimeStore(await temporaryRoot());
  await store.initialize();
  let writing = true;
  const writer = (async () => {
    for (let index = 0; index < 30; index += 1) await store.upsertTask(`t-${index}`, `Task ${index}`, 'pending');
    writing = false;
  })();
  do {
    const snapshot = await store.readSnapshot();
    assert.equal(snapshot.status.task_counts.total, snapshot.tasks.tasks.length);
  } while (writing);
  await writer;
});

test('claims reject overlapping write scopes and preserve independent siblings', async () => {
  const store = new RuntimeStore(await temporaryRoot());
  await store.initialize();
  await store.claim('worker-backend', ['src/backend/']);
  await store.claim('worker-ui', ['src/frontend/']);
  await assert.rejects(() => store.claim('worker-root', ['src/']), /claim conflict/);
  assert.deepEqual((await store.readSnapshot()).claims.claims.map(claim => claim.agent_id), ['worker-backend', 'worker-ui']);
  await store.releaseClaim('worker-backend');
  assert.deepEqual((await store.readSnapshot()).claims.claims.map(claim => claim.agent_id), ['worker-ui']);
});
