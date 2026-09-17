'use strict';
/* Offline must not wipe the cache: a total fetch failure keeps the old
   events and leaves fetchedAt alone so the next open retries. */
const assert = require('node:assert');
const Module = require('node:module');
const D = require('../src/dates');
const soon = D.addDays(D.todayISO(), 10).replace(/-/g, '');
let mode = 'fail';
const stub = { requestUrl: async () => (mode === 'fail' ? { status: 0, text: '' } : { status: 200, text: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nSUMMARY:Fresh\nDTSTART;VALUE=DATE:' + soon + '\nEND:VEVENT\nEND:VCALENDAR' }) };
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'obsidian' ? stub : orig.call(this, req, ...rest); };
const { refreshCalendars, isStale } = require('../src/calendar');
Module._load = orig;

(async () => {
  const plugin = {
    settings: { calendarUrls: 'webcal://a.example/cal.ics\nhttps://b.example/cal.ics', calendarCache: { fetchedAt: 1000, events: [{ name: 'Old', date: '2099-01-01', time: '' }], errors: [] } },
    async saveSettings() { this.saved = true; },
  };
  const r = await refreshCalendars(plugin);
  assert.strictEqual(r.offline, true);
  assert.deepStrictEqual(plugin.settings.calendarCache.events.map(e => e.name), ['Old'], 'old events kept');
  assert.strictEqual(plugin.settings.calendarCache.fetchedAt, 1000, 'fetchedAt untouched');
  assert.strictEqual(plugin.settings.calendarCache.errors.length, 2);
  assert.strictEqual(isStale(plugin), true, 'still stale → retries next open');

  mode = 'ok';
  const r2 = await refreshCalendars(plugin);
  assert.strictEqual(r2.offline, undefined);
  assert.deepStrictEqual(plugin.settings.calendarCache.events.map(e => e.name), ['Fresh', 'Fresh'], 'both links parsed');
  assert.ok(plugin.settings.calendarCache.fetchedAt > 1000);
  console.log('calendar OK');
})().catch(e => { console.error(e); process.exit(1); });
