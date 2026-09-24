import assert from 'node:assert/strict';
import test from 'node:test';

let previewModule = {};
try {
  previewModule = await import('../preview/artifact-tabs.js');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const { isEmbeddableArtifact, renderArtifactTabs } = previewModule;

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.disabled = false;
    this.onclick = null;
    this._src = '';
    this.srcAssignments = 0;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  hasChildNodes() { return this.children.length > 0; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  set src(value) { this._src = String(value); this.srcAssignments += 1; }
  get src() { return this._src; }
  click() { if (!this.disabled) this.onclick?.({ preventDefault() {} }); }
  focus() { this.ownerDocument.activeElement = this; }
  keydown(key) { this.onkeydown?.({ key, preventDefault() {} }); }
}

class FakeDocument {
  constructor(origin = 'http://127.0.0.1:8765') { this.defaultView = { location: { origin } }; }
  createElement(tagName) { return new FakeElement(tagName, this); }
}

function fixture(origin) {
  const document = new FakeDocument(origin);
  return { document, host: document.createElement('div') };
}

function descendants(root, predicate) {
  const matches = [];
  for (const child of root.children) {
    if (predicate(child)) matches.push(child);
    matches.push(...descendants(child, predicate));
  }
  return matches;
}

const byTag = (root, tagName) => descendants(root, node => node.tagName === tagName.toUpperCase());
const byAction = (root, action) => descendants(root, node => node.dataset.action === action);

test('artifact preview module exposes the embeddability policy and tab renderer', () => {
  assert.equal(typeof isEmbeddableArtifact, 'function');
  assert.equal(typeof renderArtifactTabs, 'function');
});

test('embeds only same-origin and explicit HTTP localhost artifacts', () => {
  assert.equal(isEmbeddableArtifact('/preview/demo.html', 'http://127.0.0.1:8765'), true);
  assert.equal(isEmbeddableArtifact('http://localhost:4173/app', 'http://127.0.0.1:8765'), true);
  assert.equal(isEmbeddableArtifact('https://example.com/app', 'http://127.0.0.1:8765'), false);
  assert.equal(isEmbeddableArtifact('javascript:alert(1)', 'http://127.0.0.1:8765'), false);
  assert.equal(isEmbeddableArtifact('http://[', 'http://127.0.0.1:8765'), false);
});

test('renders a clear empty state when no artifacts are registered', () => {
  const { host } = fixture();
  const result = renderArtifactTabs(host, []);
  assert.equal(result.selectedHref, '');
  assert.equal(byTag(host, 'iframe').length, 0);
  assert.match(host.textContent + descendants(host, () => true).map(node => node.textContent).join(' '), /No UI artifacts registered/i);
});

test('renders one artifact naturally with one large sandboxed preview and controls', () => {
  const { host } = fixture();
  renderArtifactTabs(host, [{ label: 'Main', href: '/preview/demo.html' }]);
  const tabs = descendants(host, node => node.getAttribute('role') === 'tab');
  const frames = byTag(host, 'iframe');
  const openLinks = byAction(host, 'open');
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].src, '/preview/demo.html');
  assert.equal(frames[0].getAttribute('sandbox'), 'allow-scripts');
  assert.equal(frames[0].title, 'Main');
  assert.equal(byAction(host, 'refresh').length, 1);
  assert.equal(openLinks[0].href, '/preview/demo.html');
  assert.equal(openLinks[0].target, '_blank');
  assert.equal(openLinks[0].rel, 'noopener');
});

test('switches among route and query variants while rendering only the selected iframe', () => {
  const artifacts = [
    { label: 'Main', href: '/preview/demo.html?screen=main' },
    { label: 'Settings', href: '/preview/demo.html?screen=settings' },
    { label: 'Victory', href: '/preview/demo.html#victory' }
  ];
  const selected = [];
  const { host } = fixture();
  const result = renderArtifactTabs(host, artifacts, { selectedHref: artifacts[1].href, onSelect: href => selected.push(href) });
  assert.equal(result.selectedHref, artifacts[1].href);
  assert.equal(byTag(host, 'iframe').length, 1);
  assert.equal(byTag(host, 'iframe')[0].src, artifacts[1].href);
  const tabs = descendants(host, node => node.getAttribute('role') === 'tab');
  tabs[2].click();
  assert.deepEqual(selected, [artifacts[2].href]);
  assert.equal(byTag(host, 'iframe').length, 1);
  assert.equal(byTag(host, 'iframe')[0].src, artifacts[2].href);
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
});

test('supports keyboard tab selection and connects tabs to the active panel', () => {
  const artifacts = [
    { label: 'Main', href: '/preview/main.html' },
    { label: 'Settings', href: '/preview/settings.html' },
    { label: 'Report', href: '/preview/report.html' }
  ];
  const { document, host } = fixture();
  const selected = [];
  renderArtifactTabs(host, artifacts, { onSelect: href => selected.push(href) });
  const tabs = descendants(host, node => node.getAttribute('role') === 'tab');
  const panel = descendants(host, node => node.getAttribute('role') === 'tabpanel')[0];
  assert.ok(panel.id);
  assert.ok(tabs.every(tab => tab.getAttribute('aria-controls') === panel.id));

  tabs[0].keydown('ArrowRight');
  assert.equal(document.activeElement, tabs[1]);
  assert.equal(byTag(host, 'iframe')[0].src, artifacts[1].href);
  assert.equal(panel.getAttribute('aria-labelledby'), tabs[1].id);
  tabs[1].keydown('End');
  assert.equal(document.activeElement, tabs[2]);
  tabs[2].keydown('Home');
  assert.equal(document.activeElement, tabs[0]);
  assert.deepEqual(selected, [artifacts[1].href, artifacts[2].href, artifacts[0].href]);
});

test('refresh reloads the selected safe frame and unsafe artifacts remain link-only', () => {
  const safe = fixture();
  renderArtifactTabs(safe.host, [{ label: 'Report', href: '/preview/report.html' }]);
  const frame = byTag(safe.host, 'iframe')[0];
  assert.equal(frame.srcAssignments, 1);
  byAction(safe.host, 'refresh')[0].click();
  assert.equal(frame.srcAssignments, 2);

  const unsafe = fixture();
  renderArtifactTabs(unsafe.host, [{ label: 'External', href: 'https://example.com/report' }]);
  assert.equal(byTag(unsafe.host, 'iframe').length, 0);
  assert.equal(byAction(unsafe.host, 'refresh')[0].disabled, true);
  assert.match(descendants(unsafe.host, node => /not embedded/i.test(node.textContent))[0].textContent, /not embedded/i);
  assert.equal(byAction(unsafe.host, 'open')[0].href, 'https://example.com/report');
});

test('does not make non-web schemes actionable through Open separately', () => {
  const { host } = fixture();
  renderArtifactTabs(host, [{ label: 'Unsafe', href: 'javascript:alert(1)' }]);
  const open = byAction(host, 'open')[0];
  assert.equal(open.tagName, 'SPAN');
  assert.equal(open.getAttribute('aria-disabled'), 'true');
  assert.equal(open.href, undefined);
  assert.equal(byTag(host, 'iframe').length, 0);
  assert.match(descendants(host, node => /not supported/i.test(node.textContent))[0].textContent, /not supported/i);
});
