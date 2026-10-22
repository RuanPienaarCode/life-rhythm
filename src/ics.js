'use strict';
/* A small iCalendar reader: VEVENTs with DTSTART as a date or a local /
   UTC / TZID date-time, the common RRULE shapes (DAILY, WEEKLY with BYDAY,
   MONTHLY/YEARLY with BYDAY incl. ordinals, BYMONTHDAY incl. negatives,
   BYMONTH, BYSETPOS, with INTERVAL, COUNT, UNTIL), EXDATE, RECURRENCE-ID
   overrides (moved/cancelled occurrences) and multi-day all-day spans,
   expanded into a window. Enough for an iCloud "public calendar" link or a
   Google secret address; any RRULE part we do not implement is never
   guessed at — the series falls back to showing just its DTSTART. Pure; no
   lookbehind regex (a parse-time SyntaxError before iOS 16.4). */

const D = require('./dates');

const pad = n => (n < 10 ? '0' : '') + n;

function unfold(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function unescape(s) {
  return String(s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/* One Intl formatter per zone: building one is the expensive part (a
   2000-event TZID feed used to build thousands). A failed zone is cached
   too, so an unknown TZID costs one failed construction, not one per stamp. */
const dtfCache = new Map();
function formatterFor(tz) {
  let f = dtfCache.get(tz);
  if (f === undefined) {
    if (dtfCache.size > 200) dtfCache.clear(); /* a hostile feed cannot grow this without bound */
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (e) {
      f = null;
    }
    dtfCache.set(tz, f);
  }
  if (!f) throw new RangeError(`Unknown time zone: ${tz}`);
  return f;
}

/* Uncached: offset (ms) to add to a UTC instant to get its wall-clock time in
   `tz`. Throws on an unknown zone. */
function rawOffsetMs(ms, tz) {
  const parts = {};
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const hour = parts.hour === '24' ? 0 : +parts.hour;
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hour, +parts.minute, +parts.second);
  return asUTC - ms;
}

/* Offsets are memoised at UTC midnights. If a zone has the same offset at
   both ends of a UTC day (no transition inside it) that offset holds for
   every instant in the day; on the rare day it changes we ask exactly. */
const DAY_MS = 86400000;
const offsetCache = new Map(); /* tz → Map(UTC day number → offset) */
function offsetAtMidnight(tz, day) {
  let byDay = offsetCache.get(tz);
  if (!byDay) {
    if (offsetCache.size > 200) offsetCache.clear();
    byDay = new Map();
    offsetCache.set(tz, byDay);
  }
  let v = byDay.get(day);
  if (v === undefined) {
    if (byDay.size > 50000) byDay.clear();
    v = rawOffsetMs(day * DAY_MS, tz);
    byDay.set(day, v);
  }
  return v;
}

/* Offset (ms) to add to a UTC instant to get that instant's wall-clock time
   in `tz`. Throws on an unknown zone. */
function tzOffsetMs(date, tz) {
  const ms = date.getTime();
  const day = Math.floor(ms / DAY_MS);
  const a = offsetAtMidnight(tz, day);
  if (a === offsetAtMidnight(tz, day + 1)) return a;
  return rawOffsetMs(ms, tz);
}

/* Wall-clock date/time components in `tz` → the UTC instant (ms) they name. */
function zonedToUTC(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = tzOffsetMs(new Date(guess), tz);
  let utc = guess - offset;
  const offset2 = tzOffsetMs(new Date(utc), tz);
  if (offset2 !== offset) utc = guess - offset2;
  return utc;
}

const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const utcISO = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcHHMM = d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const STAMP_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/;

/* '20260912' → {date}, '20260912T190000' → local, '...Z' → UTC → local,
   TZID=Zone → converted to the device's local time (unknown zone: treated
   as floating local time, same as no TZID at all).
   `date`/`time` are always the DEVICE-local result. A zoned stamp also
   carries `tz` ('UTC' or the TZID) and `ownDate`/`ownTime`, the wall clock
   in that zone — recurrence is expanded there (see `localOf`). Floating and
   all-day stamps have no `tz`; their own and local values are the same. */
function parseStamp(val, params) {
  const s = String(val || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    return { date, time: '', allDay: true, tz: null, ownDate: date, ownTime: '' };
  }
  m = STAMP_RE.exec(s);
  if (!m) return null;
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return { date: D.toISO(d), time: hhmm(d), allDay: false, tz: 'UTC', ownDate: utcISO(d), ownTime: utcHHMM(d) };
  }
  const tzid = params && params.TZID;
  if (tzid) {
    try {
      const utc = zonedToUTC(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tzid);
      const d = new Date(utc);
      const own = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
      return { date: D.toISO(d), time: hhmm(d), allDay: false, tzid, tz: tzid, ownDate: utcISO(own), ownTime: utcHHMM(own) };
    } catch (e) {
      /* Unknown TZID: fall through to floating local time. */
    }
  }
  const date = `${m[1]}-${m[2]}-${m[3]}`, time = `${m[4]}:${m[5]}`;
  return { date, time, allDay: false, tzid, tz: null, ownDate: date, ownTime: time };
}

/* The UTC instant (ms) of a zoned occurrence, or the device-local instant of a
   floating one. `ownDate` is an ISO date in the event's own zone. */
function instantOf(start, ownDate) {
  const y = +ownDate.slice(0, 4), mo = +ownDate.slice(5, 7), d = +ownDate.slice(8, 10);
  const h = start.ownTime ? +start.ownTime.slice(0, 2) : 0, mi = start.ownTime ? +start.ownTime.slice(3, 5) : 0;
  if (!start.tz) return new Date(y, mo - 1, d, h, mi, 0).getTime();
  if (start.tz === 'UTC') return Date.UTC(y, mo - 1, d, h, mi, 0);
  return zonedToUTC(y, mo, d, h, mi, 0, start.tz);
}

/* One occurrence of a series (given as the date in the event's own zone) →
   the device-local {date, time} it falls on. Each occurrence is converted on
   its own, so a DST change in the event's zone moves the local time and a
   zone far from the device's can push the date either way. */
function localOf(start, ownDate) {
  if (start.allDay) return { date: ownDate, time: '' };
  if (!start.tz) return { date: ownDate, time: start.ownTime };
  const d = new Date(instantOf(start, ownDate));
  return { date: D.toISO(d), time: hhmm(d) };
}

function parseProps(block) {
  const props = [];
  for (const line of block.split('\n')) {
    const ci = line.indexOf(':');
    if (ci <= 0) continue;
    const head = line.slice(0, ci);
    const value = line.slice(ci + 1);
    const parts = head.split(';');
    const name = parts[0].toUpperCase();
    const params = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    props.push({ name, params, value });
  }
  return props;
}

const DOW = { su: 'sun', mo: 'mon', tu: 'tue', we: 'wed', th: 'thu', fr: 'fri', sa: 'sat' };

/* 'WE' / '1SU' / '-1FR' → { ord, day }; ord null = every such weekday. */
function parseByDayList(s) {
  if (!s) return null;
  const out = [];
  for (const part of s.split(',')) {
    const m = /^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(part.trim());
    if (!m) continue;
    out.push({ ord: m[1] ? parseInt(m[1], 10) : null, day: DOW[m[2].toLowerCase()] });
  }
  return out.length ? out : null;
}

function parseIntList(s) {
  if (!s) return null;
  const out = s.split(',').map(v => parseInt(v.trim(), 10)).filter(n => !Number.isNaN(n));
  return out.length ? out : null;
}

/* RRULE parts we understand; anything else present means the rule is not
   guessed at (see `unsupported` below). WKST only changes which day a week
   is deemed to start on for BYDAY-less WEEKLY counting; we already assume
   Monday, so it is accepted but not separately honoured. */
const KNOWN_PARTS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST']);
const KNOWN_FREQ = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

/* UNTIL keeps what it was written as, because each form means something
   different: a date (inclusive of that day in the event's own zone), a UTC
   instant (`Z`), or a floating wall-clock time. null if unreadable. */
function parseUntil(val) {
  const s = String(val || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return { kind: 'date', date: `${m[1]}-${m[2]}-${m[3]}` };
  m = STAMP_RE.exec(s);
  if (!m) return null;
  if (m[7]) return { kind: 'utc', ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) };
  return { kind: 'floating', date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

/* Is this occurrence (own-zone date) after the series' UNTIL? */
function pastUntil(ev, ownDate) {
  const u = ev.rrule.until;
  if (!u) return false;
  const st = ev.start;
  if (u.kind === 'date') return ownDate > u.date;
  if (st.allDay) return u.kind === 'utc' ? ownDate > utcISO(new Date(u.ms)) : ownDate > u.date;
  if (u.kind === 'floating') return `${ownDate} ${st.ownTime}` > `${u.date} ${u.time}`;
  return instantOf(st, ownDate) > u.ms;
}

/* The latest own-zone date UNTIL could still admit — only a loop bound; the
   exact test is `pastUntil`. A UTC instant is at most a day off any zone. */
function untilBound(u) {
  if (!u) return null;
  return u.kind === 'utc' ? D.addDays(utcISO(new Date(u.ms)), 1) : u.date;
}

function parseRRule(val) {
  const r = {};
  let unsupported = false;
  for (const part of String(val || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).toUpperCase();
    r[key] = part.slice(eq + 1);
    if (!KNOWN_PARTS.has(key)) unsupported = true;
  }
  if (!r.FREQ) return null;
  const freq = r.FREQ.toUpperCase();
  if (!KNOWN_FREQ.has(freq)) unsupported = true;
  return {
    freq,
    interval: Math.max(1, parseInt(r.INTERVAL || '1', 10)),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL ? parseUntil(r.UNTIL) : null,
    byday: parseByDayList(r.BYDAY),
    bymonthday: parseIntList(r.BYMONTHDAY),
    bymonth: parseIntList(r.BYMONTH),
    bysetpos: parseIntList(r.BYSETPOS),
    unsupported,
  };
}

/* Every day-of-month in `monthISO` ('YYYY-MM' or a full date in it) whose
   weekday is `dayKey`, ascending. */
function weekdayOccurrencesInMonth(monthKeyStr, n, dayKey) {
  const out = [];
  for (let dom = 1; dom <= n; dom++) {
    if (D.dayKey(`${monthKeyStr}-${pad(dom)}`) === dayKey) out.push(dom);
  }
  return out;
}

/* BYDAY/BYMONTHDAY candidates for one month, as sorted ISO dates. No
   BYSETPOS applied here (YEARLY needs to pool candidates across BYMONTH
   before applying it). */
function monthDayCandidates(monthISO, r) {
  const mk = D.monthKey(monthISO);
  const n = D.daysInMonth(`${mk}-01`);
  const doms = new Set();
  if (r.bymonthday) {
    for (const md of r.bymonthday) {
      const dom = md > 0 ? md : n + md + 1;
      if (dom >= 1 && dom <= n) doms.add(dom);
    }
  }
  if (r.byday) {
    for (const b of r.byday) {
      const occ = weekdayOccurrencesInMonth(mk, n, b.day);
      if (b.ord == null) occ.forEach(d => doms.add(d));
      else if (b.ord > 0) { if (occ[b.ord - 1] != null) doms.add(occ[b.ord - 1]); }
      else { const idx = occ.length + b.ord; if (occ[idx] != null) doms.add(occ[idx]); }
    }
  }
  return [...doms].sort((a, b) => a - b).map(d => `${mk}-${pad(d)}`);
}

function applySetPos(dates, positions) {
  const picked = [];
  for (const pos of positions) {
    const idx = pos > 0 ? pos - 1 : dates.length + pos;
    if (dates[idx] != null) picked.push(dates[idx]);
  }
  return [...new Set(picked)].sort();
}

/* Expand one event's dates inside [from, to]. Dates here are in the event's
   OWN zone (convert with `localOf`); an EXDATE is matched on the local date,
   as it was parsed. Multi-day all-day spans are NOT handled here (see
   `expandSpan`) — this only anchors each occurrence on its start date. */
function occurrences(ev, from, to) {
  const start = ev.start.ownDate;
  if (!ev.rrule || ev.rrule.unsupported) {
    return start >= from && start <= to ? [start] : [];
  }
  const r = ev.rrule;
  const out = [];
  const bound = untilBound(r.until);
  const limitTo = bound && bound < to ? bound : to;
  let n = 0;
  const push = d => {
    if (d < from || d > limitTo || pastUntil(ev, d)) return;
    if (ev.exdates.size && ev.exdates.has(localOf(ev.start, d).date)) return;
    out.push(d);
  };
  if (r.freq === 'DAILY') {
    let d = start;
    /* No COUNT: a series that began years ago need not be stepped one day
       at a time from DTSTART just to reach the window — jump forward by
       whole intervals. (COUNT must still be counted from DTSTART.) */
    if (!r.count && start < from) {
      const steps = Math.max(0, Math.floor(D.diffDays(start, from) / r.interval));
      d = D.addDays(start, steps * r.interval);
    }
    for (let i = 0; d <= limitTo && i < 5000; d = D.addDays(d, r.interval), i++) {
      n++; if (r.count && n > r.count) break; push(d);
    }
  } else if (r.freq === 'WEEKLY') {
    const days = r.byday ? r.byday.map(b => b.day) : [D.dayKey(start)];
    for (let ws = D.weekStart(start, 1), i = 0; ws <= limitTo && i < 1000; ws = D.addDays(ws, 7 * r.interval), i++) {
      for (let k = 0; k < 7; k++) {
        const d = D.addDays(ws, k);
        if (d < start) continue;
        if (!days.includes(D.dayKey(d))) continue;
        n++; if (r.count && n > r.count) return out;
        push(d);
      }
    }
  } else if (r.freq === 'MONTHLY') {
    const dom0 = D.fromISO(start).getDate();
    for (let m = D.monthStart(start), i = 0; m <= limitTo && i < 600; m = D.addMonths(m, r.interval), i++) {
      let dates;
      if (r.byday || r.bymonthday) {
        dates = monthDayCandidates(m, r);
        if (r.bysetpos && dates.length) dates = applySetPos(dates, r.bysetpos);
      } else if (dom0 <= D.daysInMonth(m)) {
        dates = [`${D.monthKey(m)}-${pad(dom0)}`];
      } else {
        dates = [];
      }
      for (const d of dates) {
        if (d < start) continue;
        n++; if (r.count && n > r.count) return out;
        push(d);
      }
    }
  } else if (r.freq === 'YEARLY') {
    const mmdd0 = start.slice(5);
    const y0 = +start.slice(0, 4);
    for (let y = y0, i = 0; i < 200 && (y === y0 || `${y}-01-01` <= limitTo); y += r.interval, i++) {
      let dates;
      if (r.byday || r.bymonthday || r.bymonth) {
        const months = r.bymonth && r.bymonth.length ? r.bymonth : [+mmdd0.slice(0, 2)];
        let all = [];
        for (const mm of months) all = all.concat(monthDayCandidates(`${y}-${pad(mm)}`, r));
        all = [...new Set(all)].sort();
        dates = r.bysetpos && all.length ? applySetPos(all, r.bysetpos) : all;
      } else {
        const d = `${y}-${mmdd0}`;
        dates = D.isISO(d) ? [d] : [];
      }
      for (const d of dates) {
        if (d < start || d > limitTo) continue;
        n++; if (r.count && n > r.count) return out;
        push(d);
      }
    }
  }
  return out;
}

/* Widen the window for multi-day all-day spans so an anchor that started
   before `from` but still covers into it is found, then fan each anchor
   out across the days it covers and re-clip to [from, to]. */
function expandSpan(ev, from, to) {
  const spanDays = (ev.start.allDay && ev.end && ev.end.allDay) ? Math.max(1, D.diffDays(ev.start.date, ev.end.date)) : 1;
  const fromWide = spanDays > 1 ? D.addDays(from, -(spanDays - 1)) : from;
  const anchors = occurrences(ev, fromWide, to);
  if (spanDays <= 1) return anchors;
  const out = [];
  for (const a of anchors) {
    for (let i = 0; i < spanDays; i++) {
      const d = D.addDays(a, i);
      if (d >= from && d <= to) out.push(d);
    }
  }
  return out;
}

/* → [{ uid, name, date, time, allDay, location, description }] sorted. */
function parseICS(text, from, to) {
  const body = unfold(text);
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  const raw = [];
  let m;
  while ((m = re.exec(body))) {
    /* Strip VALARM sub-blocks first: their own DESCRIPTION/SUMMARY must
       never leak into the event's fields. */
    const block = m[1].replace(/BEGIN:VALARM[\s\S]*?END:VALARM/g, '');
    const props = parseProps(block);
    const get = name => props.find(p => p.name === name);
    const dt = get('DTSTART');
    if (!dt) continue;
    const start = parseStamp(dt.value, dt.params);
    if (!start) continue;
    const dtend = get('DTEND');
    const end = dtend ? parseStamp(dtend.value, dtend.params) : null;
    const exdates = new Set();
    for (const p of props.filter(p => p.name === 'EXDATE')) {
      for (const v of p.value.split(',')) { const s = parseStamp(v.trim(), p.params); if (s) exdates.add(s.date); }
    }
    const rr = get('RRULE');
    const recProp = get('RECURRENCE-ID');
    const recurrenceId = recProp ? parseStamp(recProp.value, recProp.params) : null;
    const status = (get('STATUS') || {}).value;
    raw.push({
      uid: (get('UID') || {}).value || '',
      name: unescape((get('SUMMARY') || {}).value || '(untitled)').trim(),
      location: unescape((get('LOCATION') || {}).value || '').trim(),
      description: unescape((get('DESCRIPTION') || {}).value || '').trim(),
      start, end,
      rrule: rr ? parseRRule(rr.value) : null,
      exdates,
      isOverride: !!recurrenceId,
      recurrenceId,
      cancelled: !!(status && /cancelled/i.test(status)),
    });
  }

  /* Events sharing a UID with an override (RECURRENCE-ID) replace that one
     occurrence: excluded from the master's own expansion, then re-added at
     the override's own date/time (or dropped, if the override cancels it). */
  const overridesByUid = new Map();
  for (const ev of raw) {
    if (!ev.isOverride) continue;
    if (!overridesByUid.has(ev.uid)) overridesByUid.set(ev.uid, []);
    overridesByUid.get(ev.uid).push(ev);
  }

  const events = [];
  const add = ev => {
    /* A zoned series is expanded in its own zone, so the window is widened
       by two days (zones differ by up to 26 h) and each occurrence is
       clipped again once it is in local time. */
    const wide = ev.start.tz ? 2 : 0;
    const lo = wide ? D.addDays(from, -wide) : from, hi = wide ? D.addDays(to, wide) : to;
    for (const own of expandSpan(ev, lo, hi)) {
      const { date, time } = localOf(ev.start, own);
      if (date < from || date > to) continue;
      events.push({ uid: ev.uid, name: ev.name, date, time, allDay: ev.start.allDay, location: ev.location, description: ev.description });
    }
  };
  for (const ev of raw) {
    if (ev.isOverride) {
      if (!ev.cancelled) add(ev);
      continue;
    }
    if (ev.cancelled) continue;
    const overrides = overridesByUid.get(ev.uid);
    if (overrides) for (const ov of overrides) if (ov.recurrenceId) ev.exdates.add(ov.recurrenceId.date);
    add(ev);
  }
  /* All-day (time '') first on a day, then by time — always zero-padded
     HH:MM here — then by name; one concatenated string set an all-day
     name against the digits of a time. */
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return events.sort((a, b) => cmp(a.date, b.date) || cmp(a.time, b.time) || a.name.localeCompare(b.name));
}

module.exports = { parseICS, parseStamp, parseRRule, unfold };
