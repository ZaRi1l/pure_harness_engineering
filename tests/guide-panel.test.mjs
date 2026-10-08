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
    'guide.note': 'The dashboard shows selected-project records; connecting an AI tool is a separate setup.',
    'guide.choice.new': 'Start a new project',
    'guide.choice.existing': 'Try an existing project safely',
    'guide.choice.connected': 'Open an already connected project',
    'guide.new.body': 'Use a new empty Git project, separate from the Harness installation. Create the project manifest and local binding, then run diagnostic, init, status, and preview:live with explicit project paths. Never run init in an existing project.',
    'guide.existing.body': 'Preserve your current project. Try this only in isolated checkout copies; uncommitted and ignored files are not copied. Use docs/first-use.md for the copy procedure. Do not initialize or migrate the original runtime.',
    'guide.connected.body': 'If the project manifest and local binding are ready, run the live preview from the Harness installation with your own project ID and paths. Open the localhost URL printed by the server.',
    'guide.new.commands': 'node scripts/project-diagnostic.mjs --checkout <checkout> --binding <binding> --project <project-id>\nnpm run init -- --project <project-id> --checkout <checkout> --binding <binding>\nnpm run status -- --project <project-id> --checkout <checkout> --binding <binding>\nnpm run preview:live -- --project <project-id> --checkout <checkout> --binding <binding>',
    'guide.connected.commands': 'npm run preview:live -- --project <project-id> --checkout <checkout> --binding <binding>',
    'guide.advanced': 'Advanced reference',
    'guide.networkAdvanced': 'Network details',
    'guide.body': '<p>Staged local installation and native smoke unverified.</p>',
    'guide.networkBody': '<p>Reported-running records only.</p>'
  };
  const ko = { ...en, 'guide.choose': '무엇을 하시겠어요?', 'guide.choice.new': '새 프로젝트 시작', 'guide.choice.existing': '기존 프로젝트 안전하게 시험', 'guide.choice.connected': '이미 연결된 프로젝트 열기' };
  return key => (locale === 'ko' ? ko : en)[key] ?? key;
}

test('first view offers three paths, hides commands and keeps advanced material closed', () => {
  const panel = createGuidePanel({ document, translate: translator() });
  assert.match(walk(panel).map(node => node.textContent).join(' '), /What would you like to do/);
  assert.deepEqual(['new', 'existing', 'connected'].map(name => choice(panel, name).textContent), [
    'Start a new project', 'Try an existing project safely', 'Open an already connected project'
  ]);
  assert.match(walk(panel).map(node => node.textContent).join(' '), /connecting an AI tool is a separate setup/);
  assert.equal(selected(panel), undefined);
  assert.equal(walk(panel).filter(node => node.tagName === 'PRE').length, 0);
  const advanced = walk(panel).filter(node => node.tagName === 'DETAILS');
  assert.equal(advanced.length, 2);
  assert.ok(advanced.every(node => !node.open));
});

test('selected path alone reveals relevant instructions and commands', () => {
  const panel = createGuidePanel({ document, translate: translator() });
  choice(panel, 'existing').click();
  assert.match(selected(panel).textContent, /isolated checkout copies/);
  assert.equal(walk(selected(panel)).filter(node => node.tagName === 'PRE').length, 0);
  choice(panel, 'connected').click();
  assert.match(selected(panel).textContent, /project manifest and local binding/);
  assert.match(walk(selected(panel)).find(node => node.tagName === 'PRE').textContent, /^npm run preview:live/);
  assert.doesNotMatch(walk(selected(panel)).find(node => node.tagName === 'PRE').textContent, /npm run init/);
  choice(panel, 'new').click();
  assert.match(selected(panel).textContent, /Never run init in an existing project/);
  assert.match(walk(selected(panel)).find(node => node.tagName === 'PRE').textContent, /npm run init/);
  assert.equal(choice(panel, 'new').getAttribute('aria-pressed'), 'true');
  assert.equal(choice(panel, 'connected').getAttribute('aria-pressed'), 'false');
});

test('new panel uses supplied locale for the decision labels', () => {
  const panel = createGuidePanel({ document, translate: translator('ko') });
  assert.match(walk(panel).map(node => node.textContent).join(' '), /무엇을 하시겠어요/);
  assert.equal(choice(panel, 'existing').textContent, '기존 프로젝트 안전하게 시험');
});
