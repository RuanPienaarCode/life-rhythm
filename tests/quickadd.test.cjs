'use strict';
const assert = require('node:assert');
const { parseQuickAdd } = require('../src/quickadd');
const areas = [{ name: 'Faith' }, { name: 'Craft' }, { name: 'Family' }];

assert.deepStrictEqual(parseQuickAdd('Practice guitar daily 20min @evening #Craft', areas),
  { cadence: 'daily', minutes: 20, when: 'evening', area: 'Craft', name: 'Practice guitar' });
assert.deepStrictEqual(parseQuickAdd('Exercise 4/week 30 min', areas), { cadence: '4/week', minutes: 30, name: 'Exercise' });
assert.deepStrictEqual(parseQuickAdd('Read every day', areas), { cadence: 'daily', name: 'Read' });
assert.deepStrictEqual(parseQuickAdd('Date night 2026-09-14 19:00 #family', areas),
  { date: '2026-09-14', kind: 'event', time: '19:00', area: 'Family', name: 'Date night' });
assert.deepStrictEqual(parseQuickAdd('Walk a long trail by 2027-03 #Adventure', areas),
  { horizon: '2027-03', kind: 'goal', name: 'Walk a long trail #Adventure' }, 'unknown area tag stays in the name');
assert.deepStrictEqual(parseQuickAdd('   ', areas), { name: '' });
assert.deepStrictEqual(parseQuickAdd('Call the dentist tomorrow', areas), { relative: 'tomorrow', kind: 'event', name: 'Call the dentist' });

/* A bare time is the time whether or not a date is present, and whichever
   order they come in. */
assert.deepStrictEqual(parseQuickAdd('Dinner tomorrow 19:00 #Family', areas),
  { relative: 'tomorrow', kind: 'event', time: '19:00', area: 'Family', name: 'Dinner' });
assert.deepStrictEqual(parseQuickAdd('Call Mom 19:00', areas), { time: '19:00', name: 'Call Mom' }, 'no date at all, still a time');
assert.deepStrictEqual(parseQuickAdd('Dinner 19:00 2026-09-14', areas),
  { time: '19:00', date: '2026-09-14', kind: 'event', name: 'Dinner' }, 'the time can come before the date in the text');

/* A cadence word inside a longer phrase is not eaten unless it stands
   alone — "weekly paper" is a description, the trailing "daily" is the
   real cadence. */
assert.deepStrictEqual(parseQuickAdd('Read the weekly paper daily', areas), { cadence: 'daily', name: 'Read the weekly paper' });

/* "N per/x/times week|month" all normalise to "N/week" or "N/month". */
assert.deepStrictEqual(parseQuickAdd('Exercise 4 per week', areas), { cadence: '4/week', name: 'Exercise' });
assert.deepStrictEqual(parseQuickAdd('Exercise 4x week', areas), { cadence: '4/week', name: 'Exercise' });
assert.deepStrictEqual(parseQuickAdd('Exercise 4 times a week', areas), { cadence: '4/week', name: 'Exercise' });
assert.deepStrictEqual(parseQuickAdd('Exercise 2 times a month', areas), { cadence: '2/month', name: 'Exercise' });

/* An impossible calendar date is left in the name rather than accepted. */
assert.deepStrictEqual(parseQuickAdd('Party 2026-02-31', areas), { name: 'Party 2026-02-31' });
assert.deepStrictEqual(parseQuickAdd('Party 2026-09-14', areas), { date: '2026-09-14', kind: 'event', name: 'Party' }, 'a real date still parses');

console.log('quickadd OK');
