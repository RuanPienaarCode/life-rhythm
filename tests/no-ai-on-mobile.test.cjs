'use strict';
/* Ruan's rule (3 Nov 2026): no AI on a real phone or tablet. "Real" is the
   platform's own answer (plan-ai spec 3, 3b): no Platform.isDesktopApp, no
   window.require, no child_process. Obsidian's mobile emulation on a Mac sets
   isMobile / isPhone / isIosApp and leaves isDesktopApp true: there Ask AI
   still shows and works. Run against the BUILT main.js (needs a build), the
   whole plugin as Obsidian loads it:
   - real phone: no plugin.ai, canAsk() false, no AI command, no Ask AI
     setting or key field, no request to any AI service, no app link, and
     Settings says Ask AI runs on the Mac with the Claude or ChatGPT plan;
   - emulation on the Mac: Ask AI is there, plan routes first, default Claude Code;
   - computer: Ask AI is there as before (ai, the settings, the toggle).
   Plus source guards: every "Ask AI about this" menu entry sits behind
   canAsk(), and the round button is only mounted when plugin.ai exists. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { fakeCp, fakeFs, fakeOs } = require('./ai-_fake.cjs');

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

/* Node reachable through window.require, as on a Mac */
const HOME = '/Users/test';
const mods = { child_process: fakeCp(), fs: fakeFs([`${HOME}/.local/bin/claude`, '/opt/homebrew/bin/codex']), os: fakeOs(HOME) };
const PHONE = { isMobile: true, isPhone: true, isIosApp: true, isDesktop: false, isDesktopApp: false };
const EMULATED = { isMobile: true, isPhone: true, isIosApp: true, isDesktop: false, isDesktopApp: true };
const MAC = { isMobile: false, isPhone: false, isIosApp: false, isDesktop: true, isDesktopApp: true };
const boot = async platform => {
  Object.assign(stub.Platform, platform);
  if (platform.isDesktopApp) globalThis.require = n => mods[n]; else delete globalThis.require;
  const Rhythm = require(bundlePath);
  const p = new Rhythm();
  await p.onload();
  return p;
};
const askSettings = () => settingsMade.filter(s => /Ask AI|AI on this device|API key|^Model$| app$/.test(s.name));

(async () => {
  try {
    /* ---- a real phone or tablet ---- */
    {
      const p = await boot(PHONE);
      assert.strictEqual(p.ai, null, 'phone: no AI object at all');
      assert.strictEqual(p.canAsk(), false, 'phone: nothing may ask');
      assert.ok(!p.commands.some(c => /\bai\b/i.test(c.id + ' ' + c.name)), 'phone: no AI command');
      assert.strictEqual(requests.length, 0, 'phone: no request to any AI service');
      p.onunload();
    }

    /* ---- mobile emulation on the Mac: it still shows and works ---- */
    {
      const p = await boot(EMULATED);
      assert.ok(p.ai && typeof p.ai.ask === 'function', 'emulation: Ask AI is there');
      assert.strictEqual(p.ai.current().id, 'claude-code', 'emulation: it starts on the Claude plan');
      assert.deepStrictEqual(p.ai.providers().slice(0, 2).map(x => x.menu), ['Claude plan (Claude Code)', 'ChatGPT plan (Codex)'], 'emulation: the plan routes are first');
      assert.strictEqual(p.canAsk(), true, 'emulation: an open view can be asked');
      p.onunload();
    }

    /* ---- computer ---- */
    {
      const p = await boot(MAC);
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
      assert.deepStrictEqual(askSettings().map(s => s.name), [], 'phone: no Ask AI toggle, provider, key, app or model setting');
      const words = tab.containerEl.all().map(e => e.text).join('\n');
      assert.ok(/Ask AI runs on your Mac with your Claude or ChatGPT plan \(Claude Code or Codex\)/.test(words), 'phone: Settings says so in one line');
      assert.strictEqual(tab.containerEl.all().filter(e => /Ask AI runs on/.test(e.text)).length, 1, 'phone: exactly one such line');
      assert.ok(!/api key|billed|signed in/i.test(words), 'phone: no key field or billing wording');
    }
    {
      const AIP = require('../src/ai/providers');
      tabFor({ device: { desktop: true, key: () => '', binPath: () => '' }, providers: () => AIP.PROVIDERS, current: () => AIP.provider('claude-code'), model: () => '', where: id => ({ path: '/Users/test/.local/bin/' + AIP.provider(id).bin }) });
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

    /* no app link, clipboard handoff or web-chat address anywhere in src */
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(root, 'src')).filter(f => f.endsWith('.js'))) {
      const code = fs.readFileSync(f, 'utf8');
      assert.ok(!/claude:\/\/|chatgpt\.com\/\?q=|claude\.ai\/new/.test(code), `${path.relative(root, f)}: no app-link handoff`);
    }

    console.log('no ai on mobile OK');
  } finally {
    Module._load = origLoad;
  }
})().catch(e => { console.error(e); process.exit(1); });
