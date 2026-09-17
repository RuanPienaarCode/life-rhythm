'use strict';
/* Every accent must be legible in both themes. This is the gate that lets
   a colour be added by taste rather than by measurement: if a new preset
   cannot be nudged into the contrast bars, this fails and it does not
   ship. */
const assert = require('node:assert');
const A = require('../src/accents');

const hex = s => A.parseHex(s);
const around = (a, b, eps) => Math.abs(a - b) < (eps || 0.01);

/* ---- the maths itself ---- */
assert.deepStrictEqual(A.parseHex('#386382'), [56, 99, 130]);
assert.deepStrictEqual(A.parseHex('6A9B85'), [106, 155, 133]);
assert.deepStrictEqual(A.parseHex('#abc'), [170, 187, 204]);
assert.strictEqual(A.parseHex('nope'), null);
assert.strictEqual(A.parseHex(''), null);
assert.strictEqual(A.parseHex(null), null);
assert.strictEqual(A.toHex([56, 99, 130]), '#386382');
assert.strictEqual(A.toHex([-5, 260, 130.4]), '#00ff82', 'out of range clamps');

/* Known-good WCAG anchors. */
assert.ok(around(A.contrast(hex('#000000'), hex('#ffffff')), 21, 0.05));
assert.ok(around(A.contrast(hex('#777777'), hex('#ffffff')), 4.48, 0.05));
assert.strictEqual(A.contrast(hex('#386382'), hex('#ffffff')) > 4.5, true, 'slate is already text-safe on paper');
assert.strictEqual(A.contrast(hex('#6A9B85'), hex('#ffffff')) < 4.5, true, 'sage is not — it must be darkened for text');

/* nudge does the least it can get away with. */
const untouched = A.nudge(hex('#386382'), [0, 0, 0], A.CELL_LIGHT, 4.5);
assert.strictEqual(A.toHex(untouched), '#386382', 'a colour that already passes is left exactly alone');
const darkened = A.nudge(hex('#6A9B85'), [0, 0, 0], A.CELL_LIGHT, 4.5);
assert.ok(A.contrast(darkened, A.CELL_LIGHT) >= 4.5);
assert.ok(A.luminance(darkened) < A.luminance(hex('#6A9B85')), 'and it went darker, not lighter');

/* ---- every preset, both themes ---- */
const MIN_FILL = 3, MIN_TEXT = 4.5, MIN_INK = 4.5;
for (const p of A.PRESETS) {
  const v = A.accentVars(p.id);
  const fillL = hex(v['--rv-tint-l']), textL = hex(v['--rv-tint-text-l']), inkL = hex(v['--rv-tint-ink-l']);
  const fillD = hex(v['--rv-tint-d']), textD = hex(v['--rv-tint-text-d']), inkD = hex(v['--rv-tint-ink-d']);

  const cL = A.contrast(fillL, A.CELL_LIGHT), tL = A.contrast(textL, A.CELL_LIGHT), iL = A.contrast(inkL, fillL);
  const cD = A.contrast(fillD, A.CELL_DARK), tD = A.contrast(textD, A.CELL_DARK), iD = A.contrast(inkD, fillD);

  assert.ok(cL >= MIN_FILL, `${p.id}: light fill ${cL.toFixed(2)}:1 on the cell`);
  assert.ok(tL >= MIN_TEXT, `${p.id}: light text ${tL.toFixed(2)}:1 on the cell`);
  assert.ok(iL >= MIN_INK, `${p.id}: light ink ${iL.toFixed(2)}:1 on its own fill`);
  assert.ok(cD >= MIN_FILL, `${p.id}: dark fill ${cD.toFixed(2)}:1 on the cell`);
  assert.ok(tD >= MIN_TEXT, `${p.id}: dark text ${tD.toFixed(2)}:1 on the cell`);
  assert.ok(iD >= MIN_INK, `${p.id}: dark ink ${iD.toFixed(2)}:1 on its own fill`);
  /* The dark ground is pure black behind the grouped cells, so the fill
     has to survive there too. */
  assert.ok(A.contrast(fillD, [0, 0, 0]) >= MIN_FILL, `${p.id}: dark fill on the black ground`);
  /* The dark twin is only ever lightened, never darkened — a mid-tone that
     already reads well on black is left exactly as chosen. */
  assert.ok(A.luminance(fillD) >= A.luminance(fillL),
    `${p.id}: the dark twin must not be darker than the light one`);
}

/* The two named in the design brief survive as themselves in light mode. */
assert.strictEqual(A.accentVars('slate')['--rv-tint-l'], '#386382');
assert.strictEqual(A.swatchFor('sage'), '#6a9b85', 'the swatch shows the colour as chosen');

/* ---- custom and nonsense ---- */
assert.strictEqual(A.accentVars('custom', '#123456')['--rv-tint-l'], '#123456');
assert.strictEqual(A.accentVars('custom', 'not a colour')['--rv-tint-l'], A.accentVars('slate')['--rv-tint-l'], 'a bad custom hex falls back');
assert.strictEqual(A.accentVars('no-such-accent')['--rv-tint-l'], A.accentVars('slate')['--rv-tint-l'], 'an unknown id falls back');
/* A near-white accent cannot be a fill on white — it gets darkened until
   it can, rather than shipping an invisible tick. */
const pale = A.accentVars('custom', '#f2f2f2');
assert.ok(A.contrast(hex(pale['--rv-tint-l']), A.CELL_LIGHT) >= 3);
assert.ok(A.contrast(hex(pale['--rv-tint-d']), A.CELL_DARK) >= 3);

/* applyAccent writes to a node without needing a DOM library. */
const seen = {};
A.applyAccent({ style: { setProperty: (k, v) => { seen[k] = v; } } }, { accent: 'sage' });
assert.strictEqual(Object.keys(seen).length, 10);
assert.strictEqual(seen['--rv-tint-l'], '#6a9b85');
A.applyAccent(null, { accent: 'sage' }); // must not throw
console.log(`accents OK (${A.PRESETS.length} presets, both themes)`);
