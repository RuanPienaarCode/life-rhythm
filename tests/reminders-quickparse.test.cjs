'use strict';
/* The quick-add bar. You type one line the way you'd say it; the date, time,
   priority, tags and repeat come out, and whatever is left is the reminder.
   Anything it does not recognise stays in the title — it must never eat a
   word it did not understand. */
const assert = require('node:assert');
const Q = require('../src/reminders/quickparse');
const T = '2026-09-13'; // a Sunday

const p = (s, today) => Q.parseQuick(s, today || T);

assert.deepStrictEqual(p('Buy milk'), { title: 'Buy milk', due: '', time: '', priority: 'normal', repeat: '', tags: [] });

assert.strictEqual(p('Sign papers tomorrow').due, '2026-09-14');
assert.strictEqual(p('Sign papers tomorrow').title, 'Sign papers');
assert.strictEqual(p('Call the doctor today').due, T);
assert.strictEqual(p('Ring mom tonight').due, T);
assert.strictEqual(p('Ring mom tonight').time, '20:00');
assert.strictEqual(p('Pay rates next week').due, '2026-09-20');
assert.strictEqual(p('Renew licence next month').due, '2026-10-13');
assert.strictEqual(p('Book service in 3 days').due, '2026-09-16');
assert.strictEqual(p('Book service in 2 weeks').due, '2026-09-27');
assert.strictEqual(p('Check on monday').due, '2026-09-14', 'the next Monday, not today');
assert.strictEqual(p('Check on monday').title, 'Check');
assert.strictEqual(p('Collect the parcel on friday').due, '2026-09-18');
assert.strictEqual(p('Submit 2026-10-01').due, '2026-10-01');
assert.strictEqual(p('Submit on 25 Sep').due, '2026-09-25');
assert.strictEqual(p('Submit on Sep 25').due, '2026-09-25');
assert.strictEqual(p('Submit on 4 Jan').due, '2027-01-04', 'a date already past rolls into next year');

assert.strictEqual(p('Meet Sam tomorrow at 9am').time, '09:00');
assert.strictEqual(p('Meet Sam tomorrow at 9am').title, 'Meet Sam');
assert.strictEqual(p('Meet Sam tomorrow 9:30am').time, '09:30');
assert.strictEqual(p('Meet Sam tomorrow 5pm').time, '17:00');
assert.strictEqual(p('Meet Sam tomorrow 12pm').time, '12:00');
assert.strictEqual(p('Meet Sam tomorrow 12am').time, '00:00');
assert.strictEqual(p('Standup 09:15 tomorrow').time, '09:15');
assert.strictEqual(p('Read chapter 9 of the book').time, '', 'a bare number is not a time');
assert.strictEqual(p('Read chapter 9 of the book').title, 'Read chapter 9 of the book');

assert.strictEqual(p('Fix the roof !high').priority, 'high');
assert.strictEqual(p('Fix the roof !high').title, 'Fix the roof');
assert.strictEqual(p('Fix the roof !!').priority, 'high');
assert.strictEqual(p('Fix the roof !!!').priority, 'highest');
assert.strictEqual(p('Fix the roof !urgent').priority, 'highest');
assert.strictEqual(p('Fix the roof !low').priority, 'low');

assert.deepStrictEqual(p('Sign papers #family #health').tags, ['#family', '#health']);
assert.strictEqual(p('Sign papers #family').title, 'Sign papers');

assert.strictEqual(p('Water the plants every week').repeat, 'every week');
assert.strictEqual(p('Water the plants every week').title, 'Water the plants');
assert.strictEqual(p('Check the post every monday').repeat, 'every monday');
assert.strictEqual(p('Check the post every monday').due, '2026-09-14', 'a repeat also sets the first date');
assert.strictEqual(p('Pay the bond every month when done').repeat, 'every month when done');

/* The whole thing at once, the way it would really be typed. */
const all = p("Sign the school's permission slip tomorrow at 9am !high #family every month");
assert.strictEqual(all.title, "Sign the school's permission slip");
assert.strictEqual(all.due, '2026-09-14');
assert.strictEqual(all.time, '09:00');
assert.strictEqual(all.priority, 'high');
assert.deepStrictEqual(all.tags, ['#family']);
assert.strictEqual(all.repeat, 'every month');

