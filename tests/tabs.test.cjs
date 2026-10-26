'use strict';
/* The view's pages, in order: Today (everything due today) first and the
   default. Week folded into Habits and Areas became Priorities on 26 Oct 2026;
   their old ids still land on the page that took their place. */
const assert = require('node:assert');
require('./reminders-_stub.cjs');
global.window = globalThis;
const { TABS, pageId } = require('../src/app');
assert.deepStrictEqual(TABS.map(t => t.id), ['today', 'reminders', 'habits', 'fortnight', 'month', 'plan', 'priorities']);
assert.deepStrictEqual(TABS.map(t => t.label), ['Today', 'Reminders', 'Habits', 'Fortnight', 'Month', 'Plan', 'Priorities']);
assert.strictEqual(pageId('areas'), 'priorities', 'an old Areas link opens Priorities');
assert.strictEqual(pageId('week'), 'habits', 'an old Week link opens Habits');
assert.strictEqual(pageId('plan'), 'plan');
console.log('tabs OK');
