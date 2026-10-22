'use strict';
/* plugin.api v1 (src/api.js) — the contract Vista builds on — run against the
   REAL reminders store (through its host) and Rhythm's REAL io.js store over
   an in-memory vault. Checks the shapes, that a ref is checked against the
   note as it is NOW (a changed row is refused, never acted on), that nothing
   live leaves the plugin, and that listeners hear of a change once. */
const assert = require('node:assert');
require('./reminders-_stub.cjs');
/* Real timers (the api debounces), but the host's one-minute due check is a
   no-op here: the plugin's registerInterval clears it on unload, this fake
   does not. */
global.window = Object.assign(Object.create(globalThis), { setInterval: () => 0, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id) });
const { makeStore: makeRhythmStore } = require('../src/io');
const { attachReminders } = require('../src/reminders/host');
const { makeApi, summarize } = require('../src/api');
const { mergeSettings } = require('../src/settings-merge');

const TODAY = '2026-10-22';
const LOG = `Rhythm/Log/${TODAY}.md`;

function makeVault(files) {
  const store = new Map(Object.entries(files));
  const folders = new Set(['Rhythm', 'Rhythm/Log', 'Rhythm/Practices', 'Rhythm/Areas', 'Rhythm/Goals', 'Rhythm/Events']);
  const reads = [];
  const fileOf = p => ({ path: p, name: p.split('/').pop(), basename: p.split('/').pop().replace(/\.md$/, ''), extension: 'md' });
  const v = {
    store, reads,
    getFileByPath: p => (store.has(p) ? fileOf(p) : null),
    getFolderByPath: p => {
      if (!folders.has(p) && ![...store.keys()].some(k => k.startsWith(p + '/'))) return null;
      return { path: p, children: [...store.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(fileOf) };
    },
    cachedRead: async f => { reads.push(f.path); return store.get(f.path); },
    read: async f => store.get(f.path),
    process: async (f, fn) => { const t = fn(store.get(f.path)); store.set(f.path, t); return t; },
    modify: async (f, t) => { store.set(f.path, t); },
    create: async (p, t) => { if (store.has(p)) throw new Error('exists'); store.set(p, t); return fileOf(p); },
    createFolder: async p => { folders.add(p); },
    on: () => ({}),
  };
  return v;
}

const vault = makeVault({
  'Reminders.md': '## Home\n- [ ] Water plants 📅 2026-10-20\n- [ ] Phone the dentist ⏫ 📅 2026-10-22\n- [ ] Pay rates 📅 2026-10-25\n- [ ] Someday thing\n- [x] Old 📅 2026-10-01 ✅ 2026-10-01\n',
  'Rhythm/Areas/Body.md': '---\nrhythm: area\norder: 1\n---\n',
  'Rhythm/Practices/Walk.md': '---\nrhythm: practice\narea: "[[Body]]"\ncadence: daily\n---\n',
  'Rhythm/Practices/Stretch.md': '---\nrhythm: practice\narea: Body\ncadence: daily\n---\n',
  'Rhythm/Events/Dentist.md': '---\nrhythm: event\narea: Body\ndate: 2026-10-24\ntime: "09:00"\n---\n',
  'Rhythm/Events/Braai.md': '---\nrhythm: event\ndate: 2026-10-24\n---\n',
  'Rhythm/Events/Last month.md': '---\nrhythm: event\ndate: 2026-09-01\n---\n',
});

let refreshed = 0;
const plugin = {
  app: { vault, workspace: { on: () => ({}), onLayoutReady: () => {}, getLeavesOfType: () => [] } },
  settings: mergeSettings({ weekStart: 1, focusCount: 3 }, {}, TODAY).settings,
  registerEvent() {}, registerInterval() {},
  forEachEmbed: () => false,
  saveSettings: async () => {},
};
plugin.rhythmStore = makeRhythmStore(plugin);
plugin.rhythmStoreFor = () => plugin.rhythmStore;
const made = makeApi(plugin);
plugin.changed = () => made.notify();
plugin.reminders = attachReminders(plugin);
plugin.reminders.refreshViews = () => { refreshed++; };
plugin.reminders.updateBadge = () => {};
const api = made.api;
const wait = ms => new Promise(r => setTimeout(r, ms));
const isPlain = v => v === null || ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every(isPlain))
  || (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(isPlain));

