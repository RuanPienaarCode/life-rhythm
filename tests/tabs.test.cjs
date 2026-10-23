'use strict';
/* The view's pages, in order: Today (everything due today) first and the
   default, then Habits (the practices page, "Today" before 0.2.0). */
const assert = require('node:assert');
require('./reminders-_stub.cjs');
global.window = globalThis;
const { TABS } = require('../src/app');
assert.deepStrictEqual(TABS.map(t => t.id), ['today', 'habits', 'reminders', 'fortnight', 'week', 'month', 'plan', 'areas']);
assert.deepStrictEqual(TABS.map(t => t.label), ['Today', 'Habits', 'Reminders', 'Fortnight', 'Week', 'Month', 'Plan', 'Areas']);
console.log('tabs OK');
