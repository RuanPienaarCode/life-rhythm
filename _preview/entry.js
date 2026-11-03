/* Harness entry: mounts the REAL app (src/app.js) on a fake plugin host
   backed by an in-memory vault — with the REAL reminders and planner hosts
   (src/reminders/host.js, src/planner/host.js) wired as main.js wires them,
   so every page, Today, Reminders and Fortnight included, runs real code.
     ?seeded=1   start with the starter set plus a week of sample ticks,
                 reminders, and a few Tasks lines
     ?phone=1    Obsidian on a phone: Platform.isPhone, the is-mobile and
                 is-phone body classes, and the frame fills the window
     ?still=1    no splash or soft entrance (the softEntrance setting off),
                 for screenshots
     ?theme=dark add Obsidian's theme-dark class
     ?date=YYYY-MM-DD  pretend today is that date (Date is not patched;
                       the app's own "today" is the real one) */
import { makeMemoryVault } from './memory-vault.js';
const { mountApp } = require('../src/app');
const { DEFAULT_SETTINGS } = require('../src/constants');
const { makeStore } = require('../src/io');
const D = require('../src/dates');
const { mergeSettings } = require('../src/settings-merge');
const { attachReminders } = require('../src/reminders/host');
const { attachPlanner } = require('../src/planner/host');

const q = new URLSearchParams(location.search);
if (q.get('theme') === 'dark') document.body.classList.add('theme-dark');
if (q.get('phone') === '1') document.body.classList.add('is-mobile', 'is-phone');

/* The metadata cache, as far as the planner asks it: which notes hold task
   list items (rebuilt from the text each time, so it never goes stale). */
const TASK_ITEM = /^[\s>]*([-*+]|\d+[.)])[ \t]+\[(.)\](?:[ \t]|\r?$)/;

const vault = makeMemoryVault({});
let ctl = null;
const plugin = {
  app: {
    vault,
    workspace: {
      getLeaf: () => ({ openFile: f => { console.log('[openFile]', f.path); alert('Would open ' + f.path + '\n\n' + (vault.files.get(f.path) || '')); } }),
      onLayoutReady: cb => setTimeout(cb, 0),
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: f => {
        const text = vault.files.get(f.path);
        if (text == null) return null;
        const listItems = text.split('\n').map((l, i) => (TASK_ITEM.test(l) ? { task: TASK_ITEM.exec(l)[2], position: { start: { line: i } } } : null)).filter(Boolean);
        return listItems.length ? { listItems } : {};
      },
      on: () => ({}),
    },
    plugins: { plugins: {} },
    fileManager: { renameFile: (f, np) => vault.rename(f, np) },
  },
  settings: mergeSettings({ ...DEFAULT_SETTINGS }, {}, D.todayISO()).settings,
  manifest: { id: 'rhythm' },
  _lastWrite: 0,
  async saveSettings() {},
  registerEvent() {},
  registerInterval() {},
  /* as main.js */
  forEachEmbed(kind, fn) { const e = ctl && ctl.ctx.embed; if (e && e.kind === kind) { fn(e.ctl); return true; } return false; },
  forEachView(fn) { if (ctl) fn(ctl); },
  refreshViews() { if (ctl) ctl.ctx.reload(); },
  rhythmStoreFor() { return plugin.rhythmStore; },
  changed() { plugin.feedChanged(); },
  feedChanged() { if (ctl && ctl.ctx.feedChanged) ctl.ctx.feedChanged(); },
  /* as main.js */
  canAsk() { return !!ctl && plugin.settings.askAi !== false; },
  askAbout(item) { if (ctl) ctl.ctx.askAbout(item); },
};
plugin.rhythmStore = makeStore(plugin);
plugin.reminders = attachReminders(plugin);
plugin.planner = attachPlanner(plugin);
/* Ask AI with a stand-in AI: no key, no network. It answers from the page
   it was given (so the context can be checked in window.__rv.asked) and
   suggests one change of each kind it can see. ?ai=error answers with the
   missing-key error instead. */
const AIP = require('../src/ai/providers');
/* as host.js: none on a phone */
plugin.ai = q.get('phone') === '1' ? null : {
  device: { desktop: true },
  providers: () => AIP.PROVIDERS,
  current: () => AIP.provider('claude-code'),
  model: () => '',
  async ask({ system, messages }) {
    window.__rv.asked = { system, messages };
    await new Promise(r => setTimeout(r, 400));
    if (q.get('ai') === 'error') throw new Error('Add your Claude API key in Settings → Rhythm → Ask AI.');
    const t = D.todayISO();
    const screen = system.split('On the screen:\n')[1] || '';
    const habit = /Exercise/.test(screen) ? 'Exercise' : 'Read';
    return { text: `I can see ${screen.split('\n').filter(Boolean).length} lines on this page. Start with the slipped fence job, then exercise.\n\n\`\`\`rhythm-actions\n` + JSON.stringify([
      { kind: 'add_reminder', title: 'Buy paint for the fence', due: D.addDays(t, 1), time: '09:00' },
      { kind: 'tick_habit', name: habit },
      { kind: 'move_todo', text: 'Paint the fence on the north side of the garden', date: D.addDays(t, 1) },
      { kind: 'note', text: 'Asked AI for a plan for today.' },
      { kind: 'move_todo', text: 'Nothing called this', date: t },
    ]) + '\n\`\`\`', model: 'fake' };
  },
};
const view = {
  plugin,
  contentEl: document.getElementById('app'),
  registerEvent() {},
  registerInterval() {},
};

