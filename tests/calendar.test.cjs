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
const { refreshCalendars, isStale, calendarStatusLine } = require('../src/calendar');
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

  /* Partial failure: one link down among several must keep THAT link's
     previous events (not drop them) and must not mark the cache fresh,
     so it retries soon rather than waiting out the full 6h window. The
     link that stayed up still gets fresh events. */
  const soon2 = D.addDays(D.todayISO(), 10).replace(/-/g, '');
  const stub2 = { requestUrl: async ({ url }) => (url.includes('down.') ? { status: 503, text: '' } : { status: 200, text: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:y\nSUMMARY:Family\nDTSTART;VALUE=DATE:' + soon2 + '\nEND:VEVENT\nEND:VCALENDAR' }) };
  Module._load = function (req, ...rest) { return req === 'obsidian' ? stub2 : orig.call(this, req, ...rest); };
  delete require.cache[require.resolve('../src/calendar')];
  const { refreshCalendars: refreshCalendars2, isStale: isStale2 } = require('../src/calendar');
  Module._load = orig;

  const plugin2 = {
    settings: {
      calendarUrls: 'https://up.example/a.ics\nhttps://down.example/b.ics',
      calendarCache: { fetchedAt: 2000, events: [{ name: 'OldFamily', date: '2099-01-01', time: '', source: 'https://up.example/a.ics' }, { name: 'OldChurch', date: '2099-01-02', time: '', source: 'https://down.example/b.ics' }], errors: [] },
    },
    async saveSettings() { this.saved = true; },
  };
  const r3 = await refreshCalendars2(plugin2);
  assert.strictEqual(r3.offline, undefined, 'not every link failed, so not fully offline');
  const names3 = plugin2.settings.calendarCache.events.map(e => e.name).sort();
  assert.deepStrictEqual(names3, ['Family', 'OldChurch'], 'up link refreshed, down link kept its own previous events');
  assert.strictEqual(plugin2.settings.calendarCache.fetchedAt, 2000, 'fetchedAt left alone on partial failure — not marked fresh');
  assert.strictEqual(isStale2(plugin2), true, 'stays stale so the next open retries soon, not in 6h');

  /* ---- the settings status line (pure) ---- */
  const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
  const min = n => NOW - n * 60000;
  assert.strictEqual(calendarStatusLine(null, NOW), 'Not fetched yet.');
  assert.strictEqual(calendarStatusLine({}, NOW), 'Not fetched yet.');
  assert.strictEqual(calendarStatusLine({ events: [], errors: [] }, NOW), 'Not fetched yet.');
  assert.strictEqual(
    calendarStatusLine({ fetchedAt: min(5), lastAttemptAt: min(5), events: [{}, {}], errors: [] }, NOW),
    '2 events cached, fetched 5 min ago.');
  assert.strictEqual(
    calendarStatusLine({ fetchedAt: min(1), lastAttemptAt: min(1), events: [{}], errors: [] }, NOW),
    '1 event cached, fetched 1 min ago.');
  /* Never succeeded, last attempt failed: say so, never "Not fetched yet". */
  const failedFirst = calendarStatusLine({ lastAttemptAt: min(3), events: [], errors: ['a: HTTP 503', 'b: HTTP ?'] }, NOW);
  assert.strictEqual(failedFirst, "Couldn't load: 2 link(s) — last tried 3 min ago.");
  assert.ok(!/Not fetched/.test(failedFirst));
  assert.strictEqual(
    calendarStatusLine({ lastAttemptAt: NOW - 20000, events: [], errors: ['a: HTTP 503'] }, NOW),
    "Couldn't load: 1 link(s) — last tried just now.");
  assert.strictEqual(calendarStatusLine({ events: [], errors: ['a: x'] }, NOW), "Couldn't load: 1 link(s).",
    'a cache from before lastAttemptAt existed still reports the failure');
  /* Earlier success, latest attempt failed: events stay, failure is named. */
  assert.strictEqual(
    calendarStatusLine({ fetchedAt: min(180), lastAttemptAt: min(10), events: [{}, {}, {}], errors: ['a: HTTP 500'] }, NOW),
    "3 events cached, fetched 3 h ago · couldn't load 1 link(s), last tried 10 min ago.");
  assert.strictEqual(
    calendarStatusLine({ fetchedAt: min(60 * 24 * 3), lastAttemptAt: min(60 * 24 * 3), events: [], errors: [] }, NOW),
    '0 events cached, fetched 3 d ago.');
  /* The real refresh paths feed it: all links down on a fresh install. */
  Module._load = function (req, ...rest) { return req === 'obsidian' ? { requestUrl: async () => ({ status: 500, text: '' }) } : orig.call(this, req, ...rest); };
  delete require.cache[require.resolve('../src/calendar')];
  const cal3 = require('../src/calendar');
  Module._load = orig;
  const fresh = { settings: { calendarUrls: 'https://x.example/a.ics', calendarCache: null }, async saveSettings() {} };
  await cal3.refreshCalendars(fresh);
  assert.ok(/^Couldn't load: 1 link\(s\) — last tried just now\.$/.test(cal3.calendarStatusLine(fresh.settings.calendarCache, Date.now())),
    'first-ever refresh that fails reports the failure');

  console.log('calendar OK');
})().catch(e => { console.error(e); process.exit(1); });
