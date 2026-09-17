'use strict';
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
console.log('ics OK');
