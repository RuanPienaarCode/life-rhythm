'use strict';
/* Repeats. Only the phrasings we can honour are accepted — an unparseable
   rule returns '' so the caller keeps the reminder instead of inventing a
   date for it. */
const assert = require('node:assert');
const R = require('../src/reminders/recur');

const n = (rule, from, done) => R.nextDue(rule, from, done || from);

assert.strictEqual(n('every day', '2026-09-20'), '2026-09-21');
assert.strictEqual(n('every 3 days', '2026-09-20'), '2026-09-23');
assert.strictEqual(n('every week', '2026-09-20'), '2026-09-27');
assert.strictEqual(n('every 2 weeks', '2026-09-20'), '2026-10-04');
assert.strictEqual(n('every month', '2026-09-20'), '2026-10-20');
assert.strictEqual(n('every month', '2026-01-31'), '2026-02-28', 'month-end clamps');
assert.strictEqual(n('every 3 months', '2026-09-20'), '2026-12-20');
assert.strictEqual(n('every year', '2026-09-20'), '2027-09-20');
assert.strictEqual(n('every 2 years', '2026-09-20'), '2028-09-20');

assert.strictEqual(n('every weekday', '2026-09-18'), '2026-09-21', 'Friday jumps the weekend');
assert.strictEqual(n('every weekday', '2026-09-21'), '2026-09-22');
assert.strictEqual(n('every monday', '2026-09-14'), '2026-09-21', 'a Monday goes to the next one');
assert.strictEqual(n('every mon', '2026-09-16'), '2026-09-21');
assert.strictEqual(n('every sunday', '2026-09-16'), '2026-09-20');

/* "when done" bases the next date on the day it was actually ticked, not on
   the date it was due — the difference between a chore and a deadline. */
assert.strictEqual(n('every month when done', '2026-09-01', '2026-09-25'), '2026-10-25');
assert.strictEqual(n('every 2 days when done', '2026-09-01', '2026-09-25'), '2026-09-27');
assert.strictEqual(n('every month', '2026-09-01', '2026-09-25'), '2026-10-01', 'without it the schedule holds');

/* A repeat that has fallen behind catches up to the future rather than
   handing back a date that is still overdue. */
assert.strictEqual(R.nextDue('every day', '2026-09-01', '2026-09-01', '2026-09-20'), '2026-09-21');
assert.strictEqual(R.nextDue('every week', '2026-09-01', '2026-09-01', '2026-09-20'), '2026-09-22');

assert.strictEqual(n('', '2026-09-20'), '');
assert.strictEqual(n('every blue moon', '2026-09-20'), '');
assert.strictEqual(n('every day', ''), '', 'no due date, nothing to advance');

assert.strictEqual(R.describe('every 2 weeks'), 'Every 2 weeks');
assert.strictEqual(R.describe('every monday'), 'Every Monday');
assert.strictEqual(R.describe(''), '');
assert.deepStrictEqual(R.PRESETS.map(p => p.rule).slice(0, 3), ['every day', 'every week', 'every month']);
/* ---- the audit's cases (27 Sep 2026) ---- */
const nd = (rule, due, today) => R.nextDue(rule, due, today || due, today || due);
/* a late tick walks forward from the ORIGINAL date, so the 31st stays the 31st */
assert.strictEqual(nd('every month', '2026-01-31', '2026-03-15'), '2026-03-31');
/* N applies to weekdays and named days too */
assert.strictEqual(nd('every 2 weekdays', '2026-09-28'), '2026-09-30');
assert.strictEqual(nd('every 2 mondays', '2026-09-28'), '2026-10-12');
/* the forms Tasks writes — they used to end the series on tick */
assert.strictEqual(nd('every week on Monday', '2026-10-01'), '2026-10-05');
assert.strictEqual(nd('every week on Monday, Thursday', '2026-10-01'), '2026-10-05');
assert.strictEqual(nd('every week on Monday, Thursday', '2026-10-05'), '2026-10-08');
assert.strictEqual(nd('every 2 weeks on Friday', '2026-10-02'), '2026-10-16');
assert.strictEqual(nd('every month on the 1st', '2026-10-01'), '2026-11-01');
assert.strictEqual(nd('every month on the last', '2026-02-10'), '2026-02-28');
assert.strictEqual(nd('every month on the 31st', '2026-02-28'), '2026-03-31', 'the rule, not the date, holds the day');
assert.strictEqual(nd('every month on the 31st', '2026-03-31'), '2026-04-30', 'clamped in a short month');
assert.strictEqual(nd('every month on the last Friday', '2026-09-25'), '2026-10-30');
assert.strictEqual(nd('every month on the second Tuesday', '2026-10-13'), '2026-11-10');
assert.strictEqual(nd('every 3 months on the 15th', '2026-10-15'), '2027-01-15');
assert.strictEqual(nd('every month on the fifth Friday', '2026-10-30'), '2027-01-29', 'a month without one is skipped');
assert.strictEqual(R.nextDue('every week on Monday when done', '2026-09-01', '2026-09-27', '2026-09-27'), '2026-09-28');
assert.strictEqual(nd('every week on Blursday', '2026-10-01'), '', 'still nothing invented');
assert.strictEqual(R.describe('every week on monday, thursday'), 'Every week on Mon, Thu');
assert.strictEqual(R.describe('every month on the last friday'), 'Every month on the last Friday');
assert.strictEqual(R.describe('every 2 weekdays'), 'Every 2 weekdays');
console.log('recur OK');
