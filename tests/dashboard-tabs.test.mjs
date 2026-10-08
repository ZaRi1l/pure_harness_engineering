import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

test('dashboard tabs retain task draft, focus, scroll, and widget instances across polling and locale changes', async () => {
  const source = await readFile(new URL('../preview/dashboard.js', import.meta.url), 'utf8');
  const nodes = new Map();
  const element = () => ({
    children: [], attributes: new Map(), dataset: {}, hidden: false, scrollTop: 0,
    classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    set innerHTML(value) { for (const [, id] of value.matchAll(/id="([^"]+)"/g)) nodes.set(`#${id}`, element()); },
    set textContent(value) { this.text = value; this.children = []; },
    get textContent() { return this.text ?? this.children.map(child => child.textContent).join(''); },
    setAttribute(key, value) { this.attributes.set(key, String(value)); },
    getAttribute(key) { return this.attributes.get(key) ?? null; },
    set id(value) { nodes.set(`#${value}`, this); },
    focus() { document.activeElement = this; }
  });
  for (const selector of ['#app', '#preview-preferences', '#app-tagline', '#sidebar-note']) nodes.set(selector, element());
  const document = { activeElement: null, querySelector: selector => nodes.get(selector), querySelectorAll: () => [], createElement: element };
  const snapshot = { status: { current_goal: 'Keep state', active_agents: [], signals: [], verification: { status: 'passed' }, warnings: [], blockers: [], artifact_preview_links: [] }, claims: { claims: [] }, events: [] };
  const listeners = {};
  const editors = [], panels = [], networks = [];
  let refresh, changePreference;
  const context = {
    document, location: { hash: '#dashboard' }, addEventListener: (name, fn) => { listeners[name] = fn; }, setInterval: fn => { refresh = fn; },
    fetch: async url => ({ json: async () => url === '/runtime/catalog' ? { agents: [], skills: [] } : url === '/runtime/tasks' ? { tasks: [], write_token: 'write-token' } : snapshot }),
    createTaskEditor: host => { const item = { host, draft: '', update() {}, destroy() {} }; editors.push(item); return item; },
    createTelemetryPanel: host => { const item = { host, refresh() {}, rerender() {}, destroy() {} }; panels.push(item); return item; },
    AgentSignalNetwork: { create: host => { const item = { host, update() {}, destroy() {}, setTranslate(fn) { this.localeLabel = fn('network.modeLabel'); } }; networks.push(item); return item; } },
    PreviewPreferences: { create: () => ({ locale: 'en', t: key => key, mount() {}, subscribe(fn) { changePreference = fn; } }) },
    createGuidePanel: () => element(), renderArtifactTabs: () => ({})
  };
  runInNewContext(source.replace(/^import .*?;\s*/gm, ''), context);
  await new Promise(resolve => setImmediate(resolve));
  const pane = name => nodes.get(`#dashboard-pane-${name}`);
  const tab = name => nodes.get(`#dashboard-tab-${name}`);
  assert.equal(tab('overview').getAttribute('aria-selected'), 'true');
  assert.equal(pane('tasks').hidden, true);
  tab('tasks').onclick();
  assert.equal(pane('tasks').hidden, false);
  assert.equal(pane('overview').hidden, true);
  assert.equal(tab('tasks').getAttribute('aria-selected'), 'true');
  assert.equal(tab('overview').getAttribute('aria-selected'), 'false');
  let prevented = false;
  tab('tasks').onkeydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(tab('agents').getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement, tab('agents'));
  editors[0].draft = 'unsaved task';
  nodes.get('#tasks').scrollTop = 63;
  nodes.get('#tasks').focus();
  tab('agents').onclick();
  assert.equal(pane('agents').hidden, false);
  assert.equal(networks.length, 1);
  tab('telemetry').onclick();
  assert.equal(pane('telemetry').hidden, false);
  assert.equal(panels.length, 1);
  refresh();
  changePreference({ locale: 'ko' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(networks[0].localeLabel, 'network.modeLabel');
  assert.equal(tab('telemetry').getAttribute('aria-selected'), 'true');
  assert.equal(editors.length, 1);
  assert.equal(editors[0].draft, 'unsaved task');
  assert.equal(nodes.get('#tasks').scrollTop, 63);
  assert.equal(document.activeElement, nodes.get('#tasks'));
  assert.equal(panels.length, 1);
  assert.equal(networks.length, 1);
});
