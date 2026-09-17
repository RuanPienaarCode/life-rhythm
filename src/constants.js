'use strict';
/* Shared constants. */

const VIEW_TYPE = 'rhythm-view';

const DEFAULT_SETTINGS = {
  folder: 'Rhythm',
  /* How many practices Today puts in front of you. Everything else that is
     due sits under "When there's space" — the whole point of the plugin is
     that the list you look at is short. */
  focusCount: 3,
  weekStart: 1, // 0 = Sunday, 1 = Monday
  openOnStartup: false,
  onboarded: false,
  /* days | weeks | off */
  streakMode: 'days',
  /* A line of scripture or a stillness prompt when the list is clear. */
  showPrompt: true,
  /* The welcome screen and the soft entrance of each page. */
  softEntrance: true,
  /* How Today shows what is outstanding: 'list' or 'deck'. */
  todayView: 'list',
  /* The one colour that carries meaning. An id from accents.js PRESETS, or
     'custom' with accentHex. */
  accent: 'slate',
  accentHex: '',
  /* A wallpaper behind the app: 'none', a gradient id, or 'image:<path>'
     for anything dropped in <folder>/Backgrounds. */
  background: 'none',
  /* How far the veil pulls the image towards the page colour, 0–95. A
     photograph is an arbitrary field of light; this is what makes text on
     top of it legible by design rather than by luck. */
  backgroundDim: 55,
  /* Subscribed calendars, one URL per line (webcal:// is fine). */
  calendarUrls: '',
  calendarCache: null,
};

const FOLDERS = {
  areas: 'Areas',
  practices: 'Practices',
  goals: 'Goals',
  events: 'Events',
  log: 'Log',
  backgrounds: 'Backgrounds',
};

const WHEN = ['morning', 'day', 'evening', 'night'];

/* obsidian://rhythm?tab=today — the deep link a Shortcuts automation or a
   home-screen bookmark can open. */
const PROTOCOL = 'rhythm';

module.exports = { VIEW_TYPE, DEFAULT_SETTINGS, FOLDERS, WHEN, PROTOCOL };
