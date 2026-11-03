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
const { renderNow } = require('./page-now');
const { loadFeed } = require('./today-feed');
const { why } = require('./planner/board');
const { renderMonth } = require('./page-month');
const { renderAreas } = require('./page-areas');
const { renderPlan } = require('./page-plan');
const { undoMove } = require('./day-menu');
const { openAddModal, openEditModal, openNextStepModal, openNoteModal, openDateModal, openConfirmModal } = require('./modals');
const { openEditor: openReminderEditor } = require('./reminders/modals');
const { refreshCalendars, calendarEvents, isStale, urls } = require('./calendar');
const { applyAccent } = require('./accents');
const { applyBackground } = require('./backgrounds');
const { mountEmbed, EMBEDS } = require('./embed');
const { mountMoreSheet } = require('./more-sheet');
const { mountAskAi } = require('./ai/chat');
const AI = require('./ai/actions');
const { planBoard } = require('./planner/plan');

/* Rhythm's own pages, and the two module boards (Reminders, Fortnight)
   mounted as pages — see embed.js. */
const TABS = [
  /* Everything due today, from every module (page-now.js). */
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'reminders', label: 'Reminders', icon: 'bell' },
  /* The practices page (page-today.js) — "Today" until 0.2.0. Its Week
     view is the old Week page (page-week.js). */
  { id: 'habits', label: 'Habits', icon: 'repeat' },
  { id: 'fortnight', label: 'Fortnight', icon: 'columns-3' },
  { id: 'month', label: 'Month', icon: 'calendar' },
  { id: 'plan', label: 'Plan', icon: 'target' },
  /* The areas, in priority order (page-areas.js) — "Areas" until 26 Oct 2026. */
  { id: 'priorities', label: 'Priorities', icon: 'list-ordered' },
];
/* On a phone the tabs are a floating dock (styles.css): the first DOCK_SLOTS
   pages are slots of their own, a More slot opens the rest in a bottom sheet
   (more-sheet.js). Seven labelled 44px slots do not fit a 375px screen. The
   wide segmented control still shows all seven. */
const DOCK_SLOTS = 4;
/* Pages that were renamed or folded in: an old deep link, a saved view or
   a bookmark still lands on the page that took its place. */
const ALIASES = { areas: 'priorities', week: 'habits' };
const pageId = id => (ALIASES[id] || id);
const isTab = id => TABS.some(t => t.id === pageId(id));

