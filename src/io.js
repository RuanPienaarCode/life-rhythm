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
    const allPractices = (await readAll(dir('practices'))).map(r => ({
      name: r.name, area: r.fm.area || '', cadence: r.fm.cadence || 'daily', days: r.fm.days,
      minutes: num(r.fm.minutes), when: r.fm.when || '', time: r.fm.time ? String(r.fm.time) : '',
      note: firstLine(r.body), path: r.path,
      aside: r.fm.status === 'aside' || r.fm.status === 'paused',
    }));
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

  async function patch(path, fields) {
    const f = v.getFileByPath(path);
    if (!f) return false;
    const text = await v.read(f);
    stamp();
    await v.modify(f, patchFrontmatter(text, fields));
    return true;
  }

  /* Rename a note in place (links elsewhere in the vault follow when the
     host offers fileManager.renameFile). Returns the new path or null. */
  async function rename(path, newName) {
    const f = v.getFileByPath(path);
    if (!f) return null;
    const slash = path.lastIndexOf('/');
    const newPath = `${path.slice(0, slash)}/${safeName(newName)}.md`;
    if (newPath === path) return path;
    if (existsCaseFolded(newPath) && newPath.toLowerCase() !== path.toLowerCase()) return null;
    stamp();
    if (app.fileManager && app.fileManager.renameFile) await app.fileManager.renameFile(f, newPath);
    else await v.rename(f, newPath);
    return newPath;
  }

  /* Append a block to a note body without touching anything above it. */
  async function appendBody(path, block) {
    const f = v.getFileByPath(path);
    if (!f) return false;
    const text = await v.read(f);
    const sep = text.endsWith('\n') ? '\n' : '\n\n';
    stamp();
    await v.modify(f, text + sep + block.replace(/\s+$/, '') + '\n');
    return true;
  }

  /* ---- the day's log ---------------------------------------------- */

  const logPath = date => `${dir('log')}/${date}.md`;

  async function readLog(date) {
    const f = v.getFileByPath(logPath(date));
    return { file: f, text: f ? await v.read(f) : buildNote({ rhythm: 'log' }, '') };
  }

  async function writeLog(date, text) {
    await ensureTree();
    const f = v.getFileByPath(logPath(date));
    stamp();
    if (f) await v.modify(f, text);
    else await v.create(logPath(date), text);
  }

  /* Set one flag (done | skip | snooze | plan) for a practice on a day.
     A tick clears skip, snooze and the day's plan (the promise is kept);
     a skip clears done; a plan clears skip and snooze. */
  async function setFlag(date, key, name, on) {
    const { text } = await readLog(date);
    const { fm } = parseFrontmatter(text);
    const cur = { done: list(fm.done), skip: list(fm.skip), snooze: list(fm.snooze), plan: list(fm.plan) };
    const toggle = (arr, add) => (add ? (arr.includes(name) ? arr : [...arr, name]) : arr.filter(n => n !== name));
    cur[key] = toggle(cur[key], on);
    if (key === 'done' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); cur.plan = toggle(cur.plan, false); }
    if (key === 'skip' && on) { cur.done = toggle(cur.done, false); cur.plan = toggle(cur.plan, false); }
    if (key === 'plan' && on) { cur.skip = toggle(cur.skip, false); cur.snooze = toggle(cur.snooze, false); }
    const fields = { done: cur.done };
    for (const k of ['skip', 'snooze', 'plan']) fields[k] = cur[k].length ? cur[k] : undefined;
    await writeLog(date, patchFrontmatter(text, fields));
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
    patch, rename, appendBody, setDone, setSkip, setSnooze, setPlan, movePlan, ensureLogNote, appendLog, logPath,
    completeGoalStep, seed, hasData, isOurs,
  };
}

module.exports = { makeStore };
