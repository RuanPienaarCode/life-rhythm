'use strict';
/* Ruan's rule (3 Nov 2026): no AI on mobile. On a phone or tablet Rhythm
   has no Ask AI at all — attachAi gives nothing, so there is no button, no
   "Ask AI about this", no key field, and nothing leaves the device. */
const assert = require('node:assert');
const stub = require('./reminders-_stub.cjs');
const { attachAi } = require('../src/ai/host');

const plugin = { app: {}, settings: {} };

stub.Platform.isMobile = true;
stub.Platform.isDesktopApp = false;
assert.strictEqual(attachAi(plugin), null, 'mobile: no Ask AI');

stub.Platform.isMobile = false;
stub.Platform.isDesktopApp = true;
const ai = attachAi(plugin);
assert.ok(ai && typeof ai.ask === 'function', 'a computer: Ask AI as before');
assert.strictEqual(ai.current().id, 'claude-code', 'and it starts on the plan, not a key');

console.log('ai host OK');
