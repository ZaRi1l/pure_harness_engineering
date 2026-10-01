import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

import { createPreviewServer } from '../scripts/preview-server.mjs';
import { RuntimeStore } from '../scripts/runtime-state.mjs';
import { discoverCatalog, legacyCatalogFixture } from '../scripts/catalog.mjs';
import { loadProjectContext } from '../scripts/project-context.mjs';

async function projectPreviewFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-project-preview-'));
  const installation = path.join(root, 'installation');
  await mkdir(path.join(installation, 'preview'), { recursive: true });
  await writeFile(path.join(installation, 'preview', 'index.html'), '<h1>Generic dashboard</h1>');
  const registrations = [];
  for (const id of ['alpha', 'beta']) {
    const projectRoot = path.join(root, id);
    await mkdir(path.join(projectRoot, 'harness-adapter'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: projectRoot });
    await writeFile(path.join(projectRoot, 'harness-adapter', 'project.json'), JSON.stringify({ schemaVersion: 1, id, displayName: id, paths: { tasks: `projects/${id}/tasks`, memory: `projects/${id}/memory`, runtime: `projects/${id}/runtime` }, adapters: {} }));
    await mkdir(path.join(installation, 'projects', id, 'tasks'), { recursive: true });
    await writeFile(path.join(installation, 'projects', id, 'tasks', `${id}.md`), `# ${id} private plan`);
    registrations.push({ projectId: id, harnessRoot: installation, projectRoot });
  }
  const bindingPath = path.join(root, 'binding.json');
  await writeFile(bindingPath, JSON.stringify({ schemaVersion: 1, registrations }));
  const context = id => loadProjectContext({ projectId: id, checkoutRoot: path.join(root, id), bindingPath });
  return { root, installation, bindingPath, context, alpha: path.join(root, 'alpha'), beta: path.join(root, 'beta') };
}

async function listening(t, context, options) {
  const server = await createPreviewServer(context, '127.0.0.1', options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves dashboard, task specs, and runtime JSON while rejecting traversal', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-preview-'));
  await mkdir(path.join(root, 'preview'));
  await copyFile(path.resolve('preview/index.html'), path.join(root, 'preview/index.html'));
  await copyFile(path.resolve('preview/artifact-tabs.js'), path.join(root, 'preview/artifact-tabs.js'));
  await copyFile(path.resolve('preview/agent-network.js'), path.join(root, 'preview/agent-network.js'));
  await copyFile(path.resolve('preview/preferences.js'), path.join(root, 'preview/preferences.js'));
  await copyFile(path.resolve('preview/dashboard.js'), path.join(root, 'preview/dashboard.js'));
  await mkdir(path.join(root, '.ai', 'tasks'), { recursive: true });
  await writeFile(path.join(root, '.ai', 'tasks', 'example.md'), '# Example task spec\n\nPlan content.');
  await RuntimeStore.legacyFixture(root).initialize();
  const server = await createPreviewServer(legacyCatalogFixture(root), '127.0.0.1', 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const artifactModuleResponse = await fetch(`http://127.0.0.1:${port}/preview/artifact-tabs.js`);
  const artifactModule = await artifactModuleResponse.text();
  const networkResponse = await fetch(`http://127.0.0.1:${port}/preview/agent-network.js`);
  const preferencesResponse = await fetch(`http://127.0.0.1:${port}/preview/preferences.js`);
  const preferencesSource = await preferencesResponse.text();
  const dashboardResponse = await fetch(`http://127.0.0.1:${port}/preview/dashboard.js`);
  const dashboardSource = await dashboardResponse.text();
  const networkSource = await networkResponse.text();
  const status = await (await fetch(`http://127.0.0.1:${port}/runtime/status`)).json();
  const legacyTelemetry = await fetch(`http://127.0.0.1:${port}/runtime/telemetry`);
  const snapshot = await (await fetch(`http://127.0.0.1:${port}/runtime/snapshot`)).json();
  const catalogResponse = await fetch(`http://127.0.0.1:${port}/runtime/catalog`), catalog = await catalogResponse.json();
  const taskSpecsResponse = await fetch(`http://127.0.0.1:${port}/runtime/task-specs`), taskSpecs = await taskSpecsResponse.json();
  const traversal = await fetch(`http://127.0.0.1:${port}/preview/%2e%2e/secret.txt`);
  assert.match(preferencesSource, /Signal Timeline/);
  assert.match(preferencesSource, /Reported Running Agents/);
  assert.match(dashboardSource, /id="agent-network"/);
  assert.match(html, /<script src="\/preview\/preferences\.js"><\/script>\s*<script src="\/preview\/agent-network\.js"><\/script>\s*<script type="module" src="\/preview\/dashboard\.js"><\/script>/);
  assert.match(html, /Preview Lab/);
  assert.match(html, /Agent Catalog/);
  assert.match(html, /Skill Catalog/);
  assert.match(html, /Harness Guide/);
  assert.match(preferencesSource, /Plan \/ Task Specs/);
  assert.match(preferencesSource, /UI Artifacts/);
  assert.match(dashboardSource, /renderArtifactTabs/);
  assert.match(html, /75vh/);
  assert.equal(artifactModuleResponse.status, 200);
  assert.match(artifactModuleResponse.headers.get('content-type'), /text\/javascript/);
  assert.match(artifactModule, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.match(artifactModule, /Open separately/);
  assert.equal(networkResponse.status, 200);
  assert.equal(preferencesResponse.status, 200);
  assert.match(preferencesResponse.headers.get('content-type') || '', /text\/javascript/);
  assert.match(preferencesSource, /PreviewPreferences/);
  assert.match(html, /id="preview-preferences"/);
  assert.equal(dashboardResponse.status, 200);
  assert.match(dashboardResponse.headers.get('content-type') || '', /text\/javascript/);
  assert.match(networkResponse.headers.get('content-type'), /text\/javascript/);
  assert.match(networkSource, /AgentSignalNetwork/);
  assert.match(preferencesSource, /Fallback: /);
  assert.match(dashboardSource, /gpt-5\.6-/);
  assert.match(preferencesSource, /Watchdog Warnings/);
  assert.match(preferencesSource, /npm run preview:live/);
  assert.match(dashboardSource, /host\.replaceChildren\(\)/);
  assert.equal(catalogResponse.status, 200);
  assert.ok(Array.isArray(catalog.agents));
  assert.ok(Array.isArray(catalog.skills));
  assert.equal(taskSpecsResponse.status, 200);
  assert.ok(Array.isArray(taskSpecs.taskSpecs));
  assert.equal(taskSpecs.taskSpecs[0].path, '.ai/tasks/example.md');
  assert.equal(status.phase, 'idle');
  assert.equal(legacyTelemetry.status, 200);
  assert.equal(legacyTelemetry.headers.get('cache-control'), 'no-store');
  assert.equal((await legacyTelemetry.json()).status, 'missing');
  assert.equal(snapshot.status.task_counts.total, snapshot.tasks.tasks.length);
  assert.ok([403, 404].includes(traversal.status));
});

