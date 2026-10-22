'use strict';
/* Areas — the page where you shape the list rather than work it.

   Today answers "what now". This answers "what should be asked of me at
   all", which is the question behind a list that has grown too long. So
   every practice is reachable here, each showing when it was last actually
   done, and setting one aside is one tap from that fact. */

const { Menu } = require('obsidian');
const { el, button, icon } = require('./dom');
const D = require('./dates');
const M = require('./model');
const { titleBar, groupHeader, group, emptyLine } = require('./widgets');

function renderAreas(page, ctx) {
  const { state } = ctx;
  const today = D.todayISO();
  const areas = [...state.data.areas].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  const aside = state.data.aside || [];
  const active = state.data.practices || [];

  titleBar(page, 'In order of priority', 'Areas');
  el(page, 'p', 'rv-lead', `${active.length} practices are being asked of you. Tap an area to see its own, and set aside anything that is not this season.`);

  if (!areas.length) { emptyLine(page, 'No areas yet. An area is a part of life you want to keep a rhythm in.'); return; }

  groupHeader(page, 'Areas');
  const list = group(page, 'rv-areas');
  areas.forEach((a, i) => {
    const open = state.openArea === a.name;
    const mine = active.filter(p => p.area === a.name);
    const row = el(list, 'div', 'rv-row rv-row-area' + (open ? ' is-open' : ''));
    el(row, 'div', 'rv-area-rank', String(i + 1));
    const body = el(row, 'div', 'rv-row-body');
    body.addEventListener('click', () => ctx.toggleArea(a.name));
    el(body, 'div', 'rv-row-name', a.name);
    const ng = M.sortGoals(state.data.goals).filter(g => g.area === a.name).length;
    const bits = [];
    bits.push(mine.length ? `${mine.length} practice${mine.length === 1 ? '' : 's'}` : 'no practices');
    if (ng) bits.push(`${ng} goal${ng === 1 ? '' : 's'}`);
    if (a.note) bits.push(a.note);
    el(body, 'div', 'rv-row-meta', bits.join(' · '));

    /* The arrows are a convenience at a comfortable width; the menu
       carries the same two moves at every width, so a phone is never less
       able to reorder than a desktop. */
    const ctl = el(row, 'div', 'rv-area-ctl');
    const up = button(ctl, 'rv-row-more rv-wide-only', null, () => move(i, -1), 'arrow-up');
    up.setAttribute('aria-label', `Move ${a.name} up`);
    if (i === 0) up.disabled = true;
    const down = button(ctl, 'rv-row-more rv-wide-only', null, () => move(i, 1), 'arrow-down');
    down.setAttribute('aria-label', `Move ${a.name} down`);
    if (i === areas.length - 1) down.disabled = true;
    const more = button(ctl, 'rv-row-more', null, ev => {
      const menu = new Menu();
      if (i > 0) menu.addItem(m => m.setTitle('Move up').setIcon('arrow-up').onClick(() => move(i, -1)));
      if (i < areas.length - 1) menu.addItem(m => m.setTitle('Move down').setIcon('arrow-down').onClick(() => move(i, 1)));
      menu.addItem(m => m.setTitle('Rename').setIcon('pencil').onClick(() => ctx.edit('area', a)));
      menu.addItem(m => m.setTitle('Add a practice here').setIcon('plus').onClick(() => ctx.add('practice')));
      menu.addItem(m => m.setTitle('Open note').setIcon('external-link').onClick(() => ctx.openNote(a.path)));
      if (ev && ev.clientX !== undefined && menu.showAtMouseEvent) menu.showAtMouseEvent(ev);
    }, 'ellipsis');
    more.setAttribute('aria-label', `More for ${a.name}`);
    icon(row, open ? 'chevron-down' : 'chevron-right', 'rv-chevron');

    if (!open) return;
    if (!mine.length) el(list, 'div', 'rv-sub-empty', 'Nothing is asked of you here.');
    for (const p of mine) list.appendChild(practiceLine(ctx, p, today));
  });

  /* What is not being asked of you, and the way back. */
  if (aside.length) {
    groupHeader(page, 'Set aside', String(aside.length));
    const sl = group(page);
    for (const p of aside) {
      const row = el(sl, 'div', 'rv-row rv-row-aside');
      icon(row, 'archive', 'rv-lead-glyph');
      const body = el(row, 'div', 'rv-row-body');
      el(body, 'div', 'rv-row-name rv-row-name-quiet', p.name);
      el(body, 'div', 'rv-row-meta', [p.area, M.cadenceLabel(M.parseCadence(p.cadence))].filter(Boolean).join(' · '));
      button(row, 'rv-chip', 'Bring back', () => ctx.setAside(p, false));
    }
    el(page, 'p', 'rv-lead', 'These keep their notes and their whole history. They are simply not asked of you.');
  }

  const foot = el(page, 'div', 'rv-foot');
  const b = button(foot, 'rv-link', 'Add an area', () => ctx.add('area'), 'plus');

  /* Swap with a neighbour, then renumber 1..n so hand-edited or missing
     orders settle into a clean sequence. */
  async function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= areas.length) return;
    const next = [...areas];
    [next[i], next[j]] = [next[j], next[i]];
    for (let k = 0; k < next.length; k++) {
      if (next[k].order !== k + 1) await ctx.store.patch(next[k].path, { order: k + 1 });
    }
    await ctx.reload();
  }
}

/* One practice inside an open area: what it asks, and when it last
   happened — the two facts that decide whether it stays. */
function practiceLine(ctx, p, today) {
  const row = el(null, 'div', 'rv-row rv-row-sub');
  const body = el(row, 'div', 'rv-row-body');
  body.addEventListener('click', () => ctx.edit('practice', p));
  el(body, 'div', 'rv-row-name rv-row-name-sub', p.name);
  const info = M.sinceInfo(p, ctx.state.data.log, today);
  const bits = [M.cadenceLabel(M.parseCadence(p.cadence))];
  if (p.time) bits.push(p.time);
  else if (p.when) bits.push(p.when);
  bits.push(info.label);
  const meta = el(body, 'div', 'rv-row-meta', bits.join(' · '));
  if (info.cold) meta.classList.add('is-cold');
  const more = button(row, 'rv-row-more', null, ev => {
    const menu = new Menu();
    menu.addItem(m => m.setTitle('Edit').setIcon('pencil').onClick(() => ctx.edit('practice', p)));
    menu.addItem(m => m.setTitle('Set aside').setIcon('archive').onClick(() => ctx.setAside(p, true)));
    menu.addItem(m => m.setTitle('Open note').setIcon('external-link').onClick(() => ctx.openNote(p.path)));
    if (ev && ev.clientX !== undefined && menu.showAtMouseEvent) menu.showAtMouseEvent(ev);
  }, 'ellipsis');
  more.setAttribute('aria-label', `More for ${p.name}`);
  return row;
}

module.exports = { renderAreas };