/* Words that merely look like keywords are left alone. */
assert.strictEqual(p('Plan the day').title, 'Plan the day');
assert.strictEqual(p('Read about the Monday Club').title, 'Read about the Monday Club', 'a capitalised weekday inside a name is not a date');
assert.strictEqual(p('').title, '');
assert.strictEqual(p('   ').title, '');
/* ---- words that start like months are not months (audit, 27 Sep 2026) ---- */
const TD = '2026-09-27';
for (const text of ['Buy 3 decks of cards', 'Buy 2 mayonnaise', 'Get 2 novels from library', 'Buy 12 marbles', 'Buy 6 octopus toys', 'Order 4 junctions']) {
  const q = Q.parseQuick(text, TD);
  assert.strictEqual(q.due, '', `no date in "${text}"`);
  assert.strictEqual(q.title, text, `and every word kept in "${text}"`);
}
assert.deepStrictEqual([Q.parseQuick('Sale 10 aug 2028', TD).due, Q.parseQuick('Sale 10 aug 2028', TD).title], ['2028-08-10', 'Sale'], 'a year is read, not left in the title');
assert.strictEqual(Q.parseQuick('Pay on 3 September', TD).due, '2027-09-03');
assert.strictEqual(Q.parseQuick('Pay 15th of October', TD).due, '2026-10-15');
assert.strictEqual(Q.parseQuick('Meet 29 feb', TD).due, '2028-02-29', '29 Feb waits for a leap year');
assert.deepStrictEqual([Q.parseQuick('Meet 31 apr', TD).due, Q.parseQuick('Meet 31 apr', TD).title], ['', 'Meet 31 apr'], 'no such date: nothing eaten');
assert.deepStrictEqual(Q.parseQuick('Fix issue #12 today', TD).tags, [], 'an all-digit #12 is not a tag');

/* ---- audit 7 Oct 2026 (time lane) ---------------------------------------
   Every date below is hand-counted from the calendar, never from the clock.
   Wed 7 Oct 2026, Fri 9 Oct, Sat 10 Oct, Sun 11 Oct, Mon 12 Oct. */
const WED = '2026-10-07', FRI = '2026-10-09', SAT = '2026-10-10', SUN = '2026-10-11';
const q = (s, today, now) => Q.parseQuick(s, today || WED, now || '09:00');

/* T1: a repeat keeps its "on …" tail, so the title is not left holding it. */
let r1 = q('Pay rent every month on the 1st', FRI);
assert.deepStrictEqual([r1.title, r1.repeat, r1.due], ['Pay rent', 'every month on the 1st', '2026-11-01'], 'first 1st on or after 9 Oct is 1 Nov');
r1 = q('Pay rent every month on the 1st', '2026-10-01');
assert.strictEqual(r1.due, '2026-10-01', 'today counts when today is the 1st');
r1 = q('Pay levy every month on the last friday');
assert.deepStrictEqual([r1.title, r1.repeat, r1.due], ['Pay levy', 'every month on the last friday', '2026-10-30'], 'Oct 31 2026 is a Saturday, so the last Friday is the 30th');
r1 = q('Gym every week on monday, thursday');
assert.deepStrictEqual([r1.title, r1.repeat, r1.due], ['Gym', 'every week on monday, thursday', '2026-10-08'], 'Wed 7 Oct: the next of Mon/Thu is Thu 8 Oct');
r1 = q('Bins every 2 weeks on tuesday', WED);
assert.deepStrictEqual([r1.title, r1.repeat, r1.due], ['Bins', 'every 2 weeks on tuesday', '2026-10-13'], 'the first one is the next Tuesday, not two weeks on');
r1 = q('Pay rent every month on the 1st tomorrow', FRI);
assert.deepStrictEqual([r1.title, r1.repeat, r1.due], ['Pay rent', 'every month on the 1st', '2026-10-10'], 'an explicit date wins over the rule');
r1 = q('Pay rent every month on the 1st at 9am', FRI);
assert.deepStrictEqual([r1.title, r1.repeat, r1.due, r1.time], ['Pay rent', 'every month on the 1st', '2026-11-01', '09:00']);
r1 = q('Gym every week on monday and the club');
assert.deepStrictEqual([r1.title, r1.repeat], ['Gym and the club', 'every week on monday'], 'trailing words that are not part of the rule stay in the title');
r1 = q('Tidy every weekend');
assert.deepStrictEqual([r1.title, r1.repeat, r1.due], ['Tidy every weekend', '', ''], 'a rule recur does not know is left alone');

