'use strict';
/* The quick-add bar: one typed line becomes a reminder.

   "Sign the school's permission slip tomorrow at 9am !high #family"

   The governing rule is that it must never eat a word it did not understand.
   Every pattern here is deliberately narrow — a bare number is not a time, a
   capitalised weekday inside a name is not a date — because a wrong guess
   silently changes what the reminder SAYS, which is worse than not guessing. */

const D = require('./dates');
const R = require('./recur');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/* A month is its full name or its short form and nothing else — "3 decks",
   "2 mayonnaise" and "12 marbles" are things to buy, not dates. */
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const YEAR_TAIL = '(?:,?\\s+(\\d{4}))?';
const DAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
/* The full names only: where a weekday is the last word with nothing to mark
   it as a date, "sat" and "sun" are far more likely to be ordinary words. */
const FULL_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WORD_PRIORITY = { highest: 'highest', urgent: 'highest', high: 'high', med: 'medium', medium: 'medium', low: 'low', lowest: 'lowest' };

/* No lookbehind: the leading boundary is always captured and put back. */
const LEAD = '(^|\\s)';
const PREP = '(?:on|by|due|due\\s+on)\\s+';

const squash = s => String(s || '').replace(/\s+/g, ' ').trim();

function hm(h, m, ampm) {
  let hour = h % 12;
  if (String(ampm).toLowerCase() === 'pm') hour += 12;
  if (!ampm) hour = h;
  return `${String(hour).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
}

/* The next occurrence of a weekday, counting today itself. */
function nextDow(today, target) {
  return D.addDays(today, ((target - D.dow(today)) + 7) % 7);
}

/* Where a repeat with no date of its own begins: its first occurrence ON OR
   AFTER today, worked out by recur itself (the step from yesterday is the
   first date strictly after yesterday). The interval is dropped for this one
   step — "every 2 weeks on tuesday" starts at the next Tuesday, not in two
   weeks. A plain "every day / week / month" starts today, and "every monday"
   at the next Monday (today counts). */
function firstOccurrence(rule, today) {
  const r = R.parse(rule);
  if (!r) return today;
  if (r.kind === 'dayOfWeek') return nextDow(today, r.day);
  if (r.kind === 'weekday' || r.kind === 'weekOn' || r.kind === 'monthDay' || r.kind === 'monthNth') {
    return R.nextDue(rule.replace(/^every\s+\d+\s+/, 'every '), D.addDays(today, -1)) || today;
  }
  return today;
}

/* A day and a month: in the year given, or else this year if it is still
   ahead, else the next year that has it (29 Feb waits for a leap year).
   '' when there is no such date at all — 31 April is not a guess. */
function dateFromDayMonth(day, monthIdx, today, year) {
  const mk = yy => `${yy}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (year) return D.isISO(mk(year)) ? mk(year) : '';
  const y = +String(today).slice(0, 4);
  for (let yy = y; yy <= y + 8; yy++) {
    const d = mk(yy);
    if (D.isISO(d) && D.diffDays(today, d) >= 0) return d;
  }
  return '';
}

/* `now` ("HH:MM") is only needed for a time typed with no date, which has to
   land today or tomorrow depending on whether that time is still ahead. */
