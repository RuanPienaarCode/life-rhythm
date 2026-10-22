'use strict';
/* Which reminders Obsidian should speak up about, right now.

   Kept pure and off the timer so the awkward cases can be pinned by tests:
   a reminder ticked five minutes ago, the app left open across midnight, a
   thing that has been overdue for a week and must not shout every minute.

   Obsidian can only do this while it is open — that is the honest limit of
   an in-app notice, and why ics.js exists as well. */

const D = require('./dates');

const toMin = hm => {
  const p = String(hm || '').split(':');
  return (+p[0] || 0) * 60 + (+p[1] || 0);
};

/* Derived, not remembered: the key is built from the reminder itself, so it
   needs no storage of its own, and it rolls over at midnight so a
   still-overdue reminder speaks once more tomorrow. The set of keys already
   spoken lives in memory only (src/main.js), so after a relaunch a reminder
   that is still due is told again — on purpose, so a restart never hides it. */
const keyFor = (item, today) => `${today}|${item.due || ''}|${item.time || ''}|${item.title}`;

function pending(items, opts) {
  const o = opts || {};
  const today = o.today || D.todayISO();
  const now = toMin(o.now || D.nowHM());
  const lead = o.leadMinutes === undefined ? 10 : Number(o.leadMinutes);
  const dailyAt = toMin(D.parseClock(o.allDayAlarmTime) || '09:00');
  const fired = new Set(o.fired || []);

  return (items || []).filter(i => {
    if (!i || i.done || !D.isISO(i.due)) return false;
    if (fired.has(keyFor(i, today))) return false;
    const n = D.diffDays(today, i.due);
    if (n > 0) return false;
    /* Late, or due today with no time of its own: the daily hour. */
    if (n < 0 || !D.isTime(i.time)) return now >= dailyAt;
    return now >= toMin(i.time) - lead;
  });
}

function message(items) {
  const list = items || [];
  if (!list.length) return '';
  const names = list.slice(0, 3).map(i => i.title);
  const rest = list.length - names.length;
  return names.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
}

module.exports = { pending, keyFor, message };
