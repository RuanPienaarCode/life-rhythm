'use strict';
/* Ruan's rule (3 Nov 2026): no AI on mobile. Platform.isMobile is true on a
   phone AND an iPad. Run against the BUILT main.js (needs a build), the whole
   plugin as Obsidian loads it:
   - mobile: no plugin.ai, canAsk() false, no AI command, no Ask AI setting
     or key field, no request to any AI service;
   - computer: Ask AI is there as before (ai, the settings, the toggle).
   Plus source guards: every "Ask AI about this" menu entry sits behind
   canAsk(), and the round button is only mounted when plugin.ai exists. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const bundlePath = path.join(root, 'main.js');
assert.ok(fs.existsSync(bundlePath), 'main.js missing — run ./build.sh');

const requests = [];
const settingsMade = [];
class El {
  constructor(opts) { this.children = []; this.style = {}; this.attrs = {}; this.text = (opts && opts.text) || ''; this.classList = { add() {}, remove() {}, toggle() {} }; }
  createEl(tag, opts) { const e = new El(opts); e.tag = tag; this.children.push(e); return e; }
  createDiv(o) { return this.createEl('div', o); }
  createSpan(o) { return this.createEl('span', o); }
  empty() { this.children = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
  setText(t) { this.text = t; }
  all(out = []) { out.push(this); for (const c of this.children) c.all(out); return out; }
}
class Setting {
  constructor(containerEl) { this.name = ''; this.controlEl = new El(); containerEl.children.push(this.controlEl); settingsMade.push(this); }
  setName(n) { this.name = n; return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  setClass() { return this; }
  setTooltip() { return this; }
  _c() { const inputEl = new El(); return { inputEl, toggleEl: inputEl, selectEl: inputEl, sliderEl: inputEl, buttonEl: inputEl, setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; }, setDynamicTooltip() { return this; }, setLimits() { return this; }, addOption() { return this; }, setButtonText() { return this; }, onClick() { return this; }, setDisabled() { return this; } }; }
  addText(f) { f(this._c()); return this; }
  addTextArea(f) { f(this._c()); return this; }
  addSlider(f) { f(this._c()); return this; }
  addDropdown(f) { f(this._c()); return this; }
  addToggle(f) { f(this._c()); return this; }
  addButton(f) { f(this._c()); return this; }
}
class Plugin {
  constructor() {
    this.commands = [];
    this.data = { folder: 'Rhythm', weekStart: 1, openOnStartup: false };
    this.app = {
      workspace: { getLeavesOfType: () => [{ view: {} }], getLeaf: () => ({}), revealLeaf: async () => {}, onLayoutReady: fn => fn(), on: () => ({}) },
      vault: { on: () => ({}), getMarkdownFiles: () => [], getFileByPath: () => null, getFolderByPath: () => null, configDir: '.obsidian', adapter: { exists: async () => false, read: async () => '', write: async () => {} } },
      metadataCache: { on: () => ({}) },
    };
  }
  registerView() {} addCommand(c) { this.commands.push(c); } addRibbonIcon() { return { classList: { add() {} }, querySelector: () => null, appendChild() {} }; }
  addSettingTab(t) { this.tab = t; } registerEvent() {} registerInterval(id) { clearInterval(id); return id; } registerObsidianProtocolHandler() {}
  async loadData() { return this.data; } async saveData(d) { this.data = d; }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new El(); } }
const stub = {
  Plugin, ItemView: class { constructor(l) { this.leaf = l; } }, PluginSettingTab, Setting, Notice: class {}, Modal: class {}, Menu: class {},
  FuzzySuggestModal: class {}, setIcon: () => {}, normalizePath: p => String(p).replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, ''),
  Platform: { isMobile: false, isDesktopApp: true, isPhone: false },
  requestUrl: async o => { requests.push(o); return { status: 200, text: '{}', json: {} }; },
};
global.window = globalThis;
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? stub : origLoad.call(this, request, ...rest); };

const boot = async mobile => {
  stub.Platform.isMobile = mobile; stub.Platform.isPhone = mobile; stub.Platform.isDesktopApp = !mobile;
  const Rhythm = require(bundlePath);
  const p = new Rhythm();
  await p.onload();
  return p;
};
const askSettings = () => settingsMade.filter(s => /Ask AI|AI on this device|API key|^Model$| app$/.test(s.name));

(async () => {
  try {
    /* ---- mobile ---- */
    {
      const p = await boot(true);
      assert.strictEqual(p.ai, null, 'mobile: no AI object at all');
      assert.strictEqual(p.canAsk(), false, 'mobile: nothing may ask');
      assert.ok(!p.commands.some(c => /\bai\b/i.test(c.id + ' ' + c.name)), 'mobile: no AI command');
      assert.strictEqual(requests.length, 0, 'mobile: no request to any AI service');
      p.onunload();
    }

    /* ---- computer ---- */
    {
      const p = await boot(false);
      assert.ok(p.ai && typeof p.ai.ask === 'function', 'computer: Ask AI is there');
      assert.strictEqual(p.ai.current().id, 'claude-code', 'computer: it starts on the Claude plan via Claude Code');
      assert.strictEqual(p.canAsk(), true, 'computer: an open view can be asked');
      p.onunload();
    }

    /* ---- the settings tab, given what each device's plugin has ---- */
    const { RhythmSettingTab } = require('../src/settings-tab');
    const tabFor = ai => {
      const plugin = { ai, settings: { folder: 'Rhythm', focusCount: 3, weekStart: 1, streakMode: 'days', accent: 'slate', accentHex: '', background: 'none', backgroundDim: 0, todayView: 'list', calendarUrls: '', calendarCache: null, askAi: true }, async saveSettings() {}, refreshViews() {}, app: { vault: { getFolderByPath: () => null, getFileByPath: () => null } } };
      const tab = new RhythmSettingTab(plugin.app, plugin);
      settingsMade.length = 0;
      tab.display();
      return tab;
    };
    {
      const tab = tabFor(null);
      assert.deepStrictEqual(askSettings().map(s => s.name), [], 'mobile: no Ask AI toggle, provider, key, app or model setting');
      const words = tab.containerEl.all().map(e => e.text).join('\n');
      assert.ok(/Ask AI is for your computer/.test(words), 'mobile: Settings says so in one line');
      assert.ok(!/api key|plan you are signed|billed/i.test(words), 'mobile: no key or plan wording');
    }
    {
      const AIP = require('../src/ai/providers');
      tabFor({ device: { desktop: true, key: () => '', binPath: () => '' }, providers: () => AIP.PROVIDERS, current: () => AIP.provider('claude-code'), model: () => '' });
      const names = askSettings().map(s => s.name);
      assert.ok(['Show the Ask AI button', 'AI on this device', 'Claude Code app', 'Model'].every(n => names.includes(n)), `computer: Ask AI settings (${names.join(', ')})`);
    }

    /* ---- source guards ---- */
    const read = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
    for (const f of ['page-now.js', 'widgets.js', 'planner/board.js', 'reminders/board.js']) {
      const lines = read(f).split('\n');
      lines.forEach((ln, i) => {
        if (!/setTitle\('Ask AI about this'\)/.test(ln)) return;
        assert.ok(lines.slice(Math.max(0, i - 3), i).some(l => /canAsk\(\)/.test(l)), `${f}:${i + 1}: "Ask AI about this" sits behind canAsk()`);
      });
    }
    const app = read('app.js');
    assert.ok(/if \(plugin\.ai\) \{\s*askAi = mountAskAi\(/.test(app), 'the round button is only mounted when plugin.ai exists');
    assert.strictEqual((app.match(/mountAskAi\(/g) || []).length, 1, 'one mount point for the round button');
    assert.ok(/canAsk\(\) \{ return !!\(askAi && plugin\.ai/.test(app), 'item menus ask only through a mounted button');
    assert.ok(/canAsk\(\) \{ return !!this\.ai/.test(read('main.js')), 'the module boards ask only when plugin.ai exists');

    console.log('no ai on mobile OK');
  } finally {
    Module._load = origLoad;
  }
})().catch(e => { console.error(e); process.exit(1); });
