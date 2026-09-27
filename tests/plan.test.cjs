'use strict';
/* The plan board: promising a practice to a day, and what that does to
   Today, the shelf and the columns. */
const assert = require('node:assert');
const M = require('../src/model');
const D = require('../src/dates');

const E = (o = {}) => ({
  done: new Set(o.done || []), skip: new Set(o.skip || []),
  snooze: new Set(o.snooze || []), plan: new Set(o.plan || []), note: '',
});

/* Week of Mon 7 Sep 2026; today is Mon 7 so the whole week is ahead. */
const areas = [{ name: 'Faith', order: 1 }, { name: 'Body', order: 4 }, { name: 'Craft', order: 6 }];
const practices = [
  { name: 'Read the Bible', area: 'Faith', cadence: 'daily' },
  { name: 'Exercise', area: 'Body', cadence: '4/week' },
  { name: 'Paint', area: 'Craft', cadence: 'weekly' },
  { name: 'Range', area: 'Craft', cadence: 'monthly' },
  { name: 'Sabbath walk', area: 'Faith', cadence: 'daily', days: ['sat'] },
];
const today = '2026-09-07';
const mk = log => ({ areas, practices, goals: [], events: [], log: log || new Map() });

/* ---- only flexible practices reach the board ---- */
assert.strictEqual(M.isFlexible(practices[0]), false, 'a daily has no when to choose');
assert.strictEqual(M.isFlexible(practices[4]), false, 'a Saturdays-only daily is fixed too');
assert.strictEqual(M.isFlexible(practices[1]), true);
assert.strictEqual(M.isFlexible(practices[3]), true);

/* ---- the shelf counts what is still to place ---- */
const empty = mk();
const s0 = M.shelf(empty, today, 7, { weekStart: 1 });
assert.deepStrictEqual(s0.map(r => `${r.p.name}×${r.need}`), ['Exercise×4', 'Paint×1', 'Range×1']);

/* Placing two Exercise sessions leaves two on the shelf. */
const log1 = new Map([
  ['2026-09-08', E({ plan: ['Exercise'] })],
  ['2026-09-11', E({ plan: ['Exercise', 'Paint'] })],
]);
const d1 = mk(log1);
const s1 = M.shelf(d1, today, 7, { weekStart: 1 });
assert.deepStrictEqual(s1.map(r => `${r.p.name}×${r.need}`), ['Exercise×2', 'Range×1'], 'Paint is fully placed');

/* Doing one also takes it off the shelf. */
const log2 = new Map(log1);
log2.set('2026-09-07', E({ done: ['Exercise'] }));
assert.deepStrictEqual(M.shelf(mk(log2), today, 7, { weekStart: 1 }).map(r => `${r.p.name}×${r.need}`), ['Exercise×1', 'Range×1']);

/* ---- the columns ---- */
const board = M.boardDays(d1, today, 7, { weekStart: 1, events: [{ name: 'Date night', date: '2026-09-09', time: '19:00' }] });
assert.strictEqual(board.length, 7);
assert.deepStrictEqual(board.map(d => d.planned.map(r => r.p.name)), [[], ['Exercise'], [], [], ['Exercise', 'Paint'], [], []]);
assert.deepStrictEqual(board[2].events.map(e => e.name), ['Date night']);
assert.strictEqual(board[0].dailyCount, 1, 'Mon: the plain daily only');
assert.strictEqual(board[5].dailyCount, 2, 'Sat: the daily plus the Saturdays-only one');
assert.strictEqual(board[4].load, 2);

/* ---- a promise moves Today ---- */
/* Exercise promised to Friday is quiet on Monday… */
const monday = M.planDay(d1, today, { focusCount: 3, weekStart: 1 });
assert.ok(!monday.focus.some(r => r.p.name === 'Exercise'), 'deferred to Tuesday, so not in front of you today');
assert.ok(!monday.later.some(r => r.p.name === 'Exercise'), 'nor waiting at the bottom of today — it left today');
assert.deepStrictEqual(monday.deferred.map(r => r.p.name), ['Exercise', 'Paint'], 'handed back separately so nothing vanishes silently');
assert.strictEqual(M.progress(practices[1], log1, today, 1).deferredTo, '2026-09-08');
assert.strictEqual(M.reasonFor(practices[1], M.progress(practices[1], log1, today, 1), log1, today), 'Planned for Tomorrow');

