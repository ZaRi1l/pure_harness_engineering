import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { diagnoseProjectContext, loadProjectContext } from '../scripts/project-context.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
const manifest = id => ({ schemaVersion: 1, id, displayName: id, paths: { tasks: `projects/${id}/tasks`, memory: `projects/${id}/memory`, runtime: `projects/${id}/runtime` }, adapters: {} });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-project-context-'));
  const installation = path.join(root, 'installation');
  const primary = path.join(root, 'primary');
  const linked = path.join(root, 'linked');
  const bindingPath = path.join(root, 'binding.json');
  await mkdir(installation);
  await mkdir(primary);
  git(primary, 'init', '-q');
  git(primary, 'config', 'user.name', 'Fixture');
  git(primary, 'config', 'user.email', 'fixture@example.test');
  await writeFile(path.join(primary, 'README'), 'fixture');
  git(primary, 'add', 'README');
  git(primary, 'commit', '-qm', 'fixture');
  git(primary, 'worktree', 'add', '-qb', 'linked-fixture', linked);
  await mkdir(path.join(primary, 'harness-adapter'));
  await writeFile(path.join(primary, 'harness-adapter', 'project.json'), JSON.stringify(manifest('alpha')));
  const registration = { projectId: 'alpha', harnessRoot: installation, projectRoot: primary };
  await writeFile(bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [registration] }));
  return { root, installation, primary, linked, bindingPath, registration };
}

test('loads primary checkout', async () => {
  const f = await fixture();
  const context = await loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' });
  assert.equal(context.projectId, 'alpha');
  assert.equal(context.projectRoot, await realpath(f.primary));
  assert.equal(context.checkoutRoot, await realpath(f.primary));
  assert.equal(context.harnessRoot, await realpath(f.installation));
  assert.equal(context.paths.tasks, path.join(await realpath(f.installation), 'projects/alpha/tasks'));
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.paths), true);
});

test('loads verified linked worktree', async () => {
  const f = await fixture();
  const context = await loadProjectContext({ checkoutRoot: f.linked, bindingPath: f.bindingPath, projectId: 'alpha' });
  assert.equal(context.checkoutRoot, await realpath(f.linked));
  assert.equal(context.paths.runtime, path.join(await realpath(f.installation), 'projects/alpha/runtime'));
});

test('freezes nested adapter data in the returned context', async () => {
  const f = await fixture();
  const declaration = manifest('alpha');
  declaration.adapters.sample = { type: 'sample', options: { labels: ['first'] } };
  await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify(declaration));
  const context = await loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' });
  assert.equal(Object.isFrozen(context.adapters.sample.options), true);
  assert.equal(Object.isFrozen(context.adapters.sample.options.labels), true);
  assert.throws(() => context.adapters.sample.options.labels.push('second'), TypeError);
});

test('rejects absent binding without writes', async () => {
  const f = await fixture();
  const before = await readdir(f.root);
  const missing = path.join(f.root, 'missing.json');
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: missing, projectId: 'alpha' }), /binding/i);
  assert.deepEqual(await readdir(f.root), before);
});

test('rejects stale binding', async () => {
  const f = await fixture();
  await writeFile(f.bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [{ ...f.registration, projectRoot: path.join(f.root, 'gone') }] }));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /projectRoot/i);
});

test('rejects duplicate canonical registrations', async () => {
  const f = await fixture();
  await writeFile(f.bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [f.registration, { ...f.registration, projectRoot: path.join(f.root, '.', 'primary') }] }));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /duplicate|ambiguous/i);
});

test('rejects another project aliasing the same canonical checkout', async () => {
  const f = await fixture();
  await writeFile(f.bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [f.registration, { ...f.registration, projectId: 'beta' }] }));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /duplicate|alias|ambiguous/i);
});

test('rejects mismatched worktree backpointer', async () => {
  const f = await fixture();
  const dotGit = await readFile(path.join(f.linked, '.git'), 'utf8');
  const gitdir = path.resolve(f.linked, dotGit.trim().slice('gitdir:'.length).trim());
  await writeFile(path.join(gitdir, 'gitdir'), path.join(f.primary, '.git') + '\n');
  await assert.rejects(loadProjectContext({ checkoutRoot: f.linked, bindingPath: f.bindingPath, projectId: 'alpha' }), /backpointer|worktree/i);
});

test('rejects nested or symlink escape', async () => {
  const f = await fixture();
  const escaped = manifest('alpha');
  escaped.paths.runtime = '../outside';
  await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify(escaped));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /runtime|path/i);
  escaped.paths.runtime = 'projects/alpha/runtime';
  await mkdir(path.join(f.installation, 'projects', 'alpha'), { recursive: true });
  try {
    await symlink(f.root, path.join(f.installation, 'projects', 'alpha', 'runtime'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify(escaped));
    await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /runtime|path/i);
  } catch (error) { if (error.code !== 'EPERM') throw error; }
});

