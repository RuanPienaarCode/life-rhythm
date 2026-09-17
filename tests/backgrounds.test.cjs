'use strict';
/* Wallpapers: the gradients, the vault folder that supplies photographs,
   and the veil that keeps type readable over either. */
const assert = require('node:assert');
const Module = require('node:module');
const orig = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? { normalizePath: p => String(p).replace(/\/+$/, '') } : orig.call(this, req, ...rest);
};
const BG = require('../src/backgrounds');
Module._load = orig;

/* A plugin stand-in with a folder of pictures and one stray text file. */
const mkPlugin = (settings, files) => ({
  settings: Object.assign({ folder: 'Rhythm', background: 'none', backgroundDim: 55 }, settings),
  app: {
    vault: {
      getFolderByPath: p => (p === 'Rhythm/Backgrounds' ? { children: files || [] } : null),
      getFileByPath: p => (files || []).find(f => f.path === p) || null,
      getResourcePath: f => `app://local/${f.path}?t=1`,
    },
  },
});

const pics = [
  { path: 'Rhythm/Backgrounds/Cypress river.jpg', basename: 'Cypress river', extension: 'jpg' },
  { path: 'Rhythm/Backgrounds/aurora.PNG', basename: 'aurora', extension: 'PNG' },
  { path: 'Rhythm/Backgrounds/notes.md', basename: 'notes', extension: 'md' },
];

/* ---- what the picker offers ---- */
const opts = BG.options(mkPlugin({}, pics));
assert.strictEqual(opts[0].id, 'none', 'None comes first, so there is always a way back');
assert.strictEqual(opts.length, 1 + BG.GRADIENTS.length + 2, 'gradients, then the pictures — and the .md is not one');
assert.deepStrictEqual(opts.slice(-2).map(o => o.name), ['aurora', 'Cypress river'], 'pictures sorted by name');
assert.ok(opts.slice(-2).every(o => o.isImage));
assert.strictEqual(BG.listImages(mkPlugin({}, [])).length, 0, 'an empty folder is not an error');
assert.strictEqual(BG.listImages(mkPlugin({ folder: 'Elsewhere' }, pics)).length, 0, 'the folder follows the setting');

/* ---- resolving to CSS ---- */
const p = mkPlugin({}, pics);
assert.strictEqual(BG.backgroundCss(p, 'none', 'light'), '');
assert.strictEqual(BG.backgroundCss(p, 'no-such-gradient', 'light'), '', 'an id that has gone away shows nothing, rather than breaking');
assert.ok(BG.backgroundCss(p, 'dusk', 'light').indexOf('linear-gradient') === 0);
assert.notStrictEqual(BG.backgroundCss(p, 'dusk', 'light'), BG.backgroundCss(p, 'dusk', 'dark'), 'each gradient has its own dark twin');
assert.strictEqual(
  BG.backgroundCss(p, 'image:Rhythm/Backgrounds/aurora.PNG', 'light'),
  'url("app://local/Rhythm/Backgrounds/aurora.PNG?t=1")',
  'images go through the vault resource path, the only URL that works on both desktop and phone');
assert.strictEqual(BG.backgroundCss(p, 'image:Rhythm/Backgrounds/gone.jpg', 'light'), '', 'a deleted picture falls back to nothing');
assert.strictEqual(BG.isImageId('image:a/b.jpg'), true);
assert.strictEqual(BG.isImageId('dusk'), false);
assert.strictEqual(BG.pathOf('image:a/b.jpg'), 'a/b.jpg');

/* Every gradient names both twins, so none can ship half-defined. */
for (const g of BG.GRADIENTS) {
  assert.ok(g.id && g.name && g.light && g.dark, `${g.id}: complete`);
  assert.notStrictEqual(g.light, g.dark, `${g.id}: the dark twin is actually different`);
}

/* ---- applying it ---- */
const node = () => { const seen = {}; let cls = new Set();
  return { seen, cls, style: { setProperty: (k, v) => { seen[k] = v; } },
    classList: { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); } } }; };

let n = node();
assert.strictEqual(BG.applyBackground(n, mkPlugin({ background: 'dusk', backgroundDim: 40 }, pics)), true);
assert.strictEqual(n.seen['--rv-bg-dim'], '0.4', 'the slider is stored 0–95 and used as an alpha');
assert.ok(n.cls.has('has-bg'), 'the glass rules switch on');

n = node();
assert.strictEqual(BG.applyBackground(n, mkPlugin({ background: 'none' }, pics)), false);
assert.strictEqual(n.seen['--rv-bg-image'], 'none');
assert.ok(!n.cls.has('has-bg'), 'and off again, back to the flat ground');

/* A veil out of range would either vanish or black the page out. */
n = node();
BG.applyBackground(n, mkPlugin({ background: 'dusk', backgroundDim: 999 }, pics));
assert.strictEqual(n.seen['--rv-bg-dim'], '0.95');
n = node();
BG.applyBackground(n, mkPlugin({ background: 'dusk', backgroundDim: -5 }, pics));
assert.strictEqual(n.seen['--rv-bg-dim'], '0');
n = node();
BG.applyBackground(n, mkPlugin({ background: 'dusk', backgroundDim: 'nonsense' }, pics));
assert.strictEqual(n.seen['--rv-bg-dim'], '0.55', 'and nonsense falls back to the default');

assert.strictEqual(BG.applyBackground(null, mkPlugin({}, pics)), false, 'no node, no throw');
console.log(`backgrounds OK (${BG.GRADIENTS.length} gradients)`);
