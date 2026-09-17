'use strict';
/* Month — practices against their monthly targets, goals, and events. */

const { el, button, icon } = require('./dom');
const D = require('./dates');
const M = require('./model');
const { titleBar, groupHeader, group, emptyLine, bar, horizonLabel, eventRow } = require('./widgets');

function renderMonth(page, ctx) {
  const { state, settings } = ctx;
  const date = state.date;
  const today = D.todayISO();
  const thisMonth = D.monthKey(date) === D.monthKey(today);

  titleBar(page, String(D.fromISO(date).getFullYear()), D.MONTHS[D.fromISO(date).getMonth()], {
    prev: () => ctx.setDate(D.addMonths(date, -1)),
    next: () => ctx.setDate(D.addMonths(date, 1)),
    reset: thisMonth ? null : () => ctx.setDate(today),
    resetLabel: 'Back to this month',
  });

  const rows = M.monthSummary(state.data, date, settings.weekStart);
  if (!rows.length) { groupHeader(page, 'Practices'); emptyLine(page, 'No practices yet.'); }
  else {
    let lastArea = null, list = null;
    for (const r of rows) {
      if (r.p.area !== lastArea) { lastArea = r.p.area; groupHeader(page, r.p.area || 'Other'); list = group(page); }
      const row = el(list, 'div', 'rv-row rv-row-bar');
      const body = el(row, 'div', 'rv-row-body');
      const top = el(body, 'div', 'rv-row-top');
      el(top, 'span', 'rv-row-name', r.p.name);
      el(top, 'span', 'rv-row-count', `${r.done} of ${r.target}`);
      bar(body, r.done, r.target);
    }
  }

  const due = M.goalsForMonth(state.data.goals, date);
  const all = M.sortGoals(state.data.goals);
  groupHeader(page, 'Goals', due.length ? `${due.length} due` : '');
  if (!all.length) emptyLine(page, 'No goals yet. A goal is an outcome with a horizon and a next step.');
  else {
    const list = group(page);
    for (const g of all) {
      const overdue = D.horizonEnd(g.horizon) && D.horizonEnd(g.horizon) < today;
      const needs = !(g.next && String(g.next).trim());
      const row = el(list, 'div', 'rv-row rv-row-goal' + (due.includes(g) ? ' is-due' : '') + (overdue ? ' is-overdue' : '') + (needs ? ' is-needs' : ''));
      if (needs) {
        icon(row, 'flag', 'rv-lead-glyph');
      } else {
        const tick = button(row, 'rv-tick', null, () => ctx.stepDone(g));
        tick.setAttribute('aria-label', `Done: ${g.next}`);
      }
      const body = el(row, 'div', 'rv-row-body');
      body.addEventListener('click', () => (needs ? ctx.edit('goal', g) : ctx.stepDone(g)));
      el(body, 'div', 'rv-row-name', g.name);
      const bits = [];
      bits.push(needs ? 'Needs a next step' : `Next: ${g.next}`);
      if (g.horizon) bits.push(horizonLabel(g.horizon));
      if (g.area) bits.push(g.area);
      el(body, 'div', 'rv-row-meta', bits.join(' · '));
      const more = button(row, 'rv-row-more', null, () => ctx.edit('goal', g), 'ellipsis');
      more.setAttribute('aria-label', `More for ${g.name}`);
    }
  }

  const events = M.eventsInMonth(ctx.events, date);
  groupHeader(page, 'Events');
  if (!events.length) emptyLine(page, 'Nothing on the calendar this month.');
  else {
    const list = group(page);
    for (const e of events) eventRow(list, ctx, e, today, { absolute: true });
  }
  if (!ctx.settings.calendarUrls) {
    const foot = el(page, 'div', 'rv-foot');
    const b = button(foot, 'rv-link', 'Add a calendar in settings', () => ctx.openSettings());
    icon(b, 'chevron-right', 'rv-inline-glyph');
  }
}

module.exports = { renderMonth };
