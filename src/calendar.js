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

/* Fetch every subscribed calendar; keep whatever succeeded, and for any
   link that failed keep that link's own previous events rather than
   dropping them (each event carries the `source` URL it was fetched
   from). A cache from before per-event `source` tagging existed cannot be
   attributed to one URL — when every link fails we fall back to keeping
   such untagged events wholesale, same as before this fix. */
async function refreshCalendars(plugin) {
  const list = urls(plugin);
  const today = D.todayISO();
  const from = D.addDays(today, -BACK_DAYS), to = D.addDays(today, AHEAD_DAYS);
  const prev = plugin.settings.calendarCache || {};
  const prevEvents = Array.isArray(prev.events) ? prev.events : [];
  const prevTagged = prevEvents.filter(e => e.source != null);
  const prevUntagged = prevEvents.filter(e => e.source == null);
  const events = [];
  const errors = [];
  const failedUrls = new Set();
  for (const url of list) {
    try {
      const res = await requestUrl({ url, method: 'GET', throw: false });
      if (!res || !(res.status >= 200 && res.status < 400)) { errors.push(`${url}: HTTP ${res ? res.status : '?'}`); failedUrls.add(url); continue; }
      for (const e of parseICS(res.text, from, to)) events.push({ ...e, source: url });
    } catch (e) {
      errors.push(`${url}: ${e && e.message ? e.message : e}`);
      failedUrls.add(url);
    }
  }
  if (failedUrls.size > 0) {
    for (const url of failedUrls) for (const e of prevTagged) if (e.source === url) events.push(e);
    /* Legacy untagged cache: only safe to reuse wholesale when we cannot
       tell success from failure per link, i.e. every link failed. */
    if (failedUrls.size === list.length) events.push(...prevUntagged);
    /* At least one link failed: leave fetchedAt alone (never advance it to
       "now") so the cache is not marked fresh for the full 6h — the next
       open retries against the old staleness clock instead. Links that
       did succeed still contribute fresh events above. */
    const allFailed = list.length > 0 && failedUrls.size >= list.length;
    plugin.settings.calendarCache = { ...prev, events, errors, lastAttemptAt: Date.now() };
    await plugin.saveSettings();
    return allFailed ? { events, errors, offline: true } : { events, errors };
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