/* T2: next / this + weekday, both words consumed. */
let r2 = q('Call Sam this friday');
assert.deepStrictEqual([r2.title, r2.due], ['Call Sam', '2026-10-09']);
r2 = q('Call Sam next friday');
assert.deepStrictEqual([r2.title, r2.due], ['Call Sam', '2026-10-09'], 'from a Wednesday the next Friday is the 9th');
r2 = q('Call Sam this friday', FRI);
assert.strictEqual(r2.due, '2026-10-09', '"this friday" on a Friday is today');
r2 = q('Call Sam next friday', FRI);
assert.deepStrictEqual([r2.title, r2.due], ['Call Sam', '2026-10-16'], '"next friday" on a Friday is a week away, never today');
assert.strictEqual(q('Review this wednesday').due, WED);
assert.strictEqual(q('Review next wednesday').due, '2026-10-14');
r2 = q('Pay by next monday');
assert.deepStrictEqual([r2.title, r2.due], ['Pay', '2026-10-12'], 'the "by" goes with the date');
r2 = q('Plan this week');
assert.deepStrictEqual([r2.title, r2.due], ['Plan this week', ''], '"this week" is not a weekday');

/* T3: H:MM is a time only after "at", or with a two-digit hour. */
let r3 = q('Read John 3:16 tomorrow');
assert.deepStrictEqual([r3.title, r3.time, r3.due], ['Read John 3:16', '', '2026-10-08']);
assert.strictEqual(q('Read Psalm 23:4 today').time, '', 'a one-digit minute is never a time');
assert.strictEqual(q('Read Psalm 23:14 today').time, '23:14', 'a two-digit hour IS read as a time (documented limit: 09:15 must work)');
r3 = q('Call at 9:30 tomorrow');
assert.deepStrictEqual([r3.title, r3.time], ['Call', '09:30']);
r3 = q('Standup 09:15 tomorrow');
assert.deepStrictEqual([r3.title, r3.time], ['Standup', '09:15']);
r3 = q('Dinner 21:30 tomorrow');
assert.deepStrictEqual([r3.title, r3.time], ['Dinner', '21:30']);
r3 = q('Dinner at 7:05 tomorrow');
assert.strictEqual(r3.time, '07:05');

/* T5: "every weekday" never starts on a weekend. */
assert.strictEqual(q('Standup every weekday', SAT).due, '2026-10-12', 'Saturday starts on Monday');
assert.strictEqual(q('Standup every weekday', SUN).due, '2026-10-12', 'Sunday starts on Monday');
assert.strictEqual(q('Standup every weekday', FRI).due, FRI, 'a weekday starts today');
assert.strictEqual(q('Standup every weekday', WED).due, WED);
assert.strictEqual(q('Standup every weekday 2026-10-10', SAT).due, '2026-10-10', 'a date you typed is yours');

/* T6: at the end of the text only a FULL weekday name is a date. */
for (const text of ['Hang washing in the sun', 'Dog sat', 'Wash the Mon', 'Water the plants wed']) {
  const t6 = q(text);
  assert.deepStrictEqual([t6.due, t6.title], ['', text], `nothing eaten in "${text}"`);
}
assert.strictEqual(q('Call mum sunday').due, '2026-10-11');
assert.deepStrictEqual([q('Call mum sunday').title, q('Walk the dog on sat').due, q('Pay by fri').due, q('Pay due thu').due], ['Call mum', '2026-10-10', '2026-10-09', '2026-10-08'], 'the short forms still work after on/by/due');
assert.deepStrictEqual([q('Meet on Monkey Island').due, q('Meet on Monkey Island').title], ['', 'Meet on Monkey Island'], '"on mon" is not the start of "monkey"');

/* U3: a time with no date lands today if still ahead, else tomorrow. */
let u3 = Q.parseQuick('Meet Sam at 12pm', WED, '09:00');
assert.deepStrictEqual([u3.title, u3.time, u3.due], ['Meet Sam', '12:00', WED]);
u3 = Q.parseQuick('Meet Sam at 12pm', WED, '13:00');
assert.deepStrictEqual([u3.time, u3.due], ['12:00', '2026-10-08'], 'already past: tomorrow');
u3 = Q.parseQuick('Meet Sam at 12pm', '2026-12-31', '13:00');
assert.strictEqual(u3.due, '2027-01-01', 'tomorrow carries over the year');
u3 = Q.parseQuick('Meet Sam tomorrow at 9am', WED, '23:00');
assert.strictEqual(u3.due, '2026-10-08', 'a date you gave is never moved');
u3 = Q.parseQuick('Buy milk', WED, '23:00');
assert.strictEqual(u3.due, '', 'no time, no date: still someday');
assert.strictEqual(Q.parseQuick('Meet Sam at 12pm', WED).due !== '', true, 'the third argument is optional');
console.log('quickparse OK');
