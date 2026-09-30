import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadProjectContext } from '../scripts/project-context.mjs';
import { RuntimeStore, runCli } from '../scripts/runtime-state.mjs';
import { discoverCatalog, discoverTaskSpecs } from '../scripts/catalog.mjs';
import { handleHook } from '../scripts/hook-runtime.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
const manifest = id => ({ schemaVersion: 1, id, displayName: id, paths: { tasks: `projects/${id}/tasks`, memory: `projects/${id}/memory`, runtime: `projects/${id}/runtime` }, adapters: {} });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-runtime-context-'));
  const installation = path.join(root, 'installation');
  const bindingPath = path.join(root, 'binding.json');
  await mkdir(installation);
  const registrations = [];
  for (const id of ['alpha', 'beta']) {
    const project = path.join(root, id);
    await mkdir(path.join(project, 'harness-adapter'), { recursive: true });
    git(project, 'init', '-q');
    git(project, 'config', 'user.name', 'Fixture');
    git(project, 'config', 'user.email', 'fixture@example.test');
    await writeFile(path.join(project, 'harness-adapter', 'project.json'), JSON.stringify(manifest(id)));
    git(project, 'add', '.'); git(project, 'commit', '-qm', 'fixture');
    registrations.push({ projectId: id, harnessRoot: installation, projectRoot: project });
  }
  await writeFile(bindingPath, JSON.stringify({ schemaVersion: 1, registrations }));
  const context = async (id, checkoutRoot = path.join(root, id)) => loadProjectContext({ checkoutRoot, bindingPath, projectId: id });
  return { root, installation, bindingPath, context };
}

test('two projects never share runtime', async () => {
  const f = await fixture(), alpha = new RuntimeStore(await f.context('alpha')), beta = new RuntimeStore(await f.context('beta'));
  assert.notEqual(alpha.runtime, beta.runtime);
  await alpha.claim('worker-1', ['src']);
  assert.equal((await beta.readClaims()).claims.length, 0);
  assert.equal(existsSync(path.join(f.root, 'alpha', '.ai', 'runtime')), false);
});

test('linked worktrees share selected project runtime', async () => {
  const f = await fixture(), linked = path.join(f.root, 'alpha-linked');
  git(path.join(f.root, 'alpha'), 'worktree', 'add', '-qb', 'linked-fixture', linked);
  const primary = new RuntimeStore(await f.context('alpha'));
  const secondary = new RuntimeStore(await f.context('alpha', linked));
  assert.equal(primary.runtime, secondary.runtime);
  await primary.claim('worker-1', ['src']);
  assert.equal((await secondary.readClaims()).claims[0].agent_id, 'worker-1');
});

test('linked worktrees keep same agent claims separate and release only own', async () => {
  const f = await fixture(), linked = path.join(f.root, 'alpha-linked');
  git(path.join(f.root, 'alpha'), 'worktree', 'add', '-qb', 'linked-fixture', linked);
  const primaryContext = await f.context('alpha'), linkedContext = await f.context('alpha', linked);
  const primary = new RuntimeStore(primaryContext), secondary = new RuntimeStore(linkedContext);
  await primary.claim('shared-agent', ['src']);
  await secondary.claim('shared-agent', ['src']);
  assert.deepEqual((await primary.readClaims()).claims.map(claim => claim.checkout_root).sort(), [primaryContext.checkoutRoot, linkedContext.checkoutRoot].sort());
  await primary.releaseClaim('shared-agent');
  assert.deepEqual((await secondary.readClaims()).claims.map(claim => claim.checkout_root), [linkedContext.checkoutRoot]);
});