test('selects only requested project', async () => {
  const f = await fixture();
  const beta = path.join(f.root, 'beta');
  await mkdir(path.join(beta, 'harness-adapter'), { recursive: true });
  git(beta, 'init', '-q');
  await writeFile(path.join(beta, 'harness-adapter', 'project.json'), JSON.stringify(manifest('beta')));
  await writeFile(f.bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [f.registration, { projectId: 'beta', harnessRoot: f.installation, projectRoot: beta }] }));
  const context = await loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' });
  assert.doesNotMatch(JSON.stringify(context), /beta/i);
  assert.match(context.paths.memory, /alpha/);
});

test('rejects management paths into another project space', async () => {
  const f = await fixture();
  const escaped = manifest('alpha');
  escaped.paths.memory = 'projects/beta/memory';
  await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify(escaped));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /memory|path/i);
});

test('rejects overlapping management directories', async () => {
  const f = await fixture();
  const declaration = manifest('alpha');
  declaration.paths.memory = 'projects/alpha/tasks/memory';
  await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify(declaration));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /manifest.paths|overlap/i);
});

test('rejects selected project symlink into another project space', async () => {
  const f = await fixture();
  const projects = path.join(f.installation, 'projects');
  await mkdir(path.join(projects, 'beta', 'memory'), { recursive: true });
  try { await symlink(path.join(projects, 'beta'), path.join(projects, 'alpha'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return; throw error; }
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /path|project/i);
});

test('rejects management leaf symlink into another project space', async () => {
  const f = await fixture();
  const projects = path.join(f.installation, 'projects');
  await mkdir(path.join(projects, 'alpha'), { recursive: true });
  await mkdir(path.join(projects, 'beta', 'memory'), { recursive: true });
  try { await symlink(path.join(projects, 'beta', 'memory'), path.join(projects, 'alpha', 'memory'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return; throw error; }
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /memory|path/i);
});

test('rejects primary checkout with unrelated empty Git directory', async () => {
  const f = await fixture();
  const fake = path.join(f.root, 'fake');
  await mkdir(path.join(fake, '.git'), { recursive: true });
  await mkdir(path.join(fake, 'harness-adapter'));
  await writeFile(path.join(fake, 'harness-adapter', 'project.json'), JSON.stringify(manifest('alpha')));
  await writeFile(f.bindingPath, JSON.stringify({ schemaVersion: 1, registrations: [{ ...f.registration, projectRoot: fake }] }));
  await assert.rejects(loadProjectContext({ checkoutRoot: fake, bindingPath: f.bindingPath, projectId: 'alpha' }), /git|projectRoot/i);
});

test('rejects empty adapter type', async () => {
  const f = await fixture();
  const invalid = manifest('alpha');
  invalid.adapters.goal = { type: '' };
  await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify(invalid));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /adapter/i);
});

test('rejects undeclared top-level manifest fields', async () => {
  const f = await fixture();
  await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify({ ...manifest('alpha'), privateRoot: 'other' }));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /manifest/i);
});

test('rejects undeclared management path fields', async () => {
  const f = await fixture();
  const declaration = manifest('alpha');
  declaration.paths.backup = 'projects/alpha/backup';
  await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify(declaration));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /manifest.paths/i);
});

test('rejects array-shaped management paths', async () => {
  const f = await fixture();
  const declaration = manifest('alpha');
  declaration.paths = ['projects/alpha/tasks', 'projects/alpha/memory', 'projects/alpha/runtime'];
  await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify(declaration));
  const diagnostic = await diagnoseProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' });
  assert.equal(diagnostic.code, 'INVALID_MANIFEST');
  assert.match(diagnostic.message, /manifest.paths/i);
});

test('rejects invalid manifest version', async () => {
  const f = await fixture();
  await writeFile(path.join(f.primary, 'harness-adapter', 'project.json'), JSON.stringify({ ...manifest('alpha'), schemaVersion: 2 }));
  await assert.rejects(loadProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' }), /manifest.*version/i);
});

test('redacts local binding contents', async () => {
  const f = await fixture();
  const secret = 'PRIVATE_BINDING_PAYLOAD_123';
  await writeFile(f.bindingPath, `{broken ${secret}`);
  const diagnostic = await diagnoseProjectContext({ checkoutRoot: f.primary, bindingPath: f.bindingPath, projectId: 'alpha' });
  assert.equal(diagnostic.ok, false);
  assert.ok(diagnostic.code);
  assert.ok(diagnostic.message.length <= 200);
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_BINDING|harness-project-context-/);
});
