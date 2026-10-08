// Browser-platform primitives for exercising the real preview modules in Node.
const entities = text => text.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function matches(node, selector) {
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
  const match = /^([a-z][\w-]*)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i.exec(selector);
  if (!match) throw new Error(`Unsupported test selector: ${selector}`);
  return (!match[1] || node.tagName === match[1].toLowerCase())
    && (!match[2] || (match[3] === undefined ? node.getAttribute(match[2]) !== null : node.getAttribute(match[2]) === match[3]));
}

function descendants(root) {
  return root.children.flatMap(child => [child, ...descendants(child)]);
}

function select(root, selector) {
  const parts = selector.trim().split(/\s+/);
  let found = [root];
  for (const part of parts) found = found.flatMap(node => descendants(node).filter(child => matches(child, part)));
  return found;
}

export class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toLowerCase(); this.ownerDocument = ownerDocument;
    this.children = []; this.attributes = new Map(); this.listeners = new Map(); this._text = '';
    this.value = ''; this.scrollTop = 0; this.hidden = false; this.parentNode = null;
    this.style = { setProperty() {} };
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        target[key] = String(value);
        this.attributes.set(`data-${String(key).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, String(value));
        return true;
      }
    });
    this.classList = {
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled ?? !classes.has(name)) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
      }
    };
  }
  set id(value) { this.setAttribute('id', value); }
  get id() { return this.getAttribute('id') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get className() { return this.getAttribute('class') || ''; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      if (this.dataset[key] !== String(value)) this.dataset[key] = String(value);
    }
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) {
    for (const child of children) { child.parentNode?.removeChild(child); child.parentNode = this; this.children.push(child); }
  }
  removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...children); }
  remove() { this.parentNode?.removeChild(this); }
  hasChildNodes() { return this.children.length > 0 || this._text.length > 0; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(html) {
    this.replaceChildren();
    const stack = [this];
    for (const token of String(html).match(/<[^>]+>|[^<]+/g) || []) {
      if (/^<\//.test(token)) { stack.pop(); continue; }
      if (/^</.test(token)) {
        const tag = /^<([a-z][\w-]*)/i.exec(token)?.[1];
        if (!tag) continue;
        const node = this.ownerDocument.createElement(tag);
        for (const [, name, value] of token.matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(name, entities(value));
        stack.at(-1).append(node);
        if (!/\/>$/.test(token) && !['input', 'br', 'hr'].includes(tag)) stack.push(node);
      } else stack.at(-1)._text += entities(token);
    }
  }
  querySelectorAll(selector) { return select(this, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(node) { return node === this || descendants(this).includes(node); }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
  dispatch(type, event = {}) {
    const action = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...event };
    this[`on${type}`]?.(action);
    for (const listener of this.listeners.get(type) || []) listener(action);
    return action;
  }
  click() { this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 440 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
}

export function createDocument() {
  const document = {
    activeElement: null,
    createElement(tagName) { return new Element(tagName, this); },
    createElementNS(_namespace, tagName) { return this.createElement(tagName); },
    querySelectorAll(selector) { return select(this.documentElement, selector); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  };
  document.documentElement = document.createElement('html');
  document.head = document.createElement('head');
  document.body = document.createElement('body');
  document.documentElement.append(document.head, document.body);
  document.defaultView = { location: { origin: 'http://127.0.0.1:4567' } };
  const app = document.createElement('main'); app.id = 'app';
  const preferences = document.createElement('div'); preferences.id = 'preview-preferences';
  const tagline = document.createElement('div'); tagline.id = 'app-tagline';
  const note = document.createElement('p'); note.id = 'sidebar-note';
  document.body.append(tagline, preferences, note);
  for (const view of ['dashboard', 'preview', 'agents', 'skills', 'guide']) {
    const button = document.createElement('button'); button.dataset.view = view; document.body.append(button);
  }
  document.body.append(app);
  return document;
}
