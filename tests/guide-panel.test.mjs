import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuidePanel } from '../preview/guide-panel.js';

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this._textContent = '';
    this.innerHTML = '';
    this.onclick = null;
    this.open = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  get textContent() { return this._textContent + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._textContent = String(value); this.children = []; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  click() { this.onclick?.(); }
}

const document = { createElement: tagName => new Element(tagName) };
const walk = node => [node, ...node.children.flatMap(walk)];
const choice = (root, name) => walk(root).find(node => node.dataset.guideChoice === name);
const selected = root => walk(root).find(node => node.dataset.guideSelected === 'true');

function translator(locale = 'en') {
  const en = {
    'guide.choose': 'What would you like to do?',
    'guide.note': 'The dashboard shows records for this fixed project.',
    'guide.choice.new': 'Start a new project',
    'guide.choice.existing': 'Try an existing project safely',
    'guide.choice.connected': 'Open an already connected project',
    'guide.new.body': 'Run setup for a new project and review the plan. Run init once.',
    'guide.existing.body': 'Preserve the original project and runtime. Setup copies the source into project/ without moving the original.',
    'guide.connected.body': 'For the configured fixed project, run status and preview:live. Do not run init again.',
    'guide.new.commands': 'npm run setup\nnpm run init\nnpm run status\nnpm run preview:live',
    'guide.existing.commands': 'npm run setup\nnpm run init\nnpm run status\nnpm run preview:live',
    'guide.connected.commands': 'npm run status\nnpm run preview:live',
    'guide.switch.title': 'Switch AI tools',
    'guide.switch.body': '<ol><li>Run npm run setup in update mode.</li></ol>',
    'guide.advanced': 'Advanced reference',
    'guide.networkAdvanced': 'Network details',
    'guide.body': '<p>Staged local installation and native smoke unverified.</p>',
    'guide.networkBody': '<p>Reported-running records only.</p>'
  };
  const ko = { ...en, 'guide.choose': '무엇을 하시겠어요?', 'guide.choice.new': '새 프로젝트 시작', 'guide.choice.existing': '기존 프로젝트 안전하게 시험', 'guide.choice.connected': '이미 연결된 프로젝트 열기', 'guide.switch.title': 'AI 도구 전환' };
  return key => (locale === 'ko' ? ko : en)[key] ?? key;
}

test('first view offers three paths, hides commands and keeps advanced material closed', () => {
  const panel = createGuidePanel({ document, translate: translator() });
  assert.match(walk(panel).map(node => node.textContent).join(' '), /What would you like to do/);
  assert.deepEqual(['new', 'existing', 'connected'].map(name => choice(panel, name).textContent), [
    'Start a new project', 'Try an existing project safely', 'Open an already connected project'
  ]);
  assert.match(walk(panel).map(node => node.textContent).join(' '), /records for this fixed project/);
  assert.equal(selected(panel), undefined);
  assert.equal(walk(panel).filter(node => node.tagName === 'PRE').length, 0);
  const switchSection = walk(panel).find(node => node.className === 'guide-tool-switch');
  assert.equal(switchSection.children[0].textContent, 'Switch AI tools');
  assert.match(switchSection.children[1].innerHTML, /npm run setup in update mode/);
  const advanced = walk(panel).filter(node => node.tagName === 'DETAILS');
  assert.equal(advanced.length, 2);
  assert.ok(advanced.every(node => !node.open));
});

test('selected path alone reveals relevant instructions and commands', () => {
  const panel = createGuidePanel({ document, translate: translator() });
  choice(panel, 'existing').click();
  assert.match(selected(panel).textContent, /without moving the original/);
  assert.match(walk(selected(panel)).find(node => node.tagName === 'PRE').textContent, /^npm run setup/);
  choice(panel, 'connected').click();
  assert.match(selected(panel).textContent, /configured fixed project/);
  assert.match(walk(selected(panel)).find(node => node.tagName === 'PRE').textContent, /^npm run status/);
  assert.doesNotMatch(walk(selected(panel)).find(node => node.tagName === 'PRE').textContent, /npm run init/);
  choice(panel, 'new').click();
  assert.match(selected(panel).textContent, /Run init once/);
  assert.match(walk(selected(panel)).find(node => node.tagName === 'PRE').textContent, /npm run init/);
  assert.equal(choice(panel, 'new').getAttribute('aria-pressed'), 'true');
  assert.equal(choice(panel, 'connected').getAttribute('aria-pressed'), 'false');
});

test('new panel uses supplied locale for the decision labels', () => {
  const panel = createGuidePanel({ document, translate: translator('ko') });
  assert.match(walk(panel).map(node => node.textContent).join(' '), /무엇을 하시겠어요/);
  assert.equal(choice(panel, 'existing').textContent, '기존 프로젝트 안전하게 시험');
  assert.equal(walk(panel).find(node => node.className === 'guide-tool-switch').children[0].textContent, 'AI 도구 전환');
});
