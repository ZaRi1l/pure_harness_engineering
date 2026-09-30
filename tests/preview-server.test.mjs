import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { execFileSync, spawn } from 'node:child_process';

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
  assert.equal(snapshot.status.task_counts.total, snapshot.tasks.tasks.length);
  assert.ok([403, 404].includes(traversal.status));
});

test('live dashboard reuses its network controller during polling and destroys it on navigation', async () => {
  const moduleSource = await readFile(path.resolve('preview/dashboard.js'), 'utf8');
  const nodes = new Map();
  const element = () => ({
    children: [], classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
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
  const listeners = {};
  let preferenceListener;
  let refresh;
  const context = {
    document: { querySelector: selector => nodes.get(selector), querySelectorAll: () => [], createElement: element },
    location: { hash: '#dashboard' }, addEventListener: (name, callback) => { listeners[name] = callback; }, setInterval: callback => { refresh = callback; },
    fetch: async url => ({ json: async () => url === '/runtime/catalog' ? { agents, skills: [] } : snapshots.shift() ?? second }),
    PreviewPreferences: { create: () => ({ locale: 'en', t: key => key, mount() {}, subscribe(callback) { preferenceListener = callback; } }) },
    AgentSignalNetwork: { create: (host, options = {}) => { const controller = { host, options, state: options.initialState || { mode: 'live', filter: 'all', taskId: '', selection: null, transform: { x: 0, y: 0, scale: 1 } }, updates: [], destroyCount: 0, update(snapshot, catalog) { this.updates.push({ snapshot, catalog }); }, getState() { return this.state; }, destroy() { this.destroyCount++; } }; controllers.push(controller); return controller; } }
  };
  runInNewContext(moduleSource.replace(/^import .*?;\s*/m, 'const renderArtifactTabs = () => {};\n'), context);
  await new Promise(resolve => setImmediate(resolve));
  const retained = controllers.at(-1);
  const beforeRefresh = controllers.length;
  refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controllers.length, beforeRefresh);
  assert.equal(retained.host, nodes.get('#agent-network'));
  assert.equal(retained.updates.at(-1).snapshot, second);
  assert.equal(retained.updates.at(-1).catalog.agents[0].id, 'worker');
  retained.state = { mode: 'history', filter: 'failures', taskId: 'ui', selection: { type: 'node', id: 'worker-1' }, transform: { x: 12, y: 8, scale: 1.2 } };
  preferenceListener({ locale: 'ko' });
  await new Promise(resolve => setImmediate(resolve));
  const localized = controllers.at(-1);
  assert.deepEqual(localized.options.initialState, retained.state);
  assert.equal(retained.destroyCount, 1, 'language rebuild destroys the old controller after retaining its state');
  context.location.hash = '#preview';
  listeners.hashchange();
  assert.equal(localized.destroyCount, 1, 'the detached Dashboard controller is destroyed synchronously');
  context.location.hash = '#dashboard';
  listeners.hashchange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controllers.length, beforeRefresh + 2);
  assert.notEqual(controllers.at(-1), localized);
  assert.equal(controllers.at(-1).host, nodes.get('#agent-network'));
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
  runInNewContext(source.replace(/^import .*?;\s*/m, 'const renderArtifactTabs = () => {};\n'), {
    Date: FixedDate, document: { querySelector: selector => nodes.get(selector), querySelectorAll: () => [], createElement: element },
    location: { hash: '#dashboard' }, addEventListener() {}, setInterval() {},
    fetch: async url => ({ json: async () => url === '/runtime/catalog' ? { agents: [], skills: [] } : snapshot }),
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

test('guide commands remain backed by package scripts', async () => {
  const scripts = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).scripts;
  const messages = await readFile(path.resolve('preview/preferences.js'), 'utf8');
  for (const command of ['init', 'status', 'watchdog', 'preview', 'preview:live', 'demo:network', 'demo:reset', 'test', 'self-check']) {
    assert.ok(scripts[command]);
    assert.match(messages, new RegExp(command === 'test' ? 'npm test' : 'npm run ' + command));
  }
  assert.match(messages, /Agent Network demo: npm run demo:network\\nReset network demo: npm run demo:reset/);
  assert.match(messages, /\.ai\/tasks\/\*\.md/);
  assert.match(messages, /GPT-5\.6/);
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
