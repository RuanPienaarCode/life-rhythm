'use strict';
process.env.TZ = 'Africa/Johannesburg'; /* deterministic across machines/CI, set before any Date use */
const assert = require('node:assert');
const { parseICS, parseStamp } = require('../src/ics');

const ics = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:a',
  'SUMMARY:Mountain weekend\\, two nights',
  'DTSTART;VALUE=DATE:20261003',
  'DTEND;VALUE=DATE:20261005',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:b',
  'SUMMARY:Book club',
  'DTSTART;TZID=Africa/Johannesburg:20260902T190000',
  'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=6',
  'EXDATE;TZID=Africa/Johannesburg:20260916T190000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:c',
  'SUMMARY:Birthday',
  'DTSTART;VALUE=DATE:19900912',
  'RRULE:FREQ=YEARLY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:d',
  'SUMMARY:Cancelled thing',
  'STATUS:CANCELLED',
  'DTSTART;VALUE=DATE:20260913',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:e',
  'SUMMARY:Long summary that is folded ',
  ' across two lines',
  'DTSTART;VALUE=DATE:20260920',
  'RRULE:FREQ=MONTHLY;INTERVAL=1;UNTIL=20261120',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const ev = parseICS(ics, '2026-09-01', '2026-12-31');
const names = ev.map(e => `${e.date} ${e.time} ${e.name}`);
assert.ok(names.includes('2026-10-03  Mountain weekend, two nights'), 'all-day, escaped comma');
const hg = ev.filter(e => e.name === 'Book club').map(e => e.date);
assert.deepStrictEqual(hg, ['2026-09-02', '2026-09-09', '2026-09-23', '2026-09-30', '2026-10-07'], 'weekly ×6 minus one EXDATE');
assert.strictEqual(ev.find(e => e.name === 'Book club').time, '19:00', 'TZID wall time kept');
assert.deepStrictEqual(ev.filter(e => e.name === 'Birthday').map(e => e.date), ['2026-09-12'], 'yearly lands once in window');
assert.ok(!ev.some(e => e.name === 'Cancelled thing'));
assert.deepStrictEqual(ev.filter(e => /folded/.test(e.name)).map(e => e.date), ['2026-09-20', '2026-10-20', '2026-11-20'], 'monthly until, folded summary');
assert.strictEqual(ev.find(e => /folded/.test(e.name)).name, 'Long summary that is folded across two lines');

/* UTC stamps convert to local wall time (whatever zone the test runs in). */
const z = parseStamp('20260912T100000Z');
assert.strictEqual(z.date.length, 10);
assert.ok(/^\d{2}:\d{2}$/.test(z.time));
assert.strictEqual(parseStamp('garbage'), null);

/* RECURRENCE-ID overrides: a moved occurrence replaces the one it names,
   a STATUS:CANCELLED override removes it. iCloud/Google publish exactly
   this shape for "edit just this event" and "delete just this event". */
const cal = body => 'BEGIN:VCALENDAR\r\n' + body.trim().split('\n').map(s => s.trim()).join('\r\n') + '\r\nEND:VCALENDAR\r\n';

const moved = parseICS(cal(`
BEGIN:VEVENT
UID:s1
SUMMARY:Small group
DTSTART;TZID=Africa/Johannesburg:20260901T190000
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:s1
RECURRENCE-ID;TZID=Africa/Johannesburg:20260908T190000
SUMMARY:Small group
DTSTART;TZID=Africa/Johannesburg:20260910T190000
END:VEVENT`), '2026-09-01', '2026-09-30');
assert.deepStrictEqual(moved.map(e => e.date), ['2026-09-01', '2026-09-10', '2026-09-15'], 'moved occurrence shows at its new date only');

const cancelledOcc = parseICS(cal(`
BEGIN:VEVENT
UID:s2
SUMMARY:Practice
DTSTART;VALUE=DATE:20260901
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:s2
RECURRENCE-ID;VALUE=DATE:20260908
STATUS:CANCELLED
SUMMARY:Practice
DTSTART;VALUE=DATE:20260908
END:VEVENT`), '2026-09-01', '2026-09-30');
assert.deepStrictEqual(cancelledOcc.map(e => e.date), ['2026-09-01', '2026-09-15'], 'cancelled override removes just that occurrence');