async function seedSample() {
  const store = makeStore(plugin);
  await store.seed();
  const t = D.todayISO();
  if (q.get('clear')) { plugin.settings.onboarded = true; plugin._lastWrite = 0; return; }
  const ticks = {
    [D.addDays(t, -6)]: ['Read the Bible', 'Practice an instrument', 'Exercise'],
    [D.addDays(t, -5)]: ['Read the Bible', 'Be still', 'Message someone'],
    [D.addDays(t, -4)]: ['Read the Bible', 'Exercise', 'Read'],
    [D.addDays(t, -3)]: ['Be still', 'Practice an instrument', 'Pray for someone'],
    [D.addDays(t, -2)]: ['Read the Bible', 'Exercise', 'Message someone', 'Read'],
    [D.addDays(t, -1)]: ['Read the Bible', 'Be still', 'Practice an instrument'],
    [t]: ['Read the Bible'],
  };
  for (const [d, names] of Object.entries(ticks)) for (const n of names) await store.setDone(d, n, true);
  await store.createEvent({ name: 'Dinner out', area: 'Family', date: D.addDays(t, 2), time: '19:00', body: 'Somewhere with music.' });
  await store.createEvent({ name: 'Mountain weekend', area: 'Adventure', date: D.addDays(t, 23), body: 'Two nights. Book the campsite.' });
  await store.createEvent({ name: 'Morning ride', area: 'Adventure', date: D.addDays(t, 6), time: '09:00' });
  await store.appendLog(t, 'Slept badly but the morning was quiet. Grateful for that.');
  plugin.settings.calendarCache = { fetchedAt: Date.now(), events: [
    { name: 'Book club', date: D.addDays(t, 4), time: '19:00', location: 'The library' },
    { name: 'A friend\'s birthday', date: D.addDays(t, 11), time: '', allDay: true },
  ], errors: [] };
  /* Reminders and Tasks lines for the Reminders, Fortnight and Today pages. */
  await vault.create('Reminders.md', [
    '# Reminders', '', '## Home',
    `- [ ] Water the plants ⏰ 07:30 📅 ${D.addDays(t, -1)} 🔁 every week`,
    `- [ ] Book the car service 🔼 📅 ${t}`,
    `- [ ] Renew the licence disc before the end of the month, it expires soon ⏫ 📅 ${D.addDays(t, 3)}`,
    '- [ ] Learn to bake bread', '', '## Work',
    `- [ ] Send the quarterly report ⏰ 16:00 📅 ${D.addDays(t, 1)}`,
  ].join('\n') + '\n');
  await vault.create('Projects/House.md', [
    `- [ ] Fix the gate ⏳ ${t}`,
    `- [ ] Paint the fence on the north side of the garden ⏳ ${D.addDays(t, -2)}`,
    `- [ ] Clear the gutters ⏳ ${D.addDays(t, 2)}`,
    '- [ ] Repaint the shed #later',
  ].join('\n') + '\n');
  await vault.create('Planning/Fortnight.md', '# Fortnight\n\n## Inbox\n');
  plugin.settings.onboarded = true;
  plugin.settings.planner.lastWelcome = t;
  plugin._lastWrite = 0;
}

/* A high-contrast stand-in for a photograph: bright sky against dark
   foliage, which is the case that makes text on glass hardest to read. */
const FAKE_PHOTO = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <rect width="1200" height="800" fill="#dff0ff"/>
  <circle cx="980" cy="150" r="120" fill="#fffbe6"/>
  <path d="M0 520 L120 300 L240 520 Z" fill="#123d1c"/>
  <path d="M180 560 L330 240 L480 560 Z" fill="#0b2d14"/>
  <path d="M420 540 L560 320 L700 540 Z" fill="#1a4d22"/>
  <path d="M660 580 L820 260 L980 580 Z" fill="#0e3418"/>
  <path d="M900 540 L1050 330 L1200 540 Z" fill="#173f1e"/>
  <rect y="520" width="1200" height="280" fill="#2f6d4a"/>
  <rect y="620" width="1200" height="180" fill="#14402c"/>
  <rect x="0" y="700" width="1200" height="14" fill="#eaf7ff" opacity="0.75"/>
</svg>`);

(async () => {
  if (q.get('seeded')) await seedSample();
  const bg = q.get('bg');
  if (bg === 'photo') {
    await vault.create('Rhythm/Backgrounds/A river.svg', FAKE_PHOTO);
    plugin.settings.background = 'image:Rhythm/Backgrounds/A river.svg';
  } else if (bg) {
    plugin.settings.background = bg;
  }
  if (q.get('dim')) plugin.settings.backgroundDim = Number(q.get('dim'));
  if (q.get('still')) plugin.settings.softEntrance = false;
  ctl = mountApp(view);
  window.__rv = { ctl, vault, plugin };
  await ctl.start();
  const tab = q.get('tab');
  if (tab) ctl.ctx.setTab(tab);
})();
