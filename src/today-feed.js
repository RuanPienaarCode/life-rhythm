'use strict';
/* The Today page's list: everything that needs doing today, in one place.

   It is built from the two rules that already exist, never a third:
     - Fortnight's board (planner/plan.js planBoard) for today's Tasks lines,
       reminders and events, what slipped from earlier days, and what was
       done today;
     - Rhythm's own day plan (model.js planDay) for the habits due today —
       the Habits page's list, focus first.
   Fortnight shows a daily practice only as a count and a promised one as a
   card; Rhythm's planDay already accounts for both, so practice cards from
   the board are left out and every habit comes from planDay, once.

   buildFeed is pure (tests drive it with fixtures); loadFeed reads through
   the planner's and Rhythm's stores. */

const { planBoard } = require('./planner/plan');
const M = require('./model');

const notPractice = c => c.source !== 'practice';

/* board: planBoard's result. data: Rhythm's loaded notes. opts: focusCount,
   weekStart. */
function buildFeed(board, data, today, opts) {
  const o = opts || {};
  const day = (board.days || []).find(d => d.date === today) || { cards: [], done: [] };
  const cards = day.cards.filter(notPractice);
  const plan = data && data.practices && data.practices.length
    ? M.planDay(data, today, { focusCount: o.focusCount, weekStart: o.weekStart })
    : { focus: [], later: [], done: [] };
  const slipped = (board.slipped || []).filter(notPractice);
  const todo = cards.filter(c => c.source !== 'event');
  const events = cards.filter(c => c.source === 'event');
  const doneToday = (board.doneToday || []).filter(notPractice);
  return {
    today,
    slipped,
    todo,
    events,
    habits: plan.focus,
    habitsLater: plan.later,
    doneToday,
    habitsDone: plan.done.length,
    /* What is still asked of today: slipped + today's to-dos + every habit
       due (focus and the rest). Events are fixed, not to-dos. */
    open: slipped.length + todo.length + plan.focus.length + plan.later.length,
    done: doneToday.length + plan.done.length,
  };
}

/* Read everything the list needs. data: Rhythm's notes as the view already
   holds them (state.data), so the habits match the Habits page exactly. */
async function loadFeed(plugin, data, today) {
  const s = plugin.settings;
  const store = plugin.rhythmStore;
  const tasks = await plugin.planner.store.load();
  const rhythm = store.hasData()
    ? Object.assign({}, data, { weekStart: s.weekStart === 0 ? 0 : 1, folder: store.root() })
    : null;
  const board = planBoard({ today, tasks, settings: plugin.planner.settings, rhythm });
  return buildFeed(board, data, today, { focusCount: s.focusCount, weekStart: s.weekStart });
}

module.exports = { buildFeed, loadFeed };
