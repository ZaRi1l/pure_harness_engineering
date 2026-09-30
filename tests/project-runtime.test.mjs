import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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

test('installation claim stays within selected management space', async () => {
  const f = await fixture(), store = new RuntimeStore(await f.context('alpha'));
  await store.claim('worker-1', ['installation:projects/alpha/tasks']);
  assert.equal((await store.readClaims()).claims[0].scope_kind, 'installation');
  await assert.rejects(store.claim('worker-2', ['installation:projects/beta/tasks']), /scope|project/i);
  await assert.rejects(store.claim('worker-2', ['src', 'installation:projects/alpha/memory']), /mixed|root/i);
  assert.equal((await store.readClaims()).claims.length, 1);
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
