'use strict';
/* The merged plugin as Obsidian sees it, run against the BUILT main.js (so it
   needs a build): one view, one ribbon icon carrying the reminders badge
   class, the 17 commands, both link handlers (rhythm and the old
   nudge-reminders), the api on the instance, and the one-time import of the
   old Nudge and Fortnight settings — read, never written. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const bundlePath = path.join(__dirname, '..', 'main.js');
assert.ok(fs.existsSync(bundlePath), 'main.js missing — run ./build.sh');

/* What the old plugins left in .obsidian/plugins/<id>/data.json. */
const OLD = {
  '.obsidian/plugins/nudge-reminders/data.json': JSON.stringify({
    file: 'Admin/Reminders.md', name: 'Ruan', surface: 'glass', tint: 'dusk', mode: 'dark', weekStart: 0,
    openOnStartup: true, icsFile: 'Admin/reminders.ics', calendarName: 'Nudge', autoExport: true, alarmMinutes: 15, onboarded: true,
  }),
  '.obsidian/plugins/fortnight-planner/data.json': JSON.stringify({
    name: 'Someone else', accent: 'blue', weekStart: 0, plannerNote: 'Plans/Two weeks.md', laterTag: '#someday', showWelcome: false, lastWelcome: '2026-10-21',
  }),
};

class Plugin {
  constructor() {
    this.views = {}; this.commands = []; this.ribbons = []; this.opened = []; this.protocols = {}; this.saved = [];
    this.data = { folder: 'Rhythm', weekStart: 1, openOnStartup: false, accent: 'ocean' };
    const self = this;
    const ribbonEl = { classes: [], classList: { add(c) { ribbonEl.classes.push(c); } }, querySelector: () => null, appendChild() {} };
    this.ribbonEl = ribbonEl;
    this.app = {
      workspace: {
        getLeavesOfType: () => [],
        getLeaf: () => ({ setViewState: async s => { self.opened.push(s); }, view: null }),
        revealLeaf: async () => {},
        onLayoutReady: fn => fn(),
        on: () => ({}),
      },
      vault: {
        on: () => ({}), getMarkdownFiles: () => [], getFileByPath: () => null, getFolderByPath: () => null,
        configDir: '.obsidian',
        adapter: {
          exists: async p => p in OLD,
          read: async p => OLD[p],
          write: async () => { throw new Error('the old plugins\' files must never be written'); },
        },
      },
      metadataCache: { on: () => ({}) },
    };
  }
  registerView(type, factory) { this.views[type] = factory; }
  addCommand(c) { this.commands.push(c); }
  addRibbonIcon(icon, title, cb) { this.ribbons.push({ icon, title, cb }); return this.ribbonEl; }
  addSettingTab() {}
  registerEvent() {}
  registerInterval(id) { clearInterval(id); return id; }
  registerObsidianProtocolHandler(action, fn) { this.protocols[action] = fn; }
  async loadData() { return this.data; }
  async saveData(d) { this.saved.push(JSON.parse(JSON.stringify(d))); this.data = d; }
}
const stub = {
  Plugin, ItemView: class ItemView { constructor(leaf) { this.leaf = leaf; } },
  PluginSettingTab: class PluginSettingTab {}, Setting: class Setting {}, Notice: class Notice {},
  Modal: class Modal {}, Menu: class Menu {}, FuzzySuggestModal: class FuzzySuggestModal {}, setIcon: () => {},
  normalizePath: p => String(p).replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, ''), Platform: { isMobile: false },
  requestUrl: async () => ({ text: '' }),
};
global.window = globalThis;
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? stub : origLoad.call(this, request, ...rest); };

