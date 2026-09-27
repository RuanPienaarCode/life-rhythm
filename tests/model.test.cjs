'use strict';
const assert = require('node:assert');
const M = require('../src/model');
const D = require('../src/dates');

const E = (done = [], skip = [], snooze = [], plan = []) => ({ done: new Set(done), skip: new Set(skip), snooze: new Set(snooze), plan: new Set(plan), note: '' });

/* ---- cadence ---- */
assert.deepStrictEqual(M.parseCadence('daily'), { per: 'day', times: 1 });
assert.deepStrictEqual(M.parseCadence('Weekly'), { per: 'week', times: 1 });
assert.deepStrictEqual(M.parseCadence('3/week'), { per: 'week', times: 3 });
assert.deepStrictEqual(M.parseCadence('2x/week'), { per: 'week', times: 2 });
assert.deepStrictEqual(M.parseCadence('4 per week'), { per: 'week', times: 4 });
assert.deepStrictEqual(M.parseCadence('2/month'), { per: 'month', times: 2 });
assert.deepStrictEqual(M.parseCadence('monthly'), { per: 'month', times: 1 });
assert.strictEqual(M.parseCadence('whenever'), null);
assert.strictEqual(M.cadenceLabel(M.parseCadence('3/week')), '3× a week');
assert.deepStrictEqual(M.parseDays(['Mon', 'wednesday', 'xx', 'mon']), ['mon', 'wed']);

/* ---- fixture: week of Mon 7 Sep 2026, today Fri 11 Sep ---- */
const areas = [{ name: 'Faith', order: 1 }, { name: 'Body', order: 4 }, { name: 'Craft', order: 6 }];
const practices = [
  { name: 'Read the Bible', area: 'Faith', cadence: 'daily', when: 'morning' },
  { name: 'Exercise', area: 'Body', cadence: '4/week', when: 'evening' },
  { name: 'Practice guitar', area: 'Craft', cadence: 'daily', when: 'evening' },
  { name: 'Paint', area: 'Craft', cadence: 'weekly' },
  { name: 'Range', area: 'Craft', cadence: 'monthly' },
  { name: 'Sabbath walk', area: 'Faith', cadence: 'daily', days: ['sat'] },
  { name: 'Journal', area: 'Faith', cadence: 'daily', when: 'night' },
];
const log = new Map([
  ['2026-09-07', E(['Exercise', 'Read the Bible'])],
  ['2026-09-09', E(['Exercise'])],
  ['2026-09-10', E(['Read the Bible'])],
  ['2026-09-11', E(['Read the Bible'])],
]);
const data = { areas, practices, goals: [], events: [], log };
const today = '2026-09-11';

/* Exercise: 2 of 4 done, Fri..Sun = 3 days left → urgency 2/3. */
const ex = M.progress(practices[1], log, today, 1);
assert.strictEqual(ex.done, 2);
assert.strictEqual(ex.remaining, 2);
assert.strictEqual(ex.daysLeft, 3);
assert.ok(Math.abs(ex.urgency - 2 / 3) < 1e-9);
assert.strictEqual(ex.due, true);
assert.ok(Math.abs(M.progress(practices[3], log, today, 1).urgency - 1 / 3) < 1e-9);
assert.ok(Math.abs(M.progress(practices[4], log, today, 1).urgency - 1 / 20) < 1e-9);

const rb = M.progress(practices[0], log, today, 1);
assert.strictEqual(rb.doneToday, true);
assert.strictEqual(rb.due, false);
assert.strictEqual(M.progress(practices[5], log, today, 1).due, false);
assert.strictEqual(M.progress(practices[5], log, '2026-09-12', 1).due, true);

/* ---- spread: one per area first among pressing rows ----
   Due: guitar (Craft, 1.0), Journal (Faith, 1.0), Exercise (Body, .67),
   Paint (Craft, .33), Range (Craft, .05). The first pass takes the best
   pressing row of each area in urgency-then-priority order: Journal
   (Faith), guitar (Craft) — both urgency 1, Faith ranks first — then
   Exercise (Body). Range (not pressing) waits. */
