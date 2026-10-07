'use strict';
/* The app controller: owns state, loads data through the store, renders the
   shell (toolbar + segmented tabs) and delegates each page to its module.
   Re-renders whole pages from state — the DOM is small enough that diffing
   would be more code than it saves. */

const { Notice } = require('obsidian');
const { el, button, clear, icon } = require('./dom');
const { makeStore } = require('./io');
const D = require('./dates');
const M = require('./model');
const { renderToday } = require('./page-today');
const { renderWeek } = require('./page-week');
const { renderMonth } = require('./page-month');
const { renderAreas } = require('./page-areas');
const { renderPlan } = require('./page-plan');
const { undoMove } = require('./day-menu');
const { openAddModal, openEditModal, openNextStepModal, openNoteModal } = require('./modals');
const { refreshCalendars, calendarEvents, isStale, urls } = require('./calendar');
const { applyAccent } = require('./accents');
const { applyBackground } = require('./backgrounds');

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'plan', label: 'Plan' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'areas', label: 'Areas' },
];

function mountApp(view) {
  const plugin = view.plugin;
  const app = plugin.app;
  const store = makeStore(plugin);
  const root = view.contentEl;
  root.classList.add('rv-app');

  const state = {
    tab: 'today',
    date: D.todayISO(),
    data: { areas: [], practices: [], aside: [], goals: [], events: [], log: new Map() },
    loaded: false,
    showLater: false,
    showDeferred: false,
    openArea: null,
    showAside: false,
    /* Which card the deck has in front — purely visual, reset whenever the
       page changes so you never return to a stale position. */
    deckOffset: 0,
    /* Set whenever the page changes (tab, date, first load) so the next
       render eases in; cleared after that render so a tick never re-animates. */
    enter: true,
  };

  let header, nav, main, toastEl, reloadTimer = null, toastTimer = null, stopped = false, resizeObserver = null;

  const fail = (what, e, msg) => { console.error('rhythm ' + what, e); new Notice('Rhythm: ' + msg); };

  const ctx = {
    get state() { return state; },
    get settings() { return plugin.settings; },
    get events() { return [...state.data.events, ...calendarEvents(plugin)]; },
    store,
    plugin,
    /* Tick or untick, with an undo toast. Undo puts back all four flags as
       they were, because a tick also clears skip, snooze and the day's plan
       (and a skip clears done and plan) — flipping one flag back loses them. */
    async toggle(name, date, on) {
      try {
        const r = await store.setDone(date, name, on);
        await ctx.reload();
        ctx.toast(on ? `Ticked ${name}` : `Unticked ${name}`, 'Undo', () => ctx.restore(name, date, r && r.prev));
      } catch (e) { fail('toggle', e, 'could not save that tick.'); }
    },
    async skip(name, date, on) {
      try {
        const r = await store.setSkip(date, name, on);
        await ctx.reload();
        if (on) ctx.toast(`Not today: ${name}`, 'Undo', () => ctx.restore(name, date, r && r.prev));
      } catch (e) { fail('skip', e, 'could not save that.'); }
    },
    async snooze(name, date, on) {
      try {
        const r = await store.setSnooze(date, name, on);
        await ctx.reload();
        if (on) ctx.toast(`Later: ${name}`, 'Undo', () => ctx.restore(name, date, r && r.prev));
      } catch (e) { fail('snooze', e, 'could not save that.'); }
    },
    async restore(name, date, prev) {
      try {
        await store.restoreFlags(date, name, prev);
        await ctx.reload();
      } catch (e) { fail('undo', e, 'could not undo that.'); }
    },
    toast(text, label, action) {
      if (!toastEl) return;
      clear(toastEl);
      const t = el(toastEl, 'div', 'rv-toast-inner');
      el(t, 'span', 'rv-toast-text', text);
      if (label && action) button(t, 'rv-toast-btn', label, () => { hideToast(); action(); });
      toastEl.classList.add('is-on');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, 5000);
    },
    async openNote(path) {
      const f = app.vault.getFileByPath(path);
      if (!f) { new Notice('Rhythm: that note is missing.'); return; }
      await app.workspace.getLeaf('tab').openFile(f);
    },
    async openLog(date) {
      try { const p = await store.ensureLogNote(date); await ctx.reload(); await ctx.openNote(p); }
      catch (e) { fail('log', e, 'could not open that day\'s note.'); }
    },
    setDate(iso) { state.date = iso; state.deckOffset = 0; state.enter = true; render(); },
    setTab(id) { if (TABS.some(t => t.id === id)) { state.tab = id; state.deckOffset = 0; state.enter = true; render(); } },
    rerender() { render(); },
    async setAccent(id, hex) {
      plugin.settings.accent = id;
      if (hex !== undefined) plugin.settings.accentHex = hex;
      accentKey = null;
      try { await plugin.saveSettings(); } catch (e) { console.error('rhythm accent', e); }
      render();
    },
    async setBackground(id) {
      plugin.settings.background = id;
      try { await plugin.saveSettings(); } catch (e) { console.error('rhythm background', e); }
      render();
    },
    async setTodayView(v) {
      plugin.settings.todayView = v;
      state.deckOffset = 0;
      state.enter = true;
      try { await plugin.saveSettings(); } catch (e) { console.error('rhythm view', e); }
      render();
    },
    /* Promise a practice to a day, or take the promise back. Undo puts both
       days' flags back exactly as they were (store.restoreFlags). */
    async movePlan(name, from, to) {
      try {
        const res = await store.movePlan(name, from, to);
        await ctx.reload();
        ctx.toast(to ? `${name} → ${D.fmtShort(to)}` : `${name} back to waiting`, 'Undo', async () => {
          try { await undoMove(store, name, from, to, res); await ctx.reload(); }
          catch (e) { fail('plan', e, 'could not undo that.'); }
        });
      } catch (e) { fail('plan', e, 'could not move that.'); }
    },
    toggleLater() { state.showLater = !state.showLater; render(); },
    toggleDeferred() { state.showDeferred = !state.showDeferred; render(); },
    toggleArea(name) { state.openArea = state.openArea === name ? null : name; render(); },
    toggleAside() { state.showAside = !state.showAside; render(); },
    /* Set aside keeps the note and its whole history — it only stops being
       asked for. Bringing it back is one tap, which is the point: this has
       to feel cheaper than deleting, or nobody will use it. */
    async setAside(p, on) {
      try {
        await store.patch(p.path, { status: on ? 'aside' : undefined });
        await ctx.reload();
        ctx.toast(on ? `Set aside: ${p.name}` : `Back: ${p.name}`, 'Undo', () => ctx.setAside(p, !on));
      } catch (e) { fail('aside', e, 'could not set that aside.'); }
    },
    add(kind) { openAddModal(app, ctx, kind); },
    openSettings() {
      const st = app.setting;
      if (!st) { new Notice('Rhythm: open Settings → Community plugins → Rhythm.'); return; }
      st.open();
      st.openTabById((plugin.manifest && plugin.manifest.id) || 'rhythm');
    },
    edit(kind, rec) { openEditModal(app, ctx, kind, rec); },
    stepDone(goal) { openNextStepModal(app, ctx, goal); },
    writeNote(date) { openNoteModal(app, ctx, date || state.date); },
    /* A titled note becomes a section; an untitled one is just the words.
       Either way it is appended, never merged into what is already there. */
    async saveNote(date, title, body) {
      const block = title ? `## ${title}\n\n${body}` : body;
      try {
        await store.appendLog(date, block);
        await ctx.reload();
        ctx.toast(title ? `Saved "${title}"` : 'Saved to the day\'s note', 'Open', () => ctx.openLog(date));
      } catch (e) { fail('note', e, 'could not save that note.'); }
    },
    async reload() {
      try { state.data = await store.load(); state.loaded = true; }
      catch (e) { fail('load', e, 'could not read the Rhythm folder.'); }
      render();
    },
    async seed() {
      try { await store.seed(); plugin.settings.onboarded = true; await plugin.saveSettings(); }
      catch (e) { fail('seed', e, 'could not write the starter notes.'); }
      await ctx.reload();
    },
    async startEmpty() {
      try { await store.ensureTree(); plugin.settings.onboarded = true; await plugin.saveSettings(); }
      catch (e) { console.error('rhythm tree', e); }
      await ctx.reload();
    },
    async patch(path, fields) {
      try { await store.patch(path, fields); await ctx.reload(); }
      catch (e) { fail('patch', e, 'could not update that note.'); }
    },
    /* Edit: frontmatter fields, and a rename when the name changed. */
    async update(rec, fields, newName) {
      try {
        let path = rec.path;
        if (newName && newName !== rec.name) {
          const r = await store.rename(path, newName);
          if (!r) { new Notice(`Rhythm: something called "${newName}" already exists.`); }
          else path = r.path;
        }
        if (Object.keys(fields).length) await store.patch(path, fields);
        await ctx.reload();
      } catch (e) { fail('update', e, 'could not save that change.'); }
    },
    async completeStep(goal, next) {
      try {
        await store.completeGoalStep(goal.path, goal.next, next, D.todayISO());
        await ctx.reload();
        ctx.toast(next ? `Next: ${next}` : `${goal.name} needs a next step`);
      } catch (e) { fail('step', e, 'could not save that step.'); }
    },
    async reviewWeek(date, text) {
      try {
        await store.appendLog(date, `## Week in review\n\n${text}`);
        await ctx.reload();
        ctx.toast('Saved to the day\'s note', 'Open', () => ctx.openLog(date));
      } catch (e) { fail('review', e, 'could not save the review.'); }
    },
    async create(kind, rec) {
      try {
        const fn = { practice: store.createPractice, goal: store.createGoal, event: store.createEvent, area: store.createArea }[kind];
        const ok = await fn(rec);
        if (!ok) new Notice(`Rhythm: a ${kind} called "${rec.name}" already exists.`);
      } catch (e) { fail('create', e, `could not create that ${kind}.`); }
      await ctx.reload();
    },
    async refreshCalendars(quiet) {
      if (!urls(plugin).length) return;
      try {
        const r = await refreshCalendars(plugin);
        if (!quiet) ctx.toast(`${r.events.length} calendar events loaded`);
        render();
      } catch (e) { console.error('rhythm calendar', e); }
    },
  };

  function hideToast() {
    if (!toastEl) return;
    toastEl.classList.remove('is-on');
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  }

  function renderHeader() {
    clear(header);
    const brand = el(header, 'div', 'rv-brand');
    icon(brand, 'compass');
    brand.setAttribute('aria-label', 'Rhythm');
    el(header, 'div', 'rv-spacer');
    const gear = button(header, 'rv-gear', null, () => ctx.openSettings(), 'settings');
    gear.setAttribute('aria-label', 'Rhythm settings');
    const add = button(header, 'rv-add', null, () => ctx.add(), 'plus');
    add.setAttribute('aria-label', 'Add');
    if (!state.loaded || !store.hasData()) add.disabled = true;

    clear(nav);
    for (const t of TABS) {
      const b = button(nav, 'rv-tab' + (state.tab === t.id ? ' is-active' : ''), t.label, () => ctx.setTab(t.id));
      b.setAttribute('aria-selected', state.tab === t.id ? 'true' : 'false');
      b.setAttribute('role', 'tab');
    }
    nav.hidden = !state.loaded || !store.hasData();
  }

  function renderSetup() {
    const card = el(main, 'section', 'rv-setup');
    el(card, 'h1', 'rv-setup-title', 'Rhythm');
    el(card, 'p', 'rv-setup-lead', 'A short list every day, a picture of the week, a view of the month. Kept as plain notes in this vault.');
    el(card, 'p', 'rv-setup-note', `The starter set is built around eight areas — faith, family, people, body, mind, craft, growth and adventure — with practices, goals and a priority order you can change any time. It creates a "${store.root()}" folder.`);
    const row = el(card, 'div', 'rv-setup-actions');
    button(row, 'rv-btn rv-btn-primary', 'Start with the starter set', () => ctx.seed());
    button(row, 'rv-btn', 'Start empty', () => ctx.startEmpty());
  }

  /* The accent lives on the root as inline custom properties. Both themes'
     values are set at once and the stylesheet picks, so this only has to
     run when the CHOICE changes, never when the theme does. */
  let accentKey = null;
  function paintAccent() {
    const key = `${plugin.settings.accent}|${plugin.settings.accentHex}`;
    if (key === accentKey) return;
    accentKey = key;
    applyAccent(root, plugin.settings);
  }

  /* The wallpaper is re-resolved on every render rather than cached: a
     gradient has to swap when the host theme flips, and the vault's
     resource path for an image can change between sessions. It is two
     style writes, so the cost is nothing. */
  function paintBackground() {
    applyBackground(root, plugin);
  }

  function render() {
    if (stopped) return;
    paintAccent();
    paintBackground();
    renderHeader();
    clear(main);
    main.scrollTop = 0;
    if (!state.loaded) { el(main, 'p', 'rv-muted rv-center', 'Loading…'); return; }
    if (!store.hasData()) { renderSetup(); return; }
    const page = el(main, 'div', `rv-page rv-page-${state.tab}`);
    if (state.tab === 'today') renderToday(page, ctx);
    else if (state.tab === 'plan') renderPlan(page, ctx);
    else if (state.tab === 'week') renderWeek(page, ctx);
    else if (state.tab === 'month') renderMonth(page, ctx);
    else renderAreas(page, ctx);
    if (state.enter && plugin.settings.softEntrance !== false) {
      page.classList.add('rv-enter');
      let i = 0;
      for (const child of page.children) { child.style.setProperty('--rv-i', String(i)); if (!child.classList.contains('rv-group-header')) i++; }
    }
    state.enter = false;
  }

  /* Welcome: a breathing sun and a greeting, then a fade into the page. */
  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Still up.' : h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : h < 22 ? 'Good evening.' : 'Time to rest.';
  }
  function showSplash() {
    const sp = el(root, 'div', 'rv-splash');
    sp.setAttribute('aria-hidden', 'true');
    const sun = el(sp, 'div', 'rv-splash-sun');
    icon(sun, new Date().getHours() >= 19 || new Date().getHours() < 5 ? 'moon' : 'sun');
    el(sp, 'div', 'rv-splash-hello', greeting());
    el(sp, 'div', 'rv-splash-date', D.fmtLong(D.todayISO()));
    const shownAt = Date.now();
    let gone = false;
    const leave = () => {
      if (gone) return; gone = true;
      sp.classList.add('is-leaving');
      window.setTimeout(() => sp.remove(), 700);
    };
    sp.addEventListener('click', leave);
    return { leave: () => window.setTimeout(leave, Math.max(0, 1400 - (Date.now() - shownAt))) };
  }

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { reloadTimer = null; ctx.reload(); }, 300);
  }

  function onVaultChange(file, oldPath) {
    const p = file && file.path;
    if (!store.isOurs(p) && !store.isOurs(oldPath)) return;
    if (Date.now() - (plugin._lastWrite || 0) < 800) return; // our own write
    scheduleReload();
  }

  /* Desktop keyboard: 1–7 tick the focus rows, ← → move the date, T is
     today, N adds. Never while typing, never on mobile. */
  function onKey(e) {
    if (document.body.classList.contains('is-mobile')) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (document.querySelector('.modal')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[1-7]$/.test(k) && state.tab === 'today') {
      const plan = M.planDay(state.data, state.date, { focusCount: plugin.settings.focusCount, weekStart: plugin.settings.weekStart });
      const r = plan.focus[parseInt(k, 10) - 1];
      if (r) { e.preventDefault(); ctx.toggle(r.p.name, state.date, true); }
      return;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const dir = k === 'ArrowLeft' ? -1 : 1;
      e.preventDefault();
      if (state.tab === 'today') ctx.setDate(D.addDays(state.date, dir));
      else if (state.tab === 'week' || state.tab === 'plan') ctx.setDate(D.addDays(state.date, 7 * dir));
      else if (state.tab === 'month') ctx.setDate(D.addMonths(state.date, dir));
      return;
    }
    if (k === 't' || k === 'T') { e.preventDefault(); ctx.setDate(D.todayISO()); return; }
    if (k === 'n' || k === 'N') { e.preventDefault(); if (store.hasData()) ctx.add(); }
  }

  return {
    ctx,
    async start() {
      clear(root);
      header = el(root, 'header', 'rv-top');
      nav = el(root, 'nav', 'rv-tabs');
      nav.setAttribute('role', 'tablist');
      main = el(root, 'main', 'rv-main');
      toastEl = el(root, 'div', 'rv-toast');
      root.tabIndex = 0;
      render();
      if (view.registerEvent && app.vault.on) {
        for (const ev of ['create', 'modify', 'delete', 'rename']) view.registerEvent(app.vault.on(ev, onVaultChange));
      }
      if (view.registerDomEvent) view.registerDomEvent(root, 'keydown', onKey);
      else root.addEventListener('keydown', onKey);
      /* The phone layout (bottom tab bar, hidden wide-only chrome) has to
         key on the PANE's own width, not the window's — a narrow sidebar
         on desktop is exactly as cramped as a phone screen, and a wide
         phone-in-landscape pane is not. */
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(entries => {
          const w = entries[0].contentRect.width;
          root.classList.toggle('is-narrow', w < 560);
          root.classList.toggle('is-xnarrow', w < 480);
        });
        resizeObserver.observe(root);
      }
      if (view.registerInterval) {
        view.registerInterval(window.setInterval(() => {
          const t = D.todayISO();
          if (state.date !== t && state.tab === 'today' && state.date === D.addDays(t, -1)) { state.date = t; render(); }
        }, 60000));
      }
      const splash = plugin.settings.softEntrance !== false ? showSplash() : null;
      await ctx.reload();
      if (splash) splash.leave();
      if (isStale(plugin)) ctx.refreshCalendars(true);
    },
    stop() { stopped = true; if (reloadTimer) clearTimeout(reloadTimer); if (toastTimer) clearTimeout(toastTimer); if (resizeObserver) resizeObserver.disconnect(); },
    render,
  };
}

module.exports = { mountApp, TABS };
