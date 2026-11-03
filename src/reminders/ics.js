'use strict';
/* The calendar feed — the part that puts a real alert on a phone.

   Obsidian can only notify you while it is open. An .ics file is the bridge:
   open it on iOS and Apple Calendar adds the events, alarms and all, and
   they fire on the lock screen whether or not Obsidian is running.

   RFC 5545 is unforgiving — Apple Calendar rejects the whole FILE, not the
   offending line — so escaping, CRLF and 75-octet folding are not optional
   polish here. The feed is one-way: ticking a reminder off in Apple Calendar
   does not tick it off in the vault. */

const D = require('./dates');

const CRLF = '\r\n';
const PRIORITY_NUM = { highest: 1, high: 2, medium: 5, normal: 5, low: 7, lowest: 9 };

/* Stable per reminder so a re-import UPDATES the event it made last time
   instead of leaving a duplicate behind. Deliberately independent of the due
   date: moving a date must move the event, not clone it. Two reminders with
   the same title in the same list ("Take pills" at 08:00 and at 20:00) are
   told apart by their place among their twins — `nth` counts from 1. FNV-1a,
   because node:crypto does not exist on mobile. */
function uidFor(item, nth) {
  let h = 0x811c9dc5;
  const s = `${item.group || ''}|${String(item.title || '').toLowerCase()}${nth > 1 ? '|' + nth : ''}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `nudge-${('0000000' + h.toString(16)).slice(-8)}-${s.length.toString(36)}@obsidian`;
}

const esc = s => String(s === undefined || s === null ? '' : s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/* Fold to 75 OCTETS (not characters — an emoji in a title is four of them),
   never mid-codepoint, continuations introduced by a single space. */
function fold(line) {
  const chars = Array.from(String(line));
  const out = [];
  let cur = '', width = 0, limit = 75;
  for (const ch of chars) {
    const w = byteLen(ch);
    if (width + w > limit) {
      out.push(cur);
      cur = ' ' + ch;
      width = 1 + w;
      limit = 75;
    } else {
      cur += ch;
      width += w;
    }
  }
  out.push(cur);
  return out.join(CRLF);
}

function byteLen(ch) {
  const c = ch.codePointAt(0);
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c < 0x10000) return 3;
  return 4;
}

const stampOf = now => {
  const d = now ? new Date(now) : new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

const dateVal = iso => String(iso).replace(/-/g, '');
/* Floating local time (no Z, no TZID): 09:30 means 09:30 wherever the phone
   is, which is what a reminder means. */
const timeVal = (iso, hm) => `${dateVal(iso)}T${String(hm).replace(':', '')}00`;

/* A time plus some minutes, carried into the next day when it wraps — a
   23:50 reminder ends at 00:05 the day AFTER, not before it started. */
function addMinutes(iso, hm, mins) {
  const [h, m] = String(hm).split(':').map(Number);
  const total = h * 60 + m + mins;
  const days = Math.floor(total / 1440);
  const t = ((total % 1440) + 1440) % 1440;
  return { date: D.addDays(iso, days), time: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` };
}

/* An all-day event starts at midnight; nobody wants to be woken then. The
   trigger is an offset from the start to the hour the user chose. */
function allDayTrigger(hm) {
  const [h, m] = (D.parseClock(hm) || '09:00').split(':').map(Number);
  if (!h && !m) return 'PT0M';
  return `PT${h ? h + 'H' : ''}${m ? m + 'M' : ''}`;
}

function buildICS(items, opts) {
  const o = opts || {};
  const name = o.name || 'Nudge';
  const alarmMinutes = Number.isFinite(Number(o.alarmMinutes)) && o.alarmMinutes !== '' && o.alarmMinutes !== null && o.alarmMinutes !== undefined ? Number(o.alarmMinutes) : 10;
  const allDayAlarmTime = o.allDayAlarmTime || '09:00';
  const stamp = stampOf(o.now);

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ruan Pienaar//Nudge for Obsidian//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`,
    /* No X-WR-TIMEZONE: times here are floating, and naming a zone (UTC was
       here) invites Google Calendar to shift 09:00 by the phone's offset. */
    `X-WR-CALDESC:${esc('Reminders exported from ' + name)}`,
  ];

  /* Twins are counted BEFORE ticked or undated items are skipped. The UID
     must not depend on what is open: when the 08:00 "Take pills" is ticked,
     the 20:00 one stays number 2 instead of inheriting number 1's event. */
  const twins = {};
  for (const it of items || []) {
    if (!it) continue;
    const key = `${it.group || ''}|${String(it.title || '').toLowerCase()}`;
    twins[key] = (twins[key] || 0) + 1;
    if (it.done || !D.isISO(it.due)) continue;
    const timed = D.isTime(it.time);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uidFor(it, twins[key])}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`SUMMARY:${esc(it.title)}`);
    if (timed) {
      lines.push(`DTSTART:${timeVal(it.due, it.time)}`);
      const end = addMinutes(it.due, it.time, 15);
      lines.push(`DTEND:${timeVal(end.date, end.time)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateVal(it.due)}`);
      lines.push(`DTEND;VALUE=DATE:${dateVal(D.addDays(it.due, 1))}`);
    }
    const desc = [it.group ? `From ${it.group}` : '', (it.tags || []).join(' ')].filter(Boolean).join(' · ');
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    if (it.group) lines.push(`CATEGORIES:${esc(it.group)}`);
    lines.push(`PRIORITY:${PRIORITY_NUM[it.priority] || 5}`);
    lines.push('TRANSP:TRANSPARENT');
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${esc(it.title)}`);
    lines.push(timed ? `TRIGGER:-PT${Math.max(0, alarmMinutes)}M` : `TRIGGER;RELATED=START:${allDayTrigger(allDayAlarmTime)}`);
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

const countEvents = (items) => (items || []).filter(i => i && !i.done && D.isISO(i.due)).length;

module.exports = { buildICS, countEvents, uidFor, esc, fold };
