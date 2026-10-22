'use strict';
const assert = require('node:assert');
const { parseFrontmatter, buildNote, patchFrontmatter, captureKeys, yamlStr, safeName } = require(process.env.RV_MARKDOWN || '../src/markdown');

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
  assert.ok(out.includes('tags:\n  - one\n  - two\n'), 'an untouched block sequence is written back exactly as found (no churn)');
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
  assert.strictEqual(out, '---\r\nrhythm: log\r\ndone: [A, B]\r\n---\r\nline1\r\nline2\r\n', 'no extra blank line is added on a CRLF note');
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
  /* Keys the patch did not touch keep their exact source lines — 007 and
     1.50 are the user's own spelling, not ours to re-quote. */
  assert.ok(out.includes('odd: 007\n'));
  assert.ok(out.includes('precise: 1.50\n'));
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
  assert.strictEqual(out, '---\ndone: [Read]\n---\nMy day\n', 'the zero-blank-line gap the note had is kept');
}
assert.strictEqual(buildNote({ rhythm: 'log', done: [] }, ''), '---\nrhythm: log\ndone: []\n---\n');


/* ---- Item 1: an apostrophe or quote opens a quoted span ONLY as the first
   non-space character of a scalar / list item. */
{
  const f = t => parseFrontmatter(t).fm;
  assert.deepStrictEqual(f("---\ndone: [Mom's call, Read]\n---\n").done, ["Mom's call", 'Read'], 'apostrophe mid-item is text');
  assert.deepStrictEqual(f("---\ndone: [Mom's call, Dad's call, Read]\n---\n").done, ["Mom's call", "Dad's call", 'Read'], 'two apostrophes in different items do not pair up');
  assert.deepStrictEqual(f("---\ndone: [ 'Read, daily', Mom's call]\n---\n").done, ['Read, daily', "Mom's call"], 'a leading quote (after spaces) still opens');
  assert.deepStrictEqual(f('---\ndone: [A "x" b, C]\n---\n').done, ['A "x" b', 'C'], 'a double quote mid-item is text too');
  assert.deepStrictEqual(f('---\ndone: ["Say \\"hi\\", ok", B]\n---\n').done, ['Say "hi", ok', 'B'], 'escaped quote inside a double-quoted item');
  assert.strictEqual(f("---\nnote: Mom's day # comment\n---\n").note, "Mom's day", 'comment after an apostrophe is stripped');
  assert.strictEqual(f('---\nlink: "[[Note #heading]]"\n---\n').link, '[[Note #heading]]');
  assert.strictEqual(f('---\nlink: [[Note #heading]]\n---\n').link, '[[Note #heading]]', 'a # inside [[ ]] is not a comment');
  assert.strictEqual(f('---\nlink: [[Note #heading]] # trailing\n---\n').link, '[[Note #heading]]', 'but a real comment after it still is');
  assert.strictEqual(f('---\nurl: https://x.com/a#b\n---\n').url, 'https://x.com/a#b', 'no space before # means no comment');
  assert.deepStrictEqual(f("---\ndone: [Mom's call, Read] # note\n---\n").done, ["Mom's call", 'Read'], 'comment after a list');
  /* Round trip through the writer: the real-world failure was a tick on a
     log that already held an apostrophe name, which dropped other names. */
  const t0 = buildNote({ rhythm: 'log', done: ["Mom's call"] }, '');
  const t1 = patchFrontmatter(t0, { done: ["Mom's call", 'Read', "Dad's walk"] });
  assert.deepStrictEqual(parseFrontmatter(t1).fm.done, ["Mom's call", 'Read', "Dad's walk"]);
}

