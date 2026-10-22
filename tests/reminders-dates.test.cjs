'use strict';
/* Calendar arithmetic, done on the ISO string so a timezone can never move a
   due date by a day. */
const assert = require('node:assert');
const D = require('../src/reminders/dates');

assert.ok(D.isISO('2026-09-20'));
assert.ok(!D.isISO('2026-9-20'));
assert.ok(!D.isISO('tomorrow'));
assert.ok(!D.isISO(''));

assert.strictEqual(D.addDays('2026-09-20', 1), '2026-09-21');
assert.strictEqual(D.addDays('2026-12-31', 1), '2027-01-01');
assert.strictEqual(D.addDays('2026-03-01', -1), '2026-02-28');
assert.strictEqual(D.addDays('2024-03-01', -1), '2024-02-29', 'leap year');

assert.strictEqual(D.addMonths('2026-01-15', 1), '2026-02-15');
assert.strictEqual(D.addMonths('2026-01-31', 1), '2026-02-28', 'clamped, never spills into March');
assert.strictEqual(D.addMonths('2024-01-31', 1), '2024-02-29', 'clamped to a leap February');
assert.strictEqual(D.addMonths('2026-12-15', 1), '2027-01-15');
assert.strictEqual(D.addMonths('2026-03-15', -1), '2026-02-15');
assert.strictEqual(D.addMonths('2026-02-29', 0), '2026-02-28', 'an impossible date clamps back into its own month, never forward into the next');

assert.strictEqual(D.diffDays('2026-09-20', '2026-09-23'), 3);
assert.strictEqual(D.diffDays('2026-09-23', '2026-09-20'), -3);
assert.strictEqual(D.diffDays('2026-09-20', '2026-09-20'), 0);
assert.strictEqual(D.diffDays('2025-09-30', '2026-09-13'), 348, 'across a year boundary');

assert.strictEqual(D.dow('2026-09-13'), 0, 'Sunday');
assert.strictEqual(D.dow('2026-09-14'), 1, 'Monday');

assert.strictEqual(D.relative('2026-09-13', '2026-09-13'), 'Today');
assert.strictEqual(D.relative('2026-09-14', '2026-09-13'), 'Tomorrow');
assert.strictEqual(D.relative('2026-09-12', '2026-09-13'), 'Yesterday');
assert.strictEqual(D.relative('2026-09-16', '2026-09-13'), 'Wednesday');
assert.strictEqual(D.relative('2026-09-10', '2026-09-13'), '3 days ago');
assert.strictEqual(D.relative('2026-09-25', '2026-09-13'), 'Fri 25 Sep');
assert.strictEqual(D.relative('2027-01-04', '2026-09-13'), 'Mon 4 Jan 2027', 'another year is named');
assert.strictEqual(D.relative('', '2026-09-13'), '');

assert.strictEqual(D.human('2026-09-25'), '25 Sep 2026');
assert.strictEqual(D.isISO(D.todayISO()), true, "today's own answer is an ISO date");
assert.strictEqual(D.startOfWeek('2026-09-16', 1), '2026-09-14', 'Monday start');
assert.strictEqual(D.startOfWeek('2026-09-13', 1), '2026-09-07', 'Sunday belongs to the week that began Monday');

assert.strictEqual(D.isTime('09:00'), true);
assert.strictEqual(D.isTime('9:00'), false);
assert.strictEqual(D.isTime('24:00'), false);
assert.strictEqual(D.isTime('23:59'), true);
/* A real calendar date, not just the right shape. */
assert.strictEqual(D.isISO('2027-02-29'), false, 'no 29 Feb outside a leap year');
assert.strictEqual(D.isISO('2028-02-29'), true);
assert.strictEqual(D.isISO('2026-04-31'), false);
assert.strictEqual(D.isISO('2026-12-31'), true);

/* The one reader for a clock setting. Notices and the phone alarm both use it,
   so "8am" can no longer mean one thing in Obsidian and another on the phone. */
for (const [typed, want] of [
  ['7:30', '07:30'], ['07:30', '07:30'], ['21:00', '21:00'], ['0:05', '00:05'], ['23:59', '23:59'],
  ['8am', '08:00'], ['9pm', '21:00'], ['9:30pm', '21:30'], ['12am', '00:00'], ['12pm', '12:00'], ['12:15 AM', '00:15'],
  ['21h00', '21:00'], ['21h', '21:00'], ['9h30', '09:30'], ['  9 am ', '09:00'],
]) assert.strictEqual(D.parseClock(typed), want, `"${typed}" reads as ${want}`);
for (const bad of ['', '   ', 'abc', '9', '24:00', '25:00', '9:60', '13pm', '0am', '13am', '9:5', '8 o\'clock', null, undefined, 930])
  assert.strictEqual(D.parseClock(bad), '', `"${bad}" is not a clock time`);
console.log('dates OK');
