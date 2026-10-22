'use strict';
/* Settings tab. */

const { PluginSettingTab, Setting, Notice } = require('obsidian');
const { PROTOCOL } = require('./constants');
const { refreshCalendars, calendarStatusLine } = require('./calendar');
const { PRESETS, DEFAULT_ACCENT, swatchFor, customAccentPatch } = require('./accents');
const BG = require('./backgrounds');

/* Obsidian's Setting shows a name beside its control but does not tie the two
   together for assistive tech, so each control is given the name too. */
const named = (el, name) => { if (el && el.setAttribute) el.setAttribute('aria-label', name); };

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
      .addText(t => {
        named(t.inputEl, 'Folder');
        t.setPlaceholder('Rhythm').setValue(s.folder).onChange(async v => {
          s.folder = (v || '').trim() || 'Rhythm';
          await save();
        });
      });

    new Setting(containerEl)
      .setName('Things in front of you')
      .setDesc('How many practices Today shows before the rest fold away under "When there\'s space".')
      .addSlider(sl => {
        named(sl.sliderEl, 'Things in front of you');
        sl.setLimits(1, 7, 1).setValue(s.focusCount).setDynamicTooltip().onChange(async v => {
          s.focusCount = v;
          await save();
        });
      });

    new Setting(containerEl)
      .setName('Week starts on')
      .addDropdown(d => {
        named(d.selectEl, 'Week starts on');
        d.addOption('1', 'Monday').addOption('0', 'Sunday').setValue(String(s.weekStart)).onChange(async v => {
          s.weekStart = parseInt(v, 10) === 0 ? 0 : 1;
          await save();
        });
      });

    new Setting(containerEl)
      .setName('Streak')
      .setDesc('"Good weeks" counts a week when at least 60% of what was asked got done, so one sick day does not reset you.')
      .addDropdown(d => {
        named(d.selectEl, 'Streak');
        d.addOption('days', 'Days in a row').addOption('weeks', 'Good weeks in a row').addOption('off', 'Off').setValue(s.streakMode || 'days').onChange(async v => {
          s.streakMode = v;
          await save();
        });
      });

    new Setting(containerEl)
      .setName('Stillness line when the list is clear')
      .setDesc('A short verse or prompt instead of an empty page.')
      .addToggle(t => {
        named(t.toggleEl, 'Stillness line when the list is clear');
        t.setValue(s.showPrompt !== false).onChange(async v => {
          s.showPrompt = v;
          await save();
        });
      });

    const accentSetting = new Setting(containerEl)
      .setName('Accent')
      .setDesc('The one colour that carries meaning: a tick, a link, today. Each is given a lighter twin for dark mode and a darker one for small text, so every choice stays legible.');
    const row = accentSetting.controlEl.createDiv({ cls: 'rv-accent-row' });
    /* Drawn from the settings each time, so the dots follow a change to the
       colour box without rebuilding the box the user is typing in. */
    const renderAccentRow = () => {
      row.empty();
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
    };
    renderAccentRow();

    new Setting(containerEl)
      .setName('Or a colour of your own')
      .setDesc('Any hex. It is nudged only as far as it must to stay readable on paper and on black.')
      .addText(t => {
        named(t.inputEl, 'Custom accent colour, hex');
        t.setPlaceholder('#386382').setValue(s.accentHex || '').onChange(async v => {
          /* Only a colour that parses is kept; a half-typed or half-deleted
             value leaves the last valid one in place. */
          const patch = customAccentPatch(v);
          if (!patch) return;
          Object.assign(s, patch);
          await save();
          renderAccentRow();
        });
      });

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
      .addSlider(sl => {
        named(sl.sliderEl, 'Veil');
        sl.setLimits(0, 95, 5).setValue(Number(s.backgroundDim) || 0).setDynamicTooltip().onChange(async v => {
          s.backgroundDim = v;
          await save();
        });
      });

    new Setting(containerEl)
      .setName('Today shows')
      .setDesc('A list of everything outstanding, or one card at a time from a deck you can swipe through.')
      .addDropdown(d => {
        named(d.selectEl, 'Today shows');
        d.addOption('list', 'A list').addOption('deck', 'One at a time').setValue(s.todayView || 'list').onChange(async v => {
          s.todayView = v;
          await save();
        });
      });

    new Setting(containerEl)
      .setName('Soft entrance')
      .setDesc('A short welcome when Rhythm opens, and cards that ease in when a page changes.')
      .addToggle(t => {
        named(t.toggleEl, 'Soft entrance');
        t.setValue(s.softEntrance !== false).onChange(async v => {
          s.softEntrance = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Open on startup')
      .addToggle(t => {
        named(t.toggleEl, 'Open on startup');
        t.setValue(!!s.openOnStartup).onChange(async v => {
          s.openOnStartup = v;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl('h3', { text: 'Calendar' });
    new Setting(containerEl)
      .setName('Subscribed calendars')
      .setDesc('One link per line. In Apple Calendar: right-click a calendar → Share → Public Calendar, copy the webcal link. Events appear under "Coming up" and on the Month page. Refreshed every six hours.')
      .addTextArea(t => {
        named(t.inputEl, 'Subscribed calendar links, one per line');
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
    return calendarStatusLine(this.plugin.settings.calendarCache, Date.now());
  }
}

module.exports = { RhythmSettingTab };
