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

/* ---- Recurrence is expanded in the event's OWN zone, then each occurrence is
   converted to local time (device zone is Africa/Johannesburg, UTC+2, here). ---- */
const wrap = body => `BEGIN:VCALENDAR\r\n${body}\r\nEND:VCALENDAR\r\n`;
const vev = lines => `BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:S\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const dt = evs => evs.map(e => `${e.date} ${e.time}`);

/* Monday 23:30 UTC is Tuesday 01:30 here: the series lands on Tuesdays and
   keeps its first occurrence. */
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART:20261005T233000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO'])), '2026-10-01', '2026-10-31')),
  ['2026-10-06 01:30', '2026-10-13 01:30', '2026-10-20 01:30', '2026-10-27 01:30'],
  'WEEKLY BYDAY in UTC crosses the local date boundary');
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART:20261005T233000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2'])), '2026-10-01', '2026-10-31')),
  ['2026-10-06 01:30', '2026-10-13 01:30'], 'COUNT counts own-zone occurrences from DTSTART');
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART:20261005T233000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE:20261012T233000Z'])), '2026-10-01', '2026-10-31')),
  ['2026-10-06 01:30', '2026-10-20 01:30', '2026-10-27 01:30'], 'EXDATE in the same zone removes the right local date');
/* New York Tuesday 20:30 (EDT, UTC-4) = Wednesday 02:30 here. */
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART;TZID=America/New_York:20261006T203000', 'RRULE:FREQ=WEEKLY;BYDAY=TU'])), '2026-10-01', '2026-10-31')),
  ['2026-10-07 02:30', '2026-10-14 02:30', '2026-10-21 02:30', '2026-10-28 02:30'], 'WEEKLY BYDAY in a TZID zone, forward shift');
/* Tokyo Monday 05:00 (UTC+9) = Sunday 22:00 here: the shift runs backwards, and
   an occurrence whose own date is just outside the window still counts. */
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART;TZID=Asia/Tokyo:20261005T050000', 'RRULE:FREQ=WEEKLY;BYDAY=MO'])), '2026-10-01', '2026-10-31')),
  ['2026-10-04 22:00', '2026-10-11 22:00', '2026-10-18 22:00', '2026-10-25 22:00'], 'WEEKLY BYDAY, backward shift');
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART;TZID=Asia/Tokyo:20261005T050000', 'RRULE:FREQ=WEEKLY;BYDAY=MO'])), '2026-10-04', '2026-10-04')),
  ['2026-10-04 22:00'], 'a one-day window finds an occurrence whose own date is the next day');
/* Floating times stay floating. */
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART:20261005T233000', 'RRULE:FREQ=WEEKLY;BYDAY=MO'])), '2026-10-01', '2026-10-31')),
  ['2026-10-05 23:30', '2026-10-12 23:30', '2026-10-19 23:30', '2026-10-26 23:30'], 'floating stays on its own wall clock');
/* MONTHLY and YEARLY by-rules take the same path. */
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART:20261005T233000Z', 'RRULE:FREQ=MONTHLY;BYDAY=1MO'])), '2026-10-01', '2026-11-30')),
  ['2026-10-06 01:30', '2026-11-03 01:30'], 'MONTHLY BYDAY ordinal in UTC');
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART:20261031T223000Z', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=31'])), '2026-10-01', '2028-01-01')),
  ['2026-11-01 00:30', '2027-11-01 00:30'], 'YEARLY BYMONTHDAY in UTC');
/* Each occurrence is converted with its own offset: New York leaves daylight
   time on 1 Nov 2026, so the same 09:00 there is an hour later here after it. */
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART;TZID=America/New_York:20261025T090000', 'RRULE:FREQ=WEEKLY;BYDAY=SU'])), '2026-10-20', '2026-11-05')),
  ['2026-10-25 15:00', '2026-11-01 16:00'], 'a DST change in the event zone moves the local time');

/* ---- UNTIL is an instant (Z), or a date in the event's own zone ---- */
/* 09:00 New York, UNTIL 08 Oct 03:59:59Z: Oct 5, 6, 7 only (Oct 8 09:00 is later). */
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART;TZID=America/New_York:20261005T090000', 'RRULE:FREQ=DAILY;UNTIL=20261008T035959Z'])), '2026-10-01', '2026-10-31')),
  ['2026-10-05 15:00', '2026-10-06 15:00', '2026-10-07 15:00'], 'UNTIL with Z is an instant');
/* A date-only UNTIL includes that date in the event's zone: 22:00 New York on
   the 7th is 04:00 on the 8th here, and still belongs to the series. */
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART;TZID=America/New_York:20261005T220000', 'RRULE:FREQ=DAILY;UNTIL=20261007'])), '2026-10-01', '2026-10-31')),
  ['2026-10-06 04:00', '2026-10-07 04:00', '2026-10-08 04:00'], 'date-only UNTIL is inclusive in the event zone');
/* UNTIL equal to an occurrence's instant keeps it; a second earlier drops it. */
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART:20261005T233000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261012T233000Z'])), '2026-10-01', '2026-10-31')),
  ['2026-10-06 01:30', '2026-10-13 01:30'], 'UNTIL equal to the last instant is inclusive');
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART:20261005T233000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261012T232959Z'])), '2026-10-01', '2026-10-31')),
  ['2026-10-06 01:30'], 'UNTIL a second before drops the occurrence');
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART:20261005T233000', 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261012T235959'])), '2026-10-01', '2026-10-31')),
  ['2026-10-05 23:30', '2026-10-12 23:30'], 'floating UNTIL compares wall clocks');
assert.deepStrictEqual(
  dt(parseICS(wrap(vev(['DTSTART;VALUE=DATE:20261005', 'RRULE:FREQ=DAILY;UNTIL=20261007T000000Z'])), '2026-10-01', '2026-10-31')),
  ['2026-10-05 ', '2026-10-06 ', '2026-10-07 '], 'all-day series with a Z UNTIL stops on that UTC date');

/* ---- performance: one Intl formatter per zone, not one per stamp ---- */
{
  const RealDTF = Intl.DateTimeFormat;
  let made = 0;
  Intl.DateTimeFormat = function (...a) { made++; return new RealDTF(...a); };
  Intl.DateTimeFormat.prototype = RealDTF.prototype;
  const zones = ['America/New_York', 'Europe/London', 'Asia/Tokyo'];
  const big = [];
  for (let i = 0; i < 2000; i++) {
    const day = 1 + (i % 28), mo = 1 + (i % 12);
    big.push(vev([`DTSTART;TZID=${zones[i % 3]}:2026${String(mo).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(8 + (i % 10)).padStart(2, '0')}0000`,
      `DTEND;TZID=${zones[i % 3]}:2026${String(mo).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(9 + (i % 10)).padStart(2, '0')}3000`]).replace('UID:u', 'UID:p' + i));
  }
  const text = wrap(big.join('\r\n'));
  /* CPU time of one cold parse: wall-clock on a busy machine (parallel test
     runs, CI neighbours) is noise; this is far less so. */
  const c0 = process.cpuUsage();
  const out = parseICS(text, '2026-01-01', '2026-12-31');
  const cpu = process.cpuUsage(c0);
  const ms = (cpu.user + cpu.system) / 1000;
  Intl.DateTimeFormat = RealDTF;
  assert.strictEqual(out.length, 2000);
  assert.ok(made <= 3 * 2, `formatter built per zone, not per stamp (built ${made})`);
  assert.ok(ms < 300, `2000 TZID events parse in under 300 ms of CPU (took ${ms.toFixed(0)} ms)`);
}

console.log('ics OK');
