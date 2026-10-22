'use strict';
/* The reminders module's host (once Nudge's plugin class). Guards the seam
   other code writes through and what the host sets up:
   - a write made through host.store refreshes the open boards, the badge
     and tells the api's listeners — the modify handler cannot, because the
     store records every write's text as its own;
   - a write that changed nothing does not;
   - a hand edit still does, through the modify handler;
   - its settings are its own namespace, with the shared keys at the top and
     the look pinned to Rhythm's;
   - the start-up timer is cleared on unload. */
const assert = require('node:assert');
require('./reminders-_stub.cjs');

const cleared = [];
let nextTimer = 100;
global.window = {
  setInterval: () => 1,
  setTimeout: () => ++nextTimer,
  clearTimeout: id => cleared.push(id),
};
const { attachReminders } = require('../src/reminders/host');
const { MODULE_DEFAULTS } = require('../src/settings-merge');

const files = new Map([['Reminders.md', '## Home\n- [ ] Water plants 📅 2026-10-01 🔁 every week\n']]);
let modifyHandler = null;
const fire = () => (modifyHandler ? modifyHandler({ path: 'Reminders.md' }) : undefined);
const vault = {
  getFileByPath: p => (files.has(p) ? { path: p } : null),
  getFolderByPath: () => ({ path: '' }),
  read: async f => files.get(f.path),
  cachedRead: async f => files.get(f.path),
  modify: async (f, t) => { files.set(f.path, t); await fire(); },
  process: async (f, fn) => { const t = fn(files.get(f.path)); files.set(f.path, t); await fire(); return t; },
  create: async (p, t) => { files.set(p, t); return { path: p }; },
  on: (ev, h) => { if (ev === 'modify') modifyHandler = h; return {}; },
};

let changes = 0;
let saves = 0;
const plugin = {
  app: { vault, workspace: { on: () => ({}), onLayoutReady: () => {}, getLeavesOfType: () => [] } },
  settings: { name: 'Ruan', weekStart: 1, openOnStartup: false, reminders: Object.assign({}, MODULE_DEFAULTS.reminders) },
  saveSettings: async () => { saves++; },
  registerEvent() {}, registerInterval() {},
  forEachEmbed: () => false,
  changed() { changes++; },
};

let refreshes = 0;
let badges = 0;
const settle = () => new Promise(r => setTimeout(r, 5));

(async () => {
  const host = attachReminders(plugin);
  host.refreshViews = () => { refreshes++; };
  host.updateBadge = () => { badges++; };

  /* settings: own namespace, shared keys at the top, look pinned */
  assert.strictEqual(host.settings.file, 'Reminders.md');
  assert.strictEqual(host.settings.name, 'Ruan', 'the name is the shared one');
  assert.strictEqual(host.settings.surface, 'plain', 'the look is pinned to borrow Rhythm\'s');
  host.settings.surface = 'glass';
  assert.strictEqual(host.settings.surface, 'plain', 'and cannot be changed back');
  host.settings.defaultGroup = 'Home';
  assert.strictEqual(plugin.settings.reminders.defaultGroup, 'Home', 'a module write lands in its namespace');
  host.settings.name = 'R';
  assert.strictEqual(plugin.settings.name, 'R', 'a shared key lands at the top');
  assert.ok(!('defaultGroup' in plugin.settings), 'and nothing leaks upward');

  const items = (await host.store.load()).items;

  /* a tick through the seam refreshes the board and the badge, and tells the api */
  const r1 = await host.store.toggle(items[0], '2026-10-01');
  await settle();
  assert.strictEqual(r1.ok, true, 'the seam still returns the store result');
  assert.ok(r1.rolled, 'and the rolled occurrence');
  assert.strictEqual(refreshes, 1, 'a seam write refreshes the open board once');
  assert.strictEqual(badges, 1, 'and the ribbon badge once');
  assert.strictEqual(changes, 1, 'and the api\'s listeners once');

  /* every write method on the seam does */
  const before = refreshes;
  await host.store.add({ title: 'Seam add', due: '2026-10-09', group: 'Home' });
  assert.strictEqual(refreshes, before + 1, 'add refreshes');
  const fresh = (await host.store.load()).items.find(i => i.title === 'Seam add');
  await host.store.snooze(fresh, 1, '2026-10-07');
  await host.store.update(fresh, { title: 'Seam add 2' });
  const f2 = (await host.store.load()).items.find(i => i.title === 'Seam add 2');
  await host.store.setDue(f2, '2026-10-20');
  const f3 = (await host.store.load()).items.find(i => i.title === 'Seam add 2');
  const r4 = await host.store.setDate(f3, 'scheduled', '2026-10-18');
  assert.deepStrictEqual(r4, { ok: true }, 'setDate through the seam returns the store result');
  assert.ok(files.get('Reminders.md').includes('- [ ] Seam add 2 📅 2026-10-20 ⏳ 2026-10-18'), 'and wrote ⏳');
  await host.store.remove((await host.store.load()).items.find(i => i.title === 'Seam add 2'));
  await host.store.addList('Work');
  assert.strictEqual(refreshes, before + 7, 'snooze, update, setDue, setDate, remove and addList each refresh once');
  const refused = refreshes;
  assert.deepStrictEqual(await host.store.setDate(items[0], 'created', '2026-10-18'), { ok: false });
  assert.strictEqual(refreshes, refused, 'a refused setDate does not refresh');

  /* a write that changed nothing does not */
  const stale = Object.assign({}, items[0], { raw: '- [ ] gone entirely', title: 'gone entirely', line: 40 });
  const noop = refreshes;
  const noopChanges = changes;
  const r2 = await host.store.toggle(stale, '2026-10-01');
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(refreshes, noop, 'a refused write does not refresh');
  const r3 = await host.store.liftTimes();
  assert.strictEqual(r3.changed, 0);
  assert.strictEqual(refreshes, noop, 'liftTimes with nothing to lift does not refresh');
  assert.strictEqual(changes, noopChanges, 'nor tell the api');

  /* a hand edit still refreshes, through the modify handler */
  const hand = refreshes;
  files.set('Reminders.md', files.get('Reminders.md') + '- [ ] typed by hand\n');
  await fire();
  assert.strictEqual(refreshes, hand + 1, 'a hand edit refreshes through the modify handler');

  /* a board's own store: its writes reach the badge and the api, but do not
     redraw the boards (the board that wrote redraws itself) */
  {
    const board = host.boardStore();
    const before = { refreshes, badges, changes };
    await board.add({ title: 'From the board', due: '2026-10-09', group: 'Home' });
    assert.strictEqual(refreshes, before.refreshes, 'no board redraw');
    assert.strictEqual(badges, before.badges + 1, 'the badge is told');
    assert.strictEqual(changes, before.changes + 1, 'and the api');
    assert.notStrictEqual(board, host.store, 'its own instance');
  }

  /* start-up timer */
  assert.ok(host._startTimer, 'the start-up timer id is kept');
  const id = host._startTimer;
  host.unload();
  assert.deepStrictEqual(cleared, [id], 'unload clears the start-up timer');
  assert.strictEqual(host._startTimer, null);

  console.log('reminders host OK');
})().catch(e => { console.error(e); process.exit(1); });
