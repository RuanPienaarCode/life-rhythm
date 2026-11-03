'use strict';
/* Audit 3 Nov 2026, H1: a screen that is out of date (the board, a menu, the
   editor left open) must never act on the NEXT occurrence of a repeating
   reminder. When the phone ticks "Pay rent 🔁 every month 📅 2026-11-01",
   Tasks writes the next one (📅 2026-12-01) and marks this one done; a stale
   view still holding the 11-01 line once matched the open 12-01 line by its
   words and deleted, snoozed or re-dated the live series. */
require('./reminders-_stub.cjs');
const assert = require('node:assert');
const { makeStore } = require('../src/reminders/store');
const T = require('../src/reminders/tasks');

function host(text) {
  const files = new Map([['Reminders.md', text]]);
  const plugin = {
    settings: { file: 'Reminders.md', icsFile: 'Reminders.ics', alarmMinutes: 10, allDayAlarmTime: '09:00' },
    _lastWrite: 0,
    async saveSettings() {},
    app: { vault: {
      getFileByPath: p => (files.has(p) ? { path: p, name: p.split('/').pop() } : null),
      getFolderByPath: p => (p === '' ? { path: '', children: [] } : null),
      read: async f => files.get(f.path),
      cachedRead: async f => files.get(f.path),
      modify: async (f, t) => { files.set(f.path, t); },
      process: async (f, fn) => { const t = fn(files.get(f.path)); files.set(f.path, t); return t; },
      create: async (p, t) => { files.set(p, t); return { path: p }; },
      createFolder: async () => {},
    } },
  };
  return { files, store: makeStore(plugin) };
}

const BEFORE = '# R\n\n## Home\n- [ ] Pay rent 🔁 every month 📅 2026-11-01\n';
const AFTER = '# R\n\n## Home\n- [ ] Pay rent 🔁 every month 📅 2026-12-01\n- [x] Pay rent 🔁 every month 📅 2026-11-01 ✅ 2026-11-02\n';
const stale = T.parseNote(BEFORE)[0];

(async () => {
  const cases = [
    ['remove', s => s.remove(stale)],
    ['snooze', s => s.snooze(stale, 1, '2026-11-03')],
    ['update', s => s.update(stale, { title: 'Pay the rent', due: stale.due, time: '', priority: 'normal', repeat: stale.repeat, tags: [], group: 'Home' })],
    ['setDue', s => s.setDue(stale, '2026-11-20')],
    ['toggle', s => s.toggle(stale, '2026-11-03')],
  ];
  for (const [name, fn] of cases) {
    const h = host(AFTER);
    const r = await fn(h.store);
    assert.ok(r && r.ok === false, `${name}: refused (got ${JSON.stringify(r)})`);
    assert.strictEqual(h.files.get('Reminders.md'), AFTER, `${name}: the live series is untouched`);
  }

  /* A one-off reminder whose date was changed by hand while the board was
     open is still found and edited — that is what the fallback is for. */
  {
    const one = T.parseNote('# R\n\n## Home\n- [ ] Call the bank 📅 2026-11-04\n')[0];
    const h = host('# R\n\n## Home\n- [ ] Call the bank 📅 2026-11-06\n');
    const r = await h.store.setDue(one, '2026-11-10');
    assert.notStrictEqual(r && r.ok, false, 'a moved one-off is still edited');
    assert.ok(h.files.get('Reminders.md').includes('📅 2026-11-10'));
  }
  /* …but never deleted on a guess: Delete wants the exact line. */
  {
    const one = T.parseNote('# R\n\n## Home\n- [ ] Call the bank 📅 2026-11-04\n')[0];
    const text = '# R\n\n## Home\n- [ ] Call the bank 📅 2026-11-06\n';
    const h = host(text);
    const r = await h.store.remove(one);
    assert.strictEqual(r && r.ok, false, 'a delete from a stale view is refused');
    assert.strictEqual(h.files.get('Reminders.md'), text);
  }
  /* The exact line still deletes. */
  {
    const h = host(BEFORE);
    const r = await h.store.remove(stale);
    assert.notStrictEqual(r && r.ok, false);
    assert.ok(!h.files.get('Reminders.md').includes('Pay rent'));
  }

  console.log('reminders stale repeat OK');
})().catch(e => { console.error(e); process.exit(1); });
