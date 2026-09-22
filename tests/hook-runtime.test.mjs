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
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'agent-1', agent_type: 'worker' }, root);
  const status = await new RuntimeStore(root).readStatus();
  assert.equal(status.agents[0].status, 'stopped');
  assert.equal(status.signals.at(-1).summary, 'stopped');
  assert.deepEqual(status.active_agents, []);
});