test('linked hook stop leaves same-ID agent and claim in other checkout active', async () => {
  const f = await fixture(), linked = path.join(f.root, 'alpha-linked');
  git(path.join(f.root, 'alpha'), 'worktree', 'add', '-qb', 'linked-fixture', linked);
  const primaryContext = await f.context('alpha'), linkedContext = await f.context('alpha', linked);
  const primary = new RuntimeStore(primaryContext), secondary = new RuntimeStore(linkedContext);
  await primary.agentStarted('shared-agent', 'worker', 'Primary', { source: 'hook' });
  await secondary.agentStarted('shared-agent', 'worker', 'Linked', { source: 'hook' });
  await primary.claim('shared-agent', ['src']);
  await secondary.claim('shared-agent', ['src']);
  await handleHook({ hook_event_name: 'SubagentStop', agent_id: 'shared-agent', cwd: linkedContext.checkoutRoot }, linkedContext);
  const snapshot = await primary.readSnapshot();
  assert.deepEqual(snapshot.claims.claims.map(claim => claim.checkout_root), [primaryContext.checkoutRoot]);
  assert.deepEqual(snapshot.status.active_agents.map(agent => agent.checkout_root), [primaryContext.checkoutRoot]);
  assert.equal(snapshot.status.agents.find(agent => agent.checkout_root === linkedContext.checkoutRoot)?.status, 'stopped');
});

test('claim records verified checkout identity', async () => {
  const f = await fixture(), context = await f.context('alpha'), store = new RuntimeStore(context);
  await store.claim('worker-1', ['src']);
  const claim = (await store.readClaims()).claims[0];
  assert.equal(claim.project_id, 'alpha');
  assert.equal(claim.checkout_root, context.checkoutRoot);
});

test('project claim cannot cover engine source', async () => {
  const f = await fixture(), store = new RuntimeStore(await f.context('alpha'));
  await assert.rejects(store.claim('worker-1', [path.resolve('.')]), /scope|root|outside/i);
  assert.equal(existsSync(store.runtime), false);
});

