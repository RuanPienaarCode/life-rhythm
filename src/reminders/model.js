'use strict';
/* What the board shows, and in what order.

   The buckets ARE the design. A reminder that is overdue never appears in
   the same block as one due next month, because those two things ask
   different questions of you. Everything here is pure: given the same lines
   and the same date it renders the same board. */

const T = require('./tasks');
const D = require('./dates');

const BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'someday', label: 'Someday' },
];

function bucketOf(item, today) {
  if (item.done) return 'done';
  if (!D.isISO(item.due)) return 'someday';
  const n = D.diffDays(today, item.due);
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n <= 7) return 'week';
  return 'later';
}

/* Priority, then the earlier date, then the earlier time, then the title —
   fully determined, so the list never reshuffles between two renders. */
function sortItems(items) {
  return items.slice().sort((a, b) => {
    const r = T.rank(b.priority) - T.rank(a.priority);
    if (r) return r;
    const ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    const at = a.time || '99:99', bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.title).localeCompare(String(b.title));
  });
}

function board(items, today) {
  const out = { overdue: [], today: [], tomorrow: [], week: [], later: [], someday: [], done: [] };
  for (const i of items || []) out[bucketOf(i, today)].push(i);
  for (const k of Object.keys(out)) out[k] = sortItems(out[k]);
  /* Done is the one list read newest-first: it is a record, not a queue. */
  out.done.sort((a, b) => String(b.doneDate || '').localeCompare(String(a.doneDate || '')));
  out.counts = {
    overdue: out.overdue.length,
    today: out.today.length,
    due: out.overdue.length + out.today.length,
    open: (items || []).filter(i => !i.done).length,
    done: out.done.length,
    total: (items || []).length,
  };
  return out;
}

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function filterItems(items, f) {
  const o = f || {};
  const q = norm(o.query);
  return (items || []).filter(i => {
    if (o.group && i.group !== o.group) return false;
    if (o.tag && (i.tags || []).indexOf(o.tag) === -1) return false;
    if (q && norm(i.title + ' ' + (i.tags || []).join(' ') + ' ' + i.group).indexOf(q) === -1) return false;
    return true;
  });
}

function overdueDays(item, today) {
  if (!item || item.done || !D.isISO(item.due)) return 0;
  const n = D.diffDays(item.due, today);
  return n > 0 ? n : 0;
}

/* The single most pressing thing, for the line under the greeting. */
function nextUp(items, today) {
  const b = board(items, today);
  for (const { key } of BUCKETS) if (b[key].length) return b[key][0];
  return null;
}

function summary(b) {
  if (!b.counts.total) return 'Nothing on the list';
  const parts = [];
  if (b.counts.overdue) parts.push(`${b.counts.overdue} overdue`);
  if (b.counts.today) parts.push(`${b.counts.today} today`);
  if (parts.length) return parts.join(' · ');
  if (b.counts.open) return `Nothing due today · ${b.counts.open} ahead`;
  return 'All clear';
}

/* Every tag in use, most-used first, for the filter chips. */
function tagsOf(items) {
  const n = new Map();
  for (const i of items || []) for (const t of i.tags || []) n.set(t, (n.get(t) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0]);
}

/* Counts beside each view, from one board — the sidebar and the chips must
   never disagree. */
function viewCounts(b) {
  return {
    all: b.counts.open,
    overdue: b.counts.overdue,
    today: b.counts.due,
    week: b.counts.due + b.tomorrow.length + b.week.length,
    someday: b.someday.length,
    done: b.counts.done,
  };
}

/* Each list with its open reminders, in note order; a list with none still
   shows, because the user made it. */
function listCounts(items, lists) {
  const open = new Map();
  for (const i of items || []) if (!i.done && i.group) open.set(i.group, (open.get(i.group) || 0) + 1);
  const names = (lists || []).slice();
  for (const g of open.keys()) if (names.indexOf(g) === -1) names.push(g);
  return names.map(name => ({ name, open: open.get(name) || 0 }));
}

module.exports = { board, viewCounts, listCounts, bucketOf, sortItems, filterItems, overdueDays, nextUp, summary, tagsOf, BUCKETS };
