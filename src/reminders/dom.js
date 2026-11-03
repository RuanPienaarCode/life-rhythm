'use strict';
/* Tiny DOM helpers on the standard API only (no Obsidian createEl), so the
   same rendering code runs in the browser preview harness. No innerHTML
   anywhere — every node is built. */

const { setIcon } = require('obsidian');

function el(parent, tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (parent) parent.appendChild(n);
  return n;
}

function icon(parent, name, cls) {
  const s = el(parent, 'span', 'nd-icon' + (cls ? ' ' + cls : ''));
  try { setIcon(s, name); } catch (e) { /* preview harness: no lucide */ }
  return s;
}

function button(parent, cls, label, onClick, iconName, tip) {
  const b = el(parent, 'button', cls);
  b.type = 'button';
  if (iconName) icon(b, iconName);
  if (label) el(b, 'span', 'nd-btn-label', label);
  if (tip) { b.setAttribute('aria-label', tip); b.setAttribute('title', tip); }
  if (onClick) b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(e); });
  return b;
}

function input(parent, cls, attrs) {
  const i = el(parent, 'input', cls);
  for (const k of Object.keys(attrs || {})) {
    if (k === 'value') i.value = attrs[k] === undefined || attrs[k] === null ? '' : attrs[k];
    else i.setAttribute(k, attrs[k]);
  }
  return i;
}

function select(parent, cls, options, value) {
  const s = el(parent, 'select', cls);
  for (const o of options) {
    const opt = el(s, 'option', null, o.label);
    opt.value = o.value;
    if (o.value === value) opt.selected = true;
  }
  return s;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

module.exports = { el, icon, button, input, select, clear };
