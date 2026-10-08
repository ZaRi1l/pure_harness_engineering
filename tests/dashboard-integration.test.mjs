import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { artifactUrlPolicy, renderArtifactTabs } from '../preview/artifact-tabs.js';
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

async function mountIntegratedDashboard({ fetchImpl, hash = '#dashboard', DateImpl = Date }) {
  const document = createDocument();
  const listeners = new Map();
  const location = { hash, origin: document.defaultView.location.origin };
  let interval;
  const context = {
    document, location, URL, Date: DateImpl, crypto: globalThis.crypto,
    fetch: fetchImpl,
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: listener => { interval = listener; },
    artifactUrlPolicy, renderArtifactTabs, createTaskEditor, createTelemetryPanel, createGuidePanel
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
  const agentsTab = document.querySelector('#dashboard-tab-agents');
  agentsTab.focus(); agentsTab.click();
  assert.equal(document.querySelector('#dashboard-pane-tasks').hidden, true);
  assert.equal(document.activeElement, agentsTab);
  const tasksTab = document.querySelector('#dashboard-tab-tasks');
  tasksTab.focus(); tasksTab.click();
  assert.equal(document.querySelector('#dashboard-pane-tasks').hidden, false);
  assert.equal(document.activeElement, tasksTab);
  assert.equal(document.querySelector('#tasks [data-task-field="title"]'), draft);
  assert.equal(draft.value, 'unsaved');
  assert.equal(draft.scrollTop, 17);
  draft.focus();
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
    { label: 'Local sketch', href: '/preview/demo-ui.html' },
    { label: 'Foreign private', href: 'https://private.example/preview' },
    { label: 'Credentialed private', href: 'https://user:TOP_SECRET@private.example/preview' },
    { label: 'Blocked scheme', href: 'javascript:SECRET_BODY' }
  ];
  const fetchImpl = async url => response(url === '/runtime/catalog' ? { agents: [], skills: [] }
    : url === '/runtime/task-specs' ? { taskSpecs: [] }
      : url === '/runtime/tasks' ? tasks()
        : url === '/runtime/telemetry' ? telemetry()
          : snapshot('Current goal', 'fresh-agent', artifacts));
  const ui = await mountIntegratedDashboard({ fetchImpl });
  const links = ui.document.querySelectorAll('#artifacts a');
  assert.deepEqual(links.map(link => link.href), ['/preview/demo-ui.html', 'https://private.example/preview']);
  assert.doesNotMatch(ui.document.querySelector('#artifacts').textContent, /TOP_SECRET|SECRET_BODY/);
  await ui.navigate('#preview');
  const { document } = ui;
  const host = document.querySelector('#preview-artifacts');
  const tabs = host.querySelectorAll('[role="tab"]');
  assert.equal(tabs.length, 4);
  assert.equal(host.querySelectorAll('iframe').length, 1);
  assert.equal(host.querySelector('iframe').src, '/preview/demo-ui.html');
  assert.equal(host.querySelector('iframe').getAttribute('sandbox'), 'allow-scripts');
  tabs[1].click();
  assert.equal(host.querySelectorAll('iframe').length, 0);
  assert.match(host.textContent, /not embedded|safety policy/i);
  tabs[2].click();
  assert.equal(host.querySelectorAll('iframe').length, 0);
  assert.equal(host.querySelector('[data-action="open"]').getAttribute('aria-disabled'), 'true');
  assert.doesNotMatch(host.textContent, /TOP_SECRET|user:|private-rollout\.jsonl|verified live app/i);
  tabs[3].click();
  assert.equal(host.querySelectorAll('iframe').length, 0);
  assert.match(host.textContent, /not supported|safety policy/i);
  assert.equal(host.querySelector('[data-action="open"]').getAttribute('aria-disabled'), 'true');
  assert.doesNotMatch(host.textContent, /SECRET_BODY|TOP_SECRET/);
});

