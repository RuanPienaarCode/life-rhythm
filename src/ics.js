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

/* Offset (ms) to add to a UTC instant to get that instant's wall-clock time
   in `tz`. Throws on an unknown zone. */
function tzOffsetMs(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const hour = parts.hour === '24' ? 0 : +parts.hour;
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hour, +parts.minute, +parts.second);
  return asUTC - date.getTime();
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

/* '20260912' → {date}, '20260912T190000' → local, '...Z' → UTC → local,
   TZID=Zone → converted to the device's local time (unknown zone: treated
   as floating local time, same as no TZID at all). */
function parseStamp(val, params) {
  const s = String(val || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '', allDay: true };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(s);
  if (!m) return null;
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return { date: D.toISO(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false };
  }
  const tzid = params && params.TZID;
  if (tzid) {
    try {
      const utc = zonedToUTC(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tzid);
      const d = new Date(utc);
      return { date: D.toISO(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false, tzid };
    } catch (e) {
      /* Unknown TZID: fall through to floating local time. */
    }
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, allDay: false, tzid };
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
    until: r.UNTIL ? (parseStamp(r.UNTIL) || {}).date || null : null,
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

/* Expand one event's dates inside [from, to]. Multi-day all-day spans are
   NOT handled here (see `expandSpan`) — this only anchors each occurrence
   on its start date. */
function occurrences(ev, from, to) {
  const start = ev.start.date;
  if (!ev.rrule || ev.rrule.unsupported) {
    return start >= from && start <= to ? [start] : [];
  }
  const r = ev.rrule;
  const out = [];
  const limitTo = r.until && r.until < to ? r.until : to;
  let n = 0;
  const push = d => { if (d >= from && d <= limitTo && !ev.exdates.has(d)) out.push(d); };
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
    for (const date of expandSpan(ev, from, to)) {
      events.push({ uid: ev.uid, name: ev.name, date, time: ev.start.allDay ? '' : ev.start.time, allDay: ev.start.allDay, location: ev.location, description: ev.description });
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
  return events.sort((a, b) => (a.date + a.time + a.name).localeCompare(b.date + b.time + b.name));
}

module.exports = { parseICS, parseStamp, parseRRule, unfold };
