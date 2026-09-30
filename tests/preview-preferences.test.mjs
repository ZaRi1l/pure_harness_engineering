import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.textContent = '';
    this.onclick = null;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  click() { this.onclick?.(); }
}

class Storage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function fixture(initial = {}) {
  const elements = [];
  const document = {
    documentElement: new Element('html'),
    createElement(tagName) { const node = new Element(tagName, this); elements.push(node); return node; },
    querySelectorAll(selector) {
      const attribute = selector === '[data-i18n]' ? 'data-i18n' : selector === '[data-i18n-aria-label]' ? 'data-i18n-aria-label' : '';
      return attribute ? elements.filter(node => node.getAttribute(attribute) !== null) : [];
    }
  };
  document.documentElement.ownerDocument = document;
  const storage = new Storage(initial);
  const source = readFileSync(new URL('../preview/preferences.js', import.meta.url), 'utf8');
  const context = { globalThis: {}, document };
  runInNewContext(source, context);
  return { api: context.globalThis.PreviewPreferences, global: context.globalThis, document, storage, host: document.createElement('div') };
}

const action = (host, name) => host.children.find(child => child.dataset.preferenceAction === name);

test('preview preferences preserve the existing English and dark defaults', () => {
  const { api, document, storage, host } = fixture();
  const preferences = api.create(document, { storage });
  preferences.mount(host);

  assert.equal(preferences.locale, 'en');
  assert.equal(preferences.theme, 'dark');
  assert.equal(document.documentElement.getAttribute('lang'), 'en');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(preferences.t('dashboard.title'), 'Live Dashboard');
  assert.equal(action(host, 'language').textContent, '한국어');
  assert.equal(action(host, 'theme').textContent, 'Light');
});

test('language and theme toggles update accessible UI and persist across instances', () => {
  const { api, document, storage, host } = fixture();
  const preferences = api.create(document, { storage });
  let changes = 0;
  preferences.subscribe(() => { changes += 1; });
  preferences.mount(host);

  action(host, 'language').click();
  action(host, 'theme').click();

  assert.equal(preferences.locale, 'ko');
  assert.equal(preferences.theme, 'light');
  assert.equal(document.documentElement.getAttribute('lang'), 'ko');
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(preferences.t('dashboard.title'), '실시간 대시보드');
  assert.equal(action(host, 'language').textContent, 'English');
  assert.equal(action(host, 'theme').textContent, '어둡게');
  assert.equal(action(host, 'language').getAttribute('aria-label'), '언어를 영어로 변경');
  assert.equal(action(host, 'theme').getAttribute('aria-label'), '어두운 테마로 변경');
  assert.equal(storage.getItem('pure-harness-locale'), 'ko');
  assert.equal(storage.getItem('pure-harness-theme'), 'light');
  assert.equal(changes, 2);

  const restored = api.create(document, { storage });
  assert.equal(restored.locale, 'ko');
  assert.equal(restored.theme, 'light');
});

test('invalid stored preferences fall back without breaking translation interpolation', () => {
  const { api, document, storage } = fixture({
    'pure-harness-locale': 'xx',
    'pure-harness-theme': 'solarized'
  });
  const preferences = api.create(document, { storage });

  assert.equal(preferences.locale, 'en');
  assert.equal(preferences.theme, 'dark');
  assert.equal(preferences.t('network.empty', { agents: 2, signals: 3 }), 'Select an agent or signal. 2 agents, 3 signals.');
});

test('preferences remain usable when file URL storage access is unavailable', () => {
  const { api, global, document, host } = fixture();
  Object.defineProperty(global, 'localStorage', { get() { throw new Error('storage unavailable'); } });
  const preferences = api.create(document);
  preferences.mount(host);
  action(host, 'theme').click();
  assert.equal(preferences.theme, 'light');
  assert.equal(document.documentElement.dataset.theme, 'light');
});

