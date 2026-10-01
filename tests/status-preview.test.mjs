import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { renderStatus } from '../scripts/status.mjs';
import { renderStaticPreview } from '../scripts/generate-preview.mjs';
import { createTaskEditor, sortTasks } from '../preview/task-editor.js';

const snapshot = { status: { current_goal: 'Ship <safe>', phase: 'execution', progress: { completed: 1, total: 2 }, active_agents: [], verification: { checks: [], status: 'passed' }, warnings: [{ message: 'Needs review' }] }, tasks: { tasks: [{ title: 'Implement', status: 'completed', owner: 'worker' }] }, claims: { claims: [{ agent_id: 'worker', scopes: ['src/backend/'] }] } };
const networkSource = readFileSync(new URL('../preview/agent-network.js', import.meta.url), 'utf8');
const preferencesSource = readFileSync(new URL('../preview/preferences.js', import.meta.url), 'utf8');
class Element {
  constructor(name, document) { this.tagName = name; this.ownerDocument = document; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.style = { setProperty() {} }; this.value = ''; this._text = ''; this.onclick = null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  dispatch(name) { this.listeners.get(name)?.({ type: name, target: this, preventDefault() {} }); }
  click() { this.onclick?.({ type: 'click', target: this, preventDefault() {} }); this.dispatch('click'); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 440 }; }
}
class TaskElement extends Element {
  append(...children) { for (const child of children) child.parentNode = this; super.append(...children); }
  replaceChildren(...children) { for (const child of children) child.parentNode = this; super.replaceChildren(...children); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}
function taskDOM() {
  const document = { activeElement: null, createElement(name) { return new TaskElement(name, this); } };
  return { document, host: document.createElement('section') };
}
const task = (id = 'a', overrides = {}) => ({ id, title: 'Original', status: 'pending', branch: null, owner: 'worker', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', revision: 'rev-1', ...overrides });
const action = (host, value) => find(host, 'task-action', value);
const field = (host, value) => find(host, 'task-field', value);

test('task editor preserves add draft controls, focus, selection, scroll and validation across polls without blur writes', () => {
  const { host, document } = taskDOM();
  let writes = 0;
  const editor = createTaskEditor(host, { fetchImpl: () => { writes++; }, translate: key => key });
  editor.update([task()], 'token');
  action(host, 'add').click();
  const title = field(host, 'title');
  title.value = ''; title.focus(); title.setSelectionRange(0, 0); title.scrollTop = 13;
  action(host, 'save').click();
  const message = find(host, 'task-message', 'validation');
  assert.ok(message?.textContent);
  title.value = 'Draft'; title.setSelectionRange(2, 4);
  const live = task('a', { title: 'Updated elsewhere', revision: 'rev-2' });
  editor.update([live], 'token');
  assert.equal(field(host, 'title'), title);
  assert.equal(title.value, 'Draft');
  assert.equal(document.activeElement, title);
  assert.deepEqual([title.selectionStart, title.selectionEnd, title.scrollTop], [2, 4, 13]);
  assert.equal(find(host, 'task-message', 'validation'), message);
  title.dispatch('blur');
  assert.equal(writes, 0);
  action(host, 'cancel').click();
  assert.equal(field(host, 'title'), undefined);
  editor.destroy();
});

test('task editor keeps edit revision and draft on conflict until explicit reload', async () => {
  const { host, document } = taskDOM();
  let request;
  const current = task('a', { title: 'Server', revision: 'rev-2' });
  const editor = createTaskEditor(host, { fetchImpl: async (_url, init) => { request = init; return { ok: false, status: 409, json: async () => ({ current }) }; }, translate: key => key });
  editor.update([task()], 'token');
  action(host, 'edit-a').click();
  const title = field(host, 'title'); title.value = 'My draft'; title.focus(); title.setSelectionRange(2, 5); title.scrollTop = 8;
  editor.update([current], 'token');
  assert.equal(field(host, 'title'), title);
  assert.equal(title.value, 'My draft');
  assert.equal(document.activeElement, title);
  assert.deepEqual([title.selectionStart, title.selectionEnd, title.scrollTop], [2, 5, 8]);
  action(host, 'save').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(request.body), { title: 'My draft', status: 'pending', branch: null, revision: 'rev-1' });
  assert.equal(request.headers['x-task-write-token'], 'token');
  assert.equal(title.value, 'My draft');
  assert.match(host.textContent, /Server/);
  action(host, 'reload').click();
  assert.equal(field(host, 'title').value, 'Server');
  editor.destroy();
});

test('task editor adopts saved record and retains it after network retry and a stale list', async () => {
  const { host } = taskDOM();
  let calls = 0;
  const created = task('new', { title: 'Saved', revision: 'rev-new' });
  const editor = createTaskEditor(host, { fetchImpl: async () => { if (++calls === 1) throw Error('offline'); return { ok: true, status: 201, json: async () => created }; }, translate: key => key });
  editor.update([], 'token');
  action(host, 'add').click(); field(host, 'title').value = 'Saved';
  action(host, 'save').click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(field(host, 'title').value, 'Saved');
  assert.ok(action(host, 'retry'));
  action(host, 'retry').click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(field(host, 'title'), undefined);
  assert.match(host.textContent, /Saved/);
  editor.update([task('old')], 'token');
  assert.match(host.textContent, /Saved/);
  editor.update([task('new', { title: 'External update', revision: 'rev-later' })], 'token');
  assert.match(host.textContent, /External update/);
  assert.doesNotMatch(host.textContent, /Saved/);
  editor.destroy();
});

test('an accepted edit does not mask a newer external revision that arrives before its own poll echo', async () => {
  const { host } = taskDOM();
  const saved = task('a', { title: 'Mine', revision: 'rev-2' });
  const editor = createTaskEditor(host, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => saved }), translate: key => key });
  editor.update([task()], 'token');
  action(host, 'edit-a').click(); field(host, 'title').value = 'Mine';
  action(host, 'save').click(); await new Promise(resolve => setImmediate(resolve));
  editor.update([task()], 'token');
  assert.match(host.textContent, /Mine/);
  editor.update([task('a', { title: 'Theirs', revision: 'rev-3' })], 'token');
  assert.match(host.textContent, /Theirs/);
  assert.doesNotMatch(host.textContent, /Mine/);
  editor.destroy();
});

