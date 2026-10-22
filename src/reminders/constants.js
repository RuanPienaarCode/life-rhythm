'use strict';
/* Shared constants. */

/* The id is nudge-reminders, not nudge: a store plugin already owns `nudge`,
   and Obsidian's update check overwrote this one with it (17 Sep 2026). The
   view type and deep link follow, so the two can never collide. */
const VIEW_TYPE = 'nudge-reminders-view';
/* obsidian://nudge-reminders — the deep link a Shortcuts automation or a home-screen
   bookmark can open. */
const PROTOCOL = 'nudge-reminders';

const DEFAULT_SETTINGS = {
  /* The one note every reminder lives in. Plain checkbox lines, so the Tasks
     plugin, a grep and a human all read the same file. */
  file: 'Reminders.md',
  title: 'Reminders',
  name: '',

  /* Look: 'glass' brings its own ground, 'plain' borrows Obsidian's theme. */
  surface: 'glass',
  tint: 'aurora',
  /* Glass in light or dark: 'auto' follows Obsidian's own theme. */
  mode: 'auto',
  /* The lists sidebar beside the board on a wide pane. */
  sidebar: true,
  openOnStartup: false,
  showDone: false,
  weekStart: 1,

  /* In-app notices, while Obsidian is open. */
  notify: true,
  alarmMinutes: 10,
  allDayAlarmTime: '09:00',
  ribbonBadge: true,

  /* The calendar file iOS can import, for alerts that reach a locked phone. */
  icsFile: 'Reminders.ics',
  calendarName: 'Nudge',
  autoExport: false,

  defaultGroup: '',
  onboarded: false,
};

const TINTS = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'moss', label: 'Moss' },
  { id: 'ember', label: 'Ember' },
  { id: 'ink', label: 'Ink' },
];

const MODES = [
  { id: 'auto', label: 'Match Obsidian' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/* Whether the board draws its light glass. An unknown mode falls back to
   following the theme, never to a fixed look. */
function isLightLook(mode, themeIsLight) {
  if (mode === 'light') return true;
  if (mode === 'dark') return false;
  return !!themeIsLight;
}

const FILTERS = [
  { key: 'all', label: 'All', icon: 'list-todo' },
  { key: 'overdue', label: 'Overdue', icon: 'flag' },
  { key: 'today', label: 'Today', icon: 'sun' },
  { key: 'week', label: 'This week', icon: 'calendar-days' },
  { key: 'someday', label: 'Someday', icon: 'inbox' },
  { key: 'done', label: 'Done', icon: 'check' },
];

const SNOOZE = [
  { days: 1, label: 'Tomorrow' },
  { days: 2, label: 'In 2 days' },
  { days: 3, label: 'In 3 days' },
  { days: 7, label: 'Next week' },
  { days: 30, label: 'In a month' },
];

module.exports = { VIEW_TYPE, PROTOCOL, DEFAULT_SETTINGS, TINTS, MODES, isLightLook, FILTERS, SNOOZE };
