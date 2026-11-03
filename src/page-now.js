'use strict';
/* Today — everything that needs doing today, in three sections: Overdue
   (what slipped from earlier days), Today (today's to-dos and reminders,
   by time) and Habits (the practices due), then today's events. The
   list itself comes from today-feed.js; this page only draws it, in the
   same grouped-list idiom as the rest of Rhythm. A tick goes to whoever owns
   the line: a Tasks line or a reminder through the planner's store (Tasks,
   repeats and ✅ handled as on the Fortnight board), a habit through
   Rhythm's own toggle (with its undo). Right-click (or the … button, which
   a phone can reach) moves, edits or deletes a to-do or a reminder. */

const { Menu } = require('obsidian');
const { el, button, icon } = require('./dom');
const D = require('./dates');
const { titleBar, groupHeader, group, practiceRow } = require('./widgets');

const noteName = p => String(p || '').split('/').pop().replace(/\.md$/, '');
const URGENT = new Set(['highest', 'high']);

/* Move to today (when it slipped) or tomorrow, any other date, edit, open
   the note, delete. A done line has no day left to move to. */
function cardMenu(ev, ctx, card) {
  const today = D.todayISO();
  const tomorrow = D.addDays(today, 1);
  const menu = new Menu();
  if (!card.done) {
    if (card.date !== today) menu.addItem(i => i.setTitle('Move to today').setIcon('calendar-check').onClick(() => ctx.moveCard(card, today)));
    if (card.date !== tomorrow) menu.addItem(i => i.setTitle('Move to tomorrow').setIcon('calendar-plus').onClick(() => ctx.moveCard(card, tomorrow)));
    menu.addItem(i => i.setTitle('Change date…').setIcon('calendar').onClick(() => ctx.pickCardDate(card)));
    menu.addSeparator();
  }
  menu.addItem(i => i.setTitle('Edit').setIcon('pencil').onClick(() => ctx.editCard(card)));
  menu.addItem(i => i.setTitle('Open note').setIcon('external-link').onClick(() => ctx.openCard(card)));
  if (ctx.canAsk && ctx.canAsk()) {
    menu.addItem(i => i.setTitle('Ask AI about this').setIcon('wand-2').onClick(() => ctx.askAbout({
      kind: card.source === 'nudge' ? 'reminder' : 'to-do',
      text: card.text,
      details: [card.date && `on ${card.date}`, card.time && `at ${card.time}`, card.done && 'done'].filter(Boolean).join(' '),
    })));
  }
  menu.addSeparator();
  menu.addItem(i => {
    i.setTitle('Delete').setIcon('trash-2').onClick(() => ctx.removeCard(card));
    if (i.setWarning) i.setWarning(true);
  });
  if (ev && ev.clientX !== undefined && menu.showAtMouseEvent) menu.showAtMouseEvent(ev);
  else if (menu.showAtPosition && ev && ev.target) { const b = ev.target.getBoundingClientRect(); menu.showAtPosition({ x: b.left, y: b.bottom }); }
}

/* A Tasks line or a reminder: tick · name + where it lives · time · (…) */
function cardRow(list, ctx, card, opts) {
  const slipped = opts && opts.slipped;
  const row = el(list, 'div', 'rv-row rv-row-card' + (card.done ? ' is-done' : '') + (slipped ? ' is-slipped' : ''));
  const tick = button(row, 'rv-tick', null, () => ctx.tickCard(card), card.done ? 'check' : null);
  tick.setAttribute('aria-label', card.done ? `${card.text} is done` : `Tick ${card.text}`);
  tick.setAttribute('aria-pressed', card.done ? 'true' : 'false');
  if (card.done) tick.disabled = true;
  const body = el(row, 'div', 'rv-row-body');
  body.addEventListener('click', () => ctx.openCard(card));
  el(body, 'div', 'rv-row-name', card.text);
  const bits = [];
  if (card.source === 'nudge') bits.push(card.group && card.group !== 'Inbox' ? `Reminder · ${card.group}` : 'Reminder');
  else bits.push(noteName(card.path));
  if (slipped && card.date) bits.push(`from ${D.fmtShort(card.date)}`);
  if (card.deadlineOnly) bits.push('due');
  if (URGENT.has(card.priority)) bits.push(card.priority === 'highest' ? 'highest priority' : 'high priority');
  el(body, 'div', 'rv-row-meta', bits.join(' · '));
  if (card.time) {
    const trail = el(row, 'div', 'rv-row-trail');
    el(trail, 'span', 'rv-stack-time', card.time);
  }
  const more = button(row, 'rv-row-more', null, e => cardMenu(e, ctx, card), 'ellipsis');
  more.setAttribute('aria-label', `More for ${card.text}`);
  row.addEventListener('contextmenu', e => { e.preventDefault(); cardMenu(e, ctx, card); });
  return row;
}

