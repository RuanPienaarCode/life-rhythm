'use strict';
/* The line format IS the storage. Every reminder is one Obsidian Tasks
   checkbox line, so the Tasks plugin, a grep and a human all read the same
   file. Parsing must be lossless: anything we don't understand round-trips
   untouched rather than being deleted. */
const assert = require('node:assert');
const T = require('../src/reminders/tasks');

/* ---- parse ---------------------------------------------------------- */
const a = T.parseLine("- [ ] Sign the school's permission slip 📅 2026-09-20 ⏰ 09:00 ⏫ 🔁 every month #family");
assert.ok(a);
assert.strictEqual(a.title, "Sign the school's permission slip");
assert.strictEqual(a.due, '2026-09-20');
assert.strictEqual(a.time, '09:00');
assert.strictEqual(a.priority, 'high');
assert.strictEqual(a.repeat, 'every month');
assert.deepStrictEqual(a.tags, ['#family']);
assert.strictEqual(a.done, false);

const b = T.parseLine('  * [x] Renew licence disc 📅 2026-09-01 ✅ 2026-09-02');
assert.strictEqual(b.indent, '  ');
assert.strictEqual(b.marker, '*');
assert.strictEqual(b.done, true);
assert.strictEqual(b.doneDate, '2026-09-02');
assert.strictEqual(b.priority, 'normal');

assert.strictEqual(T.parseLine('Just a paragraph'), null);
assert.strictEqual(T.parseLine('## A heading'), null);
assert.strictEqual(T.parseLine('- a plain bullet'), null);
assert.strictEqual(T.parseLine('- [/] In progress'), null, 'only open and done lines are reminders');
assert.strictEqual(T.parseLine('1. [ ] Numbered').marker, '1.');

/* Priorities, all five of them plus the unmarked middle. */
for (const [emoji, name] of [['🔺', 'highest'], ['⏫', 'high'], ['🔼', 'medium'], ['🔽', 'low'], ['⏬', 'lowest']]) {
  assert.strictEqual(T.parseLine(`- [ ] X ${emoji}`).priority, name, emoji);
}
assert.ok(T.rank('highest') > T.rank('high'));
assert.ok(T.rank('high') > T.rank('normal'));
assert.ok(T.rank('normal') > T.rank('low'));
assert.ok(T.rank('low') > T.rank('lowest'));

/* Tokens we don't drive the UI from are still parsed, so they survive a save. */
const c = T.parseLine('- [ ] Pay rates ➕ 2026-09-01 🛫 2026-09-05 ⏳ 2026-09-10 📅 2026-09-13 🆔 abc123');
assert.strictEqual(c.title, 'Pay rates');
assert.strictEqual(c.created, '2026-09-01');
assert.strictEqual(c.start, '2026-09-05');
assert.strictEqual(c.scheduled, '2026-09-10');
assert.strictEqual(c.id, 'abc123');

/* A due date with no space before the emoji, and a trailing link. */
const d = T.parseLine('- [ ] Read [[Some Note]] 📅 2026-09-20');
assert.strictEqual(d.title, 'Read [[Some Note]]');
assert.strictEqual(d.due, '2026-09-20');

/* ---- serialize ------------------------------------------------------ */
assert.strictEqual(
  T.serializeLine({ title: 'Buy milk', due: '2026-09-20', priority: 'normal' }),
  '- [ ] Buy milk 📅 2026-09-20');
assert.strictEqual(
  T.serializeLine({ title: 'Buy milk', done: true, doneDate: '2026-09-21', due: '2026-09-20' }),
  '- [x] Buy milk 📅 2026-09-20 ✅ 2026-09-21');
assert.strictEqual(
  T.serializeLine({ title: 'Walk', priority: 'lowest' }),
  '- [ ] Walk ⏬');
assert.strictEqual(
  T.serializeLine({ indent: '  ', marker: '*', title: 'Nested', due: '2026-09-20' }),
  '  * [ ] Nested 📅 2026-09-20');
assert.strictEqual(
  T.serializeLine({ title: 'Tagged', tags: ['#family', '#health'], due: '2026-09-20' }),
  '- [ ] Tagged #family #health 📅 2026-09-20');
assert.strictEqual(
  T.serializeLine({ title: 'Timed', due: '2026-09-20', time: '09:00' }),
  '- [ ] Timed ⏰ 09:00 📅 2026-09-20');

