import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.value = '';
    this._text = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this._text = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) { const set = this.listeners.get(name) ?? new Set(); set.add(listener); this.listeners.set(name, set); }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  dispatch(name, extras = {}) {
    const event = { type: name, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, clientX: 100, clientY: 100, pointerId: 1, ...extras };
    for (const listener of this.listeners.get(name) ?? []) listener(event);
    return event;
  }
  click() { this.dispatch('click'); }
  keydown(key) { this.dispatch('keydown', { key }); }
  focus() { this.ownerDocument.activeElement = this; }
  setPointerCapture(id) { this.ownerDocument.capturedPointers.set(id, this); }
  hasPointerCapture(id) { return this.ownerDocument.capturedPointers.get(id) === this; }
  releasePointerCapture(id) { this.ownerDocument.capturedPointers.delete(id); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 440 }; }
}
class FakeDocument {
  constructor() { this.head = new FakeElement('head', this); this.capturedPointers = new Map(); this.outside = new FakeElement('div', this); }
  createElement(name) { return new FakeElement(name, this); }
  createElementNS(_namespace, name) { return this.createElement(name); }
  querySelector(selector) {
    if (selector === '[data-agent-network-styles]') return descendants(this.head, element => element.getAttribute('data-agent-network-styles') !== null)[0] ?? null;
    return null;
  }
  dispatchOutside(name, extras = {}) {
    const pointerId = extras.pointerId ?? 1;
    (this.capturedPointers.get(pointerId) || this.outside).dispatch(name, { pointerId, ...extras });
  }
}
function descendants(root, predicate) {
  return root.children.flatMap(child => [ ...(predicate(child) ? [child] : []), ...descendants(child, predicate) ]);
}
const find = (root, attribute, value) => descendants(root, element => element.getAttribute(`data-${attribute}`) === value)[0];
const text = root => root.textContent;
const fixture = () => { const document = new FakeDocument(); return { document, host: document.createElement('div') }; };

const source = readFileSync(new URL('../preview/agent-network.js', import.meta.url), 'utf8');
const context = { structuredClone };
runInNewContext(source, context);
const api = context.AgentSignalNetwork;

const snapshot = {
  status: {
    agents: [
      { id: 'worker-a', role: 'worker', status: 'completed', current_task: 'UI words only', started_at: '2026-09-25T00:00:00Z', stopped_at: '2026-09-25T00:02:00Z' },
      { id: 'verifier-1', role: 'verifier', status: 'failed', task_id: 'verify-ui' }
    ],
    active_agents: [{ id: 'worker-b', role: 'worker', status: 'running', task_id: 'api-task' }],
    signals: [
      { time: '2026-09-25T00:00:00Z', from: 'main', to: 'worker-a', kind: 'delegate', summary: 'UI words only' },
      { time: '2026-09-25T00:01:00Z', from: 'worker-a', to: 'orphan-agent', kind: 'handoff', summary: 'Exact stored edge', task_id: 'ui-task' },
      { time: '2026-09-25T00:02:00Z', from: 'verifier-1', to: 'worker-b', kind: 'retry', summary: 'Retry requested', status: 'failed', task_id: 'verify-ui' }
    ], artifact_preview_links: [], verification: { status: 'failed', checks: [] }
  },
  tasks: { tasks: [{ id: 'ui-task', title: 'UI', owner: 'worker-a' }, { id: 'api-task', title: 'API', owner: 'worker-b' }] },
  claims: { claims: [{ agent_id: 'worker-b', scopes: ['src/api'] }] }, events: []
};
const catalog = { agents: [{ id: 'worker', model: 'gpt-6-sol', reasoning: 'medium' }] };

test('buildModel uses only lifecycle records and stored signal endpoints and edges', () => {
  const model = api.buildModel(snapshot, catalog, { mode: 'history', filter: 'all' });
  assert.deepEqual(Array.from(model.nodes, node => node.id).sort(), ['main', 'orphan-agent', 'verifier-1', 'worker-a', 'worker-b']);
  assert.equal(model.edges.length, 3);
  assert.equal(model.nodes.find(node => node.id === 'orphan-agent').status, 'unknown');
  assert.equal(model.nodes.find(node => node.id === 'worker-b').status, 'active');
  assert.equal(model.nodes.find(node => node.id === 'worker-a').catalog.model, 'gpt-6-sol');
  assert.deepEqual(Array.from(model.nodes.find(node => node.id === 'worker-b').claims), ['src/api']);
});

