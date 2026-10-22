'use strict';
/* Vault IO — every read and write of the Rhythm folder goes through here.
   Vault API only (desktop and iOS). Writes stamp plugin._lastWrite so the
   view's vault watcher can tell our own writes from the user's edits.

   Note BODIES are never rebuilt: the plugin patches frontmatter keys and
   APPENDS to bodies (weekly review, completed goal steps); it never
   rewrites what the user typed. */

const { normalizePath } = require('obsidian');
const { parseFrontmatter, buildNote, patchFrontmatter, captureKeys, detectEOL, safeName } = require('./markdown');
const { FOLDERS } = require('./constants');
const { SEED_AREAS, SEED_PRACTICES, SEED_GOALS, SEED_EVENTS } = require('./seed');
const D = require('./dates');

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
const list = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
const listEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/* A real calendar date in YYYY-MM-DD form (D.isISO checks the shape only,
   and 2026-13-45 has the shape). */
const realISO = s => typeof s === 'string' && D.isISO(s) && D.toISO(D.fromISO(s)) === s;
const FLAG_KEYS = ['done', 'skip', 'snooze', 'plan'];

/* The area a note names, however it was typed: `Faith`, `[[Faith]]`,
   `[[Faith|alias]]` or `[[Some/Folder/Faith]]` all come back as `Faith` —
   the area note's basename, which is what every other record is matched
   against. The note on disk is never touched by this. */
const WIKI = /^\[\[([^\]|]*)(\|[^\]]*)?\]\]$/;
function areaName(v) {
  if (Array.isArray(v)) v = v[0];
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  const m = WIKI.exec(s);
  if (!m) return s;
  const target = m[1].trim();
  return target.slice(target.lastIndexOf('/') + 1).trim();
}

/* Append a block to note text, in the note's own line endings. */
function appendText(text, block) {
  const eol = detectEOL(text);
  const sep = text.endsWith('\n') ? eol : eol + eol;
  return text + sep + block.replace(/\s+$/, '').replace(/\r?\n/g, eol) + eol;
}

