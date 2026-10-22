'use strict';
/* io.js as the ONE writer of Rhythm's log notes (decision Q18). The rules it
   took over from Vista's own writer, Fortnight's plan refusal, and the log
   window Fortnight reads with. Cases ported from vista-vault
   tests/rhythm.test.cjs (main a46a892), now run against io.js. */
const assert = require('node:assert');
const Module = require('node:module');

const obsidianStub = { normalizePath: p => String(p).replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '') };
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? obsidianStub : origLoad.call(this, request, ...rest); };

const { makeStore } = require('../src/io');
const { parseFrontmatter } = require('../src/markdown');

const DAY = '2026-10-22';
const LOG = `Rhythm/Log/${DAY}.md`;

function makeVault(files) {
  const store = new Map(Object.entries(files || {}));
  const folders = new Set(['Rhythm', 'Rhythm/Log', 'Rhythm/Practices', 'Rhythm/Areas', 'Rhythm/Goals', 'Rhythm/Events']);
  const reads = [];
  const v = {
    store, reads, writes: 0,
    getFileByPath: p => (store.has(p) ? { path: p, name: p.split('/').pop(), basename: p.split('/').pop().replace(/\.md$/, ''), extension: 'md' } : null),
    getFolderByPath: p => {
      if (!folders.has(p) && ![...store.keys()].some(k => k.startsWith(p + '/'))) return null;
      const kids = [...store.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(k => v.getFileByPath(k));
      return { path: p, children: kids };
    },
    cachedRead: async f => { reads.push(f.path); return store.get(f.path); },
    read: async f => store.get(f.path),
    process: async (f, fn) => { const before = store.get(f.path); const t = fn(before); if (t !== before) v.writes++; store.set(f.path, t); return t; },
    create: async (p, t) => { if (store.has(p)) throw new Error('exists'); v.writes++; store.set(p, t); return v.getFileByPath(p); },
    createFolder: async p => { folders.add(p); },
    modify: async (f, t) => { v.writes++; store.set(f.path, t); },
  };
  return v;
}
const storeOver = files => {
  const vault = makeVault(files);
  return { vault, store: makeStore({ app: { vault }, settings: { folder: 'Rhythm' } }) };
};
const reads = (text, key) => {
  const v = parseFrontmatter(text).fm[key];
  return (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
};

(async () => {
  /* ---- 1. a flag line the reader cannot read is never overwritten ---- */
  const refusals = [
    ['multi-line flow list in done', '---\nrhythm: log\ndone: [Walk,\n  Read]\n---\n', 'done'],
    ['multi-line flow list in skip (a tick clears skip)', '---\nrhythm: log\ndone: [Walk]\nskip: [Read,\n  Rest]\n---\n', 'skip'],
    ['folded scalar in plan', '---\nrhythm: log\ndone: []\nplan: >\n  Walk\n---\n', 'plan'],
    ['literal scalar in snooze', '---\nrhythm: log\nsnooze: |\n  Walk\n---\n', 'snooze'],
    ['an empty key followed past a blank line by an indented list', '---\nrhythm: log\ndone:\n\n  - Walk\n---\n', 'done'],
    ['key with a nested map', '---\nrhythm: log\ndone:\n  a: 1\n---\n', 'done'],
  ];
  for (const [label, input, key] of refusals) {
    const { vault, store } = storeOver({ [LOG]: input });
    const r = await store.setDone(DAY, 'Run', true);
    assert.deepStrictEqual(r.refused, { reason: 'unreadable', key }, `${label}: refused, naming the key`);
    assert.strictEqual(r.prev, undefined, `${label}: nothing to undo`);
    assert.strictEqual(vault.store.get(LOG), input, `${label}: file untouched`);
    assert.strictEqual(vault.writes, 0, `${label}: nothing written at all`);
  }
  {
    const { store } = storeOver({ [LOG]: '---\nrhythm: log\ndone: [Walk,\n  Run]\n---\n' });
    assert.ok((await store.setDone(DAY, 'Run', false)).refused, 'unticking is refused the same way');
    assert.ok((await store.restoreFlags(DAY, 'Run', { done: true })).refused, 'and an undo');
  }

  /* ---- 2. an apostrophe item is double-quoted, and every name round-trips */
  {
    const { vault, store } = storeOver({ [LOG]: '---\nrhythm: log\ndone: []\n---\n' });
    await store.setDone(DAY, "Mom's call", true);
    assert.strictEqual(vault.store.get(LOG), '---\nrhythm: log\ndone: ["Mom\'s call"]\n---\n');
  }
  {
    const { vault, store } = storeOver({ [LOG]: "---\nrhythm: log\ndone: [Mom's call]\n---\n" });
    await store.setDone(DAY, 'Run', true);
    assert.strictEqual(vault.store.get(LOG), '---\nrhythm: log\ndone: ["Mom\'s call", Run]\n---\n', 'a bare apostrophe item is healed on the next write');
  }
  const names = ["Mom's call", 'Walk', 'Rest, stretch', 'Rest & recover', '{Focus}', '@home', '%body', '!Stretch', '- Walk', 'Yes', '2024', 'Ünïcödé 🙂', "a 'quoted' word", 'Read (Psalms)', '~', 'Practice #1', 'Read [chapter 1]', 'True'];
  for (const n of names) {
    const { vault, store } = storeOver({});
    await store.setDone(DAY, n, true);
    await store.setDone(DAY, 'Other', true);
    assert.deepStrictEqual(reads(vault.store.get(LOG), 'done'), [n, 'Other'], `${JSON.stringify(n)}: reads back as written`);
    await store.setDone(DAY, n, false);
    assert.deepStrictEqual(reads(vault.store.get(LOG), 'done'), ['Other'], `${JSON.stringify(n)}: unticks`);
  }

  /* ---- 3. Fortnight's refusal: no promise on a day it is already done -- */
  {
    const input = '---\nrhythm: log\ndone: [Gym]\n---\n';
    const { vault, store } = storeOver({ [LOG]: input });
    const r = await store.setFlag(DAY, 'plan', 'Gym', true, { refuseIfDone: true });
    assert.deepStrictEqual(r.refused, { reason: 'done-that-day' });
    assert.strictEqual(vault.store.get(LOG), input);
    const plain = await store.setFlag(DAY, 'plan', 'Gym', true);
    assert.ok(!plain.refused, 'without the option, Rhythm\'s own behaviour is unchanged');
  }
  {
    /* movePlan stops at a refusal on the new day, keeping the old promise */
    const from = '2026-10-21';
    const fromText = '---\nrhythm: log\nplan: [Gym]\n---\n';
    const { vault, store } = storeOver({ [`Rhythm/Log/${from}.md`]: fromText, [LOG]: '---\nrhythm: log\ndone: [Gym]\n---\n' });
    const r = await store.movePlan('Gym', from, DAY, { refuseIfDone: true });
    assert.deepStrictEqual(r.refused, { reason: 'done-that-day' });
    assert.strictEqual(vault.store.get(`Rhythm/Log/${from}.md`), fromText, 'the old day keeps its promise');
  }

  /* ---- 4. the log window: only notes inside it are read at all ------- */
  {
    const files = {};
    for (const d of ['2026-08-31', '2026-09-01', '2026-10-31', '2026-11-01']) files[`Rhythm/Log/${d}.md`] = `---\nrhythm: log\ndone: [Walk]\n---\n`;
    files['Rhythm/Log/scratch.md'] = '---\ndone: [Walk]\n---\n';
    const { vault, store } = storeOver(files);
    const data = await store.load({ logFrom: '2026-09-01', logTo: '2026-10-31' });
    assert.deepStrictEqual([...data.log.keys()], ['2026-09-01', '2026-10-31']);
    assert.deepStrictEqual(vault.reads.filter(p => p.includes('/Log/')).sort(), ['Rhythm/Log/2026-09-01.md', 'Rhythm/Log/2026-10-31.md']);
    const all = await store.load();
    assert.deepStrictEqual([...all.log.keys()].sort(), ['2026-08-31', '2026-09-01', '2026-10-31', '2026-11-01'], 'no window: every dated log, as before');
  }

  console.log('io safety OK');
})().catch(e => { console.error(e); process.exit(1); });