/* ---- Item 5: the closing fence is a line of its own, in column 0. */
{
  const t = '---\nrhythm: goal\nnext: write intro ---\narea: Craft\n---\nBody line\n';
  const { fm, body } = parseFrontmatter(t);
  assert.strictEqual(fm.next, 'write intro ---');
  assert.strictEqual(fm.area, 'Craft', 'keys after a value ending in --- are still frontmatter');
  assert.strictEqual(body, 'Body line\n');
  assert.strictEqual(patchFrontmatter(t, { status: 'done' }), '---\nrhythm: goal\nnext: write intro ---\narea: Craft\nstatus: done\n---\nBody line\n');
  const blk = '---\nrhythm: goal\nnote: |\n  first\n  ---\n  last\narea: Craft\n---\nBody\n';
  const r = parseFrontmatter(blk);
  assert.strictEqual(r.fm.area, 'Craft', 'an indented --- inside a block scalar does not close the block');
  assert.strictEqual(r.body, 'Body\n');
  assert.strictEqual(patchFrontmatter(blk, { area: 'Faith' }), blk.replace('area: Craft', 'area: Faith'));
  assert.strictEqual(parseFrontmatter('---\r\nrhythm: log\r\n---\r\nB\r\n').body, 'B\r\n', 'CRLF fence');
  assert.strictEqual(parseFrontmatter('---\nrhythm: log\n---').body, '', 'fence at end of file with no newline');
  assert.strictEqual(parseFrontmatter('---\nrhythm: log\nno close here\n').body, '---\nrhythm: log\nno close here\n', 'no closing fence: not frontmatter');
}

/* ---- Item 6: an unindented block list is a list, replaced whole. */
{
  const t = '---\nrhythm: log\ndone:\n- Read\n- Pray\nskip: [X]\n---\nbody\n';
  assert.deepStrictEqual(parseFrontmatter(t).fm.done, ['Read', 'Pray']);
  assert.strictEqual(parseFrontmatter(t).fm.skip.length, 1, 'the key after the block is still read');
  const out = patchFrontmatter(t, { done: ['Read', 'Pray', 'Walk'] });
  assert.strictEqual(out, '---\nrhythm: log\ndone: [Read, Pray, Walk]\nskip: [X]\n---\nbody\n', 'no stray "- Read" lines left behind');
  assert.deepStrictEqual(parseFrontmatter('---\ndone:\n  - "A, b"\n  - \'C\'\n---\n').fm.done, ['A, b', 'C']);
}

/* ---- Item 7: a patch leaves every untouched key's raw line byte-identical. */
{
  const t = '---\nrhythm: practice\narea: Body\ntitle: a [b] c\ntime: 07:30\nwhen: \'morning\'\ntags:\n- a\n- b\nurl: https://x.com/a#b\nodd: 007\ncadence: 3/week # was daily\nlist: [x,y ,  z]\n---\nbody\n';
  const out = patchFrontmatter(t, { minutes: 20 });
  assert.strictEqual(out, t.replace('---\nbody', 'minutes: 20\n---\nbody'), 'only the new key is added; every other line is as written');
  const out2 = patchFrontmatter(t, { area: 'Faith' });
  assert.strictEqual(out2, t.replace('area: Body', 'area: Faith'), 'only the patched key changes');
  const out3 = patchFrontmatter(t, { list: ['x', 'y', 'z'] });
  assert.strictEqual(out3, t, 'writing an unchanged value back is a no-op on the bytes');
  assert.strictEqual(patchFrontmatter(t, { list: ['x', 'y', 'z', 'w'] }), t.replace('list: [x,y ,  z]', 'list: [x, y, z, w]'));
}

/* ---- Item 8: the gap between the fence and the body is the note's own. */
{
  for (const gap of ['', '\n', '\n\n', '\n\n\n']) {
    const t = '---\ndone: [A]\n---\n' + gap + 'Body\n';
    const out = patchFrontmatter(t, { done: ['A', 'B'] });
    assert.strictEqual(out, '---\ndone: [A, B]\n---\n' + gap + 'Body\n', 'gap ' + JSON.stringify(gap) + ' kept');
    assert.strictEqual(parseFrontmatter(t).body, 'Body\n');
  }
  const crlf = '---\r\ndone: [A]\r\n---\r\n\r\n\r\nBody\r\n';
  assert.strictEqual(patchFrontmatter(crlf, { done: ['A', 'B'] }), '---\r\ndone: [A, B]\r\n---\r\n\r\n\r\nBody\r\n');
  assert.strictEqual(patchFrontmatter('Just text\n', { rhythm: 'x' }), '---\nrhythm: x\n---\n\nJust text\n', 'a note with no frontmatter gets one blank line');
  assert.strictEqual(buildNote({ a: 1 }, '\n\nBody'), '---\na: 1\n---\n\nBody', 'a fresh note: exactly one blank line');
  const bom = '﻿---\ndone: [A]\n---\nBody\n';
  assert.strictEqual(patchFrontmatter(bom, { done: ['A', 'B'] }), '﻿---\ndone: [A, B]\n---\nBody\n', 'BOM is kept');
}