const plan = M.planDay(data, today, { focusCount: 3, weekStart: 1 });
assert.deepStrictEqual(plan.focus.map(r => r.p.name), ['Journal', 'Practice guitar', 'Exercise']);
assert.deepStrictEqual(plan.later.map(r => r.p.name), ['Paint', 'Range']);
assert.deepStrictEqual(plan.done.map(r => r.p.name), ['Read the Bible']);

/* With four slots the second Craft item (Paint, pressing) joins before
   Range (not pressing). With two slots Body still gets in ahead of a
   second Faith or Craft item. */
assert.deepStrictEqual(M.planDay(data, today, { focusCount: 4, weekStart: 1 }).focus.map(r => r.p.name), ['Journal', 'Practice guitar', 'Exercise', 'Paint']);
const two = { ...data, practices: [...practices, { name: 'Pray', area: 'Faith', cadence: 'daily', when: 'morning' }] };
assert.deepStrictEqual(M.planDay(two, today, { focusCount: 3, weekStart: 1 }).focus.map(r => r.p.name), ['Pray', 'Practice guitar', 'Exercise'], 'second Faith daily (Journal) yields to Body');

/* Three Faith dailies and nothing else pressing → all three show. */
const faithOnly = { areas, practices: [practices[0], practices[6], { name: 'Pray', area: 'Faith', cadence: 'daily' }], goals: [], events: [], log: new Map() };
assert.strictEqual(M.planDay(faithOnly, today, { focusCount: 3, weekStart: 1 }).focus.length, 3);

/* ---- skip and snooze ---- */
const log2 = new Map(log);
log2.set(today, E(['Read the Bible'], ['Journal'], ['Exercise']));
const plan2 = M.planDay({ ...data, log: log2 }, today, { focusCount: 3, weekStart: 1 });
assert.deepStrictEqual(plan2.skipped.map(r => r.p.name), ['Journal'], 'skipped today is out of due');
assert.ok(!plan2.focus.some(r => r.p.name === 'Exercise'), 'snoozed weekly item leaves focus');
assert.ok(plan2.later.some(r => r.p.name === 'Exercise'), '…and waits under later');
assert.deepStrictEqual(plan2.focus.map(r => r.p.name), ['Practice guitar', 'Paint', 'Range'], 'free slots fill with quieter items');
/* Snooze is "later today" and nothing more, whatever the cadence: a weekly
   item pushed aside on Wednesday is asked for again on Thursday. Pushing
   something past today is a PLAN, which names the day. */
const log4 = new Map(log);
log4.set('2026-09-09', E(['Exercise'], [], ['Paint']));
assert.strictEqual(M.progress(practices[3], log4, '2026-09-09', 1).snoozed, true, 'quiet on the day it was pushed aside');
assert.strictEqual(M.progress(practices[3], log4, '2026-09-11', 1).snoozed, false, 'and back the next day');

/* ---- reasons ---- */
assert.strictEqual(plan.focus.find(r => r.p.name === 'Exercise').reason, '2 more this week · 3 days left');
/* Journal has never once appeared in this log (no done/skip/snooze/plan
   entry, no `created`) — with no evidence of its own history it starts
   today, not on the log's overall first date (that belonged to other
   practices). See the dedicated M3 block below for the borrowed-history
   regression this guards. */
assert.strictEqual(plan.focus.find(r => r.p.name === 'Journal').reason, 'Every day', 'no history of its own → not a borrowed "Missed 4 days"');
assert.strictEqual(M.reasonFor(practices[5], M.progress(practices[5], log, '2026-09-12', 1), log, '2026-09-12'), 'Saturdays');
const lastChance = M.progress(practices[3], log, '2026-09-13', 1);
assert.strictEqual(M.reasonFor(practices[3], lastChance, log, '2026-09-13'), 'Last chance this week');
assert.strictEqual(M.reasonFor(practices[0], rb, log, today), 'Done');

