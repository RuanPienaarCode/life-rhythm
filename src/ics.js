'use strict';
/* A small iCalendar reader: VEVENTs with DTSTART as a date or a local /
   UTC date-time, plus the common RRULE shapes (DAILY, WEEKLY with BYDAY,
   MONTHLY, YEARLY, with INTERVAL, COUNT, UNTIL) and EXDATE, expanded into
   a window. Enough for an iCloud "public calendar" link; anything odd is
   ignored rather than guessed. Pure; no lookbehind regex. */

const D = require('./dates');

const pad = n => (n < 10 ? '0' : '') + n;

function unfold(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function unescape(s) {
  return String(s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/* '20260912' → {date}, '20260912T190000' → local, '...Z' → UTC → local. */
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
  /* TZID or floating: take the wall-clock time as written. */
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, allDay: false, tzid: params && params.TZID };
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

function parseRRule(val) {
  const r = {};
  for (const part of String(val || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    r[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  if (!r.FREQ) return null;
  return {
    freq: r.FREQ.toUpperCase(),
    interval: Math.max(1, parseInt(r.INTERVAL || '1', 10)),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL ? (parseStamp(r.UNTIL) || {}).date || null : null,
    byday: r.BYDAY ? r.BYDAY.split(',').map(s => s.trim().slice(-2).toLowerCase()).filter(Boolean) : null,
  };
}

const DOW = { su: 'sun', mo: 'mon', tu: 'tue', we: 'wed', th: 'thu', fr: 'fri', sa: 'sat' };

/* Expand one event's dates inside [from, to]. */
function occurrences(ev, from, to) {
  const start = ev.start.date;
  if (!ev.rrule) return start >= from && start <= to ? [start] : [];
  const r = ev.rrule;
  const out = [];
  const limitTo = r.until && r.until < to ? r.until : to;
  let n = 0;
  const push = d => { if (d >= from && d <= limitTo && !ev.exdates.has(d)) out.push(d); };
  if (r.freq === 'DAILY') {
    for (let d = start, i = 0; d <= limitTo && i < 5000; d = D.addDays(d, r.interval), i++) {
      n++; if (r.count && n > r.count) break; push(d);
    }
  } else if (r.freq === 'WEEKLY') {
    const days = r.byday ? r.byday.map(k => DOW[k]).filter(Boolean) : [D.dayKey(start)];
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
    const dom = D.fromISO(start).getDate();
    for (let m = D.monthStart(start), i = 0; m <= limitTo && i < 600; m = D.addMonths(m, r.interval), i++) {
      if (dom > D.daysInMonth(m)) continue;
      const d = `${D.monthKey(m)}-${pad(dom)}`;
      if (d < start) continue;
      n++; if (r.count && n > r.count) break;
      push(d);
    }
  } else if (r.freq === 'YEARLY') {
    const mmdd = start.slice(5);
    const y0 = +start.slice(0, 4);
    for (let y = y0, i = 0; i < 200; y += r.interval, i++) {
      const d = `${y}-${mmdd}`;
      if (d > limitTo) break;
      if (!D.isISO(d)) continue; // 29 Feb in a common year
      n++; if (r.count && n > r.count) break;
      push(d);
    }
  }
  return out;
}

/* → [{ uid, name, date, time, allDay, location, description }] sorted. */
function parseICS(text, from, to) {
  const body = unfold(text);
  const events = [];
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let m;
  while ((m = re.exec(body))) {
    const props = parseProps(m[1]);
    const get = name => props.find(p => p.name === name);
    const dt = get('DTSTART');
    if (!dt) continue;
    const start = parseStamp(dt.value, dt.params);
    if (!start) continue;
    const exdates = new Set();
    for (const p of props.filter(p => p.name === 'EXDATE')) {
      for (const v of p.value.split(',')) { const s = parseStamp(v.trim()); if (s) exdates.add(s.date); }
    }
    const rr = get('RRULE');
    const ev = {
      uid: (get('UID') || {}).value || '',
      name: unescape((get('SUMMARY') || {}).value || '(untitled)').trim(),
      location: unescape((get('LOCATION') || {}).value || '').trim(),
      description: unescape((get('DESCRIPTION') || {}).value || '').trim(),
      start,
      rrule: rr ? parseRRule(rr.value) : null,
      exdates,
    };
    const status = (get('STATUS') || {}).value;
    if (status && /cancelled/i.test(status)) continue;
    for (const date of occurrences(ev, from, to)) {
      events.push({ uid: ev.uid, name: ev.name, date, time: start.allDay ? '' : start.time, allDay: start.allDay, location: ev.location, description: ev.description });
    }
  }
  return events.sort((a, b) => (a.date + a.time + a.name).localeCompare(b.date + b.time + b.name));
}

module.exports = { parseICS, parseStamp, parseRRule, unfold };
