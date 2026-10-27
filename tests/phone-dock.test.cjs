'use strict';
/* The phone dock (27 Oct 2026): on a narrow pane the tab bar is Bible Notes'
   floating dock — the first DOCK_SLOTS pages as slots and a More slot whose
   bottom sheet (src/more-sheet.js) lists the rest. Two guards:
   1. every rule of the dock belongs to the narrow pane (.is-narrow), so the
      wide segmented control cannot change;
   2. the More sheet: opens on the pages past the dock, marks the current
      one, closes on Escape / the scrim / a row, hands focus back to the More
      slot, keeps Tab inside, and never lets a key reach the root's shortcuts. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('./reminders-_stub.cjs');
global.window = globalThis;

/* ---- 1. the stylesheet --------------------------------------------------- */
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const bare = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const a = bare.indexOf('/* ---- the phone dock');
const b = bare.indexOf('/* ---- main ');
assert.ok(a > 0 && b > a, 'the dock section is marked');
const section = bare.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = [];
for (const m of section.matchAll(/([^{}@]+)\{/g)) {
  const sel = m[1].trim();
  if (!sel || /^(from|to|media |keyframes )/.test(sel)) continue;
  selectors.push(...sel.split(',').map(s => s.trim()));
}
assert.ok(selectors.length > 25, 'the dock has its rules');
for (const s of selectors) assert.ok(/\.is-narrow/.test(s), `dock rule scoped to the narrow pane: ${s}`);
assert.ok(/\.rv-app button\.rv-tab \.rv-icon \{ display: none; \}/.test(css), 'the wide bar hides the dock icons');
assert.ok(/\.rv-app button\.rv-tab\.rv-tab-more \{ display: none; \}/.test(css), 'the wide bar hides the More slot');
assert.ok(/--rv-dock-bottom: max\(16px, calc\(10px \+ env\(safe-area-inset-bottom, 0px\)\)\)/.test(css), 'dock bottom offset');
assert.ok(/--navbar-bottom-offset, 12px\) \+ var\(--navbar-height, 44px\) \+ 16px/.test(css), 'stands above Obsidian\'s floating nav bar');
assert.ok(/width: min\(380px, calc\(100% - 24px\)\)/.test(css));
assert.ok(!/color-mix|:has\(|\(\?<[=!]/.test(section), 'nothing the iOS 15 floor lacks');
assert.ok(!/position:\s*fixed/.test(section), 'the dock is absolute inside the view, never fixed');
/* every hover inside the dock sits in a (hover: hover) block */
for (const m of section.matchAll(/:hover/g)) {
  const before = section.slice(0, m.index);
  assert.ok(before.lastIndexOf('@media (hover: hover)') > before.lastIndexOf('\n}'), 'hover only where hover exists');
}

/* ---- 2. the tabs --------------------------------------------------------- */
const { TABS, DOCK_SLOTS } = require('../src/app');
assert.strictEqual(DOCK_SLOTS, 4);
assert.deepStrictEqual(TABS.slice(DOCK_SLOTS).map(t => t.id), ['month', 'plan', 'priorities']);
for (const t of TABS) assert.ok(/^[a-z0-9-]+$/.test(t.icon), `${t.id} has an icon`);

/* ---- 3. the sheet, on a small fake DOM ------------------------------------ */
class N {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.className = ''; this.listeners = {}; this.parentNode = null; this.disabled = false; this.textContent = ''; }
  get classList() { const n = this; return { contains: c => n.className.split(/\s+/).includes(c) }; }
  get firstChild() { return this.children[0] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === ROOT; }
  get ownerDocument() { return DOC; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t, e) { const ev = Object.assign({ stopPropagation() { ev.stopped = true; }, preventDefault() { ev.prevented = true; } }, e); for (const f of this.listeners[t] || []) f(ev); return ev; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  focus() { DOC.activeElement = this; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  matches(sel) {
    const notDisabled = /:not\(\[disabled\]\)/.test(sel);
    const s = sel.replace(/:not\(\[disabled\]\)/, '');
    const m = /^([a-z]*)((?:\.[\w-]+)*)$/.exec(s);
    if (!m) throw new Error('selector ' + sel);
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    if (notDisabled && this.disabled) return false;
    return m[2].split('.').filter(Boolean).every(c => this.classList.contains(c));
  }
  querySelector(sel) { return this.all().find(n => n.matches(sel)) || null; }
  querySelectorAll(sel) { return this.all().filter(n => n.matches(sel)); }
}
const DOC = { activeElement: null, createElement: t => new N(t) };
global.document = DOC;
const ROOT = new N('div');
const { mountMoreSheet } = require('../src/more-sheet');

let current = 'plan', picked = null;
const toggle = new N('button'); toggle.className = 'rv-tab rv-tab-more'; ROOT.appendChild(toggle);
const sheet = mountMoreSheet(ROOT, {
  items: () => TABS.slice(DOCK_SLOTS),
  current: () => current,
  pick: id => { picked = id; },
  toggle: () => toggle,
});
const wrap = () => ROOT.querySelector('.rv-sheet-wrap');
const rows = () => ROOT.querySelectorAll('.rv-sheet-row');

assert.strictEqual(wrap(), null, 'closed at first');
toggle.focus();
sheet.open();
assert.ok(wrap(), 'the sheet is mounted in the root');
assert.deepStrictEqual(rows().map(r => r.querySelector('.rv-sheet-title').textContent), ['Month', 'Plan', 'Priorities'], 'the pages past the dock, in order');
assert.deepStrictEqual(rows().map(r => r.getAttribute('aria-current')), [undefined, 'page', undefined], 'the current page is marked');
assert.strictEqual(DOC.activeElement, rows()[1], 'focus starts on the current page');
assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
assert.strictEqual(ROOT.querySelector('.rv-sheet').getAttribute('role'), 'dialog');

/* Escape: closes, focus back on More, and the root never hears the key */
let ev = wrap().fire('keydown', { key: 'Escape' });
assert.ok(ev.stopped && ev.prevented);
assert.strictEqual(wrap(), null, 'Escape closes');
assert.strictEqual(DOC.activeElement, toggle, 'focus returns to the More slot');
assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');

/* the scrim */
sheet.open();
ROOT.querySelector('.rv-scrim').fire('click', {});
assert.strictEqual(wrap(), null, 'the scrim closes');
assert.strictEqual(DOC.activeElement, toggle);

/* a row picks and closes */
sheet.open();
rows()[2].fire('click', {});
assert.strictEqual(picked, 'priorities');
assert.strictEqual(wrap(), null, 'choosing a page closes the sheet');

/* any other key is kept from the root's shortcuts (n, t, 1-7, arrows) */
sheet.open();
ev = wrap().fire('keydown', { key: 'n' });
assert.ok(ev.stopped, 'single keys stay in the sheet');
assert.ok(wrap(), 'and do not close it');

/* Tab stays inside */
rows()[2].focus();
wrap().fire('keydown', { key: 'Tab' });
assert.strictEqual(DOC.activeElement, rows()[0], 'Tab wraps to the first row');
wrap().fire('keydown', { key: 'Tab', shiftKey: true });
assert.strictEqual(DOC.activeElement, rows()[2], 'Shift+Tab wraps to the last');

/* a redraw under an open sheet follows the page and keeps focus */
rows()[0].focus();
current = 'month';
sheet.sync();
assert.deepStrictEqual(rows().map(r => r.getAttribute('aria-current')), ['page', undefined, undefined]);
assert.strictEqual(DOC.activeElement, rows()[0], 'sync keeps focus on the same row');

/* the More slot opens and closes the sheet */
sheet.close(false);
assert.strictEqual(wrap(), null);
sheet.open(); sheet.open();
assert.strictEqual(wrap(), null, 'opening an open sheet closes it');
console.log('phone dock OK');
