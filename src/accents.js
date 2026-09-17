'use strict';
/* The accent — the one colour in the app that carries meaning (a tick, a
   link, today) — and the maths that keeps it legible.

   A single hex cannot do the job on its own. The same blue that reads well
   as a filled tick on white paper is too dark to read as small text on a
   black ground, so every accent is expanded into six values per theme:

     fill   the colour of a filled thing (tick, bar, dot) — 3:1 against the
            surface behind it, which is WCAG's bar for a graphical object
     text   the colour of accent-coloured WORDS — 4.5:1, the bar for text
     ink    what sits ON the fill, black or white, whichever wins

   The derivation nudges the chosen hex towards black (light theme) or
   white (dark theme) only as far as it must to clear those bars, so a
   colour that already passes is used exactly as given. tests/accents
   asserts every preset clears them in both themes, so a new colour cannot
   be added without meeting the same bar.

   Pure — no DOM, no obsidian import. */

const PRESETS = [
  { id: 'slate', name: 'Slate', hex: '#386382' },
  { id: 'sage', name: 'Sage', hex: '#6A9B85' },
  { id: 'teal', name: 'Teal', hex: '#35787C' },
  { id: 'clay', name: 'Clay', hex: '#A9604A' },
  { id: 'rose', name: 'Rose', hex: '#A05666' },
  { id: 'plum', name: 'Plum', hex: '#7A5A80' },
  { id: 'ochre', name: 'Ochre', hex: '#9A7638' },
  { id: 'moss', name: 'Moss', hex: '#5F7A43' },
  { id: 'ink', name: 'Ink', hex: '#4F5560' },
  { id: 'system', name: 'System blue', hex: '#007AFF' },
];

const DEFAULT_ACCENT = 'slate';

/* The surfaces the accent has to hold up against. */
const CELL_LIGHT = [255, 255, 255];
const CELL_DARK = [28, 28, 30]; // #1c1c1e, Apple's dark grouped cell
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex == null ? '' : hex).trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = rgb => '#' + rgb.map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');

/* sRGB relative luminance, per WCAG. */
const channel = c => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = rgb => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);

function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Rounded to whole channels, because a rounded hex is what actually ships
   — bisecting on floats and rounding afterwards lands just under the bar. */
const mix = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));

/* Move `rgb` towards `target` by the smallest amount that clears `ratio`
   against `bg`. Only ever called with target = black on a light ground or
   white on a dark one, where contrast rises monotonically with t, so a
   bisection lands on the least change that works. */
function nudge(rgb, target, bg, ratio) {
  const start = rgb.map(Math.round);
  if (contrast(start, bg) >= ratio) return start;
  if (contrast(target, bg) < ratio) return target.slice(); // even the extreme cannot
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2;
    if (contrast(mix(start, target, t), bg) >= ratio) hi = t; else lo = t;
  }
  const out = mix(start, target, hi);
  /* The bisection can settle on a t whose rounded colour sits a hair under
     the bar; step the last channel until it is over, so the value that
     ships is the value that was measured. */
  for (let i = 0; i < 16 && contrast(out, bg) < ratio; i++) {
    for (let c = 0; c < 3; c++) out[c] = clamp(Math.round(out[c] + (target[c] > out[c] ? 1 : -1)), 0, 255);
  }
  return out;
}

const rgba = (rgb, a) => `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${a})`;
const inkOn = fill => (contrast(fill, WHITE) >= contrast(fill, BLACK) ? WHITE : BLACK);

function baseOf(id, customHex) {
  if (id === 'custom') return parseHex(customHex) || parseHex(PRESETS[0].hex);
  const found = PRESETS.find(p => p.id === id);
  return parseHex((found || PRESETS.find(p => p.id === DEFAULT_ACCENT)).hex);
}

/* Everything one accent needs, both themes at once. Both sets are emitted
   together and the stylesheet picks between them on `.theme-dark`, so no
   part of this has to know which theme is showing — and nothing has to be
   recomputed when the user switches. */
function accentVars(id, customHex) {
  const base = baseOf(id, customHex);
  const fillL = nudge(base, BLACK, CELL_LIGHT, 3);
  const textL = nudge(base, BLACK, CELL_LIGHT, 4.5);
  /* Dark mode aims the fill a little higher than the 3:1 floor: on a black
     ground a mid-tone reads as muddy long before it is technically
     illegible, which is why Apple lifts its own tints for dark mode. A
     colour already above the line is still left alone. */
  const fillD = nudge(base, WHITE, CELL_DARK, 4);
  const textD = nudge(base, WHITE, CELL_DARK, 4.5);
  return {
    '--rv-tint-l': toHex(fillL),
    '--rv-tint-d': toHex(fillD),
    '--rv-tint-text-l': toHex(textL),
    '--rv-tint-text-d': toHex(textD),
    '--rv-tint-ink-l': toHex(inkOn(fillL)),
    '--rv-tint-ink-d': toHex(inkOn(fillD)),
    '--rv-tint-soft-l': rgba(fillL, 0.1),
    '--rv-tint-soft-d': rgba(fillD, 0.18),
    '--rv-tint-band-l': rgba(fillL, 0.09),
    '--rv-tint-band-d': rgba(fillD, 0.14),
  };
}

/* Paint one element's custom properties. Called for the view root and for
   every modal, since a modal is mounted outside the view. */
function applyAccent(node, settings) {
  if (!node || !node.style) return;
  const vars = accentVars((settings && settings.accent) || DEFAULT_ACCENT, settings && settings.accentHex);
  for (const k of Object.keys(vars)) node.style.setProperty(k, vars[k]);
}

/* The swatch shown in settings: the light-theme fill, so the dot looks
   like what a tick will look like. */
const swatchFor = (id, customHex) => toHex(nudge(baseOf(id, customHex), BLACK, CELL_LIGHT, 3));

module.exports = {
  PRESETS, DEFAULT_ACCENT, accentVars, applyAccent, swatchFor,
  parseHex, toHex, contrast, luminance, nudge, inkOn, CELL_LIGHT, CELL_DARK,
};
