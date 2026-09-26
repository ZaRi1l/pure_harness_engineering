import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRuntime } from '../scripts/watchdog.mjs';

const base = () => ({ status: { agents: [], active_agents: [], verification: { status: 'not_run' } }, tasks: { tasks: [] }, claims: { claims: [] }, events: [] });
test('watchdog reports orphaned owners and missing verification', () => {
  const snapshot = base(); snapshot.tasks.tasks = [{ id: 'done', owner: 'missing', status: 'completed' }];
  const ids = inspectRuntime(snapshot).map(item => item.id);
  assert.ok(ids.includes('unknown-owner-done')); assert.ok(ids.includes('missing-verification'));
});
test('watchdog has no warning for a normal verified run', () => {
  const snapshot = base(); snapshot.status.verification.status = 'passed'; snapshot.tasks.tasks = [{ id: 'done', owner: 'main', status: 'completed' }];
  assert.deepEqual(inspectRuntime(snapshot), []);
});

test('watchdog reports fallback lifecycle when subagent hook dispatch is absent', () => {
  const snapshot = base();
  snapshot.status.agents = [{ id: 'worker-1', status: 'stopped', start_source: 'orchestration', stop_source: 'orchestration' }];
  const warning = inspectRuntime(snapshot).find(item => item.id === 'lifecycle-hook-dispatch-unobserved');
  assert.match(warning.message, /Falling back to orchestration lifecycle tracking/);
  snapshot.events.push({ type: 'hook_dispatch', data: { hook_event: 'SubagentStart' } }, { type: 'hook_dispatch', data: { hook_event: 'SubagentStop' } });
  assert.equal(inspectRuntime(snapshot).some(item => item.id === 'lifecycle-hook-dispatch-unobserved'), false);
});

test('interrupted fallback stays active and is reported stale without becoming completed', () => {
  const snapshot = base(), agent = { id: 'worker-1', role: 'worker', status: 'running', start_source: 'orchestration', started_at: '2020-01-01T00:00:00.000Z' };
  snapshot.status.agents = [agent]; snapshot.status.active_agents = [agent];
  const ids = inspectRuntime(snapshot, { staleMs: 1 }).map(item => item.id);
  assert.ok(ids.includes('stale-agent-worker-1'));
  assert.ok(ids.includes('lifecycle-hook-dispatch-unobserved'));
  assert.equal(snapshot.status.agents[0].status, 'running');
});

test('missing SessionStart after runtime reset is not diagnosed as unavailable hooks', () => {
  const snapshot = base();
  assert.equal(inspectRuntime(snapshot).some(item => item.id === 'lifecycle-hook-dispatch-unobserved'), false);
});
