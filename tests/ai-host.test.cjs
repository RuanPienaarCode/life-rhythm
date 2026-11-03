'use strict';
/* Ruan's rule (3 Nov 2026): no AI on mobile. On a phone or tablet Rhythm
   has no Ask AI at all — attachAi gives nothing, so there is no button, no
   "Ask AI about this", no key field, and nothing leaves the device. */
const assert = require('node:assert');
const stub = require('./reminders-_stub.cjs');
/* every request the plugin could make to an AI service lands here */
const sent = [];
stub.requestUrl = async o => { sent.push(o); return { status: 200, json: {}, text: '{}' }; };
const { attachAi } = require('../src/ai/host');

/* this device's local storage, in memory */
const mem = new Map();
const plugin = { app: { loadLocalStorage: k => (mem.has(k) ? mem.get(k) : null), saveLocalStorage: (k, v) => mem.set(k, v) }, settings: {} };

stub.Platform.isMobile = true;
stub.Platform.isDesktopApp = false;
assert.strictEqual(attachAi(plugin), null, 'mobile: no Ask AI');

stub.Platform.isMobile = false;
stub.Platform.isDesktopApp = true;
const ai = attachAi(plugin);
assert.ok(ai && typeof ai.ask === 'function', 'a computer: Ask AI as before');
assert.strictEqual(ai.current().id, 'claude-code', 'and it starts on the plan, not a key');


/* Live guard: even if mobile turns on AFTER load, ask() and check() refuse
   and no request is made — for an API provider and for a CLI one. */
(async () => {
  ai.device.setKey('anthropic', 'sk-test');
  ai.device.setProvider('anthropic');
  stub.Platform.isMobile = true;
  await assert.rejects(ai.ask({ system: 's', messages: [{ role: 'user', content: 'hi' }] }), /for your computer/, 'ask() refuses on mobile');
  await assert.rejects(ai.check('claude-code'), /for your computer/, 'check() refuses on mobile');
  assert.strictEqual(sent.length, 0, 'no provider call fired on mobile');

  /* and back on a computer the same ask() reaches the provider */
  stub.Platform.isMobile = false;
  await ai.ask({ system: 's', messages: [{ role: 'user', content: 'hi' }] }).catch(() => {});
  assert.strictEqual(sent.length, 1, 'a computer still makes the provider call');

  /* the one door: providers.ask is called from ai/host.js and nowhere else */
  const fs = require('node:fs'), path = require('node:path');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const src = path.join(__dirname, '..', 'src');
  const users = walk(src).filter(f => f.endsWith('.js') && /require\('(\.\/|\.\.\/ai\/)providers'\)/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(src, f)).sort();
  assert.deepStrictEqual(users, ['ai/host.js'], 'only ai/host.js imports the providers');
  const callers = walk(src).filter(f => f.endsWith('.js') && /\bP\.ask\(|providers\.ask\(/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(src, f));
  assert.deepStrictEqual(callers, ['ai/host.js'], 'providers.ask has one caller');
  console.log('ai host OK');
})().catch(e => { console.error(e); process.exit(1); });

