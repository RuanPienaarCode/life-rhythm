'use strict';
const assert = require('node:assert');
const { dayOptions, moveFrom, undoMove } = require('../src/day-menu');

const MON = 1;
/* 2026-10-07 is a Wednesday. */
const wed = '2026-10-07';
const weekly = { name: 'Run', cadence: '3/week' };
const monthly = { name: 'Call', cadence: '2/month' };
const daily = { name: 'Read', cadence: 'daily' };

/* Dailies are never offered "Another day"; weekly stops at the week's end. */
assert.deepStrictEqual(dayOptions(daily, wed, MON), []);
assert.deepStrictEqual(dayOptions(weekly, wed, MON).map(o => o.date), ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
assert.ok(dayOptions(weekly, wed, MON)[0].label.startsWith('Tomorrow'), 'labelled the way a person says it');
/* Sunday is the last day of a Monday-start week: window empty, item hidden. */
assert.deepStrictEqual(dayOptions(weekly, '2026-10-11', MON), []);
/* Sunday-start week, same Wednesday, ends Saturday. */
assert.strictEqual(dayOptions(weekly, wed, 0).pop().date, '2026-10-10');
/* Monthly runs to the end of the month and respects days:. */
assert.strictEqual(dayOptions(monthly, wed, MON).pop().date, '2026-10-31');
assert.deepStrictEqual(dayOptions({ name: 'Swim', cadence: '2/week', days: 'fri,sat' }, wed, MON).map(o => o.date), ['2026-10-09', '2026-10-10']);

/* A move is FROM the viewed day when the practice is promised to it. */
assert.strictEqual(moveFrom({ planned: true }, wed), wed);
assert.strictEqual(moveFrom({ planned: false }, wed), null);
assert.strictEqual(moveFrom(undefined, wed), null);

/* Undo restores both dates exactly; a null side is skipped. */
(async () => {
  const calls = [];
  const store = {
    restoreFlags: async (d, n, f) => { calls.push(['restore', d, n, f]); },
    movePlan: async (n, f, t) => { calls.push(['move', n, f, t]); },
  };
  const A = { done: false, skip: false, snooze: true, plan: true };
  const B = { done: false, skip: true, snooze: false, plan: false };
  await undoMove(store, 'Run', wed, '2026-10-09', { prev: { from: A, to: B } });
  assert.deepStrictEqual(calls, [['restore', '2026-10-09', 'Run', B], ['restore', wed, 'Run', A]]);

  calls.length = 0;
  await undoMove(store, 'Run', null, '2026-10-09', { prev: { from: null, to: B } });
  assert.deepStrictEqual(calls, [['restore', '2026-10-09', 'Run', B]]);

  calls.length = 0;
  await undoMove(store, 'Run', wed, null, { prev: { from: A, to: null } });
  assert.deepStrictEqual(calls, [['restore', wed, 'Run', A]], 'back-to-waiting: only the from side');

  /* movePlan resolved to undefined: no crash, falls back to the reverse move. */
  calls.length = 0;
  await undoMove(store, 'Run', wed, '2026-10-09', undefined);
  assert.deepStrictEqual(calls, [['move', 'Run', '2026-10-09', wed]]);
  console.log('day-menu ok');
})().catch(e => { console.error(e); process.exit(1); });
