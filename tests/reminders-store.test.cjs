'use strict';
/* Vault IO. The note belongs to the user: we edit the ONE line we mean to
   edit and leave every other byte — prose, headings, other plugins' tasks —
   exactly where it was. */
require('./reminders-_stub.cjs');
const assert = require('node:assert');
const { makeStore, liftTime, splitLines } = require('../src/reminders/store');

const START = [
  '# Reminders',
  '',
  'Things I must not forget.',
  '',
  '## Family',
  "- [ ] Sign the school's permission slip 📅 2026-09-10 ⏫ #family",
  '- [ ] Water the plants 📅 2026-09-13 🔁 every week',
  '',
  '## Admin',
  '- [ ] Renew the licence disc 📅 2026-10-01',
  ''].join('\n');

function host(text) {
  const files = new Map(text === null ? [] : [['Reminders.md', text]]);
  const plugin = {
    settings: { file: 'Reminders.md', icsFile: 'Reminders.ics', alarmMinutes: 10, allDayAlarmTime: '09:00' },
    _lastWrite: 0,
    async saveSettings() {},
    app: {
      vault: {
        getFileByPath: p => (files.has(p) ? { path: p, name: p.split('/').pop() } : null),
        getFolderByPath: p => (p === '' ? { path: '', children: [] } : null),
        read: async f => files.get(f.path),
        cachedRead: async f => files.get(f.path),
        modify: async (f, t) => { files.set(f.path, t); },
        create: async (p, t) => { files.set(p, t); return { path: p }; },
        createFolder: async () => {},
        adapter: { write: async (p, t) => { files.set(p, t); }, exists: async p => files.has(p) },
      },
    },
  };
  return { plugin, files, store: makeStore(plugin) };
}

