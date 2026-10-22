'use strict';
/* What the board shows, and in what order. The buckets ARE the design: an
   overdue thing is never mixed in with a thing due next month. */
const assert = require('node:assert');
const M = require('../src/reminders/model');
const T = require('../src/reminders/tasks');

const NOTE = [
  '## Family',
  "- [ ] Sign the school's permission slip 📅 2026-09-10 ⏫ #family",
  '- [ ] Phone the school about the trip 📅 2026-09-13 #family',
  '- [ ] Collect the parcel 📅 2026-09-13 🔺 #family',
  '- [x] Buy light bulbs 📅 2026-09-09 ✅ 2026-09-09 #family',
  '## Admin',
  '- [ ] Renew the licence disc 📅 2026-09-14',
  '- [ ] Pay the rates 📅 2026-09-18',
  '- [ ] Book the car service 📅 2026-10-30',
  '- [ ] One day, sort the garage',
].join('\n');
const items = T.parseNote(NOTE);
const b = M.board(items, '2026-09-13');

assert.deepStrictEqual(b.overdue.map(i => i.title), ["Sign the school's permission slip"]);
assert.deepStrictEqual(b.today.map(i => i.title), ['Collect the parcel', 'Phone the school about the trip'],
  'same day: the higher priority leads');
assert.deepStrictEqual(b.tomorrow.map(i => i.title), ['Renew the licence disc']);
assert.deepStrictEqual(b.week.map(i => i.title), ['Pay the rates'], 'the next seven days, past tomorrow');
assert.deepStrictEqual(b.later.map(i => i.title), ['Book the car service']);
assert.deepStrictEqual(b.someday.map(i => i.title), ['One day, sort the garage']);
assert.deepStrictEqual(b.done.map(i => i.title), ['Buy light bulbs']);
assert.strictEqual(b.counts.overdue, 1);
assert.strictEqual(b.counts.today, 2);
assert.strictEqual(b.counts.due, 3, 'the badge number: overdue plus today');
assert.strictEqual(b.counts.open, 7);
assert.strictEqual(b.counts.done, 1);

/* A done reminder never appears in a live bucket, however overdue it was. */
assert.ok(!b.overdue.some(i => i.done));

/* Sorting inside a bucket: priority, then the earlier date, then time, then
   the title — so the order never wobbles between two renders. */
const mk = (title, due, priority, time) => ({ title, due, priority: priority || 'normal', time: time || '', tags: [], done: false });
assert.deepStrictEqual(
  M.sortItems([mk('b', '2026-09-20'), mk('a', '2026-09-20'), mk('c', '2026-09-19'), mk('d', '2026-09-20', 'high')]).map(i => i.title),
  ['d', 'c', 'a', 'b']);
assert.deepStrictEqual(
  M.sortItems([mk('late', '2026-09-20', 'normal', '17:00'), mk('early', '2026-09-20', 'normal', '06:00'), mk('none', '2026-09-20')]).map(i => i.title),
  ['early', 'late', 'none'], 'a time beats no time on the same day');

/* Filtering — the search box and the chips. */
assert.deepStrictEqual(M.filterItems(items, { query: 'school' }).map(i => i.title),
  ["Sign the school's permission slip", 'Phone the school about the trip']);
assert.deepStrictEqual(M.filterItems(items, { query: 'THE SCHOOL' }).map(i => i.title).length, 2, 'case and spacing insensitive');
assert.strictEqual(M.filterItems(items, { group: 'Admin' }).length, 4);
assert.strictEqual(M.filterItems(items, { tag: '#family' }).length, 4);
assert.strictEqual(M.filterItems(items, { query: 'nothing here' }).length, 0);
assert.strictEqual(M.filterItems(items, {}).length, items.length);

/* Overdue depth drives the colour of the pill, so it is a model decision. */
assert.strictEqual(M.overdueDays(items[0], '2026-09-13'), 3);
assert.strictEqual(M.overdueDays(items[1], '2026-09-13'), 0);

/* The next thing to do, for the header line. */
assert.strictEqual(M.nextUp(items, '2026-09-13').title, "Sign the school's permission slip");
assert.strictEqual(M.nextUp([], '2026-09-13'), null);
assert.strictEqual(M.summary(b), '1 overdue · 2 today');
assert.strictEqual(M.summary(M.board([], '2026-09-13')), 'Nothing on the list');
/* The sidebar and the chips read one set of counts; Today counts what the
   Today view shows, overdue included. */
assert.deepStrictEqual(M.viewCounts(b), { all: 7, overdue: 1, today: 3, week: 5, someday: 1, done: 1 });
/* Lists keep note order, an empty list still shows, done rows don't count,
   and a group missing from the list (never expected) is not dropped. */
assert.deepStrictEqual(M.listCounts(items, ['Family', 'Car', 'Admin']),
  [{ name: 'Family', open: 3 }, { name: 'Car', open: 0 }, { name: 'Admin', open: 4 }]);
assert.deepStrictEqual(M.listCounts(items, []).map(l => l.name), ['Family', 'Admin']);
console.log('model OK');
