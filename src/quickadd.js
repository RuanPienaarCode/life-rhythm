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

function parseQuickAdd(text, areas) {
  const out = {};
  const areaNames = (areas || []).map(a => a.name);
  const lower = areaNames.map(a => a.toLowerCase());
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const keep = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wl = w.toLowerCase();
    if (CADENCE.test(w)) { out.cadence = wl; continue; }
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
    if (/^\d{4}-\d{2}-\d{2}$/.test(w)) { out.date = w; out.kind = 'event'; continue; }
    if (/^\d{1,2}:\d{2}$/.test(w) && out.date) { out.time = w.length === 4 ? '0' + w : w; continue; }
    if (wl === 'by' && words[i + 1] && /^\d{4}-\d{2}(-\d{2})?$/.test(words[i + 1])) { out.horizon = words[i + 1]; out.kind = 'goal'; i++; continue; }
    if (wl === 'tomorrow' || wl === 'today') { out.relative = wl; out.kind = 'event'; continue; }
    keep.push(w);
  }
  out.name = keep.join(' ').trim();
  return out;
}

module.exports = { parseQuickAdd };