function makeStore(plugin) {
  const app = plugin.app;
  const v = app.vault;
  const root = () => normalizePath(plugin.settings.folder || 'Rhythm');
  const dir = key => `${root()}/${FOLDERS[key]}`;
  const stamp = () => { plugin._lastWrite = Date.now(); };

  const baseName = f => (f.basename !== undefined ? f.basename : String(f.name || '').replace(/\.md$/, ''));

  function mdFiles(path) {
    const folder = v.getFolderByPath(path);
    if (!folder || !folder.children) return [];
    return folder.children.filter(c => c.extension === 'md' || /\.md$/.test(c.name || ''))
      .sort((a, b) => baseName(a).localeCompare(baseName(b)));
  }

  async function readAll(path) {
    const out = [];
    for (const f of mdFiles(path)) {
      let text = '';
      try { text = await v.cachedRead(f); } catch (e) { console.error('rhythm read', f.path, e); continue; }
      const { fm, body } = parseFrontmatter(text);
      out.push({ file: f, name: baseName(f), path: f.path, fm, body });
    }
    return out;
  }

  const firstLine = body => (body || '').split(/\r?\n/).map(s => s.trim()).find(s => s && !/^#/.test(s)) || '';

  async function load() {
    const areas = (await readAll(dir('areas'))).map(r => ({
      name: r.name, order: num(r.fm.order), note: firstLine(r.body), path: r.path,
    }));
    /* `aside` practices are kept, not hidden: they come back as their own
       list so the Areas page can show them and offer them back. Everything
       else in the plugin reads `practices` and so never sees them.
       `paused` is the older spelling of the same thing. */
    const allPractices = (await readAll(dir('practices'))).map(r => {
      /* The day a practice was started, for missedRun/practiceStart in
         model.js — a brand-new practice must not open with a borrowed
         "missed N days" streak. It comes ONLY from the note's own
         `created: YYYY-MM-DD` (file ctime is the day a sync copied the note,
         not the day it began). A note without one gets none, and the model
         falls back to the practice's first appearance in the log. */
      const c = r.fm.created === undefined ? '' : String(r.fm.created).trim();
      const created = realISO(c) ? c : undefined;
      return {
        name: r.name, area: areaName(r.fm.area), cadence: r.fm.cadence || 'daily', days: r.fm.days,
        minutes: num(r.fm.minutes), when: r.fm.when || '', time: r.fm.time ? String(r.fm.time) : '',
        note: firstLine(r.body), path: r.path,
        aside: r.fm.status === 'aside' || r.fm.status === 'paused',
        ...(created ? { created } : {}),
      };
    });
    const practices = allPractices.filter(p => !p.aside);
    const aside = allPractices.filter(p => p.aside);
    const goals = (await readAll(dir('goals'))).map(r => ({
      name: r.name, area: areaName(r.fm.area), horizon: r.fm.horizon || '', status: r.fm.status || 'active',
      next: r.fm.next || '', note: firstLine(r.body), path: r.path,
    }));
    const events = (await readAll(dir('events'))).map(r => ({
      name: r.name, area: areaName(r.fm.area), date: String(r.fm.date || ''), time: r.fm.time ? String(r.fm.time) : '',
      note: firstLine(r.body), path: r.path,
    }));
    const log = new Map();
    for (const r of await readAll(dir('log'))) {
      if (!D.isISO(r.name)) continue;
      log.set(r.name, {
        done: new Set(list(r.fm.done)),
        skip: new Set(list(r.fm.skip)),
        snooze: new Set(list(r.fm.snooze)),
        plan: new Set(list(r.fm.plan)),
        note: firstLine(r.body),
        body: r.body,
      });
    }
    return { areas, practices, aside, goals, events, log };
  }

  /* ---- writes ------------------------------------------------------ */

  async function ensureFolder(path) {
    if (v.getFolderByPath(path)) return;
    try { stamp(); await v.createFolder(path); }
    catch (e) { if (!v.getFolderByPath(path)) throw e; }
  }

  async function ensureTree() {
    await ensureFolder(root());
    for (const k of Object.keys(FOLDERS)) await ensureFolder(dir(k));
  }

  function existsCaseFolded(path) {
    if (v.getFileByPath(path)) return true;
    const slash = path.lastIndexOf('/');
    const folder = slash > 0 ? v.getFolderByPath(path.slice(0, slash)) : null;
    return !!(folder && (folder.children || []).some(c => (c.path || '').toLowerCase() === path.toLowerCase()));
  }

  async function writeIfAbsent(path, content) {
    if (existsCaseFolded(path)) return false;
    stamp();
    await v.create(path, content);
    return true;
  }

  const notePath = (key, name) => `${dir(key)}/${safeName(name)}.md`;

  async function createArea(a) {
    await ensureTree();
    return writeIfAbsent(notePath('areas', a.name), buildNote({ rhythm: 'area', order: a.order }, a.body || ''));
  }
  async function createPractice(p) {
    await ensureTree();
    const fm = { rhythm: 'practice', area: p.area, cadence: p.cadence || 'daily' };
    if (p.days && p.days.length) fm.days = p.days;
    if (p.when) fm.when = p.when;
    if (p.time) fm.time = p.time;
    if (p.minutes) fm.minutes = p.minutes;
    fm.created = realISO(p.created) ? p.created : D.toISO(new Date());
    return writeIfAbsent(notePath('practices', p.name), buildNote(fm, p.body || ''));
  }
  async function createGoal(g) {
    await ensureTree();
    const fm = { rhythm: 'goal', area: g.area, status: g.status || 'active' };
    if (g.horizon) fm.horizon = g.horizon;
    if (g.next) fm.next = g.next;
    return writeIfAbsent(notePath('goals', g.name), buildNote(fm, g.body || ''));
  }
  async function createEvent(e) {
    await ensureTree();
    const fm = { rhythm: 'event', area: e.area, date: e.date };
    if (e.time) fm.time = e.time;
    return writeIfAbsent(notePath('events', e.name), buildNote(fm, e.body || ''));
  }

  /* Every read-modify-write of an EXISTING note goes through vault.process:
     it is atomic on the host (queued per file since Obsidian 1.1), so two
     quick writes to the same note can no longer clobber one another. */
  async function patch(path, fields) {
    const f = v.getFileByPath(path);
    if (!f) return false;
    stamp();
    await v.process(f, text => patchFrontmatter(text, fields));
    return true;
  }

  /* Rewrite oldName -> newName in the done/skip/snooze/plan lists of every
     Log note that mentions it (a renamed PRACTICE must not orphan its own
     history). The rewrite is computed INSIDE vault.process from the text it
     is handed — never from an earlier read — so a tick that lands while the
     rename is in flight is kept, not overwritten. Lists are read with the
     same `list()` that `load` uses, so the single-value form `done: Read`
     is rewritten too. Returns the count of notes touched. */
  async function renamePracticeRefs(oldName, newName) {
    const rewrite = text => {
      const { fm } = parseFrontmatter(text);
      const fields = {};
      for (const k of FLAG_KEYS) {
        const arr = list(fm[k]);
        if (!arr.includes(oldName)) continue;
        const out = [];
        for (const n of arr) {
          const m = n === oldName ? newName : n;
          if (!out.includes(m)) out.push(m);
        }
        fields[k] = out;
      }
      return Object.keys(fields).length ? fields : null;
    };
    let touched = 0;
    for (const f of mdFiles(dir('log'))) {
      let text;
      try { text = await v.cachedRead(f); } catch (e) { continue; }
      if (!rewrite(text)) continue;
      stamp();
      await v.process(f, t => {
        const fields = rewrite(t);
        if (!fields) return t;
        touched++;
        return patchFrontmatter(t, fields);
      });
    }
    return touched;
  }

  /* An `area:` value that points at oldName, in whichever form it was
     written — bare, `[[Old]]`, `[[Old|alias]]`, `[[Folder/Old]]` — as the
     same form pointing at newName; null when it points elsewhere. */
  function retargetArea(value, oldName, newName) {
    if (Array.isArray(value)) return null;
    const s = String(value === undefined || value === null ? '' : value).trim();
    if (s === oldName) return newName;
    const m = WIKI.exec(s);
    if (!m) return null;
    const target = m[1].trim();
    const slash = target.lastIndexOf('/');
    if (target.slice(slash + 1).trim() !== oldName) return null;
    return `[[${target.slice(0, slash + 1)}${newName}${m[2] || ''}]]`;
  }

  /* Rewrite oldName -> newName wherever an AREA is referenced: `area:`
     (bare, or as the wikilink form Obsidian's own UI can write) in every
     Practice, Goal and Event note. Goals hold no practice-name reference
     anywhere (checked: `next` is free text, not a name), so a practice
     rename never needs to touch Goals. Computed inside vault.process like
     the log rewrite. Returns the count of notes touched. */
  async function renameAreaRefs(oldName, newName) {
    let touched = 0;
    for (const key of ['practices', 'goals', 'events']) {
      for (const f of mdFiles(dir(key))) {
        let text;
        try { text = await v.cachedRead(f); } catch (e) { continue; }
        if (retargetArea(parseFrontmatter(text).fm.area, oldName, newName) === null) continue;
        stamp();
        await v.process(f, t => {
          const next = retargetArea(parseFrontmatter(t).fm.area, oldName, newName);
          if (next === null) return t;
          touched++;
          return patchFrontmatter(t, { area: next });
        });
      }
    }
    return touched;
  }

  /* Rename a note in place (links elsewhere in the vault follow when the
     host offers fileManager.renameFile), then rewrite every reference to
     its old name (practice: log history; area: area: fields). A practice's
     or area's NAME is its file's basename, so what gets written is the name
     the file really ends up with — safeName(newName) — not the raw text the
     user typed (`C# practice` becomes `C- practice` on disk, and the log
     must say so too). Resolves to { path, touched } on success, null when
     the target name is taken. */
  async function rename(path, newName) {
    const f = v.getFileByPath(path);
    if (!f) return null;
    const slash = path.lastIndexOf('/');
    const finalName = safeName(newName);
    const newPath = `${path.slice(0, slash)}/${finalName}.md`;
    if (newPath === path) return { path, touched: 0 };
    if (existsCaseFolded(newPath) && newPath.toLowerCase() !== path.toLowerCase()) return null;
    const oldName = baseName(f);
    let kind;
    try { kind = parseFrontmatter(await v.cachedRead(f)).fm.rhythm; } catch (e) { kind = undefined; }
    stamp();
    if (app.fileManager && app.fileManager.renameFile) await app.fileManager.renameFile(f, newPath);
    else await v.rename(f, newPath);
    let touched = 0;
    if (kind === 'practice') touched = await renamePracticeRefs(oldName, finalName);
    else if (kind === 'area') touched = await renameAreaRefs(oldName, finalName);
    return { path: newPath, touched };
  }

  /* Append a block to a note body without touching anything above it. */
  async function appendBody(path, block) {
    const f = v.getFileByPath(path);
    if (!f) return false;
    stamp();
    await v.process(f, text => appendText(text, block));
    return true;
  }

  /* ---- the day's log ---------------------------------------------- */

  const logPath = date => `${dir('log')}/${date}.md`;

  /* Run fn(text) -> newText against an EXISTING or NOT-YET-EXISTING log
     note, atomically. An existing note goes straight through vault.process
     (host-queued per file since Obsidian 1.1). A note that doesn't exist
     yet is the harder case: two quick taps on an empty day must not both
     try to create it — so creation attempts for the same path are chained
     on a promise queue, and if a create still loses the race (`exists`,
     e.g. a write from outside this queue), we fall back to process on the
     file that won. */
  const createQueue = new Map();
  async function processLog(date, fn) {
    const path = logPath(date);
    const existing = v.getFileByPath(path);
    if (existing) { stamp(); await v.process(existing, fn); return; }
    const prevTurn = createQueue.get(path) || Promise.resolve();
    const myTurn = prevTurn.then(async () => {
      await ensureTree();
      const f2 = v.getFileByPath(path);
      if (f2) { stamp(); await v.process(f2, fn); return; }
      const content = fn(buildNote({ rhythm: 'log', done: [] }, ''));
      stamp();
      try {
        await v.create(path, content);
      } catch (e) {
        const f3 = v.getFileByPath(path);
        if (!f3) throw e;
        await v.process(f3, fn);
      }
    });
    createQueue.set(path, myTurn.catch(() => {}));
    await myTurn;
  }

  const readLists = fm => ({ done: list(fm.done), skip: list(fm.skip), snooze: list(fm.snooze), plan: list(fm.plan) });

  /* Only the lists that CHANGED become patch fields — an untouched list
     keeps its exact source lines. An emptied skip/snooze/plan drops its key;
     `done` stays as `[]` (unless it was never there to begin with). */
  function changedFields(orig, cur, doneWasAbsent) {
    const fields = {};
    for (const k of FLAG_KEYS) {
      if (listEq(orig[k], cur[k])) continue;
      fields[k] = cur[k].length ? cur[k] : (k === 'done' && !doneWasAbsent ? [] : undefined);
    }
    return fields;
  }

  /* Set one flag (done | skip | snooze | plan) for a practice on a day.
     A tick clears skip, snooze and the day's plan (the promise is kept);
     a skip clears done; a plan clears skip and snooze. Resolves to
     { prev } — what this name held BEFORE the change, so a caller can undo
     it exactly with restoreFlags. `prev` is opaque to callers: the four
     booleans { done, skip, snooze, plan }, plus `idx` (where the name sat
     in each list, -1 when absent) and `snap` (where each flag key sat in
     the note and its exact source lines), which is what makes the undo
     byte-exact. */
  async function setFlag(date, key, name, on) {
    let prev;
    await processLog(date, text => {
      const { fm } = parseFrontmatter(text);
      const orig = readLists(fm);
      const cur = {};
      for (const k of FLAG_KEYS) cur[k] = orig[k].slice();
      prev = { idx: {}, snap: captureKeys(text, FLAG_KEYS, list) };
      for (const k of FLAG_KEYS) { prev[k] = orig[k].includes(name); prev.idx[k] = orig[k].indexOf(name); }
      const toggle = (arr, add) => (add ? (arr.includes(name) ? arr : [...arr, name]) : arr.filter(n => n !== name));
      cur[key] = toggle(cur[key], on);
      if (key === 'done' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); cur.plan = toggle(cur.plan, false); }
      if (key === 'skip' && on) { cur.done = toggle(cur.done, false); cur.plan = toggle(cur.plan, false); }
      if (key === 'plan' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); }
      return patchFrontmatter(text, changedFields(orig, cur, prev.snap.done === null));
    });
    return { prev };
  }

  /* Put a name's four flags back exactly as `prev` describes — the actual
     undo of a setFlag change (a plain setDone(false) is not enough: it
     only clears done, not whatever setFlag's own side-effects cleared
     alongside it, e.g. a plan a tick swallowed). The name goes back at its
     old index in each list, and a key that was dropped because its list
     emptied goes back at its old place in the frontmatter, so the note
     returns to the bytes it had. A `prev` without idx/snap (booleans only)
     still works: names are appended. */
  async function restoreFlags(date, name, prev) {
    await processLog(date, text => {
      const { fm } = parseFrontmatter(text);
      const orig = readLists(fm);
      const cur = {};
      for (const k of FLAG_KEYS) cur[k] = orig[k].slice();
      for (const k of FLAG_KEYS) {
        const want = !!(prev && prev[k]);
        const has = cur[k].includes(name);
        if (want && !has) {
          const i = prev.idx && Number.isInteger(prev.idx[k]) && prev.idx[k] >= 0 ? Math.min(prev.idx[k], cur[k].length) : cur[k].length;
          cur[k].splice(i, 0, name);
        } else if (!want && has) cur[k] = cur[k].filter(n => n !== name);
      }
      const snap = prev && prev.snap;
      const restore = {};
      if (snap) for (const k of FLAG_KEYS) if (snap[k]) restore[k] = snap[k];
      const fields = changedFields(orig, cur, !!snap && snap.done === null);
      /* A list that was an empty key line (`skip:`) goes back to that line,
         not to no key at all. */
      for (const k of FLAG_KEYS) if (k in fields && fields[k] === undefined && restore[k] && restore[k].value.length === 0) fields[k] = [];
      return patchFrontmatter(text, fields, { restore });
    });
  }

  const setDone = (date, name, on) => setFlag(date, 'done', name, on);
  const setSkip = (date, name, on) => setFlag(date, 'skip', name, on);
  const setSnooze = (date, name, on) => setFlag(date, 'snooze', name, on);
  const setPlan = (date, name, on) => setFlag(date, 'plan', name, on);

  /* Move a promise between days — two writes, so a failure half way leaves
     the practice on ONE of the days rather than on neither. Resolves to
     { prev: { from, to } }: each day's `prev` as setFlag returns it (null
     for a side that was not written), so an undo is
     restoreFlags(from, name, prev.from) + restoreFlags(to, name, prev.to)
     — which also brings back any skip/snooze the plan cleared. */
  async function movePlan(name, from, to) {
    const prev = { from: null, to: null };
    if (from === to) return { prev };
    if (to) prev.to = (await setPlan(to, name, true)).prev;
    if (from) prev.from = (await setPlan(from, name, false)).prev;
    return { prev };
  }

  /* Make sure the day's note exists — through processLog, so it shares the
     create queue with every tick and journal save: opening today's note
     while the first tick of the day is being written neither throws
     "exists" nor loses either write. */
  async function ensureLogNote(date) {
    const path = logPath(date);
    if (existsCaseFolded(path)) return path;
    await processLog(date, t => t);
    return path;
  }

  async function appendLog(date, block) {
    await processLog(date, text => appendText(text, block));
    return true;
  }

  /* A goal's next step was done: record it in the body, set the new one. */
  async function completeGoalStep(path, doneStep, nextStep, date) {
    await appendBody(path, `- [x] ${date} ${doneStep}`);
    await patch(path, { next: nextStep ? nextStep : undefined });
  }

  async function seed() {
    await ensureTree();
    for (const a of SEED_AREAS) await createArea(a);
    for (const p of SEED_PRACTICES) await createPractice(p);
    for (const g of SEED_GOALS) await createGoal(g);
    for (const e of SEED_EVENTS) await createEvent(e);
  }

  const hasData = () => !!v.getFolderByPath(root());
  const isOurs = path => typeof path === 'string' && (path === root() || path.startsWith(root() + '/'));

  return {
    root, dir, load, ensureTree, createArea, createPractice, createGoal, createEvent,
    patch, rename, appendBody, setDone, setSkip, setSnooze, setPlan, restoreFlags, movePlan, ensureLogNote, appendLog, logPath,
    completeGoalStep, seed, hasData, isOurs,
  };
}

module.exports = { makeStore };
