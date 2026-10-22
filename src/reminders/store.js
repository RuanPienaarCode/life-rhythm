'use strict';
/* Vault IO. Every read and write of the reminders note goes through here.

   THE NOTE BELONGS TO THE USER. Two rules follow from that, and both are
   pinned by tests:

   1. Line surgery, never a rebuild. We edit the one line we mean to edit and
      leave every other byte — prose, headings, other plugins' tasks, blank
      lines — exactly where it was.
   2. Ticking, snoozing and rolling a repeat REWRITE THE RAW LINE rather than
      re-serialising it, so the user's own spacing and token order survive
      being touched by this plugin. Only an explicit edit re-spells a line.

   Vault API only: this runs on iOS as well as the desktop. Every change is
   made inside vault.process, one at a time, so nothing typed elsewhere in
   the meantime is lost. */

const { normalizePath } = require('obsidian');
const T = require('./tasks');
const D = require('./dates');
const R = require('./recur');
const { buildICS, countEvents } = require('./ics');

const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Where an ungrouped reminder goes once the note has sections of its own. */
const INBOX = 'Inbox';
const DATE = '\\d{4}-\\d{2}-\\d{2}';
const squash = s => String(s || '').replace(/\s+/g, ' ').trim();

/* ---- raw-line surgery ------------------------------------------------ */

/* Surgery happens on a MASKED line: `code spans` and [[wikilinks]] are
   swapped for placeholders first, so a 📅 quoted inside one is never the
   token we edit. A trailing ^block-id is held aside and put back last. */
function surgery(raw, fn) {
  const [line, block] = T.splitBlock(raw);
  const { masked, restore } = T.maskSpans(line);
  return restore(fn(masked)) + block;
}

function flipBox(raw, done) {
  return String(raw).replace(/^(\s*(?:[-*+]|\d+\.)[ \t]+\[)[ xX](\])/, `$1${done ? 'x' : ' '}$2`);
}

/* The markers that mean the same field. The parser reads all of them. */
const FAMILY = {
  '📅': '(?:📅|📆|🗓)\\uFE0F?',
  '⏳': '(?:⏳|⌛)\\uFE0F?',
};
const markerRe = emoji => FAMILY[emoji] || `${reEsc(emoji)}\\uFE0F?`;
/* The dates another plugin may move, by the names parseLine gives them. */
const FIELD_EMOJI = { due: '📅', scheduled: '⏳', start: '🛫' };

/* Both date writers finish with liftTime: a date appended to a line ending
   in ⏰ would otherwise put ⏰ inside the Tasks field run, and a line already
   in the old order gets repaired while we are touching it anyway. */
function dropToken(raw, emoji) {
  return liftTime(surgery(raw, s => s.replace(new RegExp(`\\s*${markerRe(emoji)}\\s*${DATE}`, 'g'), '').replace(/[ \t]+$/, '')));
}

/* Change a date token in place. It is the LAST one on the line that we
   change, because that is the one the parser reads — rewriting an earlier
   stray would make snooze look like it did nothing. */
function setDateToken(raw, emoji, value) {
  return liftTime(surgery(raw, s => {
    const re = new RegExp(`(${markerRe(emoji)}\\s*)${DATE}`, 'g');
    let last = null;
    for (let m = re.exec(s); m; m = re.exec(s)) last = m;
    if (last) return s.slice(0, last.index) + last[1] + value + s.slice(last.index + last[0].length);
    return `${s.replace(/[ \t]+$/, '')} ${emoji} ${value}`;
  }));
}

/* Every dated field, whatever its emoji: due, scheduled, start, done, created. */
const DATE_FIELD = new RegExp(`\\s*(?:📅|📆|🗓|⏳|⌛|🛫|✅|➕)\\uFE0F?\\s*${DATE}`, 'g');

/* A line with its dates taken out and its spacing collapsed: what is left is
   the reminder itself. Two lines with the same remainder are the same
   reminder moved in time; any other difference (a clock time, a tag, a
   priority, a repeat rule) makes them different reminders. */
function withoutDates(raw) {
  return squash(surgery(raw, s => s.replace(DATE_FIELD, '')));
}

const TIME_TOKEN = /⏰\uFE0F?[ \t]*(\d{1,2}:\d{2})/g;

