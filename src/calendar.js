'use strict';
/* Calendar in: subscribed ICS links (an iCloud calendar's "public" link,
   Google's secret address, anything that serves text/calendar), fetched
   with Obsidian's requestUrl (works on desktop and mobile), expanded into a
   window around today and cached in the plugin's data so the page never
   waits on the network. */

const { requestUrl } = require('obsidian');
const { parseICS } = require('./ics');
const D = require('./dates');

const STALE_MS = 6 * 60 * 60 * 1000;
const BACK_DAYS = 7, AHEAD_DAYS = 120;

function urls(plugin) {
  return String(plugin.settings.calendarUrls || '')
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .map(u => u.replace(/^webcal:\/\//i, 'https://'));
}

function isStale(plugin) {
  const c = plugin.settings.calendarCache;
  return !c || !c.fetchedAt || Date.now() - c.fetchedAt > STALE_MS;
}

/* Fetch every subscribed calendar; keep whatever succeeded. */
async function refreshCalendars(plugin) {
  const list = urls(plugin);
  const today = D.todayISO();
  const from = D.addDays(today, -BACK_DAYS), to = D.addDays(today, AHEAD_DAYS);
  const events = [];
  const errors = [];
  for (const url of list) {
    try {
      const res = await requestUrl({ url, method: 'GET', throw: false });
      if (!res || !(res.status >= 200 && res.status < 400)) { errors.push(`${url}: HTTP ${res ? res.status : '?'}`); continue; }
      for (const e of parseICS(res.text, from, to)) events.push({ ...e, source: url });
    } catch (e) {
      errors.push(`${url}: ${e && e.message ? e.message : e}`);
    }
  }
  /* Keep whatever succeeded. When EVERY link failed (offline, a subway,
     an iCloud hiccup) the old events are still the best we have: leave
     them and leave fetchedAt alone so the next open retries. */
  const prev = plugin.settings.calendarCache || {};
  const allFailed = list.length > 0 && errors.length >= list.length;
  if (allFailed) {
    plugin.settings.calendarCache = { ...prev, events: prev.events || [], errors, lastAttemptAt: Date.now() };
    await plugin.saveSettings();
    return { events: prev.events || [], errors, offline: true };
  }
  plugin.settings.calendarCache = { fetchedAt: Date.now(), lastAttemptAt: Date.now(), events, errors };
  await plugin.saveSettings();
  return { events, errors };
}

/* Cached calendar events as event records the pages already understand. */
function calendarEvents(plugin) {
  const c = plugin.settings.calendarCache;
  if (!c || !Array.isArray(c.events)) return [];
  return c.events.map(e => ({
    name: e.name, date: e.date, time: e.time || '', area: '', note: e.location || '', path: null, calendar: true,
  }));
}

module.exports = { refreshCalendars, calendarEvents, isStale, urls };