/* MONTHLY;BYDAY=1SU (ordinal weekday-of-month). */
const firstSunday = parseICS(cal(`
BEGIN:VEVENT
UID:s3
SUMMARY:Communion
DTSTART;VALUE=DATE:20260906
RRULE:FREQ=MONTHLY;BYDAY=1SU;COUNT=3
END:VEVENT`), '2026-09-01', '2026-12-31');
assert.deepStrictEqual(firstSunday.map(e => e.date), ['2026-09-06', '2026-10-04', '2026-11-01'], 'MONTHLY BYDAY=1SU picks the first Sunday each month');

/* YEARLY;BYMONTH=5;BYDAY=2SU (Mother's Day: 2nd Sunday of May). */
const mothersDay = parseICS(cal(`
BEGIN:VEVENT
UID:s4
SUMMARY:Mothers day
DTSTART;VALUE=DATE:20260510
RRULE:FREQ=YEARLY;BYMONTH=5;BYDAY=2SU
END:VEVENT`), '2027-01-01', '2027-12-31');
assert.deepStrictEqual(mothersDay.map(e => e.date), ['2027-05-09'], 'YEARLY BYMONTH+BYDAY lands on the 2nd Sunday of May 2027');

/* Multi-day all-day event: DTEND (exclusive) fans out across every day it
   covers, not just its DTSTART. */
const camp = parseICS(cal(`
BEGIN:VEVENT
UID:s5
SUMMARY:Camp
DTSTART;VALUE=DATE:20260912
DTEND;VALUE=DATE:20260915
END:VEVENT`), '2026-09-13', '2026-09-30');
assert.deepStrictEqual(camp.map(e => e.date), ['2026-09-13', '2026-09-14'], 'a 12-14 Sep camp is still "on" on the 13th and 14th');

/* TZID other than the device's own zone converts to device local time:
   19:00 America/New_York in September (EDT, UTC-4) is 01:00 the next day
   in Africa/Johannesburg (UTC+2, no DST). */
const callUS = parseICS(cal(`
BEGIN:VEVENT
UID:s6
SUMMARY:Call US
DTSTART;TZID=America/New_York:20260915T190000
END:VEVENT`), '2026-09-01', '2026-09-30');
assert.strictEqual(callUS.length, 1);
assert.strictEqual(callUS[0].date, '2026-09-16', 'TZID converted across the date line');
assert.strictEqual(callUS[0].time, '01:00', 'TZID converted to device wall time');

/* A DAILY rule from 2010 must still reach a 2026 window without needing to
   step through 16 years of days one at a time. */
const pills = parseICS(cal(`
BEGIN:VEVENT
UID:s7
SUMMARY:Pills
DTSTART;VALUE=DATE:20100101
RRULE:FREQ=DAILY
END:VEVENT`), '2026-09-10', '2026-09-11');
assert.deepStrictEqual(pills.map(e => e.date), ['2026-09-10', '2026-09-11'], 'old DAILY rule still reaches a window 16 years later');

/* VALARM's own DESCRIPTION must never leak into the event's description. */
const dentist = parseICS(cal(`
BEGIN:VEVENT
UID:s8
SUMMARY:Dentist
DTSTART:20260915T080000Z
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:Reminder
TRIGGER:-PT15M
END:VALARM
END:VEVENT`), '2026-09-01', '2026-09-30');
assert.strictEqual(dentist[0].description, '', 'VALARM DESCRIPTION does not leak onto the event');

/* An RRULE part we do not implement (here BYWEEKNO) is never guessed at:
   the series falls back to showing just its DTSTART occurrence. */
const unsupported = parseICS(cal(`
BEGIN:VEVENT
UID:s9
SUMMARY:Odd rule
DTSTART;VALUE=DATE:20260906
RRULE:FREQ=MONTHLY;BYWEEKNO=20;COUNT=5
END:VEVENT`), '2026-09-01', '2026-12-31');
assert.deepStrictEqual(unsupported.map(e => e.date), ['2026-09-06'], 'unimplemented RRULE part falls back to DTSTART only');

console.log('ics OK');