/* Tasks reads fields from the END of the line and stops at the first thing
   that isn't one, so a ⏰ inside that trailing run (Nudge's first line
   order put it after 📅) hides every field before it from Tasks. Move just
   the ⏰ token to where the run begins. Surgery, not a re-spelling: nothing
   else moves, the ^block-id stays last, and a ⏰ inside a code span or a
   wikilink is not ours to touch. A line that is fine comes back identical. */
function liftTime(raw) {
  const s = String(raw);
  const cr = /\r$/.test(s) ? '\r' : '';
  const src = cr ? s.slice(0, -1) : s;
  const m = T.LINE_RE.exec(src);
  if (!m) return s;
  const body = m[4];
  const head = src.slice(0, src.length - body.length);
  const [line, block] = T.splitBlock(body);
  const { masked, restore } = T.maskSpans(line);
  let tm = null;
  for (let x = TIME_TOKEN.exec(masked); x; x = TIME_TOKEN.exec(masked)) tm = x;
  TIME_TOKEN.lastIndex = 0;
  if (!tm) return s;
  const left = masked.slice(0, tm.index).replace(/[ \t]+$/, '');
  const right = masked.slice(tm.index + tm[0].length).replace(/^[ \t]+/, '');
  const without = left && right ? `${left} ${right}` : left + right;
  let at = T.trailingRunStart(without);
  /* Tags leading the run can stay where the user put them — Tasks reads a
     tag anywhere — so ⏰ lands just before the first real field. */
  for (let g = /^#[^\s#]+\s+/.exec(without.slice(at)); g; g = /^#[^\s#]+\s+/.exec(without.slice(at))) at += g[0].length;
  const was = left && right ? left.length + 1 : left.length;
  if (was <= at) return s;
  const before = without.slice(0, at).replace(/[ \t]+$/, '');
  const lifted = `${before ? before + ' ' : ''}⏰ ${tm[1]} ${without.slice(at)}`.replace(/[ \t]+$/, '');
  return `${head}${restore(lifted)}${block}${cr}`;
}

/* The note's own line ending. A note saved on Windows is CRLF throughout;
   we keep it that way rather than half-converting it. A note with both (a
   paste, a sync between machines) is read line by line whatever each line
   ends with, and written back in whichever ending most of it already uses. */
function splitLines(text) {
  const t = String(text || '');
  const crlf = (t.match(/\r\n/g) || []).length;
  const lf = (t.match(/\n/g) || []).length - crlf;
  return { lines: t.split(/\r?\n/), eol: crlf > lf ? '\r\n' : '\n' };
}

/* The ## heading a line sits under ('' above the first one). Headings inside
   a fenced code block are not headings. `fenced` may be passed in by a
   caller that asks more than once. */
function groupAt(lines, i, fenced) {
  const code = fenced || T.fencedLines(lines);
  for (let n = i - 1; n >= 0; n--) {
    if (code[n] || !T.HEADING_RE.test(lines[n])) continue;
    const g = T.GROUP_RE.exec(lines[n]);
    return g ? g[1].trim() : '';
  }
  return '';
}

/* Put a line under a heading, after its last real line — not into the next
   section, and not on top of the blank line that separates them. A heading
   that doesn't exist yet is made at the foot of the note. No group at all:
   an Inbox once the note has sections, the foot of a flat note otherwise.
   A list is a ## heading or below — a "# Title" of the same name is not one
   (the parser would read the line back as ungrouped) — and neither is
   anything inside a fenced code block. */
function placeLine(lines, groupName, line) {
  let group = squash(groupName);
  if (!group && T.groupsOf(lines.join('\n')).length) group = INBOX;
  if (group) {
    const code = T.fencedLines(lines);
    /* "groceries" goes under "## Groceries", as addList treats them as one
       list — but a note that really has both spellings keeps them apart. */
    const headingAt = same => lines.findIndex((l, n) => {
      const h = code[n] ? null : T.GROUP_RE.exec(l);
      return !!h && same(h[1].trim());
    });
    let at = headingAt(name => name === group);
    if (at === -1) at = headingAt(name => name.toLowerCase() === group.toLowerCase());
    if (at !== -1) {
      let end = at + 1;
      let last = at;
      /* A section runs to the next heading of ANY level: a "# Title" below
         ends it, as far as the parser is concerned. */
      while (end < lines.length && (code[end] || !T.HEADING_RE.test(lines[end]))) {
        if (lines[end].trim()) last = end;
        end++;
      }
      lines.splice(last + 1, 0, line);
      return;
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('', `## ${group}`, line, '');
    return;
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  lines.push(line, '');
}

/* ---- the store -------------------------------------------------------- */

function makeStore(plugin) {
  const app = plugin.app;
  const v = app.vault;

  const path = () => normalizePath(plugin.settings.file || 'Reminders.md');
  const icsPath = () => normalizePath(plugin.settings.icsFile || 'Reminders.ics');
  const stamp = () => { plugin._lastWrite = Date.now(); };
  const file = () => v.getFileByPath(path());

  async function readText() {
    const f = file();
    if (!f) return { file: null, text: '' };
    return { file: f, text: await v.read(f) };
  }

  /* The last text we wrote, so the vault's modify event for our own write
     can be told apart from an edit made by hand or by sync. */
  const remember = text => { plugin._lastText = text; };

  async function writeText(text) {
    stamp();
    remember(text);
    const f = file();
    if (f) { await v.modify(f, text); return f; }
    await ensureFolder(path());
    return v.create(path(), text);
  }

  async function ensureFolder(p) {
    const slash = String(p).lastIndexOf('/');
    if (slash <= 0) return;
    const dir = p.slice(0, slash);
    if (v.getFolderByPath(dir)) return;
    try { stamp(); await v.createFolder(dir); }
    catch (e) { if (!v.getFolderByPath(dir)) throw e; }
  }

  async function ensureFile() {
    if (file()) return file();
    return writeText(`# ${plugin.settings.title || 'Reminders'}\n\nThe things I must not forget.\n\n`);
  }

  async function load() {
    const { text } = await readText();
    const items = T.parseNote(text);
    return { text, items, groups: T.groupsOf(text), lists: T.listsOf(text) };
  }

  /* EVERY change to the note goes through here. vault.process reads, changes
     and writes in one step, so an edit that lands from sync, from Vista or
     by hand between our read and our write is not overwritten. `fn` gets
     the lines and changes them in place; returning { ok: false } leaves
     the file exactly as it was. */
  async function edit(fn) {
    const f = file();
    if (!f) return { ok: false };
    let out = { ok: false };
    const apply = text => {
      const { lines, eol } = splitLines(text);
      out = Object.assign({ ok: true }, fn(lines) || {});
      if (!out.ok) return text;
      const next = lines.join(eol);
      if (next !== text) { stamp(); remember(next); }
      return next;
    };
    if (typeof v.process === 'function') await v.process(f, apply);
    else {
      const text = await v.read(f);
      const next = apply(text);
      if (next !== text) await v.modify(f, next);
    }
    return out;
  }

  /* Find the line again when its number no longer matches — the user may
     have typed above it since we rendered. An identical line can sit in two
     lists ("Take pills" under Home and under Work), so a match must be in
     the reminder's own list, and the nearest one to where it was.

     Returns { at, fallback }. `fallback` is true when the line was found by
     its words rather than its exact text — a looser match, which a caller
     doing something that cannot be undone has to be careful with. */
  function locate(lines, item) {
    const none = { at: -1, fallback: false };
    if (!item || typeof item.raw !== 'string') return none;
    const code = T.fencedLines(lines);
    if (!code[item.line] && lines[item.line] === item.raw) return { at: item.line, fallback: false };
    const inGroup = n => item.group === undefined || groupAt(lines, n, code) === (item.group || '');
    const nearest = cands => {
      const from = item.line >= 0 ? item.line : 0;
      return cands.reduce((best, n) => (best === -1 || Math.abs(n - from) < Math.abs(best - from) ? n : best), -1);
    };
    const exact = [];
    for (let n = 0; n < lines.length; n++) if (!code[n] && lines[n] === item.raw && inGroup(n)) exact.push(n);
    if (exact.length) return { at: nearest(exact), fallback: false };
    /* Last resort: the same reminder with different DATES (someone edited
       the date in the note while the board was open) — but only when there
       is exactly one such line, in the same list, in the same state. "The
       same reminder" means the lines are equal once their dates are taken
       out: a different clock time, tag, priority or repeat is a different
       reminder, and deleting or ticking it because its words match would be
       acting on the wrong one. */
    const t = T.parseLine(item.raw);
    if (!t) return none;
    const shape = withoutDates(item.raw);
    const same = [];
    for (let n = 0; n < lines.length; n++) {
      if (code[n]) continue;
      const c = T.parseLine(lines[n]);
      if (c && c.title === t.title && c.done === t.done && inGroup(n) && withoutDates(lines[n]) === shape) same.push(n);
    }
    return same.length === 1 ? { at: same[0], fallback: true } : none;
  }

  /* Every change to one reminder starts here. What comes in from outside
     (Vista and Fortnight call this store) has to be a reminder line we
     could have written: an item with no raw text, or one whose text is
     prose, matches nothing and changes nothing. */
  function withLines(item, fn) {
    if (!item || typeof item.raw !== 'string' || !T.parseLine(item.raw)) return Promise.resolve({ ok: false });
    return edit(lines => {
      const found = locate(lines, item);
      if (found.at === -1) return { ok: false };
      return fn(lines, found.at, found.fallback);
    });
  }

  /* ---- add ------------------------------------------------------------ */

  /* Resolves to the line written. With nothing to write (no fields, or an
     empty object) it writes nothing, makes no note, and resolves to
     { ok: false }. */
  async function add(fields) {
    if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) return { ok: false };
    const item = Object.assign({ priority: 'normal', tags: [] }, fields);
    const line = T.serializeLine(item);
    await ensureFile();
    /* A reminder with no group of its own must not fall under whatever
       heading happens to be last in the note — placeLine gives it an Inbox
       once the note uses sections at all. */
    await edit(lines => { placeLine(lines, fields.group, line); });
    return line;
  }

  /* A new list is a new ## heading at the foot of the note. Nothing else is
     touched; a name already there is not added twice. */
  async function addList(name) {
    let n = squash(name).replace(/^#+\s*/, '');
    if (!n) return { ok: false, name: '' };
    await ensureFile();
    let existed = false;
    await edit(lines => {
      /* "groceries" next to "## Groceries" is the same list: hand back the
         name the note already uses. */
      const have = T.listsOf(lines.join('\n')).find(l => l.toLowerCase() === n.toLowerCase());
      if (have !== undefined) { existed = true; n = have; return { ok: false }; }
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push('', `## ${n}`, '');
    });
    return { ok: true, name: n, existed };
  }

  /* ---- tick ------------------------------------------------------------ */

  /* Ticking a repeating reminder leaves the next one behind, in the place the
     old one held, and keeps the tick itself as a record. A repeat we can't
     work out the next date for is NOT ticked: ticking it would end the
     series silently, which is the one thing a reminder must never do. */
  async function toggle(item, today) {
    const day = D.isISO(today) ? today : D.todayISO();
    let rolled = null;
    const res = await withLines(item, (lines, i, fallback) => {
      const raw = lines[i];
      const cur = T.parseLine(raw);
      /* A repeat found only by its words is almost always the NEXT occurrence
         we just rolled (a double click hands us the old item twice), and
         ticking it would silently run the series a step ahead. Refuse; the
         board reloads and the user ticks what they can see. */
      if (fallback && cur && cur.repeat) return { ok: false, reason: 'stale' };
      const wasDone = cur ? cur.done : item.done;
      if (wasDone) {
        lines[i] = dropToken(flipBox(raw, false), '✅');
        return {};
      }
      let next = '';
      if (cur && cur.repeat) {
        /* No due date: the next one counts from today. */
        const from = cur.due || day;
        next = R.nextDue(cur.repeat, from, day, day);
        if (!next) return { ok: false, reason: 'repeat', repeat: cur.repeat };
      }
      const [plain, block] = T.splitBlock(raw);
      /* The ^block-id follows the reminder that is still open, so a link to
         it keeps pointing at something to do. */
      lines[i] = setDateToken(dropToken(flipBox(next ? plain : raw, true), '✅'), '✅', day);
      if (next) {
        const shift = D.diffDays(cur.due || day, next);
        let fresh = setDateToken(dropToken(plain, '✅'), '📅', next);
        /* Start and scheduled dates move with the due date, as Tasks does. */
        if (cur.start) fresh = setDateToken(fresh, '🛫', D.addDays(cur.start, shift));
        if (cur.scheduled) fresh = setDateToken(fresh, '⏳', D.addDays(cur.scheduled, shift));
        fresh += block;
        lines.splice(i, 0, fresh);
        rolled = T.parseLine(fresh);
      }
      return {};
    });
    return Object.assign({}, res, { rolled: res.ok ? rolled : null });
  }

  /* ---- edit ------------------------------------------------------------ */

  /* An edit re-spells the line — and when the list changed, moves it under
     its new heading. */
  async function update(item, fields) {
    return withLines(item, (lines, i) => {
      const cur = T.parseLine(lines[i]) || item;
      const next = Object.assign({}, cur, fields);
      const from = groupAt(lines, i);
      const to = fields && fields.group !== undefined ? squash(fields.group) : from;
      if (to === from) { lines[i] = T.serializeLine(next); return {}; }
      /* In its new list it starts at the top level: an indent kept from the
         old list would make it a subtask of whatever task happens to be last
         there. */
      next.indent = '';
      lines.splice(i, 1);
      placeLine(lines, to, T.serializeLine(next));
      return { moved: true };
    });
  }

  /* Snoozing counts from TODAY, not from a due date that has already passed:
     "tomorrow" must mean tomorrow, whatever this thing's history. */
  async function snooze(item, days, today) {
    /* A whole number of days, 1 or more. A numeric string counts; nothing
       else does — a missing or odd value must not write a date. */
    const n = typeof days === 'number' || typeof days === 'string' ? Number(days) : NaN;
    if (!Number.isInteger(n) || n < 1) return { ok: false };
    const day = D.isISO(today) ? today : D.todayISO();
    const due = D.addDays(day, n);
    return withLines(item, (lines, i) => {
      lines[i] = setDateToken(lines[i], '📅', due);
    });
  }

  /* Move one dated field and no other: a reminder whose only date is ⏳
     moves its ⏳, and does not gain a 📅 nobody set. `field` is 'due',
     'scheduled' or 'start'; `date` a real ISO date, or nothing to clear the
     field. Anything else is refused rather than written: a date whose value
     does not parse stops being a date. */
  async function setDate(item, field, date) {
    const emoji = Object.prototype.hasOwnProperty.call(FIELD_EMOJI, field) ? FIELD_EMOJI[field] : '';
    if (!emoji || (date && !D.isISO(date))) return { ok: false };
    return withLines(item, (lines, i) => {
      lines[i] = date ? setDateToken(lines[i], emoji, date) : dropToken(lines[i], emoji);
    });
  }

  const setDue = (item, due) => setDate(item, 'due', due);

  async function remove(item) {
    return withLines(item, (lines, i) => { lines.splice(i, 1); });
  }

  /* One pass over the note for lines written in the old order. Writes only
     when a line actually moved. */
  async function liftTimes() {
    let changed = 0;
    await edit(lines => {
      const code = T.fencedLines(lines);
      for (let i = 0; i < lines.length; i++) {
        if (code[i]) continue;
        const next = liftTime(lines[i]);
        if (next !== lines[i]) { lines[i] = next; changed++; }
      }
      return changed ? {} : { ok: false };
    });
    return { changed };
  }

  /* ---- the calendar file ----------------------------------------------- */

  async function exportICS(now) {
    const { items } = await load();
    const text = buildICS(items, {
      name: plugin.settings.calendarName || 'Nudge',
      alarmMinutes: plugin.settings.alarmMinutes,
      allDayAlarmTime: plugin.settings.allDayAlarmTime,
      now,
    });
    const p = icsPath();
    await ensureFolder(p);
    stamp();
    const f = v.getFileByPath(p);
    if (f) await v.modify(f, text);
    else await v.create(p, text);
    return { path: p, count: countEvents(items) };
  }

  const isOurs = p => typeof p === 'string' && (p === path() || p === icsPath());

  /* One change at a time. Two quick ticks (or a tick from the board and one
     from Vista) queue behind each other instead of racing. */
  let chain = Promise.resolve();
  const queued = fn => function () {
    const args = arguments;
    const run = chain.then(() => fn.apply(null, args));
    chain = run.catch(() => {});
    return run;
  };

  return {
    path, icsPath, load, isOurs,
    ensureFile: queued(ensureFile), add: queued(add), addList: queued(addList),
    toggle: queued(toggle), update: queued(update), snooze: queued(snooze),
    setDue: queued(setDue), setDate: queued(setDate), remove: queued(remove), liftTimes: queued(liftTimes),
    exportICS: queued(exportICS),
  };
}

module.exports = { makeStore, flipBox, dropToken, setDateToken, liftTime, splitLines };
