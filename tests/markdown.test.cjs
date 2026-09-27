'use strict';
const assert = require('node:assert');
const { parseFrontmatter, buildNote, patchFrontmatter, yamlStr, safeName } = require('../src/markdown');

/* Round trip: flat keys, an inline list, and a BLOCK sequence — the form
   Obsidian's own Properties panel writes for a list property — which is
   now modelled as an array like any other list. */
{
  const text = '---\nrhythm: practice\narea: Faith\ntags:\n  - one\n  - two\ndone: [Read, "Write, letter"]\n---\n\nMy body line.\n';
  const { fm, body } = parseFrontmatter(text);
  assert.strictEqual(fm.rhythm, 'practice');
  assert.deepStrictEqual(fm.done, ['Read', 'Write, letter']);
  assert.deepStrictEqual(fm.tags, ['one', 'two'], 'block sequence is modelled as an array');
  assert.strictEqual(body, 'My body line.\n');
  const out = patchFrontmatter(text, { area: 'Family' });
  assert.ok(out.includes('tags: [one, two]'), 'the whole block collapses to one inline line on any save');
  assert.ok(!/tags:\n/.test(out), 'no leftover block-sequence lines');
  assert.ok(out.includes('area: Family'));
  assert.ok(out.includes('done: [Read, "Write, letter"]'), 'comma inside an item is quoted');
  assert.ok(out.endsWith('\nMy body line.\n'), 'body untouched');
}

/* C1: patching a block-sequence key itself must REPLACE the whole block —
   key line and every continuation line — never leave the old lines behind
   to form a duplicate key. */
{
  const text = '---\nrhythm: log\ndone:\n  - Read the Bible\n  - Exercise\n---\n\nbody\n';
  const { fm } = parseFrontmatter(text);
  assert.deepStrictEqual(fm.done, ['Read the Bible', 'Exercise']);
  const out = patchFrontmatter(text, { done: [...fm.done, 'Journal'] });
  assert.strictEqual((out.match(/^done:/gm) || []).length, 1, 'exactly one done: line, never two');
  assert.deepStrictEqual(parseFrontmatter(out).fm.done, ['Read the Bible', 'Exercise', 'Journal']);
  assert.ok(!out.includes('  - Read the Bible'), 'old block lines are gone');
}

/* key: [] and a block sequence with zero items both read as an empty
   array, and days (or any other key) parses the same way as done. */
{
  assert.deepStrictEqual(parseFrontmatter('---\ndays: []\n---\n').fm.days, []);
  const pr = '---\nrhythm: practice\narea: Faith\ncadence: daily\ndays:\n  - sat\n---\n';
  assert.deepStrictEqual(parseFrontmatter(pr).fm.days, ['sat']);
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

/* yamlStr: flow indicators matter ANYWHERE in the scalar, indicator
   characters only at the start. */
assert.strictEqual(yamlStr('Read {daily}'), '"Read {daily}"', 'a brace anywhere, not just at the start');
assert.strictEqual(yamlStr('a [b] c'), '"a [b] c"');
assert.strictEqual(yamlStr('Pray, then read'), '"Pray, then read"', 'a comma anywhere');
assert.strictEqual(yamlStr("Mom's call"), "Mom's call", 'an apostrophe NOT at the start stays bare');
assert.strictEqual(yamlStr('Tea & toast'), 'Tea & toast', 'an ampersand not at the start stays bare');
assert.strictEqual(yamlStr('? why'), '"? why"', 'an explicit-key indicator at the start');
assert.strictEqual(yamlStr('- item'), '"- item"');

/* Single-quoted YAML (hand-written or another tool) unquotes, doubled `''`
   is the escape for a literal `'`, both standalone and inside a list. */
assert.strictEqual(parseFrontmatter("---\nnext: 'Call the bank'\n---\n").fm.next, 'Call the bank');
assert.strictEqual(parseFrontmatter("---\nname: 'It''s done'\n---\n").fm.name, "It's done");
assert.deepStrictEqual(
  parseFrontmatter("---\ndone: ['Read the Bible', 'Exercise']\n---\n").fm.done,
  ['Read the Bible', 'Exercise'],
);
/* A single-quoted scalar that isn't touched must not churn on save. */
{
  const text = "---\nnext: 'Call the bank'\narea: Faith\n---\n";
  const out = patchFrontmatter(text, { area: 'Body' });
  assert.ok(out.includes("next: 'Call the bank'") || out.includes('next: Call the bank'),
    'single-quoted scalar reads correctly either way — round trip is what matters');
  assert.strictEqual(parseFrontmatter(out).fm.next, 'Call the bank');
}

/* An unquoted scalar's trailing ` # comment` (space then hash) is a
   comment, not part of the value — but only outside quotes. */
assert.strictEqual(parseFrontmatter('---\ncadence: 3/week # was daily\n---\n').fm.cadence, '3/week');
assert.strictEqual(parseFrontmatter('---\ncadence: "3/week # was daily"\n---\n').fm.cadence, '3/week # was daily',
  'a quoted hash is not a comment');

/* CRLF in, CRLF out — no mixed endings, body passed through untouched. */
{
  const text = '---\r\nrhythm: log\r\ndone: [A]\r\n---\r\nline1\r\nline2\r\n';
  const out = patchFrontmatter(text, { done: ['A', 'B'] });
  assert.ok(!/[^\r]\n/.test(out.split('line1')[0]), 'no bare \\n in the frontmatter fence — CRLF throughout');
  assert.strictEqual(out, '---\r\nrhythm: log\r\ndone: [A, B]\r\n---\r\n\r\nline1\r\nline2\r\n');
  assert.deepStrictEqual(parseFrontmatter(out).fm.done, ['A', 'B']);
}

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

/* M4: BOM. A leading U+FEFF must not stop the fence from matching — the
   frontmatter must not fall into the body. */
{
  const text = '﻿---\nrhythm: log\ndone: [Read]\n---\nbody\n';
  const { fm, body } = parseFrontmatter(text);
  assert.deepStrictEqual(fm.done, ['Read']);
  assert.strictEqual(body, 'body\n');
  const out = patchFrontmatter(text, { done: ['Read', 'Journal'] });
  assert.deepStrictEqual(parseFrontmatter(out).fm.done, ['Read', 'Journal']);
  assert.ok(!out.includes('done: [Read]\n---\nbody'), 'the old frontmatter did not get pushed into the body');
}

/* An empty frontmatter block `---\n---` (no room for a key or a body line
   between the two fences) is recognised, not mistaken for no frontmatter
   at all. */
{
  const text = '---\n---\nMy day\n';
  assert.deepStrictEqual(parseFrontmatter(text).fm, {});
  assert.strictEqual(parseFrontmatter(text).body, 'My day\n');
  const out = patchFrontmatter(text, { done: ['Read'] });
  assert.strictEqual(out, '---\ndone: [Read]\n---\n\nMy day\n');
}
assert.strictEqual(buildNote({ rhythm: 'log', done: [] }, ''), '---\nrhythm: log\ndone: []\n---\n');

assert.strictEqual(safeName('Hike: Mountains / Oct?'), 'Hike- Mountains - Oct-');
console.log('markdown OK');