/* ---- Tasks reads fields from the END ------------------------------- */
/* Obsidian Tasks (8.4.0) anchors every field regex to the end of the line and
   walks backwards, peeling tags and fields off until something is neither —
   then stops. ⏰ is not a Tasks field, so anything written AFTER it is
   invisible to Tasks. This is that reader, cut down to what we write. */
const TASKS_FIELDS = [
  ['priority', /\s*(🔺|⏫|🔼|🔽|⏬)️?$/],
  ['due', /(?:📅|📆|🗓)️? *(\d{4}-\d{2}-\d{2})$/],
  ['done', /✅️? *(\d{4}-\d{2}-\d{2})$/],
  ['created', /➕️? *(\d{4}-\d{2}-\d{2})$/],
  ['start', /🛫️? *(\d{4}-\d{2}-\d{2})$/],
  ['scheduled', /(?:⏳|⌛)️? *(\d{4}-\d{2}-\d{2})$/],
  ['recurrence', /🔁️? *([a-zA-Z0-9, !]+)$/],
  ['id', /🆔️? *([a-zA-Z0-9-_]+)$/],
  ['dependsOn', /⛔️? *([a-zA-Z0-9-_]+( *, *[a-zA-Z0-9-_]+ *)*)$/],
  ['onCompletion', /🏁️? *([a-zA-Z]+)$/],
];
function tasksRead(line) {
  let body = T.LINE_RE.exec(line)[4].trim();
  const got = {};
  for (let moved = true; moved;) {
    moved = false;
    const tag = /(^|\s)#[^\s#]+$/.exec(body);
    if (tag) { body = body.slice(0, tag.index).trim(); moved = true; continue; }
    for (const [name, re] of TASKS_FIELDS) {
      const m = re.exec(body);
      if (!m) continue;
      got[name] = (m[1] || '').trim();
      body = body.slice(0, m.index).trim();
      moved = true;
      break;
    }
  }
  got.description = body;
  return got;
}
/* The reader reproduces the bug on the old spelling… */
assert.strictEqual(tasksRead('- [ ] Phone the dentist #health 📅 2026-10-01 ⏰ 09:30').due, undefined);
/* …and a timed reminder as we now write it keeps every Tasks field in the
   trailing run. */
const timed = T.serializeLine({
  title: 'Phone the dentist', tags: ['#health'], due: '2026-10-01', time: '09:30',
  priority: 'high', repeat: 'every month', start: '2026-09-28', scheduled: '2026-09-30',
  created: '2026-09-27', id: 'abc123', blockedBy: 'xyz9',
});
assert.strictEqual(timed,
  '- [ ] Phone the dentist ⏰ 09:30 #health 📅 2026-10-01 ⏫ 🔁 every month 🛫 2026-09-28 ⏳ 2026-09-30 ➕ 2026-09-27 🆔 abc123 ⛔ xyz9');
const seen = tasksRead(timed);
assert.strictEqual(seen.due, '2026-10-01', 'Tasks finds the due date on a timed reminder');
assert.strictEqual(seen.priority, '⏫');
assert.strictEqual(seen.recurrence, 'every month');
assert.strictEqual(seen.start, '2026-09-28');
assert.strictEqual(seen.scheduled, '2026-09-30');
assert.strictEqual(seen.created, '2026-09-27');
assert.strictEqual(seen.id, 'abc123');
assert.strictEqual(seen.dependsOn, 'xyz9');
assert.strictEqual(seen.description, 'Phone the dentist ⏰ 09:30');
const ticked = T.serializeLine({ title: 'Timed', done: true, doneDate: '2026-10-02', due: '2026-10-01', time: '09:30' });
assert.strictEqual(ticked, '- [x] Timed ⏰ 09:30 📅 2026-10-01 ✅ 2026-10-02');
assert.strictEqual(tasksRead(ticked).due, '2026-10-01');
assert.strictEqual(tasksRead(ticked).done, '2026-10-02');

/* A line written in the old order still parses, and the next save moves ⏰
   out of the trailing run. */
const legacy = T.parseLine('- [ ] Phone the dentist #health 📅 2026-10-01 ⏰ 09:30 ⏫');
assert.strictEqual(legacy.title, 'Phone the dentist');
assert.strictEqual(legacy.due, '2026-10-01');
assert.strictEqual(legacy.time, '09:30');
assert.strictEqual(legacy.priority, 'high');
assert.deepStrictEqual(legacy.tags, ['#health']);
assert.strictEqual(T.serializeLine(legacy), '- [ ] Phone the dentist ⏰ 09:30 #health 📅 2026-10-01 ⏫');

