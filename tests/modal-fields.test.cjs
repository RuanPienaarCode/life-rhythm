'use strict';
/* H3 — editing a practice whose area is not one of the current options
   (a renamed area, or one still written as a wikilink) must not silently
   move it to the first area in the list, and a Save that touched nothing
   must write nothing. Stubs just enough of `obsidian` and the DOM for
   ItemModal to run headless. */
const assert = require('node:assert');
const Module = require('node:module');

class Node {
  constructor(t) { this.tagName = t; this.children = []; this.classList = { add() {}, remove() {}, contains() { return false; } }; this.style = { setProperty() {} }; this.attrs = {}; this.value = ''; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  get firstChild() { return this.children[0]; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { (this._l = this._l || {})[type] = this._l[type] || []; this._l[type].push(fn); }
  dispatch(type) { for (const fn of (this._l && this._l[type]) || []) fn(); }
  querySelector() { return null; }
  focus() {}
}
global.document = { createElement: t => new Node(t) };
global.window = { setTimeout: () => 0 };

class Modal { constructor(app) { this.app = app; this.contentEl = new Node('div'); this.modalEl = new Node('div'); } open() { this.onOpen(); } close() {} }
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'obsidian' ? { Modal, Notice: class { constructor() {} }, setIcon() {} } : orig.call(this, req, ...rest); };
const SRC = __dirname + '/../src/';
require.cache[require.resolve(SRC + 'accents')] = { exports: { applyAccent() {} } };
const { ItemModal } = require(SRC + 'modals');

function makeCtx(areas) {
  let lastFields = null, lastName = null;
  return {
    ctx: {
      settings: {}, state: { data: { areas } },
      update: async (rec, fields, name) => { lastFields = fields; lastName = name; },
    },
    get: () => ({ fields: lastFields, name: lastName }),
  };
}

const areas = [{ name: 'Belief', order: 1 }, { name: 'Body', order: 4 }];

/* Open, touch nothing, Save: the unrecognised area is kept as-is and no
   field is written. */
{
  const { ctx, get } = makeCtx(areas);
  const m = new ItemModal({}, ctx, { kind: 'practice', rec: { name: 'Read', area: 'Faith', cadence: 'daily', path: 'x' } });
  m.open();
  assert.strictEqual(m.values.area, 'Faith', 'the unrecognised area is kept, not reset to the first area');
  m.submit();
  assert.deepStrictEqual(get().fields, {}, 'nothing touched, nothing written');
}

/* Open, change only the cadence, Save: only cadence is written — the
   untouched (unrecognised) area must not appear in the update. */
{
  const { ctx, get } = makeCtx(areas);
  const m = new ItemModal({}, ctx, { kind: 'practice', rec: { name: 'Read', area: 'Faith', cadence: 'daily', path: 'x' } });
  m.open();
  m.values.cadence = 'weekly';
  m.touched.add('cadence');
  m.submit();
  assert.deepStrictEqual(get().fields, { cadence: 'weekly' }, 'only the touched field is written');
}

/* Changing the area explicitly still writes it. */
{
  const { ctx, get } = makeCtx(areas);
  const m = new ItemModal({}, ctx, { kind: 'practice', rec: { name: 'Read', area: 'Faith', cadence: 'daily', path: 'x' } });
  m.open();
  m.values.area = 'Body';
  m.touched.add('area');
  m.submit();
  assert.deepStrictEqual(get().fields, { area: 'Body' }, 'an explicit area change is written');
}

console.log('modal-fields OK');
