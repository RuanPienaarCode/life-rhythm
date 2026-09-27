'use strict';
/* Vault IO — every read and write of the Rhythm folder goes through here.
   Vault API only (desktop and iOS). Writes stamp plugin._lastWrite so the
   view's vault watcher can tell our own writes from the user's edits.

   Note BODIES are never rebuilt: the plugin patches frontmatter keys and
   APPENDS to bodies (weekly review, completed goal steps); it never
   rewrites what the user typed. */

const { normalizePath } = require('obsidian');
const { parseFrontmatter, buildNote, patchFrontmatter, safeName } = require('./markdown');
const { FOLDERS } = require('./constants');
const { SEED_AREAS, SEED_PRACTICES, SEED_GOALS, SEED_EVENTS } = require('./seed');
const D = require('./dates');

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
const list = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);

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
      /* LOCAL date the note was created, for missedRun/practiceStart in
         model.js — a brand-new practice must not open with a borrowed
         "missed N days" streak. Omitted when the host gives no stat. */
      const ctime = r.file && r.file.stat && r.file.stat.ctime;
      const created = Number.isFinite(ctime) ? D.toISO(new Date(ctime)) : undefined;
      return {
        name: r.name, area: r.fm.area || '', cadence: r.fm.cadence || 'daily', days: r.fm.days,
        minutes: num(r.fm.minutes), when: r.fm.when || '', time: r.fm.time ? String(r.fm.time) : '',
        note: firstLine(r.body), path: r.path,
        aside: r.fm.status === 'aside' || r.fm.status === 'paused',
        ...(created ? { created } : {}),
      };
    });
    const practices = allPractices.filter(p => !p.aside);
    const aside = allPractices.filter(p => p.aside);
    const goals = (await readAll(dir('goals'))).map(r => ({
      name: r.name, area: r.fm.area || '', horizon: r.fm.horizon || '', status: r.fm.status || 'active',
      next: r.fm.next || '', note: firstLine(r.body), path: r.path,
    }));
    const events = (await readAll(dir('events'))).map(r => ({
      name: r.name, area: r.fm.area || '', date: String(r.fm.date || ''), time: r.fm.time ? String(r.fm.time) : '',
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
     history). Returns the count of notes touched. */
  async function renamePracticeRefs(oldName, newName) {
    let touched = 0;
    for (const f of mdFiles(dir('log'))) {
      let text;
      try { text = await v.cachedRead(f); } catch (e) { continue; }
      if (!text.includes(oldName)) continue;
      const { fm } = parseFrontmatter(text);
      const fields = {};
      let changed = false;
      for (const k of ['done', 'skip', 'snooze', 'plan']) {
        const arr = Array.isArray(fm[k]) ? fm[k] : null;
        if (arr && arr.includes(oldName)) { fields[k] = arr.map(n => (n === oldName ? newName : n)); changed = true; }
      }
      if (!changed) continue;
      stamp();
      await v.process(f, t => patchFrontmatter(t, fields));
      touched++;
    }
    return touched;
  }

  /* Rewrite oldName -> newName wherever an AREA is referenced: `area:`
     (bare, or as the wikilink form Obsidian's own UI can write) in every
     Practice, Goal and Event note. Goals hold no practice-name reference
     anywhere (checked: `next` is free text, not a name), so a practice
     rename never needs to touch Goals. Returns the count of notes touched. */
  async function renameAreaRefs(oldName, newName) {
    const wiki = `[[${oldName}]]`;
    let touched = 0;
    for (const key of ['practices', 'goals', 'events']) {
      for (const f of mdFiles(dir(key))) {
        let text;
        try { text = await v.cachedRead(f); } catch (e) { continue; }
        if (!text.includes(oldName)) continue;
        const { fm } = parseFrontmatter(text);
        let next;
        if (fm.area === oldName) next = newName;
        else if (fm.area === wiki) next = `[[${newName}]]`;
        else continue;
        stamp();
        await v.process(f, t => patchFrontmatter(t, { area: next }));
        touched++;
      }
    }
    return touched;
  }

  /* Rename a note in place (links elsewhere in the vault follow when the
     host offers fileManager.renameFile), then rewrite every reference to
     its old name (practice: log history; area: area: fields). Resolves to
     { path, touched } on success, null when the target name is taken. */
  async function rename(path, newName) {
    const f = v.getFileByPath(path);
    if (!f) return null;
    const slash = path.lastIndexOf('/');
    const newPath = `${path.slice(0, slash)}/${safeName(newName)}.md`;
    if (newPath === path) return { path, touched: 0 };
    if (existsCaseFolded(newPath) && newPath.toLowerCase() !== path.toLowerCase()) return null;
    const oldName = baseName(f);
    let kind;
    try { kind = parseFrontmatter(await v.cachedRead(f)).fm.rhythm; } catch (e) { kind = undefined; }
    stamp();
    if (app.fileManager && app.fileManager.renameFile) await app.fileManager.renameFile(f, newPath);
    else await v.rename(f, newPath);
    let touched = 0;
    if (kind === 'practice') touched = await renamePracticeRefs(oldName, newName);
    else if (kind === 'area') touched = await renameAreaRefs(oldName, newName);
    return { path: newPath, touched };
  }

  /* Append a block to a note body without touching anything above it. */
  async function appendBody(path, block) {
    const f = v.getFileByPath(path);
    if (!f) return false;
    stamp();
    await v.process(f, text => {
      const sep = text.endsWith('\n') ? '\n' : '\n\n';
      return text + sep + block.replace(/\s+$/, '') + '\n';
    });
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

  /* Set one flag (done | skip | snooze | plan) for a practice on a day.
     A tick clears skip, snooze and the day's plan (the promise is kept);
     a skip clears done; a plan clears skip and snooze. Resolves to `prev`
     — the four flags this name held BEFORE the change — so a caller can
     undo the change exactly with restoreFlags. */
  async function setFlag(date, key, name, on) {
    let prev;
    await processLog(date, text => {
      const { fm } = parseFrontmatter(text);
      const cur = { done: list(fm.done), skip: list(fm.skip), snooze: list(fm.snooze), plan: list(fm.plan) };
      prev = { done: cur.done.includes(name), skip: cur.skip.includes(name), snooze: cur.snooze.includes(name), plan: cur.plan.includes(name) };
      const toggle = (arr, add) => (add ? (arr.includes(name) ? arr : [...arr, name]) : arr.filter(n => n !== name));
      cur[key] = toggle(cur[key], on);
      if (key === 'done' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); cur.plan = toggle(cur.plan, false); }
      if (key === 'skip' && on) { cur.done = toggle(cur.done, false); cur.plan = toggle(cur.plan, false); }
      if (key === 'plan' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); }
      const fields = { done: cur.done };
      for (const k of ['skip', 'snooze', 'plan']) fields[k] = cur[k].length ? cur[k] : undefined;
      return patchFrontmatter(text, fields);
    });
    return { prev };
  }

  /* Put a name's four flags back exactly as `prev` describes — the actual
     undo of a setFlag change (a plain setDone(false) is not enough: it
     only clears done, not whatever setFlag's own side-effects cleared
     alongside it, e.g. a plan a tick swallowed). */
  async function restoreFlags(date, name, prev) {
    await processLog(date, text => {
      const { fm } = parseFrontmatter(text);
      const cur = { done: list(fm.done), skip: list(fm.skip), snooze: list(fm.snooze), plan: list(fm.plan) };
      const setBool = (arr, want) => {
        const has = arr.includes(name);
        if (want === has) return arr;
        return want ? [...arr, name] : arr.filter(n => n !== name);
      };
      cur.done = setBool(cur.done, !!(prev && prev.done));
      cur.skip = setBool(cur.skip, !!(prev && prev.skip));
      cur.snooze = setBool(cur.snooze, !!(prev && prev.snooze));
      cur.plan = setBool(cur.plan, !!(prev && prev.plan));
      const fields = { done: cur.done };
      for (const k of ['skip', 'snooze', 'plan']) fields[k] = cur[k].length ? cur[k] : undefined;
      return patchFrontmatter(text, fields);
    });
  }

  const setDone = (date, name, on) => setFlag(date, 'done', name, on);
  const setSkip = (date, name, on) => setFlag(date, 'skip', name, on);
  const setSnooze = (date, name, on) => setFlag(date, 'snooze', name, on);
  const setPlan = (date, name, on) => setFlag(date, 'plan', name, on);

  /* Move a promise between days — two writes, so a failure half way leaves
     the practice on ONE of the days rather than on neither. */
  async function movePlan(name, from, to) {
    if (from === to) return;
    if (to) await setPlan(to, name, true);
    if (from) await setPlan(from, name, false);
  }

  async function ensureLogNote(date) {
    await ensureTree();
    const path = logPath(date);
    await writeIfAbsent(path, buildNote({ rhythm: 'log', done: [] }, ''));
    return path;
  }

  async function appendLog(date, block) {
    const path = await ensureLogNote(date);
    return appendBody(path, block);
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
