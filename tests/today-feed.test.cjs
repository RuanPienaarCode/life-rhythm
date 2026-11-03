'use strict';
/* today-feed.js: the Today page's list, built from Fortnight's board and
   Rhythm's day plan over a real in-memory vault — what slipped, today's
   to-dos and reminders, the habits due (each habit once), today's events,
   what was done today. */
const assert = require('node:assert');
const { makeApp, plannerStore } = require('./planner-_stub.cjs');
const { makeStore: makeRhythmStore } = require('../src/io');
const { loadFeed, buildFeed } = require('../src/today-feed');
const { MODULE_DEFAULTS } = require('../src/settings-merge');

const T = '2026-10-22'; // a Thursday

const nudge = {
  path: () => 'Reminders.md', isOurs: p => p === 'Reminders.md',
  load: async () => ({ items: [
    { line: 1, raw: '- [ ] Call the bank 📅 2026-10-22', title: 'Call the bank', due: '2026-10-22', time: '09:30', priority: 'high', group: 'Admin', tags: [] },
    { line: 2, raw: '- [ ] Water plants 📅 2026-10-20', title: 'Water plants', due: '2026-10-20', priority: 'normal', group: 'Home', tags: [] },
    { line: 3, raw: '- [ ] Book flights 📅 2026-10-30', title: 'Book flights', due: '2026-10-30', tags: [] },
    { line: 4, raw: '- [x] Pay rates 📅 2026-10-22 ✅ 2026-10-22', title: 'Pay rates', due: '2026-10-22', done: true, doneDate: '2026-10-22', tags: [] },
  ] }),
};

(async () => {
  const app = makeApp({
    'Projects/House.md': '- [ ] Fix the gate ⏳ 2026-10-22\n- [ ] Paint the fence ⏳ 2026-10-21\n- [ ] Clear gutters ⏳ 2026-10-24\n- [ ] Someday thing',
    'Rhythm/Areas/Body.md': '---\nrhythm: area\norder: 1\n---\n',
    'Rhythm/Practices/Walk.md': '---\nrhythm: practice\narea: Body\ncadence: daily\n---\n',
    'Rhythm/Practices/Gym.md': '---\nrhythm: practice\narea: Body\ncadence: 2/week\n---\n',
    'Rhythm/Practices/Read.md': '---\nrhythm: practice\narea: Body\ncadence: daily\n---\n',
    'Rhythm/Events/Dentist.md': '---\nrhythm: event\narea: Body\ndate: 2026-10-22\ntime: "14:00"\n---\n',
    'Rhythm/Log/2026-10-22.md': '---\nrhythm: log\ndone: [Read]\nplan: [Gym]\n---\n',
  }, { 'nudge-reminders': { store: nudge }, rhythm: { settings: {} } });

  const settings = { folder: 'Rhythm', weekStart: 1, focusCount: 3 };
  const rhythmStore = makeRhythmStore({ app, settings });
  const planner = { store: plannerStore({ app, settings: Object.assign({}, MODULE_DEFAULTS.planner) }), settings: Object.assign({}, MODULE_DEFAULTS.planner) };
  const plugin = { settings, rhythmStore, planner };
  const data = await rhythmStore.load();
  const f = await loadFeed(plugin, data, T);

  assert.strictEqual(f.today, T);
  assert.deepStrictEqual(f.slipped.map(c => c.text).sort(), ['Paint the fence', 'Water plants'], 'what slipped: a Tasks line and a reminder');
  assert.deepStrictEqual(f.todo.map(c => c.text).sort(), ['Call the bank', 'Fix the gate'], "today's to-dos and reminders");
  assert.ok(!f.todo.some(c => c.text === 'Clear gutters' || c.text === 'Book flights'), 'nothing from later days');
  assert.deepStrictEqual(f.events.map(c => c.text), ['Dentist']);
  const habitNames = [...f.habits, ...f.habitsLater].map(r => r.p.name).sort();
  assert.deepStrictEqual(habitNames, ['Gym', 'Walk'], 'the habits due: daily Walk, Gym promised today; Read is done');
  assert.ok(![...f.slipped, ...f.todo, ...f.events, ...f.doneToday].some(c => c.source === 'practice'), 'each habit once, from Rhythm');
  assert.deepStrictEqual(f.doneToday.map(c => c.text), ['Pay rates']);
  assert.strictEqual(f.habitsDone, 1);
  assert.strictEqual(f.open, 2 + 2 + 2, 'slipped + to-dos + habits; events are not to-dos');
  assert.strictEqual(f.done, 2);

  /* no Rhythm folder: the list still has the to-dos and reminders */
  {
    const bare = makeApp({ 'A.md': '- [ ] Only task ⏳ 2026-10-22' }, {});
    const rs = makeRhythmStore({ app: bare, settings });
    const pl = { store: plannerStore({ app: bare, settings: {} }), settings: {} };
    const g = await loadFeed({ settings, rhythmStore: rs, planner: pl }, await rs.load(), T);
    assert.deepStrictEqual(g.todo.map(c => c.text), ['Only task']);
    assert.deepStrictEqual(g.habits, []);
    assert.strictEqual(g.open, 1);
  }

  /* buildFeed on an empty board */
  const empty = buildFeed({ days: [], slipped: [], doneToday: [] }, null, T, {});
  assert.deepStrictEqual([empty.open, empty.done, empty.todo.length, empty.habits.length], [0, 0, 0, 0]);

  console.log('today feed OK');
})().catch(e => { console.error(e); process.exit(1); });
