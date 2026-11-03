'use strict';
/* Repeats, in the subset of Obsidian Tasks' phrasing we can honour exactly.

   An unparseable rule returns '' — the caller then keeps the reminder rather
   than inventing a date for it. Guessing here would silently move something
   the user needs to do. */

const D = require('./dates');

const DAY_NAMES = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const UNITS = { day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month', year: 'year', years: 'year' };
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: -1 };

/* every [N] <unit|weekday> [on <when>] [when done] — the "on" forms are the
   ones Tasks writes: "every week on Monday, Thursday", "every month on the
   1st", "every month on the last", "every 2 months on the second Tuesday". */
const RULE_RE = /^every\s+(?:(\d+)\s+)?([a-z]+)(?:\s+on\s+(?:the\s+)?(.+?))?(\s+when\s+done)?$/;

const dayName = w => {
  const k = String(w || '').replace(/,$/, '');
  if (DAY_NAMES[k] !== undefined) return DAY_NAMES[k];
  /* "mondays" */
  if (/days$/.test(k) && DAY_NAMES[k.slice(0, -1)] !== undefined) return DAY_NAMES[k.slice(0, -1)];
  return undefined;
};

/* "1st", "22nd", "first", "last" → 1, 22, 1, -1 */
function ordinal(w) {
  const m = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(w);
  if (m) return +m[1] >= 1 && +m[1] <= 31 ? +m[1] : 0;
  return ORDINALS[w] || 0;
}

function parse(rule) {
  const s = String(rule || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const m = RULE_RE.exec(s);
  if (!m) return null;
  const n = m[1] ? parseInt(m[1], 10) : 1;
  if (!(n > 0)) return null;
  const word = m[2];
  const on = m[3] || '';
  const whenDone = !!m[4];
  if (!on) {
    if (word === 'weekday' || word === 'weekdays') return { kind: 'weekday', n, whenDone };
    if (dayName(word) !== undefined) return { kind: 'dayOfWeek', day: dayName(word), n, whenDone };
    if (UNITS[word]) return { kind: UNITS[word], n, whenDone };
    return null;
  }
  const unit = UNITS[word];
  if (unit === 'week') {
    const days = [];
    for (const w of on.split(/\s*(?:,|\band\b)\s*|\s+/)) {
      if (!w) continue;
      const d = dayName(w);
      if (d === undefined) return null;
      if (days.indexOf(d) === -1) days.push(d);
    }
    if (!days.length) return null;
    return { kind: 'weekOn', days: days.sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)), n, whenDone };
  }
  if (unit === 'month') {
    const parts = on.split(' ');
    if (parts.length === 1) {
      const d = ordinal(parts[0]);
      return d ? { kind: 'monthDay', day: d, n, whenDone } : null;
    }
    if (parts.length === 2) {
      const nth = ordinal(parts[0]);
      const dw = dayName(parts[1]);
      if (!nth || nth > 5 || dw === undefined) return null;
      return { kind: 'monthNth', nth, dow: dw, n, whenDone };
    }
  }
  return null;
}

