/* Harness entry: mounts the REAL app (src/app.js) on a fake plugin host
   backed by an in-memory vault.
     ?seeded=1   start with the starter set plus a week of sample ticks
     ?theme=dark add Obsidian's theme-dark class
     ?date=YYYY-MM-DD  pretend today is that date (Date is not patched;
                       the app's own "today" is the real one) */
import { makeMemoryVault } from './memory-vault.js';
const { mountApp } = require('../src/app');
const { DEFAULT_SETTINGS } = require('../src/constants');
const { makeStore } = require('../src/io');
const D = require('../src/dates');

const q = new URLSearchParams(location.search);
if (q.get('theme') === 'dark') document.body.classList.add('theme-dark');

const vault = makeMemoryVault({});
const plugin = {
  app: {
    vault,
    workspace: {
      getLeaf: () => ({ openFile: f => { console.log('[openFile]', f.path); alert('Would open ' + f.path + '\n\n' + (vault.files.get(f.path) || '')); } }),
    },
    fileManager: { renameFile: (f, np) => vault.rename(f, np) },
  },
  settings: { ...DEFAULT_SETTINGS },
  _lastWrite: 0,
  async saveSettings() {},
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
  plugin.settings.onboarded = true;
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
  const ctl = mountApp(view);
  window.__rv = { ctl, vault, plugin };
  await ctl.start();
  const tab = q.get('tab');
  if (tab) ctl.ctx.setTab(tab);
})();