test('task matching requires exact task_id or task owner and never summary text', () => {
  const model = api.buildModel(snapshot, catalog, { mode: 'history', filter: 'task', taskId: 'ui-task' });
  assert.equal(model.edges[0].matchesFilter, false);
  assert.equal(model.edges[1].matchesFilter, true);
  assert.equal(model.nodes.find(node => node.id === 'worker-a').matchesFilter, true);
  assert.equal(model.nodes.find(node => node.id === 'orphan-agent').matchesFilter, false);
});

test('live and history retain edges while only exact active and failure records are emphasized', () => {
  const live = api.buildModel(snapshot, catalog, { mode: 'live', filter: 'active' });
  const history = api.buildModel(snapshot, catalog, { mode: 'history', filter: 'failures' });
  assert.equal(live.edges.length, 3);
  assert.equal(live.edges[2].matchesFilter, true);
  assert.equal(live.edges[0].matchesFilter, false);
  assert.equal(history.edges.length, 3);
  assert.equal(history.edges[2].matchesFilter, true);
  assert.equal(history.edges[1].matchesFilter, false);
  assert.equal(history.nodes.find(node => node.id === 'verifier-1').matchesFilter, true);
});

test('layout is finite and repeatable for empty, singleton, and linked graphs', () => {
  const model = api.buildModel(snapshot, catalog, { mode: 'history', filter: 'all' });
  const first = api.layout(model, 800, 440);
  const second = api.layout(model, 800, 440);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  for (const node of first) assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
  for (let i = 0; i < first.length; i++) for (let j = i + 1; j < first.length; j++) {
    assert.ok(Math.hypot(first[i].x - first[j].x, first[i].y - first[j].y) >= 34);
  }
  assert.equal(api.layout({ nodes: [], edges: [] }, 800, 440).length, 0);
  assert.equal(api.layout({ nodes: [{ id: 'only' }], edges: [] }, 800, 440).length, 1);
});

test('retained thirty-agent layout keeps every node apart', () => {
  const nodes = Array.from({ length: 30 }, (_, index) => ({ id: `agent-${index}` }));
  const placed = api.layout({ nodes, edges: [] }, 800, 440);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    assert.ok(Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y) >= 34, `${placed[i].id} overlaps ${placed[j].id}`);
  }
});

test('controller preserves selection, mode, filter, task, and transform across polling update', () => {
  const { host } = fixture();
  const controller = api.create(host, { staticMode: false });
  controller.update(snapshot, catalog);
  find(host, 'node-id', 'worker-b').click();
  assert.match(text(find(host, 'network-detail', '')), /worker-b/);
  find(host, 'edge-index', '2').click();
  assert.match(text(find(host, 'network-detail', '')), /Retry requested/);
  const mode = find(host, 'network-mode', ''); mode.value = 'history'; mode.dispatch('change');
  const filter = find(host, 'network-filter', ''); filter.value = 'task'; filter.dispatch('change');
  const task = find(host, 'network-task', ''); task.value = 'ui-task'; task.dispatch('change');
  find(host, 'network-action', 'zoom-in').click();
  const before = controller.getState();
  controller.update(structuredClone(snapshot), catalog);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState())), JSON.parse(JSON.stringify(before)));
  assert.equal(host.children.length, 1);
  controller.destroy();
  assert.equal(host.children.length, 0);
});

test('legacy selected signal survives unrelated head pruning but clears when duplicates are pruned', () => {
  const { host } = fixture();
  const controller = api.create(host);
  const duplicate = { time: '2026-09-25T01:00:00Z', from: 'worker-a', to: 'worker-b', kind: 'handoff', summary: 'Same event' };
  const signals = [snapshot.status.signals[0], duplicate, duplicate, snapshot.status.signals[2]];
  controller.update({ ...snapshot, status: { ...snapshot.status, signals } }, catalog);
  const initialKeys = Array.from(api.buildModel({ ...snapshot, status: { ...snapshot.status, signals } }, catalog, {}).edges, edge => edge.key);
  assert.notEqual(initialKeys[1], initialKeys[2]);
  find(host, 'edge-index', '2').click();
  const selected = controller.getState().selection;
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: signals.slice(1) } }, catalog);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().selection)), JSON.parse(JSON.stringify(selected)));
  assert.match(text(find(host, 'network-detail', '')), /Same event/);
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: signals.slice(2) } }, catalog);
  assert.equal(controller.getState().selection, null);
  controller.destroy();
});