test('rapid Save clicks and Enter submit dispatch only one in-flight add', async () => {
  const { host } = taskDOM();
  let resolveRequest;
  let calls = 0;
  const editor = createTaskEditor(host, { fetchImpl: () => { calls++; return new Promise(resolve => { resolveRequest = resolve; }); }, translate: key => key });
  editor.update([], 'token');
  action(host, 'add').click(); field(host, 'title').value = 'One';
  action(host, 'save').click(); action(host, 'save').click();
  descendants(host).find(node => node.tagName === 'form').onsubmit({ preventDefault() {} });
  assert.equal(calls, 1);
  resolveRequest({ ok: true, status: 201, json: async () => task('new', { title: 'One', revision: 'rev-2' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(field(host, 'title'), undefined);
  editor.destroy();
});

test('task ordering uses updated time, falls back to created time, and leaves undated rows last in either direction', () => {
  const records = [
    task('updated', { updated_at: '2026-01-03T00:00:00Z' }),
    task('created', { updated_at: 'invalid', created_at: '2026-01-02T00:00:00Z' }),
    task('undated', { updated_at: '', created_at: '' }),
    task('tie', { updated_at: '2026-01-03T00:00:00Z' })
  ];
  assert.deepEqual(sortTasks(records).map(item => item.id), ['tie', 'updated', 'created', 'undated']);
  assert.deepEqual(sortTasks(records, true).map(item => item.id), ['created', 'tie', 'updated', 'undated']);
});

test('invalid_dates_sort_last in both directions while a valid created time is a fallback', () => {
  const records = [
    task('undated', { created_at: 'invalid', updated_at: '' }),
    task('fallback', { created_at: '2026-01-04T00:00:00Z', updated_at: 'invalid' }),
    task('updated', { created_at: 'invalid', updated_at: '2026-01-05T00:00:00Z' })
  ];
  assert.deepEqual(sortTasks(records).map(item => item.id), ['updated', 'fallback', 'undated']);
  assert.deepEqual(sortTasks(records, true).map(item => item.id), ['fallback', 'updated', 'undated']);
});

test('task rows label status, branch, owner, created, and updated without treating owner as branch', () => {
  const { host } = taskDOM();
  const editor = createTaskEditor(host, { translate: key => key });
  editor.update([task('a', { title: 'Record', branch: null, owner: 'reviewer', created_at: '2026-01-01T00:00:00Z', updated_at: 'invalid' })], 'token');
  const row = descendants(host).find(node => node.tagName === 'li');
  assert.match(row.textContent, /task.status: pending/);
  assert.match(row.textContent, /task.branch: common.none/);
  assert.match(row.textContent, /task.owner: reviewer/);
  assert.match(row.textContent, /task.created: 2026-01-01T00:00:00Z/);
  assert.match(row.textContent, /task.updated: common.unknown/);
  action(host, 'edit-a').click();
  assert.equal(field(host, 'owner'), undefined);
  editor.destroy();
});

test('task sort toggle persists through polling and remount, but resets on module reload', async () => {
  const records = [task('older', { title: 'Older', updated_at: '2026-01-02T00:00:00Z' }), task('newer', { title: 'Newer', updated_at: '2026-01-03T00:00:00Z' })];
  const first = taskDOM();
  const editor = createTaskEditor(first.host, { translate: key => key });
  editor.update(records, null);
  assert.match(descendants(first.host).find(node => node.tagName === 'li').textContent, /Newer/);
  action(first.host, 'sort').click();
  assert.equal(action(first.host, 'sort').textContent, 'task.newest');
  editor.update(records, null);
  assert.match(descendants(first.host).find(node => node.tagName === 'li').textContent, /Older/);
  editor.destroy();
  const second = taskDOM();
  const remounted = createTaskEditor(second.host, { translate: key => key });
  remounted.update(records, null);
  assert.equal(action(second.host, 'sort').textContent, 'task.newest');
  assert.match(descendants(second.host).find(node => node.tagName === 'li').textContent, /Older/);
  const { createTaskEditor: freshController } = await import(`../preview/task-editor.js?reload=${Date.now()}`);
  const reloaded = taskDOM();
  const fresh = freshController(reloaded.host, { translate: key => key });
  fresh.update(records, null);
  assert.match(descendants(reloaded.host).find(node => node.tagName === 'li').textContent, /Newer/);
  fresh.destroy();
  action(second.host, 'sort').click();
  remounted.destroy();
});
const descendants = root => root.children.flatMap(child => [child, ...descendants(child)]);
const find = (root, name, value) => descendants(root).find(child => child.getAttribute(`data-${name}`) === value);
function executeStatic(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(script, 'static preview includes an inline renderer');
  const document = { head: null, host: null, preferencesHost: null, documentElement: null, createElement(name) { return new Element(name, this); }, createElementNS(_namespace, name) { return this.createElement(name); }, querySelector(selector) { if (selector === '#agent-network') return this.host; if (selector === '#preview-preferences') return this.preferencesHost; if (selector === '[data-agent-network-styles]') return descendants(this.head).find(item => item.getAttribute('data-agent-network-styles') !== null) ?? null; return null; }, querySelectorAll() { return []; } };
  document.head = document.createElement('head');
  document.documentElement = document.createElement('html');
  document.host = document.createElement('div');
  document.preferencesHost = document.createElement('div');
  const storage = new Map();
  const context = { document, structuredClone, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) } };
  runInNewContext(script, context);
  return { host: document.host, preferencesHost: document.preferencesHost, document, context };
}
test('status CLI renders claims and watchdog warnings', () => { const text = renderStatus(snapshot); assert.match(text, /src\/backend/); assert.match(text, /Needs review/); });
test('static preview renders snapshot and Task Specs safely', () => { const html = renderStaticPreview(snapshot, [{ title: 'Plan <safe>', path: '.ai/tasks/plan.md', content: '# Plan <safe>' }]); assert.match(html, /Ship &lt;safe&gt;/); assert.match(html, /Write Claims/); assert.match(html, /Plan \/ Task Specs/); assert.match(html, /Plan &lt;safe&gt;/); });

test('static preview declares a device-width viewport', () => {
  const html = renderStaticPreview(snapshot);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('static preview embeds shared renderer and script-safe snapshot without polling', () => {
  const hostile = structuredClone(snapshot);
  hostile.status.agents = [{ id: 'worker', role: 'worker', status: 'completed' }];
  hostile.status.signals = [{ time: '2026-09-25T00:00:00Z', from: 'main', to: 'worker', kind: 'delegate', summary: '</script><script>globalThis.pwned=true</script>' }];
  const html = renderStaticPreview(hostile, [], { agents: [] }, networkSource);
  assert.match(html, /Agent Signal Network/);
  assert.doesNotMatch(html, /<\/script><script>globalThis\.pwned/);
  assert.doesNotMatch(html, /setInterval|runtime\/snapshot/);
  const { host, context } = executeStatic(html);
  assert.equal(context.pwned, undefined);
  assert.match(host.textContent, /Snapshot History/);
  assert.ok(find(host, 'edge-index', '0'));
});

test('static preview embeds shared language and theme controls without polling', () => {
  const html = renderStaticPreview(snapshot, [], { agents: [] }, networkSource, preferencesSource);
  assert.match(html, /id="preview-preferences"/);
  assert.match(html, /data-i18n="section\.goal"/);
  assert.match(html, /data-theme="light"/);
  assert.doesNotMatch(html, /setInterval|runtime\/snapshot/);
  const rendered = executeStatic(html);
  assert.equal(descendants(rendered.host).some(node => node.getAttribute('data-task-action') !== null), false);
  const language = descendants(rendered.preferencesHost).find(node => node.dataset.preferenceAction === 'language');
  const theme = descendants(rendered.preferencesHost).find(node => node.dataset.preferenceAction === 'theme');
  assert.ok(language && theme);
  language.click();
  assert.match(rendered.host.textContent, /Snapshot 기록/);
  theme.click();
  assert.equal(rendered.document.documentElement.dataset.theme, 'light');
});

test('static preview marks empty and unassigned interface fallbacks for translation', () => {
  const empty = structuredClone(snapshot);
  empty.tasks.tasks = [];
  empty.claims.claims = [];
  const emptyHtml = renderStaticPreview(empty, [], { agents: [] }, networkSource, preferencesSource);
  assert.equal((emptyHtml.match(/data-i18n="common\.none"/g) || []).length, 3);
  assert.doesNotMatch(emptyHtml, /<li>none<\/li>|<p>none<\/p>/);

  const unassigned = structuredClone(snapshot);
  delete unassigned.tasks.tasks[0].owner;
  const unassignedHtml = renderStaticPreview(unassigned, [], { agents: [] }, networkSource, preferencesSource);
  assert.match(unassignedHtml, /data-i18n="dashboard\.unassigned">unassigned<\/span>/);
});

test('static preview escapes mixed-case renderer closing tags before HTML parsing', () => {
  const source = networkSource + '\n// </ScRiPt><script>globalThis.pwned=true</SCRIPT>';
  const html = renderStaticPreview(snapshot, [], { agents: [] }, source);
  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/i)?.[1];
  assert.ok(scriptBody);
  assert.doesNotMatch(scriptBody, /<\/script/i);
  const { host, context } = executeStatic(html);
  assert.match(host.textContent, /Snapshot History/);
  assert.equal(context.pwned, undefined);
});

test('static network handles zero, one, and multiple retained agents with client controls', () => {
  for (const count of [0, 1, 3]) {
    const sample = structuredClone(snapshot);
    sample.status.agents = Array.from({ length: count }, (_, index) => ({ id: `worker-${index}`, role: 'worker', status: 'completed' }));
    sample.status.signals = count > 1 ? [{ id: 'linked', from: 'worker-0', to: 'worker-1', kind: 'handoff', summary: 'handoff' }] : [];
    const { host } = executeStatic(renderStaticPreview(sample, [], { agents: [] }, networkSource));
    assert.match(host.textContent, /Snapshot History/);
    assert.equal(descendants(host).filter(child => child.getAttribute('data-node-id') !== null).length, count);
    if (count) {
      find(host, 'node-id', 'worker-0').dispatch('click');
      assert.match(find(host, 'network-detail', '').textContent, /worker-0/);
      find(host, 'network-action', 'zoom-in').dispatch('click');
      find(host, 'network-action', 'reset').dispatch('click');
    } else assert.match(host.textContent, /No agents or signals/);
  }
});
