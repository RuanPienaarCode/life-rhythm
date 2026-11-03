'use strict';
/* One data.json for three modules. Rhythm's keys stay at the top level
   (other plugins read plugins.rhythm.settings.folder), the reminders module
   (once Nudge) keeps its keys under `reminders`, the planner (once
   Fortnight) under `planner`. A few settings mean the same thing in more
   than one module and live once, at the top:
     name           the greeting name
     openOnStartup  open the view when Obsidian starts
     weekStart      Rhythm's; Fortnight already deferred to it, Nudge's was never read
   and the old per-plugin looks (Nudge's surface/tint/mode, Fortnight's
   accent) are gone: the whole view wears Rhythm's look.

   Pure — no obsidian import, no vault. */

const { DEFAULT_SETTINGS: RHYTHM_DEFAULTS } = require('./constants');
const { DEFAULT_SETTINGS: NUDGE_DEFAULTS } = require('./reminders/constants');
const { DEFAULT_SETTINGS: FORTNIGHT_DEFAULTS } = require('./planner/constants');

const OLD_IDS = { reminders: 'nudge-reminders', planner: 'fortnight-planner' };

/* Keys a module no longer keeps for itself. */
const SHARED = ['name', 'openOnStartup', 'weekStart'];
const LOOK = { reminders: ['surface', 'tint', 'mode'], planner: ['accent'] };

const without = (obj, keys) => {
  const out = {};
  for (const k of Object.keys(obj)) if (!keys.includes(k)) out[k] = obj[k];
  return out;
};
const MODULE_DEFAULTS = {
  reminders: without(NUDGE_DEFAULTS, [...SHARED, ...LOOK.reminders]),
  planner: without(FORTNIGHT_DEFAULTS, [...SHARED, ...LOOK.planner]),
};

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const copy = v => (Array.isArray(v) ? v.slice() : isObj(v) ? Object.assign({}, v) : v);

/* The settings the plugin runs with, from what its data.json holds (saved)
   and what the old plugins' data.json files hold (old: { 'nudge-reminders':
   obj | null, 'fortnight-planner': obj | null }).

   Each old file is imported ONCE: `imported[id]` records the day it was, and
   from then on that file is never read into the settings again — a change
   made here is not undone by a stale copy. An old file that is absent is not
   marked, so installing the old plugin's data later still imports it.

   Conflicts (decided 22 Oct 2026):
     name           Nudge's, else Fortnight's — only while the merged one is blank
     openOnStartup  on if Rhythm's or Nudge's was on
     weekStart      Rhythm's, always
     first-run flags (onboarded, showWelcome, lastWelcome) come across as they were

   Resolves to { settings, changed } — changed: something was imported, so
   the caller should save. today is an ISO date (the import stamp). */
function mergeSettings(saved, old, today) {
  const src = isObj(saved) ? saved : {};
  const s = Object.assign({}, RHYTHM_DEFAULTS, { name: '' }, without(src, ['reminders', 'planner', 'imported']));
  for (const ns of ['reminders', 'planner']) {
    s[ns] = Object.assign({}, MODULE_DEFAULTS[ns], isObj(src[ns]) ? src[ns] : {});
  }
  s.imported = Object.assign({}, isObj(src.imported) ? src.imported : {});
  let changed = false;
  for (const ns of ['reminders', 'planner']) {
    const id = OLD_IDS[ns];
    const data = old && old[id];
    if (s.imported[id] || !isObj(data)) continue;
    for (const k of Object.keys(MODULE_DEFAULTS[ns])) if (k in data) s[ns][k] = copy(data[k]);
    if (!s.name && typeof data.name === 'string' && data.name.trim()) s.name = data.name.trim();
    if (ns === 'reminders' && data.openOnStartup === true) s.openOnStartup = true;
    s.imported[id] = today || true;
    changed = true;
  }
  return { settings: s, changed };
}

/* A module's view of the settings: its own namespace, with the shared keys
   read from (and written to) the top level, and the retired look keys
   pinned to the values that make it borrow Rhythm's look. Modules keep
   writing `settings.x = v; saveSettings()` exactly as before. */
function scopedSettings(plugin, ns, pinned) {
  const own = () => plugin.settings[ns];
  const pins = pinned || {};
  return new Proxy({}, {
    get(_, key) {
      if (typeof key !== 'string') return undefined;
      if (key in pins) return pins[key];
      if (SHARED.includes(key)) return plugin.settings[key];
      return own()[key];
    },
    set(_, key, value) {
      if (typeof key !== 'string' || key in pins) return true;
      if (SHARED.includes(key)) plugin.settings[key] = value;
      else own()[key] = value;
      return true;
    },
    has(_, key) { return key in pins || SHARED.includes(key) || key in own(); },
    ownKeys() { return [...new Set([...Object.keys(own()), ...SHARED, ...Object.keys(pins)])]; },
    getOwnPropertyDescriptor(_, key) {
      return { enumerable: true, configurable: true, writable: true, value: this.get(_, key) };
    },
    deleteProperty(_, key) { if (!SHARED.includes(key) && !(key in pins)) delete own()[key]; return true; },
  });
}

/* The pins: Nudge's "plain" surface borrows the theme's colours, which the
   view re-points at Rhythm's (styles: .rv-embed); Fortnight's "theme" accent
   follows --interactive-accent, likewise re-pointed. */
const PINS = {
  reminders: { surface: 'plain', mode: 'auto', tint: 'aurora' },
  planner: { accent: 'theme' },
};

module.exports = { mergeSettings, scopedSettings, MODULE_DEFAULTS, OLD_IDS, SHARED, PINS };