(async () => {
  assert.strictEqual(api.apiVersion, 1);
  assert.strictEqual(api.weekStart(), 1);
  assert.strictEqual(api.reminders.notePath(), 'Reminders.md');

  /* ---- reminders.summary ---- */
  const s = await api.reminders.summary({ today: TODAY, limit: 2 });
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.path, 'Reminders.md');
  assert.deepStrictEqual(s.rows.map(r => r.title), ['Water plants', 'Phone the dentist'], 'overdue, then today');
  assert.deepStrictEqual(s.counts, { overdue: 1, today: 1, due: 2, ahead: 1, someday: 1, open: 4 });
  assert.strictEqual(s.more, 2);
  assert.ok(s.rows.every(r => typeof r.ref === 'string' && r.ref.length), 'every row has a ref');
  assert.ok(isPlain(s), 'nothing live leaves the plugin');
  /* the same picking as Vista's own summarize did */
  const items = (await plugin.reminders.store.load()).items;
  assert.deepStrictEqual(summarize(items, TODAY, 2).rows.map(r => r.title), s.rows.map(r => r.title));

  /* ---- reminders.toggle / snooze: by ref, checked against the note now ---- */
  let heard = 0;
  const off = api.onChange(() => { heard++; });
  const water = s.rows[0];
  assert.strictEqual((await api.reminders.toggle(water.ref, { today: TODAY })).ok, true, 'the store\'s own result comes back');
  assert.ok(/- \[x\] Water plants/.test(vault.store.get('Reminders.md')), 'ticked in the note');
  assert.strictEqual(refreshed, 1, 'the boards were told');
  assert.deepStrictEqual(await api.reminders.toggle(water.ref, { today: TODAY }), { ok: false, reason: 'changed' }, 'the same row again: it changed, refuse');
  assert.deepStrictEqual(await api.reminders.snooze(water.ref, 1, { today: TODAY }), { ok: false, reason: 'changed' });
  assert.deepStrictEqual(await api.reminders.toggle('not a ref', { today: TODAY }), { ok: false, reason: 'bad-ref' });
  const dentist = s.rows[1];
  const snoozed = await api.reminders.snooze(dentist.ref, 3, { today: TODAY });
  assert.strictEqual(snoozed.ok, true);
  assert.ok(vault.store.get('Reminders.md').includes('Phone the dentist ⏫ 📅 2026-10-25'), 'snoozed three days from today');
  await wait(400);
  assert.strictEqual(heard, 1, 'the listener heard of the two writes once');

  /* ---- practices.today / tick ---- */
  const t = await api.practices.today({ date: TODAY });
  assert.strictEqual(t.available, true);
  assert.deepStrictEqual(t.focus.map(r => r.name).sort(), ['Stretch', 'Walk']);
  assert.strictEqual(t.focus.find(r => r.name === 'Walk').area, 'Body', 'the area link is read as its name');
  assert.strictEqual(t.folder, 'Rhythm');
  assert.ok(isPlain(t));
  const walk = t.focus.find(r => r.name === 'Walk');
  const tick = await api.practices.tick(walk.ref, true);
  assert.deepStrictEqual(tick, { ok: true, path: LOG, prev: { done: false, skip: false, snooze: false, plan: false } });
  assert.strictEqual(vault.store.get(LOG), '---\nrhythm: log\ndone: [Walk]\n---\n');
  assert.strictEqual((await api.practices.today({ date: TODAY })).done, 1);
  assert.deepStrictEqual(await api.practices.tick(walk.ref, false), { ok: true, path: LOG, prev: { done: true, skip: false, snooze: false, plan: false } });

  /* a log line the reader cannot read: refused, untouched */
  const bad = '---\nrhythm: log\ndone: [Walk,\n  Read]\n---\n';
  vault.store.set(LOG, bad);
  assert.deepStrictEqual(await api.practices.tick(walk.ref, true), { ok: false, reason: 'unreadable', key: 'done' });
  assert.strictEqual(vault.store.get(LOG), bad);
  vault.store.delete(LOG);

  /* the practice was renamed since the row was read */
  const stretch = t.focus.find(r => r.name === 'Stretch');
  vault.store.set('Rhythm/Practices/Stretching.md', vault.store.get('Rhythm/Practices/Stretch.md'));
  vault.store.delete('Rhythm/Practices/Stretch.md');
  assert.deepStrictEqual(await api.practices.tick(stretch.ref, true), { ok: false, reason: 'changed' });
  assert.ok(!vault.store.has(LOG), 'nothing written');
  assert.deepStrictEqual(await api.practices.tick('{"k":"r"}', true), { ok: false, reason: 'bad-ref' }, 'a reminder ref is not a practice ref');

  /* ---- events.between ---- */
  vault.reads.length = 0;
  const ev = await api.events.between('2026-10-01', '2026-10-31');
  assert.deepStrictEqual(ev.map(e => [e.date, e.time, e.name]), [['2026-10-24', '', 'Braai'], ['2026-10-24', '09:00', 'Dentist']], 'in range, all-day first, then by time');
  assert.ok(!vault.reads.some(p => p.includes('/Log/')), 'no log note is read for events');
  assert.deepStrictEqual(await api.events.between('nope', '2026-10-31'), []);

  /* ---- no reminders note: not available ---- */
  vault.store.delete('Reminders.md');
  assert.deepStrictEqual(await api.reminders.summary({ today: TODAY }), { available: false, path: 'Reminders.md', rows: [], buckets: null, counts: null, more: 0 });

  off();
  heard = 0;
  made.notify();
  await wait(300);
  assert.strictEqual(heard, 0, 'an unsubscribed listener hears nothing');
  plugin.reminders.unload();
  made.stop();
  console.log('api OK');
})().catch(e => { console.error(e); process.exit(1); });