test('live dashboard reuses its network controller during polling and destroys it on navigation', async () => {
  const moduleSource = await readFile(path.resolve('preview/dashboard.js'), 'utf8');
  const nodes = new Map();
  const element = () => ({
    children: [], classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { if (this === nodes.get('#app')) for (const key of [...nodes.keys()]) if (!['#app', '#preview-preferences', '#app-tagline', '#sidebar-note'].includes(key)) nodes.delete(key); this.children = children; },
    set innerHTML(value) { for (const [, id] of value.matchAll(/id="([^"]+)"/g)) nodes.set(`#${id}`, element()); },
    set textContent(value) { this.text = value; },
    get textContent() { return this.text ?? ''; }
  });
  nodes.set('#app', element());
  nodes.set('#preview-preferences', element());
  nodes.set('#app-tagline', element());
  nodes.set('#sidebar-note', element());
  const first = { status: { active_agents: [], agents: [{ id: 'worker-1', role: 'worker' }], signals: [{ id: 'signal-1', from: 'main', to: 'worker-1', kind: 'delegate' }], verification: { status: 'passed' }, warnings: [], blockers: [], artifact_preview_links: [] }, tasks: { tasks: [] }, claims: { claims: [] }, events: [] };
  const second = structuredClone(first);
  second.status.signals.push({ id: 'signal-2', from: 'worker-1', to: 'main', kind: 'result' });
  const snapshots = [first, second];
  const agents = [{ id: 'worker', model: 'gpt-6-sol' }];
  const controllers = [];
  const taskEditors = [];
  const telemetryPanels = [];
  const listeners = {};
  let preferenceListener;
  let refresh;
  const context = {
    renderArtifactTabs: () => ({}),
    document: { querySelector: selector => nodes.get(selector), querySelectorAll: () => [], createElement: element },
    location: { hash: '#dashboard' }, addEventListener: (name, callback) => { listeners[name] = callback; }, setInterval: callback => { refresh = callback; },
    fetch: async url => ({ json: async () => url === '/runtime/catalog' ? { agents, skills: [] } : url === '/runtime/tasks' ? { tasks: [], write_token: null } : snapshots.shift() ?? second }),
    createTaskEditor: host => { const editor = { host, updates: [], destroyCount: 0, update(tasks, token) { this.updates.push({ tasks, token }); }, destroy() { this.destroyCount++; } }; taskEditors.push(editor); return editor; },
    createTelemetryPanel: host => { const panel = { host, refreshCount: 0, destroyCount: 0, refresh() { this.refreshCount++; }, rerender() {}, destroy() { this.destroyCount++; } }; telemetryPanels.push(panel); return panel; },
    PreviewPreferences: { create: () => ({ locale: 'en', t: key => key, mount() {}, subscribe(callback) { preferenceListener = callback; } }) },
    AgentSignalNetwork: { create: (host, options = {}) => { const controller = { host, options, state: options.initialState || { mode: 'live', filter: 'all', taskId: '', selection: null, transform: { x: 0, y: 0, scale: 1 } }, updates: [], destroyCount: 0, update(snapshot, catalog) { this.updates.push({ snapshot, catalog }); }, getState() { return this.state; }, destroy() { this.destroyCount++; } }; controllers.push(controller); return controller; } }
  };
  runInNewContext(moduleSource.replace(/^import .*?;\s*/gm, ''), context);
  await new Promise(resolve => setImmediate(resolve));
  const retained = controllers.at(-1);
  const beforeRefresh = controllers.length;
  const telemetryBeforeRefresh = telemetryPanels[0].refreshCount;
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controllers.length, beforeRefresh);
  assert.equal(retained.host, nodes.get('#agent-network'));
  assert.equal(retained.updates.at(-1).snapshot, second);
  assert.equal(retained.updates.at(-1).catalog.agents[0].id, 'worker');
  assert.equal(taskEditors.length, 1);
  assert.equal(telemetryPanels.length, 1);
  assert.equal(telemetryPanels[0].refreshCount, telemetryBeforeRefresh + 1);
  assert.equal(taskEditors[0].updates.at(-1).token, null);
  retained.state = { mode: 'history', filter: 'failures', taskId: 'ui', selection: { type: 'node', id: 'worker-1' }, transform: { x: 12, y: 8, scale: 1.2 } };
  preferenceListener({ locale: 'ko' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controllers.at(-1), retained, 'language change keeps the live Dashboard controller');
  assert.equal(retained.destroyCount, 0);
  context.location.hash = '#preview';
  listeners.hashchange();
  assert.equal(retained.destroyCount, 1, 'the detached Dashboard controller is destroyed synchronously');
  assert.equal(taskEditors[0].destroyCount, 1);
  context.location.hash = '#dashboard';
  listeners.hashchange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controllers.length, beforeRefresh + 1);
  assert.notEqual(controllers.at(-1), retained);
  assert.equal(controllers.at(-1).host, nodes.get('#agent-network'));
  assert.equal(taskEditors.length, 2);
});

