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
  assert.deepEqual(status.active_agents, []);
  assert.equal(claims.claims.length, 1);
  assert.equal(claims.claims[0].agent_id, 'agent-2');
  assert.deepEqual(claims.claims[0].scopes, ['src/frontend']);
});