(async () => {
  /* ---- load ---- */
  let h = host(START);
  let { items, groups } = await h.store.load();
  assert.strictEqual(items.length, 3);
  assert.deepStrictEqual(groups, ['Family', 'Admin']);
  assert.strictEqual(items[0].group, 'Family');

  /* ---- add: into an existing group, under its last task ---- */
  await h.store.add({ title: 'Book the plumber', due: '2026-09-25', group: 'Family', priority: 'high' });
  let text = h.files.get('Reminders.md');
  assert.ok(text.includes('- [ ] Book the plumber 📅 2026-09-25 ⏫'));
  assert.ok(text.indexOf('Book the plumber') > text.indexOf('Water the plants'), 'appended under its own heading');
  assert.ok(text.indexOf('Book the plumber') < text.indexOf('## Admin'), 'and not into the next one');
  assert.ok(text.startsWith('# Reminders\n\nThings I must not forget.\n'), 'the prose above is untouched');

  /* ---- add: a group that does not exist yet gets its heading ---- */
  h = host(START);
  await h.store.add({ title: 'Renew passport', due: '2027-01-04', group: 'Travel' });
  text = h.files.get('Reminders.md');
  assert.ok(/## Travel\n- \[ \] Renew passport 📅 2027-01-04/.test(text));
  assert.ok(text.indexOf('## Travel') > text.indexOf('## Admin'), 'a new heading goes at the end');

  /* ---- add: no group at all ----
     It must NOT fall under whatever heading happens to be last — a reminder
     with no group would silently join someone else's section and come back
     wearing its name. It gets an Inbox of its own instead. */
  h = host(START);
  await h.store.add({ title: 'Loose end' });
  text = h.files.get('Reminders.md');
  assert.ok(/## Inbox\n- \[ \] Loose end/.test(text), 'an ungrouped reminder lands in Inbox');
  assert.ok(text.indexOf('## Inbox') > text.indexOf('## Admin'), 'which sits at the end');
  ({ items } = await h.store.load());
  assert.strictEqual(items.find(i => i.title === 'Loose end').group, 'Inbox');
  /* and a second one joins the Inbox already there rather than making another */
  await h.store.add({ title: 'Another loose end' });
  text = h.files.get('Reminders.md');
  assert.strictEqual((text.match(/## Inbox/g) || []).length, 1);
  assert.ok(text.indexOf('Another loose end') > text.indexOf('Loose end'));

  /* A note with no headings at all stays flat — no ceremony is imposed. */
  h = host('- [ ] Just a list\n');
  await h.store.add({ title: 'Second thing' });
  assert.strictEqual(h.files.get('Reminders.md').trim(), '- [ ] Just a list\n- [ ] Second thing');

  /* ---- add: the note does not exist yet ---- */
  h = host(null);
  await h.store.add({ title: 'First ever', due: '2026-09-20' });
  assert.ok(h.files.get('Reminders.md').includes('- [ ] First ever 📅 2026-09-20'));

  /* ---- toggle: a plain reminder is ticked with today's date ---- */
  h = host(START);
  ({ items } = await h.store.load());
  let res = await h.store.toggle(items[0], '2026-09-13');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.rolled, null);
  text = h.files.get('Reminders.md');
  assert.ok(text.includes("- [x] Sign the school's permission slip 📅 2026-09-10 ⏫ #family ✅ 2026-09-13"));
  assert.strictEqual(text.split('\n').length, START.split('\n').length, 'no line added or lost');

  /* ---- toggle: a repeating reminder leaves the next one behind ---- */
  h = host(START);
  ({ items } = await h.store.load());
  res = await h.store.toggle(items[1], '2026-09-13');
  assert.strictEqual(res.rolled.due, '2026-09-20');
  text = h.files.get('Reminders.md');
  const l = text.split('\n');
  assert.strictEqual(l[6], '- [ ] Water the plants 📅 2026-09-20 🔁 every week', 'the next instance sits where the old one was');
  assert.strictEqual(l[7], '- [x] Water the plants 📅 2026-09-13 🔁 every week ✅ 2026-09-13', 'the tick stays as a record');

  /* ---- toggle back ---- */
  h = host(START.replace('- [ ] Renew the licence disc 📅 2026-10-01', '- [x] Renew the licence disc 📅 2026-10-01 ✅ 2026-09-12'));
  ({ items } = await h.store.load());
  await h.store.toggle(items.find(i => i.done), '2026-09-13');
  assert.ok(h.files.get('Reminders.md').includes('- [ ] Renew the licence disc 📅 2026-10-01'));
  assert.ok(!h.files.get('Reminders.md').includes('✅'), 'un-ticking clears the completion date');

  /* ---- the line moved under us ---- */
  h = host(START);
  ({ items } = await h.store.load());
  h.files.set('Reminders.md', '- [ ] A new line at the top\n' + START);
  res = await h.store.toggle(items[0], '2026-09-13');
  assert.strictEqual(res.ok, true, 'found by its content, not its line number');
  assert.ok(h.files.get('Reminders.md').includes("- [x] Sign the school's permission slip"));

  /* ---- the line is gone ---- */
  h = host(START);
  ({ items } = await h.store.load());
  h.files.set('Reminders.md', '# Reminders\n');
  res = await h.store.toggle(items[0], '2026-09-13');
  assert.strictEqual(res.ok, false, 'a vanished line is reported, never re-created');
  assert.strictEqual(h.files.get('Reminders.md'), '# Reminders\n', 'and nothing is written');

  /* ---- update ---- */
  h = host(START);
  ({ items } = await h.store.load());
  await h.store.update(items[0], { due: '2026-09-30', priority: 'highest', title: 'Sign the school permission slip' });
  text = h.files.get('Reminders.md');
  assert.ok(text.includes('- [ ] Sign the school permission slip #family 📅 2026-09-30 🔺'));
  assert.strictEqual(text.split('\n').length, START.split('\n').length);

  /* ---- snooze ---- */
  h = host(START);
  ({ items } = await h.store.load());
  await h.store.snooze(items[0], 1, '2026-09-13');
  assert.ok(h.files.get('Reminders.md').includes('📅 2026-09-14'), 'snoozing moves the due date from TODAY, not from an overdue one');

  /* ---- remove ---- */
  h = host(START);
  ({ items } = await h.store.load());
  await h.store.remove(items[0]);
  text = h.files.get('Reminders.md');
  assert.ok(!text.includes('Sign papers'));
  assert.strictEqual(text.split('\n').length, START.split('\n').length - 1);
  assert.ok(text.includes('## Family'), 'the heading stays');

  /* ---- the calendar file ---- */
  h = host(START);
  const out = await h.store.exportICS('2026-09-13T08:00:00Z');
  assert.strictEqual(out.path, 'Reminders.ics');
  assert.strictEqual(out.count, 3);
  assert.ok(h.files.get('Reminders.ics').startsWith('BEGIN:VCALENDAR'));

  /* ---- a new list is a heading, added once, nothing else touched ---- */
  h = host(START);
  let r = await h.store.addList('  ## Car  stuff ');
  assert.deepStrictEqual([r.ok, r.name, r.existed], [true, 'Car stuff', false]);
  text = h.files.get('Reminders.md');
  assert.ok(text.startsWith(START.replace(/\n+$/, '')), 'every existing byte stays where it was');
  assert.ok(text.endsWith('\n\n## Car stuff\n'));
  let loaded = await h.store.load();
  assert.deepStrictEqual(loaded.lists, ['Family', 'Admin', 'Car stuff'], 'an empty list still shows');
  assert.deepStrictEqual(loaded.groups, ['Family', 'Admin'], 'groups stay the ones holding reminders');
  r = await h.store.addList('Family');
  assert.strictEqual(r.existed, true);
  assert.strictEqual(h.files.get('Reminders.md'), text, 'an existing list is not added twice');
  assert.strictEqual((await h.store.addList('   ')).ok, false);
  await h.store.add({ title: 'Check the tyres', group: 'Car stuff' });
  loaded = await h.store.load();
  assert.strictEqual(loaded.items.find(i => i.title === 'Check the tyres').group, 'Car stuff', 'a reminder lands in the new list');

  /* ---- lifting ⏰ out of the Tasks field run ---- */
  /* Tasks reads fields from the END of the line and stops at the first thing
     that isn't one, so a ⏰ after 📅 hides the due date. The fix moves only
     the ⏰ token to just before the first Tasks field — surgery, not a
     re-spelling: the rest of the line keeps its own order and spacing. */
  assert.strictEqual(liftTime('- [ ] Phone the dentist #health 📅 2026-10-01 ⏰ 09:30'),
    '- [ ] Phone the dentist #health ⏰ 09:30 📅 2026-10-01');
  assert.strictEqual(liftTime('  * [x] Timed 📅 2026-10-01 ⏰ 09:30 ✅ 2026-10-02'),
    '  * [x] Timed ⏰ 09:30 📅 2026-10-01 ✅ 2026-10-02', 'done lines too, indent and marker kept');
  assert.strictEqual(liftTime('- [ ] Call ⏫ 📅 2026-10-01 ⏰ 9:30 ^abc123'),
    '- [ ] Call ⏰ 9:30 ⏫ 📅 2026-10-01 ^abc123', 'a block id stays at the end, where Obsidian needs it');
  assert.strictEqual(liftTime('- [ ] 📅 2026-10-01 ⏰ 09:30'), '- [ ] ⏰ 09:30 📅 2026-10-01', 'no title');
  for (const fine of [
    '- [ ] Timed ⏰ 09:00 📅 2026-09-20',
    '- [ ] Only a time ⏰ 09:00',
    '- [ ] No time 📅 2026-09-20',
    'Prose that mentions 📅 2026-09-20 ⏰ 09:00 is not a task',
  ]) assert.strictEqual(liftTime(fine), fine, `left alone: ${fine}`);

  const TIMED = [
    '# Reminders',
    'Prose that mentions 📅 2026-09-20 ⏰ 09:00 is not a task',
    '## Health',
    '- [ ] Phone the dentist #health 📅 2026-10-01 ⏰ 09:30',
    '- [ ] Timed ⏰ 09:00 📅 2026-09-20',
    '- [x] Pills 📅 2026-09-25  ⏰ 08:00 🔁 every day ✅ 2026-09-25',
    '- [ ] Someone else’s task 🔼 📅 2026-10-03',
    ''].join('\n');
  h = host(TIMED);
  r = await h.store.liftTimes();
  assert.strictEqual(r.changed, 2);
  assert.strictEqual(h.files.get('Reminders.md'), [
    '# Reminders',
    'Prose that mentions 📅 2026-09-20 ⏰ 09:00 is not a task',
    '## Health',
    '- [ ] Phone the dentist #health ⏰ 09:30 📅 2026-10-01',
    '- [ ] Timed ⏰ 09:00 📅 2026-09-20',
    '- [x] Pills ⏰ 08:00 📅 2026-09-25 🔁 every day ✅ 2026-09-25',
    '- [ ] Someone else’s task 🔼 📅 2026-10-03',
    ''].join('\n'));
  loaded = await h.store.load();
  const dentist = loaded.items.find(i => i.title === 'Phone the dentist');
  assert.deepStrictEqual([dentist.due, dentist.time, dentist.tags], ['2026-10-01', '09:30', ['#health']]);
  h.plugin._lastWrite = 0;
  r = await h.store.liftTimes();
  assert.strictEqual(r.changed, 0, 'a second run finds nothing');
  assert.strictEqual(h.plugin._lastWrite, 0, 'and writes nothing');
  assert.deepStrictEqual(await host(null).store.liftTimes(), { changed: 0 }, 'no note, no harm');

  /* ---- audit, 27 Sep 2026 ------------------------------------------ */

  /* A vault that behaves like the real one: reads and writes take a turn of
     the event loop, and process() is atomic. */
  function realHost(text) {
    const files = new Map([['Reminders.md', text]]);
    const tick = () => new Promise(res => setTimeout(res, 1));
    const plugin = {
      settings: { file: 'Reminders.md', icsFile: 'Reminders.ics' }, _lastWrite: 0,
      app: { vault: {
        getFileByPath: p => (files.has(p) ? { path: p } : null),
        getFolderByPath: () => ({ path: '', children: [] }),
        read: async f => { await tick(); return files.get(f.path); },
        modify: async (f, t) => { await tick(); files.set(f.path, t); },
        process: async (f, fn) => { await tick(); const t = fn(files.get(f.path)); files.set(f.path, t); return t; },
        create: async (p, t) => { files.set(p, t); return { path: p }; },
        createFolder: async () => {},
      } },
    };
    return { plugin, files, store: makeStore(plugin) };
  }

  /* two quick ticks both land */
  h = realHost('- [ ] A 📅 2026-10-01\n- [ ] B 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  await Promise.all([h.store.toggle(items[0], '2026-09-27'), h.store.toggle(items[1], '2026-09-27')]);
  assert.strictEqual(h.files.get('Reminders.md'), '- [x] A 📅 2026-10-01 ✅ 2026-09-27\n- [x] B 📅 2026-10-01 ✅ 2026-09-27\n', 'no tick is lost');

  /* an identical line in another list is not the one removed */
  h = host('## Home\n- [ ] Take pills 📅 2026-10-01\n## Work\n- [ ] Take pills 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  const work = items.find(i => i.group === 'Work');
  h.files.set('Reminders.md', 'A line typed above\n' + h.files.get('Reminders.md'));
  assert.strictEqual((await h.store.remove(work)).ok, true);
  assert.strictEqual(h.files.get('Reminders.md'), 'A line typed above\n## Home\n- [ ] Take pills 📅 2026-10-01\n## Work\n', 'Home keeps its pills');

  /* a date edited by hand while the board was open is still found — once */
  h = host('## Home\n- [ ] Call mum 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  h.files.set('Reminders.md', '## Home\n- [ ] Call mum 📅 2026-10-03\n');
  assert.strictEqual((await h.store.toggle(items[0], '2026-09-27')).ok, true);
  assert.ok(h.files.get('Reminders.md').includes('- [x] Call mum 📅 2026-10-03 ✅ 2026-09-27'));

  /* a repeat we cannot read is refused, and the note is left alone */
  const odd = '- [ ] Water ferns 📅 2026-10-01 🔁 every blue moon\n';
  h = host(odd);
  ({ items } = await h.store.load());
  r = await h.store.toggle(items[0], '2026-09-27');
  assert.deepStrictEqual([r.ok, r.reason, r.repeat], [false, 'repeat', 'every blue moon']);
  assert.strictEqual(h.files.get('Reminders.md'), odd, 'the series is not ended');

  /* a Tasks-style repeat rolls */
  h = host('- [ ] Bins 📅 2026-10-01 🔁 every week on Monday\n');
  ({ items } = await h.store.load());
  r = await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(r.rolled.due, '2026-10-05');

  /* a repeat with no due date counts from today */
  h = host('- [ ] Stretch 🔁 every day\n');
  ({ items } = await h.store.load());
  r = await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '- [ ] Stretch 🔁 every day 📅 2026-09-28\n- [x] Stretch 🔁 every day ✅ 2026-09-27\n');

  /* a roll moves 🛫 and ⏳ with the due date */
  h = host('- [ ] Bill 🛫 2026-09-25 ⏳ 2026-09-28 📅 2026-10-01 🔁 every month\n');
  ({ items } = await h.store.load());
  await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md').split('\n')[0], '- [ ] Bill 🛫 2026-10-26 ⏳ 2026-10-29 📅 2026-11-01 🔁 every month');

  /* ^block-ids stay at the end; on a roll the link follows the open one */
  h = host('- [ ] Pay rent 📅 2026-10-01 ^rent1\n');
  ({ items } = await h.store.load());
  await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '- [x] Pay rent 📅 2026-10-01 ✅ 2026-09-27 ^rent1\n');
  h = host('- [ ] Pay rent 📅 2026-10-01 🔁 every month ^rent1\n');
  ({ items } = await h.store.load());
  await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '- [ ] Pay rent 📅 2026-11-01 🔁 every month ^rent1\n- [x] Pay rent 📅 2026-10-01 🔁 every month ✅ 2026-09-27\n');

  /* snooze changes the date the board reads — the last one, outside code */
  h = host('- [ ] Check `📅 2020-01-01` format 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  await h.store.snooze(items[0], 1, '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '- [ ] Check `📅 2020-01-01` format 📅 2026-09-28\n');

  /* a CRLF note is read and stays CRLF */
  h = host('## Home\r\n- [ ] Crlf 📅 2026-10-01\r\n');
  ({ items } = await h.store.load());
  assert.strictEqual(items.length, 1);
  await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '## Home\r\n- [x] Crlf 📅 2026-10-01 ✅ 2026-09-27\r\n');

  /* changing the list in the editor moves the line */
  h = host(START);
  ({ items } = await h.store.load());
  const plants = items.find(i => i.title === 'Water the plants');
  assert.strictEqual((await h.store.update(plants, { group: 'Admin' })).moved, true);
  ({ items } = await h.store.load());
  assert.strictEqual(items.find(i => i.title === 'Water the plants').group, 'Admin');

  /* ⏰ inside a wikilink or a code span is not ours to move */
  assert.strictEqual(liftTime('- [ ] See [[Plan 📅 draft]] notes 📅 2026-10-01 ⏰ 09:00'),
    '- [ ] See [[Plan 📅 draft]] notes ⏰ 09:00 📅 2026-10-01');
  assert.strictEqual(liftTime('- [ ] Use `⏫` icon 📅 2026-10-01 ⏰ 09:00'), '- [ ] Use `⏫` icon ⏰ 09:00 📅 2026-10-01');
  assert.strictEqual(liftTime('- [ ] a 📅 2026-10-01 ⏰ 09:00\r'), '- [ ] a ⏰ 09:00 📅 2026-10-01\r');
  assert.strictEqual(liftTime('- [ ] Call 📅 2026-10-01 ⏰ 09:00 🔁 every week'), '- [ ] Call ⏰ 09:00 📅 2026-10-01 🔁 every week', 'a ⏰ in the middle of the run');

  /* ---- ⏰ stays out of the field run on every date write --------------- */
  /* Found reviewing Fortnight, which moves reminders through store.setDue:
     a 📅 added to a line that had none was appended AFTER ⏰, putting ⏰ back
     inside the run and hiding every field before it from Tasks. This reader
     is written independently of src/: it peels fields off the END of the
     line the way Tasks does and stops at the first thing that isn't one. */
  const FIELD_TAIL = /\s+((?:📅|⏳|🛫|✅|➕)\s*\d{4}-\d{2}-\d{2}|🔁\s*[a-zA-Z0-9, !]+|🔺|⏫|🔼|🔽|⏬|#[^\s#]+)$/;
  function tasksRead(line) {
    let s = line.replace(/\s+\^[A-Za-z0-9-]+$/, '');
    const fields = [];
    for (let m = FIELD_TAIL.exec(s); m; m = FIELD_TAIL.exec(s)) {
      fields.unshift(m[1].replace(/\s+/g, ' '));
      s = s.slice(0, m.index);
    }
    return fields;
  }
  assert.deepStrictEqual(tasksRead('- [ ] Pills ⏳ 2026-10-01 ⏰ 08:00 📅 2026-10-07'), ['📅 2026-10-07'],
    'the reader sees the bug: ⏰ in the run hides ⏳');

  for (const [name, line, act, want, fields] of [
    ['setDue adds 📅 to a line with ⏳ and ⏰',
      '- [ ] Pills ⏳ 2026-10-01 ⏰ 08:00', (st, it) => st.setDue(it, '2026-10-07'),
      '- [ ] Pills ⏰ 08:00 ⏳ 2026-10-01 📅 2026-10-07', ['⏳ 2026-10-01', '📅 2026-10-07']],
    ['setDue moves 📅 on a line already in order',
      '- [ ] Pills ⏰ 08:00 📅 2026-10-01 ⏳ 2026-09-30', (st, it) => st.setDue(it, '2026-10-07'),
      '- [ ] Pills ⏰ 08:00 📅 2026-10-07 ⏳ 2026-09-30', ['📅 2026-10-07', '⏳ 2026-09-30']],
    ['setDue moves 📅 on an old-order line and repairs it',
      '- [ ] Pills 📅 2026-10-01 ⏰ 08:00 ⏳ 2026-09-30', (st, it) => st.setDue(it, '2026-10-07'),
      '- [ ] Pills ⏰ 08:00 📅 2026-10-07 ⏳ 2026-09-30', ['📅 2026-10-07', '⏳ 2026-09-30']],
    ['setDue clears 📅 and keeps ⏳',
      '- [ ] Pills ⏰ 08:00 ⏳ 2026-10-01 📅 2026-10-07', (st, it) => st.setDue(it, ''),
      '- [ ] Pills ⏰ 08:00 ⏳ 2026-10-01', ['⏳ 2026-10-01']],
    ['setDue clears 📅 on a line the old bug wrote',
      '- [ ] Pills ⏳ 2026-10-01 ⏰ 08:00 📅 2026-10-07', (st, it) => st.setDue(it, null),
      '- [ ] Pills ⏰ 08:00 ⏳ 2026-10-01', ['⏳ 2026-10-01']],
    ['snooze adds 📅 the same way',
      '- [ ] Pills #meds ⏫ ⏰ 08:00 ^pills', (st, it) => st.snooze(it, 1, '2026-09-27'),
      /* #meds stays in the description, where Tasks still reads a tag */
      '- [ ] Pills #meds ⏰ 08:00 ⏫ 📅 2026-09-28 ^pills', ['⏫', '📅 2026-09-28']],
  ]) {
    h = host(`## Health\n${line}\n`);
    ({ items } = await h.store.load());
    await act(h.store, items[0]);
    const out = h.files.get('Reminders.md').split('\n')[1];
    assert.strictEqual(out, want, name);
    assert.deepStrictEqual(tasksRead(out), fields, `${name}: Tasks reads every field`);
    ({ items } = await h.store.load());
    assert.strictEqual(items[0].time, '08:00', `${name}: the board still reads the time`);
  }

  /* ticking a repeat that had no 📅: both the tick and the next one */
  h = host('## Health\n- [ ] Pills ⏳ 2026-09-27 ⏰ 08:00 🔁 every day\n');
  ({ items } = await h.store.load());
  await h.store.toggle(items[0], '2026-09-27');
  const [fresh, ticked] = h.files.get('Reminders.md').split('\n').slice(1, 3);
  assert.strictEqual(fresh, '- [ ] Pills ⏰ 08:00 ⏳ 2026-09-28 🔁 every day 📅 2026-09-28');
  assert.deepStrictEqual(tasksRead(fresh), ['⏳ 2026-09-28', '🔁 every day', '📅 2026-09-28']);
  assert.strictEqual(ticked, '- [x] Pills ⏰ 08:00 ⏳ 2026-09-27 🔁 every day ✅ 2026-09-27');
  assert.deepStrictEqual(tasksRead(ticked), ['⏳ 2026-09-27', '🔁 every day', '✅ 2026-09-27']);

  /* the calendar file goes through the vault, not the adapter */
  h = host(START);
  let adapterUsed = false;
  h.plugin.app.vault.adapter.write = async () => { adapterUsed = true; };
  await h.store.exportICS('2026-09-27T08:00:00Z');
  assert.ok(h.files.get('Reminders.ics').startsWith('BEGIN:VCALENDAR'));
  assert.strictEqual(adapterUsed, false);

  /* ---- audit, 7 Oct 2026 ------------------------------------------- */
  const noteOf = hh => hh.files.get('Reminders.md');

  /* L1: a stale tick of a repeat must not tick the freshly rolled line.
     Two quick ticks (a double click) hand the store the same old item; the
     second one's exact line is gone, and the only open line with the same
     words is the NEXT occurrence. */
  h = host('## Home\n- [ ] Water plants 📅 2026-10-01 🔁 every week\n');
  ({ items } = await h.store.load());
  const twice = await Promise.all([h.store.toggle(items[0], '2026-10-01'), h.store.toggle(items[0], '2026-10-01')]);
  assert.deepStrictEqual(twice.map(x => x.ok), [true, false], 'the second tick is refused');
  assert.strictEqual(noteOf(h), '## Home\n- [ ] Water plants 📅 2026-10-08 🔁 every week\n- [x] Water plants 📅 2026-10-01 🔁 every week ✅ 2026-10-01\n', 'the next occurrence is still open');
  /* the same for a repeat whose date was changed by hand while the board was open */
  h = host('## Home\n- [ ] Call mum 📅 2026-10-01 🔁 every week\n');
  ({ items } = await h.store.load());
  h.files.set('Reminders.md', '## Home\n- [ ] Call mum 📅 2026-10-03 🔁 every week\n');
  assert.strictEqual((await h.store.toggle(items[0], '2026-10-01')).ok, false, 'a repeat found only by its words is not ticked');
  assert.strictEqual(noteOf(h), '## Home\n- [ ] Call mum 📅 2026-10-03 🔁 every week\n');

  /* L3: a line found by its words must differ from the old one in dates only */
  h = host('## Home\n- [ ] Take pills ⏰ 08:00 📅 2026-10-01\n- [ ] Take pills ⏰ 20:00 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  h.files.set('Reminders.md', '## Home\n- [ ] Take pills ⏰ 20:00 📅 2026-10-01\n');
  assert.strictEqual((await h.store.remove(items[0])).ok, false, 'the 08:00 reminder is gone; 20:00 is not it');
  assert.strictEqual(noteOf(h), '## Home\n- [ ] Take pills ⏰ 20:00 📅 2026-10-01\n');
  for (const [was, now] of [
    ['- [ ] Call ⏫ 📅 2026-10-01', '- [ ] Call 🔽 📅 2026-10-01'],
    ['- [ ] Call #home 📅 2026-10-01', '- [ ] Call #work 📅 2026-10-01'],
    ['- [ ] Call 📅 2026-10-01', '- [ ] Call 📅 2026-10-01 🔁 every day'],
  ]) {
    h = host(`## Home\n${was}\n`);
    ({ items } = await h.store.load());
    h.files.set('Reminders.md', `## Home\n${now}\n`);
    assert.strictEqual((await h.store.snooze(items[0], 1, '2026-10-07')).ok, false, `${was} is not ${now}`);
    assert.strictEqual(noteOf(h), `## Home\n${now}\n`);
  }
  h = host('## Home\n- [ ] Call ⏫ 📅 2026-10-01 ⏳ 2026-09-30\n');
  ({ items } = await h.store.load());
  h.files.set('Reminders.md', '## Home\n- [ ] Call ⏫ 📅 2026-10-05\n');
  assert.strictEqual((await h.store.snooze(items[0], 1, '2026-10-07')).ok, true, 'dates added, moved or removed by hand: still the same reminder');
  assert.strictEqual(noteOf(h), '## Home\n- [ ] Call ⏫ 📅 2026-10-08\n');

  /* L4: a "# Title" heading is not a list, whatever it is called */
  h = host('# Home\n- [ ] x\n## Home\n- [ ] y\n');
  await h.store.add({ title: 'z', group: 'Home' });
  assert.strictEqual(noteOf(h), '# Home\n- [ ] x\n## Home\n- [ ] y\n- [ ] z\n', 'it lands under the ## list, not the title');
  h = host(null);
  await h.store.ensureFile();
  await h.store.addList('Reminders');
  await h.store.add({ title: 'Into my Reminders list', group: 'Reminders' });
  ({ items } = await h.store.load());
  assert.strictEqual(items.find(i => i.title === 'Into my Reminders list').group, 'Reminders', 'and reads back in the list it was added to');

  /* L8: the seam takes input from other plugins (Vista, Fortnight) */
  const PAY = '- [ ] Pay rent 📅 2026-10-01 ⏫\n';
  for (const bad of ['2026-10-7', '2026-10-07T00:00', 'next week', '2026-02-30', 20261007, {}]) {
    h = host(PAY);
    ({ items } = await h.store.load());
    assert.strictEqual((await h.store.setDue(items[0], bad)).ok, false, `setDue(${JSON.stringify(bad)}) is refused`);
    assert.strictEqual(noteOf(h), PAY, 'and the 📅 survives');
  }
  for (const clear of ['', null, undefined]) {
    h = host(PAY);
    ({ items } = await h.store.load());
    assert.strictEqual((await h.store.setDue(items[0], clear)).ok, true);
    assert.strictEqual(noteOf(h), '- [ ] Pay rent ⏫\n', 'empty clears the date');
  }
  for (const bad of [undefined, null, '', 0, -1, 1.5, NaN, 'x', '1.5', {}, [], true]) {
    h = host(PAY);
    ({ items } = await h.store.load());
    assert.strictEqual((await h.store.snooze(items[0], bad, '2026-10-07')).ok, false, `snooze(${String(bad)}) is refused`);
    assert.strictEqual(noteOf(h), PAY);
  }
  h = host(PAY);
  ({ items } = await h.store.load());
  assert.strictEqual((await h.store.snooze(items[0], '1', '2026-10-07')).ok, true);
  assert.strictEqual(noteOf(h), '- [ ] Pay rent 📅 2026-10-08 ⏫\n', 'a numeric string is a number of days');
  h = host(PAY);
  ({ items } = await h.store.load());
  await h.store.snooze(items[0], 3, '2026-10-07');
  assert.strictEqual(noteOf(h), '- [ ] Pay rent 📅 2026-10-10 ⏫\n');

  /* an item with no raw line, or one that is not a reminder, matches nothing */
  const KEEP = '## Home\n- [ ] Keep me 📅 2026-10-01\n';
  for (const [name, call] of [
    ['toggle', (s, it) => s.toggle(it, '2026-10-07')],
    ['update', (s, it) => s.update(it, { title: 'Ghost' })],
    ['remove', s => s.remove({ title: 'Ghost', line: 9 })],
    ['snooze', (s, it) => s.snooze(it, 1, '2026-10-07')],
    ['setDue', (s, it) => s.setDue(it, '2026-10-09')],
  ]) {
    for (const it of [{ title: 'Ghost', line: 6 }, { title: 'Ghost', line: 1 }, { raw: 42, line: 1 }, { raw: 'Some prose line', line: 1 }, null, undefined]) {
      h = host('# Reminders\nSome prose line\n' + KEEP);
      const before = noteOf(h);
      assert.strictEqual((await call(h.store, it)).ok, false, `${name}(${JSON.stringify(it)}) claims nothing`);
      assert.strictEqual(noteOf(h), before, `${name}: the note is untouched`);
    }
  }

  /* add and update cannot be made to write anything but one reminder line */
  h = host('## Home\n- [ ] A\n');
  assert.strictEqual(await h.store.add({ title: 'Buy milk', tags: ['family'], group: 'Home' }), '- [ ] Buy milk #family');
  assert.strictEqual(noteOf(h), '## Home\n- [ ] A\n- [ ] Buy milk #family\n', 'a tag without # is made one, not merged into the title');
  await h.store.add({ title: 'Evil', repeat: 'every day\n- [x] fake', group: 'Home' });
  assert.strictEqual(noteOf(h), '## Home\n- [ ] A\n- [ ] Buy milk #family\n- [ ] Evil 🔁 every day - [x] fake\n', 'no second line');
  await h.store.add({ title: 'Odd\ngroup', group: 'A\n- [ ] sneaky' });
  assert.strictEqual(noteOf(h).split('\n').slice(-4).join('|'), '|## A - [ ] sneaky|- [ ] Odd group|', 'a newline in a list name stays in its heading');
  const before0 = noteOf(h);
  assert.deepStrictEqual(await h.store.add(), { ok: false });
  assert.deepStrictEqual(await h.store.add({}), { ok: false });
  assert.deepStrictEqual(await h.store.add(null), { ok: false });
  assert.strictEqual(noteOf(h), before0, 'nothing added for no fields');
  h = host(null);
  assert.deepStrictEqual(await h.store.add(), { ok: false });
  assert.strictEqual(h.files.size, 0, 'and no note is made for it');
  h = host('## Home\n- [ ] Keep 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  await h.store.update(items[0], { title: 'Keep\n- [x] two', repeat: 'every day\nx', tags: ['t'] });
  assert.strictEqual(noteOf(h), '## Home\n- [ ] Keep - [x] two #t 📅 2026-10-01 🔁 every day x\n');

  /* L5 through the store: an explicit edit keeps a second copy as text */
  for (const [line, want] of [
    ['- [ ] Two priorities ⏫ 🔽 📅 2026-10-01', '- [ ] Two priorities ⏫ 📅 2026-10-01 🔽'],
    ['- [ ] Two dues 📅 2026-10-01 📅 2026-10-05', '- [ ] Two dues 📅 2026-10-01 📅 2026-10-05'],
    ['- [ ] Done date on open ✅ 2026-10-01 📅 2026-10-05', '- [ ] Done date on open ✅ 2026-10-01 📅 2026-10-05'],
    ['- [ ] Note %%📅 2020-01-01%% 📅 2026-10-01', '- [ ] Note %%📅 2020-01-01%% 📅 2026-10-01'],
    ['- [ ] Link [📅 cal](https://x.y) 📅 2026-10-01', '- [ ] Link [📅 cal](https://x.y) 📅 2026-10-01'],
    ['- [ ] Ship it ⛔ abc, def 📅 2026-10-01', '- [ ] Ship it 📅 2026-10-01 ⛔ abc, def'],
    ['- [ ] Pills 🔁 every day 🏁 delete 📅 2026-10-01', '- [ ] Pills 📅 2026-10-01 🔁 every day 🏁 delete'],
  ]) {
    h = host(line + '\n');
    ({ items } = await h.store.load());
    await h.store.update(items[0], {});
    assert.strictEqual(noteOf(h), want + '\n', `update loses nothing: ${line}`);
  }

  /* L7: a repeat with 🏁 can be ticked, and the next one keeps the field */
  h = host('- [ ] Pills 🔁 every day 🏁 delete 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  assert.strictEqual(items[0].repeat, 'every day');
  r = await h.store.toggle(items[0], '2026-10-01');
  assert.strictEqual(r.ok, true, 'not refused as an unreadable repeat');
  assert.strictEqual(noteOf(h), '- [ ] Pills 🔁 every day 🏁 delete 📅 2026-10-02\n- [x] Pills 🔁 every day 🏁 delete 📅 2026-10-01 ✅ 2026-10-01\n');

  /* L10: fenced code is not the note */
  const FENCE = '## Home\n- [ ] Real 📅 2026-10-01\n\n```md\n# a comment\n- [ ] example in a code block 📅 2026-01-01\n```\n- [ ] After the fence\n';
  h = host(FENCE);
  ({ items } = await h.store.load());
  assert.deepStrictEqual(items.map(i => [i.title, i.group, i.line]), [['Real', 'Home', 1], ['After the fence', 'Home', 7]]);
  /* a line typed above while the board was open: found again in ITS list,
     which a "#" inside the fence must not have reset */
  h.files.set('Reminders.md', 'typed above\n' + FENCE);
  assert.strictEqual((await h.store.toggle(items[1], '2026-10-07')).ok, true);
  assert.ok(noteOf(h).includes('- [x] After the fence ✅ 2026-10-07'));
  assert.ok(noteOf(h).includes('- [ ] example in a code block 📅 2026-01-01'), 'the example is untouched');
  /* a heading inside a fence is not a place to put a reminder */
  h = host('```\n## Work\n- [ ] example\n```\n## Home\n- [ ] Real\n');
  await h.store.add({ title: 'New', group: 'Work' });
  assert.strictEqual(noteOf(h), '```\n## Work\n- [ ] example\n```\n## Home\n- [ ] Real\n\n## Work\n- [ ] New\n');
  assert.deepStrictEqual((await h.store.load()).items.map(i => [i.title, i.group]), [['Real', 'Home'], ['New', 'Work']]);
  h = host('```\n## Work\n```\n- [ ] Loose\n');
  assert.strictEqual((await h.store.addList('Work')).existed, false, 'a heading in a fence is not a list');

  /* and the 1-pass ⏰ repair leaves a fenced example alone */
  h = host('```\n- [ ] Ex 📅 2026-10-01 ⏰ 09:30\n```\n- [ ] Real 📅 2026-10-01 ⏰ 09:30\n');
  r = await h.store.liftTimes();
  assert.strictEqual(r.changed, 1);
  assert.strictEqual(noteOf(h), '```\n- [ ] Ex 📅 2026-10-01 ⏰ 09:30\n```\n- [ ] Real ⏰ 09:30 📅 2026-10-01\n');

  /* L11: mixed line endings no longer refuse every write; the majority wins */
  h = host('## Home\n- [ ] One 📅 2026-10-01\n- [ ] Two 📅 2026-10-02\r\n- [ ] Three\n');
  ({ items } = await h.store.load());
  assert.strictEqual(items.length, 3);
  r = await h.store.toggle(items[1], '2026-10-07');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(noteOf(h), '## Home\n- [ ] One 📅 2026-10-01\n- [x] Two 📅 2026-10-02 ✅ 2026-10-07\n- [ ] Three\n');
  h = host('## Home\r\n- [ ] One 📅 2026-10-01\r\n- [ ] Two 📅 2026-10-02\n- [ ] Three\r\n');
  ({ items } = await h.store.load());
  r = await h.store.toggle(items[0], '2026-10-07');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(noteOf(h), '## Home\r\n- [x] One 📅 2026-10-01 ✅ 2026-10-07\r\n- [ ] Two 📅 2026-10-02\r\n- [ ] Three\r\n');
  assert.deepStrictEqual(splitLines('a\r\nb\r\n'), { lines: ['a', 'b', ''], eol: '\r\n' });
  assert.deepStrictEqual(splitLines('a\nb\n'), { lines: ['a', 'b', ''], eol: '\n' });
  assert.deepStrictEqual(splitLines('a\nb\r\nc\n'), { lines: ['a', 'b', 'c', ''], eol: '\n' });
  assert.deepStrictEqual(splitLines('a'), { lines: ['a'], eol: '\n' });

  /* L12: an indented reminder moved to another list is no longer a subtask */
  const NEST = '## Home\n- [ ] Parent\n  - [ ] Child 📅 2026-10-01\n## Work\n- [ ] Report\n';
  h = host(NEST);
  ({ items } = await h.store.load());
  await h.store.update(items.find(i => i.title === 'Child'), { group: 'Work' });
  assert.strictEqual(noteOf(h), '## Home\n- [ ] Parent\n## Work\n- [ ] Report\n- [ ] Child 📅 2026-10-01\n', 'it joins the new list at the top level');
  h = host(NEST);
  ({ items } = await h.store.load());
  await h.store.update(items.find(i => i.title === 'Child'), { title: 'Kid' });
  assert.strictEqual(noteOf(h), '## Home\n- [ ] Parent\n  - [ ] Kid 📅 2026-10-01\n## Work\n- [ ] Report\n', 'an edit that stays put keeps its indent');

  /* S5: a list name is not case-sensitive */
  h = host(START);
  const startText = noteOf(h);
  for (const n of ['family', 'FAMILY', '  fAmIlY ', '## family']) {
    r = await h.store.addList(n);
    assert.deepStrictEqual([r.ok, r.name, r.existed], [true, 'Family', true], `addList(${JSON.stringify(n)}) finds Family`);
    assert.strictEqual(noteOf(h), startText, 'and adds no second heading');
  }
  /* the same goes for a reminder added to a list typed in another case —
     unless the note really has both spellings, when the exact one wins */
  h = host('## Groceries\n- [ ] Milk\n');
  await h.store.add({ title: 'Bread', group: 'groceries' });
  assert.strictEqual(noteOf(h), '## Groceries\n- [ ] Milk\n- [ ] Bread\n');
  h = host('## Groceries\n- [ ] Milk\n\n## groceries\n- [ ] Eggs\n');
  await h.store.add({ title: 'Bread', group: 'groceries' });
  assert.strictEqual(noteOf(h), '## Groceries\n- [ ] Milk\n\n## groceries\n- [ ] Eggs\n- [ ] Bread\n');

  /* ---- setDate: ⏳ and 🛫 through the seam --------------------------- */
  /* Found by the Fortnight audit, 7 Oct 2026. Fortnight moves reminders only
     through this store, and setDue was the one date it could write: a
     reminder whose only date is ⏳ or 🛫 could not be moved, and before
     Fortnight refused, setDue on "⏳ 2026-10-07" wrote "⏳ 2026-10-07 📅
     2026-10-09" — a deadline nobody set, with ⏳ left on the old day.
     setDate moves the one field it is asked to move. Each case: the line,
     the call, the line written, what the Tasks reader above finds on it
     (null: a marker that reader does not know), and what Nudge reads back
     as [due, scheduled, start, time]. */
  for (const [name, line, act, want, fields, back] of [
    ['a ⏳-only line: ⏳ moves and no 📅 appears',
      '- [ ] Call bank ⏳ 2026-10-07', (st, it) => st.setDate(it, 'scheduled', '2026-10-09'),
      '- [ ] Call bank ⏳ 2026-10-09', ['⏳ 2026-10-09'], ['', '2026-10-09', '', '']],
    ['⌛ is ⏳ too, and keeps the marker the user typed',
      '- [ ] Call bank ⌛ 2026-10-07', (st, it) => st.setDate(it, 'scheduled', '2026-10-09'),
      '- [ ] Call bank ⌛ 2026-10-09', null, ['', '2026-10-09', '', '']],
    ['🛫 moves and 📅 stays',
      '- [ ] Pack for the trip 🛫 2026-10-07 📅 2026-10-10', (st, it) => st.setDate(it, 'start', '2026-10-08'),
      '- [ ] Pack for the trip 🛫 2026-10-08 📅 2026-10-10', ['🛫 2026-10-08', '📅 2026-10-10'], ['2026-10-10', '', '2026-10-08', '']],
    ['a 🛫 the line did not have goes at the end',
      '- [ ] Pack for the trip 📅 2026-10-10 ⏫', (st, it) => st.setDate(it, 'start', '2026-10-08'),
      '- [ ] Pack for the trip 📅 2026-10-10 ⏫ 🛫 2026-10-08', ['📅 2026-10-10', '⏫', '🛫 2026-10-08'], ['2026-10-10', '', '2026-10-08', '']],
    ['due through setDate moves 📅 and leaves ⏳',
      '- [ ] Call bank ⏳ 2026-10-07 📅 2026-10-08', (st, it) => st.setDate(it, 'due', '2026-10-09'),
      '- [ ] Call bank ⏳ 2026-10-07 📅 2026-10-09', ['⏳ 2026-10-07', '📅 2026-10-09'], ['2026-10-09', '2026-10-07', '', '']],
    ['clearing ⏳ (null) leaves 📅',
      '- [ ] Call bank ⏳ 2026-10-07 📅 2026-10-10', (st, it) => st.setDate(it, 'scheduled', null),
      '- [ ] Call bank 📅 2026-10-10', ['📅 2026-10-10'], ['2026-10-10', '', '', '']],
    ['clearing 🛫 (empty string) leaves 📅 and 🔁',
      '- [ ] Pack for the trip 🛫 2026-10-07 📅 2026-10-10 🔁 every month', (st, it) => st.setDate(it, 'start', ''),
      '- [ ] Pack for the trip 📅 2026-10-10 🔁 every month', ['📅 2026-10-10', '🔁 every month'], ['2026-10-10', '', '', '']],
    ['clearing (undefined) a field the line does not have changes nothing',
      '- [ ] Call bank 📅 2026-10-10', (st, it) => st.setDate(it, 'start', undefined),
      '- [ ] Call bank 📅 2026-10-10', ['📅 2026-10-10'], ['2026-10-10', '', '', '']],
    ['⏳ moved on a timed line: ⏰ stays in front',
      '- [ ] Call bank ⏰ 09:00 ⏳ 2026-10-07', (st, it) => st.setDate(it, 'scheduled', '2026-10-09'),
      '- [ ] Call bank ⏰ 09:00 ⏳ 2026-10-09', ['⏳ 2026-10-09'], ['', '2026-10-09', '', '09:00']],
    ['⏳ added to a timed line lands after the tag, ⏰ still in front',
      '- [ ] Call bank ⏰ 09:00 #admin', (st, it) => st.setDate(it, 'scheduled', '2026-10-09'),
      '- [ ] Call bank ⏰ 09:00 #admin ⏳ 2026-10-09', ['#admin', '⏳ 2026-10-09'], ['', '2026-10-09', '', '09:00']],
    ['🛫 moved on an old-order line: ⏰ comes out of the run',
      '- [ ] Pills 🛫 2026-10-01 ⏰ 08:00 📅 2026-10-07', (st, it) => st.setDate(it, 'start', '2026-10-02'),
      '- [ ] Pills ⏰ 08:00 🛫 2026-10-02 📅 2026-10-07', ['🛫 2026-10-02', '📅 2026-10-07'], ['2026-10-07', '', '2026-10-02', '08:00']],
    ['⏳ cleared on a timed line',
      '- [ ] Pills ⏰ 08:00 ⏳ 2026-10-01 📅 2026-10-07', (st, it) => st.setDate(it, 'scheduled', null),
      '- [ ] Pills ⏰ 08:00 📅 2026-10-07', ['📅 2026-10-07'], ['2026-10-07', '', '', '08:00']],
    ['🛫 moved with a ^block-id: the id stays last',
      '- [ ] Pack ⏰ 07:00 #trip 🛫 2026-10-07 ^pack', (st, it) => st.setDate(it, 'start', '2026-10-08'),
      '- [ ] Pack ⏰ 07:00 #trip 🛫 2026-10-08 ^pack', ['#trip', '🛫 2026-10-08'], ['', '', '2026-10-08', '07:00']],
    ['🛫 added with a ^block-id: before the id, after ⏰',
      '- [ ] Pack ⏰ 07:00 ^pack', (st, it) => st.setDate(it, 'start', '2026-10-08'),
      '- [ ] Pack ⏰ 07:00 🛫 2026-10-08 ^pack', ['🛫 2026-10-08'], ['', '', '2026-10-08', '07:00']],
  ]) {
    h = host(`## Admin\n${line}\n`);
    ({ items } = await h.store.load());
    r = await act(h.store, items[0]);
    assert.deepStrictEqual(r, { ok: true }, `${name}: ok`);
    const out = noteOf(h).split('\n')[1];
    assert.strictEqual(out, want, name);
    if (fields) assert.deepStrictEqual(tasksRead(out), fields, `${name}: Tasks reads every field`);
    ({ items } = await h.store.load());
    assert.deepStrictEqual([items[0].due, items[0].scheduled, items[0].start, items[0].time], back, `${name}: Nudge reads it back`);
  }

  /* only the one line changes — not the prose quoting the same date, not
     another reminder scheduled for the same day */
  h = host('# Reminders\n\nProse that says ⏳ 2026-10-07.\n\n## Admin\n- [ ] Call bank ⏳ 2026-10-07\n- [ ] Pay rent ⏳ 2026-10-07 📅 2026-10-08\n');
  ({ items } = await h.store.load());
  await h.store.setDate(items[0], 'scheduled', '2026-10-09');
  assert.strictEqual(noteOf(h), '# Reminders\n\nProse that says ⏳ 2026-10-07.\n\n## Admin\n- [ ] Call bank ⏳ 2026-10-09\n- [ ] Pay rent ⏳ 2026-10-07 📅 2026-10-08\n');

  /* a field it does not know, or a date that is not one, writes nothing */
  const CALL = '## Admin\n- [ ] Call bank ⏳ 2026-10-07\n';
  for (const [field, date] of [
    ['created', '2026-10-09'], ['done', '2026-10-09'], ['Scheduled', '2026-10-09'], ['⏳', '2026-10-09'],
    ['toString', '2026-10-09'], ['__proto__', '2026-10-09'], [undefined, '2026-10-09'], [null, null],
    ['scheduled', '2026-10-9'], ['scheduled', 'tomorrow'], ['scheduled', '2026-02-30'],
    ['scheduled', '2026-10-09T00:00'], ['scheduled', 20261009], ['scheduled', {}],
  ]) {
    h = host(CALL);
    ({ items } = await h.store.load());
    assert.deepStrictEqual(await h.store.setDate(items[0], field, date), { ok: false }, `setDate(${JSON.stringify(field)}, ${JSON.stringify(date)}) is refused`);
    assert.strictEqual(noteOf(h), CALL, 'and the note is untouched');
  }

  /* an item that is not a reminder line claims nothing */
  for (const it of [{ title: 'Ghost', line: 1 }, { raw: 42, line: 1 }, { raw: 'Some prose line', line: 1 }, null]) {
    h = host('# Reminders\nSome prose line\n' + CALL);
    assert.deepStrictEqual(await h.store.setDate(it, 'scheduled', '2026-10-09'), { ok: false }, `setDate(${JSON.stringify(it)}) claims nothing`);
    assert.strictEqual(noteOf(h), '# Reminders\nSome prose line\n' + CALL);
  }

  /* it waits its turn like every other write: two moves at once both land */
  h = host('## Admin\n- [ ] Call bank ⏳ 2026-10-07\n- [ ] Pack 🛫 2026-10-07\n');
  ({ items } = await h.store.load());
  await Promise.all([h.store.setDate(items[0], 'scheduled', '2026-10-09'), h.store.setDate(items[1], 'start', '2026-10-08')]);
  assert.strictEqual(noteOf(h), '## Admin\n- [ ] Call bank ⏳ 2026-10-09\n- [ ] Pack 🛫 2026-10-08\n');

  console.log('store OK');
})().catch(e => { console.error(e); process.exit(1); });