test('dashboard buckets reported agents by start age including exact hour, missing, and future starts and shows signal time', async () => {
  const source = await readFile(path.resolve('preview/dashboard.js'), 'utf8');
  const nodes = new Map();
  const element = () => ({
    children: [], className: '', classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    set innerHTML(value) { for (const [, id] of value.matchAll(/id="([^"]+)"/g)) nodes.set(`#${id}`, element()); },
    set textContent(value) { this.text = value; this.children = []; },
    get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); }
  });
  for (const selector of ['#app', '#preview-preferences', '#app-tagline', '#sidebar-note']) nodes.set(selector, element());
  const snapshot = {
    status: {
      active_agents: [
        { id: 'recent', role: 'worker', current_task: 'recent', started_at: '2026-09-25T11:30:00Z' },
        { id: 'boundary', role: 'worker', current_task: 'boundary', started_at: '2026-09-25T11:00:00Z' },
        { id: 'missing', role: 'worker', current_task: 'missing' },
        { id: 'future', role: 'worker', current_task: 'future', started_at: '2026-09-25T12:00:01Z' }
      ], signals: [{ time: '2026-09-25T11:59:00Z', from: 'main', to: 'recent', kind: 'delegate', summary: 'ready' }],
      verification: { status: 'passed' }, warnings: [], blockers: [], artifact_preview_links: []
    }, tasks: { tasks: [] }, claims: { claims: [] }, events: []
  };
  const FixedDate = class extends Date { static now() { return Date.parse('2026-09-25T12:00:00Z'); } };
  runInNewContext(source.replace(/^import .*?;\s*/gm, ''), {
    renderArtifactTabs: () => ({}),
    Date: FixedDate, document: { querySelector: selector => nodes.get(selector), querySelectorAll: () => [], createElement: element },
    location: { hash: '#dashboard' }, addEventListener() {}, setInterval() {},
    fetch: async url => ({ json: async () => url === '/runtime/catalog' ? { agents: [], skills: [] } : url === '/runtime/tasks' ? { tasks: [], write_token: null } : snapshot }),
    createTaskEditor: () => ({ update() {}, destroy() {} }),
    createTelemetryPanel: () => ({ refresh() {}, rerender() {}, destroy() {} }),
    PreviewPreferences: { create: () => ({ locale: 'en', t: (key, values = {}) => ({
      'dashboard.futureStart': 'future start',
      'dashboard.reportedRunning': 'reported running', 'dashboard.startedRecent': 'started/resumed within past hour; liveness unconfirmed',
      'dashboard.startedOutside': 'outside past hour or unknown start; liveness unconfirmed',
      'dashboard.agentCount': `Reported running: ${values.reported}; recent: ${values.recent}; outside: ${values.outside}`
    }[key] ?? key), mount() {}, subscribe() {} }) },
    AgentSignalNetwork: { create: () => ({ update() {}, destroy() {} }) }
  });
  await new Promise(resolve => setImmediate(resolve));
  const items = nodes.get('#agents').children[0].children.map(child => child.textContent);
  assert.equal(items.length, 4);
  assert.match(items[0], /recent.*30m.*reported running.*within past hour/);
  assert.match(items[1], /boundary.*60m.*reported running.*within past hour/);
  assert.match(items[2], /missing.*unknown.*outside past hour/);
  assert.match(items[3], /future.*future start.*outside past hour/);
  assert.doesNotMatch(items[3], /0m/);
  assert.match(nodes.get('#agents').children[1].textContent, /Reported running: 4; recent: 2; outside: 2/);
  assert.match(nodes.get('#signals').children[0].children[0].textContent, /^2026-09-25T11:59:00Z — main → recent/);
});

test('runtimeDir changes only live runtime data and keeps repository catalog and Task Specs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-preview-root-'));
  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'pure-preview-runtime-'));
  await mkdir(path.join(root, 'preview'));
  await mkdir(path.join(root, '.ai', 'tasks'), { recursive: true });
  await copyFile(path.resolve('preview/index.html'), path.join(root, 'preview/index.html'));
  await writeFile(path.join(root, '.ai', 'tasks', 'example.md'), '# Source task');
  const store = RuntimeStore.legacyFixture(root, { runtimeDir });
  await store.initialize();
  await store.setGoal('Injected runtime');
  const server = await createPreviewServer(legacyCatalogFixture(root), '127.0.0.1', { runtimeDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = await (await fetch(`${base}/runtime/snapshot`)).json();
  const taskSpecs = await (await fetch(`${base}/runtime/task-specs`)).json();
  const page = await (await fetch(base)).text();
  assert.equal(snapshot.status.current_goal, 'Injected runtime');
  assert.equal(taskSpecs.taskSpecs[0].title, 'Source task');
  assert.match(page, /Pure Harness/);
});

test('catalog exposes read-only source and role policy metadata', () => {
  const catalog = discoverCatalog(legacyCatalogFixture(path.resolve('.')));
  const planner = catalog.agents.find(agent => agent.id === 'planner');
  const testing = catalog.skills.find(skill => skill.id === 'testing');
  assert.equal(planner.model, 'gpt-6-sol');
  assert.equal(planner.reasoning, 'high');
  assert.match(planner.source, /developer_instructions/);
  assert.match(testing.source, /name: testing/);
});

test('catalog route denies role config traversal while preserving a normal role', async t => {
  const f = await projectPreviewFixture();
  const agentDir = path.join(f.installation, '.codex', 'agents');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(f.installation, 'private.txt'), 'PRIVATE_TRAVERSAL_BYTES');
  await writeFile(path.join(agentDir, 'safe.toml'), 'name = "Safe role"\nmodel = "safe-model"\n');
  await writeFile(path.join(f.installation, '.codex', 'config.toml'), '[agents.safe]\nconfig_file = "./agents/safe.toml"\n[agents.escaped]\nconfig_file = "../private.txt"\n');
  const base = await listening(t, await f.context('alpha'));
  const response = await fetch(`${base}/runtime/catalog`);
  const catalog = await response.json();
  assert.equal(response.status, 200);
  assert.equal(catalog.agents.find(agent => agent.id === 'safe').source, 'name = "Safe role"\nmodel = "safe-model"\n');
  assert.equal(catalog.agents.find(agent => agent.id === 'escaped').source, '');
  assert.doesNotMatch(JSON.stringify(catalog), /PRIVATE_TRAVERSAL_BYTES/);
});