test('project claim rejects checkout symlink into engine source', async t => {
  const f = await fixture(), engineSource = path.join(f.root, 'engine-source');
  await mkdir(engineSource);
  try { await symlink(engineSource, path.join(f.root, 'alpha', 'src'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('symlink creation unavailable'); return; } throw error; }
  const store = new RuntimeStore(await f.context('alpha'));
  await assert.rejects(store.claim('worker-1', ['src/module.mjs']), /symlink|scope|escape/i);
  assert.equal(existsSync(store.runtime), false);
});

test('core context cannot write project runtime', async () => {
  const f = await fixture();
  const core = RuntimeStore.coreContext({ engineRoot: path.resolve('.'), runtimeRoot: path.join(path.resolve('.'), '.ai', 'runtime') });
  const store = new RuntimeStore(core);
  await assert.rejects(store.claim('worker-1', [path.join(f.installation, 'projects', 'alpha')]), /scope|root|outside/i);
  assert.equal(existsSync(path.join(f.installation, 'projects', 'alpha', 'runtime')), false);
});

test('core context rejects runtime outside engine source', async () => {
  const f = await fixture();
  assert.throws(() => RuntimeStore.coreContext({ engineRoot: path.resolve('.'), runtimeRoot: path.join(f.installation, 'projects', 'alpha', 'runtime') }), /runtime|engine/i);
});

test('runtime rejects a post-validation junction swap before reads, locks, or writes', async t => {
  const f = await fixture(), context = await f.context('alpha'), store = new RuntimeStore(context);
  await store.initialize();
  const state = await store.readSnapshot();
  const saved = path.join(f.root, 'saved-runtime'), foreign = path.join(f.root, 'foreign-runtime');
  await rename(store.runtime, saved);
  await mkdir(foreign);
  const names = ['status.json', 'tasks.json', 'events.jsonl', 'claims.json'];
  for (const name of names) await copyFile(path.join(saved, name), path.join(foreign, name));
  await writeFile(path.join(foreign, 'sentinel.txt'), 'FOREIGN_UNCHANGED');
  try { await symlink(foreign, store.runtime, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('directory links unavailable'); return; } throw error; }
  const before = await Promise.all([...names, 'sentinel.txt'].map(name => readFile(path.join(foreign, name), 'utf8')));
  const operations = [
    () => store.readStatus(), () => store.readTasks(), () => store.readEvents(), () => store.readClaims(),
    () => store.readSnapshot(), () => store.loadUnlocked(), () => store.withLock(async () => true),
    () => store.initialize(), () => store.persist(state.status, state.tasks, state.events, state.claims),
    () => store.setGoal('redirected'), () => store.claim('redirected', ['src']),
    () => store.recoverStaleLock(), () => store.removeOwnedLock('none')
  ];
  for (const operation of operations) await assert.rejects(operation(), /runtime path.*symlink|runtime path.*escape/i);
  const after = await Promise.all([...names, 'sentinel.txt'].map(name => readFile(path.join(foreign, name), 'utf8')));
  assert.deepEqual(after, before);
});

test('runtime refuses to recreate a validated management root removed after validation', async () => {
  const f = await fixture(), store = new RuntimeStore(await f.context('alpha'));
  const moved = path.join(f.root, 'moved-installation');
  await rename(f.installation, moved);
  await assert.rejects(store.readStatus(), /runtime path.*unavailable/i);
  assert.equal(existsSync(f.installation), false);
  assert.equal(existsSync(path.join(moved, 'projects', 'alpha', 'runtime')), false);
});

test('installation claim stays within selected management space', async () => {
  const f = await fixture(), store = new RuntimeStore(await f.context('alpha'));
  await store.claim('worker-1', ['installation:projects/alpha/tasks']);
  assert.equal((await store.readClaims()).claims[0].scope_kind, 'installation');
  await assert.rejects(store.claim('worker-2', ['installation:projects/beta/tasks']), /scope|project/i);
  await assert.rejects(store.claim('worker-2', ['src', 'installation:projects/alpha/memory']), /mixed|root/i);
  assert.equal((await store.readClaims()).claims.length, 1);
});

test('linked worktrees still conflict on shared installation files', async () => {
  const f = await fixture(), linked = path.join(f.root, 'alpha-linked');
  git(path.join(f.root, 'alpha'), 'worktree', 'add', '-qb', 'linked-fixture', linked);
  const primary = new RuntimeStore(await f.context('alpha'));
  const secondary = new RuntimeStore(await f.context('alpha', linked));
  await primary.claim('worker-1', ['installation:projects/alpha/tasks']);
  await assert.rejects(secondary.claim('worker-2', ['installation:projects/alpha/tasks']), /claim conflict/);
  assert.equal((await primary.readClaims()).claims.length, 1);
});

test('missing binding writes nothing', async () => {
  const f = await fixture(), before = await readdir(f.installation);
  await assert.rejects(runCli(['init', '--project', 'alpha', '--checkout', path.join(f.root, 'alpha'), '--binding', path.join(f.root, 'missing.json')]), /binding/i);
  assert.deepEqual(await readdir(f.installation), before);
});

test('malformed runtime surfaces error', async () => {
  const f = await fixture(), store = new RuntimeStore(await f.context('alpha'));
  await mkdir(store.runtime, { recursive: true });
  await writeFile(store.statusPath, '{bad json');
  await assert.rejects(store.readStatus(), /JSON|position|property|Unexpected/i);
  assert.equal(await readFile(store.statusPath, 'utf8'), '{bad json');
});

test('unknown runtime schema is rejected before a write', async () => {
  const f = await fixture(), store = new RuntimeStore(await f.context('alpha'));
  await mkdir(store.runtime, { recursive: true });
  const stale = '{"schema_version":2,"phase":"unknown"}';
  await writeFile(store.statusPath, stale);
  await assert.rejects(store.claim('worker-1', ['src']), /schema/i);
  assert.equal(await readFile(store.statusPath, 'utf8'), stale);
  assert.equal(existsSync(store.claimsPath), false);
});

test('runtime copied from another project is rejected without rewrite', async () => {
  const f = await fixture(), alpha = new RuntimeStore(await f.context('alpha')), beta = new RuntimeStore(await f.context('beta'));
  await alpha.initialize();
  const copied = await readFile(alpha.statusPath, 'utf8');
  await mkdir(beta.runtime, { recursive: true });
  await writeFile(beta.statusPath, copied);
  await assert.rejects(beta.readStatus(), /project|identity/i);
  assert.equal(await readFile(beta.statusPath, 'utf8'), copied);
  assert.equal(existsSync(beta.tasksPath), false);
});

test('copied event log is rejected by project identity', async () => {
  const f = await fixture(), alpha = new RuntimeStore(await f.context('alpha')), beta = new RuntimeStore(await f.context('beta'));
  await alpha.addEvent('fixture', 'alpha event');
  const copied = await readFile(alpha.eventsPath, 'utf8');
  await mkdir(beta.runtime, { recursive: true });
  await writeFile(beta.eventsPath, copied);
  await assert.rejects(beta.readEvents(), /event.*project|project.*event/i);
  assert.equal(await readFile(beta.eventsPath, 'utf8'), copied);
  assert.equal(existsSync(beta.statusPath), false);
});

test('core context rejects foreign event log on read and initialization without writes', async () => {
  const f = await fixture(), alpha = new RuntimeStore(await f.context('alpha'));
  await alpha.addEvent('fixture', 'alpha event');
  const engineRoot = path.join(f.root, 'core-engine');
  await mkdir(engineRoot);
  const core = new RuntimeStore(RuntimeStore.coreContext({ engineRoot, runtimeRoot: path.join(engineRoot, '.ai', 'runtime') }));
  const copied = await readFile(alpha.eventsPath, 'utf8');
  await mkdir(core.runtime, { recursive: true });
  await writeFile(core.eventsPath, copied);
  await assert.rejects(core.readEvents(), /event project identity mismatch/);
  await assert.rejects(core.initialize(), /event project identity mismatch/);
  assert.equal(await readFile(core.eventsPath, 'utf8'), copied);
  for (const file of [core.statusPath, core.tasksPath, core.claimsPath]) assert.equal(existsSync(file), false);
});

test('initialize rejects malformed events before creating any runtime document', async () => {
  const f = await fixture(), store = new RuntimeStore(await f.context('alpha'));
  await mkdir(store.runtime, { recursive: true });
  await writeFile(store.eventsPath, '{malformed');
  await assert.rejects(store.initialize(), /JSON|event|Unexpected|property|position/i);
  assert.equal(await readFile(store.eventsPath, 'utf8'), '{malformed');
  for (const file of [store.statusPath, store.tasksPath, store.claimsPath]) assert.equal(existsSync(file), false);
});

test('force init cannot overwrite another project runtime', async () => {
  const f = await fixture(), alpha = new RuntimeStore(await f.context('alpha')), beta = new RuntimeStore(await f.context('beta'));
  await alpha.initialize();
  const copied = await readFile(alpha.statusPath, 'utf8');
  await mkdir(beta.runtime, { recursive: true });
  await writeFile(beta.statusPath, copied);
  await assert.rejects(beta.initialize({ force: true }), /force|project/i);
  assert.equal(await readFile(beta.statusPath, 'utf8'), copied);
});

test('task catalog reads selected space only', async () => {
  const f = await fixture();
  for (const id of ['alpha', 'beta']) {
    const dir = path.join(f.installation, 'projects', id, 'tasks');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${id}.md`), `# ${id}`);
  }
  const alpha = await f.context('alpha');
  assert.deepEqual(discoverTaskSpecs(alpha).map(spec => spec.name), ['alpha']);
  assert.equal(discoverCatalog(alpha).agents.length, 0);
});

test('hook writes selected project runtime only', async () => {
  const f = await fixture(), context = await f.context('alpha');
  await handleHook({ hook_event_name: 'SessionStart', cwd: context.checkoutRoot }, context);
  assert.equal((await new RuntimeStore(context).readEvents()).some(event => event.type === 'session_started'), true);
  assert.equal(existsSync(path.join(f.root, 'alpha', '.ai', 'runtime')), false);
  assert.equal(existsSync(path.join(f.installation, 'projects', 'beta', 'runtime')), false);
});

test('hook without context writes nothing', async () => {
  const f = await fixture(), before = await readdir(f.installation);
  await assert.rejects(handleHook({ hook_event_name: 'SessionStart' }), /context/i);
  assert.deepEqual(await readdir(f.installation), before);
});

test('hook outside verified checkout writes nothing', async () => {
  const f = await fixture(), context = await f.context('alpha');
  await assert.rejects(handleHook({ hook_event_name: 'SessionStart', cwd: f.root }, context), /checkout|outside/i);
  assert.equal(existsSync(context.paths.runtime), false);
});
