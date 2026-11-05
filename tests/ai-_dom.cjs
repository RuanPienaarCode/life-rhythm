'use strict';
/* A small fake DOM for the Ask AI chat tests: elements with children,
   classes, attributes, listeners and class-selector lookup. It draws and
   measures nothing; CSS is checked by reading the stylesheet text. Not a
   test itself (the runner only runs *.test.cjs). */
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
    this._cls = new Set(); this.attrs = {}; this.listeners = {}; this.style = {};
    this._text = ''; this.hidden = false; this.disabled = false; this.value = ''; this.title = '';
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self._cls.add(x)), remove: (...c) => c.forEach(x => self._cls.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !self._cls.has(c) : !!f; if (on) self._cls.add(c); else self._cls.delete(c); return on; },
      contains: c => self._cls.has(c),
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === FakeEl.ROOT; }
  get ownerDocument() { return global.document; }
  get textContent() { return this.tagName === '#TEXT' || !this.children.length ? this._text : this.children.map(c => c.textContent).join(''); }
  set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this._text = String(v); }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.children.push(n); return n; }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) { this.children.splice(i, 1); n.parentNode = null; } return n; }
  insertBefore(n, ref) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatch(t, ev) { const e = Object.assign({ type: t, target: this, preventDefault() {}, stopPropagation() {} }, ev || {}); for (const fn of (this.listeners[t] || []).slice()) fn(e); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() {} blur() {}
  all(sel) {
    const want = String(sel).split('.').filter(Boolean);
    const out = [];
    const walk = n => { for (const c of n.children) { if (want.every(w => c._cls.has(w))) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelectorAll(sel) { return this.all(sel); }
  querySelector(sel) { return this.all(sel)[0] || null; }
}
function install() {
  const body = new FakeEl('body');
  global.document = {
    body, activeElement: null,
    createElement: t => new FakeEl(t),
    createTextNode: t => { const n = new FakeEl('#text'); n._text = String(t); return n; },
  };
  return { FakeEl, body };
}
module.exports = { FakeEl, install };
