'use strict';
/* The decisions behind "Another day", kept free of Obsidian so a bare-node
   test can pin them. The menu itself lives in widgets.js. */

const D = require('./dates');
const M = require('./model');

/* The days a practice may be pushed to: only inside its current week or
   month (a plan quiets a practice for that period and no longer), and
   never for a daily. [] means the menu should not offer the item at all. */
function dayOptions(p, from, weekStart) {
  return M.planWindow(p, from, weekStart).map(d => ({ date: d, label: `${D.relative(d, from)} · ${D.fmtShort(d)}` }));
}

/* "Another day" MOVES the practice: if it is promised to the day being
   viewed, that promise is what leaves. Nothing to clear when it was only
   due, so no write (and no stray log note) on that day. */
function moveFrom(pr, date) {
  return pr && pr.planned ? date : null;
}

/* Undo a movePlan exactly. `res` is what store.movePlan resolved to:
   { prev: { from, to } } holding each date's flags before the move, or
   null for a side that was not touched. Without it (an older store) fall
   back to moving the promise back. */
async function undoMove(store, name, from, to, res) {
  const prev = res && res.prev;
  if (!prev) { await store.movePlan(name, to, from); return; }
  if (to && prev.to) await store.restoreFlags(to, name, prev.to);
  if (from && prev.from) await store.restoreFlags(from, name, prev.from);
}

module.exports = { dayOptions, moveFrom, undoMove };
