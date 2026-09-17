'use strict';
/* Settings tab. */

const { PluginSettingTab, Setting, Notice } = require('obsidian');
const { PROTOCOL } = require('./constants');
const { refreshCalendars } = require('./calendar');
const { PRESETS, DEFAULT_ACCENT, swatchFor, parseHex } = require('./accents');
const BG = require('./backgrounds');

class RhythmSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); this.plugin.refreshViews(); };

    new Setting(containerEl)
      .setName('Folder')
      .setDesc('Where the Areas, Practices, Goals, Events and Log folders live.')
      .addText(t => t.setPlaceholder('Rhythm').setValue(s.folder).onChange(async v => {
        s.folder = (v || '').trim() || 'Rhythm';
        await save();
      }));

    new Setting(containerEl)
      .setName('Things in front of you')
      .setDesc('How many practices Today shows before the rest fold away under "When there\'s space".')
      .addSlider(sl => sl.setLimits(1, 7, 1).setValue(s.focusCount).setDynamicTooltip().onChange(async v => {
        s.focusCount = v;
        await save();
      }));

    new Setting(containerEl)
      .setName('Week starts on')
      .addDropdown(d => d.addOption('1', 'Monday').addOption('0', 'Sunday').setValue(String(s.weekStart)).onChange(async v => {
        s.weekStart = parseInt(v, 10) === 0 ? 0 : 1;
        await save();
      }));

    new Setting(containerEl)
      .setName('Streak')
      .setDesc('"Good weeks" counts a week when at least 60% of what was asked got done, so one sick day does not reset you.')
      .addDropdown(d => d.addOption('days', 'Days in a row').addOption('weeks', 'Good weeks in a row').addOption('off', 'Off').setValue(s.streakMode || 'days').onChange(async v => {
        s.streakMode = v;
        await save();
      }));

    new Setting(containerEl)
      .setName('Stillness line when the list is clear')
      .setDesc('A short verse or prompt instead of an empty page.')
      .addToggle(t => t.setValue(s.showPrompt !== false).onChange(async v => {
        s.showPrompt = v;
        await save();
      }));

    const accentSetting = new Setting(containerEl)
      .setName('Accent')
      .setDesc('The one colour that carries meaning: a tick, a link, today. Each is given a lighter twin for dark mode and a darker one for small text, so every choice stays legible.');
    const row = accentSetting.controlEl.createDiv({ cls: 'rv-accent-row' });
    const current = s.accent || DEFAULT_ACCENT;
    for (const a of PRESETS) {
      const dot = row.createEl('button', { cls: 'rv-accent-dot' + (current === a.id ? ' is-on' : '') });
      dot.type = 'button';
      dot.style.background = swatchFor(a.id);
      dot.setAttribute('aria-label', a.name);
      dot.setAttribute('title', `${a.name} · ${a.hex}`);
      dot.addEventListener('click', async () => {
        s.accent = a.id;
        await save();
        this.display();
      });
    }
    if (current === 'custom') {
      const dot = row.createEl('button', { cls: 'rv-accent-dot is-on' });
      dot.type = 'button';
      dot.style.background = swatchFor('custom', s.accentHex);
      dot.setAttribute('aria-label', 'Custom');
    }

    new Setting(containerEl)
      .setName('Or a colour of your own')
      .setDesc('Any hex. It is nudged only as far as it must be to stay readable on paper and on black.')
      .addText(t => t.setPlaceholder('#386382').setValue(s.accentHex || '').onChange(async v => {
        s.accentHex = v;
        if (parseHex(v)) { s.accent = 'custom'; await save(); }
        else { await this.plugin.saveSettings(); }
      }));

    containerEl.createEl('h3', { text: 'Background' });
    const bgSetting = new Setting(containerEl)
      .setName('Wallpaper')
      .setDesc(`A gradient, or any photograph you drop in "${BG.folderPath(this.plugin)}". With a wallpaper showing, the cards become frosted glass so the picture reads through them.`);
    const bgRow = bgSetting.controlEl.createDiv({ cls: 'rv-bg-row' });
    const chosen = s.background || 'none';
    for (const opt of BG.options(this.plugin)) {
      const sw = bgRow.createEl('button', { cls: 'rv-bg-swatch' + (chosen === opt.id ? ' is-on' : '') });
      sw.type = 'button';
      sw.setAttribute('aria-label', opt.name);
      sw.setAttribute('title', opt.name);
      const css = opt.id === 'none' ? '' : BG.backgroundCss(this.plugin, opt.id, 'light');
      sw.style.background = css || 'var(--background-secondary)';
      if (css) sw.style.backgroundSize = 'cover';
      sw.createEl('span', { text: opt.name });
      sw.addEventListener('click', async () => {
        s.background = opt.id;
        await save();
        this.display();
      });
    }

    new Setting(containerEl)
      .setName('Veil')
      .setDesc('How far the wallpaper is pulled towards the page colour. A bright photograph needs more of this than a dark one; if any text is hard to read, this is the control.')
      .addSlider(sl => sl.setLimits(0, 95, 5).setValue(Number(s.backgroundDim) || 0).setDynamicTooltip().onChange(async v => {
        s.backgroundDim = v;
        await save();
      }));

    new Setting(containerEl)
      .setName('Today shows')
      .setDesc('A list of everything outstanding, or one card at a time from a deck you can swipe through.')
      .addDropdown(d => d.addOption('list', 'A list').addOption('deck', 'One at a time').setValue(s.todayView || 'list').onChange(async v => {
        s.todayView = v;
        await save();
      }));

    new Setting(containerEl)
      .setName('Soft entrance')
      .setDesc('A short welcome when Rhythm opens, and cards that ease in when a page changes.')
      .addToggle(t => t.setValue(s.softEntrance !== false).onChange(async v => {
        s.softEntrance = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Open on startup')
      .addToggle(t => t.setValue(!!s.openOnStartup).onChange(async v => {
        s.openOnStartup = v;
        await this.plugin.saveSettings();
      }));

    containerEl.createEl('h3', { text: 'Calendar' });
    new Setting(containerEl)
      .setName('Subscribed calendars')
      .setDesc('One link per line. In Apple Calendar: right-click a calendar → Share → Public Calendar, copy the webcal link. Events appear under "Coming up" and on the Month page. Refreshed every six hours.')
      .addTextArea(t => {
        t.setPlaceholder('webcal://p12-caldav.icloud.com/published/2/…').setValue(s.calendarUrls || '').onChange(async v => {
          s.calendarUrls = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 3;
        t.inputEl.cols = 40;
      });
    new Setting(containerEl)
      .setName('Refresh now')
      .setDesc(this.cacheLine())
      .addButton(b => b.setButtonText('Refresh calendars').onClick(async () => {
        b.setDisabled(true);
        try {
          const r = await refreshCalendars(this.plugin);
          new Notice(`Rhythm: ${r.events.length} calendar event${r.events.length === 1 ? '' : 's'} loaded${r.errors.length ? `, ${r.errors.length} link${r.errors.length === 1 ? '' : 's'} failed` : ''}.`);
          for (const e of r.errors) console.warn('rhythm calendar', e);
        } finally {
          b.setDisabled(false);
          this.display();
        }
        this.plugin.refreshViews();
      }));

    containerEl.createEl('h3', { text: 'Reminders' });
    new Setting(containerEl)
      .setName('Deep link')
      .setDesc(`Obsidian cannot schedule notifications, but a Shortcuts automation on iPhone ("At 7:00, open URL") or a home-screen bookmark can open Rhythm at a set time. Link: obsidian://${PROTOCOL}?tab=today`)
      .addButton(b => b.setButtonText('Copy link').onClick(async () => {
        try { await navigator.clipboard.writeText(`obsidian://${PROTOCOL}?tab=today`); new Notice('Rhythm: link copied.'); }
        catch (e) { new Notice(`Rhythm: copy failed — the link is obsidian://${PROTOCOL}?tab=today`); }
      }));
  }

  cacheLine() {
    const c = this.plugin.settings.calendarCache;
    if (!c || !c.fetchedAt) return 'Not fetched yet.';
    const mins = Math.round((Date.now() - c.fetchedAt) / 60000);
    const n = (c.events || []).length;
    return `${n} event${n === 1 ? '' : 's'} cached, fetched ${mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}${c.errors && c.errors.length ? ` · ${c.errors.length} link(s) failed` : ''}.`;
  }
}

module.exports = { RhythmSettingTab };
