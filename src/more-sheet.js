'use strict';
/* The phone dock's "More" sheet. Seven pages do not fit as labelled 44px
   slots on a phone, so the dock carries the first four and a More slot; this
   is what More opens: a bottom sheet standing where the dock is (the CSS
   keys it to the narrow pane) with one 60px row per remaining page, over a
   dimmed scrim. Escape or a tap on the scrim closes it and focus goes back
   to the More slot. Tab stays inside the sheet while it is open.

   DOM on the standard API only (no innerHTML), so the preview harness
   renders this exact code. What a row DOES is passed in. */

const { el, icon } = require('./dom');

const FOCUSABLE = 'button:not([disabled])';

/* root: the app root the sheet is mounted in (the non-scrolling layer).
   o: {
     items()  -> [{ id, label, icon }] the pages the sheet lists,
     current() -> the id of the page being shown,
     pick(id) -> a row was chosen (the sheet is already closed),
     toggle() -> the More slot, as it is NOW (the nav is rebuilt on every
                 render, so it is asked for rather than held),
   } */
function mountMoreSheet(root, o) {
  let sheet = null; /* { wrap, panel } */

  function close(restore) {
    if (!sheet) return;
    sheet.wrap.remove();
    sheet = null;
    const t = o.toggle();
    if (t) t.setAttribute('aria-expanded', 'false');
    if (restore && t && t.isConnected) t.focus();
  }

  function rows() {
    const list = sheet.list;
    while (list.firstChild) list.removeChild(list.firstChild);
    const cur = o.current();
    for (const it of o.items()) {
      const r = el(list, 'button', 'rv-sheet-row' + (it.id === cur ? ' is-current' : ''));
      r.type = 'button';
      if (it.id === cur) r.setAttribute('aria-current', 'page');
      icon(el(r, 'span', 'rv-sheet-ico'), it.icon);
      el(r, 'span', 'rv-sheet-title', it.label);
      r.addEventListener('click', e => { e.preventDefault(); close(false); o.pick(it.id); });
    }
  }

  function open() {
    if (sheet) { close(true); return; }
    const wrap = el(root, 'div', 'rv-sheet-wrap');
    const scrim = el(wrap, 'div', 'rv-scrim');
    scrim.addEventListener('click', () => close(true));
    const panel = el(wrap, 'div', 'rv-sheet');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'More pages');
    el(panel, 'h2', 'rv-sheet-h', 'More');
    const list = el(panel, 'div', 'rv-sheet-list');
    sheet = { wrap, panel, list };
    const t = o.toggle();
    if (t) t.setAttribute('aria-expanded', 'true');
    /* The root listens for single keys (n, t, 1-7, arrows); none of them are
       meant for a sheet. */
    wrap.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (e.key !== 'Tab') return;
      const items = [...panel.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const at = items.indexOf(root.ownerDocument.activeElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at < 0 || at === items.length - 1 ? 0 : at + 1);
      e.preventDefault();
      items[next].focus();
    });
    rows();
    const first = panel.querySelector('.rv-sheet-row.is-current') || panel.querySelector(FOCUSABLE);
    if (first) first.focus();
  }

  return {
    open,
    close,
    isOpen: () => !!sheet,
    /* The app redrew (a vault change): the page may have changed under an
       open sheet, and the nav's More slot is a new element. */
    sync() {
      if (!sheet) return;
      const t = o.toggle();
      if (t) t.setAttribute('aria-expanded', 'true');
      const was = root.ownerDocument.activeElement;
      const at = was && sheet.panel.contains(was) ? [...sheet.list.children].indexOf(was) : -1;
      rows();
      if (at >= 0 && sheet.list.children[at]) sheet.list.children[at].focus();
    },
  };
}

module.exports = { mountMoreSheet };
