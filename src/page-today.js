'use strict';
/* Today — the page that keeps the list short. */

const { el, button, icon } = require('./dom');
const D = require('./dates');
const M = require('./model');
const { promptFor } = require('./prompts');
const { renderDeck } = require('./deck');
const { titleBar, groupHeader, group, practiceRow, eventRow, horizonLabel } = require('./widgets');

function renderToday(page, ctx) {
  const { state, settings } = ctx;
  const date = state.date;
  const today = D.todayISO();
  const plan = M.planDay(state.data, date, { focusCount: settings.focusCount, weekStart: settings.weekStart });
  const diff = D.diffDays(today, date);
  const title = diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : diff === 1 ? 'Tomorrow' : D.DAY_NAMES[D.weekday(date)];

  titleBar(page, D.fmtLong(date), title, {
    prev: () => ctx.setDate(D.addDays(date, -1)),
    next: () => ctx.setDate(D.addDays(date, 1)),
    reset: date === today ? null : () => ctx.setDate(today),
  });

  /* Hero: number beside one calm sentence. */
  const hero = el(page, 'div', 'rv-hero');
  const dueCount = plan.focus.length + plan.later.length;
  const n = el(hero, 'div', 'rv-hero-num');
  const copy = el(hero, 'div', 'rv-hero-copy');
  const line = el(copy, 'p', 'rv-hero-line');
  if (!state.data.practices.length) {
    n.textContent = '—';
    line.textContent = 'No practices yet.';
    el(copy, 'p', 'rv-hero-rest', 'Add one with the plus button, or write a note in the Practices folder.');
  } else if (dueCount === 0) {
    n.textContent = plan.done.length ? String(plan.done.length) : '·';
    line.textContent = plan.done.length ? (plan.done.length === 1 ? 'thing done.' : 'things done.') : 'Nothing is due.';
    el(copy, 'p', 'rv-hero-rest', plan.done.length ? 'Nothing more is asked of today.' : 'Rest is allowed.');
  } else {
    n.textContent = String(plan.focus.length);
    line.textContent = plan.focus.length === 1 ? 'thing for today.' : 'things for today.';
    el(copy, 'p', 'rv-hero-rest', plan.later.length ? `${plan.later.length} more when there's space.` : (plan.done.length ? `${plan.done.length} already done.` : 'That is the whole list.'));
  }
  const streak = M.streakLabel(state.data, date, { streakMode: settings.streakMode, weekStart: settings.weekStart });
  if (streak) { const pill = el(copy, 'span', 'rv-pill'); icon(pill, 'flame'); el(pill, 'span', null, streak); }

  /* Stillness line when the list is clear. */
  if (dueCount === 0 && state.data.practices.length && settings.showPrompt !== false) {
    const pr = promptFor(date);
    const card = el(page, 'section', 'rv-still');
    el(card, 'p', 'rv-still-text', pr.text);
    if (pr.ref) el(card, 'p', 'rv-still-ref', pr.ref);
  }

  /* List or deck. The deck exists for the days when the list is long
     enough to be a wall; the toggle only appears once it would help. */
  const outstanding = plan.focus.length + plan.later.length;
  const deckMode = settings.todayView === 'deck';
  if (outstanding > 1) {
    const seg = el(page, 'div', 'rv-viewseg');
    const mk = (id, label, ico) => {
      const b = button(seg, 'rv-viewseg-btn' + (deckMode === (id === 'deck') ? ' is-active' : ''), label, () => ctx.setTodayView(id), ico);
      b.setAttribute('aria-pressed', deckMode === (id === 'deck') ? 'true' : 'false');
    };
    mk('list', 'List', 'list');
    mk('deck', 'One at a time', 'layers');
  }

  if (deckMode && outstanding) {
    renderDeck(page, ctx, plan, date);
    const events = M.upcoming(ctx.events, date, 7);
    if (events.length) {
      groupHeader(page, 'Coming up');
      const list = group(page);
      for (const e of events) eventRow(list, ctx, e, date);
    }
    const foot = el(page, 'div', 'rv-foot');
    button(foot, 'rv-link', 'Write in this day\'s note', () => ctx.writeNote(date), 'pencil');
    return;
  }

  /* Focus, grouped by time of day when that helps. */
  if (plan.focus.length) {
    const groups = M.groupByWhen(plan.focus);
    if (groups.length === 1) {
      groupHeader(page, diff === 0 ? 'Today' : title);
      const list = group(page);
      for (const r of plan.focus) practiceRow(list, ctx, r, date);
    } else {
      for (const g of groups) {
        groupHeader(page, g.label);
        const list = group(page);
        for (const r of g.rows) practiceRow(list, ctx, r, date);
      }
    }
  }

  /* When there's space: a disclosure row, then the quiet list. */
  if (plan.later.length) {
    const wrap = el(page, 'section', 'rv-list rv-later');
    const head = button(wrap, 'rv-row rv-row-disclosure', null, () => ctx.toggleLater());
    head.setAttribute('aria-expanded', state.showLater ? 'true' : 'false');
    const body = el(head, 'div', 'rv-row-body');
    el(body, 'div', 'rv-row-name', 'When there\'s space');
    const trail = el(head, 'div', 'rv-row-trail');
    el(trail, 'span', 'rv-count-badge', String(plan.later.length));
    icon(trail, state.showLater ? 'chevron-down' : 'chevron-right', 'rv-chevron');
    if (state.showLater) {
      for (const r of plan.later) practiceRow(wrap, ctx, r, date, { quiet: true });
    }
  }

  /* Handed to another day: not today's business, but it should not vanish
     without a trace either. */
  if (plan.deferred.length) {
    const wrap = el(page, 'section', 'rv-list rv-later');
    const head = button(wrap, 'rv-row rv-row-disclosure', null, () => ctx.toggleDeferred());
    head.setAttribute('aria-expanded', state.showDeferred ? 'true' : 'false');
    const body = el(head, 'div', 'rv-row-body');
    el(body, 'div', 'rv-row-name', 'Planned for another day');
    const trail = el(head, 'div', 'rv-row-trail');
    el(trail, 'span', 'rv-count-badge', String(plan.deferred.length));
    icon(trail, state.showDeferred ? 'chevron-down' : 'chevron-right', 'rv-chevron');
    if (state.showDeferred) for (const r of plan.deferred) practiceRow(wrap, ctx, r, date, { quiet: true });
  }

  /* Done and not-today. */
  if (plan.done.length) {
    groupHeader(page, 'Done');
    const list = group(page, 'rv-list-done');
    for (const r of plan.done) practiceRow(list, ctx, r, date, { reason: false });
  }
  if (plan.skipped.length) {
    groupHeader(page, 'Not today');
    const list = group(page, 'rv-list-skipped');
    for (const r of plan.skipped) practiceRow(list, ctx, r, date, { reason: false, quiet: true });
  }

  /* Coming up: your events plus subscribed calendars. */
  const events = M.upcoming(ctx.events, date, 7);
  if (events.length) {
    groupHeader(page, 'Coming up');
    const list = group(page);
    for (const e of events) eventRow(list, ctx, e, date);
  }

  /* Next step: the soonest goal with a step; or a goal that needs one. */
  const g = M.nextGoal(state.data.goals);
  const needs = M.goalsWithoutStep(state.data.goals);
  if (g || needs.length) {
    groupHeader(page, 'Next step');
    const list = group(page);
    if (g) {
      const row = el(list, 'div', 'rv-row rv-row-goal');
      const tick = button(row, 'rv-tick', null, () => ctx.stepDone(g), null);
      tick.setAttribute('aria-label', `Done: ${g.next}`);
      const body = el(row, 'div', 'rv-row-body');
      body.addEventListener('click', () => ctx.stepDone(g));
      el(body, 'div', 'rv-row-name', g.next);
      el(body, 'div', 'rv-row-meta', [g.name, horizonLabel(g.horizon)].filter(Boolean).join(' · '));
      const open = button(row, 'rv-row-more', null, () => ctx.edit('goal', g), 'ellipsis');
      open.setAttribute('aria-label', `More for ${g.name}`);
    }
    for (const ng of needs.slice(0, 2)) {
      const row = button(list, 'rv-row rv-row-goal is-needs', null, () => ctx.edit('goal', ng));
      icon(row, 'flag', 'rv-lead-glyph');
      const body = el(row, 'div', 'rv-row-body');
      el(body, 'div', 'rv-row-name', `Give "${ng.name}" a next step`);
      el(body, 'div', 'rv-row-meta', horizonLabel(ng.horizon) || 'No horizon yet');
      icon(row, 'chevron-right', 'rv-chevron');
    }
  }

  /* Today's note, if it has words in it. */
  const entry = M.entry(state.data.log, date);
  if (entry.note) {
    groupHeader(page, 'Today\'s note');
    const list = group(page);
    const row = button(list, 'rv-row rv-row-note', null, () => ctx.writeNote(date));
    icon(row, 'pencil', 'rv-lead-glyph');
    const body = el(row, 'div', 'rv-row-body');
    el(body, 'div', 'rv-row-name rv-row-name-quiet', entry.note);
    icon(row, 'chevron-right', 'rv-chevron');
  }

  /* Week in review on the last day of the week. */
  const lastDay = D.addDays(D.weekStart(date, settings.weekStart), 6);
  if (date === lastDay) {
    const list = group(page, 'rv-list-review');
    const row = button(list, 'rv-row', null, () => ctx.setTab('week'));
    icon(row, 'sparkles', 'rv-lead-glyph');
    const body = el(row, 'div', 'rv-row-body');
    el(body, 'div', 'rv-row-name', 'Review the week');
    el(body, 'div', 'rv-row-meta', 'What got done, what slipped, one question.');
    icon(row, 'chevron-right', 'rv-chevron');
  }

  const foot = el(page, 'div', 'rv-foot');
  button(foot, 'rv-link', entry.note ? 'Add to this day\'s note' : 'Write in this day\'s note', () => ctx.writeNote(date), 'pencil');
}

module.exports = { renderToday };