/* ---- round trip ----------------------------------------------------- */
const LINES = [
  "- [ ] Sign the school's permission slip 📅 2026-09-20 ⏰ 09:00 ⏫ 🔁 every month #family",
  '  * [x] Renew licence disc 📅 2026-09-01 ✅ 2026-09-02',
  '- [ ] Pay rates ➕ 2026-09-01 🛫 2026-09-05 ⏳ 2026-09-10 📅 2026-09-13 🆔 abc123',
  '- [ ] Bare',
  '- [ ] Read [[Some Note]] 📅 2026-09-20 🔽',
];
for (const raw of LINES) {
  const once = T.serializeLine(T.parseLine(raw));
  const twice = T.serializeLine(T.parseLine(once));
  assert.strictEqual(twice, once, `serialize is idempotent for: ${raw}`);
  const re = T.parseLine(once);
  const orig = T.parseLine(raw);
  for (const k of ['title', 'due', 'time', 'priority', 'repeat', 'created', 'start', 'scheduled', 'doneDate', 'id', 'done']) {
    assert.deepStrictEqual(re[k], orig[k], `${k} survives a round trip of: ${raw}`);
  }
  assert.deepStrictEqual(re.tags, orig.tags, `tags survive: ${raw}`);
}

/* ---- reading a whole note ------------------------------------------ */
const NOTE = [
  '# Reminders',
  '',
  'Anything above a heading is left alone.',
  '',
  '## Family',
  "- [ ] Sign the school's permission slip 📅 2026-09-20 ⏫",
  '- [x] Buy light bulbs 📅 2026-09-10 ✅ 2026-09-10',
  '',
  '## Admin',
  '- [ ] Renew the licence disc 📅 2026-10-01',
  'not a task',
].join('\n');
const items = T.parseNote(NOTE);
assert.strictEqual(items.length, 3);
assert.strictEqual(items[0].group, 'Family');
assert.strictEqual(items[0].line, 5, 'the zero-based line number it came from');
assert.strictEqual(items[2].group, 'Admin');
assert.strictEqual(T.parseNote('- [ ] Loose\n')[0].group, '', 'no heading yet is no group');
assert.deepStrictEqual(T.groupsOf(NOTE), ['Family', 'Admin']);
/* A single # is the note's title, not a section: people head the note
   "# Reminders", and everything under it is ungrouped until a ## says
   otherwise. */
assert.strictEqual(T.parseNote('# Reminders\n- [ ] Loose\n')[0].group, '');
assert.deepStrictEqual(T.groupsOf('# Reminders\n- [ ] Loose\n'), []);
assert.strictEqual(T.parseNote('## Family\n- [ ] A\n# Reminders\n- [ ] B\n')[1].group, '',
  'a title further down ends the section above it');
/* ---- lossless on the awkward lines (audit, 27 Sep 2026) ---- */
const round = l => T.serializeLine(T.parseLine(l));
let p;
p = T.parseLine('- [ ] Call dentist ⏰️ 09:00 📅 2026-10-01');
assert.deepStrictEqual([p.title, p.time], ['Call dentist', '09:00'], 'a marker with U+FE0F is still the marker');
p = T.parseLine('- [ ] Call dentist 📅 tomorrow');
assert.deepStrictEqual([p.title, p.due], ['Call dentist 📅 tomorrow', ''], 'a value that does not parse keeps its marker');
assert.strictEqual(round('- [ ] Call dentist 📅 tomorrow'), '- [ ] Call dentist 📅 tomorrow');
p = T.parseLine('- [ ] Check `📅 2020-01-01` format 📅 2026-10-01');
assert.deepStrictEqual([p.title, p.due], ['Check `📅 2020-01-01` format', '2026-10-01'], 'a code span is text');
p = T.parseLine('- [ ] Read [[Trip 📅 2020-05-05]] notes');
assert.deepStrictEqual([p.title, p.due], ['Read [[Trip 📅 2020-05-05]] notes', ''], 'so is a wikilink');
p = T.parseLine('- [ ] Pay rent 📅 2026-10-01 ^rent1');
assert.deepStrictEqual([p.title, p.blockId], ['Pay rent', '^rent1']);
assert.strictEqual(T.serializeLine(Object.assign({}, p, { priority: 'high' })), '- [ ] Pay rent 📅 2026-10-01 ⏫ ^rent1', 'the block id is written last');
p = T.parseLine('- [ ] Fix issue #12 today 📅 2026-10-01');
assert.deepStrictEqual([p.title, p.tags], ['Fix issue #12 today', []], 'an all-digit #12 is not a tag');
p = T.parseLine('- [ ] crlf 📅 2026-10-01\r');
assert.strictEqual(p && p.due, '2026-10-01', 'a CRLF line parses');
assert.deepStrictEqual(T.parseNote('# R\r\n## Home\r\n- [ ] a 📅 2026-10-01\r\n').map(i => `${i.group}:${i.title}`), ['Home:a'], 'and so does a CRLF note');
assert.deepStrictEqual(T.listsOf('## A\r\n## B\r\n'), ['A', 'B']);
/* where Tasks' trailing run starts */
assert.strictEqual(T.trailingRunStart('Call #fam 📅 2026-10-01 ⏫'), 5);
assert.strictEqual(T.trailingRunStart('Just words'), 10);
/* ---- audit, 7 Oct 2026 ----------------------------------------------- */

