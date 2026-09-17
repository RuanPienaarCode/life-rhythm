'use strict';
/* Plan — the board. A shelf of flexible practices still looking for a day,
   and seven day columns to drop them on.

   Only weekly and monthly practices reach the board: a daily practice has
   no "when" to decide, so it sits under each column as a quiet count
   rather than as seven cards you would have to place by hand. */

const { Menu } = require('obsidian');
const { el, button, icon } = require('./dom');
const { draggable } = require('./drag');
const D = require('./dates');
const M = require('./model');
const { titleBar, groupHeader, emptyLine } = require('./widgets');

const DAYS = 7;

function renderPlan(page, ctx) {
  const { state, settings } = ctx;
  const today = D.todayISO();
  /* The board always starts today: you cannot promise yesterday anything. */
  const from = state.date < today ? today : state.date;
  const days = M.boardDays(state.data, from, DAYS, { weekStart: settings.weekStart, events: ctx.events });
  const waiting = M.shelf(state.data, from, DAYS, { weekStart: settings.weekStart });
  const placed = days.reduce((n, d) => n + d.planned.length, 0);

  titleBar(page, `${D.fmtDay(from)} – ${D.fmtDay(D.addDays(from, DAYS - 1))}`, 'Plan', {
    prev: from > today ? () => ctx.setDate(D.addDays(from, -DAYS)) : null,
    next: () => ctx.setDate(D.addDays(from, DAYS)),
    reset: from === today ? null : () => ctx.setDate(today),
    resetLabel: 'Back to today',
  });

  el(page, 'p', 'rv-lead', waiting.length
    ? 'Drag what is waiting onto a day, or use its menu. A practice you have placed stays quiet until the day you chose.'
    : 'Everything flexible has a day. Drag a card to a different column to move it.');

  /* ---- the shelf ---- */
  groupHeader(page, 'Waiting for a day', placed ? `${placed} placed` : '');
  const shelf = el(page, 'section', 'rv-shelf');
  shelf.dataset.date = '';
  if (!waiting.length) {
    el(shelf, 'p', 'rv-shelf-empty', 'Nothing is waiting.');
  } else {
    const track = el(shelf, 'div', 'rv-shelf-track');
    for (const r of waiting) track.appendChild(card(ctx, r, null, days, { need: r.need }));
  }

  /* ---- the day columns ---- */
  groupHeader(page, 'The week ahead');
  const board = el(page, 'section', 'rv-board');
  for (const day of days) {
    const col = el(board, 'div', 'rv-col' + (day.date === today ? ' is-today' : '') + (day.load >= 4 ? ' is-full' : ''));
    col.dataset.date = day.date;
    const head = el(col, 'div', 'rv-col-head');
    el(head, 'span', 'rv-col-dow', D.DAY_NAMES[D.weekday(day.date)].slice(0, 3));
    el(head, 'span', 'rv-col-date', String(D.fromISO(day.date).getDate()));
    const body = el(col, 'div', 'rv-col-body');
    for (const e of day.events) {
      const ev = el(body, 'div', 'rv-card rv-card-event');
      icon(ev, 'calendar', 'rv-card-glyph');
      const b = el(ev, 'div', 'rv-card-body');
      el(b, 'div', 'rv-card-name', e.name);
      if (e.time) el(b, 'div', 'rv-card-meta', e.time);
    }
    for (const r of day.planned) body.appendChild(card(ctx, r, day.date, days));
    if (!day.planned.length && !day.events.length) el(body, 'div', 'rv-col-empty', 'Free');
    const foot = el(col, 'div', 'rv-col-foot');
    el(foot, 'span', null, day.dailyCount ? `+ ${day.dailyCount} daily` : '');
  }

  if (!state.data.practices.some(M.isFlexible)) {
    emptyLine(page, 'Every practice is daily, so there is nothing to spread. Give one a weekly or monthly rhythm and it will appear here.');
  }
}

/* One draggable card. `date` is the day it currently sits on, or null on
   the shelf. */
function card(ctx, r, date, days, opts) {
  const node = el(null, 'div', 'rv-card rv-card-practice' + (r.pr.doneToday ? ' is-done' : ''));
  const grip = el(node, 'div', 'rv-card-grip');
  icon(grip, 'grip-vertical');
  const body = el(node, 'div', 'rv-card-body');
  const top = el(body, 'div', 'rv-card-name');
  top.textContent = r.p.name;
  if (opts && opts.need > 1) el(body, 'span', 'rv-card-need', `×${opts.need}`);
  const bits = [r.p.area, r.p.minutes ? `${r.p.minutes} min` : ''].filter(Boolean);
  el(body, 'div', 'rv-card-meta', bits.join(' · '));

  const move = to => ctx.movePlan(r.p.name, date, to);
  body.addEventListener('click', () => openMenu(null, node));

  function openMenu(ev, anchor) {
    const menu = new Menu();
    for (const d of days) {
      if (d.date === date) continue;
      menu.addItem(i => i.setTitle(`Move to ${D.fmtShort(d.date)}`).setIcon('calendar').onClick(() => move(d.date)));
    }
    if (date) menu.addItem(i => i.setTitle('Back to waiting').setIcon('undo-2').onClick(() => move(null)));
    menu.addItem(i => i.setTitle('Open note').setIcon('external-link').onClick(() => ctx.openNote(r.p.path)));
    if (ev && ev.clientX !== undefined && menu.showAtMouseEvent) menu.showAtMouseEvent(ev);
    else if (menu.showAtPosition) { const b = anchor.getBoundingClientRect(); menu.showAtPosition({ x: b.left, y: b.bottom }); }
  }

  draggable(grip, {
    card: node,
    dropSelector: '[data-date]',
    onDrop: target => {
      const to = target.dataset.date || null;
      if (to !== date) move(to);
    },
  });
  return node;
}

module.exports = { renderPlan };