/* …and on the day itself it is committed, ahead of everything else. */
const tue = M.planDay(d1, '2026-09-08', { focusCount: 3, weekStart: 1 });
assert.strictEqual(tue.focus[0].p.name, 'Exercise', 'a promise outranks urgency');
assert.strictEqual(tue.focus[0].pr.planned, true);
assert.strictEqual(tue.focus[0].reason, 'You planned this for today');

/* A promise makes something due that its cadence would not: Paint is
   already satisfied for the week, yet Friday still asks for it. */
const log3 = new Map([['2026-09-07', E({ done: ['Paint'] })], ['2026-09-11', E({ plan: ['Paint'] })]]);
const fri = M.planDay(mk(log3), '2026-09-11', { focusCount: 3, weekStart: 1 });
assert.ok(fri.focus.some(r => r.p.name === 'Paint'), 'you promised it, so it is asked for');

/* Ticking it on the day clears nothing else: the shelf just shrinks. */
assert.strictEqual(M.plannedCount(log1, today, 7, 'Exercise'), 2);
assert.strictEqual(M.plannedAhead(log1, today, 'Exercise'), '2026-09-08');
assert.strictEqual(M.plannedAhead(log1, '2026-09-11', 'Exercise'), null, 'nothing promised after Friday');
assert.strictEqual(M.isPlanned(log1, '2026-09-11', 'Paint'), true);

/* ---- a planned day that has passed stops deferring ---- */
const past = new Map([['2026-09-05', E({ plan: ['Paint'] })]]);
assert.strictEqual(M.progress(practices[2], past, today, 1).deferredTo, null, 'a promise to a past day is spent');
assert.ok(M.planDay(mk(past), today, { focusCount: 3, weekStart: 1 }).focus.some(r => r.p.name === 'Paint'));

/* ---- a plan only quiets a practice within its CURRENT period ---- */
/* Paint (weekly) is promised for Tue 15 Sep — NEXT week, from a Sat 12 Sep
   vantage (week runs Mon 7–Sun 13). This week's unmet Paint must stay due
   and on the shelf; only next week's board should treat it as placed. */
const nextWeekPlan = { areas: [{ name: 'Craft', order: 1 }], practices: [{ name: 'Paint', area: 'Craft', cadence: 'weekly' }], log: new Map([['2026-09-15', E({ plan: ['Paint'] })]]) };
const satPlan = M.planDay(nextWeekPlan, '2026-09-12', { weekStart: 1 });
assert.ok(satPlan.focus.some(r => r.p.name === 'Paint'), 'this week is still owed, a next-week promise does not silence it');
assert.deepStrictEqual(M.shelf(nextWeekPlan, '2026-09-12', 7, { weekStart: 1 }).map(r => `${r.p.name}×${r.need}`), ['Paint×1'], 'not counted as placed — the promise lands outside this period');

/* ---- deck order rotates without changing anything ---- */
/* deck.js reaches dom.js, which imports `obsidian` — stub it so the pure
   helper can be exercised without a host. */
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? { setIcon: () => {} } : origLoad.call(this, req, ...rest);
};
const { order } = require('../src/deck');
Module._load = origLoad;
assert.deepStrictEqual(order([1, 2, 3], 0), [1, 2, 3]);
assert.deepStrictEqual(order([1, 2, 3], 1), [2, 3, 1]);
assert.deepStrictEqual(order([1, 2, 3], 4), [2, 3, 1]);
assert.deepStrictEqual(order([1, 2, 3], -1), [3, 1, 2]);
assert.deepStrictEqual(order([], 3), []);
console.log('plan OK');
