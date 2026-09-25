import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { createPreviewServer } from '../scripts/preview-server.mjs';
import { RuntimeStore } from '../scripts/runtime-state.mjs';
import { discoverCatalog } from '../scripts/catalog.mjs';

test('serves dashboard, task specs, and runtime JSON while rejecting traversal', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-preview-'));
  await mkdir(path.join(root, 'preview'));
  await copyFile(path.resolve('preview/index.html'), path.join(root, 'preview/index.html'));
  await copyFile(path.resolve('preview/artifact-tabs.js'), path.join(root, 'preview/artifact-tabs.js'));
  await copyFile(path.resolve('preview/agent-network.js'), path.join(root, 'preview/agent-network.js'));
  await mkdir(path.join(root, '.ai', 'tasks'), { recursive: true });
  await writeFile(path.join(root, '.ai', 'tasks', 'example.md'), '# Example task spec\n\nPlan content.');
  await new RuntimeStore(root).initialize();
  const server = await createPreviewServer(root, '127.0.0.1', 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const artifactModuleResponse = await fetch(`http://127.0.0.1:${port}/preview/artifact-tabs.js`);
  const artifactModule = await artifactModuleResponse.text();
  const networkResponse = await fetch(`http://127.0.0.1:${port}/preview/agent-network.js`);
  const networkSource = await networkResponse.text();
  const status = await (await fetch(`http://127.0.0.1:${port}/runtime/status`)).json();
  const snapshot = await (await fetch(`http://127.0.0.1:${port}/runtime/snapshot`)).json();
  const catalogResponse = await fetch(`http://127.0.0.1:${port}/runtime/catalog`), catalog = await catalogResponse.json();
  const taskSpecsResponse = await fetch(`http://127.0.0.1:${port}/runtime/task-specs`), taskSpecs = await taskSpecsResponse.json();
  const traversal = await fetch(`http://127.0.0.1:${port}/preview/%2e%2e/secret.txt`);
  assert.match(html, /Signal Timeline/);
  assert.match(html, /Active Agents/);
  assert.equal((html.match(/<h2>Agent Signal Network<\/h2>/g) || []).length, 1);
  assert.match(html, /<section class="card full"><h2>Agent Signal Network<\/h2><div id="agent-network"><\/div><\/section>/);
  assert.match(html, /<script src="\/preview\/agent-network\.js"><\/script>\s*<script type="module">/);
  assert.match(html, /Preview Lab/);
  assert.match(html, /Agent Catalog/);
  assert.match(html, /Skill Catalog/);
  assert.match(html, /Harness Guide/);
  assert.match(html, /Plan \/ Task Specs/);
  assert.match(html, /UI Artifacts/);
  assert.match(html, /renderArtifactTabs/);
  assert.match(html, /75vh/);
  assert.equal(artifactModuleResponse.status, 200);
  assert.match(artifactModuleResponse.headers.get('content-type'), /text\/javascript/);
  assert.match(artifactModule, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.match(artifactModule, /Open separately/);
  assert.equal(networkResponse.status, 200);
  assert.match(networkResponse.headers.get('content-type'), /text\/javascript/);
  assert.match(networkSource, /AgentSignalNetwork/);
  assert.match(html, /Fallback: /);
  assert.match(html, /gpt-5\.6-/);
  assert.match(html, /Watchdog Warnings/);
  assert.match(html, /npm run preview:live/);
  assert.match(html, /host\.replaceChildren\(\)/);
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
  const html = await readFile(path.resolve('preview/index.html'), 'utf8');
  const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(moduleSource, 'live dashboard module is present');
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
  const first = { status: { active_agents: [], agents: [{ id: 'worker-1', role: 'worker' }], signals: [{ id: 'signal-1', from: 'main', to: 'worker-1', kind: 'delegate' }], verification: { status: 'passed' }, warnings: [], blockers: [], artifact_preview_links: [] }, tasks: { tasks: [] }, claims: { claims: [] }, events: [] };
  const second = structuredClone(first);
  second.status.signals.push({ id: 'signal-2', from: 'worker-1', to: 'main', kind: 'result' });
  const snapshots = [first, second];
  const agents = [{ id: 'worker', model: 'gpt-6-sol' }];
  const controllers = [];
  const listeners = {};
  let refresh;
  const context = {
    document: { querySelector: selector => nodes.get(selector), querySelectorAll: () => [], createElement: element },
    location: { hash: '#dashboard' }, addEventListener: (name, callback) => { listeners[name] = callback; }, setInterval: callback => { refresh = callback; },
    fetch: async url => ({ json: async () => url === '/runtime/catalog' ? { agents, skills: [] } : snapshots.shift() ?? second }),
    AgentSignalNetwork: { create: host => { const controller = { host, updates: [], destroyCount: 0, update(snapshot, catalog) { this.updates.push({ snapshot, catalog }); }, destroy() { this.destroyCount++; } }; controllers.push(controller); return controller; } }
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
  context.location.hash = '#preview';
  listeners.hashchange();
  assert.equal(retained.destroyCount, 1, 'the detached Dashboard controller is destroyed synchronously');
  context.location.hash = '#dashboard';
  listeners.hashchange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controllers.length, beforeRefresh + 1);
  assert.notEqual(controllers.at(-1), retained);
  assert.equal(controllers.at(-1).host, nodes.get('#agent-network'));
});

test('runtimeDir changes only live runtime data and keeps repository catalog and Task Specs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-preview-root-'));
  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'pure-preview-runtime-'));
  await mkdir(path.join(root, 'preview'));
  await mkdir(path.join(root, '.ai', 'tasks'), { recursive: true });
  await copyFile(path.resolve('preview/index.html'), path.join(root, 'preview/index.html'));
  await writeFile(path.join(root, '.ai', 'tasks', 'example.md'), '# Source task');
  const store = new RuntimeStore(root, { runtimeDir });
  await store.initialize();
  await store.setGoal('Injected runtime');
  const server = await createPreviewServer(root, '127.0.0.1', { runtimeDir });
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
  const catalog = discoverCatalog(path.resolve('.'));
  const planner = catalog.agents.find(agent => agent.id === 'planner');
  const testing = catalog.skills.find(skill => skill.id === 'testing');
  assert.equal(planner.model, 'gpt-6-sol');
  assert.equal(planner.reasoning, 'high');
  assert.match(planner.source, /developer_instructions/);
  assert.match(testing.source, /name: testing/);
});

test('guide commands remain backed by package scripts', async () => {
  const scripts = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).scripts;
  const html = await readFile(path.resolve('preview/index.html'), 'utf8');
  for (const command of ['init', 'status', 'watchdog', 'preview', 'preview:live', 'test', 'self-check']) {
    assert.ok(scripts[command]);
    assert.match(html, new RegExp(command === 'test' ? 'npm test' : 'npm run ' + command));
  }
  assert.match(html, /\.ai\/tasks\/\*\.md/);
  assert.match(html, /GPT-5\.6/);
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
  await new RuntimeStore(root).initialize();
  const server = await createPreviewServer(root, '127.0.0.1', 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/preview/linked/secret.txt`);
  assert.equal(response.status, 403);
});
