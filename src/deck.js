'use strict';
/* The deck — everything outstanding today as one stack of cards, the top
   one live and the rest peeking out behind it.

   The point is arithmetic, not decoration: a list of fourteen things asks
   you to weigh fourteen things at once, a deck asks you one question at a
   time. Nothing here writes anything the list view cannot also write, so
   the two are interchangeable and the setting is a preference, not a mode
   you can get stuck in. */

const { el, button, icon } = require('./dom');
const { dayMenu } = require('./widgets');
const M = require('./model');

const VISIBLE = 4;      // cards drawn; deeper ones would not be seen
const STEP = 13;        // px each card sits below the one in front
const SHRINK = 0.035;   // scale lost per card back
const EXIT_MS = 330;    // must match the CSS transition on .rv-deck-card

/* Rotate so `offset` decides which outstanding card is in front. */
function order(rows, offset) {
  if (!rows.length) return rows;
  const i = ((offset % rows.length) + rows.length) % rows.length;
  return rows.slice(i).concat(rows.slice(0, i));
}

function renderDeck(page, ctx, plan, date) {
  const { state } = ctx;
  const rows = order([...plan.focus, ...plan.later], state.deckOffset || 0);

  if (!rows.length) return false;

  const wrap = el(page, 'section', 'rv-deck-wrap');
  const deck = el(wrap, 'div', 'rv-deck');
  const drawn = rows.slice(0, VISIBLE);
  const cards = [];

  drawn.forEach((r, i) => {
    const card = el(deck, 'article', 'rv-deck-card' + (i === 0 ? ' is-top' : ''));
    cards.push(card);
    card.style.zIndex = String(VISIBLE - i);
    card.style.transform = `translateY(${i * STEP}px) scale(${1 - i * SHRINK})`;
    card.style.opacity = i >= VISIBLE - 1 ? '0.45' : '1';
    if (i > 0) card.setAttribute('aria-hidden', 'true');

    const head = el(card, 'div', 'rv-deck-head');
    el(head, 'span', 'rv-deck-area', r.p.area || '');
    el(head, 'span', 'rv-deck-count', `${(((state.deckOffset || 0) % rows.length) + rows.length) % rows.length + 1} of ${rows.length}`);
    el(card, 'h2', 'rv-deck-name', r.p.name);
    const meta = [r.p.minutes ? `${r.p.minutes} min` : '', r.reason].filter(Boolean).join(' · ');
    if (meta) el(card, 'p', 'rv-deck-meta', meta);
    if (r.p.note) el(card, 'p', 'rv-deck-note', r.p.note);

    if (i !== 0) return;

    /* Only the front card is interactive — the rest are scenery. */
    const exit = (cls, run) => {
      card.classList.add(cls);
      window.setTimeout(run, EXIT_MS);
    };
    const actions = el(card, 'div', 'rv-deck-actions');
    const no = button(actions, 'rv-deck-btn', 'Not today', () => exit('is-gone-left', () => ctx.skip(r.p.name, date, true)), 'x');
    no.setAttribute('aria-label', `Not today: ${r.p.name}`);
    const yes = button(actions, 'rv-deck-btn rv-deck-btn-primary', 'Done', () => exit('is-gone-up', () => ctx.toggle(r.p.name, date, true)), 'check');
    yes.setAttribute('aria-label', `Done: ${r.p.name}`);
    const later = button(actions, 'rv-deck-btn', 'Later today', () => exit('is-gone-right', () => ctx.snooze(r.p.name, date, true)), 'clock');
    later.setAttribute('aria-label', `Later today: ${r.p.name}`);

    /* The fourth answer, on its own line because it is the one that asks a
       follow-up question rather than settling the card outright. */
    const another = button(card, 'rv-deck-btn rv-deck-another', 'Another day', ev => {
      dayMenu(ev, another, ctx, r.p.name, date, d => exit('is-gone-right', () => ctx.movePlan(r.p.name, null, d)));
    }, 'calendar');
    another.setAttribute('aria-label', `Another day for ${r.p.name}`);

    swipe(card, {
      left: () => exit('is-gone-left', () => ctx.skip(r.p.name, date, true)),
      right: () => exit('is-gone-right', () => ctx.snooze(r.p.name, date, true)),
      up: () => exit('is-gone-up', () => ctx.toggle(r.p.name, date, true)),
    });
  });

  /* Only the front card carries the action row, so the cards behind are
     shorter and would hide entirely under it. Measure the front card once
     (the tree is live, so this reads real layout) and give the stack that
     height, so each card behind peeks by exactly its offset. */
  const front = cards[0];
  if (front) {
    const h = front.offsetHeight;
    if (h) {
      for (let i = 1; i < cards.length; i++) cards[i].style.minHeight = `${h}px`;
      deck.style.height = `${h + (cards.length - 1) * STEP + 4}px`;
    }
  }

  /* Flipping through without deciding: purely visual, writes nothing. */
  const foot = el(wrap, 'div', 'rv-deck-foot');
  const next = button(foot, 'rv-link rv-deck-next', rows.length > 1 ? 'Show me another' : 'Open the note',
    rows.length > 1
      ? () => { state.deckOffset = (state.deckOffset || 0) + 1; ctx.rerender(); }
      : () => ctx.openNote(rows[0].p.path));
  if (rows.length > 1) icon(next, 'layers', 'rv-inline-glyph');
  return true;
}

/* Drag the front card to decide: left is not today, right is later, up is
   done. Falls back to the buttons on any device without pointer events. */
function swipe(card, on) {
  let x0 = 0, y0 = 0, moving = false, pid = null;
  const TAKE = 12, DECIDE = 70;

  const move = e => {
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (!moving) {
      if (Math.abs(dx) + Math.abs(dy) < TAKE) return;
      moving = true;
      card.classList.add('is-held');
    }
    if (e.cancelable) e.preventDefault();
    card.style.transform = `translate(${dx}px, ${Math.min(dy, 40)}px) rotate(${Math.max(-8, Math.min(8, dx / 14))}deg)`;
    card.classList.toggle('will-skip', dx < -DECIDE);
    card.classList.toggle('will-later', dx > DECIDE);
    card.classList.toggle('will-done', dy < -DECIDE && Math.abs(dx) < DECIDE);
  };

  const up = e => {
    card.removeEventListener('pointermove', move);
    card.removeEventListener('pointerup', up);
    card.removeEventListener('pointercancel', up);
    card.classList.remove('is-held', 'will-skip', 'will-later', 'will-done');
    if (!moving) return;
    moving = false;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    card.style.transform = 'translateY(0) scale(1)';
    if (dy < -DECIDE && Math.abs(dx) < DECIDE) on.up();
    else if (dx < -DECIDE) on.left();
    else if (dx > DECIDE) on.right();
  };

  card.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('button')) return;
    x0 = e.clientX; y0 = e.clientY; pid = e.pointerId;
    if (card.setPointerCapture) { try { card.setPointerCapture(pid); } catch (err) { /* fine */ } }
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', up);
    card.addEventListener('pointercancel', up);
  });
}

module.exports = { renderDeck, order };
