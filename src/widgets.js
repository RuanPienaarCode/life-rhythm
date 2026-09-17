'use strict';
/* Shared UI pieces, in the Apple grouped-list idiom: an inset group, rows
   with a leading control, a two-line body and a trailing affordance. */

const { Menu } = require('obsidian');
const { el, button, icon } = require('./dom');
const D = require('./dates');
const M = require('./model');

/* Large title block: an uppercase eyebrow line, then the title. */
function titleBar(page, eyebrow, title, o) {
  const bar = el(page, 'div', 'rv-titlebar');
  const top = el(bar, 'div', 'rv-titlebar-top');
  if (o && o.prev) { const b = button(top, 'rv-nav', null, o.prev, 'chevron-left'); b.setAttribute('aria-label', 'Previous'); }
  const mid = el(top, 'div', 'rv-titlebar-mid');
  if (eyebrow) el(mid, 'div', 'rv-eyebrow', eyebrow);
  el(mid, 'h1', 'rv-large-title', title);
  if (o && o.next) { const b = button(top, 'rv-nav', null, o.next, 'chevron-right'); b.setAttribute('aria-label', 'Next'); }
  if (o && o.reset) button(bar, 'rv-chip', o.resetLabel || 'Back to today', o.reset);
  return bar;
}

function groupHeader(page, text, aside) {
  const h = el(page, 'div', 'rv-group-header');
  el(h, 'h2', 'rv-h2', text);
  if (aside) el(h, 'span', 'rv-group-aside', aside);
  return h;
}

function emptyLine(page, text) { return el(page, 'p', 'rv-empty', text); }

function group(page, cls) { return el(page, 'section', 'rv-list' + (cls ? ' ' + cls : '')); }

function horizonLabel(h) {
  if (!h) return '';
  const s = String(h);
  if (D.isISO(s)) return `by ${D.fmtDay(s)} ${s.slice(0, 4)}`;
  if (/^\d{4}-\d{2}$/.test(s)) return `by ${D.fmtMonth(`${s}-01`)}`;
  return `by ${s}`;
}

/* "Another day": the next seven, named the way a person would say them.
   Picking one writes a plan for that day, which quietly takes the practice
   off today — see model.planDay. */
function dayMenu(ev, anchor, ctx, name, from, after) {
  const menu = new Menu();
  for (let i = 1; i <= 7; i++) {
    const d = D.addDays(from, i);
    const label = `${D.relative(d, from)} · ${D.fmtShort(d)}`;
    menu.addItem(m => m.setTitle(label).setIcon('calendar').onClick(() => {
      if (after) after(d); else ctx.movePlan(name, null, d);
    }));
  }
  if (ev && ev.clientX !== undefined && menu.showAtMouseEvent) menu.showAtMouseEvent(ev);
  else if (menu.showAtPosition && anchor) { const b = anchor.getBoundingClientRect(); menu.showAtPosition({ x: b.left, y: b.bottom }); }
}

/* The row menu (…): not today, later, another day, edit, open note. */
function rowMenu(ev, ctx, r, date) {
  const menu = new Menu();
  const { p, pr } = r;
  if (!pr.doneToday) {
    menu.addItem(i => i.setTitle(pr.skippedToday ? 'Put it back' : 'Not today').setIcon(pr.skippedToday ? 'rotate-ccw' : 'x')
      .onClick(() => ctx.skip(p.name, date, !pr.skippedToday)));
    if (!pr.skippedToday) {
      menu.addItem(i => i.setTitle(pr.snoozed ? 'Bring it forward' : 'Later today').setIcon('clock')
        .onClick(() => ctx.snooze(p.name, date, !pr.snoozed)));
      menu.addItem(i => i.setTitle('Another day').setIcon('calendar')
        .onClick(() => window.setTimeout(() => dayMenu(null, ev && ev.target, ctx, p.name, date), 0)));
    }
  }
  menu.addItem(i => i.setTitle('Edit').setIcon('pencil').onClick(() => ctx.edit('practice', p)));
  menu.addItem(i => i.setTitle('Set aside').setIcon('archive').onClick(() => ctx.setAside(p, true)));
  menu.addItem(i => i.setTitle('Open note').setIcon('external-link').onClick(() => ctx.openNote(p.path)));
  if (menu.showAtMouseEvent && ev && ev.clientX !== undefined) menu.showAtMouseEvent(ev);
  else if (menu.showAtPosition && ev && ev.target) { const b = ev.target.getBoundingClientRect(); menu.showAtPosition({ x: b.left, y: b.bottom }); }
}

