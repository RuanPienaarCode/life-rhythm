'use strict';
/* io.js — vault reads/writes. A self-contained fake Vault (no real
   Obsidian): getFolderByPath, getFileByPath, cachedRead, read, create,
   modify, createFolder, process, rename. `process` is deliberately async
   with a real tick delay and a per-path lock, so a test that races two
   writes actually exercises the same interleaving a slow disk would
   produce — not just "correct because JS never yielded". */
const assert = require('node:assert');
const Module = require('node:module');

const obsidianStub = { normalizePath: p => p.replace(/\/+/g, '/').replace(/\/$/, '') };
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'obsidian') return obsidianStub;
  return origLoad.call(this, request, ...rest);
};

const { makeStore } = require('../src/io');
const { parseFrontmatter } = require('../src/markdown');

const tick = () => new Promise(r => setImmediate(r));

function fakeVault(files, stats) {
  const store = new Map(Object.entries(files || {}));
  const folders = new Set();
  const locks = new Map();
  const mkFile = path => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    const f = { path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : '' };
    if (stats && stats[path]) f.stat = stats[path];
    return f;
  };
  const v = {
    store,
    getFileByPath: p => (store.has(p) ? mkFile(p) : null),
    getFolderByPath: p => {
      const any = [...store.keys()].some(k => k.startsWith(p + '/'));
      if (!any && !folders.has(p)) return null;
      const kids = [...store.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'));
      return { path: p, children: kids.map(mkFile) };
    },
    createFolder: async p => { await tick(); folders.add(p); },
    cachedRead: async f => { await tick(); return store.get(f.path); },
    read: async f => { await tick(); return store.get(f.path); },
    create: async (p, content) => {
      await tick();
      if (store.has(p)) throw new Error('exists: ' + p);
      store.set(p, content);
      return mkFile(p);
    },
    modify: async (f, content) => { await tick(); store.set(f.path, content); },
    rename: async (f, newPath) => { await tick(); const c = store.get(f.path); store.delete(f.path); store.set(newPath, c); },
    async process(f, fn) {
      const path = f.path;
      const prior = locks.get(path) || Promise.resolve();
      const run = prior.then(async () => {
        await tick();
        const next = fn(store.get(path));
        await tick();
        store.set(path, next);
        return next;
      });
      locks.set(path, run.catch(() => {}));
      return run;
    },
  };
  return v;
}

function makePlugin(files, stats) {
  const vault = fakeVault(files, stats);
  const plugin = { settings: { folder: 'Rhythm' }, app: { vault, fileManager: { renameFile: (f, np) => vault.rename(f, np) } } };
  return plugin;
}