function mountApp(view) {
  const plugin = view.plugin;
  const app = plugin.app;
  /* The plugin's one Rhythm store (one create queue for every writer);
     a store of its own only where there is no plugin to share (tests). */
  const store = plugin.rhythmStore || makeStore(plugin);
  const root = view.contentEl;
  root.classList.add('rv-app');
  /* The board on screen when the page is Reminders or Fortnight. */
  let embed = null;
  /* Settles once the first load has landed (a board mounts only after it). */
  let markLoaded;
  const loaded = new Promise(r => { markLoaded = r; });

  const state = {
    tab: isTab(view.initialTab) ? pageId(view.initialTab) : 'today',
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
    /* The Today page's list (today-feed.js): kept while a fresh one loads, so
       a reload never flashes the page empty. */
    feed: null,
    feedStale: false,
    feedError: false,
    /* Set whenever the page changes (tab, date, first load) so the next
       render eases in; cleared after that render so a tick never re-animates. */
    enter: true,
  };

  let header, nav, main, toastEl, askAi = null, reloadTimer = null, toastTimer = null, stopped = false, resizeObserver = null;
  let feedLoading = false, feedAgain = false;
  /* The dock's More slot: the pages past DOCK_SLOTS, as a bottom sheet. */
  const moreSheet = mountMoreSheet(root, {
    items: () => TABS.slice(DOCK_SLOTS),
    current: () => state.tab,
    pick: id => ctx.setTab(id),
    toggle: () => (nav ? nav.querySelector('.rv-tab-more') : null),
  });

  const fail = (what, e, msg) => { console.error('rhythm ' + what, e); new Notice('Rhythm: ' + msg); };
  /* io.js refuses a write it cannot make safely and says why. */
  const refusedText = r => (r.reason === 'unreadable'
    ? `that day's note has a "${r.key}:" line Rhythm can't read as a list — open the note and fix it; nothing was changed.`
    : r.reason === 'done-that-day' ? 'that is already done that day.' : 'nothing was changed.');
  const refused = r => { if (r && r.refused) { new Notice('Rhythm: ' + refusedText(r.refused)); return true; } return false; };

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
        if (refused(r)) return;
        await ctx.reload();
        ctx.toast(on ? `Ticked ${name}` : `Unticked ${name}`, 'Undo', () => ctx.restore(name, date, r && r.prev));
      } catch (e) { fail('toggle', e, 'could not save that tick.'); }
    },
    async skip(name, date, on) {
      try {
        const r = await store.setSkip(date, name, on);
        if (refused(r)) return;
        await ctx.reload();
        if (on) ctx.toast(`Not today: ${name}`, 'Undo', () => ctx.restore(name, date, r && r.prev));
      } catch (e) { fail('skip', e, 'could not save that.'); }
    },
    async snooze(name, date, on) {
      try {
        const r = await store.setSnooze(date, name, on);
        if (refused(r)) return;
        await ctx.reload();
        if (on) ctx.toast(`Later: ${name}`, 'Undo', () => ctx.restore(name, date, r && r.prev));
      } catch (e) { fail('snooze', e, 'could not save that.'); }
    },
    async restore(name, date, prev) {
      try {
        const r = await store.restoreFlags(date, name, prev);
        refused(r);
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
    setTab(id) {
      id = pageId(id);
      if (!isTab(id) || id === state.tab) { if (isTab(id)) render(); return; }
      state.tab = id; state.deckOffset = 0; state.enter = true;
      render();
      if (view.pageChanged) view.pageChanged(id);
    },
    /* Show a page and hand back its board once it is running (null for
       Rhythm's own pages). */
    async showPage(id) {
      id = pageId(id);
      ctx.setTab(id);
      await loaded;
      if (!EMBEDS[id] || state.tab !== id) return null;
      render();
      return embed && embed.page === id ? embed.ready : null;
    },
    get embed() { return embed; },
    /* Today's list: one read at a time; a change during a read asks for one more. */
    loadFeed() {
      if (feedLoading) { feedAgain = true; return; }
      feedLoading = true;
      state.feedStale = false;
      loadFeed(plugin, state.data, D.todayISO())
        .then(f => { state.feed = f; state.feedError = false; }, e => { console.error('rhythm today', e); state.feedError = true; })
        .then(() => {
          feedLoading = false;
          if (feedAgain) { feedAgain = false; state.feedStale = true; }
          if (state.tab === 'today') render();
        });
    },
    /* Something the list is made of changed: redraw from a fresh read. */
    feedChanged() {
      state.feedStale = true;
      if (state.tab === 'today' && state.loaded) render();
    },
    /* Tick a to-do or a reminder the way the Fortnight board does. */
    async tickCard(card) {
      if (card.done) return;
      let r;
      try { r = await plugin.planner.store.tick(card, D.todayISO()); }
      catch (e) { console.error('rhythm tick', e); r = { ok: false, reason: 'error' }; }
      if (r && r.ok === false) { if (r.reason !== 'busy') new Notice(`Rhythm: couldn't tick "${card.text}": ${why(r.reason)}.`); }
      else ctx.toast(`Done: ${card.text}`);
      ctx.feedChanged();
    },
    openCard(card) { plugin.planner.openTask(card); },
    /* The Today page's right-click menu (page-now.js): the same writes the
       Fortnight board makes, refused the same way when a line changed. */
    async moveCard(card, date) {
      let r;
      try { r = await plugin.planner.store.move(card, date); }
      catch (e) { console.error('rhythm move', e); r = { ok: false, reason: 'error' }; }
      if (r && r.ok === false) { if (r.reason !== 'busy') new Notice(`Rhythm: couldn't move "${card.text}": ${why(r.reason)}.`); }
      else ctx.toast(`${card.text} → ${D.relative(date, D.todayISO())}`);
      ctx.feedChanged();
    },
    /* Delete, with Undo. A repeating line asks first: deleting it ends the
       repeat for good (the store refuses it until the person says so). */
    async removeCard(card, series) {
      const pstore = plugin.planner.store;
      let r;
      try { r = await pstore.remove(card, series ? { series: true } : undefined); }
      catch (e) { console.error('rhythm delete', e); r = { ok: false, reason: 'error' }; }
      if (r && r.reason === 'repeats') {
        openConfirmModal(app, ctx, {
          title: 'Delete a repeating item?',
          text: `"${card.text}" repeats. Deleting it ends the repeat for good — every later one goes too. To skip just this one, tick it instead.`,
          confirm: 'Delete the series',
          onConfirm: () => ctx.removeCard(card, true),
        });
        return;
      }
      if (r && r.ok === false) { if (r.reason !== 'busy') new Notice(`Rhythm: couldn't delete "${card.text}": ${why(r.reason)}.`); }
      else {
        ctx.toast(`Deleted: ${card.text}`, 'Undo', async () => {
          let b;
          try { b = await pstore.putBack(r); } catch (e) { console.error('rhythm undo delete', e); b = { ok: false }; }
          if (!b.ok) new Notice(`Rhythm: couldn't put "${card.text}" back — its note changed around it, so nothing was written. The line was: ${r.raw.replace(/\r$/, '')}`);
          ctx.feedChanged();
        });
      }
      ctx.feedChanged();
    },
    /* A reminder opens in the reminders editor; a to-do in Tasks' own edit
       box when Tasks is there, or in its note at its line when it is not. */
    async editCard(card) {
      const pstore = plugin.planner.store;
      if (card.source === 'nudge') {
        const ours = plugin.reminders && plugin.reminders.store;
        const held = ours ? await pstore.reminderFor(card) : null;
        if (!held) { new Notice(`Rhythm: couldn't open "${card.text}": ${why(ours ? 'changed' : 'no-nudge')}.`); ctx.feedChanged(); return; }
        const { groups } = await ours.load();
        const done = (r, what) => { if (r && r.ok === false) new Notice(`Rhythm: "${card.text}" changed in its note — ${what}.`); ctx.feedChanged(); };
        openReminderEditor(app, {
          item: held, groups: groups || [], today: D.todayISO(),
          onSave: async fields => done(await ours.update(held, fields), 'your changes were not saved'),
          onDelete: async () => done(await ours.remove(held), 'nothing was deleted'),
        });
        return;
      }
      const tp = app.plugins && app.plugins.plugins && app.plugins.plugins['obsidian-tasks-plugin'];
      const api = tp && tp.apiV1 && typeof tp.apiV1.editTaskLineModal === 'function' ? tp.apiV1 : null;
      if (card.source !== 'tasks' || !api) { ctx.openCard(card); return; }
      const before = card.raw.replace(/\r$/, '');
      let after;
      try { after = await api.editTaskLineModal(before); }
      catch (e) { console.error('rhythm edit', e); ctx.openCard(card); return; }
      if (typeof after !== 'string' || after === before) return;
      const r = await pstore.rewrite(card, after);
      if (r && r.ok === false && r.reason !== 'busy') new Notice(`Rhythm: couldn't save "${card.text}": ${why(r.reason)}.`);
      ctx.feedChanged();
    },
    /* Pick any day for a card (the menu offers the next fortnight). */
    pickCardDate(card) { openDateModal(app, ctx, card.text, card.date || D.todayISO(), date => ctx.moveCard(card, date)); },
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
        if (refused(res)) return;
        ctx.toast(to ? `${name} → ${D.fmtShort(to)}` : `${name} back to waiting`, 'Undo', async () => {
          try { const u = await undoMove(store, name, from, to, res); await ctx.reload(); refused(u); }
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
      try { state.data = await store.load(); state.loaded = true; state.feedStale = true; }
      catch (e) { fail('load', e, 'could not read the Rhythm folder.'); state.loaded = true; }
      render();
      markLoaded();
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
    /* Ask AI about one item (its menu's "Ask AI about this"). */
    canAsk() { return !!(askAi && plugin.ai && plugin.settings.askAi !== false); },
    askAbout(item) { if (ctx.canAsk()) askAi.open(item); },
    /* One change an Ask AI answer suggested, after the person tapped it.
       The same writes the pages make, refused the same way; nothing here
       deletes. Resolves to { ok, text } for the chat to show. */
    async runAiAction(a) {
      const today = D.todayISO();
      try {
        if (a.kind === 'tick_habit' || a.kind === 'skip_habit') {
          const f = AI.findHabit(a.name, state.data.practices);
          if (!f.ok) return { ok: false, text: `There is no habit called "${a.name}".` };
          const name = f.practice.name;
          const tick = a.kind === 'tick_habit';
          const r = await (tick ? store.setDone(a.date, name, true) : store.setSkip(a.date, name, true));
          if (r && r.refused) return { ok: false, text: refusedText(r.refused) };
          await ctx.reload();
          ctx.toast(tick ? `Ticked ${name}` : `Not today: ${name}`, 'Undo', () => ctx.restore(name, a.date, r && r.prev));
          return { ok: true };
        }
        if (a.kind === 'add_reminder') {
          const R = plugin.reminders && plugin.reminders.store;
          if (!R) return { ok: false, text: 'Reminders are not running.' };
          const fields = { title: a.title };
          if (a.due) fields.due = a.due;
          if (a.time) fields.time = a.time;
          const r = await R.add(fields);
          if (!r || r.ok === false) return { ok: false, text: 'The reminder could not be written.' };
          ctx.feedChanged();
          ctx.toast(`Reminder added: ${a.title}`);
          return { ok: true };
        }
        if (a.kind === 'move_todo') {
          const pstore = plugin.planner.store;
          const board = planBoard({ today, tasks: await pstore.load(), settings: plugin.planner.settings });
          const cards = [...board.slipped, ...board.days.flatMap(d => d.cards), ...board.nextWeek.days.flatMap(d => d.cards), ...board.nextWeek.anyDay, ...board.later]
            .filter(c => c.source === 'tasks' || c.source === 'nudge');
          const f = AI.findCard(a.text, cards);
          if (!f.ok) return { ok: false, text: f.reason === 'ambiguous' ? `More than one is called "${a.text}" — move it yourself.` : `Nothing open is called "${a.text}".` };
          /* A repeating one keeps its rhythm only when moved by hand. */
          if (/🔁/u.test(f.card.raw || '')) return { ok: false, text: 'That one repeats — move it on the Fortnight board.' };
          const r = await pstore.move(f.card, a.date);
          if (r && r.ok === false) return { ok: false, text: `Couldn't move it: ${why(r.reason)}.` };
          ctx.feedChanged();
          ctx.toast(`${f.card.text} → ${D.relative(a.date, today)}`);
          return { ok: true };
        }
        if (a.kind === 'note') {
          await store.appendLog(a.date, a.text);
          await ctx.reload();
          ctx.toast('Saved to the day\'s note', 'Open', () => ctx.openLog(a.date));
          return { ok: true };
        }
      } catch (e) {
        console.error('rhythm ai action', e);
        return { ok: false, text: 'That could not be done: ' + String((e && e.message) || e) };
      }
      return { ok: false, text: 'Rhythm does not know that change.' };
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
    /* Add means what the page means: a reminder on Reminders, Fortnight's
       own quick add on its board (so no button here), a practice, goal,
       event or area everywhere else. */
    if (state.tab === 'reminders') {
      const add = button(header, 'rv-add', null, () => { if (embed && embed.ctl.ctx) embed.ctl.ctx.focusAdd(); }, 'plus');
      add.setAttribute('aria-label', 'Add a reminder');
    } else if (state.tab !== 'fortnight') {
      const add = button(header, 'rv-add', null, () => ctx.add(), 'plus');
      add.setAttribute('aria-label', 'Add');
      if (!state.loaded || !store.hasData()) add.disabled = true;
    }

    /* The bar is rebuilt on every render. Wide: seven segments that scroll
       sideways, so keep where it was scrolled to and bring the page you are
       on into view. Phone: the dock (DOCK_SLOTS pages + More, which is
       current when the page is one of the rest); the CSS hides the extra
       segments and the More slot where they do not belong. */
    const scrolled = nav.scrollLeft;
    clear(nav);
    TABS.forEach((t, i) => {
      /* The icon shows only in the phone dock (styles.css). */
      const b = button(nav, 'rv-tab' + (i >= DOCK_SLOTS ? ' rv-tab-more-item' : '') + (state.tab === t.id ? ' is-active' : ''), t.label, () => ctx.setTab(t.id), t.icon);
      b.setAttribute('aria-selected', state.tab === t.id ? 'true' : 'false');
      b.setAttribute('role', 'tab');
    });
    const inMore = TABS.findIndex(t => t.id === state.tab) >= DOCK_SLOTS;
    const more = button(nav, 'rv-tab rv-tab-more' + (inMore ? ' is-active' : ''), 'More', () => moreSheet.open(), 'ellipsis');
    more.setAttribute('role', 'tab');
    more.setAttribute('aria-selected', inMore ? 'true' : 'false');
    more.setAttribute('aria-haspopup', 'dialog');
    more.setAttribute('aria-expanded', moreSheet.isOpen() ? 'true' : 'false');
    moreSheet.sync();
    nav.scrollLeft = scrolled;
    const on = nav.querySelector('.rv-tab.is-active');
    if (on && on.offsetWidth && nav.scrollWidth > nav.clientWidth) {
      const nb = nav.getBoundingClientRect(), ab = on.getBoundingClientRect();
      if (ab.left < nb.left) nav.scrollLeft -= nb.left - ab.left + 12;
      else if (ab.right > nb.right) nav.scrollLeft += ab.right - nb.right + 12;
    }
    /* The module pages work without a Rhythm folder, so the tabs show as
       soon as Rhythm has loaded; Rhythm's own pages show its setup card
       until there is one. */
    nav.hidden = !state.loaded;
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

  /* A module board as the page. It is mounted once and left alone by
     Rhythm's re-renders (a tick, a reload, the minute timer), which only
     redraw the header around it. */
  function showEmbed(page) {
    if (embed && embed.page === page) return;
    dropEmbed();
    clear(main);
    main.scrollTop = 0;
    main.classList.add('is-embed');
    const box = el(main, 'div', `rv-embed rv-embed-${page}` + (state.enter && plugin.settings.softEntrance !== false ? ' rv-embed-enter' + (splashUp() ? ' is-waiting' : '') : ''));
    embed = mountEmbed(page, box, plugin, view);
    embed.start();
  }
  function dropEmbed() {
    if (!embed) return;
    embed.stop();
    embed = null;
    main.classList.remove('is-embed');
  }

  const splashUp = () => !!root.querySelector('.rv-splash:not(.is-leaving)');

  function render() {
    if (stopped) return;
    renderPage();
    if (askAi) askAi.sync();
  }

  function renderPage() {
    paintAccent();
    paintBackground();
    renderHeader();
    if (EMBEDS[state.tab] && state.loaded) { showEmbed(state.tab); state.enter = false; return; }
    dropEmbed();
    clear(main);
    main.scrollTop = 0;
    if (!state.loaded) { el(main, 'p', 'rv-muted rv-center', 'Loading…'); return; }
    if (!store.hasData()) { renderSetup(); return; }
    const page = el(main, 'div', `rv-page rv-page-${state.tab}`);
    let drawn = true;
    if (state.tab === 'today') drawn = renderNow(page, ctx) !== false;
    else if (state.tab === 'habits') renderToday(page, ctx);
    else if (state.tab === 'plan') renderPlan(page, ctx);
    else if (state.tab === 'month') renderMonth(page, ctx);
    else renderAreas(page, ctx);
    if (!drawn) return;
    if (state.enter && plugin.settings.softEntrance !== false) {
      page.classList.add('rv-enter');
      if (splashUp()) page.classList.add('is-waiting');
      let i = 0;
      for (const child of page.children) { child.style.setProperty('--rv-i', String(i)); if (!child.classList.contains('rv-group-header')) i++; }
    }
    state.enter = false;
  }

  /* Welcome: the sun (or moon) breathing in a glass disc with rings rolling
     out of it, and a greeting — then a fade into the page, whose blocks
     wait under the splash and rise in as it lifts. */
  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Still up.' : h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : h < 22 ? 'Good evening.' : 'Time to rest.';
  }
  function showSplash() {
    const sp = el(root, 'div', 'rv-splash');
    sp.setAttribute('aria-hidden', 'true');
    const mark = el(sp, 'div', 'rv-splash-mark');
    el(mark, 'span', 'rv-splash-glow');
    el(mark, 'span', 'rv-splash-ring');
    el(mark, 'span', 'rv-splash-ring is-late');
    const core = el(mark, 'span', 'rv-splash-core');
    icon(core, new Date().getHours() >= 19 || new Date().getHours() < 5 ? 'moon' : 'sun');
    el(sp, 'div', 'rv-splash-hello', greeting());
    el(sp, 'div', 'rv-splash-date', D.fmtLong(D.todayISO()));
    const shownAt = Date.now();
    let gone = false;
    const leave = () => {
      if (gone) return; gone = true;
      sp.classList.add('is-leaving');
      for (const w of root.querySelectorAll('.is-waiting')) w.classList.remove('is-waiting');
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
    /* The module boards keep their own keys. */
    if (EMBEDS[state.tab]) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (document.querySelector('.modal')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[1-7]$/.test(k) && state.tab === 'habits' && plugin.settings.todayView !== 'week') {
      const plan = M.planDay(state.data, state.date, { focusCount: plugin.settings.focusCount, weekStart: plugin.settings.weekStart });
      const r = plan.focus[parseInt(k, 10) - 1];
      if (r) { e.preventDefault(); ctx.toggle(r.p.name, state.date, true); }
      return;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const dir = k === 'ArrowLeft' ? -1 : 1;
      e.preventDefault();
      const weekly = state.tab === 'plan' || (state.tab === 'habits' && plugin.settings.todayView === 'week');
      if (weekly) ctx.setDate(D.addDays(state.date, 7 * dir));
      else if (state.tab === 'habits') ctx.setDate(D.addDays(state.date, dir));
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
      if (plugin.ai) {
        askAi = mountAskAi(root, {
          enabled: () => state.loaded && plugin.settings.askAi !== false && (store.hasData() || !!EMBEDS[state.tab]),
          snapshot: focus => ({
            page: (TABS.find(t => t.id === state.tab) || TABS[0]).label,
            /* The pages that walk through days show the day you are on. */
            date: ['habits', 'month', 'plan'].includes(state.tab) ? state.date : D.todayISO(),
            today: D.todayISO(),
            screen: main ? main.innerText : '',
            focus,
          }),
          ask: args => plugin.ai.ask(args),
          providerName: () => plugin.ai.current().name,
          run: a => ctx.runAiAction(a),
          save: (md, title) => store.saveChat(D.todayISO(), title, md),
          openSettings: () => ctx.openSettings(),
        });
      }
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
          /* The sheet belongs to the phone dock only. */
          if (w >= 560) moreSheet.close(false);
        });
        resizeObserver.observe(root);
      }
      if (view.registerInterval) {
        view.registerInterval(window.setInterval(() => {
          const t = D.todayISO();
          if (state.date !== t && state.tab === 'habits' && state.date === D.addDays(t, -1)) { state.date = t; render(); }
          if (state.tab === 'today' && state.feed && state.feed.today !== t) render();
        }, 60000));
      }
      const splash = plugin.settings.softEntrance !== false ? showSplash() : null;
      await ctx.reload();
      if (splash) splash.leave();
      if (isStale(plugin)) ctx.refreshCalendars(true);
    },
    stop() { stopped = true; moreSheet.close(false); if (askAi) askAi.stop(); dropEmbed(); if (reloadTimer) clearTimeout(reloadTimer); if (toastTimer) clearTimeout(toastTimer); if (resizeObserver) resizeObserver.disconnect(); },
    render,
    /* The pane was resized: a board that lays itself out by width (Fortnight's
       phone view) is told. */
    relayout() { if (embed && embed.ctl.relayout) embed.ctl.relayout(); },
    /* Obsidian's theme or accent changed. */
    restyle() {
      if (!embed) return;
      if (embed.ctl.restyle) embed.ctl.restyle();
      if (embed.ctl.look) embed.ctl.look();
    },
  };
}

module.exports = { mountApp, TABS, DOCK_SLOTS, pageId };
