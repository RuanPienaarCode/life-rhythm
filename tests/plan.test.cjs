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
/* A column's events: all-day first whatever the name, then by clock time
   (an unpadded "9:00" before "14:00"), then by name. */
const busy = M.boardDays(d1, today, 1, { weekStart: 1, events: [
  { name: 'Dentist', date: today, time: '14:00' },
  { name: 'Birthday', date: today, time: '' },
  { name: 'Coffee', date: today, time: '9:00' },
  { name: '10k race', date: today },
  { name: 'Breakfast', date: today, time: '9:00' },
] });
assert.deepStrictEqual(busy[0].events.map(e => e.name), ['10k race', 'Birthday', 'Breakfast', 'Coffee', 'Dentist']);
assert.strictEqual(board[0].dailyCount, 1, 'Mon: the plain daily only');
assert.strictEqual(board[5].dailyCount, 2, 'Sat: the daily plus the Saturdays-only one');
assert.strictEqual(board[4].load, 2);

/* ---- a plan quiets only what plans cover ---- */
/* Paint (weekly, 1 owed) promised to Friday is covered: quiet on Monday. */
const monday = M.planDay(d1, today, { focusCount: 3, weekStart: 1 });
assert.ok(!monday.focus.some(r => r.p.name === 'Paint'), 'covered by Friday, so not in front of you today');
assert.ok(!monday.later.some(r => r.p.name === 'Paint'), 'nor waiting at the bottom of today — it left today');
assert.deepStrictEqual(monday.deferred.map(r => r.p.name), ['Paint'], 'handed back separately so nothing vanishes silently');
assert.strictEqual(M.progress(practices[2], log1, today, 1).deferredTo, '2026-09-11');
assert.strictEqual(M.reasonFor(practices[2], M.progress(practices[2], log1, today, 1), log1, today), 'Planned for Friday');
/* Exercise needs 4 and only 2 are planned (Tue, Fri): it is NOT quiet. It is
   still asked on Monday, its urgency taken on the 2 nobody has a day for
   (2 over 7 days left), and the reason says what is left to place. */
const exMon = M.progress(practices[1], log1, today, 1);
assert.strictEqual(exMon.deferredTo, null);
assert.strictEqual(exMon.placedAhead, 2);
assert.strictEqual(exMon.unplanned, 2);
assert.ok(Math.abs(exMon.urgency - 2 / 7) < 1e-9);
assert.ok(monday.focus.concat(monday.later).some(r => r.p.name === 'Exercise'), 'still asked while plans do not cover the need');
assert.strictEqual(M.reasonFor(practices[1], exMon, log1, today), '2 more this week · 7 days left · 2 planned');
/* Cover it fully (4 plans) and it goes quiet. */
const log1b = new Map([['2026-09-08', E({ plan: ['Exercise'] })], ['2026-09-09', E({ plan: ['Exercise'] })], ['2026-09-10', E({ plan: ['Exercise'] })], ['2026-09-11', E({ plan: ['Exercise'] })]]);
const full = M.planDay(mk(log1b), today, { focusCount: 3, weekStart: 1 });
assert.ok(full.deferred.some(r => r.p.name === 'Exercise'), 'four plans cover four owed');
assert.strictEqual(M.progress(practices[1], log1b, today, 1).deferredTo, '2026-09-08');
assert.strictEqual(M.reasonFor(practices[1], M.progress(practices[1], log1b, today, 1), log1b, today), 'Planned for Tomorrow');
assert.deepStrictEqual(M.shelf(mk(log1b), today, 7, { weekStart: 1 }).map(r => r.p.name), ['Paint', 'Range'], 'shelf agrees: nothing of Exercise left to place');

/* …and on the day itself it is committed, ahead of everything else in its area. */
const tue = M.planDay(d1, '2026-09-08', { focusCount: 3, weekStart: 1 });
const exTue = tue.focus.find(r => r.p.name === 'Exercise');
assert.ok(exTue, 'a promise for today is in front of you');
assert.strictEqual(exTue.pr.planned, true);
assert.strictEqual(exTue.reason, 'You planned this for today · 2 more to place this week', 'must not claim the week is handled: 4 owed, Tue + Fri planned');
/* When the plans do cover the need, the plain wording stands. */
const tueFull = M.planDay(mk(log1b), '2026-09-08', { focusCount: 3, weekStart: 1 });
assert.strictEqual(tueFull.focus.find(r => r.p.name === 'Exercise').reason, 'You planned this for today');

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

/* ---- r07 (f): 4/week with ONE plan on Saturday is not quiet all week ---- */
{
  const one = { areas: [], practices: [{ name: 'Gym', cadence: '4/week' }], log: new Map([['2026-10-10', E({ plan: ['Gym'] })]]) };
  for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) {
    const pl = M.planDay(one, d, { weekStart: 1 });
    assert.deepStrictEqual(pl.focus.map(r => r.p.name), ['Gym'], d + ': still asked');
    assert.strictEqual(pl.deferred.length, 0);
    const sh = M.shelf(one, d, 7, { weekStart: 1 });
    assert.strictEqual(sh[0].need, 3, d + ': shelf need = 4 owed - 1 placed');
    assert.strictEqual(M.progress(one.practices[0], one.log, d, 1).unplanned, 3, 'Today and shelf use the same figure');
  }
  /* Wed, one tick on Mon, plan Sat: 3 owed, 1 placed, 2 unplanned over 5 days */
  const t = { ...one, log: new Map([['2026-10-05', E({ done: ['Gym'] })], ['2026-10-10', E({ plan: ['Gym'] })]]) };
  const pr = M.progress(t.practices[0], t.log, '2026-10-07', 1);
  assert.strictEqual(pr.unplanned, 2);
  assert.ok(Math.abs(pr.urgency - 2 / 5) < 1e-9);
  assert.strictEqual(M.shelf(t, '2026-10-07', 7, { weekStart: 1 })[0].need, 2);
  /* Saturday: planned for today, 4 owed → 3 still to place, said plainly */
  const sat = M.planDay(one, '2026-10-10', { weekStart: 1 });
  assert.strictEqual(sat.focus[0].reason, 'You planned this for today · 3 more to place this week');
  assert.strictEqual(M.shelf(one, '2026-10-10', 7, { weekStart: 1 })[0].need, 3, 'shelf from Saturday agrees');
  /* A plan far beyond the board window still counts inside a monthly period */
  const mon = { areas: [], practices: [{ name: 'Range', cadence: 'monthly' }], log: new Map([['2026-10-25', E({ plan: ['Range'] })]]) };
  assert.deepStrictEqual(M.planDay(mon, '2026-10-07', {}).deferred.map(r => r.p.name), ['Range']);
  assert.deepStrictEqual(M.shelf(mon, '2026-10-07', 7, {}).map(r => r.p.name), [], 'shelf agrees with Today even for a plan past the 7 shown days');
}

/* ---- item 8: a daily is not hidden by a plan entry on a later day ---- */
{
  const dl = { areas: [], practices: [{ name: 'Stretch', cadence: 'daily' }], log: new Map([['2026-10-08', E({ plan: ['Stretch'] })], ['2026-10-12', E({ plan: ['Stretch'] })]]) };
  const pl = M.planDay(dl, '2026-10-07', { weekStart: 1 });
  assert.deepStrictEqual(pl.focus.map(r => r.p.name), ['Stretch']);
  assert.strictEqual(pl.deferred.length, 0);
}

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