(async () => {
  try {
    const RhythmPlugin = require(bundlePath);
    const p = new RhythmPlugin();
    await p.onload();

    /* one view, one ribbon */
    assert.deepStrictEqual(Object.keys(p.views), ['rhythm-view']);
    const view = p.views['rhythm-view']({});
    assert.strictEqual(view.getDisplayText(), 'Rhythm');
    assert.deepStrictEqual(p.ribbons.map(r => r.icon), ['compass']);
    assert.deepStrictEqual(p.ribbonEl.classes, ['nd-ribbon'], 'the reminders badge is positioned against Rhythm\'s icon');

    /* the commands (Q17) */
    assert.deepStrictEqual(p.commands.map(c => c.id).sort(), [
      'add', 'copy-deep-link', 'fortnight-review', 'fortnight-welcome', 'open', 'open-fortnight', 'open-plan',
      'open-reminders', 'open-today', 'refresh-calendars', 'reminders-add', 'reminders-add-dialog',
      'reminders-export-ics', 'reminders-lift-times', 'reminders-open-note', 'review-week', 'write-note',
    ]);
    assert.ok(!p.commands.some(c => /nudge|rhythm:/i.test(c.name)), 'no command names the old plugin, or repeats Rhythm');

    /* links: rhythm, and the old Nudge one */
    assert.deepStrictEqual(Object.keys(p.protocols).sort(), ['nudge-reminders', 'rhythm']);

    /* the open commands open the view on their page */
    assert.deepStrictEqual(p.opened, [{ type: 'rhythm-view', active: true, state: {} }], 'open on startup (imported from Nudge) opened it once');
    await p.commands.find(c => c.id === 'open-fortnight').callback();
    assert.deepStrictEqual(p.opened[1], { type: 'rhythm-view', active: true, state: { page: 'fortnight' } });

    /* the api */
    assert.strictEqual(p.api.apiVersion, 1);
    assert.strictEqual(p.api.weekStart(), 1);
    assert.strictEqual(p.api.reminders.notePath(), 'Admin/Reminders.md', 'the imported reminders note');

    /* the import (Q4 / Q15) */
    const s = p.settings;
    assert.strictEqual(s.weekStart, 1, 'week start stays Rhythm\'s');
    assert.strictEqual(s.accent, 'ocean', 'Rhythm\'s look stays');
    assert.strictEqual(s.name, 'Ruan', 'the name is Nudge\'s, ahead of Fortnight\'s');
    assert.strictEqual(s.openOnStartup, true, 'open on startup: Nudge had it on');
    assert.strictEqual(s.reminders.file, 'Admin/Reminders.md');
    assert.strictEqual(s.reminders.icsFile, 'Admin/reminders.ics');
    assert.strictEqual(s.reminders.calendarName, 'Nudge', 'the phone feed keeps its calendar name');
    assert.strictEqual(s.reminders.onboarded, true);
    assert.ok(!('surface' in s.reminders) && !('tint' in s.reminders) && !('mode' in s.reminders), 'Nudge\'s look is not imported');
    assert.strictEqual(s.planner.plannerNote, 'Plans/Two weeks.md');
    assert.strictEqual(s.planner.laterTag, '#someday');
    assert.strictEqual(s.planner.showWelcome, false);
    assert.ok(!('accent' in s.planner), 'Fortnight\'s accent is not imported');
    assert.deepStrictEqual(Object.keys(s.imported).sort(), ['fortnight-planner', 'nudge-reminders']);
    assert.strictEqual(p.saved.length, 1, 'the import is saved once');

    /* the modules see their own settings, the shared ones from the top */
    assert.strictEqual(p.reminders.settings.surface, 'plain', 'Nudge borrows the (re-pointed) theme colours');
    assert.strictEqual(p.reminders.settings.name, 'Ruan');
    assert.strictEqual(p.planner.settings.accent, 'theme');
    assert.strictEqual(p.planner.settings.weekStart, 1);

    /* a second load does not import again, even though the old files are still there */
    const again = new RhythmPlugin();
    again.data = Object.assign({}, p.data, { name: 'Changed here' });
    await again.onload();
    assert.strictEqual(again.settings.name, 'Changed here', 'a change made here is not undone by the old file');
    assert.strictEqual(again.saved.length, 0);
    again.onunload();
    p.onunload();

    console.log('plugin shell OK');
  } finally {
    Module._load = origLoad;
  }
})().catch(e => { console.error(e); process.exit(1); });
