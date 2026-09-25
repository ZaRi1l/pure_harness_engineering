import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { renderStatus } from '../scripts/status.mjs';
import { renderStaticPreview } from '../scripts/generate-preview.mjs';

const snapshot = { status: { current_goal: 'Ship <safe>', phase: 'execution', progress: { completed: 1, total: 2 }, active_agents: [], verification: { checks: [], status: 'passed' }, warnings: [{ message: 'Needs review' }] }, tasks: { tasks: [{ title: 'Implement', status: 'completed', owner: 'worker' }] }, claims: { claims: [{ agent_id: 'worker', scopes: ['src/backend/'] }] } };
const networkSource = readFileSync(new URL('../preview/agent-network.js', import.meta.url), 'utf8');
class Element {
  constructor(name, document) { this.tagName = name; this.ownerDocument = document; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this._text = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  dispatch(name) { this.listeners.get(name)?.({ type: name, target: this, preventDefault() {} }); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 440 }; }
}
const descendants = root => root.children.flatMap(child => [child, ...descendants(child)]);
const find = (root, name, value) => descendants(root).find(child => child.getAttribute(`data-${name}`) === value);
function executeStatic(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(script, 'static preview includes an inline renderer');
  const document = { head: null, host: null, createElement(name) { return new Element(name, this); }, createElementNS(_namespace, name) { return this.createElement(name); }, querySelector(selector) { if (selector === '#agent-network') return this.host; if (selector === '[data-agent-network-styles]') return descendants(this.head).find(item => item.getAttribute('data-agent-network-styles') !== null) ?? null; return null; } };
  document.head = document.createElement('head');
  document.host = document.createElement('div');
  const context = { document, structuredClone };
  runInNewContext(script, context);
  return { host: document.host, context };
}
test('status CLI renders claims and watchdog warnings', () => { const text = renderStatus(snapshot); assert.match(text, /src\/backend/); assert.match(text, /Needs review/); });
test('static preview renders snapshot and Task Specs safely', () => { const html = renderStaticPreview(snapshot, [{ title: 'Plan <safe>', path: '.ai/tasks/plan.md', content: '# Plan <safe>' }]); assert.match(html, /Ship &lt;safe&gt;/); assert.match(html, /Write Claims/); assert.match(html, /Plan \/ Task Specs/); assert.match(html, /Plan &lt;safe&gt;/); });

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
