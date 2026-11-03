'use strict';
/* Ask AI: the changes an answer may suggest. The AI never writes anything —
   it can only offer a few kinds of change as buttons, and each is checked
   here before a button is drawn. Nothing that deletes exists. */
const assert = require('node:assert');
const A = require('../src/ai/actions');
const today = '2026-11-03';

/* ---- reading the answer -------------------------------------------------- */

const reply = 'Do the call first.\n\n```rhythm-actions\n[{"kind":"add_reminder","title":"Call mom","due":"2026-11-04","time":"10:00"},{"kind":"tick_habit","name":"Read"}]\n```\n\nThen rest.';
const r = A.splitReply(reply, today);
assert.strictEqual(r.text, 'Do the call first.\n\nThen rest.', 'the block leaves the words');
assert.deepStrictEqual(r.actions, [
  { kind: 'add_reminder', title: 'Call mom', due: '2026-11-04', time: '10:00' },
  { kind: 'tick_habit', name: 'Read', date: today },
]);

assert.deepStrictEqual(A.splitReply('Just words.', today), { text: 'Just words.', actions: [] });
const broken = A.splitReply('Hi\n```rhythm-actions\n[{"kind":\n```', today);
assert.deepStrictEqual(broken, { text: 'Hi', actions: [] }, 'bad JSON: no buttons, the words survive');
assert.deepStrictEqual(A.splitReply('```rhythm-actions\n{"kind":"note","text":"x"}\n```', today).actions, [{ kind: 'note', text: 'x', date: today }], 'one object is a list of one');
assert.deepStrictEqual(A.splitReply('```js\nconst a = 1;\n```', today).text, '```js\nconst a = 1;\n```', 'other code blocks are left alone');

const many = '```rhythm-actions\n' + JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ kind: 'note', text: 'n' + i }))) + '\n```';
assert.strictEqual(A.splitReply(many, today).actions.length, A.MAX_ACTIONS, 'at most MAX_ACTIONS buttons');
assert.strictEqual(A.MAX_ACTIONS, 5);

/* ---- what passes --------------------------------------------------------- */

const v = a => A.validate(a, today);
assert.strictEqual(v({ kind: 'delete_reminder', title: 'x' }), null, 'no delete of any kind');
assert.strictEqual(v({ kind: 'add_reminder' }), null, 'a reminder needs a title');
assert.strictEqual(v({ kind: 'add_reminder', title: '   ' }), null);
assert.deepStrictEqual(v({ kind: 'add_reminder', title: '  Call\nmom  ' }), { kind: 'add_reminder', title: 'Call mom' }, 'one line, trimmed, no date is fine');
assert.strictEqual(v({ kind: 'add_reminder', title: 'x', due: '2026-02-31' }), null, 'a date that does not exist');
assert.strictEqual(v({ kind: 'add_reminder', title: 'x', due: '4 Nov' }), null);
assert.strictEqual(v({ kind: 'add_reminder', title: 'x', due: today, time: '25:00' }), null);
assert.deepStrictEqual(v({ kind: 'add_reminder', title: 'x', due: today, time: '9:05' }), { kind: 'add_reminder', title: 'x', due: today, time: '09:05' });
assert.strictEqual(v({ kind: 'add_reminder', title: 'x', time: '09:00' }), null, 'a time needs a date');
assert.strictEqual(v({ kind: 'add_reminder', title: 'x'.repeat(201) }), null, 'a runaway title');
assert.strictEqual(v({ kind: 'add_reminder', title: 'Pay 📅 2026-12-01 🔁 every day' }), null, 'no Tasks fields smuggled in a title');
for (const m of ['📆', '🗓️', '⌛', '❌', '🏁']) assert.strictEqual(v({ kind: 'add_reminder', title: `Pay ${m} 2026-12-01` }), null, `no ${m} in a title`);
assert.deepStrictEqual(v({ kind: 'tick_habit', name: 'Read', date: '2026-11-02' }), { kind: 'tick_habit', name: 'Read', date: '2026-11-02' });
assert.strictEqual(v({ kind: 'tick_habit', name: 'Read', date: '2026-11-04' }), null, 'no ticking a day that has not come');
assert.deepStrictEqual(v({ kind: 'skip_habit', name: 'Read' }), { kind: 'skip_habit', name: 'Read', date: today });
assert.strictEqual(v({ kind: 'move_todo', text: 'Paint fence' }), null, 'a move needs a day');
assert.deepStrictEqual(v({ kind: 'move_todo', text: 'Paint fence', date: '2026-11-05' }), { kind: 'move_todo', text: 'Paint fence', date: '2026-11-05' });
assert.deepStrictEqual(v({ kind: 'note', text: 'Line one\nLine two' }), { kind: 'note', text: 'Line one\nLine two', date: today }, 'a note may have lines');
assert.strictEqual(v({ kind: 'note', text: 'x'.repeat(4001) }), null);
assert.strictEqual(v(null), null);
assert.strictEqual(v('add_reminder'), null);

/* ---- the button's words -------------------------------------------------- */

assert.strictEqual(A.label({ kind: 'add_reminder', title: 'Call mom', due: '2026-11-04', time: '10:00' }, today), 'Add reminder: Call mom · Tomorrow 10:00');
assert.strictEqual(A.label({ kind: 'add_reminder', title: 'Call mom' }, today), 'Add reminder: Call mom');
assert.strictEqual(A.label({ kind: 'tick_habit', name: 'Read', date: today }, today), 'Tick Read');
assert.strictEqual(A.label({ kind: 'tick_habit', name: 'Read', date: '2026-11-02' }, today), 'Tick Read · Yesterday');
assert.strictEqual(A.label({ kind: 'skip_habit', name: 'Read', date: today }, today), 'Not today: Read');
assert.strictEqual(A.label({ kind: 'move_todo', text: 'Paint fence', date: '2026-11-05' }, today), 'Move "Paint fence" to Thursday');
assert.strictEqual(A.label({ kind: 'note', text: 'x', date: today }, today), "Add to today's note");
assert.strictEqual(A.label({ kind: 'note', text: 'x', date: '2026-11-01' }, today), 'Add to the note for 1 Nov');

/* ---- finding what an action names ---------------------------------------- */

const practices = [{ name: 'Read' }, { name: "Mom's call" }];
assert.strictEqual(A.findHabit(' read ', practices).practice.name, 'Read', 'case and spaces do not matter');
assert.strictEqual(A.findHabit("MOM'S CALL", practices).practice.name, "Mom's call");
assert.deepStrictEqual(A.findHabit('Run', practices), { ok: false, reason: 'not-found' });

const cards = [{ text: 'Paint fence', date: today }, { text: 'Call bank' }, { text: 'Call bank' }];
assert.strictEqual(A.findCard('paint fence', cards).card, cards[0]);
assert.deepStrictEqual(A.findCard('Call bank', cards), { ok: false, reason: 'ambiguous' }, 'two the same: refuse, never guess');
assert.deepStrictEqual(A.findCard('Mow lawn', cards), { ok: false, reason: 'not-found' });
assert.deepStrictEqual(A.findCard('x', null), { ok: false, reason: 'not-found' });

console.log('ai actions OK');
