'use strict';
/* Ask AI: the changes an answer may suggest. The AI never writes — an answer
   can end with a ```rhythm-actions block, and each entry that passes
   validate() becomes a button the person taps to confirm. The button runs
   the same write Rhythm's own pages make (src/app.js runAiAction), so it is
   refused the same way when a line changed. Nothing here deletes, and there
   is no kind that could. Pure: no DOM. */

const D = require('../dates');

const MAX_ACTIONS = 5;
const KINDS = ['add_reminder', 'tick_habit', 'skip_habit', 'move_todo', 'note'];
const BLOCK = /```rhythm-actions[^\n]*\n([\s\S]*?)(?:```|$)/;

/* A real day, not just its shape (D.isISO only checks the shape). */
function realISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

function clock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

const line = s => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
/* The Tasks plugin's field markers: a title carrying one would grow a date,
   a repeat or a priority nobody confirmed. */
const TASK_FIELDS = /[📅📆🗓⏳⌛🛫➕✅❌🔁⏰🏁🆔⛔⏫🔼🔽🔺⏬]/u;

/* → the action, tidied, or null. */
function validate(a, today) {
  if (!a || typeof a !== 'object' || !KINDS.includes(a.kind)) return null;
  if (a.kind === 'add_reminder') {
    const title = line(a.title);
    if (!title || title.length > 200 || TASK_FIELDS.test(title)) return null;
    const out = { kind: a.kind, title };
    if (a.due !== undefined && a.due !== null && a.due !== '') {
      if (!realISO(a.due)) return null;
      out.due = a.due;
    }
    if (a.time !== undefined && a.time !== null && a.time !== '') {
      const t = clock(a.time);
      if (!t || !out.due) return null;
      out.time = t;
    }
    return out;
  }
  if (a.kind === 'tick_habit' || a.kind === 'skip_habit') {
    const name = line(a.name);
    const date = a.date === undefined || a.date === null || a.date === '' ? today : a.date;
    if (!name || !realISO(date) || date > today) return null;
    return { kind: a.kind, name, date };
  }
  if (a.kind === 'move_todo') {
    const text = line(a.text);
    if (!text || !realISO(a.date)) return null;
    return { kind: a.kind, text, date: a.date };
  }
  const text = typeof a.text === 'string' ? a.text.trim() : '';
  const date = a.date === undefined || a.date === null || a.date === '' ? today : a.date;
  if (!text || text.length > 4000 || !realISO(date)) return null;
  return { kind: 'note', text, date };
}

/* → { text: the answer without the block, actions: [valid…] } */
function splitReply(reply, today) {
  const raw = String(reply || '');
  const m = BLOCK.exec(raw);
  if (!m) return { text: raw.trim(), actions: [] };
  const text = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim();
  let list = [];
  try {
    const parsed = JSON.parse(m[1]);
    list = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) { list = []; }
  const actions = [];
  for (const a of list) {
    const v = validate(a, today);
    if (v) actions.push(v);
    if (actions.length === MAX_ACTIONS) break;
  }
  return { text, actions };
}

/* The button's words. */
function label(a, today) {
  const when = iso => D.relative(iso, today);
  if (a.kind === 'add_reminder') return `Add reminder: ${a.title}${a.due ? ` · ${when(a.due)}${a.time ? ' ' + a.time : ''}` : ''}`;
  if (a.kind === 'tick_habit') return `Tick ${a.name}${a.date !== today ? ` · ${when(a.date)}` : ''}`;
  if (a.kind === 'skip_habit') return a.date === today ? `Not today: ${a.name}` : `Skip ${a.name} · ${when(a.date)}`;
  if (a.kind === 'move_todo') return `Move "${a.text}" to ${when(a.date)}`;
  return a.date === today ? "Add to today's note" : `Add to the note for ${when(a.date)}`;
}

const fold = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/* The habit an action names, by its name as shown. */
function findHabit(name, practices) {
  const k = fold(name);
  const p = (practices || []).find(x => fold(x.name) === k);
  return p ? { ok: true, practice: p } : { ok: false, reason: 'not-found' };
}

/* The to-do or reminder an action names. Two with the same words: refuse
   rather than guess which one was meant. */
function findCard(text, cards) {
  const k = fold(text);
  const hits = (cards || []).filter(c => c && fold(c.text) === k);
  if (hits.length === 1) return { ok: true, card: hits[0] };
  return { ok: false, reason: hits.length ? 'ambiguous' : 'not-found' };
}

module.exports = { splitReply, validate, label, findHabit, findCard, KINDS, MAX_ACTIONS, realISO };
