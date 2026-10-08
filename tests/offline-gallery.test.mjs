import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const galleryRoot = new URL('../offline-gallery/', import.meta.url);

function source(name) {
  return readFileSync(fileURLToPath(new URL(name, galleryRoot)), 'utf8');
}

function fixture() {
  const elements = new Map(
    ['gallery-tabs', 'gallery-frame', 'gallery-open', 'gallery-status']
      .map(id => [id, { id, children: [], attributes: {}, textContent: '', src: '', href: '',
        append(...children) { this.children.push(...children); },
        setAttribute(name, value) { this.attributes[name] = String(value); } }]),
  );
  const document = {
    getElementById: id => elements.get(id),
    createElement: tagName => ({ tagName: tagName.toUpperCase(), attributes: {}, textContent: '',
      addEventListener(type, handler) { this[`on${type}`] = handler; },
      setAttribute(name, value) { this.attributes[name] = String(value); } }),
  };
  const window = {};
  vm.runInNewContext(source('gallery.js'), { document, window });
  return { api: window.PureOfflineGallery, elements };
}

function assertShippedTaskEntry(api, entry) {
  assert.equal(api.isSafeRelativeHtmlPath(entry.href), true, entry.href);
  const taskUrl = new URL(entry.href, galleryRoot);
  assert.equal(taskUrl.href.startsWith(new URL('tasks/', galleryRoot).href), true, entry.href);
  assert.equal(existsSync(fileURLToPath(taskUrl)), true, entry.href);
}

test('shipped task entries resolve to existing local HTML, while a missing entry fails', () => {
  const { api } = fixture();
  for (const entry of api.entries) assertShippedTaskEntry(api, entry);
  assert.throws(() => assertShippedTaskEntry(api,
    { href: './tasks/intentionally-missing.html' }), /intentionally-missing\.html/);
});

test('example task page is standalone and has no external dependencies', () => {
  const html = source('tasks/example.html');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<h1\b/i);
  assert.match(html, /<style\b/i);
  assert.match(html, /acceptance evidence/i);
  assert.match(html, /handoff/i);
  assert.doesNotMatch(html, /<script\s+src|@import|<link\s+href|fetch\(|https?:\/\//i);
});

test('gallery runtime has no module, network, or storage dependencies', () => {
  const html = source('index.html');
  const js = source('gallery.js');
  assert.match(html, /<script\s+src="\.\/gallery\.js"\s*><\/script>/);
  assert.doesNotMatch(`${html}\n${js}`, /type="module"|\bimport\s|\brequire\s*\(|fetch\s*\(|https?:\/\/|(?:localStorage|sessionStorage|indexedDB)/i);
});

test('gallery does not depend on server routes or generated task data', () => {
  const html = source('index.html');
  const js = source('gallery.js');
  assert.doesNotMatch(`${html}\n${js}`, /(?:src|href)="\/|\/runtime\/|\.ai\/runtime\/|\.json\b|sketch:/i);
  assert.equal(fixture().api.entries.length > 0, true);
});

test('offline gallery has a local classic script and constrained frame with a direct-open fallback', () => {
  const html = source('index.html');
  const js = source('gallery.js');
  assert.match(html, /<script\s+src="\.\/gallery\.js"\s*><\/script>/);
  assert.match(html, /<iframe\b[^>]*\bsandbox=""/);
  assert.match(html, /id="gallery-tabs"[^>]*role="tablist"/);
  assert.match(html, /id="gallery-open"[^>]*target="_blank"[^>]*rel="noopener"/);
  for (const id of ['gallery-tabs', 'gallery-frame', 'gallery-open', 'gallery-status']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const forbidden of [/fetch\s*\(/i, /https?:\/\//i, /\bcdn\b/i,
    /(?:localStorage|sessionStorage|indexedDB)/, /innerHTML/]) {
    assert.doesNotMatch(`${html}\n${js}`, forbidden);
  }
});

test('only literal relative task HTML paths are safe', () => {
  const { api } = fixture();
  assert.equal(api.isSafeRelativeHtmlPath('./tasks/example.html'), true);
  for (const bad of ['../x.html', '/x.html', 'C:\\x.html', 'https://x/y.html',
    './tasks/x.svg', './tasks/x.html?x=1', './tasks/%2e%2e/x.html']) {
    assert.equal(api.isSafeRelativeHtmlPath(bad), false, bad);
  }
});

test('selection updates local frame and direct link while retaining readable fallback', () => {
  const { api, elements } = fixture();
  const tabs = elements.get('gallery-tabs');
  const frame = elements.get('gallery-frame');
  const open = elements.get('gallery-open');
  const status = elements.get('gallery-status');
  assert.equal(api.select('example'), true);
  assert.equal(frame.src, './tasks/example.html');
  assert.equal(open.href, './tasks/example.html');
  assert.match(status.textContent, /Task brief/);
  assert.match(status.textContent, /open separately/i);
  assert.equal(tabs.children[0].attributes.role, 'tab');
  assert.equal(tabs.children[0].attributes['aria-selected'], 'true');
  assert.equal(tabs.children[0].textContent, 'Task brief');
  assert.equal(api.select('unknown'), false);
  assert.equal(frame.src, './tasks/example.html');
  assert.equal(open.href, './tasks/example.html');
});

test('clicking a registered entry with an unsafe href leaves the current destinations unchanged', () => {
  const { api, elements } = fixture();
  const tab = elements.get('gallery-tabs').children[0];
  const frame = elements.get('gallery-frame');
  const open = elements.get('gallery-open');
  const status = elements.get('gallery-status');
  const previous = { frame: frame.src, open: open.href, status: status.textContent };

  api.entries[0].href = 'https://invalid.example/escape.html';
  tab.onclick();
  assert.equal(api.select('example'), false);
  assert.equal(frame.src, previous.frame);
  assert.equal(open.href, previous.open);
  assert.equal(status.textContent, previous.status);
});

test('markup-bearing registered title and description stay literal in status text', () => {
  const { api, elements } = fixture();
  const title = '<img src=x onerror=alert(1)>';
  const description = '<script>not executed</script>';
  api.entries[0].title = title;
  api.entries[0].description = description;

  elements.get('gallery-tabs').children[0].onclick();
  const status = elements.get('gallery-status');
  assert.match(status.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(status.textContent, /<script>not executed<\/script>/);
  assert.equal(Object.hasOwn(status, 'innerHTML'), false);
});