/* ---- Item 9 (helper half): captureKeys + opts.restore put a dropped key
   back at its old position, with its old lines when the value matches. */
{
  const t = '---\nrhythm: log\ndone: [A,B]\nskip: [X]\nsnooze: [Bible study, J]\nplan: [P]\n---\n';
  const snap = captureKeys(t, ['done', 'skip', 'snooze', 'plan', 'nope']);
  assert.strictEqual(snap.nope, null);
  assert.deepStrictEqual([snap.done.pos, snap.skip.pos, snap.snooze.pos, snap.plan.pos], [1, 2, 3, 4]);
  const dropped = patchFrontmatter(t, { skip: undefined, snooze: undefined, plan: undefined });
  assert.strictEqual(dropped, '---\nrhythm: log\ndone: [A,B]\n---\n');
  const back = patchFrontmatter(dropped, { skip: ['X'], snooze: ['Bible study', 'J'], plan: ['P'] }, { restore: snap });
  assert.strictEqual(back, t, 'dropped keys return to their old order and exact lines');
  const mid = patchFrontmatter('---\nrhythm: log\ndone: [A]\nplan: [P]\n---\n', { snooze: ['S'] }, { restore: { snooze: { pos: 2, lines: ['snooze: [S]'], value: ['S'] } } });
  assert.strictEqual(mid, '---\nrhythm: log\ndone: [A]\nsnooze: [S]\nplan: [P]\n---\n', 'inserted before the key now at that ordinal');
}

/* ---- Empty-valued keys (`key:`, `key: null`, `key: ~`) are ONE layout slot
   holding null: a patch replaces that line in place, never duplicates it. */
{
  const t = '---\nrhythm: log\ndone: [A]\nskip:\n---\n';
  assert.strictEqual(parseFrontmatter(t).fm.skip, null);
  assert.strictEqual(patchFrontmatter(t, { skip: ['B'] }), '---\nrhythm: log\ndone: [A]\nskip: [B]\n---\n', 'no second skip: line');
  assert.strictEqual(patchFrontmatter(t, { done: ['A', 'C'] }), t.replace('[A]', '[A, C]'), 'untouched empty key is byte-identical');
  for (const empty of ['skip:', 'skip: ', 'skip: null', 'skip: ~']) {
    const u = '---\nrhythm: log\n' + empty + '\ndone: [A]\n---\nb\n';
    assert.strictEqual(parseFrontmatter(u).fm.skip, null, JSON.stringify(empty));
    assert.strictEqual(patchFrontmatter(u, { skip: ['B'] }), '---\nrhythm: log\nskip: [B]\ndone: [A]\n---\nb\n', JSON.stringify(empty) + ' replaced in place');
    assert.strictEqual(patchFrontmatter(u, { skip: undefined }), '---\nrhythm: log\ndone: [A]\n---\nb\n', JSON.stringify(empty) + ' can be dropped');
  }
  const blank = '---\nskip:\n\ndone: [A]\n---\n';
  assert.strictEqual(parseFrontmatter(blank).fm.skip, null, 'key: then a blank line then another key');
  assert.deepStrictEqual(parseFrontmatter(blank).fm.done, ['A']);
  assert.strictEqual(patchFrontmatter(blank, { skip: ['B'] }), '---\nskip: [B]\n\ndone: [A]\n---\n');
  const nested = '---\nmeta:\n  k: v\ndone: [A]\n---\n';
  assert.strictEqual(patchFrontmatter(nested, { done: ['A', 'B'] }), nested.replace('[A]', '[A, B]'), 'a nested map is still raw, not an empty key');
}

assert.strictEqual(safeName('Hike: Mountains / Oct?'), 'Hike- Mountains - Oct-');
console.log('markdown OK');
