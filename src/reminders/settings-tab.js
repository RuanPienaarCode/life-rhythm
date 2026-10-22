'use strict';

const { PluginSettingTab, Setting, Notice } = require('obsidian');
const { TINTS, MODES } = require('./constants');
const D = require('./dates');

class NudgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl: c } = this;
    c.empty();
    const s = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); this.plugin.refreshViews(); };

    new Setting(c)
      .setName('Reminders note')
      .setDesc('Every reminder is a checkbox line in this one note. Plain markdown, so the Tasks plugin and a grep read the same file.')
      .addText(t => t.setPlaceholder('Reminders.md').setValue(s.file).onChange(async v => { s.file = String(v || '').trim() || 'Reminders.md'; await save(); }));

    new Setting(c)
      .setName('Default group')
      .setDesc('New reminders land under this heading unless you give them another. Leave empty to add them at the end.')
      .addText(t => t.setPlaceholder('Home').setValue(s.defaultGroup).onChange(async v => { s.defaultGroup = String(v || '').trim(); await save(); }));

    new Setting(c)
      .setName('Show what is done')
      .setDesc('Keep the last few ticked reminders at the foot of the board.')
      .addToggle(t => t.setValue(s.showDone).onChange(async v => { s.showDone = v; await save(); }));

    new Setting(c).setName('Being told').setHeading();

    new Setting(c)
      .setName('Notices in Obsidian')
      .setDesc('A notice when something falls due. Obsidian can only do this while it is open — the calendar file below is what reaches a locked phone.')
      .addToggle(t => t.setValue(s.notify).onChange(async v => { s.notify = v; await save(); }));

    /* The hour is stored as HH:MM, however it was typed (7:30, 8am, 21h00),
       because notices and the phone alarm both read it with D.parseClock. If
       what is typed cannot be read, the stored hour is left alone and the
       description says so — silently keeping or replacing it would leave the
       two out of step again. */
    const hourDesc = 'When reminders with no time of their own — and anything overdue — are raised. Write it like 09:00, 7:30, 8am or 9pm.';
    const hourSetting = new Setting(c).setName('Daily hour').setDesc(hourDesc);
    hourSetting.addText(t => {
      t.setPlaceholder('09:00').setValue(s.allDayAlarmTime).onChange(async v => {
        const typed = String(v || '').trim();
        const hhmm = typed ? D.parseClock(typed) : '09:00';
        if (!hhmm) {
          hourSetting.setDesc(`${hourDesc} Not understood, so ${D.parseClock(s.allDayAlarmTime) || '09:00'} stays in use.`);
          return;
        }
        hourSetting.setDesc(hourDesc);
        s.allDayAlarmTime = hhmm;
        await save();
      });
      /* Leaving the box tidies what was typed into the form that is stored. */
      t.inputEl.addEventListener('blur', () => {
        t.setValue(D.parseClock(s.allDayAlarmTime) || '09:00');
        hourSetting.setDesc(hourDesc);
      });
    });

    new Setting(c)
      .setName('Warning before a timed reminder')
      .setDesc('Minutes of notice for a reminder that carries a clock time.')
      .addSlider(sl => sl.setLimits(0, 60, 5).setValue(Number(s.alarmMinutes) || 0).setDynamicTooltip()
        .onChange(async v => { s.alarmMinutes = v; await save(); }));

    new Setting(c)
      .setName('Count on the ribbon icon')
      .setDesc('A small number on the bell showing what is overdue or due today.')
      .addToggle(t => t.setValue(s.ribbonBadge).onChange(async v => { s.ribbonBadge = v; await this.plugin.saveSettings(); this.plugin.updateBadge(); }));

    new Setting(c).setName('Calendar file').setHeading();

    const desc = document.createDocumentFragment();
    desc.appendChild(document.createTextNode('An .ics file written into your vault. Open it on your phone and Apple Calendar adds the reminders with their alarms, which fire whether or not Obsidian is running. It is one way: ticking a reminder off in Calendar does not tick it off here.'));
    new Setting(c).setName('What this is').setDesc(desc);

    new Setting(c)
      .setName('Calendar file')
      .addText(t => t.setPlaceholder('Reminders.ics').setValue(s.icsFile).onChange(async v => { s.icsFile = String(v || '').trim() || 'Reminders.ics'; await save(); }));

    new Setting(c)
      .setName('Calendar name')
      .setDesc('What the calendar is called once it is imported.')
      .addText(t => t.setPlaceholder('Nudge').setValue(s.calendarName).onChange(async v => { s.calendarName = String(v || '').trim() || 'Nudge'; await save(); }));

    new Setting(c)
      .setName('Rewrite it after every change')
      .setDesc('Keeps the file current. Leave off if you would rather export by hand.')
      .addToggle(t => t.setValue(s.autoExport).onChange(async v => { s.autoExport = v; await save(); }));

    new Setting(c)
      .setName('Export now')
      .addButton(b => b.setButtonText('Write the file').setCta().onClick(async () => {
        const r = await this.plugin.exportICS();
        new Notice(`Nudge: ${r.count} reminder${r.count === 1 ? '' : 's'} written to ${r.path}.`);
      }));

    new Setting(c).setName('Look').setHeading();

    new Setting(c)
      .setName('Surface')
      .setDesc('Glass brings its own ground; plain borrows the colours of your Obsidian theme.')
      .addDropdown(d => d.addOption('glass', 'Glass').addOption('plain', 'Plain')
        .setValue(s.surface).onChange(async v => { s.surface = v; await save(); }));

    new Setting(c)
      .setName('Light or dark')
      .setDesc('The glass follows your Obsidian theme unless you pin it.')
      .addDropdown(d => {
        for (const m of MODES) d.addOption(m.id, m.label);
        d.setValue(s.mode || 'auto').onChange(async v => { s.mode = v; await save(); });
      });

    new Setting(c)
      .setName('Tint')
      .setDesc('The light behind the glass.')
      .addDropdown(d => {
        for (const t of TINTS) d.addOption(t.id, t.label);
        d.setValue(s.tint).onChange(async v => { s.tint = v; await save(); });
      });

    new Setting(c)
      .setName('Sidebar')
      .setDesc('Views and lists beside the board. On a phone or a narrow pane it opens from the button beside the greeting instead.')
      .addToggle(t => t.setValue(s.sidebar !== false).onChange(async v => { s.sidebar = v; await save(); }));

    new Setting(c)
      .setName('Your name')
      .setDesc('Used in the greeting. Leave it empty for none.')
      .addText(t => t.setPlaceholder('Sam').setValue(s.name).onChange(async v => { s.name = String(v || '').trim(); await save(); }));

    new Setting(c)
      .setName('Open on startup')
      .addToggle(t => t.setValue(s.openOnStartup).onChange(async v => { s.openOnStartup = v; await this.plugin.saveSettings(); }));
  }
}

module.exports = { NudgeSettingTab };
