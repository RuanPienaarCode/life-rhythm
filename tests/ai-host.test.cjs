'use strict';
/* Ask AI on the plugin (src/ai/host.js): the API route still reaches its
   provider (after the plan routes), nothing is sent on a device that cannot
   run programs, and providers.ask has ONE caller. Where it runs (emulation,
   real phone, default, picker order) is tests/ai-platform.test.cjs. */
const assert = require('node:assert');
const stub = require('./reminders-_stub.cjs');
const { fakeCp, fakeFs, fakeOs } = require('./ai-_fake.cjs');
/* every request the plugin could make to an AI service lands here */
const sent = [];
stub.requestUrl = async o => { sent.push(o); return { status: 200, json: { content: [{ type: 'text', text: 'ok' }] }, text: '{}' }; };
const { attachAi } = require('../src/ai/host');

const mem = new Map();
const plugin = { app: { loadLocalStorage: k => (mem.has(k) ? mem.get(k) : null), saveLocalStorage: (k, v) => mem.set(k, v) }, settings: {} };
global.window = globalThis;

/* a real phone: no isDesktopApp, no window.require */
Object.assign(stub.Platform, { isMobile: true, isPhone: true, isDesktopApp: false });
delete globalThis.require;
assert.strictEqual(attachAi(plugin), null, 'phone: no Ask AI');
assert.strictEqual(sent.length, 0, 'phone: nothing sent');

/* a Mac under mobile emulation: it works, and a saved API route with a key is used as saved */
Object.assign(stub.Platform, { isMobile: true, isPhone: true, isDesktopApp: true });
const mods = { child_process: fakeCp(), fs: fakeFs(['/Users/test/.local/bin/claude']), os: fakeOs('/Users/test') };
globalThis.require = n => mods[n];
const ai = attachAi(plugin);
assert.ok(ai && typeof ai.ask === 'function', 'emulation: Ask AI');
assert.strictEqual(ai.current().id, 'claude-code');

(async () => {
  ai.device.setKey('anthropic', 'sk-test');
  ai.device.setProvider('anthropic');
  assert.strictEqual(ai.current().id, 'anthropic', 'a key on this device: the saved API route stands');
  const r = await ai.ask({ system: 's', messages: [{ role: 'user', content: 'hi' }] });
  assert.strictEqual(r.text, 'ok');
  assert.strictEqual(sent.length, 1, 'the API route reaches its provider');

  /* the one door: providers.ask is called from ai/host.js and nowhere else */
  const fs = require('node:fs'), path = require('node:path');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const src = path.join(__dirname, '..', 'src');
  const users = walk(src).filter(f => f.endsWith('.js') && /require\('(\.\/|\.\.\/ai\/)providers'\)/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(src, f)).sort();
  assert.deepStrictEqual(users, ['ai/cli.js', 'ai/host.js'], 'only the ai host and its runner import the providers');
  const callers = walk(src).filter(f => f.endsWith('.js') && /\bP\.ask\(|providers\.ask\(/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(src, f));
  assert.deepStrictEqual(callers, ['ai/host.js'], 'providers.ask has one caller');
  console.log('ai host OK');
})().catch(e => { console.error(e); process.exit(1); });
