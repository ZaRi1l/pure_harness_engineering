import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRuntime } from '../scripts/watchdog.mjs';

const base = () => ({ status: { agents: [], active_agents: [], verification: { status: 'not_run' } }, tasks: { tasks: [] }, claims: { claims: [] } });
test('watchdog reports orphaned owners and missing verification', () => {
  const snapshot = base(); snapshot.tasks.tasks = [{ id: 'done', owner: 'missing', status: 'completed' }];
  const ids = inspectRuntime(snapshot).map(item => item.id);
  assert.ok(ids.includes('unknown-owner-done')); assert.ok(ids.includes('missing-verification'));
});
test('watchdog has no warning for a normal verified run', () => {
  const snapshot = base(); snapshot.status.verification.status = 'passed'; snapshot.tasks.tasks = [{ id: 'done', owner: 'main', status: 'completed' }];
  assert.deepEqual(inspectRuntime(snapshot), []);
});
