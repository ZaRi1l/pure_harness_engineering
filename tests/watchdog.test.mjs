import assert from 'node:assert/strict';
import test from 'node:test';
import { cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { inspectRuntime } from '../scripts/watchdog.mjs';
import { fixedFixture } from './support/fixed-project-fixture.mjs';
import { loadFixedProjectContext } from '../scripts/project-context.mjs';
import { RuntimeStore } from '../scripts/runtime-state.mjs';

test('flagless watchdog inspects fixed child and rejects legacy selector before write', async () => {
  const f = await fixedFixture();
  await cp(path.resolve('scripts'), path.join(f.harnessRoot, 'scripts'), { recursive: true });
  const context = await loadFixedProjectContext({ harnessRoot: f.harnessRoot, cwd: f.projectRoot });
  const store = new RuntimeStore(context);
  await store.setGoal('child only');
  const run = (...args) => spawnSync(process.execPath, [path.join(f.harnessRoot, 'scripts/watchdog.mjs'), ...args], { cwd: f.projectRoot, encoding: 'utf8' });
  const good = run('--json');
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout), { warnings: [] });
  const before = await store.readStatus();
  const rejected = run('--project', 'other', '--json');
  assert.notEqual(rejected.status, 0);
  assert.deepEqual(await store.readStatus(), before);
});

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