test('dashboard failure notices stay generic and translate while a task draft remains open', async () => {
  const failures = new Set();
  const fetchImpl = async url => {
    if (url === '/runtime/catalog') return response({ agents: [], skills: [] });
    if (failures.has(url)) throw Error('SECRET_PRIVATE_PATH\\private-rollout.jsonl OUTPUT_SENTINEL');
    if (url === '/runtime/tasks') return response(tasks());
    if (url === '/runtime/telemetry') return response(telemetry());
    if (url === '/runtime/task-specs') return response({ taskSpecs: [] });
    return response(snapshot());
  };
  const ui = await mountIntegratedDashboard({ fetchImpl });
  const { document } = ui;
  document.querySelector('#tasks [data-task-action="add"]').click();
  const draft = document.querySelector('#tasks [data-task-field="title"]');
  draft.value = 'unsaved'; draft.focus(); draft.scrollTop = 19;
  failures.add('/runtime/tasks');
  await ui.tick();
  assert.match(document.querySelector('#tasks [data-dashboard-error="tasks"]').textContent, /Tasks.*unavailable|Could not load tasks/i);
  assert.equal(document.querySelector('#dashboard-error'), null);
  assert.doesNotMatch(document.body.textContent, /SECRET_PRIVATE_PATH|private-rollout\.jsonl|OUTPUT_SENTINEL/);
  ui.preferences.setLocale('ko'); await ui.settle();
  assert.match(document.querySelector('#tasks [data-dashboard-error="tasks"]').textContent, /작업.*읽|작업.*불러/);
  assert.equal(document.querySelector('#tasks [data-task-field="title"]'), draft);
  assert.equal(draft.value, 'unsaved');
  assert.equal(document.activeElement, draft);
  assert.equal(draft.scrollTop, 19);
  ui.preferences.setLocale('en'); await ui.settle();
  assert.match(document.querySelector('#tasks [data-dashboard-error="tasks"]').textContent, /Tasks unavailable/);

  failures.clear(); failures.add('/runtime/snapshot');
  await ui.tick();
  assert.equal(document.querySelector('#tasks [data-dashboard-error="tasks"]'), null);
  assert.match(document.querySelector('#dashboard-error').textContent, /Dashboard unavailable/);
  ui.preferences.setLocale('ko'); await ui.settle();
  assert.match(document.querySelector('#dashboard-error').textContent, /대시보드/);
  ui.preferences.setLocale('en'); await ui.settle();
  assert.match(document.querySelector('#dashboard-error').textContent, /Dashboard unavailable/);

  failures.clear(); failures.add('/runtime/telemetry');
  await ui.tick();
  assert.equal(document.querySelector('#dashboard-error'), null);
  assert.ok(document.querySelector('[data-telemetry-state="stale"]'));
  ui.preferences.setLocale('ko'); await ui.settle();
  assert.match(document.querySelector('[data-telemetry-state="stale"]').textContent, /오래된 값/);
  ui.preferences.setLocale('en'); await ui.settle();
  assert.match(document.querySelector('[data-telemetry-state="stale"]').textContent, /Stale/);

  failures.clear(); failures.add('/runtime/task-specs');
  await ui.navigate('#preview');
  assert.match(document.querySelector('#preview-error').textContent, /Preview Lab unavailable/);
  ui.preferences.setLocale('ko'); await ui.settle();
  assert.match(document.querySelector('#preview-error').textContent, /미리보기 랩/);
  assert.doesNotMatch(document.body.textContent, /SECRET_PRIVATE_PATH|private-rollout\.jsonl|OUTPUT_SENTINEL/);
  ui.preferences.setLocale('en'); await ui.settle();
  assert.match(document.querySelector('#preview-error').textContent, /Preview Lab unavailable/);
});

test('reported-running age buckets never claim native liveness at a fixed one-hour boundary', async () => {
  const at = '2026-09-25T12:00:00Z';
  const FixedDate = class extends Date { static now() { return Date.parse(at); } };
  const current = snapshot();
  current.status.active_agents = [
    { id: 'edge', role: 'worker', current_task: 'edge', started_at: '2026-09-25T11:00:00Z' },
    { id: 'older', role: 'worker', current_task: 'older', started_at: '2026-09-25T10:59:59Z' },
    { id: 'missing', role: 'worker', current_task: 'missing' },
    { id: 'invalid', role: 'worker', current_task: 'invalid', started_at: 'not-a-date' },
    { id: 'future', role: 'worker', current_task: 'future', started_at: '2026-09-25T12:00:01Z' }
  ];
  const fetchImpl = async url => response(url === '/runtime/catalog' ? { agents: [], skills: [] }
    : url === '/runtime/tasks' ? tasks()
      : url === '/runtime/telemetry' ? telemetry() : current);
  const ui = await mountIntegratedDashboard({ fetchImpl, DateImpl: FixedDate });
  const text = ui.document.querySelector('#agents').textContent;
  assert.match(text, /edge.*60m.*reported running.*within past hour/s);
  assert.match(text, /older.*60m.*not started\/resumed within past hour.*liveness unconfirmed/s);
  assert.match(text, /missing.*unknown.*liveness unconfirmed/s);
  assert.match(text, /invalid.*unknown.*liveness unconfirmed/s);
  assert.match(text, /future.*future start.*liveness unconfirmed/s);
  assert.match(text, /Reported running: 5.*within past hour: 1.*unknown start: 4.*No live liveness check/s);
  assert.doesNotMatch(text, /0 live agents|confirmed live/i);
});

