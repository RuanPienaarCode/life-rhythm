'use strict';
/* Week — two-line rows (name and count; cadence and seven dots) under a
   shared column header, and the week in review. */

const { el, button, icon } = require('./dom');
const D = require('./dates');
const M = require('./model');
const { titleBar, groupHeader, group, emptyLine, bar } = require('./widgets');

function renderWeek(page, ctx) {
  const { state, settings } = ctx;
  const date = state.date;
  const today = D.todayISO();
  const days = D.weekDays(date, settings.weekStart);
  const first = days[0], last = days[6];
  const thisWeek = days.includes(today);
  const range = D.monthKey(first) === D.monthKey(last)
    ? `${D.fromISO(first).getDate()} – ${D.fmtDay(last)}`
    : `${D.fmtDay(first)} – ${D.fmtDay(last)}`;

  titleBar(page, range, thisWeek ? 'This week' : (last < today ? 'A past week' : 'A week ahead'), {
    prev: () => ctx.setDate(D.addDays(first, -7)),
    next: () => ctx.setDate(D.addDays(first, 7)),
    reset: thisWeek ? null : () => ctx.setDate(today),
    resetLabel: 'Back to this week',
  });

  const rows = M.weekSummary(state.data, date, settings.weekStart);
  if (!rows.length) { emptyLine(page, 'No practices yet.'); return; }
  const weekly = rows.filter(r => r.target !== null);
  const monthly = rows.filter(r => r.target === null);

  /* Review card: current week from its last day, or any past week. */
  const rev = M.weekReview(state.data, date, settings.weekStart);
  const showReview = last <= today || (thisWeek && date === last);
  if (showReview && rev.asked) {
    groupHeader(page, 'Week in review', `${Math.round(rev.ratio * 100)}%`);
    const card = group(page, 'rv-review');
    const top = el(card, 'div', 'rv-review-top');
    const big = el(top, 'div', 'rv-review-num', String(rev.done));
    big.setAttribute('aria-label', `${rev.done} of ${rev.asked}`);
    const copy = el(top, 'div', 'rv-review-copy');
    el(copy, 'p', 'rv-review-line', `of ${rev.asked} asked.`);
    el(copy, 'p', 'rv-review-rest', rev.met.length ? `Kept: ${rev.met.map(r => r.p.name).join(', ')}.` : 'Nothing fully kept this week, and that is information, not a verdict.');
    bar(copy, rev.done, rev.asked);
    if (rev.slipped.length) {
      const sl = el(card, 'div', 'rv-review-slipped');
      el(sl, 'div', 'rv-review-label', 'Slipped');
      for (const r of rev.slipped.slice(0, 4)) el(sl, 'div', 'rv-review-item', `${r.p.name} · ${r.done} of ${r.target}`);
    }
    const q = el(card, 'div', 'rv-review-q');
    el(q, 'label', 'rv-review-label', 'What would make next week lighter?');
    const ta = el(q, 'textarea', 'rv-input rv-textarea');
    ta.rows = 3;
    ta.placeholder = 'One honest line is enough.';
    const actions = el(q, 'div', 'rv-review-actions');
    const save = button(actions, 'rv-btn rv-btn-primary', 'Save to the day\'s note', async () => {
      const text = ta.value.trim();
      if (!text) return;
      save.disabled = true;
      try { await ctx.reviewWeek(last <= today ? last : today, text); }
      finally { save.disabled = false; }
    });
  }

  /* Column header shared by every row. */
  const head = el(page, 'div', 'rv-wk-head');
  el(head, 'div', 'rv-wk-head-label', 'Practices');
  const cols = el(head, 'div', 'rv-wk-cols');
  for (const d of days) {
    const c = el(cols, 'div', 'rv-wk-col' + (d === today ? ' is-today' : ''));
    el(c, 'span', 'rv-wk-dow', D.DAY_NAMES[D.weekday(d)].slice(0, 1));
    el(c, 'span', 'rv-wk-date', String(D.fromISO(d).getDate()));
  }

  let lastArea = null, list = null;
  for (const r of weekly) {
    if (r.p.area !== lastArea) {
      lastArea = r.p.area;
      groupHeader(page, r.p.area || 'Other');
      list = group(page, 'rv-wk-list');
    }
    const row = el(list, 'div', 'rv-wk-row' + (r.done >= r.target ? ' is-met' : ''));
    const top = el(row, 'div', 'rv-wk-row-top');
    el(top, 'span', 'rv-wk-name', r.p.name);
    el(top, 'span', 'rv-wk-count', `${r.done}/${r.target}`);
    const bottom = el(row, 'div', 'rv-wk-row-bottom');
    el(bottom, 'span', 'rv-wk-cadence', M.cadenceLabel(r.cadence));
    const dots = el(bottom, 'div', 'rv-wk-cols');
    r.ticks.forEach((on, i) => {
      const d = days[i];
      const future = d > today;
      const cell = button(dots, 'rv-wk-col rv-cell' + (on ? ' is-on' : '') + (future ? ' is-future' : '') + (d === today ? ' is-today' : ''), null,
        future ? null : () => ctx.toggle(r.p.name, d, !on));
      cell.setAttribute('aria-label', `${r.p.name} ${D.fmtShort(d)}${on ? ' done' : ''}`);
      if (future) cell.disabled = true;
      el(cell, 'span', 'rv-dot' + (on ? ' is-done' : future ? ' is-future' : ' is-open'));
    });
  }

  if (monthly.length) {
    groupHeader(page, 'This month', D.fmtMonth(date));
    const ml = group(page);
    for (const r of monthly) {
      const row = el(ml, 'div', 'rv-row rv-row-bar');
      const body = el(row, 'div', 'rv-row-body');
      const top = el(body, 'div', 'rv-row-top');
      el(top, 'span', 'rv-row-name', r.p.name);
      el(top, 'span', 'rv-row-count', `${r.month.done} of ${r.month.target}`);
      bar(body, r.month.done, r.month.target);
    }
  }

  const legend = el(page, 'div', 'rv-wk-legend');
  const key = (cls, text) => { const k = el(legend, 'span', 'rv-wk-key'); el(k, 'span', 'rv-dot ' + cls); el(k, 'span', null, text); };
  key('is-done', 'done'); key('is-open', 'open'); key('is-future', 'ahead');
  el(legend, 'span', null, 'Tap a dot to change it.');
  const foot = el(page, 'div', 'rv-foot');
  const b = button(foot, 'rv-link', 'Open this week\'s notes', () => ctx.openLog(thisWeek ? today : last));
  icon(b, 'chevron-right', 'rv-inline-glyph');
}

module.exports = { renderWeek };
