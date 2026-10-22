'use strict';
/* Quick-add: one typed line becomes a filled form.

     Practice guitar daily 20min @evening #Craft
     Exercise 4/week 30 min
     Date night 2026-09-14 19:00 #Family          → event
     Walk a long trail by 2027-03 #Adventure       → goal

   Pure. Returns { kind, name, cadence, minutes, when, area, date, time,
   horizon } with only the fields it found; the caller merges. */

const { WHEN } = require('./constants');

const CADENCE = /^(daily|weekly|monthly|\d+\/(?:week|month|day)|\d+x\/(?:week|month))$/i;
/* The bare word forms only — the ones ambiguous with an ordinary English
   sentence ("the weekly paper"). The slash and "Nx" forms are never
   anything but a cadence, so they are always eaten. */
const BARE_CADENCE = /^(daily|weekly|monthly)$/i;
const CADENCE_UNIT = { week: 'week', weeks: 'week', month: 'month', months: 'month' };

/* True when a leap-year-aware calendar day actually exists — "2026-02-31"
   is four digits, a dash, two digits, a dash, two digits, and no day at
   all. */
function isRealDate(y, mo, d) {
  if (mo < 1 || mo > 12) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= days[mo - 1];
}

/* "4 per week" / "4x week" / "4 times a week" (and month) → "4/week".
   Returns { cadence, len } — how many words the phrase consumed — or
   null when `words[i]` isn't the start of one. */
function matchCadencePhrase(words, i) {
  const w = words[i];
  const m = /^(\d+)(x)?$/i.exec(w);
  if (!m) return null;
  const n = m[1];
  const next = (words[i + 1] || '').toLowerCase();
  const nextNext = (words[i + 2] || '').toLowerCase();
  const nextNextNext = (words[i + 3] || '').toLowerCase();
  if (m[2]) { // "4x week"
    const unit = CADENCE_UNIT[next];
    return unit ? { cadence: `${n}/${unit}`, len: 2 } : null;
  }
  if (next === 'per' && CADENCE_UNIT[nextNext]) return { cadence: `${n}/${CADENCE_UNIT[nextNext]}`, len: 3 };
  if (next === 'times') {
    if (nextNext === 'a' && CADENCE_UNIT[nextNextNext]) return { cadence: `${n}/${CADENCE_UNIT[nextNextNext]}`, len: 4 };
    if (CADENCE_UNIT[nextNext]) return { cadence: `${n}/${CADENCE_UNIT[nextNext]}`, len: 3 };
  }
  return null;
}

function parseQuickAdd(text, areas) {
  const out = {};
  const areaNames = (areas || []).map(a => a.name);
  const lower = areaNames.map(a => a.toLowerCase());
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const keep = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wl = w.toLowerCase();
    const phrase = matchCadencePhrase(words, i);
    if (phrase) { out.cadence = phrase.cadence; i += phrase.len - 1; continue; }
    if (CADENCE.test(w)) {
      /* A bare "daily"/"weekly"/"monthly" only counts as a cadence when it
         stands alone — not when it's followed by another plain word, the
         way "weekly" sits inside "the weekly paper". If what follows is
         itself going to be consumed as a modifier (a time, an @when, a
         number), or there's nothing left, it's a real cadence word. */
      const following = words[i + 1];
      const followingIsPlainWord = BARE_CADENCE.test(w) && following && /^[A-Za-z]+$/.test(following)
        && !BARE_CADENCE.test(following) && !/^(every|tomorrow|today|by)$/i.test(following);
      if (followingIsPlainWord) { keep.push(w); continue; }
      out.cadence = wl; continue;
    }
    if (wl === 'every' && words[i + 1] && /^(day|week|month)$/i.test(words[i + 1])) {
      out.cadence = { day: 'daily', week: 'weekly', month: 'monthly' }[words[i + 1].toLowerCase()];
      i++; continue;
    }
    if (/^(\d+)\s*min(s|utes)?$/i.test(w) || /^\d+min$/i.test(w)) { out.minutes = parseInt(w, 10); continue; }
    if (/^\d+$/.test(w) && words[i + 1] && /^min(s|utes)?$/i.test(words[i + 1])) { out.minutes = parseInt(w, 10); i++; continue; }
    if (w[0] === '@' && WHEN.includes(wl.slice(1))) { out.when = wl.slice(1); continue; }
    if (w[0] === '#') {
      const idx = lower.indexOf(wl.slice(1));
      if (idx >= 0) { out.area = areaNames[idx]; continue; }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
      const [y, mo, d] = w.split('-').map(Number);
      if (isRealDate(y, mo, d)) { out.date = w; out.kind = 'event'; continue; }
      keep.push(w); continue; // an impossible date is left in the name
    }
    /* A bare time reads as the time whether or not a date has shown up
       yet — "Dinner tomorrow 19:00" and "Call Mom 19:00" both mean it. */
    if (/^\d{1,2}:\d{2}$/.test(w)) { out.time = w.length === 4 ? '0' + w : w; continue; }
    if (wl === 'by' && words[i + 1] && /^\d{4}-\d{2}(-\d{2})?$/.test(words[i + 1])) { out.horizon = words[i + 1]; out.kind = 'goal'; i++; continue; }
    if (wl === 'tomorrow' || wl === 'today') { out.relative = wl; out.kind = 'event'; continue; }
    keep.push(w);
  }
  out.name = keep.join(' ').trim();
  return out;
}

module.exports = { parseQuickAdd };