function parseQuick(text, today, now) {
  const day = D.isISO(today) ? today : D.todayISO();
  const clock = D.isTime(now) ? now : D.nowHM();
  let s = ' ' + String(text || '') + ' ';
  const out = { title: '', due: '', time: '', priority: 'normal', repeat: '', tags: [] };

  const cut = (re, fn) => {
    let hit = false;
    s = s.replace(re, function () {
      if (hit) return arguments[0];
      const keep = fn.apply(null, arguments);
      if (keep === false) return arguments[0];
      hit = true;
      return arguments[1];
    });
    return hit;
  };

  /* tags first — they can sit anywhere */
  s = s.replace(/(^|\s)(#[^\s#]*[^\s#\d][^\s#]*)/g, (all, pre, tag) => { out.tags.push(tag); return pre; });

  /* repeats before dates, or "every monday" loses its weekday to the date
     matcher and comes back as a one-off. A rule can carry an "on …" tail
     ("every month on the 1st", "every week on monday, thursday"), so try the
     longest run of words after "every" that recur understands and shrink one
     word at a time: whatever is left over — "tomorrow", "at 9am", more of the
     title — stays where it was. */
  const everyRe = new RegExp(LEAD + '(every)(?=\\s)', 'gi');
  let em;
  while ((em = everyRe.exec(s))) {
    const start = em.index + em[1].length;
    const ends = [];
    const wordRe = /\S+/g;
    wordRe.lastIndex = start;
    let w;
    while (ends.length < 12 && (w = wordRe.exec(s))) ends.push(wordRe.lastIndex);
    let taken = 0;
    for (let k = ends.length; k >= 2; k--) {
      const rule = s.slice(start, ends[k - 1]);
      /* recur tolerates a dangling comma or "and" in a day list, but a rule
         never ENDS on one — that word belongs to the sentence, so leave it */
      if (/,$|\band$/i.test(rule)) continue;
      if (R.parse(rule)) { taken = k; break; }
    }
    if (!taken) continue;
    out.repeat = squash(s.slice(start, ends[taken - 1])).toLowerCase();
    s = s.slice(0, start) + s.slice(ends[taken - 1]);
    break;
  }

  /* priority */
  cut(new RegExp(LEAD + '!(' + Object.keys(WORD_PRIORITY).join('|') + ')\\b', 'i'), (all, pre, word) => {
    out.priority = WORD_PRIORITY[word.toLowerCase()];
  });
  cut(new RegExp(LEAD + '(!{1,3})(?=\\s|$)'), (all, pre, bangs) => {
    out.priority = bangs.length >= 3 ? 'highest' : bangs.length === 2 ? 'high' : 'medium';
  });

  /* time — only am/pm or an explicit HH:MM. "chapter 9" is not 9 o'clock. */
  cut(new RegExp(LEAD + '(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b', 'i'), (all, pre, h, m, ap) => {
    const hh = +h;
    if (hh > 12) return false;
    out.time = hm(hh % 12 === 0 ? 0 : hh, m ? +m : 0, ap);
  });
  /* H:MM is a time only after "at" or with a two-digit hour (09:15, 21:30):
     "John 3:16" is a verse, not a quarter past three. */
  if (!out.time) {
    cut(new RegExp(LEAD + '(?:at\\s+([01]?\\d|2[0-3])|([01]\\d|2[0-3])):([0-5]\\d)\\b'), (all, pre, h1, h2, m) => {
      out.time = `${String(+(h1 || h2)).padStart(2, '0')}:${m}`;
    });
  }

  /* dates, narrowest first */
  cut(new RegExp(LEAD + '(?:' + PREP + ')?(\\d{4}-\\d{2}-\\d{2})\\b'), (all, pre, iso) => {
    if (!D.isISO(iso)) return false;
    out.due = iso;
  });
  if (!out.due) {
    cut(new RegExp(LEAD + '(?:' + PREP + ')?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MONTH_WORD + YEAR_TAIL + '(?=\\s|$)', 'i'), (all, pre, d, mon, yr) => {
      const iso = dateFromDayMonth(+d, MONTHS.indexOf(mon.toLowerCase().slice(0, 3)), day, yr ? +yr : 0);
      if (!iso) return false;
      out.due = iso;
    });
  }
  if (!out.due) {
    cut(new RegExp(LEAD + '(?:' + PREP + ')?' + MONTH_WORD + '\\s+(\\d{1,2})(?:st|nd|rd|th)?' + YEAR_TAIL + '(?=\\s|$)', 'i'), (all, pre, mon, d, yr) => {
      const iso = dateFromDayMonth(+d, MONTHS.indexOf(mon.toLowerCase().slice(0, 3)), day, yr ? +yr : 0);
      if (!iso) return false;
      out.due = iso;
    });
  }
  if (!out.due) {
    cut(new RegExp(LEAD + 'tomorrow\\b', 'i'), () => { out.due = D.addDays(day, 1); });
  }
  if (!out.due) {
    cut(new RegExp(LEAD + 'tonight\\b', 'i'), () => { out.due = day; if (!out.time) out.time = '20:00'; });
  }
  if (!out.due) {
    cut(new RegExp(LEAD + 'today\\b', 'i'), () => { out.due = day; });
  }
  if (!out.due) {
    cut(new RegExp(LEAD + 'next\\s+week\\b', 'i'), () => { out.due = D.addDays(day, 7); });
  }
  if (!out.due) {
    cut(new RegExp(LEAD + 'next\\s+month\\b', 'i'), () => { out.due = D.addMonths(day, 1); });
  }
  if (!out.due) {
    cut(new RegExp(LEAD + 'in\\s+(\\d{1,3})\\s+(day|days|week|weeks|month|months)\\b', 'i'), (all, pre, n, unit) => {
      const u = unit.toLowerCase();
      out.due = u.indexOf('day') === 0 ? D.addDays(day, +n) : u.indexOf('week') === 0 ? D.addDays(day, 7 * +n) : D.addMonths(day, +n);
    });
  }
  if (!out.due) {
    /* "this friday" is the next Friday counting today; "next friday" is the
       next one strictly after today. Both words belong to the date. */
    cut(new RegExp(LEAD + '(?:' + PREP + ')?(next|this)\\s+(' + FULL_DAYS.join('|') + ')\\b', 'i'), (all, pre, which, name) => {
      const from = which.toLowerCase() === 'next' ? D.addDays(day, 1) : day;
      out.due = nextDow(from, DAYS[name.toLowerCase()]);
    });
  }
  if (!out.due) {
    /* A weekday only counts where it is being used as one: after "on" (short
       forms fine), or as the last word (full name only — "Dog sat" and "Hang
       washing in the sun" are not appointments). "the Monday Club" is a name. */
    cut(new RegExp(LEAD + '(?:' + PREP + '(' + Object.keys(DAYS).join('|') + ')\\b|(' + FULL_DAYS.join('|') + ')\\s*$)', 'i'), (all, pre, a, b) => {
      const name = String(a || b).toLowerCase();
      out.due = nextDow(day, DAYS[name]);
    });
  }

  /* A repeat with no date of its own starts at its first occurrence. */
  if (!out.due && out.repeat) out.due = firstOccurrence(out.repeat, day);

  /* A time with no date would be a reminder in Someday that never alerts:
     give it today if that time is still ahead, else tomorrow. */
  if (!out.due && out.time) out.due = out.time > clock ? day : D.addDays(day, 1);

  out.title = squash(s).replace(/\s+(at|on|by|due)$/i, '').trim();
  return out;
}

module.exports = { parseQuick };