/* ---- grouping by time of day ---- */
const groups = M.groupByWhen(plan.focus);
assert.deepStrictEqual(groups.map(g => g.label), ['Evening', 'Before bed']);
assert.deepStrictEqual(groups[0].rows.map(r => r.p.name), ['Practice guitar', 'Exercise']);

/* ---- summaries ---- */
const ws = M.weekSummary(data, today, 1);
const wsEx = ws.find(r => r.p.name === 'Exercise');
assert.strictEqual(wsEx.done, 2); assert.strictEqual(wsEx.target, 4);
assert.deepStrictEqual(wsEx.ticks, [true, false, true, false, false, false, false]);
assert.strictEqual(ws.find(r => r.p.name === 'Range').target, null);
const ms = M.monthSummary(data, today, 1);
assert.strictEqual(ms.find(r => r.p.name === 'Exercise').target, 16);
assert.strictEqual(ms.find(r => r.p.name === 'Sabbath walk').target, 4);

const rev = M.weekReview(data, today, 1);
assert.strictEqual(rev.asked, 7 + 4 + 7 + 1 + 1 + 7, 'three dailies ×7, Exercise 4, Paint 1, Sabbath 1');
assert.strictEqual(rev.done, 3 + 2);
assert.strictEqual(rev.slipped[0].done, 0);

/* ---- streaks ---- */
assert.strictEqual(M.streak(log, today), 3);
assert.strictEqual(M.streak(log, '2026-09-08'), 0);
assert.strictEqual(M.streakLabel(data, today, { streakMode: 'days' }), '3 days in a row');
assert.strictEqual(M.streakLabel(data, today, { streakMode: 'off' }), '');
const goodLog = new Map();
for (const d of ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) {
  goodLog.set(d, E(['Read the Bible', 'Practice guitar', 'Journal', 'Exercise', 'Paint', 'Sabbath walk']));
}
assert.strictEqual(M.weekStreak({ ...data, log: goodLog }, today, 1), 2);
assert.strictEqual(M.weekStreak(data, today, 1), 0);
assert.strictEqual(M.streakLabel({ ...data, log: goodLog }, today, { streakMode: 'weeks', weekStart: 1 }), '2 good weeks in a row');

/* ---- goals and events ---- */
const goals = [
  { name: 'Later', horizon: '2027-06', status: 'active', next: 'x' },
  { name: 'Soon', horizon: '2026-11', status: 'active', next: 'Pick a weekend' },
  { name: 'Done', horizon: '2026-09', status: 'done', next: 'y' },
  { name: 'No step', horizon: '2026-10', status: 'active', next: '' },
];
assert.deepStrictEqual(M.sortGoals(goals).map(g => g.name), ['No step', 'Soon', 'Later']);
assert.strictEqual(M.nextGoal(goals).name, 'Soon');
assert.deepStrictEqual(M.goalsWithoutStep(goals).map(g => g.name), ['No step']);
assert.deepStrictEqual(M.goalsForMonth(goals, '2026-11-03').map(g => g.name), ['No step', 'Soon']);
const events = [
  { name: 'Hike', date: '2026-09-19' }, { name: 'Past', date: '2026-09-01' }, { name: 'Far', date: '2026-10-20' }, { name: 'Undated', date: '' },
];
assert.deepStrictEqual(M.upcoming(events, today, 8).map(e => e.name), ['Hike']);
assert.deepStrictEqual(M.eventsInMonth(events, today).map(e => e.name), ['Past', 'Hike']);

/* ---- when was this last actually done ---- */
assert.strictEqual(M.lastDone(log, 'Read the Bible', today), 0, 'ticked today');
assert.strictEqual(M.lastDone(log, 'Exercise', today), 2, 'Wednesday, two days back');
assert.strictEqual(M.lastDone(log, 'Paint', today), null, 'never, inside the window');
assert.strictEqual(M.sinceLabel(0), 'done today');
assert.strictEqual(M.sinceLabel(1), 'done yesterday');
assert.strictEqual(M.sinceLabel(5), '5 days ago');
assert.strictEqual(M.sinceLabel(21), '3 weeks ago');
assert.strictEqual(M.sinceLabel(75), '3 months ago');
assert.strictEqual(M.sinceLabel(null), 'not in 90 days');