test('catalog route denies a linked role directory outside the role directory', async t => {
  const f = await projectPreviewFixture();
  const agentDir = path.join(f.installation, '.codex', 'agents');
  await mkdir(agentDir, { recursive: true });
  const privateDir = path.join(f.installation, 'private-roles');
  await mkdir(privateDir);
  const privateFile = path.join(privateDir, 'secret.toml');
  await writeFile(privateFile, 'PRIVATE_SYMLINK_BYTES');
  try { await symlink(privateDir, path.join(agentDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('directory links unavailable'); return; } throw error; }
  await writeFile(path.join(f.installation, '.codex', 'config.toml'), '[agents.escaped]\nconfig_file = "./agents/linked/secret.toml"\n');
  const base = await listening(t, await f.context('alpha'));
  const response = await fetch(`${base}/runtime/catalog`);
  const catalog = await response.json();
  assert.equal(response.status, 200);
  assert.equal(catalog.agents.find(agent => agent.id === 'escaped').source, '');
  assert.doesNotMatch(JSON.stringify(catalog), /PRIVATE_SYMLINK_BYTES/);
});

test('catalog route refuses a replaced skills-root junction while preserving normal skills', async t => {
  const f = await projectPreviewFixture();
  const skillRoot = path.join(f.installation, '.agents', 'skills');
  await mkdir(path.join(skillRoot, 'safe'), { recursive: true });
  await writeFile(path.join(skillRoot, 'safe', 'SKILL.md'), '---\nname: safe\ndescription: Public skill\n---\nSAFE_SKILL_SOURCE');
  const base = await listening(t, await f.context('alpha'));
  const ordinary = await (await fetch(`${base}/runtime/catalog`)).json();
  assert.match(ordinary.skills.find(skill => skill.id === 'safe').source, /SAFE_SKILL_SOURCE/);

  const foreign = path.join(f.root, 'foreign-skills');
  await mkdir(path.join(foreign, 'escaped'), { recursive: true });
  await writeFile(path.join(foreign, 'escaped', 'SKILL.md'), '---\nname: escaped\ndescription: Private skill\n---\nPRIVATE_SKILL_SOURCE');
  await rename(skillRoot, path.join(f.root, 'saved-skills'));
  try { await symlink(foreign, skillRoot, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('directory links unavailable'); return; } throw error; }
  const response = await fetch(`${base}/runtime/catalog`);
  const catalog = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(catalog.skills, []);
  assert.doesNotMatch(JSON.stringify(catalog), /PRIVATE_SKILL_SOURCE/);
});

test('staged setup guide advertises backed commands with selected-project context', async () => {
  const scripts = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).scripts;
  const context = { globalThis: {}, document: { documentElement: { dataset: {}, setAttribute() {} } } };
  runInNewContext(await readFile(path.resolve('preview/preferences.js'), 'utf8'), context);
  const guide = context.globalThis.PreviewPreferences.create(context.document, { storage: null }).t('guide.body');
  const commands = [...guide.matchAll(/npm(?: run)? [\w:-]+/g)].map(match => match[0]);
  for (const command of ['npm test', 'npm run self-check', 'npm run status', 'npm run preview:live', 'npm run preview']) {
    assert.ok(commands.includes(command), `guide omits ${command}`);
  }
  for (const command of commands) assert.ok(scripts[command.replace(/^npm(?: run)? /, '')]);
  assert.match(guide, /npm run preview:live -- --project .* --checkout .* --binding /);
  assert.match(guide, /npm run preview -- --project .* --checkout .* --binding /);
  assert.doesNotMatch(guide, /Remove-Item|Get-ChildItem|\.ai\/tasks\/\*\.md/i);
});