/* A practice row: tick · name + meta · (…) */
function practiceRow(list, ctx, r, date, opts) {
  const { p, pr } = r;
  const quiet = opts && opts.quiet;
  const row = el(list, 'div', 'rv-row rv-row-practice' + (pr.doneToday ? ' is-done' : '') + (pr.skippedToday ? ' is-skipped' : '') + (quiet ? ' is-quiet' : ''));
  const tick = button(row, 'rv-tick', null, () => ctx.toggle(p.name, date, !pr.doneToday), pr.doneToday ? 'check' : null);
  tick.setAttribute('aria-label', pr.doneToday ? `Untick ${p.name}` : `Tick ${p.name}`);
  tick.setAttribute('aria-pressed', pr.doneToday ? 'true' : 'false');
  const body = el(row, 'div', 'rv-row-body');
  body.addEventListener('click', () => ctx.toggle(p.name, date, !pr.doneToday));
  el(body, 'div', 'rv-row-name', p.name);
  const bits = [];
  if (p.area) bits.push(p.area);
  if (p.time) bits.push(p.time);
  if (p.minutes) bits.push(`${p.minutes} min`);
  if (opts && opts.reason !== false && r.reason && r.reason !== 'Every day' && r.reason !== 'Done') bits.push(r.reason);
  else if (pr.per === 'week') bits.push(`${pr.done} of ${pr.target} this week`);
  else if (pr.per === 'month') bits.push(`${pr.done} of ${pr.target} this month`);
  if (bits.length) el(body, 'div', 'rv-row-meta', bits.join(' · '));
  const more = button(row, 'rv-row-more', null, e => rowMenu(e, ctx, r, date), 'ellipsis');
  more.setAttribute('aria-label', `More for ${p.name}`);
  return row;
}

/* An event row: leading glyph · name + meta · trailing day/time. */
function eventRow(list, ctx, e, from, o) {
  const row = el(list, 'div', 'rv-row rv-row-event' + (e.date < D.todayISO() ? ' is-past' : ''));
  icon(row, e.calendar ? 'calendar' : 'calendar-days', 'rv-lead-glyph');
  const body = el(row, 'div', 'rv-row-body');
  el(body, 'div', 'rv-row-name', e.name);
  const meta = [e.area, e.note].filter(Boolean).join(' · ');
  if (meta) el(body, 'div', 'rv-row-meta', meta);
  const trail = el(row, 'div', 'rv-row-trail');
  const stack = el(trail, 'div', 'rv-stack');
  el(stack, 'span', 'rv-stack-day', o && o.absolute ? D.fmtShort(e.date) : D.relative(e.date, from));
  if (e.time) el(stack, 'span', 'rv-stack-time', e.time);
  if (e.path) {
    const more = button(row, 'rv-row-more', null, ev => {
      const menu = new Menu();
      menu.addItem(i => i.setTitle('Edit').setIcon('pencil').onClick(() => ctx.edit('event', e)));
      menu.addItem(i => i.setTitle('Open note').setIcon('external-link').onClick(() => ctx.openNote(e.path)));
      if (menu.showAtMouseEvent && ev && ev.clientX !== undefined) menu.showAtMouseEvent(ev);
      else if (menu.showAtPosition && ev && ev.target) { const b = ev.target.getBoundingClientRect(); menu.showAtPosition({ x: b.left, y: b.bottom }); }
    }, 'ellipsis');
    more.setAttribute('aria-label', `More for ${e.name}`);
  }
  return row;
}

/* Thin progress bar. */
function bar(parent, done, target) {
  const b = el(parent, 'div', 'rv-bar');
  const fill = el(b, 'div', 'rv-bar-fill');
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  fill.style.width = pct + '%';
  if (target > 0 && done >= target) b.classList.add('is-full');
  return b;
}

module.exports = { titleBar, groupHeader, emptyLine, group, horizonLabel, practiceRow, eventRow, rowMenu, dayMenu, bar, icon, M };
