import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { renderArtifactTabs } from '../preview/artifact-tabs.js';
import { createTaskEditor } from '../preview/task-editor.js';
import { createTelemetryPanel } from '../preview/telemetry-panel.js';
import { createGuidePanel } from '../preview/guide-panel.js';
import { createDocument } from './support/dashboard-dom.mjs';

const source = name => readFileSync(new URL(`../preview/${name}`, import.meta.url), 'utf8');
const response = body => ({ ok: true, json: async () => body });
const settle = async () => { for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve)); };
const snapshot = (goal = 'Current goal', agent = 'fresh-agent', artifacts = []) => ({
  status: {
    current_goal: goal, phase: 'execution', progress: { completed: 1, total: 2 },
    active_agents: [{ id: agent, role: 'worker', current_task: goal, status: 'running', started_at: '2026-10-08T00:00:00Z' }],
    agents: [{ id: agent, role: 'worker', status: 'running' }], signals: [],
    verification: { status: 'passed', checks: [] }, warnings: [], blockers: [], artifact_preview_links: artifacts
  },
  tasks: { tasks: [] }, claims: { claims: [] }, events: []
});
const telemetry = (processed = 90, taskProcessed = 40) => ({
  schema_version: 1, project_id: 'demo', status: 'observed', source: 'codex_rollout',
  totals: { input: 50, cached_input: 5, output: 40, reasoning_output: 2, processed },
  tasks: [{ task_id: 'task-1', totals: { input: 30, cached_input: 2, output: 10, reasoning_output: 1, processed: taskProcessed } }],
  unattributed: { processed: 50 }, coverage: { threads: 1, observed_threads: 1 },
  roles: [], agents: [], largest_tool_outputs: [], spawns: [], compactions: 0, elapsed_ms: 1000
});
const tasks = (title = 'Current task', writeToken = 'fresh-token') => ({
  tasks: [{ id: 'task-1', title, status: 'pending', branch: null, owner: 'worker', created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z', revision: 'rev-1' }],
  write_token: writeToken
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function mountIntegratedDashboard({ fetchImpl, hash = '#dashboard' }) {
  const document = createDocument();
  const listeners = new Map();
  const location = { hash, origin: document.defaultView.location.origin };
  let interval;
  const context = {
    document, location, URL, crypto: globalThis.crypto,
    fetch: fetchImpl,
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: listener => { interval = listener; },
    renderArtifactTabs, createTaskEditor, createTelemetryPanel, createGuidePanel
  };
  runInNewContext(source('preferences.js'), context, { filename: 'preferences.js' });
  runInNewContext(source('agent-network.js'), context, { filename: 'agent-network.js' });
  runInNewContext(`${source('dashboard.js').replace(/^import .*?;\s*/gm, '')}\nglobalThis.__preferences = preferences;`, context, { filename: 'dashboard.js' });
  await settle();
  return {
    document,
    preferences: context.__preferences,
    navigate: async nextHash => { location.hash = nextHash; listeners.get('hashchange')(); await settle(); },
    tick: async () => { interval(); await settle(); },
    settle
  };
}

test('dashboard-integrated-navigation-keeps-real-widgets', async () => {
  const current = { snapshot: snapshot(), tasks: tasks(), telemetry: telemetry() };
  const requests = { snapshot: [], tasks: [], telemetry: [] };
  let postedToken;
  const fetchImpl = async (url, options = {}) => {
    if (url === '/runtime/catalog') return response({ agents: [], skills: [] });
    if (url === '/runtime/task-specs') return response({ taskSpecs: [] });
    if (url === '/runtime/tasks' && options.method === 'POST') {
      postedToken = options.headers['x-task-write-token'];
      return response({ ...tasks().tasks[0], title: 'unsaved' });
    }
    const kind = url.split('/').at(-1);
    const queued = requests[kind].shift();
    return queued ? queued.promise : response(current[kind]);
  };
  const ui = await mountIntegratedDashboard({ fetchImpl });
  const { document } = ui;
  assert.ok(document.querySelector('#tasks [data-task-action="add"]'));
  assert.ok(document.querySelector('#telemetry [data-telemetry-task="selector"]'));
  assert.ok(document.querySelector('#agent-network svg'));
  for (const tabName of ['tasks', 'agents', 'telemetry']) {
    document.querySelector(`#dashboard-tab-${tabName}`).click();
    assert.equal(document.querySelector(`#dashboard-tab-${tabName}`).getAttribute('aria-selected'), 'true');
    assert.equal(document.querySelector(`#dashboard-pane-${tabName}`).hidden, false);
  }
  const keyboard = document.querySelector('#dashboard-tab-agents').dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(keyboard.defaultPrevented, true);
  assert.equal(document.activeElement, document.querySelector('#dashboard-tab-telemetry'));
  await ui.navigate('#preview');
  assert.ok(document.querySelector('#preview-artifacts'));
  await ui.navigate('#guide');
  const guideCopy = { new: /new, empty Git project/, existing: /original project and runtime untouched/, connected: /manifest and local binding already exist/ };
  for (const choice of ['new', 'existing', 'connected']) {
    const button = document.querySelector(`[data-guide-choice="${choice}"]`);
    assert.ok(button);
    button.click();
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.match(document.querySelector('.guide-selected')?.textContent, guideCopy[choice]);
  }
  await ui.navigate('#dashboard');
  document.querySelector('#dashboard-tab-tasks').click();
  document.querySelector('#tasks [data-task-action="add"]').click();
  const draft = document.querySelector('#tasks [data-task-field="title"]');
  draft.value = 'unsaved'; draft.focus(); draft.scrollTop = 17;
  const selected = document.querySelector('#telemetry [data-telemetry-task="selector"]');
  selected.value = 'task-1'; selected.dispatch('change');
  const oldTasks = deferred(), oldSnapshot = deferred();
  requests.tasks.push(oldTasks); requests.snapshot.push(oldSnapshot);
  await ui.tick();
  current.tasks = tasks('Newer task', 'newer-token');
  current.snapshot = snapshot('Newer goal', 'newer-agent');
  current.telemetry = telemetry(120, 60);
  await ui.tick();
  assert.equal(document.querySelector('#telemetry [data-telemetry-value="processed"]').textContent, '60');
  document.querySelector('#agent-network [data-node-id="newer-agent"]').click();
  assert.match(document.querySelector('#agent-network [data-node-id="newer-agent"]').className, /asn-selected/);
  ui.preferences.setLocale('ko'); await ui.settle();
  assert.equal(document.querySelector('#tasks [data-task-field="title"]'), draft);
  assert.equal(draft.value, 'unsaved');
  assert.equal(document.activeElement, draft);
  assert.equal(draft.scrollTop, 17);
  assert.equal(document.querySelector('#telemetry [data-telemetry-task="selector"]').value, 'task-1');
  assert.match(document.querySelector('#agent-network [data-node-id="newer-agent"]').className, /asn-selected/);
  assert.match(document.querySelector('#dashboard-title').textContent, /실시간/);
  assert.match(document.querySelector('#goal').textContent, /Newer goal/);
  oldTasks.resolve(response(tasks('Stale task', 'stale-token')));
  oldSnapshot.resolve(response(snapshot('Stale goal', 'stale-agent')));
  await ui.settle();
  assert.doesNotMatch(document.querySelector('#tasks').textContent, /Stale task/);
  assert.doesNotMatch(document.querySelector('#goal').textContent, /Stale goal/);
  assert.doesNotMatch(document.querySelector('#agents').textContent, /stale-agent/);
  requests.telemetry.push({ promise: Promise.reject(Error('offline')) });
  await ui.tick();
  assert.ok(document.querySelector('[data-telemetry-state="stale"]'));
  assert.equal(document.querySelector('#telemetry [data-telemetry-value="processed"]').textContent, '60');
  document.querySelector('#tasks [data-task-action="save"]').click();
  await ui.settle();
  assert.equal(postedToken, 'newer-token');
});

test('dashboard-integrated-artifact-privacy', async () => {
  const artifacts = [
    { label: 'Local sketch', href: '/preview/local.html' },
    { label: 'Foreign private', href: 'https://private.example/preview' },
    { label: 'Blocked scheme', href: 'javascript:alert(1)' }
  ];
  const fetchImpl = async url => response(url === '/runtime/catalog' ? { agents: [], skills: [] }
    : url === '/runtime/task-specs' ? { taskSpecs: [] }
      : url === '/runtime/tasks' ? tasks()
        : url === '/runtime/telemetry' ? telemetry()
          : snapshot('Current goal', 'fresh-agent', artifacts));
  const ui = await mountIntegratedDashboard({ fetchImpl });
  await ui.navigate('#preview');
  const { document } = ui;
  const host = document.querySelector('#preview-artifacts');
  const tabs = host.querySelectorAll('[role="tab"]');
  assert.equal(tabs.length, 3);
  assert.equal(host.querySelectorAll('iframe').length, 1);
  assert.equal(host.querySelector('iframe').getAttribute('sandbox'), 'allow-scripts');
  tabs[1].click();
  assert.equal(host.querySelectorAll('iframe').length, 0);
  assert.match(host.textContent, /not embedded|safety policy/i);
  assert.doesNotMatch(host.textContent, /SECRET_BODY|private-rollout\.jsonl|PROMPT_SENTINEL|OUTPUT_SENTINEL|verified live app/i);
  tabs[2].click();
  assert.equal(host.querySelectorAll('iframe').length, 0);
  assert.match(host.textContent, /not supported|safety policy/i);
  assert.equal(host.querySelector('[data-action="open"]').getAttribute('aria-disabled'), 'true');
});