/* ---- a clock time orders things inside a part of the day ---- */
const timed = {
  areas: [{ name: 'Body', order: 1 }],
  practices: [
    { name: 'Stretch', area: 'Body', cadence: 'daily', when: 'morning', time: '07:00' },
    { name: 'CrossFit', area: 'Body', cadence: 'daily', when: 'morning', time: '05:30' },
    { name: 'Walk', area: 'Body', cadence: 'daily', when: 'morning' },
  ],
  goals: [], events: [], log: new Map(),
};
assert.deepStrictEqual(
  M.planDay(timed, today, { focusCount: 3, weekStart: 1 }).focus.map(r => r.p.name),
  ['CrossFit', 'Stretch', 'Walk'],
  'earliest first, and anything untimed comes after everything timed');

/* ---- M3: a brand-new practice must not borrow another practice's history ---- */
{
  const freshLog = new Map();
  for (let i = 1; i <= 60; i++) freshLog.set(D.addDays('2026-09-11', -i), E(['Read the Bible']));
  const stretch = { name: 'Stretch', area: 'Body', cadence: 'daily' };
  assert.strictEqual(M.missedRun(stretch, freshLog, '2026-09-11'), 0, 'no tick and no created → starts today, not "Missed 7 days"');
  const pr = M.progress(stretch, freshLog, '2026-09-11', 1);
  assert.strictEqual(M.reasonFor(stretch, pr, freshLog, '2026-09-11'), 'Every day', 'the normal cadence text, per the promise at model.js:153');
  /* With a `created` date it counts back to THAT, not to today and not to
     some other practice's 60-day log. */
  const created = { name: 'Stretch', area: 'Body', cadence: 'daily', created: '2026-09-08' };
  assert.strictEqual(M.missedRun(created, freshLog, '2026-09-11'), 3, 'missed the 8th, 9th and 10th — created on the 8th');
}

/* ---- M2: a practice added today must not rewrite past weeks' verdict ---- */
{
  const faithAreas = [{ name: 'Faith', order: 1 }];
  const base = [{ name: 'Read', area: 'Faith', cadence: 'daily' }];
  const weekLog = new Map();
  for (let i = 0; i < 35; i++) weekLog.set(D.addDays('2026-09-11', -i), E(['Read']));
  const before = M.weekStreak({ areas: faithAreas, practices: base, log: weekLog }, '2026-09-11', 1);
  const withNew = [...base, { name: 'Stretch', area: 'Faith', cadence: 'daily' }, { name: 'Journal', area: 'Faith', cadence: 'daily' }];
  const after = M.weekStreak({ areas: faithAreas, practices: withNew, log: weekLog }, '2026-09-11', 1);
  assert.strictEqual(before, 5, '35 perfect days = 5 good weeks');
  assert.strictEqual(after, before, 'two new daily practices with no history yet must not zero out the streak');
}

/* ---- day streak: an unticked "today" shows the run through yesterday ---- */
{
  const dayLog = new Map();
  for (let i = 1; i <= 10; i++) dayLog.set(D.addDays('2026-09-11', -i), E(['Read']));
  dayLog.set('2026-09-11', E([]));
  assert.strictEqual(M.streakLabel({ log: dayLog }, '2026-09-11', {}), '10 days in a row', 'nothing ticked yet today still reads as the 10-day run through yesterday');
  dayLog.set('2026-09-10', E([])); // yesterday itself blank now — the run really is broken
  assert.strictEqual(M.streakLabel({ log: dayLog }, '2026-09-11', {}), '', 'a whole blank PAST day does break it');
}

/* dates */
assert.strictEqual(D.weekStart('2026-09-13', 1), '2026-09-07');
assert.strictEqual(D.horizonEnd('2026-02'), '2026-02-28');
assert.strictEqual(D.relative('2026-09-15', '2026-09-11'), 'Tuesday');
console.log('model OK');
