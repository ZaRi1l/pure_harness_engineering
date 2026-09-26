import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { handleHook } from '../scripts/hook-runtime.mjs';
import { RuntimeStore } from '../scripts/runtime-state.mjs';

test('actual SubagentStop shape records a neutral lifecycle return', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'agent-1', agent_type: 'worker', task: 'Do work' }, root);
  const store = new RuntimeStore(root); await store.claim('agent-1', ['src/backend/']); await store.claim('agent-2', ['src/frontend/']);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'agent-1', agent_type: 'worker' }, root);
  const status = await store.readStatus(), claims = await store.readClaims();
  assert.equal(status.agents[0].status, 'stopped');
  assert.equal(status.signals.at(-1).summary, 'stopped');
  assert.equal('status' in status.signals.at(-1), false);
  assert.deepEqual(status.active_agents, []);
  assert.equal(claims.claims.length, 1);
  assert.equal(claims.claims[0].agent_id, 'agent-2');
  assert.deepEqual(claims.claims[0].scopes, ['src/frontend']);
});

test('hooks attach explicit task and outcome metadata to lifecycle signals', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'agent-1', agent_type: 'worker',
    task: 'Do work', task_id: 'task-1' }, root);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'agent-1', agent_type: 'worker',
    task_id: 'task-1', outcome: 'failed' }, root);
  const status = await new RuntimeStore(root).readStatus();
  assert.equal(status.signals[0].task_id, 'task-1');
  assert.equal(status.signals[1].task_id, 'task-1');
  assert.equal(status.signals[1].status, 'failed');
  assert.equal(status.agents[0].status, 'failed');
});

test('hook dispatch reconciles orchestration fallback without duplicate lifecycle history', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  const store = new RuntimeStore(root); await store.initialize();
  await store.agentStarted('native-1', 'worker', 'Do work', { task_id: 'task-1', source: 'orchestration' });
  await handleHook({ hook_event_name: 'SubagentStart', agent_id: 'native-1', agent_type: 'worker', task: 'Do work', task_id: 'task-1' }, root);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'native-1', agent_type: 'worker', task_id: 'task-1' }, root);
  await store.agentStopped('native-1', 'stopped', { task_id: 'task-1', source: 'orchestration' });
  const snapshot = await store.readSnapshot(), agent = snapshot.status.agents[0];
  assert.deepEqual([agent.start_source, agent.stop_source, agent.status], ['hook', 'hook', 'stopped']);
  assert.deepEqual(snapshot.status.signals.map(signal => signal.kind), ['delegate', 'result']);
  assert.equal(snapshot.events.filter(event => event.type === 'agent_started').length, 1);
  assert.equal(snapshot.events.filter(event => event.type === 'agent_stopped').length, 1);
  assert.deepEqual(snapshot.events.filter(event => event.type === 'hook_dispatch').map(event => event.data.hook_event), ['SubagentStart', 'SubagentStop']);
});

test('session hooks record dispatch evidence without fabricating lifecycle state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-hook-'));
  await handleHook({ hook_event_name: 'SessionStart' }, root);
  const snapshot = await new RuntimeStore(root).readSnapshot();
  assert.deepEqual(snapshot.status.agents, []);
  assert.equal(snapshot.events.some(event => event.type === 'hook_dispatch' && event.data.hook_event === 'SessionStart'), true);
});