test('stored signal ID survives the 51st append and head prune, then clears when pruned', () => {
  const { host } = fixture();
  const controller = api.create(host);
  const signals = Array.from({ length: 50 }, (_, index) => ({
    id: `signal-${index}`, time: '2026-09-25T00:00:00Z', from: 'main', to: 'worker-a', kind: 'handoff', summary: `Signal ${index}`
  }));
  controller.update({ ...snapshot, status: { ...snapshot.status, signals } }, catalog);
  find(host, 'edge-index', '1').click();
  const selected = controller.getState().selection;
  assert.equal(selected.key, 'id:signal-1');
  const retained = signals.slice(1).concat({ ...signals[0], id: 'signal-50', summary: 'Signal 50' });
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: retained } }, catalog);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().selection)), JSON.parse(JSON.stringify(selected)));
  assert.match(text(find(host, 'network-detail', '')), /Signal 1/);
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: retained.slice(1) } }, catalog);
  assert.equal(controller.getState().selection, null);
  controller.destroy();
});

test('identical ID-bearing append cannot retarget a selected signal', () => {
  const { host } = fixture();
  const controller = api.create(host);
  const signal = { id: 'original', time: '2026-09-25T00:00:00Z', from: 'main', to: 'worker-a', kind: 'handoff', summary: 'Same' };
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: [signal] } }, catalog);
  find(host, 'edge-index', '0').click();
  const selected = controller.getState().selection;
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: [signal, { ...signal, id: 'newer' }] } }, catalog);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().selection)), JSON.parse(JSON.stringify(selected)));
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: [{ ...signal, id: 'newer' }] } }, catalog);
  assert.equal(controller.getState().selection, null);
  controller.destroy();
});

test('legacy selection clears when an identical signal is appended', () => {
  const { host } = fixture();
  const controller = api.create(host);
  const signal = { time: '2026-09-25T00:00:00Z', from: 'main', to: 'worker-a', kind: 'handoff', summary: 'Same' };
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: [signal] } }, catalog);
  find(host, 'edge-index', '0').click();
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: [signal, { ...signal }] } }, catalog);
  assert.equal(controller.getState().selection, null);
  controller.destroy();
});

test('legacy selection clears when identical prune and append hide a replacement', () => {
  const { host } = fixture();
  const controller = api.create(host);
  const duplicate = { time: '2026-09-25T00:00:00Z', from: 'main', to: 'worker-a', kind: 'handoff', summary: 'Same' };
  const other = { ...duplicate, summary: 'Other' };
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: [duplicate, duplicate, other] } }, catalog);
  find(host, 'edge-index', '1').click();
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: [duplicate, other, duplicate] } }, catalog);
  assert.equal(controller.getState().selection, null);
  controller.destroy();
});

test('legacy selection clears when one identical replacement keeps the match count unchanged', () => {
  const { host } = fixture();
  const controller = api.create(host);
  const selected = { time: '2026-09-25T00:00:00Z', from: 'main', to: 'worker-a', kind: 'handoff', summary: 'Same' };
  const other = { ...selected, summary: 'Other' };
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: [selected, other] } }, catalog);
  find(host, 'edge-index', '0').click();
  controller.update({ ...snapshot, status: { ...snapshot.status, signals: [other, { ...selected }] } }, catalog);
  assert.equal(controller.getState().selection, null);
  controller.destroy();
});

