'use strict';
/* Rhythm's headless API — app.plugins.plugins.rhythm.api — for other
   plugins (Vista). Version 1:

     api.apiVersion === 1
     api.onChange(cb) → unsubscribe()
     api.weekStart() → 0 | 1
     api.reminders.notePath() → string
     api.reminders.summary({ today, limit }) → { available, path, rows, buckets, counts, more }
     api.reminders.toggle(ref, { today })      → { ok: true } | { ok: false, reason, repeat? }
     api.reminders.snooze(ref, days, { today }) → same
     api.practices.today({ date }) → { available, focus, later, done, total, date, folder, streak, streakLabel }
     api.practices.tick(ref, on)   → { ok: true, path, prev } | { ok: false, reason, key? }
     api.events.between(fromISO, toISO) → [{ name, date, time, area, path }]

   Everything handed out is plain data with ISO dates. Rows carry an opaque
   `ref`; a write is given the ref back and checks it against the note AS IT
   IS NOW before writing, so a row that changed since it was read (ticked on
   the board, edited by hand, synced from the phone) is refused with
   reason 'changed' rather than acted on. Adding methods keeps apiVersion 1;
   changing what one returns does not. */

const M = require('./model');
const D = require('./dates');

/* ---- which reminders to show, and in what order -----------------------
   Moved here from Vista (its nudge.js summarize and helpers): the plugin
   that owns the reminders picks the handful to show; Vista only lays them
   out. Pure. */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RANK = { highest: 5, high: 4, medium: 3, normal: 2, low: 1, lowest: 0 };

