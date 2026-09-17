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
console.log('quickadd OK');