const daysIn = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const ym = iso => ({ y: +String(iso).slice(0, 4), m0: +String(iso).slice(5, 7) - 1 });
const iso = (y, m0, d) => {
  const t = new Date(Date.UTC(y, m0, d));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

/* The date a month rule falls on in a given month, or '' when that month
   has no such day (a fifth Tuesday). "On the 31st" clamps to the month's
   last day — the bill is still due that month. */
function inMonth(r, y, m0) {
  const len = daysIn(y, m0);
  if (r.kind === 'monthDay') return iso(y, m0, r.day === -1 ? len : Math.min(r.day, len));
  if (r.nth === -1) {
    const lastDow = new Date(Date.UTC(y, m0, len)).getUTCDay();
    return iso(y, m0, len - (((lastDow - r.dow) + 7) % 7));
  }
  const firstDow = new Date(Date.UTC(y, m0, 1)).getUTCDay();
  const d = 1 + (((r.dow - firstDow) + 7) % 7) + 7 * (r.nth - 1);
  return d <= len ? iso(y, m0, d) : '';
}

function step(r, from) {
  switch (r.kind) {
    case 'day': return D.addDays(from, r.n);
    case 'week': return D.addDays(from, 7 * r.n);
    case 'month': return D.addMonths(from, r.n);
    case 'year': return D.addMonths(from, 12 * r.n);
    case 'weekday': {
      let d = from;
      for (let k = 0; k < r.n; k++) {
        d = D.addDays(d, 1);
        while (D.dow(d) === 0 || D.dow(d) === 6) d = D.addDays(d, 1);
      }
      return d;
    }
    case 'dayOfWeek': {
      const delta = ((r.day - D.dow(from)) + 7) % 7;
      return D.addDays(from, (delta === 0 ? 7 : delta) + 7 * (r.n - 1));
    }
    case 'weekOn': {
      /* Later this week, else the first listed day N weeks on. Weeks start
         on Monday, as they do for Tasks. */
      const mon = D.addDays(from, -((D.dow(from) + 6) % 7));
      const pos = (D.dow(from) + 6) % 7;
      for (const d of r.days) if ((d + 6) % 7 > pos) return D.addDays(mon, (d + 6) % 7);
      return D.addDays(mon, 7 * r.n + ((r.days[0] + 6) % 7));
    }
    case 'monthDay': case 'monthNth': {
      const { y, m0 } = ym(from);
      const here = inMonth(r, y, m0);
      if (here && D.diffDays(from, here) > 0) return here;
      for (let k = 1; k <= 24; k++) {
        const there = inMonth(r, y, m0 + k * r.n);
        if (there) return there;
      }
      return '';
    }
    default: return '';
  }
}

/* The next due date after this one was met.

   `whenDone` rules count from the day it was actually ticked (a chore);
   everything else counts from the date it was due (a deadline, which must
   not drift every time you are late).

   `today` is optional: when given, a repeat that has fallen behind is walked
   forward until it lands in the future, so ticking a month-old daily chore
   gives you tomorrow rather than a date that is still overdue. Month and
   year steps are always counted from the ORIGINAL date, so the 31st walked
   forward through February comes out on the 31st again, not the 28th. */
function nextDue(rule, due, doneDate, today) {
  const r = parse(rule);
  if (!r || !D.isISO(due)) return '';
  const base = r.whenDone && D.isISO(doneDate) ? doneDate : due;
  const monthly = r.kind === 'month' || r.kind === 'year';
  const months = r.kind === 'year' ? 12 * r.n : r.n;
  let k = 1;
  let next = monthly ? D.addMonths(base, months) : step(r, base);
  if (!next) return '';
  if (D.isISO(today)) {
    let guard = 0;
    while (D.diffDays(today, next) <= 0 && guard++ < 500) {
      const advanced = monthly ? D.addMonths(base, months * ++k) : step(r, next);
      if (!advanced || advanced === next) break;
      next = advanced;
    }
  }
  return next;
}

const nth = n => (n === -1 ? 'last' : n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'));

function describe(rule) {
  const r = parse(rule);
  if (!r) return '';
  const every = (unit) => (r.n > 1 ? `${r.n} ${unit}s` : unit);
  let body;
  if (r.kind === 'weekday') body = every('weekday');
  else if (r.kind === 'dayOfWeek') body = every(D.DAYS[r.day]);
  else if (r.kind === 'weekOn') body = `${every('week')} on ${r.days.map(d => D.DAYS_SHORT[d]).join(', ')}`;
  else if (r.kind === 'monthDay') body = `${every('month')} on the ${nth(r.day)}`;
  else if (r.kind === 'monthNth') body = `${every('month')} on the ${nth(r.nth)} ${D.DAYS[r.dow]}`;
  else body = every(r.kind);
  return `Every ${body}${r.whenDone ? ' when done' : ''}`;
}

const PRESETS = [
  { rule: 'every day', label: 'Every day' },
  { rule: 'every week', label: 'Every week' },
  { rule: 'every month', label: 'Every month' },
  { rule: 'every 3 months', label: 'Every 3 months' },
  { rule: 'every year', label: 'Every year' },
  { rule: 'every weekday', label: 'Every weekday' },
];

module.exports = { nextDue, describe, parse, PRESETS };
