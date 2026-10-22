'use strict';
/* mergeSettings: one data.json for three modules, and the once-only import of
   the old Nudge and Fortnight settings (decisions Q4, Q14, Q15). */
const assert = require('node:assert');
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? { normalizePath: p => p } : origLoad.call(this, request, ...rest); };
const { mergeSettings, scopedSettings, MODULE_DEFAULTS, PINS } = require('../src/settings-merge');
const { DEFAULT_SETTINGS: RHYTHM } = require('../src/constants');

const T = '2026-10-22';

/* nothing saved, no old plugins: defaults, nothing to save */
{
  const { settings: s, changed } = mergeSettings(null, {}, T);
  assert.strictEqual(changed, false);
  assert.strictEqual(s.folder, RHYTHM.folder);
  assert.strictEqual(s.name, '');
  assert.deepStrictEqual(s.reminders, MODULE_DEFAULTS.reminders);
  assert.deepStrictEqual(s.planner, MODULE_DEFAULTS.planner);
  assert.deepStrictEqual(s.imported, {}, 'an absent old file is not marked: installing its data later still imports it');
}

/* the retired keys never enter a module namespace */
for (const k of ['name', 'openOnStartup', 'weekStart', 'surface', 'tint', 'mode']) assert.ok(!(k in MODULE_DEFAULTS.reminders), `reminders has no ${k}`);
for (const k of ['name', 'weekStart', 'accent']) assert.ok(!(k in MODULE_DEFAULTS.planner), `planner has no ${k}`);

/* name: Nudge's, else Fortnight's, only while blank */
{
  const a = mergeSettings({}, { 'nudge-reminders': { name: '  ' }, 'fortnight-planner': { name: 'Fen' } }, T).settings;
  assert.strictEqual(a.name, 'Fen', 'a blank Nudge name falls through to Fortnight\'s');
  const b = mergeSettings({ name: 'Kept' }, { 'nudge-reminders': { name: 'Nudge' } }, T).settings;
  assert.strictEqual(b.name, 'Kept', 'a name already set here wins');
}

/* openOnStartup: on if either was on; never switched off by an import */
{
  assert.strictEqual(mergeSettings({ openOnStartup: true }, { 'nudge-reminders': { openOnStartup: false } }, T).settings.openOnStartup, true);
  assert.strictEqual(mergeSettings({ openOnStartup: false }, { 'nudge-reminders': { openOnStartup: true } }, T).settings.openOnStartup, true);
  assert.strictEqual(mergeSettings({}, { 'fortnight-planner': { openOnStartup: true } }, T).settings.openOnStartup, false, 'Fortnight had no such setting');
}

/* weekStart and the look stay Rhythm's */
{
  const s = mergeSettings({ weekStart: 1, accent: 'ocean' }, { 'nudge-reminders': { weekStart: 0, tint: 'dusk' }, 'fortnight-planner': { weekStart: 0, accent: 'blue' } }, T).settings;
  assert.strictEqual(s.weekStart, 1);
  assert.strictEqual(s.accent, 'ocean');
  assert.ok(!('tint' in s.reminders) && !('accent' in s.planner));
}

/* once only: the stamp stops a second import, and what was saved is kept */
{
  const first = mergeSettings({}, { 'fortnight-planner': { laterFolders: ['A'], plannerNote: 'P.md' } }, T);
  assert.strictEqual(first.changed, true);
  assert.deepStrictEqual(first.settings.imported, { 'fortnight-planner': T });
  first.settings.planner.plannerNote = 'Changed.md';
  const saved = JSON.parse(JSON.stringify(first.settings));
  const again = mergeSettings(saved, { 'fortnight-planner': { plannerNote: 'P.md' } }, '2026-10-23');
  assert.strictEqual(again.changed, false);
  assert.strictEqual(again.settings.planner.plannerNote, 'Changed.md', 'the old file does not undo a change made here');
  assert.deepStrictEqual(again.settings.imported, { 'fortnight-planner': T });
}

/* arrays are copied, not shared with the old plugin's object */
{
  const old = { laterFolders: ['A'] };
  const s = mergeSettings({}, { 'fortnight-planner': old }, T).settings;
  s.planner.laterFolders.push('B');
  assert.deepStrictEqual(old.laterFolders, ['A']);
}

/* a key the module dropped long ago is not imported; one it still has is */
{
  const s = mergeSettings({}, { 'nudge-reminders': { notAKey: 1, alarmMinutes: 30 } }, T).settings;
  assert.ok(!('notAKey' in s.reminders));
  assert.strictEqual(s.reminders.alarmMinutes, 30);
}

/* scopedSettings: own namespace, shared keys at the top, pins fixed */
{
  const plugin = { settings: mergeSettings({ name: 'R' }, {}, T).settings };
  const r = scopedSettings(plugin, 'reminders', PINS.reminders);
  assert.strictEqual(r.name, 'R');
  assert.strictEqual(r.mode, 'auto');
  r.alarmMinutes = 5;
  assert.strictEqual(plugin.settings.reminders.alarmMinutes, 5);
  r.openOnStartup = true;
  assert.strictEqual(plugin.settings.openOnStartup, true);
  assert.ok('file' in r && 'name' in r && 'surface' in r);
  assert.ok(Object.keys(r).includes('file'));
  const copy = Object.assign({}, r);
  assert.strictEqual(copy.surface, 'plain', 'spreads see the pinned value');
}

console.log('settings merge OK');
