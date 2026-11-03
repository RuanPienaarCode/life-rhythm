'use strict';
/* embed.js: a board's life follows its page. Its timers are cleared when the
   page is left — including one it only registers once its first load lands,
   after the page was already left (the reminders board does exactly that). */
const assert = require('node:assert');
require('./reminders-_stub.cjs');
const live = new Set();
global.window = {
  setInterval: () => { const id = Symbol('interval'); live.add(id); return id; },
  clearInterval: id => { live.delete(id); },
  setTimeout, clearTimeout,
};
const { mountEmbed, EMBEDS } = require('../src/embed');

/* A stand-in board: registers its timer at mount, and another one only
   after its (slow) first load. */
let release;
EMBEDS.probe = {
  kind: 'probe',
  host: () => ({}),
  mount: view => ({
    stopped: false,
    async start() {
      view.registerInterval(window.setInterval());
      await new Promise(r => { release = r; });
      view.registerInterval(window.setInterval());
    },
    stop() { this.stopped = true; },
  }),
};

(async () => {
  /* left after it finished loading: both timers cleared */
  {
    const e = mountEmbed('probe', {}, { app: {} }, null);
    const ready = e.start();
    release();
    await ready;
    assert.strictEqual(live.size, 2);
    e.stop();
    assert.strictEqual(live.size, 0, 'both timers cleared on leaving');
    assert.ok(e.ctl.stopped);
  }
  /* left while its first load was still running: the late timer too */
  {
    const e = mountEmbed('probe', {}, { app: {} }, null);
    const ready = e.start();
    assert.strictEqual(live.size, 1);
    e.stop();
    assert.strictEqual(live.size, 0);
    release();
    await ready;
    assert.strictEqual(live.size, 0, 'a timer registered after the page was left is cleared at once');
  }
  /* stop twice is fine */
  {
    const e = mountEmbed('probe', {}, { app: {} }, null);
    e.stop(); e.stop();
  }
  console.log('embed OK');
})().catch(e => { console.error(e); process.exit(1); });