test('rejects preview links that resolve outside preview root', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-preview-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'pure-preview-outside-'));
  await mkdir(path.join(root, 'preview'));
  await copyFile(path.resolve('preview/index.html'), path.join(root, 'preview/index.html'));
  await writeFile(path.join(outside, 'secret.txt'), 'outside');
  try {
    await symlink(outside, path.join(root, 'preview', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('Creating a test link requires unavailable Windows privileges');
      return;
    }
    throw error;
  }
  await RuntimeStore.legacyFixture(root).initialize();
  const server = await createPreviewServer(legacyCatalogFixture(root), '127.0.0.1', 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/preview/linked/secret.txt`);
  assert.equal(response.status, 403);
});

test('dashboard reads selected project', async t => {
  const f = await projectPreviewFixture();
  const alpha = await f.context('alpha'), beta = await f.context('beta');
  await new RuntimeStore(alpha).setGoal('alpha-only goal');
  await new RuntimeStore(beta).setGoal('beta-only goal');
  const base = await listening(t, alpha);
  const snapshot = await (await fetch(`${base}/runtime/snapshot`)).json();
  const specs = await (await fetch(`${base}/runtime/task-specs`)).json();
  const page = await (await fetch(base)).text();
  assert.equal(snapshot.status.current_goal, 'alpha-only goal');
  assert.deepEqual(specs.taskSpecs.map(spec => spec.title), ['alpha private plan']);
  assert.match(page, /Preview Lab/);
});

test('telemetry import requires explicit context and regular absolute files', async () => {
  const f = await projectPreviewFixture();
  const file = path.join(f.root, 'private-rollout.jsonl');
  await writeFile(file, '');
  const run = args => spawnSync(process.execPath, ['scripts/import-telemetry.mjs', ...args], { cwd: path.resolve('.'), encoding: 'utf8' });
  const context = ['--project', 'alpha', '--checkout', f.alpha, '--binding', f.bindingPath];
  assert.notEqual(run([...context]).status, 0);
  assert.notEqual(run(['--file', file]).status, 0);
  assert.notEqual(run([...context, '--file', path.relative(process.cwd(), file)]).status, 0);
  assert.notEqual(run([...context, '--file', f.root]).status, 0);
  assert.equal(run([...context, '--file', file]).status, 0);
});

test('telemetry import is atomic, idempotent, missing on empty, and project isolated', async t => {
  const f = await projectPreviewFixture();
  const alpha = await f.context('alpha'), beta = await f.context('beta');
  const file = path.join(f.root, 'PRIVATE_SOURCE_PATH.jsonl');
  const secondFile = path.join(f.root, 'PRIVATE_SECOND_PATH.jsonl');
  const bad = path.join(f.root, 'bad.jsonl');
  const empty = path.join(f.root, 'empty.jsonl');
  const sentinel = 'PRIVATE_TOOL_BODY_SENTINEL';
  const promptSentinel = 'PRIVATE_PROMPT_SENTINEL';
  const line = (type, payload) => JSON.stringify({ timestamp: '2026-10-01T00:00:00.000Z', type, payload });
  await writeFile(file, [line('session_meta', { id: 'thread-1' }), line('response_item', { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: promptSentinel }), line('response_item', { type: 'function_call_output', call_id: 'c1', output: sentinel }), line('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 4, output_tokens: 2, cached_input_tokens: 1, reasoning_output_tokens: 1 } } })].join('\n'));
  await writeFile(secondFile, [line('session_meta', { id: 'thread-2' }), line('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0, reasoning_output_tokens: 0 } } })].join('\n'));
  await writeFile(bad, `${line('session_meta', { id: 'thread-1' })}\n{${sentinel}`);
  await writeFile(empty, '');
  const run = (id, ...sources) => spawnSync(process.execPath, ['scripts/import-telemetry.mjs', '--project', id, '--checkout', f[id], '--binding', f.bindingPath, ...sources.flatMap(source => ['--file', source])], { cwd: path.resolve('.'), encoding: 'utf8' });
  assert.equal(run('alpha', file, secondFile).status, 0);
  const store = new RuntimeStore(alpha);
  const telemetryPath = path.join(alpha.paths.runtime, 'telemetry.json');
  const first = await readFile(telemetryPath);
  assert.equal((await store.readTelemetry()).totals.processed, 8);
  assert.deepEqual((await store.readTelemetry()).largest_tool_outputs.map(row => [row.tool, row.count, row.total_bytes]), [['exec_command', 1, 26]]);
  assert.equal(run('alpha', file, secondFile).status, 0);
  assert.deepEqual(await readFile(telemetryPath), first);
  const failed = run('alpha', bad);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /line 2/i);
  assert.doesNotMatch(failed.stderr, /PRIVATE|bad\.jsonl|\{PRIVATE/);
  assert.deepEqual(await readFile(telemetryPath), first);
  assert.equal((await new RuntimeStore(beta).readTelemetry()).status, 'missing');
  const base = await listening(t, alpha);
  const response = await fetch(`${base}/runtime/telemetry`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.equal(JSON.parse(body).totals.processed, 8);
  assert.doesNotMatch(body, /PRIVATE_SOURCE_PATH|PRIVATE_SECOND_PATH|PRIVATE_TOOL_BODY_SENTINEL|PRIVATE_PROMPT_SENTINEL/);
  const snapshotBody = await (await fetch(`${base}/runtime/snapshot`)).text();
  assert.equal(JSON.parse(snapshotBody).telemetry.totals.processed, 8);
  assert.doesNotMatch(snapshotBody, /PRIVATE_SOURCE_PATH|PRIVATE_SECOND_PATH|PRIVATE_TOOL_BODY_SENTINEL|PRIVATE_PROMPT_SENTINEL/);
  assert.equal((await fetch(`${base}/runtime/telemetry`, { method: 'POST', body: sentinel })).status, 405);
  assert.equal((await fetch(`${base}/runtime/telemetry`, { method: 'PUT', body: sentinel })).status, 405);
  assert.doesNotMatch((await readFile(telemetryPath, 'utf8')) + JSON.stringify(await store.readEvents()), /PRIVATE_SOURCE_PATH|PRIVATE_SECOND_PATH|PRIVATE_TOOL_BODY_SENTINEL|PRIVATE_PROMPT_SENTINEL/);
  assert.equal(run('alpha', empty).status, 0);
  assert.equal((await store.readTelemetry()).status, 'missing');
  assert.equal((await new RuntimeStore(beta).readTelemetry()).status, 'missing');
});

test('telemetry import rejects another project stamp without replacing its bytes', async () => {
  const f = await projectPreviewFixture();
  const alpha = await f.context('alpha'), beta = await f.context('beta');
  const file = path.join(f.root, 'source.jsonl');
  await writeFile(file, `${JSON.stringify({ timestamp: '2026-10-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'thread-1' } })}\n`);
  const wrongStamp = Buffer.from(JSON.stringify({ schema_version: 1, project_id: 'alpha', status: 'missing' }));
  await mkdir(beta.paths.runtime, { recursive: true });
  const telemetryPath = path.join(beta.paths.runtime, 'telemetry.json');
  await writeFile(telemetryPath, wrongStamp);
  const run = spawnSync(process.execPath, ['scripts/import-telemetry.mjs', '--project', 'beta', '--checkout', f.beta, '--binding', f.bindingPath, '--file', file], { cwd: path.resolve('.'), encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.equal(run.stderr.trim(), 'invalid_telemetry');
  assert.deepEqual(await readFile(telemetryPath), wrongStamp);
  assert.equal((await new RuntimeStore(alpha).readTelemetry()).status, 'missing');
  await assert.rejects(createPreviewServer(alpha, '0.0.0.0'), /localhost/);
});

test('omitted asset root serves module-owned preview instead of malicious installation bytes', async t => {
  const f = await projectPreviewFixture();
  await writeFile(path.join(f.installation, 'preview', 'index.html'), 'MALICIOUS_INSTALLATION_PAGE');
  await writeFile(path.join(f.installation, 'preview', 'dashboard.js'), 'MALICIOUS_INSTALLATION_SCRIPT');
  const base = await listening(t, await f.context('alpha'));
  const page = await (await fetch(base)).text();
  const script = await (await fetch(`${base}/preview/dashboard.js`)).text();
  assert.match(page, /Preview Lab/);
  assert.match(script, /AgentSignalNetwork/);
  assert.doesNotMatch(page + script, /MALICIOUS_INSTALLATION_/);
});

test('preview CLI serves module-owned preview instead of malicious installation bytes', async t => {
  const f = await projectPreviewFixture();
  await writeFile(path.join(f.installation, 'preview', 'index.html'), 'MALICIOUS_INSTALLATION_PAGE');
  const child = spawn(process.execPath, [path.resolve('scripts/preview-server.mjs'), '--project', 'alpha', '--checkout', f.alpha, '--binding', f.bindingPath], {
    cwd: path.resolve('.'), env: { ...process.env, PURE_HARNESS_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('preview CLI did not listen')), 10000);
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`preview CLI exited: ${code}`)); });
  });
  const page = await (await fetch(base)).text();
  assert.match(page, /Preview Lab/);
  assert.doesNotMatch(page, /MALICIOUS_INSTALLATION_PAGE/);
});

test('explicit asset root serves trusted preview bytes instead of installation bytes', async t => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const trustedRoot = path.join(f.root, 'trusted-engine');
  await mkdir(path.join(trustedRoot, 'preview'), { recursive: true });
  await writeFile(path.join(f.installation, 'preview', 'index.html'), 'MALICIOUS_INSTALLATION_PAGE');
  await writeFile(path.join(f.installation, 'preview', 'dashboard.js'), 'MALICIOUS_INSTALLATION_SCRIPT');
  await writeFile(path.join(trustedRoot, 'preview', 'index.html'), 'TRUSTED_ENGINE_PAGE');
  await writeFile(path.join(trustedRoot, 'preview', 'dashboard.js'), 'TRUSTED_ENGINE_SCRIPT');
  await new RuntimeStore(context).setGoal('selected project runtime');

  const base = await listening(t, context, { assetRoot: trustedRoot });
  const page = await (await fetch(base)).text();
  const script = await (await fetch(`${base}/preview/dashboard.js`)).text();
  const snapshot = await (await fetch(`${base}/runtime/snapshot`)).json();
  assert.equal(page, 'TRUSTED_ENGINE_PAGE');
  assert.equal(script, 'TRUSTED_ENGINE_SCRIPT');
  assert.equal(snapshot.status.current_goal, 'selected project runtime');
  assert.equal((await fetch(`${base}/runtime/undeclared-goals`)).status, 404);
  assert.equal((await fetch(`${base}/runtime/tasks`, { method: 'PUT', headers: { origin: base, 'x-task-write-token': 'invented' }, body: '{}' })).status, 405);
});

