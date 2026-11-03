'use strict';
/* The phone's calendar feed survives the merge byte for byte (decision Q8):
   same file, same event UIDs, same text — so a phone subscribed to it sees
   no duplicate events and needs no re-subscription.

   tests/fixtures/feed-nudge-1f57083.ics is what the Nudge plugin itself
   (nudge-vault main at 1f57083, the last commit before the merge) wrote for
   tests/fixtures/feed-note.md at 2026-10-22 18:30 UTC, with the settings
   Rhythm imports from Nudge's data.json. Here the merged reminders module
   writes the same note, through its host, at the same instant. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('./reminders-_stub.cjs');
global.window = { setInterval: () => 1, setTimeout: () => 1, clearTimeout: () => {} };
const { attachReminders } = require('../src/reminders/host');
const { mergeSettings } = require('../src/settings-merge');

const note = fs.readFileSync(path.join(__dirname, 'fixtures', 'feed-note.md'), 'utf8');
const golden = fs.readFileSync(path.join(__dirname, 'fixtures', 'feed-nudge-1f57083.ics'), 'utf8');

const files = new Map([['Reminders.md', note]]);
const vault = {
  getFileByPath: p => (files.has(p) ? { path: p } : null), getFolderByPath: () => ({ path: '' }),
  read: async f => files.get(f.path), cachedRead: async f => files.get(f.path),
  modify: async (f, t) => { files.set(f.path, t); }, process: async (f, fn) => { const t = fn(files.get(f.path)); files.set(f.path, t); return t; },
  create: async (p, t) => { files.set(p, t); return { path: p }; }, createFolder: async () => {}, on: () => ({}),
};

(async () => {
  /* The settings as Rhythm holds them after importing Nudge's. */
  const { settings } = mergeSettings({}, {
    'nudge-reminders': { file: 'Reminders.md', icsFile: 'Admin/reminders.ics', calendarName: 'Nudge', alarmMinutes: 15, allDayAlarmTime: '08:00' },
  }, '2026-10-22');
  const plugin = { app: { vault }, settings, registerEvent() {}, registerInterval() {}, forEachEmbed: () => false, changed() {}, saveSettings: async () => {} };
  const host = attachReminders(plugin);
  const r = await host.store.exportICS(new Date(Date.UTC(2026, 9, 22, 18, 30, 0)));
  assert.strictEqual(r.path, 'Admin/reminders.ics', 'the same file');
  assert.strictEqual(r.count, 4);
  assert.strictEqual(files.get('Admin/reminders.ics'), golden, 'byte for byte what Nudge wrote');
  host.unload();
  console.log('reminders feed OK');
})().catch(e => { console.error(e); process.exit(1); });