(async () => {
  /* ---- H1: concurrent ticks must not lose one another ---- */
  {
    const plugin = makePlugin({ 'Rhythm/Log/2026-09-11.md': '---\nrhythm: log\ndone: []\n---\n' });
    const s = makeStore(plugin);
    await Promise.all([s.setDone('2026-09-11', 'Read the Bible', true), s.setDone('2026-09-11', 'Exercise', true)]);
    const d = await s.load();
    assert.deepStrictEqual([...d.log.get('2026-09-11').done].sort(), ['Exercise', 'Read the Bible'], 'both concurrent ticks on an existing note land');
  }
  {
    // No log file yet: two concurrent first ticks must both create/land, not race-lose one.
    const plugin = makePlugin({});
    const s = makeStore(plugin);
    await Promise.all([s.setDone('2026-09-12', 'A', true), s.setDone('2026-09-12', 'B', true)]);
    const d = await s.load();
    assert.deepStrictEqual([...d.log.get('2026-09-12').done].sort(), ['A', 'B'], 'two concurrent first ticks with no log file yet both land');
  }

  /* ---- setFlag / restoreFlags contract ---- */
  {
    const plugin = makePlugin({});
    const s = makeStore(plugin);
    const r1 = await s.setPlan('2026-09-11', 'Paint', true);
    assert.deepStrictEqual(r1.prev, { done: false, skip: false, snooze: false, plan: false }, 'prev reflects state BEFORE the change');
    const r2 = await s.setDone('2026-09-11', 'Paint', true);
    assert.deepStrictEqual(r2.prev, { done: false, skip: false, snooze: false, plan: true }, 'tick captured that Paint was planned before it cleared the plan');
    let d = await s.load();
    assert.deepStrictEqual([...d.log.get('2026-09-11').plan], [], 'tick swallowed the plan');
    assert.deepStrictEqual([...d.log.get('2026-09-11').done], ['Paint']);
    await s.restoreFlags('2026-09-11', 'Paint', r2.prev);
    d = await s.load();
    const e = d.log.get('2026-09-11');
    assert.deepStrictEqual([...e.plan], ['Paint'], 'restoreFlags puts the swallowed plan back');
    assert.deepStrictEqual([...e.done], [], 'and undoes the tick itself');
  }

  /* ---- H2: rename must not orphan history ---- */
  {
    const plugin = makePlugin({
      'Rhythm/Areas/Faith.md': '---\nrhythm: area\norder: 1\n---\n',
      'Rhythm/Practices/Exercise.md': '---\nrhythm: practice\narea: Faith\ncadence: 4/week\n---\n',
      'Rhythm/Log/2026-09-07.md': '---\nrhythm: log\ndone: [Exercise]\n---\n',
      'Rhythm/Log/2026-09-09.md': '---\nrhythm: log\ndone: [Exercise]\n---\n',
      'Rhythm/Log/2026-09-13.md': '---\nrhythm: log\ndone: []\nplan: [Exercise]\n---\n',
    });
    const s = makeStore(plugin);
    const r = await s.rename('Rhythm/Practices/Exercise.md', 'Workout');
    assert.strictEqual(r.path, 'Rhythm/Practices/Workout.md');
    assert.strictEqual(r.touched, 3, 'all three Log notes referencing Exercise were rewritten');
    const d = await s.load();
    assert.strictEqual(d.practices[0].name, 'Workout');
    const orphans = [...d.log.values()].filter(e => e.done.has('Exercise') || e.plan.has('Exercise')).length;
    assert.strictEqual(orphans, 0, 'no log entry still names the old practice');
    assert.ok(d.log.get('2026-09-07').done.has('Workout') && d.log.get('2026-09-09').done.has('Workout') && d.log.get('2026-09-13').plan.has('Workout'));

    const ra = await s.rename('Rhythm/Areas/Faith.md', 'Belief');
    assert.strictEqual(ra.touched, 1, 'the one practice referencing Faith was rewritten');
    const d2 = await s.load();
    assert.deepStrictEqual(d2.areas.map(a => a.name), ['Belief']);
    assert.strictEqual(d2.practices[0].area, 'Belief', 'the practice note\'s area: field followed the rename');
  }

  /* ---- area rename also follows the wikilink form ---- */
  {
    const plugin = makePlugin({
      'Rhythm/Areas/Faith.md': '---\nrhythm: area\norder: 1\n---\n',
      'Rhythm/Practices/Pray.md': '---\nrhythm: practice\narea: "[[Faith]]"\ncadence: daily\n---\n',
    });
    const s = makeStore(plugin);
    await s.rename('Rhythm/Areas/Faith.md', 'Belief');
    const d = await s.load();
    assert.strictEqual(d.practices[0].area, '[[Belief]]', 'the wikilink form is preserved, not flattened to bare text');
  }

  /* ---- rename collision still returns null, no partial rewrite ---- */
  {
    const plugin = makePlugin({
      'Rhythm/Practices/Exercise.md': '---\nrhythm: practice\narea: Faith\n---\n',
      'Rhythm/Practices/Workout.md': '---\nrhythm: practice\narea: Faith\n---\n',
    });
    const s = makeStore(plugin);
    const r = await s.rename('Rhythm/Practices/Exercise.md', 'Workout');
    assert.strictEqual(r, null);
  }

  /* ---- item 7: created date on a practice record ---- */
  {
    const ctimeMs = Date.UTC(2026, 8, 20, 6, 0, 0); // month is 0-based: Sep
    const plugin = makePlugin(
      { 'Rhythm/Practices/Read.md': '---\nrhythm: practice\narea: Faith\n---\n', 'Rhythm/Practices/NoStat.md': '---\nrhythm: practice\narea: Faith\n---\n' },
      { 'Rhythm/Practices/Read.md': { ctime: ctimeMs } },
    );
    const s = makeStore(plugin);
    const d = await s.load();
    const read = d.practices.find(p => p.name === 'Read');
    const noStat = d.practices.find(p => p.name === 'NoStat');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(read.created), 'created is an ISO date string');
    assert.strictEqual(read.created, require('../src/dates').toISO(new Date(ctimeMs)), 'created is the LOCAL date of ctime');
    assert.strictEqual(noStat.created, undefined, 'created is omitted when the host gives no stat');
  }

  /* ---- block-sequence read through io.js (Properties-panel form) ---- */
  {
    const plugin = makePlugin({
      'Rhythm/Log/2026-09-11.md': '---\nrhythm: log\ndone:\n  - Read the Bible\n  - Exercise\n---\n\nbody\n',
      'Rhythm/Practices/Sabbath walk.md': '---\nrhythm: practice\narea: Faith\ncadence: daily\ndays:\n  - sat\n---\n',
      'Rhythm/Areas/Faith.md': '---\norder: 1\n---\n',
    });
    const s = makeStore(plugin);
    const d = await s.load();
    assert.deepStrictEqual([...d.log.get('2026-09-11').done], ['Read the Bible', 'Exercise']);
    assert.deepStrictEqual(d.practices[0].days, ['sat']);
    await s.setDone('2026-09-11', 'Journal', true);
    const text = plugin.app.vault.store.get('Rhythm/Log/2026-09-11.md');
    assert.strictEqual((text.match(/^done:/gm) || []).length, 1, 'no duplicate done: key after ticking from a block-sequence file');
  }

  console.log('io OK');
})().catch(e => { console.error(e); process.exit(1); });