/* An event: fixed, so no tick — a glyph, its name, its time. */
function eventCardRow(list, ctx, card) {
  const row = el(list, 'div', 'rv-row rv-row-event');
  icon(row, 'calendar-days', 'rv-lead-glyph');
  const body = el(row, 'div', 'rv-row-body');
  if (card.path) body.addEventListener('click', () => ctx.openNote(card.path));
  el(body, 'div', 'rv-row-name', card.text);
  if (card.area) el(body, 'div', 'rv-row-meta', card.area);
  if (card.time) { const trail = el(row, 'div', 'rv-row-trail'); el(trail, 'span', 'rv-stack-time', card.time); }
  return row;
}

function renderNow(page, ctx) {
  const { state } = ctx;
  const today = D.todayISO();
  titleBar(page, D.fmtLong(today), 'Today');
  const feed = state.feed;
  if (!feed || feed.today !== today || state.feedStale) ctx.loadFeed();
  if (!feed || feed.today !== today) {
    el(page, 'p', 'rv-muted rv-center', state.feedError ? 'Could not read today\'s list — see the console.' : 'Gathering today…');
    /* Only a placeholder: the soft entrance waits for the real list. */
    return false;
  }

  /* Hero: how much is still asked of today. */
  const hero = el(page, 'div', 'rv-hero');
  const n = el(hero, 'div', 'rv-hero-num');
  const copy = el(hero, 'div', 'rv-hero-copy');
  const line = el(copy, 'p', 'rv-hero-line');
  if (feed.open) {
    n.textContent = String(feed.open);
    line.textContent = feed.open === 1 ? 'thing to do today.' : 'things to do today.';
    el(copy, 'p', 'rv-hero-rest', feed.done ? `${feed.done} already done.` : 'One at a time.');
  } else {
    n.textContent = feed.done ? String(feed.done) : '·';
    line.textContent = feed.done ? (feed.done === 1 ? 'thing done.' : 'things done.') : 'Nothing is asked of today.';
    el(copy, 'p', 'rv-hero-rest', feed.done ? 'Nothing more is asked of today.' : 'Rest is allowed.');
  }

  if (feed.slipped.length) {
    groupHeader(page, 'Overdue', String(feed.slipped.length));
    const list = group(page, 'rv-list-slipped');
    for (const c of feed.slipped) cardRow(list, ctx, c, { slipped: true });
  }

  if (feed.todo.length) {
    groupHeader(page, 'Today', String(feed.todo.length));
    const list = group(page);
    for (const c of feed.todo) cardRow(list, ctx, c);
  }

  if (feed.habits.length || feed.habitsLater.length) {
    groupHeader(page, 'Habits');
    const list = group(page);
    for (const r of feed.habits) practiceRow(list, ctx, r, today);
    if (feed.habitsLater.length) {
      const more = button(list, 'rv-row rv-row-disclosure', null, () => ctx.setTab('habits'));
      const body = el(more, 'div', 'rv-row-body');
      el(body, 'div', 'rv-row-name', 'When there\'s space');
      const trail = el(more, 'div', 'rv-row-trail');
      el(trail, 'span', 'rv-count-badge', String(feed.habitsLater.length));
      icon(trail, 'chevron-right', 'rv-chevron');
    }
  }

  if (feed.events.length) {
    groupHeader(page, 'Events');
    const list = group(page);
    for (const c of feed.events) eventCardRow(list, ctx, c);
  }

  if (!feed.open && !feed.events.length && !feed.done) {
    el(page, 'p', 'rv-empty', 'Nothing on today\'s list. Reminders, to-dos with ⏳ or 📅 today, and habits show here.');
  }

  if (feed.doneToday.length) {
    groupHeader(page, 'Done today', String(feed.doneToday.length + feed.habitsDone));
    const list = group(page, 'rv-later');
    for (const c of feed.doneToday) cardRow(list, ctx, c);
  }
}

module.exports = { renderNow, cardRow, cardMenu };