test('explicit asset root requires an absolute path', async () => {
  const f = await projectPreviewFixture();
  await assert.rejects(createPreviewServer(await f.context('alpha'), '127.0.0.1', { assetRoot: '.' }), /assetRoot must be an absolute path/);
});

test('second project data is absent', async t => {
  const f = await projectPreviewFixture();
  const alpha = await f.context('alpha'), beta = await f.context('beta');
  await new RuntimeStore(alpha).setGoal('alpha-only goal');
  await new RuntimeStore(beta).setGoal('beta-only secret');
  const base = await listening(t, alpha);
  const snapshot = await (await fetch(`${base}/runtime/snapshot`)).text();
  const specs = await (await fetch(`${base}/runtime/task-specs`)).text();
  assert.doesNotMatch(snapshot + specs, /beta-only secret|beta private plan/);
  assert.ok([403, 404].includes((await fetch(`${base}/projects/beta/runtime/status.json`)).status));
});

test('registered route rejects escaped private file', async t => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const mock = path.join(f.alpha, 'mock');
  await mkdir(mock);
  await writeFile(path.join(mock, 'index.html'), 'alpha public mock');
  await writeFile(path.join(f.alpha, 'private.html'), 'alpha private bytes');
  const base = await listening(t, context, { projectRoutes: [{ prefix: '/project-preview/', root: mock, allow: relative => relative.endsWith('.html') }] });
  assert.equal(await (await fetch(`${base}/project-preview/`)).text(), 'alpha public mock');
  for (const url of ['/project-preview/%2e%2e%2fprivate.html', '/project-preview/%5cprivate.html']) {
    const response = await fetch(base + url);
    assert.ok([403, 404].includes(response.status));
    assert.doesNotMatch(await response.text(), /alpha private bytes/);
  }
  try { await symlink(path.join(f.alpha, 'private.html'), path.join(mock, 'linked.html'), 'file'); }
  catch (error) { if (error.code !== 'EPERM') throw error; return; }
  const escaped = await fetch(`${base}/project-preview/linked.html`);
  assert.ok([403, 404].includes(escaped.status));
  assert.doesNotMatch(await escaped.text(), /alpha private bytes/);
});

test('runtime JSON route remains blocked', async t => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const mock = path.join(f.alpha, 'mock');
  await mkdir(path.join(mock, 'data'), { recursive: true });
  await writeFile(path.join(mock, 'data', 'private.json'), '{"private":"hidden bytes"}');
  const base = await listening(t, context, { projectRoutes: [{ prefix: '/project-preview/', root: mock, allow: relative => /\.(?:html|js|css)$/.test(relative) }] });
  const response = await fetch(`${base}/project-preview/data/private.json`);
  assert.ok([403, 404].includes(response.status));
  assert.doesNotMatch(await response.text(), /hidden bytes/);
});

test('registered route refuses another project root', async () => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const foreign = path.join(f.beta, 'mock');
  await mkdir(foreign);
  await writeFile(path.join(foreign, 'index.html'), 'beta private mock');
  await assert.rejects(createPreviewServer(context, '127.0.0.1', { projectRoutes: [{ prefix: '/project-preview/', root: foreign, allow: () => true }] }), /outside selected project/);
});

test('registered route rejects in-root symlink to disallowed target', async t => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const mock = path.join(f.alpha, 'mock');
  await mkdir(path.join(mock, 'data'), { recursive: true });
  await writeFile(path.join(mock, 'data', 'private.js'), 'in-root private bytes');
  try { await symlink(path.join(mock, 'data'), path.join(mock, 'public'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('directory links unavailable'); return; } throw error; }
  const base = await listening(t, context, { projectRoutes: [{ prefix: '/project-preview/', root: mock, allow: relative => !relative.startsWith('data/') && relative.endsWith('.js') }] });
  const response = await fetch(`${base}/project-preview/public/private.js`);
  assert.ok([403, 404].includes(response.status));
  assert.doesNotMatch(await response.text(), /in-root private bytes/);
});

test('write origin and token remain required', async t => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const store = new RuntimeStore(context);
  await store.setGoal('unchanged');
  const base = await listening(t, context);
  for (const headers of [{}, { origin: base, 'x-task-write-token': 'invented' }]) {
    const response = await fetch(`${base}/runtime/tasks`, { method: 'PUT', headers, body: '{}' });
    assert.ok([403, 405].includes(response.status));
  }
  assert.equal((await store.readStatus()).current_goal, 'unchanged');
});

test('unregistered GOAL runtime route returns 404', async t => {
  const f = await projectPreviewFixture();
  const base = await listening(t, await f.context('alpha'));
  for (const route of ['/runtime/undeclared-goals', '/runtime/undeclared-proposals']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404, route);
  }
});