/* A real calendar date, not just the shape ('2026-02-30' is not one). */
function isISO(s) {
  const m = ISO_RE.exec(String(s || ''));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
const rank = p => (RANK[p] === undefined ? RANK.normal : RANK[p]);
const toUTC = iso => { const m = ISO_RE.exec(String(iso || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
function diffDays(a, b) {
  const x = toUTC(a), y = toUTC(b);
  if (isNaN(x) || isNaN(y)) return 0;
  return Math.round((y - x) / 86400000);
}

function bucketOf(item, today) {
  if (item.done) return 'done';
  if (!isISO(item.due)) return 'someday';
  const n = diffDays(today, item.due);
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n <= 7) return 'week';
  return 'later';
}

/* Priority, then the earlier date, then the earlier time, then the title —
   fully determined, so a card never reshuffles between two reads. */
function sortItems(items) {
  return (items || []).slice().sort((a, b) => {
    const r = rank(b.priority) - rank(a.priority);
    if (r) return r;
    const ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    const at = a.time || '99:99', bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

/* The handful to show: everything already due, topped up with what is
   coming next, so a day with nothing overdue still says something. */
function summarize(items, today, limit) {
  const open = (items || []).filter(i => !i.done);
  const by = { overdue: [], today: [], tomorrow: [], week: [], later: [], someday: [] };
  for (const i of open) by[bucketOf(i, today)].push(i);
  for (const k of Object.keys(by)) by[k] = sortItems(by[k]);
  const n = Math.max(1, limit || 5);
  const due = [...by.overdue, ...by.today];
  const ahead = [...by.tomorrow, ...by.week, ...by.later];
  const rows = due.slice(0, n);
  if (rows.length < n) rows.push(...ahead.slice(0, n - rows.length));
  return {
    rows,
    buckets: by,
    counts: {
      overdue: by.overdue.length, today: by.today.length, due: due.length,
      ahead: ahead.length, someday: by.someday.length, open: open.length,
    },
    more: Math.max(0, open.length - rows.length),
  };
}

/* ---- refs ------------------------------------------------------------- */

const makeRef = obj => JSON.stringify(obj);
function readRef(ref, kind) {
  try {
    const r = JSON.parse(String(ref));
    return r && r.k === kind ? r : null;
  } catch (e) { return null; }
}

/* A plain copy of a reminder, its ref added: nothing live leaves the plugin. */
function plainReminder(it, path) {
  const out = {};
  for (const k of Object.keys(it)) {
    const v = it[k];
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice();
  }
  out.ref = makeRef({ k: 'r', path, line: it.line, raw: it.raw });
  return out;
}

function makeApi(plugin) {
  const listeners = new Set();
  let soon = null;
  const rem = () => plugin.reminders;
  const rhythm = () => plugin.rhythmStoreFor('api');

  /* Called by the plugin after any change it made or saw. Debounced: a
     tick is several writes, and a listener should hear about it once. */
  function notify() {
    window.clearTimeout(soon);
    soon = window.setTimeout(() => {
      for (const cb of [...listeners]) {
        try { cb(); } catch (e) { console.error('rhythm api listener', e); }
      }
    }, 250);
  }

  async function freshReminder(ref) {
    const r = readRef(ref, 'r');
    if (!r) return { error: { ok: false, reason: 'bad-ref' } };
    const store = rem() && rem().store;
    if (!store) return { error: { ok: false, reason: 'unavailable' } };
    if (r.path !== store.path()) return { error: { ok: false, reason: 'changed' } };
    const { items } = await store.load();
    const it = (items || []).find(x => x && x.line === r.line && x.raw === r.raw);
    return it ? { store, it } : { error: { ok: false, reason: 'changed' } };
  }

  const api = {
    apiVersion: 1,
    onChange(cb) {
      if (typeof cb !== 'function') return () => {};
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    weekStart: () => (plugin.settings.weekStart === 0 ? 0 : 1),

    reminders: {
      notePath() {
        try { return rem() ? rem().store.path() || '' : ''; } catch (e) { return ''; }
      },
      async summary(opts) {
        const today = (opts && opts.today) || D.todayISO();
        const limit = opts && opts.limit;
        const path = api.reminders.notePath();
        if (!path || !plugin.app.vault.getFileByPath(path)) {
          return { available: false, path, rows: [], buckets: null, counts: null, more: 0 };
        }
        const { items } = await rem().store.load();
        const plain = (items || []).map(it => plainReminder(it, path));
        return Object.assign({ available: true, path }, summarize(plain, today, limit));
      },
      async toggle(ref, opts) {
        const f = await freshReminder(ref);
        if (f.error) return f.error;
        const res = await f.store.toggle(f.it, (opts && opts.today) || D.todayISO());
        return res || { ok: false };
      },
      async snooze(ref, days, opts) {
        const f = await freshReminder(ref);
        if (f.error) return f.error;
        const res = await f.store.snooze(f.it, days, (opts && opts.today) || D.todayISO());
        return res || { ok: false };
      },
    },

    practices: {
      async today(opts) {
        const date = (opts && opts.date) || D.todayISO();
        const s = plugin.settings;
        const store = rhythm();
        const folder = store.root();
        if (!store.hasData()) return { available: false, focus: [], later: 0, done: 0, total: 0, date, folder };
        const data = await store.load();
        if (!data.practices.length) return { available: false, focus: [], later: 0, done: 0, total: 0, date, folder };
        const plan = M.planDay(data, date, { focusCount: s.focusCount, weekStart: s.weekStart });
        const row = r => ({
          name: r.p.name, area: r.p.area, when: r.p.when || '', whenLabel: M.WHEN_LABEL[r.p.when] || '',
          reason: r.reason, path: r.p.path, done: !!r.pr.doneToday,
          ref: makeRef({ k: 'p', date, name: r.p.name }),
        });
        return {
          available: true,
          focus: plan.focus.map(row),
          later: plan.later.length,
          done: plan.done.length,
          total: plan.all.length,
          date,
          folder,
          streak: M.streak(data.log, date),
          streakLabel: M.streakLabel(data, date, { streakMode: s.streakMode, weekStart: s.weekStart }),
        };
      },
      async tick(ref, on) {
        const r = readRef(ref, 'p');
        if (!r || !D.isISO(r.date)) return { ok: false, reason: 'bad-ref' };
        const name = String(r.name || '').replace(/\r?\n/g, ' ').trim();
        if (!name) return { ok: false, reason: 'name' };
        const store = rhythm();
        /* Renamed, set aside or deleted since the row was read. */
        const data = await store.load({ logFrom: r.date, logTo: r.date });
        if (!data.practices.some(p => p.name === name)) return { ok: false, reason: 'changed' };
        const res = await store.setDone(r.date, name, !!on);
        if (res && res.refused) return Object.assign({ ok: false }, res.refused);
        const prev = res && res.prev ? { done: !!res.prev.done, skip: !!res.prev.skip, snooze: !!res.prev.snooze, plan: !!res.prev.plan } : null;
        return { ok: true, path: store.logPath(r.date), prev };
      },
    },

    events: {
      async between(from, to) {
        if (!D.isISO(from) || !D.isISO(to)) return [];
        const store = rhythm();
        if (!store.hasData()) return [];
        const data = await store.load({ logFrom: '9999-12-31' });
        return data.events
          .filter(e => D.isISO(e.date) && e.date >= from && e.date <= to)
          .map(e => ({ name: e.name, date: e.date, time: e.time || '', area: e.area || '', path: e.path }))
          .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1)
            : (a.time || '') !== (b.time || '') ? ((a.time || '') < (b.time || '') ? -1 : 1)
              : a.name.localeCompare(b.name)));
      },
    },
  };

  return { api, notify, stop: () => { window.clearTimeout(soon); listeners.clear(); } };
}

module.exports = { makeApi, summarize, bucketOf, sortItems, isISO, diffDays, rank, makeRef, readRef };
