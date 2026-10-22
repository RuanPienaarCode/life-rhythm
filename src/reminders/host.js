'use strict';
/* The reminders module (once the Nudge plugin) inside Rhythm.

   Everything Nudge's own plugin class did that was not about being a plugin
   lives here: the store (and the write seam other code goes through), the
   one-minute due check and its notices, the count badge, and noticing a
   hand edit to the reminders note. The board, the store, the parsers and
   the calendar file are Nudge's modules, unchanged; they are handed this
   host where they used to be handed the plugin, so `plugin.settings`,
   `plugin.store`, `plugin.saveSettings()` and the rest still mean what they
   meant. */

const { Notice } = require('obsidian');
const { makeStore } = require('./store');
const { openEditor } = require('./modals');
const M = require('./model');
const N = require('./notify');
const D = require('./dates');
const { scopedSettings, PINS } = require('../settings-merge');

/* Writes other code makes through host.store. The store records every
   write's text as its own (so the modify watcher ignores it), which means
   such a write would never refresh an open board or the badge — so a write
   that landed refreshes both, here, once. { ok: false } and { changed: 0 }
   wrote nothing. */
const WRITES = ['add', 'addList', 'toggle', 'update', 'snooze', 'setDue', 'setDate', 'remove', 'liftTimes'];

function attachReminders(plugin) {
  const app = plugin.app;
  const host = {
    app,
    manifest: plugin.manifest,
    /* Inside Rhythm: the settings tab hides what Rhythm now owns. */
    embedded: true,
    settings: scopedSettings(plugin, 'reminders', PINS.reminders),
    _lastWrite: 0,
    _lastText: undefined,
    _fired: new Set(),
    ribbonEl: null,
    saveSettings: () => plugin.saveSettings(),
    saveData: () => plugin.saveSettings(),
    /* The boards open now, one per Rhythm pane showing the Reminders page. */
    forEachView(fn) { return plugin.forEachEmbed('reminders', fn); },
    refreshViews() { host.forEachView(ctl => ctl.refresh()); },
    async updateBadge() {
      try { host.paintBadge(M.board((await host.store.load()).items, D.todayISO()).counts); }
      catch (e) { /* the note may not exist yet */ }
    },
    paintBadge(counts) {
      const rib = host.ribbonEl;
      if (!rib) return;
      const old = rib.querySelector('.nd-badge');
      if (old) old.remove();
      const n = counts ? counts.due : 0;
      if (!n || !host.settings.ribbonBadge) return;
      const b = document.createElement('span');
      b.className = 'nd-badge' + (counts.overdue ? ' is-late' : '');
      b.textContent = n > 99 ? '99+' : String(n);
      rib.appendChild(b);
    },
    async tick() {
      let items = [];
      try { items = (await host.store.load()).items; } catch (e) { return; }
      const today = D.todayISO();
      host.paintBadge(M.board(items, today).counts);
      if (!host.settings.notify) return;
      const due = N.pending(items, {
        today, now: D.nowHM(), fired: host._fired,
        leadMinutes: host.settings.alarmMinutes, allDayAlarmTime: host.settings.allDayAlarmTime,
      });
      if (!due.length) return;
      for (const i of due) host._fired.add(N.keyFor(i, today));
      new Notice(`Rhythm — ${N.message(due)}`, 12000);
    },
    async exportICS() { return host.store.exportICS(); },
    /* The full editor, with no board open. */
    addStandalone() {
      openEditor(app, {
        item: { title: '', due: D.todayISO(), time: '', priority: 'normal', repeat: '', tags: [], group: host.settings.defaultGroup || '' },
        groups: [],
        today: D.todayISO(),
        isNew: true,
        onSave: async fields => {
          await host.store.add(fields);
          new Notice(`Rhythm: "${fields.title}" added.`);
          if (host.settings.autoExport) await host.exportICS();
        },
      });
    },
    async openNote() {
      const f = await host.store.ensureFile();
      await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath(host.store.path()) || f);
    },
  };

  /* A write that landed (not { ok: false }, not { changed: 0 }) refreshes
     what shows the reminders — the boards unless the write came from one
     (a board redraws itself), the badge, and the api's listeners. */
  const notifying = (raw, refreshBoards) => {
    const out = Object.assign({}, raw);
    for (const name of WRITES) {
      const inner = raw[name];
      if (typeof inner !== 'function') continue;
      out[name] = async (...args) => {
        const r = await inner(...args);
        const wrote = !(r && (r.ok === false || r.changed === 0));
        if (wrote) { if (refreshBoards) host.refreshViews(); host.updateBadge(); plugin.changed(); }
        return r;
      };
    }
    return out;
  };
  const store = notifying(makeStore(host), true);
  /* Each board's own store (its own write queue, as in Nudge): its writes
     still reach the badge and the api. */
  host.boardStore = () => notifying(makeStore(host), false);
  host.store = store;

  /* Someone edited the note by hand — including on another device, via
     sync. Our own write is recognised by its CONTENT, not by a time window:
     an edit that arrives by sync a moment after we saved must still show. */
  plugin.registerEvent(app.vault.on('modify', async file => {
    if (!file || file.path !== store.path()) return;
    if (host._lastText !== undefined) {
      try { if (await app.vault.cachedRead(file) === host._lastText) return; }
      catch (e) { /* unreadable for a moment: refresh anyway */ }
    }
    host.refreshViews();
    host.updateBadge();
    plugin.changed();
  }));

  /* One timer for the whole plugin — it runs with no view open. */
  plugin.registerInterval(window.setInterval(() => host.tick(), 60000));
  host._startTimer = window.setTimeout(() => { host._startTimer = null; host.tick(); }, 4000);
  host.unload = () => {
    if (host._startTimer !== null && host._startTimer !== undefined) window.clearTimeout(host._startTimer);
    host._startTimer = null;
  };
  return host;
}

module.exports = { attachReminders };
