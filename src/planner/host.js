'use strict';
/* The planner module (once the Fortnight plugin) inside Rhythm.

   Fortnight's board and store are unchanged; they are handed this host
   where they used to be handed the plugin. What changed is where the other
   two come from: reminders through the reminders host's store, practices
   through Rhythm's own io.js store — never through another plugin. */

const { Notice } = require('obsidian');
const { makeStore } = require('./store');
const { scopedSettings, PINS } = require('../settings-merge');
const D = require('./dates');

function attachPlanner(plugin) {
  const app = plugin.app;
  let soon = null;
  const host = {
    app,
    manifest: plugin.manifest,
    embedded: true,
    settings: scopedSettings(plugin, 'planner', PINS.planner),
    remindersStore: () => (plugin.reminders ? plugin.reminders.store : null),
    /* Rhythm's store, as the planner uses it: a write made from the board
       also redraws the Rhythm pages (their own watcher takes io.js writes
       for their own, and would not). */
    rhythmHost: () => ({ settings: plugin.settings, store: plugin.rhythmStoreFor('planner') }),
    _toldPlainTick: false,
    async saveSettings() { await plugin.saveSettings(); host.refreshSoon(); },
    saveData: () => plugin.saveSettings(),
    boardViews() { const out = []; plugin.forEachEmbed('planner', ctl => out.push({ ctl })); return out; },
    /* Ask AI about a card (its menu). */
    canAsk: () => !!(plugin.canAsk && plugin.canAsk()),
    askAbout: item => { if (plugin.askAbout) plugin.askAbout(item); },
    refreshViews() { plugin.forEachEmbed('planner', ctl => ctl.refresh()); },
    refreshSoon() {
      window.clearTimeout(soon);
      soon = window.setTimeout(() => { host.refreshViews(); if (plugin.feedChanged) plugin.feedChanged(); }, 300);
    },
    /* Open the note a card lives in, at its line. */
    async openTask(card) {
      const file = app.vault.getFileByPath(card.path);
      if (!file) { new Notice(`Rhythm: ${card.path} no longer exists.`); return; }
      await app.workspace.getLeaf('tab').openFile(file, { eState: { line: card.line } });
    },
  };
  host.store = makeStore(host);

  /* A note changed, anywhere (including on another device via sync):
     re-read once things settle — but only for notes the board could be
     showing (store.isRelevant), not every keystroke in every note. */
  const relevant = (file, cache) => {
    try { return !!host.store.isRelevant(file, cache); } catch (e) { return true; }
  };
  const later = () => host.refreshSoon();
  plugin.registerEvent(app.metadataCache.on('changed', (file, data, cache) => { if (relevant(file, cache)) later(); }));
  plugin.registerEvent(app.vault.on('delete', file => { if (relevant(file)) later(); }));
  plugin.registerEvent(app.vault.on('rename', (file, oldPath) => { if (relevant(file) || relevant({ path: oldPath })) later(); }));
  app.workspace.onLayoutReady(() => {
    /* A board restored at startup may render before the metadata cache has
       indexed the vault. 'create' fires for every file while the vault
       loads and 'resolved' after every modification, so neither is hooked
       before the layout is ready, and 'resolved' only once. */
    later();
    plugin.registerEvent(app.vault.on('create', file => { if (relevant(file)) later(); }));
    const mc = app.metadataCache;
    const once = mc.on('resolved', () => { if (mc.offref) mc.offref(once); later(); });
    plugin.registerEvent(once);
  });
  /* Past midnight the board moves on a day (and on the week's first day, a
     week). */
  let day = D.todayISO();
  plugin.registerInterval(window.setInterval(() => {
    if (D.todayISO() !== day) { day = D.todayISO(); host.refreshViews(); }
  }, 60 * 1000));
  host.unload = () => window.clearTimeout(soon);
  return host;
}

module.exports = { attachPlanner };
