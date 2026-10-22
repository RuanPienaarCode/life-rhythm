'use strict';
/* The plugin entry. Guards the seams other plugins write through and the
   things the plugin registers at load:
   - a write made through plugin.store (Vista, Fortnight) refreshes the open
     board and the ribbon badge — the modify handler cannot, because the store
     records every write's text as its own;
   - a write that changed nothing does not;
   - the ribbon node is positioned for the badge, and neither the command nor
     the tooltip repeats the plugin name;
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
const NudgePlugin = require('../src/reminders/main');

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

const ribbon = { classes: [], classList: { add(c) { ribbon.classes.push(c); } } };
const commands = [];
let ribbonTip = null;
const p = new NudgePlugin();
Object.assign(p, {
  app: { vault, workspace: { on: () => ({}), onLayoutReady: () => {}, getLeavesOfType: () => [] } },
  loadData: async () => ({}), registerView() {}, addCommand: c => commands.push(c), addSettingTab() {},
  addRibbonIcon: (icon, tip) => { ribbonTip = tip; return ribbon; },
  registerObsidianProtocolHandler() {}, registerEvent() {}, registerInterval() {},
});

let refreshes = 0;
let badges = 0;
const settle = () => new Promise(r => setTimeout(r, 5));

(async () => {
  await p.onload();
  p.refreshViews = () => { refreshes++; };
  p.updateBadge = () => { badges++; };

  /* ribbon + command names */
  assert.deepStrictEqual(ribbon.classes, ['nd-ribbon'], 'the ribbon node gets the class the badge is positioned against');
  assert.strictEqual(ribbonTip, 'Open reminders board');
  assert.strictEqual(commands.find(c => c.id === 'open').name, 'Open reminders board');
  assert.ok(!commands.some(c => /nudge/i.test(c.name)), 'no command name repeats the plugin name');

  const items = (await p.store.load()).items;

  /* a tick through the seam refreshes the board and the badge */
  const r1 = await p.store.toggle(items[0], '2026-10-01');
  await settle();
  assert.strictEqual(r1.ok, true, 'the seam still returns the store result');
  assert.ok(r1.rolled, 'and the rolled occurrence');
  assert.strictEqual(refreshes, 1, 'a seam write refreshes the open board once');
  assert.strictEqual(badges, 1, 'and the ribbon badge once');

  /* every write method on the seam does */
  const before = refreshes;
  await p.store.add({ title: 'Seam add', due: '2026-10-09', group: 'Home' });
  assert.strictEqual(refreshes, before + 1, 'add refreshes');
  const fresh = (await p.store.load()).items.find(i => i.title === 'Seam add');
  await p.store.snooze(fresh, 1, '2026-10-07');
  await p.store.update(fresh, { title: 'Seam add 2' });
  const f2 = (await p.store.load()).items.find(i => i.title === 'Seam add 2');
  await p.store.setDue(f2, '2026-10-20');
  const f3 = (await p.store.load()).items.find(i => i.title === 'Seam add 2');
  const r4 = await p.store.setDate(f3, 'scheduled', '2026-10-18');
  assert.deepStrictEqual(r4, { ok: true }, 'setDate through the seam returns the store result');
  assert.ok(files.get('Reminders.md').includes('- [ ] Seam add 2 📅 2026-10-20 ⏳ 2026-10-18'), 'and wrote ⏳');
  await p.store.remove((await p.store.load()).items.find(i => i.title === 'Seam add 2'));
  await p.store.addList('Work');
  assert.strictEqual(refreshes, before + 7, 'snooze, update, setDue, setDate, remove and addList each refresh once');
  /* a refused setDate is a write that did not happen */
  const refused = refreshes;
  assert.deepStrictEqual(await p.store.setDate(items[0], 'created', '2026-10-18'), { ok: false });
  assert.strictEqual(refreshes, refused, 'a refused setDate does not refresh');

  /* a write that changed nothing does not */
  const stale = Object.assign({}, items[0], { raw: '- [ ] gone entirely', title: 'gone entirely', line: 40 });
  const noop = refreshes;
  const r2 = await p.store.toggle(stale, '2026-10-01');
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(refreshes, noop, 'a refused write does not refresh');
  const r3 = await p.store.liftTimes();
  assert.strictEqual(r3.changed, 0);
  assert.strictEqual(refreshes, noop, 'liftTimes with nothing to lift does not refresh');

  /* a hand edit still refreshes, through the modify handler */
  const hand = refreshes;
  files.set('Reminders.md', files.get('Reminders.md') + '- [ ] typed by hand\n');
  await fire();
  assert.strictEqual(refreshes, hand + 1, 'a hand edit refreshes through the modify handler');

  /* start-up timer */
  assert.ok(p._startTimer, 'the start-up timer id is kept');
  const id = p._startTimer;
  p.onunload();
  assert.deepStrictEqual(cleared, [id], 'unload clears the start-up timer');
  assert.strictEqual(p._startTimer, null);

  console.log('main.test.cjs ok');
})().catch(e => { console.error(e); process.exit(1); });
