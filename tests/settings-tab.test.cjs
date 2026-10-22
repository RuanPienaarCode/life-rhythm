'use strict';
/* The settings tab, driven through a minimal fake of the Obsidian widgets:
   a custom accent hex is only saved when it parses (and the preset row
   follows it), the calendar status line reports a failed first fetch, and
   every control carries an accessible name. */
process.env.TZ = 'Africa/Johannesburg';
const assert = require('node:assert');
const Module = require('node:module');

class El {
  constructor(tag, opts) {
    this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {};
    this.cls = (opts && opts.cls) || ''; this.text = (opts && opts.text) || '';
  }
  createEl(tag, opts) { const e = new El(tag, opts); this.children.push(e); return e; }
  createDiv(opts) { return this.createEl('div', opts); }
  createSpan(opts) { return this.createEl('span', opts); }
  empty() { this.children = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { this.listeners[t] = f; }
  setText(t) { this.text = t; }
  all(out = []) { out.push(this); for (const c of this.children) c.all(out); return out; }
  hasCls(c) { return this.cls.split(/\s+/).includes(c); }
}

const settingsMade = [];
class Setting {
  constructor(containerEl) {
    this.name = ''; this.desc = ''; this.controls = [];
    this.controlEl = new El('div');
    containerEl.children.push(this.controlEl);
    this.controlEl.setting = this;
    settingsMade.push(this);
  }
  setName(n) { this.name = n; return this; }
  setDesc(d) { this.desc = d; return this; }
  _comp(kind, extra) {
    const inputEl = new El(kind === 'button' ? 'button' : 'input');
    const comp = Object.assign({
      kind, inputEl, sliderEl: inputEl, selectEl: inputEl, toggleEl: inputEl, buttonEl: inputEl,
      setPlaceholder() { return this; }, setValue(v) { this.value = v; return this; },
      onChange(f) { this.change = f; return this; }, setDynamicTooltip() { return this; },
      setLimits() { return this; }, addOption() { return this; }, setButtonText() { return this; },
      onClick(f) { this.click = f; return this; }, setDisabled() { return this; },
    }, extra);
    this.controls.push(comp);
    return comp;
  }
  addText(f) { f(this._comp('text')); return this; }
  addTextArea(f) { f(this._comp('textarea')); return this; }
  addSlider(f) { f(this._comp('slider')); return this; }
  addDropdown(f) { f(this._comp('dropdown')); return this; }
  addToggle(f) { f(this._comp('toggle')); return this; }
  addButton(f) { f(this._comp('button')); return this; }
}
class PluginSettingTab { constructor(app) { this.app = app; this.containerEl = new El('div'); } }
const stub = { normalizePath: p => String(p).replace(/\/+/g, '/'), PluginSettingTab, Setting, Notice: class {}, requestUrl: async () => ({ status: 500, text: '' }) };
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'obsidian' ? stub : orig.call(this, req, ...rest); };
const { RhythmSettingTab } = require('../src/settings-tab');
Module._load = orig;

function makeTab(over) {
  const plugin = {
    settings: Object.assign({
      folder: 'Rhythm', focusCount: 3, weekStart: 1, streakMode: 'days', showPrompt: true, accent: 'slate', accentHex: '',
      background: 'none', backgroundDim: 0, todayView: 'list', softEntrance: true, openOnStartup: false,
      calendarUrls: '', calendarCache: null,
    }, over),
    saves: 0, refreshes: 0,
    async saveSettings() { this.saves++; },
    refreshViews() { this.refreshes++; },
    app: { vault: { getFolderByPath: () => null, getFileByPath: () => null } },
  };
  const tab = new RhythmSettingTab(plugin.app, plugin);
  return { plugin, tab };
}
const settingNamed = n => settingsMade.slice().reverse().find(s => s.name === n);
const dotsOf = tab => tab.containerEl.all().filter(e => e.hasCls('rv-accent-dot'));
const onDots = tab => dotsOf(tab).filter(e => e.hasCls('is-on')).map(e => e.attrs['aria-label']);

(async () => {
  let ctx;
  try { ctx = makeTab(); ctx.tab.display(); } catch (e) { console.error('display() failed against the fake widgets:', e); process.exit(1); }

  /* ---- custom accent hex ---- */
  {
    const { plugin, tab } = makeTab({ accent: 'slate' });
    tab.display();
    const hex = settingNamed('Or a colour of your own').controls[0];
    assert.deepStrictEqual(onDots(tab), ['Slate']);
    for (const typed of ['#', '#c', '#c0', '#c03', '#c039', '#c0392', '#c0392b']) {
      await hex.change(typed);
      assert.ok(plugin.settings.accentHex === '' || /^#[0-9a-f]{6}$/.test(plugin.settings.accentHex), `only valid hex is stored (after "${typed}": ${plugin.settings.accentHex})`);
    }
    assert.strictEqual(plugin.settings.accentHex, '#c0392b');
    assert.strictEqual(plugin.settings.accent, 'custom');
    assert.deepStrictEqual(onDots(tab), ['Custom'], 'the preset row followed the change: Custom shows, Slate is off');
    const savesBefore = plugin.saves;
    await hex.change('#c0392');
    assert.strictEqual(plugin.settings.accentHex, '#c0392b', 'deleting a character keeps the last valid colour');
    assert.strictEqual(plugin.settings.accent, 'custom');
    assert.deepStrictEqual(onDots(tab), ['Custom']);
    await hex.change('');
    await hex.change('not a colour');
    assert.strictEqual(plugin.settings.accentHex, '#c0392b', 'junk never replaces it');
    assert.strictEqual(plugin.saves, savesBefore, 'an invalid value saves nothing');
    await hex.change('abc');
    assert.strictEqual(plugin.settings.accentHex, '#aabbcc', 'a bare short hex is accepted');
    assert.strictEqual(dotsOf(tab).filter(e => e.hasCls('rv-accent-dot')).length, 11, '10 presets + one Custom dot, never duplicated');
  }

  /* ---- calendar status line ---- */
  {
    const { tab } = makeTab({ calendarCache: null });
    tab.display();
    assert.strictEqual(settingNamed('Refresh now').desc, 'Not fetched yet.');
  }
  {
    const { tab } = makeTab({ calendarUrls: 'https://x.example/a.ics', calendarCache: { lastAttemptAt: Date.now() - 120000, events: [], errors: ['https://x.example/a.ics: HTTP 500'] } });
    tab.display();
    assert.strictEqual(settingNamed('Refresh now').desc, "Couldn't load: 1 link(s) — last tried 2 min ago.");
  }

  /* ---- every control has an accessible name ---- */
  {
    const { tab } = makeTab({ calendarCache: null });
    tab.display();
    const names = new Set();
    for (const s of settingsMade.slice(-20)) {
      for (const c of s.controls) {
        if (!['text', 'textarea', 'slider', 'dropdown', 'toggle'].includes(c.kind)) continue;
        const label = c.inputEl.attrs['aria-label'];
        assert.ok(label && label.trim(), `"${s.name}" ${c.kind} has an aria-label`);
        names.add(label);
      }
    }
    assert.ok(names.size >= 10, 'labels exist for every setting input');
    for (const e of tab.containerEl.all()) {
      if (e.tag !== 'button') continue;
      assert.ok(e.text || e.attrs['aria-label'] || e.children.some(c => c.text), 'every raw button is named');
    }
  }
  console.log('settings-tab OK');
})().catch(e => { console.error(e); process.exit(1); });