test('preview rejection after leaving its route cannot append an error to Guide', async () => {
  const delayedSpecs = deferred();
  let firstSpecs = true;
  const fetchImpl = async url => {
    if (url === '/runtime/catalog') return response({ agents: [], skills: [] });
    if (url === '/runtime/tasks') return response(tasks());
    if (url === '/runtime/telemetry') return response(telemetry());
    if (url === '/runtime/task-specs') {
      if (firstSpecs) { firstSpecs = false; return delayedSpecs.promise; }
      return response({ taskSpecs: [] });
    }
    return response(snapshot());
  };
  const ui = await mountIntegratedDashboard({ fetchImpl });
  await ui.navigate('#preview');
  await ui.navigate('#guide');
  delayedSpecs.reject(Error('PRIVATE_PREVIEW_PATH'));
  await ui.settle();
  assert.ok(ui.document.querySelector('[data-guide-choice="existing"]'));
  assert.equal(Boolean(ui.document.querySelector('#preview-error')), false);
  assert.doesNotMatch(ui.document.querySelector('#app').textContent, /Preview Lab unavailable|PRIVATE_PREVIEW_PATH/);
  await ui.navigate('#preview');
  assert.ok(ui.document.querySelector('#preview-artifacts'));
  assert.equal(Boolean(ui.document.querySelector('#preview-error')), false);
});

test('older Preview success cannot displace a newer visit or its selected artifact', async () => {
  const oldSpecs = deferred(), oldSnapshot = deferred();
  const newSpecs = deferred(), newSnapshot = deferred();
  const specsQueue = [oldSpecs, newSpecs];
  const snapshotQueue = [oldSnapshot, newSnapshot];
  let previewReads = false;
  const newestSpecs = { taskSpecs: [{ title: 'Fresh spec', path: '.ai/tasks/fresh.md', content: 'Fresh details' }] };
  const newestSnapshot = snapshot('Current goal', 'fresh-agent', [
    { label: 'First screen', href: '/preview/demo-ui.html?screen=one' },
    { label: 'Selected screen', href: '/preview/demo-ui.html?screen=two' }
  ]);
  const fetchImpl = async url => {
    if (url === '/runtime/catalog') return response({ agents: [], skills: [] });
    if (url === '/runtime/tasks') return response(tasks());
    if (url === '/runtime/telemetry') return response(telemetry());
    if (url === '/runtime/task-specs') return specsQueue.shift()?.promise ?? response(newestSpecs);
    return previewReads ? snapshotQueue.shift()?.promise ?? response(newestSnapshot) : response(snapshot());
  };
  const ui = await mountIntegratedDashboard({ fetchImpl });
  previewReads = true;
  await ui.navigate('#preview');
  await ui.navigate('#guide');
  await ui.navigate('#preview');
  newSpecs.resolve(response(newestSpecs)); newSnapshot.resolve(response(newestSnapshot));
  await ui.settle();
  const host = ui.document.querySelector('#preview-artifacts');
  const tabs = host.querySelectorAll('[role="tab"]');
  tabs[1].click();
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.match(ui.document.querySelector('#task-specs').textContent, /Fresh spec/);
  oldSpecs.resolve(response({ taskSpecs: [{ title: 'Old spec', path: '.ai/tasks/old.md', content: 'Old details' }] }));
  oldSnapshot.resolve(response(snapshot('Old goal', 'old-agent', [{ label: 'Old screen', href: '/preview/old.html' }])));
  await ui.settle();
  await ui.tick();
  assert.match(ui.document.querySelector('#task-specs').textContent, /Fresh spec/);
  assert.doesNotMatch(ui.document.querySelector('#task-specs').textContent, /Old spec/);
  assert.equal(ui.document.querySelectorAll('#preview-artifacts [role="tab"]')[1].getAttribute('aria-selected'), 'true');
  assert.equal(ui.document.querySelector('#preview-artifacts iframe').src, '/preview/demo-ui.html?screen=two');
});