/* L5: a second copy of a single-value field is kept as text, marker and all.
   The LAST copy is the field (it is the one Tasks reads, peeling from the
   end); an explicit edit must never come back smaller than it went in. */
p = T.parseLine('- [ ] Two priorities ⏫ 🔽 📅 2026-10-01');
assert.deepStrictEqual([p.title, p.priority, p.due], ['Two priorities ⏫', 'low', '2026-10-01']);
assert.strictEqual(round('- [ ] Two priorities ⏫ 🔽 📅 2026-10-01'), '- [ ] Two priorities ⏫ 📅 2026-10-01 🔽');
assert.strictEqual(round(round('- [ ] Two priorities ⏫ 🔽 📅 2026-10-01')), '- [ ] Two priorities ⏫ 📅 2026-10-01 🔽', 'and a second save changes nothing');
p = T.parseLine('- [ ] Two dues 📅 2026-10-01 📅 2026-10-05');
assert.deepStrictEqual([p.title, p.due], ['Two dues 📅 2026-10-01', '2026-10-05']);
assert.strictEqual(round('- [ ] Two dues 📅 2026-10-01 📅 2026-10-05'), '- [ ] Two dues 📅 2026-10-01 📅 2026-10-05');
p = T.parseLine('- [ ] Done date on open ✅ 2026-10-01 📅 2026-10-05');
assert.deepStrictEqual([p.title, p.doneDate, p.due], ['Done date on open ✅ 2026-10-01', '', '2026-10-05'], 'a ✅ on an open line is text');
assert.strictEqual(round('- [ ] Done date on open ✅ 2026-10-01 📅 2026-10-05'), '- [ ] Done date on open ✅ 2026-10-01 📅 2026-10-05');
p = T.parseLine('- [x] Twice ✅ 2026-10-01 ✅ 2026-10-02');
assert.deepStrictEqual([p.title, p.doneDate], ['Twice ✅ 2026-10-01', '2026-10-02']);
p = T.parseLine('- [ ] Two repeats 🔁 every day 🔁 every week');
assert.deepStrictEqual([p.title, p.repeat], ['Two repeats 🔁 every day', 'every week']);
assert.strictEqual(round('- [ ] Two repeats 🔁 every day 🔁 every week'), '- [ ] Two repeats 🔁 every day 🔁 every week');
/* %%comments%% and [text](links) are quoted text, like code spans */
p = T.parseLine('- [ ] Note %%📅 2020-01-01%% 📅 2026-10-01');
assert.deepStrictEqual([p.title, p.due], ['Note %%📅 2020-01-01%%', '2026-10-01'], 'a comment is text');
p = T.parseLine('- [ ] Link [📅 cal](https://x.y/#top) 📅 2026-10-01');
assert.deepStrictEqual([p.title, p.tags, p.due], ['Link [📅 cal](https://x.y/#top)', [], '2026-10-01'], 'so is a markdown link, and its #anchor is not a tag');
assert.strictEqual(round('- [ ] Link [📅 cal](https://x.y/#top) 📅 2026-10-01'), '- [ ] Link [📅 cal](https://x.y/#top) 📅 2026-10-01');

