'use strict';
/* Calendar arithmetic done on the ISO string, never on a local Date. A
   reminder due on the 20th is due on the 20th in every timezone, so dates
   here are strings and only the *display* ever becomes a Date. */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* A real calendar date — 2027-02-29 and 2026-04-31 are not. */
function isISO(s) {
  const m = ISO_RE.exec(String(s || ''));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

const isTime = s => TIME_RE.test(String(s || ''));

/* The one reader for a clock time someone TYPED (the "Daily hour" setting).
   Notices and the phone alarm both go through it, so they cannot disagree
   about what "8am" means. Accepts 7:30, 07:30, 8am, 9:30pm, 21h00 and 21h;
   returns "HH:MM", or '' when it is not a time — the caller then keeps what it
   had rather than guessing. A bare "9" is left unread: it could be anything. */
function parseClock(s) {
  if (typeof s !== 'string') return '';
  const t = s.trim().toLowerCase();
  const p = n => String(n).padStart(2, '0');
  let m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(t);
  if (m) {
    const h = +m[1], min = m[2] === undefined ? 0 : +m[2];
    if (h < 1 || h > 12 || min > 59) return '';
    return `${p((h % 12) + (m[3] === 'pm' ? 12 : 0))}:${p(min)}`;
  }
  m = /^(\d{1,2})(?::|h)(\d{2})$/.exec(t) || /^(\d{1,2})h()$/.exec(t);
  if (!m) return '';
  const h = +m[1], min = m[2] === '' ? 0 : +m[2];
  return h > 23 || min > 59 ? '' : `${p(h)}:${p(min)}`;
}

/* UTC throughout: the only job of the Date here is day counting. */
function toDate(iso) {
  const m = ISO_RE.exec(String(iso || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function fromDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function addDays(iso, n) {
  const d = toDate(iso);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

/* Months are not a fixed number of days, and the 31st of a month is not a
   date in every month. Clamp to the last day rather than spilling forward —
   "every month" on the 31st means the end of each month, not the 3rd. */
function addMonths(iso, n) {
  const m = ISO_RE.exec(String(iso || ''));
  if (!m) return '';
  const y = +m[1], mo = +m[2] - 1, day = +m[3];
  const target = new Date(Date.UTC(y, mo + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return fromDate(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last))));
}

function diffDays(a, b) {
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function dow(iso) {
  const d = toDate(iso);
  return d ? d.getUTCDay() : 0;
}

function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nowHM() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* Monday-start by default; weekStart is 0 for Sunday. */
function startOfWeek(iso, weekStart) {
  const ws = weekStart === undefined ? 1 : weekStart;
  return addDays(iso, -(((dow(iso) - ws) + 7) % 7));
}

function human(iso) {
  const m = ISO_RE.exec(String(iso || ''));
  if (!m) return '';
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

function shortDate(iso, today) {
  const m = ISO_RE.exec(String(iso || ''));
  if (!m) return '';
  const sameYear = today && String(today).slice(0, 4) === m[1];
  return `${DAYS_SHORT[dow(iso)]} ${+m[3]} ${MONTHS[+m[2] - 1]}${sameYear ? '' : ' ' + m[1]}`;
}

/* How a due date reads in a list: near dates get a word, the rest a date. */
function relative(iso, today) {
  if (!isISO(iso)) return '';
  const n = diffDays(today, iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0) return `${-n} days ago`;
  if (n <= 6) return DAYS[dow(iso)];
  return shortDate(iso, today);
}

module.exports = {
  isISO, isTime, parseClock, addDays, addMonths, diffDays, dow, todayISO, nowHM,
  startOfWeek, human, shortDate, relative, DAYS, DAYS_SHORT, MONTHS,
};