test('keyboard selection, controls, wheel, pan, fit, reset, and stale selection work', () => {
  const { host, document } = fixture();
  const controller = api.create(host);
  controller.update(snapshot, catalog);
  const node = find(host, 'node-id', 'worker-b');
  assert.equal(node.getAttribute('role'), 'button');
  assert.equal(node.getAttribute('tabindex'), '0');
  node.keydown('Enter');
  assert.match(text(find(host, 'network-detail', '')), /worker-b/);
  assert.equal(document.activeElement, find(host, 'node-id', 'worker-b'));
  find(host, 'edge-index', '1').keydown(' ');
  assert.match(text(find(host, 'network-detail', '')), /Exact stored edge/);
  assert.equal(document.activeElement, find(host, 'edge-index', '1'));
  find(host, 'network-action', 'zoom-in').click();
  find(host, 'network-action', 'zoom-out').click();
  const svg = descendants(host, element => element.tagName === 'SVG')[0];
  svg.dispatch('wheel', { deltaY: -120 });
  assert.ok(controller.getState().transform.scale > 1);
  svg.dispatch('pointerdown', { clientX: 100, clientY: 100 });
  svg.dispatch('pointermove', { clientX: 125, clientY: 120 });
  svg.dispatch('pointerup');
  assert.ok(controller.getState().transform.x !== 0);
  find(host, 'network-action', 'fit').click();
  assert.ok(Number.isFinite(controller.getState().transform.scale));
  find(host, 'network-action', 'reset').click();
  assert.equal(controller.getState().transform.scale, 1);
  controller.update({ status: { agents: [], active_agents: [], signals: [] }, tasks: { tasks: [] } }, catalog);
  assert.equal(controller.getState().selection, null);
  assert.match(text(host), /No agents or signals/);
});

test('background pan ends after pointer release outside the graph', () => {
  const { host, document } = fixture();
  const controller = api.create(host);
  controller.update(snapshot, catalog);
  const svg = descendants(host, element => element.tagName === 'SVG')[0];
  svg.dispatch('pointerdown', { pointerId: 7, clientX: 100, clientY: 100 });
  svg.dispatch('pointermove', { pointerId: 7, clientX: 130, clientY: 120 });
  const releasedAt = controller.getState().transform;
  document.dispatchOutside('pointerup', { pointerId: 7, clientX: 200, clientY: 200 });
  svg.dispatch('pointermove', { pointerId: 7, clientX: 150, clientY: 150 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState().transform)), JSON.parse(JSON.stringify(releasedAt)));
  assert.equal(document.capturedPointers.size, 0);
  controller.destroy();
});

test('named mode, filter, and task controls apply Active and Failures views', () => {
  const { host } = fixture();
  const controller = api.create(host);
  controller.update(snapshot, catalog);
  const mode = find(host, 'network-mode', '');
  const filter = find(host, 'network-filter', '');
  const task = find(host, 'network-task', '');
  assert.equal(mode.getAttribute('aria-label'), 'Network mode');
  assert.equal(filter.getAttribute('aria-label'), 'Network filter');
  assert.equal(task.getAttribute('aria-label'), 'Network task');
  filter.value = 'active'; filter.dispatch('change');
  assert.equal(controller.getState().filter, 'active');
  assert.equal(find(host, 'node-id', 'worker-b').getAttribute('data-emphasis'), 'true');
  assert.equal(find(host, 'node-id', 'worker-a').getAttribute('data-emphasis'), 'false');
  filter.value = 'failures'; filter.dispatch('change');
  assert.equal(controller.getState().filter, 'failures');
  assert.equal(find(host, 'node-id', 'verifier-1').getAttribute('data-emphasis'), 'false');
  mode.value = 'history'; mode.dispatch('change');
  assert.equal(controller.getState().mode, 'history');
  assert.equal(find(host, 'node-id', 'verifier-1').getAttribute('data-emphasis'), 'true');
  assert.equal(find(host, 'node-id', 'worker-b').getAttribute('data-emphasis'), 'false');
  const retry = descendants(host, element => element.getAttribute('data-kind') === 'retry')[0];
  assert.equal(retry.getAttribute('data-emphasis'), 'true');
  controller.destroy();
});

test('static mode is named Snapshot History and tolerates old snapshots without metadata', () => {
  const { host, document } = fixture();
  const controller = api.create(host, { staticMode: true });
  controller.update({ status: { agents: [{ id: 'solo', role: 'worker' }], signals: [{ from: 'solo', to: 'main', kind: 'result', summary: 'done' }] } }, { agents: [] });
  assert.match(text(host), /Snapshot History/);
  assert.equal(find(host, 'network-mode', ''), undefined);
  assert.equal(document.head.children.length, 1);
  controller.destroy();
});