test('declarative snapshot labels are retranslated when the language changes', () => {
  const { api, document, storage, host } = fixture();
  const title = document.createElement('h2');
  title.setAttribute('data-i18n', 'section.goal');
  const generated = document.createElement('p');
  generated.setAttribute('data-i18n', 'static.generated');
  generated.setAttribute('data-i18n-values', JSON.stringify({ time: '2026-09-27T00:00:00Z' }));
  const preferences = api.create(document, { storage });
  preferences.mount(host);
  preferences.translate(document);

  assert.equal(title.textContent, 'Goal');
  assert.equal(generated.textContent, 'Static snapshot generated 2026-09-27T00:00:00Z');
  action(host, 'language').click();
  assert.equal(title.textContent, '목표');
  assert.equal(generated.textContent, '정적 snapshot 생성 시각: 2026-09-27T00:00:00Z');
});

test('reported-running and age-bucket copy never implies a live liveness check in either locale', () => {
  const { api, document, storage } = fixture();
  const preferences = api.create(document, { storage });
  assert.match(preferences.t('dashboard.reportedRunning'), /reported running/i);
  assert.match(preferences.t('dashboard.startedRecent'), /liveness unconfirmed/i);
  assert.match(preferences.t('dashboard.startedOutside'), /liveness unconfirmed/i);
  assert.match(preferences.t('dashboard.agentCount', { reported: 4, recent: 2, outside: 2 }), /Reported running: 4.*past hour: 2.*unknown start: 2.*No live liveness check/i);
  assert.match(preferences.t('network.reportedRunning'), /liveness unconfirmed/i);
  assert.match(preferences.t('network.observed', { agents: 4, time: '2026-09-25T12:00:00Z' }), /Runtime records report 4 as running.*No live liveness check.*2026-09-25T12:00:00Z/i);
  preferences.setLocale('ko');
  assert.match(preferences.t('dashboard.reportedRunning'), /실행 중으로 기록됨/);
  assert.match(preferences.t('dashboard.startedRecent'), /생존 여부 미확인/);
  assert.match(preferences.t('dashboard.startedOutside'), /생존 여부 미확인/);
  assert.match(preferences.t('dashboard.agentCount', { reported: 4, recent: 2, outside: 2 }), /4명.*2명.*2명.*실시간 생존 확인 기능은 없습니다/);
  assert.match(preferences.t('network.reportedRunning'), /생존 여부 미확인/);
  assert.match(preferences.t('network.observed', { agents: 4, time: '2026-09-25T12:00:00Z' }), /런타임 기록.*4명.*생존 여부 미확인.*2026-09-25T12:00:00Z/);
});

test('dashboard heading and network guide describe reported records, not confirmed runners', () => {
  const { api, document, storage } = fixture();
  const preferences = api.create(document, { storage });
  assert.equal(preferences.t('section.activeAgents'), 'Reported Running Agents');
  assert.match(preferences.t('guide.networkBody'), /Reported Running Agents.*reported-running records.*Reported running only\/Full history/s);
  assert.doesNotMatch(preferences.t('guide.networkBody'), /current runners|Live\/History/i);
  assert.equal(preferences.t('dashboard.futureStart'), 'future start');
  preferences.setLocale('ko');
  assert.equal(preferences.t('section.activeAgents'), '실행 중 기록 에이전트');
  assert.match(preferences.t('guide.networkBody'), /실행 중 기록 에이전트.*생존 여부.*실행 중 기록만\/전체 기록/s);
  assert.doesNotMatch(preferences.t('guide.networkBody'), /현재 실행자|실시간\/기록/);
  assert.equal(preferences.t('dashboard.futureStart'), '미래 시작 시각');
});

test('guide keeps project state intact and directs setup to a staged installation in both locales', () => {
  const { api, document, storage } = fixture();
  const preferences = api.create(document, { storage });
  const english = preferences.t('guide.body');
  assert.match(english, /staged local installation/i);
  assert.match(english, /selected project.*management paths/i);
  assert.match(english, /preserve existing.*runtime/i);
  assert.doesNotMatch(english, /Remove-Item|Get-ChildItem|\.ai\/tasks\/\*\.md/i);

  preferences.setLocale('ko');
  const korean = preferences.t('guide.body');
  assert.match(korean, /별도.*설치/);
  assert.match(korean, /선택한 프로젝트.*관리 경로/);
  assert.match(korean, /기존.*runtime.*보존/);
  assert.doesNotMatch(korean, /Remove-Item|Get-ChildItem|\.ai\/tasks\/\*\.md/i);
});