/* L6: ⛔ takes Tasks' whole list, spaces after the commas included */
p = T.parseLine('- [ ] Ship it ⛔ abc, def 📅 2026-10-01');
assert.deepStrictEqual([p.title, p.blockedBy], ['Ship it', 'abc, def']);
assert.strictEqual(round('- [ ] Ship it ⛔ abc, def 📅 2026-10-01'), '- [ ] Ship it 📅 2026-10-01 ⛔ abc, def');
assert.strictEqual(T.parseLine('- [ ] Ship it ⛔ abc then more').title, 'Ship it then more', 'only the list is the field');

/* L7: Tasks' On Completion field is its own lossless field, not part of 🔁 */
p = T.parseLine('- [ ] Pills 🔁 every day 🏁 delete 📅 2026-10-01');
assert.deepStrictEqual([p.title, p.repeat, p.onCompletion, p.due], ['Pills', 'every day', 'delete', '2026-10-01']);
assert.strictEqual(round('- [ ] Pills 🔁 every day 🏁 delete 📅 2026-10-01'), '- [ ] Pills 📅 2026-10-01 🔁 every day 🏁 delete');
assert.strictEqual(tasksRead(round('- [ ] Pills 🔁 every day 🏁 keep 📅 2026-10-01')).onCompletion, 'keep', 'Tasks reads it');
assert.strictEqual(tasksRead(round('- [ ] Pills 🔁 every day 🏁 keep 📅 2026-10-01')).recurrence, 'every day');
p = T.parseLine('- [ ] Odd 🏁 maybe');
assert.deepStrictEqual([p.title, p.onCompletion], ['Odd 🏁 maybe', ''], 'a value Tasks would not accept stays text');
assert.strictEqual(T.trailingRunStart('Call 📅 2026-10-01 🔁 every day 🏁 delete'), 5, '🏁 is part of the trailing run');

/* L8: nothing a caller passes can put a second line into the note */
assert.strictEqual(T.serializeLine({ title: 'Buy milk', tags: ['family'] }), '- [ ] Buy milk #family', 'a tag without # gets one');
assert.strictEqual(T.serializeLine({ title: 'Buy milk', tags: 'family' }), '- [ ] Buy milk #family', 'a lone string is one tag');
assert.strictEqual(T.serializeLine({ title: 'Buy milk', tags: ['my tag', '#ok', ''] }), '- [ ] Buy milk #my-tag #ok');
assert.strictEqual(T.serializeLine({ title: 'x', repeat: 'every day\n- [x] fake' }), '- [ ] x 🔁 every day - [x] fake');
assert.strictEqual(T.serializeLine({ title: 'a\r\nb', time: '09:00\n', due: '2026-10-01\n- [ ] z' }), '- [ ] a b ⏰ 09:00 📅 2026-10-01 - [ ] z');
assert.ok(!/[\r\n]/.test(T.serializeLine({ title: 't', id: 'a\nb', blockedBy: 'c\nd', start: 'e\nf', indent: '\n- [ ] ', marker: '\n' })));

/* L10: fenced code is not the note */
const FENCED = '## Home\n- [ ] Real 📅 2026-10-01\n\n```md\n# a comment\n- [ ] example in a code block 📅 2026-01-01\n```\n- [ ] After the fence\n';
assert.deepStrictEqual(T.parseNote(FENCED).map(i => `${i.group}:${i.title}:${i.line}`), ['Home:Real:1', 'Home:After the fence:7'], 'a # inside a fence does not reset the list');
assert.deepStrictEqual(T.parseNote('## A\n~~~\n- [ ] tilde\n~~~\n- [ ] kept\n').map(i => i.title), ['kept']);
assert.deepStrictEqual(T.parseNote('- [ ] a\n````\n```\n- [ ] still code\n````\n- [ ] b\n').map(i => i.title), ['a', 'b'], 'a longer fence is closed only by a fence as long');
assert.deepStrictEqual(T.parseNote('- [ ] a\n```\n- [ ] b\n').map(i => i.title), ['a'], 'an unclosed fence runs to the end');
assert.deepStrictEqual(T.parseNote('- [ ] a\n```js x`y\n- [ ] b\n').map(i => i.title), ['a', 'b'], 'a backtick fence cannot carry backticks in its info string');
assert.deepStrictEqual(T.listsOf('## A\n```\n## Not a list\n```\n## B\n'), ['A', 'B']);
assert.deepStrictEqual(T.fencedLines(['a', '```', 'b', '```', 'c']), [false, true, true, true, false]);
console.log('tasks OK');
