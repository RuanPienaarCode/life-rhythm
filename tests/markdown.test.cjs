'use strict';
const assert = require('node:assert');
const { parseFrontmatter, buildNote, patchFrontmatter, yamlStr, safeName } = require('../src/markdown');

/* Round trip: flat keys, an inline list, and a BLOCK sequence the plugin
   cannot model, which must pass through byte-for-byte. */
{
  const text = '---\nrhythm: practice\narea: Faith\ntags:\n  - one\n  - two\ndone: [Read, "Write, letter"]\n---\n\nMy body line.\n';
  const { fm, body } = parseFrontmatter(text);
  assert.strictEqual(fm.rhythm, 'practice');
  assert.deepStrictEqual(fm.done, ['Read', 'Write, letter']);
  assert.strictEqual(fm.tags, undefined, 'block sequence is not modelled');
  assert.strictEqual(body, 'My body line.\n');
  const out = patchFrontmatter(text, { area: 'Family' });
  assert.ok(out.includes('tags:\n  - one\n  - two'), 'block sequence survives verbatim');
  assert.ok(out.includes('area: Family'));
  assert.ok(out.includes('done: [Read, "Write, letter"]'), 'comma inside an item is quoted');
  assert.ok(out.endsWith('\nMy body line.\n'), 'body untouched');
}

/* Repeated patching must not grow the file (no blank-line creep, no
   quote creep). */
{
  let text = buildNote({ rhythm: 'log', done: ['A "quoted" name'] }, 'journal\n');
  const first = patchFrontmatter(text, { done: ['A "quoted" name', 'B'] });
  const second = patchFrontmatter(first, { done: ['A "quoted" name', 'B'] });
  assert.strictEqual(first, second);
  assert.deepStrictEqual(parseFrontmatter(second).fm.done, ['A "quoted" name', 'B']);
}

/* yamlStr: dates bare, numbers-as-names quoted, plain names bare. */
assert.strictEqual(yamlStr('2026-09-12'), '2026-09-12');
assert.strictEqual(yamlStr('2026-11'), '2026-11');
assert.strictEqual(yamlStr('2024'), '"2024"');
assert.strictEqual(yamlStr('Practice guitar'), 'Practice guitar');
assert.strictEqual(yamlStr('a: b'), '"a: b"');
assert.strictEqual(yamlStr('05:30'), '"05:30"', 'bare 05:30 is sexagesimal 330 to a YAML 1.1 reader');
assert.strictEqual(yamlStr('C# lessons'), '"C# lessons"', 'a bare # would start a comment');
assert.strictEqual(yamlStr(15), '15');

/* A bare number round-trips bare, so editing a note does not churn
   `minutes: 45` into `minutes: "45"` — these are the user's own files. */
{
  const text = '---\nminutes: 45\nodd: 007\nprecise: 1.50\nname: "2024"\n---\n\nbody\n';
  const { fm } = parseFrontmatter(text);
  assert.strictEqual(fm.minutes, 45, 'a plain integer reads as a number');
  assert.strictEqual(fm.odd, '007', 'a leading zero is not a number, it is a label');
  assert.strictEqual(fm.precise, '1.50', 'nor is a trailing zero, which would not round-trip');
  assert.strictEqual(fm.name, '2024', 'and a quoted one stays a string');
  const out = patchFrontmatter(text, { area: 'Body' });
  assert.ok(out.includes('minutes: 45'), 'written back bare — this is the one that would churn');
  assert.ok(out.includes('name: "2024"'), 'a quoted number keeps its quotes');
  /* 007 and 1.50 GAIN quotes once, which is the meaning-preserving thing
     to do: bare 007 is octal in YAML 1.1, and bare 1.50 is 1.5. */
  assert.ok(out.includes('odd: "007"'));
  assert.ok(out.includes('precise: "1.50"'));
  assert.strictEqual(patchFrontmatter(out, {}), out, 'and every save after the first changes nothing');
}

/* Empty frontmatter, no frontmatter. */
assert.deepStrictEqual(parseFrontmatter('plain text').fm, {});
assert.strictEqual(parseFrontmatter('plain text').body, 'plain text');
assert.strictEqual(buildNote({ rhythm: 'log', done: [] }, ''), '---\nrhythm: log\ndone: []\n---\n');

assert.strictEqual(safeName('Hike: Mountains / Oct?'), 'Hike- Mountains - Oct-');
console.log('markdown OK');
