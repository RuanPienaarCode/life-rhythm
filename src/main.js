'use strict';
/* ============================================================================
   RHYTHM — Obsidian plugin (entry point)
   Life priorities, practices, goals and events as plain notes — and, since
   0.2.0, the reminders module (once the Nudge plugin) and the two-week
   planner (once Fortnight), each a page of the one view. Vault API only —
   desktop and iOS/Android. Source lives in src/ as CommonJS modules;
   esbuild bundles them into main.js (target safari15 — the real engine
   floor on mobile, not minAppVersion).

   Who writes what (one writer per note):
     Rhythm/…           io.js, through plugin.rhythmStore
     the reminders note  src/reminders/store.js, through plugin.reminders.store
     Tasks lines         src/planner/store.js
   Other plugins read and write only through plugin.api (src/api.js).
   ============================================================================ */

const { Plugin, Notice } = require('obsidian');
const { VIEW_TYPE, PROTOCOL } = require('./constants');
const { RhythmView } = require('./view');
const { RhythmSettingTab } = require('./settings-tab');
const { refreshCalendars } = require('./calendar');
const { makeStore } = require('./io');
const { makeApi } = require('./api');
const { attachReminders } = require('./reminders/host');
const { attachPlanner } = require('./planner/host');
const { mergeSettings, OLD_IDS } = require('./settings-merge');
const D = require('./dates');

/* The old Nudge plugin's link, kept working: obsidian://nudge-reminders. */
const NUDGE_PROTOCOL = 'nudge-reminders';

/* Rhythm store calls that write. */
const RHYTHM_WRITES = [
  'setFlag', 'setDone', 'setSkip', 'setSnooze', 'setPlan', 'restoreFlags', 'movePlan', 'patch', 'rename',
  'appendBody', 'appendLog', 'ensureLogNote', 'completeGoalStep', 'createArea', 'createPractice', 'createGoal',
  'createEvent', 'seed', 'ensureTree',
];
function afterWrites(store, then) {
  const out = Object.assign({}, store);
  for (const name of RHYTHM_WRITES) {
    const inner = store[name];
    if (typeof inner !== 'function') continue;
    out[name] = async (...args) => { const r = await inner(...args); then(); return r; };
  }
  return out;
}

class RhythmPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._lastWrite = 0;

    const api = makeApi(this);
    this.api = api.api;
    this._api = api;
    /* Every Rhythm write tells the api's listeners (Vista). */
    this.rhythmStore = afterWrites(makeStore(this), () => this.changed());
    this._rhythmFor = {};
    this.reminders = attachReminders(this);
    this.planner = attachPlanner(this);

    this.registerView(VIEW_TYPE, leaf => new RhythmView(leaf, this));
    const ribbon = this.addRibbonIcon('compass', 'Open Rhythm', () => this.activateView());
    /* The reminders count sits on Rhythm's icon (positioned by .nd-ribbon). */
    if (ribbon && ribbon.classList) ribbon.classList.add('nd-ribbon');
    this.reminders.ribbonEl = ribbon;

    this.registerCommands();
    this.addSettingTab(new RhythmSettingTab(this.app, this));

    /* obsidian://rhythm?tab=habits — from a Shortcuts automation or a bookmark.
       On the Reminders page, `filter` and `add` work as Nudge's link did. */
    this.registerObsidianProtocolHandler(PROTOCOL, params => this.openFromLink(params && params.tab, params));
    this.registerObsidianProtocolHandler(NUDGE_PROTOCOL, params => this.openFromLink('reminders', params));

    /* A hand edit (or a sync) inside the Rhythm folder: the api's listeners
       hear of it. Rhythm's own pages have their own watcher. */
    const inRhythm = p => typeof p === 'string' && this.rhythmStore.isOurs(p);
    for (const ev of ['create', 'modify', 'delete']) this.registerEvent(this.app.vault.on(ev, f => { if (f && inRhythm(f.path)) this.changed(); }));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { if ((f && inRhythm(f.path)) || inRhythm(old)) this.changed(); }));

    /* Obsidian switched light/dark, or the accent changed. */
    this.registerEvent(this.app.workspace.on('css-change', () => this.forEachView(ctl => ctl.restyle && ctl.restyle())));

    this.app.workspace.onLayoutReady(() => {
      this.reminders.updateBadge();
      if (this.settings.openOnStartup && !this.app.workspace.getLeavesOfType(VIEW_TYPE).length) this.activateView();
    });
  }

  registerCommands() {
    const cmd = (id, name, callback) => this.addCommand({ id, name, callback });
    const onPage = (page, fn) => async () => { const ctl = await this.showPage(page); if (ctl) fn(ctl); };

    cmd('open', 'Open Rhythm', () => this.activateView());
    cmd('open-reminders', 'Open Reminders', () => this.activateView('reminders'));
    cmd('open-fortnight', 'Open Fortnight', () => this.activateView('fortnight'));

    cmd('open-today', "Open today's note", async () => { await this.activateView(); this.forEachView(ctl => ctl.ctx.openLog(D.todayISO())); });
    cmd('add', 'Add a practice, goal, event or priority', async () => { await this.activateView(); this.firstView(ctl => ctl.ctx.add()); });
    cmd('write-note', "Write in today's note", async () => { await this.activateView(); this.firstView(ctl => ctl.ctx.writeNote(D.todayISO())); });
    cmd('open-plan', 'Plan the week ahead', () => this.activateView('plan'));
    cmd('review-week', 'Review the week', async () => { await this.activateView('habits'); this.firstView(ctl => ctl.ctx.setTodayView('week')); });
    cmd('open-priorities', 'Open Priorities', () => this.activateView('priorities'));
    cmd('refresh-calendars', 'Refresh subscribed calendars', async () => {
      const r = await refreshCalendars(this);
      new Notice(`Rhythm: ${r.events.length} calendar event${r.events.length === 1 ? '' : 's'} loaded${r.errors.length ? `, ${r.errors.length} failed` : ''}.`);
      this.refreshViews();
    });
    /* One deep link: the page you are on. */
    cmd('copy-deep-link', 'Copy the deep link to this page (for a Shortcuts automation)', async () => {
      let tab = 'today';
      this.firstView(ctl => { tab = ctl.ctx.state.tab; });
      const link = `obsidian://${PROTOCOL}?tab=${tab}`;
      try { await navigator.clipboard.writeText(link); new Notice(`Rhythm: link copied — ${link}`); }
      catch (e) { new Notice(`Rhythm: ${link}`); }
    });

    const R = this.reminders;
    cmd('reminders-add', 'Reminders: add a reminder', async () => {
      const ctl = await this.showPage('reminders');
      if (ctl && ctl.ctx && ctl.ctx.focusAdd) ctl.ctx.focusAdd(); else R.addStandalone();
    });
    cmd('reminders-add-dialog', 'Reminders: add a reminder (full editor)', () => R.addStandalone());
    cmd('reminders-open-note', 'Reminders: open the reminders note', () => R.openNote());
    cmd('reminders-export-ics', 'Reminders: export to a calendar file', async () => {
      const r = await R.exportICS();
      new Notice(`Rhythm: ${r.count} reminder${r.count === 1 ? '' : 's'} written to ${r.path}. Open it on your phone to add them to your calendar.`);
    });
    cmd('reminders-lift-times', 'Reminders: fix timed reminders for the Tasks plugin', async () => {
      const { changed } = await R.store.liftTimes();
      if (!changed) { new Notice('Rhythm: every timed reminder already reads right in Tasks.'); return; }
      new Notice(`Rhythm: moved the time on ${changed} reminder${changed === 1 ? '' : 's'} so Tasks can see ${changed === 1 ? 'its' : 'their'} dates.`);
    });

    cmd('fortnight-review', 'Fortnight: review today', onPage('fortnight', ctl => ctl.openReview()));
    cmd('fortnight-welcome', 'Fortnight: show the welcome again', onPage('fortnight', ctl => ctl.showIntro()));
  }

  onunload() {
    if (this.reminders) this.reminders.unload();
    if (this.planner) this.planner.unload();
    if (this._api) this._api.stop();
  }

  /* Something changed that another plugin, or the Today page, may be
     showing. */
  changed() {
    if (this._api) this._api.notify();
    this.feedChanged();
  }

  /* The Today page's list is made of every module's lines: any of them
     changing (a write here, a hand edit, a sync) redraws it. */
  feedChanged() { this.forEachView(ctl => { if (ctl.ctx.feedChanged) ctl.ctx.feedChanged(); }); }

  /* Rhythm's store as a module uses it: a write made from the planner or
     through the api also redraws the Rhythm pages (their watcher takes io.js
     writes for their own) — and, from the api, the Fortnight boards. */
  rhythmStoreFor(source) {
    if (!this._rhythmFor[source]) {
      this._rhythmFor[source] = afterWrites(this.rhythmStore, () => {
        this.refreshViews();
        if (source === 'api' && this.planner) this.planner.refreshSoon();
      });
    }
    return this._rhythmFor[source];
  }

  views() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter(v => v && v.appCtl);
  }

  forEachView(fn) { for (const v of this.views()) fn(v.appCtl); }

  firstView(fn) { const v = this.views()[0]; if (v) fn(v.appCtl); return !!v; }

  /* fn(board) for every open board of a module ('reminders' | 'planner').
     Resolves to whether there was one. */
  forEachEmbed(kind, fn) {
    let any = false;
    for (const v of this.views()) {
      const e = v.appCtl.ctx.embed;
      if (e && e.kind === kind) { fn(e.ctl); any = true; }
    }
    return any;
  }

  refreshViews() {
    this.forEachView(ctl => ctl.ctx.reload());
  }

  /* Open (or reveal) the view, on a page when one is named. */
  async activateView(page) {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE);
    let leaf = existing[0];
    if (!leaf) {
      leaf = ws.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true, state: page ? { page } : {} });
    }
    if (typeof leaf.loadIfDeferred === 'function') await leaf.loadIfDeferred();
    await ws.revealLeaf(leaf);
    const v = leaf.view;
    if (page && v && v.appCtl) v.appCtl.ctx.setTab(page);
    return leaf;
  }

  /* Open a page and hand back its board once it is running (null for
     Rhythm's own pages, or if the view never came up). */
  async showPage(page) {
    const leaf = await this.activateView(page);
    const v = leaf && leaf.view;
    if (!v || !v.appCtl) return null;
    return v.appCtl.ctx.showPage(page);
  }

  async openFromLink(tab, params) {
    const page = tab || 'today';
    /* The old Week page's link opens Habits on its Week view. */
    if (page === 'week') { await this.activateView('habits'); this.firstView(ctl => ctl.ctx.setTodayView('week')); return; }
    if (page !== 'reminders') { await this.activateView(page); return; }
    const ctl = await this.showPage('reminders');
    if (!ctl || !ctl.ctx) return;
    if (params && params.filter) ctl.ctx.setFilter(params.filter);
    if (params && params.add) ctl.ctx.focusAdd();
  }

  /* Rhythm's data.json, plus — once each — the settings of the Nudge and
     Fortnight plugins this one replaced (read, never changed). */
  async loadSettings() {
    const saved = await this.loadData();
    const old = {};
    for (const id of Object.values(OLD_IDS)) old[id] = await this.readOldData(id, saved);
    const { settings, changed } = mergeSettings(saved, old, D.todayISO());
    this.settings = settings;
    if (changed) await this.saveSettings();
  }

  async readOldData(id, saved) {
    if (saved && saved.imported && saved.imported[id]) return null;
    const adapter = this.app.vault.adapter;
    const path = `${this.app.vault.configDir}/plugins/${id}/data.json`;
    try {
      if (!adapter || !(await adapter.exists(path))) return null;
      return JSON.parse(await adapter.read(path));
    } catch (e) {
      console.warn('Rhythm: could not read the old settings at', path, e);
      return null;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

module.exports = RhythmPlugin;
