'use strict';
/* The board. Everything the user actually touches lives here; every decision
   about WHAT to show was made in model.js, so this file only arranges.

   Rendering is a full rebuild of the list on each change — the lists are tens
   of rows, not thousands, and a rebuild cannot drift out of step with the
   file the way a patched DOM can. */

const { Notice, Menu } = require('obsidian');
const { el, icon, button, input, clear } = require('./dom');
const { makeStore } = require('./store');
const { FILTERS, SNOOZE, isLightLook } = require('./constants');
const M = require('./model');
const D = require('./dates');
const R = require('./recur');
const { parseQuick } = require('./quickparse');
const { openEditor } = require('./modals');

const SECTIONS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'someday', label: 'Someday' },
];
const DONE_PREVIEW = 20;
const FOR_FILTER = { overdue: ['overdue'], today: ['overdue', 'today'], week: ['overdue', 'today', 'tomorrow', 'week'], someday: ['someday'], done: ['done'] };

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

function mountBoard(view) {
  const plugin = view.plugin;
  const app = plugin.app;
  const store = makeStore(plugin);
  const root = view.contentEl;

  const state = { items: [], groups: [], lists: [], filter: 'all', group: '', query: '', tag: '', today: D.todayISO(), loaded: false, narrow: false, drawer: false, naming: false };
  let nodes = {};
  let timer = null;
  let sizer = null;

  /* ---- shell ---------------------------------------------------------- */

  /* Surface, tint and light/dark. Cheap, so Obsidian's theme switch can call
     it without rebuilding the board. */
  function applyLook() {
    const s = plugin.settings;
    root.classList.toggle('is-plain', s.surface === 'plain');
    root.classList.toggle('is-light', isLightLook(s.mode, document.body.classList.contains('theme-light')));
    root.setAttribute('data-tint', s.tint || 'aurora');
  }

  function build() {
    clear(root);
    root.classList.add('nd-app');
    applyLook();

    el(root, 'div', 'nd-bg');
    el(root, 'div', 'nd-veil');
    const shell = el(root, 'div', 'nd-shell');
    nodes.side = el(shell, 'aside', 'nd-side');
    nodes.side.setAttribute('aria-label', 'Lists');
    const scrim = el(shell, 'div', 'nd-scrim');
    scrim.addEventListener('click', () => { state.drawer = false; applySide(); });
    const scroll = el(shell, 'div', 'nd-scroll');
    const page = el(scroll, 'div', 'nd-page');

    /* header */
    const head = el(page, 'header', 'nd-head');
    const ht = el(head, 'div', 'nd-head-text');
    const hl = el(ht, 'div', 'nd-head-line');
    nodes.sideToggle = button(hl, 'nd-side-toggle', '', () => toggleSide(), 'panel-left', 'Show or hide the sidebar');
    nodes.greet = el(hl, 'h1', 'nd-greet', greeting(plugin.settings.name));
    nodes.sub = el(ht, 'div', 'nd-sub', '');
    const hr = el(head, 'div', 'nd-head-right');
    nodes.count = el(hr, 'div', 'nd-count');
    nodes.date = el(hr, 'div', 'nd-date', D.shortDate(state.today, state.today));

    /* quick add */
    const add = el(page, 'div', 'nd-add nd-glass');
    icon(add, 'plus', 'nd-add-icon');
    /* The long placeholder teaches the syntax; on a phone it only truncates,
       so the short one earns its place there instead. */
    const narrow = document.body && document.body.classList.contains('is-mobile');
    nodes.addInput = input(add, 'nd-add-input', {
      type: 'text',
      placeholder: narrow ? 'Add a reminder…' : 'Renew the car licence tomorrow at 9am !high #admin',
      'aria-label': 'Add a reminder',
    });
    nodes.addHint = el(add, 'div', 'nd-add-hint');
    /* What the parser understood, announced as it changes. */
    nodes.addHint.setAttribute('aria-live', 'polite');
    nodes.addHint.setAttribute('aria-atomic', 'true');
    button(add, 'nd-add-go', 'Add', () => commitQuickAdd(), null, 'Add this reminder');

    nodes.addInput.addEventListener('input', () => renderHint());
    nodes.addInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitQuickAdd(); }
      if (e.key === 'Escape') { nodes.addInput.value = ''; renderHint(); }
    });

    /* filter bar */
    const bar = el(page, 'div', 'nd-bar');
    nodes.chips = el(bar, 'div', 'nd-chips');
    const search = el(bar, 'div', 'nd-search nd-glass');
    icon(search, 'search', 'nd-search-icon');
    nodes.search = input(search, 'nd-search-input', { type: 'text', placeholder: 'Search reminders', 'aria-label': 'Search reminders' });
    nodes.search.addEventListener('input', () => { state.query = nodes.search.value; renderList(); });
    nodes.clearSearch = button(search, 'nd-search-clear', '', () => {
      nodes.search.value = ''; state.query = ''; renderList(); nodes.search.focus();
    }, 'x', 'Clear the search');

    nodes.tags = el(page, 'div', 'nd-tags');
    nodes.listHead = el(page, 'div', 'nd-list-head');
    nodes.list = el(page, 'div', 'nd-list');

    /* footer */
    const foot = el(page, 'footer', 'nd-foot');
    button(foot, 'nd-link', 'Open the note', () => openNote(), 'pencil', 'Open Reminders.md');
    button(foot, 'nd-link', 'Export to calendar', () => exportICS(), 'download', 'Write the .ics file your phone can import');
    nodes.footNote = el(foot, 'div', 'nd-foot-note', '');

    applySide();
  }

  /* ---- the sidebar ------------------------------------------------------ */

  /* Beside the board when the pane is wide and the setting is on; a drawer
     over it when the pane is narrow, opened and closed per visit. The width
     that matters is the pane's, not the window's — Obsidian splits panes. */
  function applySide() {
    const on = plugin.settings.sidebar !== false;
    root.classList.toggle('is-narrow', state.narrow);
    root.classList.toggle('has-side', !state.narrow && on);
    root.classList.toggle('is-drawer', state.narrow && state.drawer);
    if (nodes.sideToggle) nodes.sideToggle.setAttribute('aria-expanded', String(state.narrow ? state.drawer : on));
  }

  async function toggleSide() {
    if (state.narrow) { state.drawer = !state.drawer; applySide(); return; }
    plugin.settings.sidebar = plugin.settings.sidebar === false;
    applySide();
    await plugin.saveSettings();
  }

  function measure() {
    const narrow = (root.clientWidth || 0) < 720 || !!(document.body && document.body.classList.contains('is-mobile'));
    if (narrow === state.narrow) return;
    state.narrow = narrow;
    if (!narrow) state.drawer = false;
    applySide();
  }

  /* ---- keyboard focus across a rebuild ---------------------------------- */

  /* Every rebuild replaces the node that holds keyboard focus, and focus
     falls to <body>. Focusable nodes carry a stable data-key; before a
     rebuild we note which one has focus, afterwards we put it back. A row
     that has gone hands focus to the row that took its place. */
  function keyed(node, key, kind) {
    node.setAttribute('data-key', key);
    if (kind) node.setAttribute('data-kind', kind);
    return node;
  }

  function focusInfo(node) {
    const a = node || document.activeElement;
    if (!a || !a.getAttribute || !root.contains(a)) return null;
    const key = a.getAttribute('data-key');
    if (!key) return null;
    const row = a.closest ? a.closest('.nd-row') : null;
    const rowIndex = row && nodes.list ? Array.prototype.indexOf.call(nodes.list.querySelectorAll('.nd-row'), row) : -1;
    return { key, kind: a.getAttribute('data-kind') || '', rowIndex };
  }

  function refocus(info) {
    if (!info) return;
    const put = n => { if (n && n.focus) { try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } } return !!n; };
    const all = Array.prototype.slice.call(root.querySelectorAll('[data-key]'));
    if (put(all.find(n => n.getAttribute('data-key') === info.key))) return;
    if (info.rowIndex >= 0) {
      const rows = root.querySelectorAll('.nd-row');
      if (rows.length) {
        const r = rows[Math.min(info.rowIndex, rows.length - 1)];
        if (put(r.querySelector('[data-kind="' + info.kind + '"]') || r.querySelector('[data-kind="check"]'))) return;
      }
    }
    put(root.querySelector('.nd-chip'));
  }

  /* Run a rebuild without losing the user's place. `hint` stands in for the
     focus a closed menu has already taken away (focus is on <body> then). */
  function rebuild(fn, hint) {
    const a = document.activeElement;
    const info = focusInfo() || (!a || a === document.body ? hint || null : null);
    fn();
    refocus(info);
  }

  function pick(filter, group) {
    state.filter = filter;
    state.group = group;
    state.drawer = false;
    applySide();
    rebuild(() => { renderSide(); renderChips(); renderList(); });
  }

  function sideItem(parent, label, iconName, n, on, onClick, key) {
    const b = button(parent, 'nd-side-item' + (on ? ' is-on' : ''), label, onClick, iconName);
    keyed(b, key, 'side');
    b.setAttribute('aria-current', on ? 'true' : 'false');
    el(b, 'span', 'nd-side-n', n ? n : '');
    return b;
  }

  function renderSide() {
    const side = nodes.side;
    clear(side);
    const b = M.board(state.items, state.today);
    const n = M.viewCounts(b);
    const views = el(side, 'nav', 'nd-side-group');
    for (const f of FILTERS) {
      sideItem(views, f.label, f.icon, n[f.key], !state.group && state.filter === f.key, () => pick(f.key, ''), 'side:' + f.key);
    }

    el(side, 'div', 'nd-side-label', 'Lists');
    const lists = el(side, 'nav', 'nd-side-group');
    for (const l of M.listCounts(state.items, state.lists)) {
      sideItem(lists, l.name, l.name === 'Inbox' ? 'inbox' : 'list', l.open, state.group === l.name, () => pick('all', l.name), 'list:' + l.name);
    }

    if (state.naming) {
      const box = el(side, 'div', 'nd-side-new');
      icon(box, 'folder-plus');
      const inp = input(box, 'nd-side-input', { type: 'text', placeholder: 'List name', 'aria-label': 'New list name' });
      let done = false;
      const finish = async commit => {
        if (done) return;
        done = true;
        state.naming = false;
        const name = inp.value;
        if (commit && name.trim()) {
          const r = await store.addList(name);
          if (r.ok) { state.group = r.name; state.filter = 'all'; }
          await reload();
        } else renderSide();
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      inp.addEventListener('blur', () => finish(true));
      setTimeout(() => inp.focus(), 0);
    } else {
      keyed(button(side, 'nd-side-item nd-side-add', 'New list', () => { state.naming = true; renderSide(); }, 'folder-plus'), 'side-new', 'side');
    }
  }

  /* ---- data ----------------------------------------------------------- */

  async function reload(hint) {
    const r = await store.load();
    state.items = r.items;
    state.groups = r.groups;
    state.lists = r.lists || r.groups;
    /* The list on screen was renamed or removed in the note. */
    if (state.group && state.lists.indexOf(state.group) === -1) state.group = '';
    /* The tag on screen no longer sits on any reminder (its last carrier was
       edited or deleted): its chip is gone, so the filter must go with it. */
    if (state.tag && !state.items.some(i => (i.tags || []).indexOf(state.tag) !== -1)) state.tag = '';
    state.today = D.todayISO();
    state.loaded = true;
    renderAll(hint && hint.key ? hint : null);
  }

  /* ---- render --------------------------------------------------------- */

  function renderAll(hint) {
    rebuild(() => {
      renderSide();
      renderChips();
      renderTags();
      renderHeader();
      renderList();
    }, hint);
  }

  function renderHeader() {
    const b = M.board(state.items, state.today);
    nodes.greet.textContent = greeting(plugin.settings.name);
    /* The day can turn over while the board is open. */
    if (nodes.date) nodes.date.textContent = D.shortDate(state.today, state.today);
    nodes.sub.textContent = M.summary(b);
    clear(nodes.count);
    const n = b.counts.due;
    const pill = el(nodes.count, 'div', 'nd-pill nd-pill-count' + (b.counts.overdue ? ' is-late' : n ? ' is-due' : ' is-clear'));
    icon(pill, b.counts.overdue ? 'bell-ring' : 'bell');
    el(pill, 'span', null, n ? `${n} to do` : 'Clear');
    nodes.footNote.textContent = `${b.counts.open} open · ${b.counts.done} done · ${store.path()}`;
  }

  function renderChips() {
    clear(nodes.chips);
    const n = M.viewCounts(M.board(state.items, state.today));
    for (const f of FILTERS) {
      const on = !state.group && state.filter === f.key;
      const c = button(nodes.chips, 'nd-chip' + (on ? ' is-on' : ''), f.label, () => pick(f.key, ''), f.icon);
      keyed(c, 'chip:' + f.key, 'chip');
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (n[f.key]) el(c, 'span', 'nd-chip-n', n[f.key]);
    }
  }

  function renderTags() {
    clear(nodes.tags);
    const tags = M.tagsOf(state.items);
    if (!tags.length) { nodes.tags.classList.add('is-hidden'); return; }
    nodes.tags.classList.remove('is-hidden');
    /* Only the twelve busiest tags get a chip — but the one filtering the
       board always does, or there would be no way to switch it off. */
    const shown = tags.slice(0, 12);
    if (state.tag && shown.indexOf(state.tag) === -1) shown.push(state.tag);
    for (const t of shown) {
      const on = state.tag === t;
      const b = button(nodes.tags, 'nd-tag' + (on ? ' is-on' : ''), t, () => {
        state.tag = state.tag === t ? '' : t;
        rebuild(() => { renderTags(); renderList(); });
      });
      keyed(b, 'tag:' + t, 'tag');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function renderHint() {
    const raw = nodes.addInput.value.trim();
    clear(nodes.addHint);
    if (!raw) { nodes.addHint.classList.remove('is-on'); return; }
    const q = parseQuick(raw, state.today);
    const bits = [];
    if (q.due) bits.push(D.relative(q.due, state.today));
    if (q.time) bits.push(q.time);
    if (q.priority !== 'normal') bits.push(q.priority);
    if (q.repeat) bits.push(R.describe(q.repeat).toLowerCase());
    for (const t of q.tags) bits.push(t);
    nodes.addHint.classList.toggle('is-on', bits.length > 0);
    for (const b of bits) el(nodes.addHint, 'span', 'nd-hint-bit', b);
  }

  function renderList() {
    clear(nodes.list);
    renderListHead();
    if (!state.loaded) { el(nodes.list, 'div', 'nd-empty', 'Reading your reminders…'); return; }

    const filtered = M.filterItems(state.items, { query: state.query, tag: state.tag, group: state.group });
    const b = M.board(filtered, state.today);
    const keys = FOR_FILTER[state.filter] || SECTIONS.map(s => s.key);
    let shown = 0;

    for (const key of keys) {
      const items = key === 'done' ? b.done : b[key];
      if (!items || !items.length) continue;
      shown += items.length;
      const sec = el(nodes.list, 'section', 'nd-sec');
      const h = el(sec, 'div', 'nd-sec-head');
      el(h, 'span', 'nd-sec-title', key === 'done' ? 'Done' : (SECTIONS.find(s => s.key === key) || {}).label);
      el(h, 'span', 'nd-sec-n', items.length);
      const rows = el(sec, 'div', 'nd-rows');
      for (const it of items) renderRow(rows, it);
    }

    /* Done is a record, not a queue: it stays out of the way unless asked for. */
    if (state.filter === 'all' && plugin.settings.showDone && b.done.length) {
      const sec = el(nodes.list, 'section', 'nd-sec is-muted');
      const h = el(sec, 'div', 'nd-sec-head');
      const part = b.done.slice(0, DONE_PREVIEW);
      el(h, 'span', 'nd-sec-title', 'Done');
      el(h, 'span', 'nd-sec-n', part.length < b.done.length ? `${part.length} of ${b.done.length}` : b.done.length);
      /* Twenty rows are all this section shows; the rest are one click away. */
      if (part.length < b.done.length) keyed(button(h, 'nd-link nd-sec-more', `Show all ${b.done.length}`, () => pick('done', ''), null, 'Show every ticked-off reminder'), 'done-more', 'more');
      const rows = el(sec, 'div', 'nd-rows');
      for (const it of part) renderRow(rows, it);
      shown += b.done.length;
    }

    if (!shown) renderEmpty();
  }

  /* Which list is on screen — and, with the sidebar hidden, the way back. */
  function renderListHead() {
    clear(nodes.listHead);
    nodes.listHead.classList.toggle('is-hidden', !state.group);
    if (!state.group) return;
    icon(nodes.listHead, state.group === 'Inbox' ? 'inbox' : 'list', 'nd-list-head-icon');
    el(nodes.listHead, 'h2', 'nd-list-title', state.group);
    keyed(button(nodes.listHead, 'nd-list-clear', 'All reminders', () => pick('all', ''), 'x', 'Back to every reminder'), 'list-clear', 'clear');
  }

  function renderEmpty() {
    const e = el(nodes.list, 'div', 'nd-empty nd-glass');
    if (state.query || state.tag) {
      icon(e, 'search', 'nd-empty-icon');
      el(e, 'div', 'nd-empty-title', 'Nothing matches');
      el(e, 'div', 'nd-empty-sub', 'Try a different word, or clear the filters.');
      return;
    }
    if (state.group && state.filter === 'all') {
      icon(e, 'list', 'nd-empty-icon');
      el(e, 'div', 'nd-empty-title', `Nothing in ${state.group} yet`);
      el(e, 'div', 'nd-empty-sub', 'Anything you add above goes into this list.');
      return;
    }
    if (!state.items.length) {
      icon(e, 'bell', 'nd-empty-icon');
      el(e, 'div', 'nd-empty-title', 'Nothing on the list yet');
      el(e, 'div', 'nd-empty-sub', 'Type what you must not forget in the box above — "Renew the car licence tomorrow at 9am".');
      return;
    }
    icon(e, 'check', 'nd-empty-icon');
    el(e, 'div', 'nd-empty-title', state.filter === 'done' ? 'Nothing ticked off yet' : 'All clear here');
    el(e, 'div', 'nd-empty-sub', state.filter === 'done' ? 'Ticked reminders collect here.' : 'Nothing in this list needs you right now.');
  }

  function renderRow(parent, it) {
    const late = M.overdueDays(it, state.today);
    const row = el(parent, 'div', 'nd-row' + (it.done ? ' is-done' : '') + (late ? ' is-late' : ''));
    row.setAttribute('data-priority', it.priority || 'normal');

    const check = button(row, 'nd-check', '', () => tick(it, row), null, it.done ? 'Mark as not done' : 'Mark as done');
    keyed(check, 'row-check:' + it.line, 'check');
    check.setAttribute('aria-pressed', it.done ? 'true' : 'false');
    icon(check, 'check', 'nd-check-mark');

    const main = el(row, 'div', 'nd-row-main');
    const title = button(main, 'nd-row-title', it.title || '(untitled)', () => edit(it), null, 'Edit this reminder');
    keyed(title, 'row-title:' + it.line, 'title');
    if (it.done) title.classList.add('is-done');

    const meta = el(main, 'div', 'nd-row-meta');
    if (it.due) {
      const pill = el(meta, 'span', 'nd-pill nd-due' + (late ? ' is-late' : D.diffDays(state.today, it.due) === 0 ? ' is-today' : ''));
      icon(pill, late ? 'flag' : 'calendar');
      el(pill, 'span', null, D.relative(it.due, state.today));
      if (late > 0) el(pill, 'span', 'nd-late-n', late === 1 ? '1 day late' : `${late} days late`);
    }
    if (it.time) { const p = el(meta, 'span', 'nd-pill nd-time'); icon(p, 'clock'); el(p, 'span', null, it.time); }
    if (it.repeat) { const p = el(meta, 'span', 'nd-pill nd-repeat'); icon(p, 'repeat'); el(p, 'span', null, R.describe(it.repeat) || it.repeat); }
    if (it.group) el(meta, 'span', 'nd-pill nd-group', it.group);
    for (const t of it.tags || []) el(meta, 'span', 'nd-pill nd-tagpill', t);
    if (it.done && it.doneDate) el(meta, 'span', 'nd-pill nd-donepill', `Done ${D.relative(it.doneDate, state.today).toLowerCase()}`);

    const acts = el(row, 'div', 'nd-row-acts');
    if (!it.done) keyed(button(acts, 'nd-act', '', e => snoozeMenu(it, e), 'alarm-clock', 'Snooze'), 'row-snooze:' + it.line, 'snooze');
    keyed(button(acts, 'nd-act', '', e => rowMenu(it, e), 'more-horizontal', 'More'), 'row-more:' + it.line, 'more');
    return row;
  }

  /* ---- actions --------------------------------------------------------- */

  /* Reminders with a write in flight. A second click on the same row (a
     double-click, a held Enter) would otherwise act on the stale copy and,
     for a repeating reminder, complete two occurrences. The rows are rebuilt
     from a fresh read when the write is done, so a later click gets a new
     object and is let through. */
  const pending = new WeakSet();
  async function once(it, fn) {
    if (pending.has(it)) return undefined;
    pending.add(it);
    try { return await fn(); } finally { pending.delete(it); }
  }

  /* A write that found nothing to change — the line moved or went in the note
     while the board was open. Said aloud, because the change would otherwise
     just vanish. */
  function gone(r, what) {
    if (!r || r.ok !== false) return false;
    new Notice(`Nudge: that reminder has moved or gone from the note (or could not be read), so ${what}.`);
    return true;
  }

  async function commitQuickAdd() {
    const raw = nodes.addInput.value.trim();
    if (!raw) return;
    const q = parseQuick(raw, state.today);
    if (!q.title) { new Notice('Nudge: give the reminder something to say.'); return; }
    /* Emptied BEFORE the write: a second Enter or click while it is in flight
       finds nothing to add instead of adding the same reminder again. */
    const typed = nodes.addInput.value;
    nodes.addInput.value = '';
    renderHint();
    let r;
    try {
      r = await store.add({
        title: q.title, due: q.due, time: q.time, priority: q.priority,
        repeat: q.repeat, tags: q.tags, group: state.group || plugin.settings.defaultGroup || '',
      });
    } catch (e) {
      console.error('nudge add', e);
      r = { ok: false };
    }
    if (r && r.ok === false) {
      /* Give the text back, unless the user has already started another. */
      if (!nodes.addInput.value) { nodes.addInput.value = typed; renderHint(); }
      new Notice('Nudge: that reminder could not be added — nothing was written.');
      return;
    }
    await reload();
    await maybeExport();
  }

  function tick(it, row) {
    return once(it, async () => {
      row.classList.add(it.done ? 'is-unticking' : 'is-ticking');
      row.setAttribute('aria-busy', 'true');
      const r = await store.toggle(it, D.todayISO());
      if (!r.ok) { new Notice(tickRefused(r)); await reload(); return; }
      if (r.rolled) new Notice(`Nudge: next one ${D.relative(r.rolled.due, state.today).toLowerCase()}.`);
      await reload();
      await maybeExport();
    });
  }

  /* Why a tick didn't happen. A repeat we can't read is left open on
     purpose — ticking it would end the series without a word. */
  function tickRefused(r) {
    if (r && r.reason === 'repeat') return `Nudge: can't work out when "🔁 ${r.repeat}" comes round next, so it was left open. Edit the repeat, or tick it off in the note.`;
    /* The line was only found by its look-alike on a repeating reminder: the
       board was out of date, so ticking could have closed the wrong occurrence. */
    if (r && r.reason === 'stale') return 'Nudge: that reminder changed since the board last read the note, so nothing was ticked. Here it is as it stands now.';
    return 'Nudge: that line is no longer in the note.';
  }

  /* A menu steals focus and gives it back to nobody: remember where it came
     from so the rebuild after its action can put focus there. */
  function openedFrom(e) {
    return focusInfo(e && e.currentTarget) || focusInfo();
  }

  function snoozeMenu(it, e) {
    const from = openedFrom(e);
    const m = new Menu();
    for (const s of SNOOZE) {
      m.addItem(i => i.setTitle(s.label).setIcon('alarm-clock').onClick(() => once(it, async () => {
        const r = await store.snooze(it, s.days, D.todayISO());
        gone(r, 'it was not snoozed');
        await reload(from);
        await maybeExport();
      })));
    }
    m.addItem(i => i.setTitle('Pick a date…').setIcon('calendar-days').onClick(() => edit(it)));
    showMenu(m, e);
  }

  function rowMenu(it, e) {
    const from = openedFrom(e);
    const m = new Menu();
    m.addItem(i => i.setTitle('Edit').setIcon('pencil').onClick(() => edit(it)));
    m.addItem(i => i.setTitle(it.done ? 'Mark as not done' : 'Mark as done').setIcon('check').onClick(() => once(it, async () => {
      const r = await store.toggle(it, D.todayISO());
      if (!r.ok) new Notice(tickRefused(r));
      await reload(from); await maybeExport();
    })));
    m.addItem(i => i.setTitle('Open in the note').setIcon('pencil').onClick(() => openNote(it)));
    m.addItem(i => i.setTitle('Delete').setIcon('trash-2').onClick(() => once(it, async () => {
      const r = await store.remove(it);
      if (r && r.ok === false) gone(r, 'nothing was deleted');
      else new Notice(`Nudge: removed "${it.title}".`);
      await reload(from);
      await maybeExport();
    })));
    showMenu(m, e);
  }

  function showMenu(m, e) {
    if (e && e.clientX !== undefined && m.showAtMouseEvent) m.showAtMouseEvent(e);
    else if (m.showAtPosition) m.showAtPosition({ x: 0, y: 0 });
  }

  function edit(it) {
    openEditor(app, {
      item: it,
      groups: state.groups,
      today: state.today,
      onSave: fields => once(it, async () => {
        const r = await store.update(it, fields);
        gone(r, 'your changes were not saved');
        await reload(); await maybeExport();
      }),
      onDelete: () => once(it, async () => {
        const r = await store.remove(it);
        gone(r, 'nothing was deleted');
        await reload(); await maybeExport();
      }),
    });
  }

  function add(prefill) {
    openEditor(app, {
      item: Object.assign({ title: '', due: '', time: '', priority: 'normal', repeat: '', tags: [], group: state.group || plugin.settings.defaultGroup || '' }, prefill || {}),
      groups: state.groups,
      today: state.today,
      isNew: true,
      onSave: async fields => {
        const r = await store.add(fields);
        if (r && r.ok === false) { new Notice('Nudge: that reminder could not be added — nothing was written.'); return; }
        await reload(); await maybeExport();
      },
    });
  }

  async function openNote(it) {
    const f = app.vault.getFileByPath(store.path()) || await store.ensureFile();
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(app.vault.getFileByPath(store.path()) || f);
    if (it && leaf.view && leaf.view.editor) {
      try { leaf.view.editor.setCursor({ line: it.line, ch: 0 }); } catch (e) { /* not an editor view */ }
    }
  }

  async function exportICS() {
    const r = await store.exportICS();
    new Notice(`Nudge: ${r.count} reminder${r.count === 1 ? '' : 's'} written to ${r.path}. Open it on your phone to add them to your calendar.`);
  }

  async function maybeExport() {
    if (!plugin.settings.autoExport) return;
    try { await store.exportICS(); } catch (e) { console.error('nudge export', e); }
  }

  function focusAdd() { if (nodes.addInput) nodes.addInput.focus(); }
  function setFilter(key) { if (FOR_FILTER[key] || key === 'all') pick(key, ''); }

  /* ---- lifecycle ------------------------------------------------------- */

  const ctx = { reload, add, focusAdd, setFilter, exportICS, openNote, store, state };

  async function start() {
    build();
    measure();
    if (typeof ResizeObserver === 'function') { sizer = new ResizeObserver(() => measure()); sizer.observe(root); }
    await store.ensureFile();
    await reload();
    /* The date can change while the board is open; so can the greeting. */
    timer = setInterval(() => {
      const t = D.todayISO();
      if (t !== state.today) { state.today = t; renderAll(); }
      else renderHeader();
    }, 60000);
    if (view.registerInterval) view.registerInterval(timer);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (sizer) { sizer.disconnect(); sizer = null; }
    clear(root);
    root.classList.remove('nd-app', 'is-plain', 'is-light', 'is-narrow', 'has-side', 'is-drawer');
  }

  return { start, stop, refresh: reload, look: () => { applyLook(); applySide(); }, ctx };
}

module.exports = { mountBoard, greeting };