test('out_of_order_poll_is_ignored for snapshot and Current Tasks', async () => {
  const source = await readFile(path.resolve('preview/dashboard.js'), 'utf8');
  const nodes = new Map();
  const element = () => ({
    children: [], classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    set innerHTML(value) { for (const [, id] of value.matchAll(/id="([^"]+)"/g)) nodes.set(`#${id}`, element()); },
    set textContent(value) { this.text = value; this.children = []; },
    get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); }
  });
  for (const selector of ['#app', '#preview-preferences', '#app-tagline', '#sidebar-note']) nodes.set(selector, element());
  const pending = [], pendingTasks = [];
  const taskUpdates = [];
  let refresh;
  let taskHttpFailure = false;
  const snapshot = current_goal => ({ status: { current_goal, active_agents: [], verification: { status: 'passed' }, warnings: [], blockers: [], artifact_preview_links: [] }, tasks: { tasks: [] }, claims: { claims: [] }, events: [] });
  runInNewContext(source.replace(/^import .*?;\s*/gm, ''), {
    document: { querySelector: selector => nodes.get(selector), querySelectorAll: () => [], createElement: element },
    location: { hash: '#dashboard' }, addEventListener() {}, setInterval(callback) { refresh = callback; },
    fetch: async url => url === '/runtime/tasks' && taskHttpFailure
      ? { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) }
      : { json: () => url === '/runtime/catalog' ? Promise.resolve({ agents: [], skills: [] }) : url === '/runtime/tasks' ? new Promise((resolve, reject) => pendingTasks.push({ resolve, reject })) : new Promise(resolve => pending.push(resolve)) },
    createTaskEditor: () => ({ update(tasks, token) { taskUpdates.push({ tasks, token }); }, destroy() {} }),
    createTelemetryPanel: () => ({ refresh() {}, rerender() {}, destroy() {} }),
    renderArtifactTabs: () => ({}),
    PreviewPreferences: { create: () => ({ locale: 'en', t: key => key, mount() {}, subscribe() {} }) },
    AgentSignalNetwork: { create: () => ({ update() {}, destroy() {} }) }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  assert.equal(pendingTasks.length, 2);
  pending[1](snapshot('newer'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.get('#goal').textContent, 'newer', 'slow task GET must not delay snapshot');
  pendingTasks[1].resolve({ tasks: [{ id: 'new', title: 'New task', revision: 'r2' }], write_token: 'new-token' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(taskUpdates.length, 1);
  assert.equal(taskUpdates[0].tasks[0].title, 'New task');
  assert.equal(taskUpdates[0].token, 'new-token');
  pending[0](snapshot('older'));
  pendingTasks[0].resolve({ tasks: [{ id: 'old', title: 'Old task', revision: 'r1' }], write_token: 'old-token' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.get('#goal').textContent, 'newer');
  assert.equal(taskUpdates.length, 1);
  assert.equal(taskUpdates[0].token, 'new-token');
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  pendingTasks[2].reject(Error('task endpoint unavailable'));
  pending[2](snapshot('latest'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.get('#goal').textContent, 'latest', 'task GET failure must not suppress snapshot');
  assert.equal(taskUpdates.length, 1);
  taskHttpFailure = true;
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  pending[3](snapshot('latest again'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.get('#goal').textContent, 'latest again');
  assert.equal(taskUpdates.length, 1, 'HTTP failure must not clear a previously rendered task list');
});

test('validated task HTTP writes stay in the selected project and expose only safe records', async t => {
  const f = await projectPreviewFixture();
  const alpha = await f.context('alpha'), beta = await f.context('beta');
  const base = await listening(t, alpha);
  const initial = await (await fetch(`${base}/runtime/tasks`)).json();
  assert.equal(typeof initial.write_token, 'string');
  assert.ok(initial.write_token.length >= 32);
  assert.equal((await (await fetch(`${base}/runtime/snapshot`)).text()).includes(initial.write_token), false);
  const headers = { origin: base, 'content-type': 'application/json', 'x-task-write-token': initial.write_token };
  const createdResponse = await fetch(`${base}/runtime/tasks`, { method: 'POST', headers, body: JSON.stringify({ title: '  New task  ', status: 'pending', branch: '  feature/a  ' }) });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.match(created.id, /^[A-Za-z0-9_-]+$/);
  assert.equal(created.title, 'New task');
  assert.equal(created.branch, 'feature/a');
  assert.equal(created.status, 'pending');
  assert.ok(Date.parse(created.created_at));
  assert.equal(created.created_at, created.updated_at);
  assert.ok(created.revision);
  assert.equal(created.owner, undefined);
  const updatedResponse = await fetch(`${base}/runtime/tasks/${created.id}`, { method: 'PUT', headers, body: JSON.stringify({ title: 'Changed', status: 'in_progress', branch: null, revision: created.revision }) });
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json();
  assert.equal(updated.title, 'Changed');
  assert.equal(updated.branch, null);
  assert.notEqual(updated.revision, created.revision);
  assert.equal(updated.created_at, created.created_at);
  assert.equal((await new RuntimeStore(beta).readTasks()).tasks.length, 0);
  const visible = await (await fetch(`${base}/runtime/tasks`)).json();
  assert.equal(visible.tasks[0].id, created.id);
  assert.equal(visible.tasks[0].revision, updated.revision);
  assert.equal(visible.project_id, 'alpha');
});

test('task HTTP rejects invalid writes without touching task document bytes', async t => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const base = await listening(t, context);
  const token = (await (await fetch(`${base}/runtime/tasks`)).json()).write_token;
  const headers = { origin: base, 'content-type': 'application/json', 'x-task-write-token': token };
  const pathToTasks = path.join(context.paths.runtime, 'tasks.json');
  const original = await readFile(pathToTasks);
  const valid = { title: 'Task', status: 'pending', branch: null };
  for (const body of [
    '{', '[]', JSON.stringify({ ...valid, id: 'client' }), JSON.stringify({ ...valid, owner: 'client' }),
    JSON.stringify({ ...valid, created_at: 'now' }), JSON.stringify({ ...valid, revision: 'client' }),
    JSON.stringify({ ...valid, status: 'unknown' }), JSON.stringify({ ...valid, branch: '' }),
    JSON.stringify({ ...valid, branch: 'a\n' }), JSON.stringify({ ...valid, title: '' }),
    JSON.stringify({ title: 'Partial', status: 'pending' })
  ]) {
    const response = await fetch(`${base}/runtime/tasks`, { method: 'POST', headers, body });
    assert.equal(response.status, 400, body);
    assert.deepEqual(await readFile(pathToTasks), original, body);
  }
  const oversized = await fetch(`${base}/runtime/tasks`, { method: 'POST', headers, body: ' '.repeat(16 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await readFile(pathToTasks), original);
  for (const url of ['/runtime/tasks/a/b', '/runtime/tasks/%ZZ']) {
    const response = await fetch(base + url, { method: 'PUT', headers, body: JSON.stringify({ ...valid, revision: 'old' }) });
    assert.equal(response.status, 400, url);
  }
  assert.equal((await fetch(`${base}/runtime/tasks/missing`, { method: 'PUT', headers, body: JSON.stringify({ ...valid, revision: 'old' }) })).status, 404);
  for (const url of ['/runtime/tasks/not%20valid', '/runtime/tasks/%2Fetc']) {
    assert.equal((await fetch(base + url, { method: 'PUT', headers, body: JSON.stringify({ ...valid, revision: 'old' }) })).status, 404, url);
  }
  assert.deepEqual(await readFile(pathToTasks), original);
});

test('task HTTP updates existing opaque legacy IDs through one encoded URL segment', async t => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const store = new RuntimeStore(context);
  const ids = ['with space', '한글', 'part/child'];
  for (const id of ids) await store.upsertTask(id, 'Before', 'pending', 'original-owner');
  const base = await listening(t, context);
  const document = await (await fetch(`${base}/runtime/tasks`)).json();
  const headers = { origin: base, 'content-type': 'application/json', 'x-task-write-token': document.write_token };
  for (const id of ids) {
    const before = document.tasks.find(task => task.id === id);
    assert.ok(before, id);
    const response = await fetch(`${base}/runtime/tasks/${encodeURIComponent(id)}`, {
      method: 'PUT', headers, body: JSON.stringify({ title: `After ${id}`, status: 'completed', branch: 'legacy-fix', revision: before.revision })
    });
    assert.equal(response.status, 200, id);
    const updated = await response.json();
    assert.equal(updated.id, id);
    assert.equal(updated.title, `After ${id}`);
    assert.equal(updated.owner, 'original-owner');
    assert.notEqual(updated.revision, before.revision);
  }
  const beforeRawPath = await readFile(path.join(context.paths.runtime, 'tasks.json'));
  const rawPath = await fetch(`${base}/runtime/tasks/part/child`, {
    method: 'PUT', headers, body: JSON.stringify({ title: 'Wrong route', status: 'completed', branch: null, revision: document.tasks.find(task => task.id === 'part/child').revision })
  });
  assert.equal(rawPath.status, 400);
  const doubleEncoded = await fetch(`${base}/runtime/tasks/part%252Fchild`, {
    method: 'PUT', headers, body: JSON.stringify({ title: 'Wrong decode', status: 'completed', branch: null, revision: document.tasks.find(task => task.id === 'part/child').revision })
  });
  assert.equal(doubleEncoded.status, 404);
  const normalizedTraversal = await new Promise((resolve, reject) => {
    const request = http.request(base, { method: 'PUT', path: '/runtime/tasks/part/../child', headers }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end(JSON.stringify({ title: 'Wrong normalization', status: 'completed', branch: null, revision: document.tasks.find(task => task.id === 'part/child').revision }));
  });
  assert.equal(normalizedTraversal, 400);
  assert.deepEqual(await readFile(path.join(context.paths.runtime, 'tasks.json')), beforeRawPath);
});

test('task HTTP enforces origin, host, token, type, and method gates', async t => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const base = await listening(t, context);
  const token = (await (await fetch(`${base}/runtime/tasks`)).json()).write_token;
  const body = JSON.stringify({ title: 'Task', status: 'pending', branch: null });
  const good = { origin: base, 'content-type': 'application/json', 'x-task-write-token': token };
  const cases = [
    [{ ...good, origin: 'http://127.0.0.1:1' }, 403],
    [{ ...good, 'x-task-write-token': 'wrong' }, 403], [{ ...good, 'x-task-write-token': undefined }, 403],
    [{ ...good, 'content-type': 'text/plain' }, 400], [{ ...good, 'content-encoding': 'gzip' }, 400]
  ];
  for (const [index, [headers, expected]] of cases.entries()) assert.equal((await fetch(`${base}/runtime/tasks`, { method: 'POST', headers, body })).status, expected, `gate case ${index}`);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const url = new URL(`${base}/runtime/tasks`);
    const request = http.request(url, { method: 'POST', headers: { ...good, host: 'localhost:9999' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end(body);
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal((await fetch(`${base}/runtime/tasks`, { method: 'PUT', headers: good, body })).status, 405);
  assert.equal((await fetch(`${base}/runtime/tasks/missing`, { method: 'POST', headers: good, body })).status, 405);
  assert.equal((await fetch(`${base}/preview/dashboard.js`, { method: 'POST', headers: good, body })).status, 405);
  const legacyRoot = await mkdtemp(path.join(tmpdir(), 'pure-preview-readonly-'));
  await mkdir(path.join(legacyRoot, 'preview'));
  await writeFile(path.join(legacyRoot, 'preview', 'index.html'), 'Legacy');
  const legacy = await listening(t, legacyCatalogFixture(legacyRoot));
  assert.equal((await fetch(`${legacy}/runtime/tasks`, { method: 'POST', headers: { ...good, origin: legacy }, body })).status, 405);
  assert.equal((await (await fetch(`${legacy}/runtime/tasks`)).json()).write_token, undefined);
});

test('task HTTP reports conflicts with safe current task and rotates token on restart', async t => {
  const f = await projectPreviewFixture();
  const context = await f.context('alpha');
  const first = await listening(t, context);
  const token = (await (await fetch(`${first}/runtime/tasks`)).json()).write_token;
  const headers = { origin: first, 'content-type': 'application/json', 'x-task-write-token': token };
  const created = await (await fetch(`${first}/runtime/tasks`, { method: 'POST', headers, body: JSON.stringify({ title: 'First', status: 'pending', branch: null }) })).json();
  const replacement = { title: 'Second', status: 'completed', branch: 'work', revision: created.revision };
  const accepted = await (await fetch(`${first}/runtime/tasks/${created.id}`, { method: 'PUT', headers, body: JSON.stringify(replacement) })).json();
  const taskPath = path.join(context.paths.runtime, 'tasks.json');
  const before = await readFile(taskPath);
  const stale = await fetch(`${first}/runtime/tasks/${created.id}`, { method: 'PUT', headers, body: JSON.stringify(replacement) });
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).current, accepted);
  assert.deepEqual(await readFile(taskPath), before);
  const second = await listening(t, context);
  const nextToken = (await (await fetch(`${second}/runtime/tasks`)).json()).write_token;
  assert.notEqual(nextToken, token);
  assert.equal((await fetch(`${second}/runtime/tasks`, { method: 'POST', headers: { ...headers, origin: second }, body: JSON.stringify({ title: 'Denied', status: 'pending', branch: null }) })).status, 403);
});
