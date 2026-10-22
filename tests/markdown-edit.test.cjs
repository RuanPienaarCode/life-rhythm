'use strict';
/* The writing box's toolbar. Every button has an off state, and off is the
   half that breaks quietly, so it is tested as carefully as on. */
const assert = require('node:assert');
const E = require('../src/markdown-edit');

/* A readable way to write a case: | is the caret, «guillemets» the
   selection. Deliberately not [brackets] — task syntax is "- [ ] ", and a
   harness that cannot tell its own markers from the content under test is
   worse than no harness. */
function run(spec, fn) {
  let text = spec, start, end;
  const caret = text.indexOf('|');
  if (caret >= 0) {
    text = text.replace('|', '');
    start = end = caret;
  } else {
    start = text.indexOf('«');
    text = text.replace('«', '');
    end = text.indexOf('»');
    text = text.replace('»', '');
  }
  const r = fn(text, start, end);
  const mid = r.start === r.end ? '|' : `«${r.text.slice(r.start, r.end)}»`;
  return r.text.slice(0, r.start) + mid + r.text.slice(r.end);
}

const bold = (t, s, e) => E.wrap(t, s, e, '**');
const italic = (t, s, e) => E.wrap(t, s, e, '*');

/* ---- inline markers ---- */
assert.strictEqual(run('a «word» b', bold), 'a **«word»** b');
assert.strictEqual(run('a |b', bold), 'a **|**b', 'no selection leaves the caret between the markers');
assert.strictEqual(run('a «**word**» b', bold), 'a «word» b', 'off when the markers are inside the selection');
assert.strictEqual(run('a **«word»** b', bold), 'a «word» b', 'off when they sit just outside it');
assert.strictEqual(run('«word»', italic), '*«word»*');
assert.strictEqual(run('*«word»*', italic), '«word»');
/* A marker at the very start must not read past the beginning of the
   string — a negative slice would wrap around and match the tail. */
assert.strictEqual(run('«a»**', bold), '**«a»****');
/* Dragging almost always catches the trailing newline; the marker must
   not straddle it. */
assert.strictEqual(run('«one\n»two', bold), '**«one»**\ntwo');
assert.strictEqual(run('« spaced »', bold), ' **«spaced»** ');
assert.strictEqual(run('a«   »b', bold), 'a**«   »**b', 'an all-whitespace selection is left alone');

/* ---- line prefixes ---- */
const bullet = (t, s, e) => E.linePrefix(t, s, e, 'bullet');
const task = (t, s, e) => E.linePrefix(t, s, e, 'task');
const quote = (t, s, e) => E.linePrefix(t, s, e, 'quote');
const heading = (t, s, e) => E.linePrefix(t, s, e, 'heading');
const number = (t, s, e) => E.linePrefix(t, s, e, 'number');

/* A collapsed caret never selects the inserted/removed marker — it stays
   collapsed at the same logical spot in the text, so the next keystroke
   continues the line instead of retyping over a highlighted prefix. */
assert.strictEqual(run('one|', bullet), '- one|', 'a collapsed caret stays collapsed, after the marker');
assert.strictEqual(run('- one|', bullet), 'one|', 'and off again, still collapsed');
assert.strictEqual(run('«one\ntwo»', bullet), '«- one\n- two»', 'a real selection still selects the block');
assert.strictEqual(run('«- one\n- two»', bullet), '«one\ntwo»', 'off only when every line has it');
assert.strictEqual(run('«- one\ntwo»', bullet), '«- one\n- two»', 'a mixed block turns all of it on');
assert.strictEqual(run('«one\ntwo\nthree»', number), '«1. one\n2. two\n3. three»');
assert.strictEqual(run('«- one\n- two»', task), '«- [ ] one\n- [ ] two»', 'a bullet becomes a task rather than stacking');
assert.strictEqual(run('«- [ ] one»', bullet), '«- one»', 'and back the other way');
assert.strictEqual(run('«- [x] done»', task), '«done»', 'a ticked task toggles off too');
assert.strictEqual(run('one|', heading), '### one|');
assert.strictEqual(run('## one|', heading), 'one|', 'any heading level toggles off, collapsed');
assert.strictEqual(run('one|', quote), '> one|');
assert.strictEqual(run('  indented|', bullet), '  - indented|', 'indentation is kept, caret stays collapsed');
assert.strictEqual(run('  - indented|', bullet), '  indented|');
assert.strictEqual(run('«one\n\ntwo»', bullet), '«- one\n\n- two»', 'a blank line inside a block stays blank');

/* A selection ending exactly on a line break belongs to the line before. */
assert.strictEqual(run('«one\n»two', bullet), '«- one»\ntwo');

/* ---- M5: collapsed-caret line prefix, the exact cases from the audit ---- */
assert.deepStrictEqual(E.linePrefix('', 0, 0, 'task'), { text: '- [ ] ', start: 6, end: 6 },
  'an empty line: the caret lands right after the marker, ready to type');
assert.deepStrictEqual(E.linePrefix('abc', 1, 1, 'bullet'), { text: '- abc', start: 3, end: 3 },
  'a mid-line collapsed caret moves by the length of the inserted prefix');

/* ---- links ---- */
assert.strictEqual(run('«Obsidian»', E.link), '[Obsidian](«url»)');
assert.strictEqual(run('see |', E.link), 'see [text](«url»)');
assert.strictEqual(run('«https://example.com»', E.link), '[|](https://example.com)', 'a selected URL becomes the target');
assert.strictEqual(run('«mailto:a@b.c»', E.link), '[|](mailto:a@b.c)');

/* ---- lineRange ---- */
assert.deepStrictEqual(E.lineRange('one\ntwo\nthree', 5, 5), [4, 7]);
assert.deepStrictEqual(E.lineRange('one\ntwo', 0, 0), [0, 3], 'the first line has no newline before it');
assert.deepStrictEqual(E.lineRange('one', 0, 3), [0, 3], 'nor a newline after the last');

/* ---- the toolbar table ---- */
assert.strictEqual(E.TOOLS.length, 7);
for (const t of E.TOOLS) {
  assert.ok(t.id && t.label && t.icon && typeof t.run === 'function', `${t.id}: every button has an action behind it`);
  const r = t.run('hello world', 0, 5);
  assert.ok(typeof r.text === 'string' && Number.isInteger(r.start) && Number.isInteger(r.end), `${t.id}: returns a selection`);
  assert.ok(r.start >= 0 && r.end <= r.text.length && r.start <= r.end, `${t.id}: the selection lands inside the text`);
  /* Nothing may be lost: every tool is reversible or additive, never
     destructive of the words themselves. */
  assert.ok(r.text.includes('hello'), `${t.id}: the text survives`);
}
const keys = E.TOOLS.filter(t => t.key).map(t => t.key);
assert.strictEqual(new Set(keys).size, keys.length, 'no two shortcuts collide');
console.log(`markdown-edit OK (${E.TOOLS.length} tools)`);
