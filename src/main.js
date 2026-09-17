'use strict';
/* ============================================================================
   RHYTHM — Obsidian plugin (entry point)
   Life priorities, practices, goals and events as plain notes. Vault API
   only — desktop and iOS/Android. Source lives in src/ as CommonJS modules;
   esbuild bundles them into main.js (target safari15 — the real engine
   floor on mobile, not minAppVersion).
   ============================================================================ */

const { Plugin, Notice } = require('obsidian');
const { VIEW_TYPE, DEFAULT_SETTINGS, PROTOCOL } = require('./constants');
const { RhythmView } = require('./view');
const { RhythmSettingTab } = require('./settings-tab');
const { refreshCalendars } = require('./calendar');
const D = require('./dates');

class RhythmPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._lastWrite = 0;

    this.registerView(VIEW_TYPE, leaf => new RhythmView(leaf, this));
    this.addRibbonIcon('compass', 'Open Rhythm', () => this.activateView());
    this.addCommand({ id: 'open', name: 'Open Rhythm', callback: () => this.activateView() });
    this.addCommand({
      id: 'open-today',
      name: "Open today's note",
      callback: async () => { await this.activateView(); this.forEachView(ctl => ctl.ctx.openLog(D.todayISO())); },
    });
    this.addCommand({
      id: 'add',
      name: 'Add a practice, goal, event or area',
      callback: async () => { await this.activateView(); this.forEachView(ctl => ctl.ctx.add()); },
    });
    this.addCommand({
      id: 'write-note',
      name: "Write in today's note",
      callback: async () => { await this.activateView(); this.forEachView(ctl => ctl.ctx.writeNote(D.todayISO())); },
    });
    this.addCommand({
      id: 'open-plan',
      name: 'Plan the week ahead',
      callback: async () => { await this.activateView(); this.forEachView(ctl => ctl.ctx.setTab('plan')); },
    });
    this.addCommand({
      id: 'review-week',
      name: 'Review the week',
      callback: async () => { await this.activateView(); this.forEachView(ctl => ctl.ctx.setTab('week')); },
    });
    this.addCommand({
      id: 'refresh-calendars',
      name: 'Refresh subscribed calendars',
      callback: async () => {
        const r = await refreshCalendars(this);
        new Notice(`Rhythm: ${r.events.length} calendar event${r.events.length === 1 ? '' : 's'} loaded${r.errors.length ? `, ${r.errors.length} failed` : ''}.`);
        this.refreshViews();
      },
    });
    this.addCommand({
      id: 'copy-deep-link',
      name: 'Copy the deep link (for a Shortcuts reminder)',
      callback: async () => {
        const link = `obsidian://${PROTOCOL}?tab=today`;
        try { await navigator.clipboard.writeText(link); new Notice('Rhythm: link copied.'); }
        catch (e) { new Notice(`Rhythm: ${link}`); }
      },
    });
    this.addSettingTab(new RhythmSettingTab(this.app, this));

    /* obsidian://rhythm?tab=week — from a Shortcuts automation or a bookmark. */
    this.registerObsidianProtocolHandler(PROTOCOL, async params => {
      await this.activateView();
      const tab = params && params.tab;
      if (tab) this.forEachView(ctl => ctl.ctx.setTab(tab));
    });

    if (this.settings.openOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        if (!this.app.workspace.getLeavesOfType(VIEW_TYPE).length) this.activateView();
      });
    }
  }

  onunload() {}

  forEachView(fn) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (v && v.appCtl) fn(v.appCtl);
    }
  }

  refreshViews() {
    this.forEachView(ctl => ctl.ctx.reload());
  }

  async activateView() {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE);
    if (existing.length) { ws.revealLeaf(existing[0]); return; }
    const leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    ws.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

module.exports = RhythmPlugin;
