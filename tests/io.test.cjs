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

const { makeStore } = require(process.env.RV_IO || '../src/io');
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
    const flags = p => ({ done: p.done, skip: p.skip, snooze: p.snooze, plan: p.plan });
    assert.deepStrictEqual(flags(r1.prev), { done: false, skip: false, snooze: false, plan: false }, 'prev reflects state BEFORE the change');
    const r2 = await s.setDone('2026-09-11', 'Paint', true);
    assert.deepStrictEqual(flags(r2.prev), { done: false, skip: false, snooze: false, plan: true }, 'tick captured that Paint was planned before it cleared the plan');
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
    assert.ok(plugin.app.vault.store.get('Rhythm/Practices/Pray.md').includes('area: "[[Belief]]"'), 'the wikilink form is preserved on disk, not flattened to bare text');
    assert.strictEqual(d.practices[0].area, 'Belief', 'and load hands the model the bare name');
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

  /* ---- item 11: a practice's start date comes ONLY from `created:` ---- */
  {
    const ctimeMs = Date.UTC(2026, 8, 20, 6, 0, 0);
    const plugin = makePlugin(
      {
        'Rhythm/Practices/Read.md': '---\nrhythm: practice\narea: Faith\ncreated: 2026-09-15\n---\n',
        'Rhythm/Practices/NoStat.md': '---\nrhythm: practice\narea: Faith\n---\n',
        'Rhythm/Practices/Junk.md': '---\nrhythm: practice\narea: Faith\ncreated: last week\n---\n',
        'Rhythm/Practices/BadDate.md': '---\nrhythm: practice\narea: Faith\ncreated: 2026-13-45\n---\n',
      },
      { 'Rhythm/Practices/NoStat.md': { ctime: ctimeMs }, 'Rhythm/Practices/Read.md': { ctime: ctimeMs } },
    );
    const s = makeStore(plugin);
    const d = await s.load();
    const by = n => d.practices.find(p => p.name === n);
    assert.strictEqual(by('Read').created, '2026-09-15', 'created is the frontmatter date, not ctime');
    assert.strictEqual(by('NoStat').created, undefined, 'no created: key means no created, even when the host has a ctime');
    assert.strictEqual(by('Junk').created, undefined, 'a non-ISO value is ignored');
    assert.strictEqual(by('BadDate').created, undefined, 'an impossible date is ignored');
    // The add path writes today's LOCAL date.
    await s.createPractice({ name: 'Walk', area: 'Body', cadence: 'daily' });
    const txt = plugin.app.vault.store.get('Rhythm/Practices/Walk.md');
    assert.strictEqual(parseFrontmatter(txt).fm.created, require('../src/dates').toISO(new Date()), 'new practice note carries created: today');
    assert.strictEqual((await s.load()).practices.find(p => p.name === 'Walk').created, require('../src/dates').toISO(new Date()));
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



  /* ---- item 1 at the io layer: names with apostrophes survive ticks ---- */
  {
    const plugin = makePlugin({});
    const s = makeStore(plugin);
    await s.setDone('2026-10-07', "Mom's call", true);
    await s.setDone('2026-10-07', 'Read', true);
    await s.setDone('2026-10-07', "Dad's walk", true);
    await s.setSkip('2026-10-07', "Mom's call", true);
    const e = (await s.load()).log.get('2026-10-07');
    assert.deepStrictEqual([...e.done], ['Read', "Dad's walk"], 'ticks after an apostrophe name keep every name');
    assert.deepStrictEqual([...e.skip], ["Mom's call"]);
  }

  /* ---- an emptied list property (`skip:`) reads as [] and is replaced in place ---- */
  {
    const plugin = makePlugin({ 'Rhythm/Log/2026-10-05.md': '---\nrhythm: log\ndone: [A]\nskip:\n---\nBody\n' });
    const s = makeStore(plugin);
    assert.deepStrictEqual([...(await s.load()).log.get('2026-10-05').skip], []);
    const r = await s.setSkip('2026-10-05', 'B', true);
    const txt = plugin.app.vault.store.get('Rhythm/Log/2026-10-05.md');
    assert.strictEqual(txt, '---\nrhythm: log\ndone: [A]\nskip: [B]\n---\nBody\n', 'one skip: line');
    await s.restoreFlags('2026-10-05', 'B', r.prev);
    assert.strictEqual(plugin.app.vault.store.get('Rhythm/Log/2026-10-05.md'), '---\nrhythm: log\ndone: [A]\nskip:\n---\nBody\n', 'undo gives back the empty key line');
  }

  /* ---- item 12: wikilink areas normalise to the bare name on load ---- */
  {
    const plugin = makePlugin({
      'Rhythm/Practices/A.md': '---\nrhythm: practice\narea: "[[Faith]]"\n---\n',
      'Rhythm/Practices/B.md': '---\nrhythm: practice\narea: [[Faith]]\n---\n',
      'Rhythm/Practices/C.md': '---\nrhythm: practice\narea: "[[Faith|my faith]]"\n---\n',
      'Rhythm/Goals/G.md': '---\nrhythm: goal\narea: "[[Faith]]"\n---\n',
      'Rhythm/Events/E.md': '---\nrhythm: event\narea: "[[Rhythm/Areas/Faith|x]]"\ndate: 2026-10-10\n---\n',
      'Rhythm/Practices/D.md': '---\nrhythm: practice\narea: Faith\n---\n',
    });
    const d = await makeStore(plugin).load();
    assert.deepStrictEqual(d.practices.map(p => p.area), ['Faith', 'Faith', 'Faith', 'Faith']);
    assert.strictEqual(d.goals[0].area, 'Faith');
    assert.strictEqual(d.events[0].area, 'Faith');
    assert.strictEqual(plugin.app.vault.store.get('Rhythm/Practices/A.md'), '---\nrhythm: practice\narea: "[[Faith]]"\n---\n', 'the note on disk is untouched');
  }

  /* ---- item 2: rename writes the name the FILE ends up with ---- */
  for (const newName of ['C# practice', 'Read: Psalms', 'Run/Walk', "Mom's call"]) {
    const plugin = makePlugin({
      'Rhythm/Areas/Faith.md': '---\nrhythm: area\norder: 1\n---\n',
      'Rhythm/Practices/Read.md': '---\nrhythm: practice\narea: Faith\ncadence: daily\n---\n',
      'Rhythm/Log/2026-10-06.md': '---\nrhythm: log\ndone: [Read, Pray]\nplan: [Read]\n---\n',
    });
    const s = makeStore(plugin);
    await s.rename('Rhythm/Practices/Read.md', newName);
    const d = await s.load();
    const n = d.practices[0].name;
    assert.strictEqual(n, require('../src/markdown').safeName(newName));
    assert.ok(d.log.get('2026-10-06').done.has(n) && d.log.get('2026-10-06').plan.has(n), 'history follows the real file name: ' + newName);
    assert.ok(!d.log.get('2026-10-06').done.has('Read'));
  }
  {
    const plugin = makePlugin({
      'Rhythm/Areas/Faith.md': '---\nrhythm: area\norder: 1\n---\n',
      'Rhythm/Practices/Read.md': '---\nrhythm: practice\narea: Faith\ncadence: daily\n---\n',
      'Rhythm/Goals/G.md': '---\nrhythm: goal\narea: "[[Faith|alias]]"\n---\n',
    });
    const s = makeStore(plugin);
    await s.rename('Rhythm/Areas/Faith.md', 'Faith: Family');
    const d = await s.load();
    assert.strictEqual(d.areas[0].name, 'Faith- Family');
    assert.strictEqual(d.practices[0].area, d.areas[0].name, 'practices keep their area after the rename');
    assert.strictEqual(d.goals[0].area, d.areas[0].name);
    assert.ok(plugin.app.vault.store.get('Rhythm/Goals/G.md').includes('area: "[[Faith- Family|alias]]"'), 'wikilink form + alias written back as found');
  }

  /* ---- item 3: a tick landing mid-rename survives; scalar lists are rewritten ---- */
  {
    const plugin = makePlugin({
      'Rhythm/Practices/Read.md': '---\nrhythm: practice\narea: Faith\ncadence: daily\n---\n',
      'Rhythm/Log/2026-10-07.md': '---\nrhythm: log\ndone: [Read]\n---\n',
    });
    const s = makeStore(plugin);
    const p1 = s.rename('Rhythm/Practices/Read.md', 'Bible');
    for (let i = 0; i < 2; i++) await tick();
    const p2 = s.setDone('2026-10-07', 'Walk', true);
    await Promise.all([p1, p2]);
    const d = await s.load();
    assert.deepStrictEqual([...d.log.get('2026-10-07').done].sort(), ['Bible', 'Walk'], 'the rename kept the concurrent tick and the history');
  }
  {
    // exhaustive over delays so the tick lands at every point of the rename
    for (let k = 0; k < 10; k++) {
      const plugin = makePlugin({
        'Rhythm/Practices/Read.md': '---\nrhythm: practice\narea: Faith\n---\n',
        'Rhythm/Log/2026-10-07.md': '---\nrhythm: log\ndone: [Read]\n---\n',
      });
      const s = makeStore(plugin);
      const p1 = s.rename('Rhythm/Practices/Read.md', 'Bible');
      for (let i = 0; i < k; i++) await tick();
      const p2 = s.setDone('2026-10-07', 'Walk', true);
      await Promise.all([p1, p2]);
      const done = [...(await s.load()).log.get('2026-10-07').done].sort();
      assert.deepStrictEqual(done, ['Bible', 'Walk'], 'tick at delay ' + k);
    }
  }
  {
    const plugin = makePlugin({
      'Rhythm/Practices/Read.md': '---\nrhythm: practice\narea: Mind\n---\n',
      'Rhythm/Log/2026-10-06.md': '---\nrhythm: log\ndone: Read\nsnooze:\n- Read\n---\n',
    });
    const s = makeStore(plugin);
    const r = await s.rename('Rhythm/Practices/Read.md', 'Study');
    const e = (await s.load()).log.get('2026-10-06');
    assert.strictEqual(r.touched, 1);
    assert.deepStrictEqual([[...e.done], [...e.snooze]], [['Study'], ['Study']], 'single-value and unindented block forms are rewritten');
  }

  /* ---- item 4: ensureLogNote / appendLog share the create queue ---- */
  for (let k = 0; k < 8; k++) for (const order of ['tickFirst', 'noteFirst', 'ensureFirst', 'tickSecond']) {
    const plugin = makePlugin({ 'Rhythm/Areas/A.md': '---\nrhythm: area\n---\n' });
    const s = makeStore(plugin);
    const date = '2026-10-07';
    const tickOp = () => s.setDone(date, 'Read', true);
    const other = order.startsWith('ensure') || order === 'tickSecond' ? () => s.ensureLogNote(date) : () => s.appendLog(date, 'journal');
    const a = order === 'tickFirst' || order === 'ensureFirst' ? tickOp : other;
    const b = a === tickOp ? other : tickOp;
    const first = a();
    for (let i = 0; i < k; i++) await tick();
    const second = b();
    const res = await Promise.allSettled([first, second]);
    assert.deepStrictEqual(res.map(r => r.status), ['fulfilled', 'fulfilled'], `${order}/${k}: ${res.map(r => r.reason && r.reason.message)}`);
    const txt = plugin.app.vault.store.get('Rhythm/Log/' + date + '.md');
    assert.ok(/Read/.test(txt), `${order}/${k}: the tick landed`);
    if (other.toString().includes('appendLog')) assert.ok(/journal/.test(txt), `${order}/${k}: the journal text landed`);
  }
  {
    const plugin = makePlugin({ 'Rhythm/Areas/A.md': '---\nrhythm: area\n---\n' });
    const s = makeStore(plugin);
    const [p1, p2] = await Promise.all([s.ensureLogNote('2026-10-08'), s.ensureLogNote('2026-10-08')]);
    assert.strictEqual(p1, 'Rhythm/Log/2026-10-08.md');
    assert.strictEqual(p1, p2);
    assert.strictEqual(plugin.app.vault.store.get(p1), '---\nrhythm: log\ndone: []\n---\n', 'an ensured note is the empty log, once');
  }

  /* ---- item 8: appendBody keeps CRLF; a patch on CRLF adds no blank line ---- */
  {
    const plugin = makePlugin({ 'Rhythm/Goals/G.md': '---\r\nrhythm: goal\r\nnext: Step one\r\n---\r\nAbout\r\n' });
    const s = makeStore(plugin);
    await s.completeGoalStep('Rhythm/Goals/G.md', 'Step one', 'Step two', '2026-10-07');
    assert.strictEqual(plugin.app.vault.store.get('Rhythm/Goals/G.md'),
      '---\r\nrhythm: goal\r\nnext: Step two\r\n---\r\nAbout\r\n\r\n- [x] 2026-10-07 Step one\r\n', 'CRLF throughout, no stray LF, no extra blank line after the fence');
    await s.appendBody('Rhythm/Goals/G.md', 'two\nlines');
    assert.ok(!/[^\r]\n/.test(plugin.app.vault.store.get('Rhythm/Goals/G.md')), 'a multi-line block is appended with CRLF');
  }

  /* ---- item 9: undo is byte-exact (index in the list + key position) ---- */
  {
    const log = '---\nrhythm: log\ndone: [Journal]\nskip: [Rest]\nsnooze: [Bible study, Read,Pray]\nplan: [Bible study]\n---\n\nMy notes\n';
    const exact = async (label, op) => {
      const plugin = makePlugin({ 'Rhythm/Log/2026-09-13.md': log });
      const s = makeStore(plugin);
      const r = await op(s);
      assert.notStrictEqual(plugin.app.vault.store.get('Rhythm/Log/2026-09-13.md'), log, label + ': the op changed something');
      await s.restoreFlags('2026-09-13', 'Bible study', r.prev);
      assert.strictEqual(plugin.app.vault.store.get('Rhythm/Log/2026-09-13.md'), log, label + ': undo restores the exact bytes');
    };
    await exact('tick', s => s.setDone('2026-09-13', 'Bible study', true));
    await exact('skip', s => s.setSkip('2026-09-13', 'Bible study', true));
    await exact('untick-of-snooze', s => s.setSnooze('2026-09-13', 'Bible study', false));
    // the key itself was dropped because its list emptied
    const log2 = '---\nrhythm: log\ndone: [Journal]\nsnooze: [Bible study]\nplan: [Read]\nfoo: bar\n---\nBody\n';
    const plugin = makePlugin({ 'Rhythm/Log/2026-09-13.md': log2 });
    const s = makeStore(plugin);
    const r = await s.setDone('2026-09-13', 'Bible study', true);
    const after = plugin.app.vault.store.get('Rhythm/Log/2026-09-13.md');
    assert.ok(!/snooze/.test(after), 'tick emptied and dropped snooze');
    await s.restoreFlags('2026-09-13', 'Bible study', r.prev);
    assert.strictEqual(plugin.app.vault.store.get('Rhythm/Log/2026-09-13.md'), log2, 'dropped snooze key is back in its old place');
    // a booleans-only prev (older caller) still works
    await s.restoreFlags('2026-09-13', 'Bible study', { done: true, skip: false, snooze: false, plan: false });
    assert.ok(parseFrontmatter(plugin.app.vault.store.get('Rhythm/Log/2026-09-13.md')).fm.done.includes('Bible study'));
  }

  /* ---- item 7 at the io layer: unrelated keys and lists do not churn ---- */
  {
    const log = '---\nrhythm: log\ndone: [A,B]\nmood: "so-so"   # felt flat\nsnooze: Z\n---\nBody\n';
    const plugin = makePlugin({ 'Rhythm/Log/2026-09-14.md': log });
    const s = makeStore(plugin);
    await s.setDone('2026-09-14', 'C', true);
    assert.strictEqual(plugin.app.vault.store.get('Rhythm/Log/2026-09-14.md'), log.replace('done: [A,B]', 'done: [A, B, C]'), 'only the changed list is rewritten; scalar snooze and the commented mood line are as written');
  }

  /* ---- item 10: movePlan resolves { prev: { from, to } } and both undo ---- */
  {
    const from = '---\nrhythm: log\ndone: []\nplan: [Walk, Read]\n---\n';
    const to = '---\nrhythm: log\ndone: []\nskip: [Walk]\nsnooze: [Walk, Pray]\n---\n';
    const plugin = makePlugin({ 'Rhythm/Log/2026-10-07.md': from, 'Rhythm/Log/2026-10-08.md': to });
    const s = makeStore(plugin);
    const res = await s.movePlan('Walk', '2026-10-07', '2026-10-08');
    const flag = p => p && { done: p.done, skip: p.skip, snooze: p.snooze, plan: p.plan };
    assert.deepStrictEqual(flag(res.prev.from), { done: false, skip: false, snooze: false, plan: true });
    assert.deepStrictEqual(flag(res.prev.to), { done: false, skip: true, snooze: true, plan: false });
    const d = await s.load();
    assert.ok(d.log.get('2026-10-08').plan.has('Walk') && !d.log.get('2026-10-08').skip.has('Walk'), 'the plan cleared skip/snooze on the target');
    await s.restoreFlags('2026-10-07', 'Walk', res.prev.from);
    await s.restoreFlags('2026-10-08', 'Walk', res.prev.to);
    assert.strictEqual(plugin.app.vault.store.get('Rhythm/Log/2026-10-07.md'), from);
    assert.strictEqual(plugin.app.vault.store.get('Rhythm/Log/2026-10-08.md'), to, 'undo gives back the skip + snooze the plan cleared, byte for byte');
    // one-sided and no-op forms
    const r2 = await s.movePlan('Walk', null, '2026-10-09');
    assert.strictEqual(r2.prev.from, null);
    assert.ok(r2.prev.to && r2.prev.to.plan === false);
    const r3 = await s.movePlan('Walk', '2026-10-09', null);
    assert.strictEqual(r3.prev.to, null);
    assert.ok(r3.prev.from && r3.prev.from.plan === true);
    assert.deepStrictEqual(await s.movePlan('Walk', '2026-10-09', '2026-10-09'), { prev: { from: null, to: null } });
  }

  console.log('io OK');
})().catch(e => { console.error(e); process.exit(1); });
