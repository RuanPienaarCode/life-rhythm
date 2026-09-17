'use strict';
/* Backgrounds — a wallpaper behind the app, and the glass that has to stay
   readable on top of it.

   Two kinds. Built-in gradients are CSS, so they cost nothing and work the
   moment the plugin loads. Photographs come from a folder in the vault, not
   from the plugin: a plugin has no business shipping megabytes of JPEG, and
   your own photographs are better than anything that could be bundled.

   The hard part is not the image, it is the reading. A photograph is an
   arbitrary field of light, so text laid over one is legible by luck. Two
   things fix that and both are here: a VEIL over the whole image, which
   pins the ground to a known lightness, and GLASS panels which blur what is
   behind them so no edge of the photo cuts through a line of type. The dim
   slider is the veil, and it is the control that matters — a bright photo
   needs more of it than a dark one. */

const { normalizePath } = require('obsidian');

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg'];
const FOLDER = 'Backgrounds';

/* Gradients in the same register as the rest of the app: slow, wide, no
   hard edges. Each names its own dark twin, because a wash that reads as
   dawn on paper reads as haze on black. */
const GRADIENTS = [
  {
    id: 'dusk', name: 'Dusk',
    light: 'linear-gradient(180deg, #2b4a72 0%, #7b6a8a 38%, #d99a6c 72%, #f3c9a0 100%)',
    dark: 'linear-gradient(180deg, #0a1428 0%, #1e2a46 45%, #55354a 78%, #8a4a3c 100%)',
  },
  {
    id: 'water', name: 'Still water',
    light: 'linear-gradient(180deg, #cfe3ee 0%, #8fb8cd 45%, #4a7f9e 100%)',
    dark: 'linear-gradient(180deg, #0c1b26 0%, #16394e 50%, #0a2130 100%)',
  },
  {
    id: 'canopy', name: 'Canopy',
    light: 'linear-gradient(180deg, #dce9d5 0%, #9dbf94 45%, #4f7a52 100%)',
    dark: 'linear-gradient(180deg, #0d1a12 0%, #1c3323 50%, #0a1610 100%)',
  },
  {
    id: 'aurora', name: 'Aurora',
    light: 'linear-gradient(180deg, #bfe6df 0%, #8fc9d8 40%, #5c7fae 100%)',
    dark: 'linear-gradient(180deg, #04121c 0%, #0d3b3f 42%, #123055 100%)',
  },
  {
    id: 'paper', name: 'Warm paper',
    light: 'linear-gradient(180deg, #f6f1e7 0%, #e8dfd0 100%)',
    dark: 'linear-gradient(180deg, #1a1713 0%, #241f18 100%)',
  },
];

const isImageId = id => typeof id === 'string' && id.indexOf('image:') === 0;
const pathOf = id => (isImageId(id) ? id.slice(6) : '');

/* Every image sitting in <root>/Backgrounds. The folder is the interface:
   drop a photograph in and it appears in settings. */
function listImages(plugin) {
  const root = normalizePath(plugin.settings.folder || 'Rhythm');
  const folder = plugin.app.vault.getFolderByPath(`${root}/${FOLDER}`);
  if (!folder || !folder.children) return [];
  return folder.children
    .filter(f => f.extension && IMAGE_EXT.indexOf(String(f.extension).toLowerCase()) >= 0)
    .map(f => ({ id: `image:${f.path}`, name: f.basename || f.name, path: f.path, file: f }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const folderPath = plugin => `${normalizePath(plugin.settings.folder || 'Rhythm')}/${FOLDER}`;

/* The CSS `background-image` value for the chosen id, or '' for none.
   Images resolve through the vault's own resource path, which is the only
   URL form that works on desktop AND on mobile. */
function backgroundCss(plugin, id, theme) {
  const chosen = id === undefined ? plugin.settings.background : id;
  if (!chosen || chosen === 'none') return '';
  if (isImageId(chosen)) {
    const file = plugin.app.vault.getFileByPath(pathOf(chosen));
    if (!file) return '';
    let url = '';
    try { url = plugin.app.vault.getResourcePath(file); } catch (e) { return ''; }
    if (!url) return '';
    /* The path can contain anything a filename can, quotes included. */
    return `url("${String(url).replace(/"/g, '%22')}")`;
  }
  const g = GRADIENTS.find(x => x.id === chosen);
  if (!g) return '';
  /* Guarded so the module can be reasoned about without a document —
     which is also how it is tested. */
  const dark = theme === undefined
    ? (typeof document !== 'undefined' && !!document.body && document.body.classList.contains('theme-dark'))
    : theme === 'dark';
  return dark ? g.dark : g.light;
}

/* Paint the wallpaper and its veil onto one element, and say whether the
   glass rules should switch on. Returns true when a background is showing,
   so the caller can toggle the class rather than guess. */
function applyBackground(node, plugin) {
  if (!node || !node.style) return false;
  const css = backgroundCss(plugin);
  const dim = Math.min(95, Math.max(0, Number(plugin.settings.backgroundDim)));
  node.style.setProperty('--rv-bg-image', css || 'none');
  node.style.setProperty('--rv-bg-dim', String((Number.isFinite(dim) ? dim : 55) / 100));
  if (node.classList) node.classList.toggle('has-bg', !!css);
  return !!css;
}

/* Everything settings needs to draw the picker, in display order. */
function options(plugin) {
  return [{ id: 'none', name: 'None' }]
    .concat(GRADIENTS.map(g => ({ id: g.id, name: g.name })))
    .concat(listImages(plugin).map(i => ({ id: i.id, name: i.name, isImage: true })));
}

module.exports = { GRADIENTS, IMAGE_EXT, FOLDER, listImages, folderPath, backgroundCss, applyBackground, options, isImageId, pathOf };
