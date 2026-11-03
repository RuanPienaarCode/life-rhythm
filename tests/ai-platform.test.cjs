'use strict';
/* Ask AI, where it runs (plan-ai spec 1, 2, 3, 3b; 3 Nov 2026).
   "Can this device run a CLI?" is answered by the real platform only:
   Platform.isDesktopApp AND window.require AND child_process.spawn. Never by
   isMobile / isIosApp / isPhone / isTablet: Obsidian's mobile emulation on the
   Mac sets those and leaves isDesktopApp true, and a real phone has no
   child_process. Emulation on the Mac: Ask AI shows and works. Real phone: no
   Ask AI at all. */
const assert = require('node:assert');
const stub = require('./reminders-_stub.cjs');
const { fakeCp, fakeFs, fakeOs, claudeOk, codexOk } = require('./ai-_fake.cjs');
const P = require('../src/ai/providers');
const { attachAi } = require('../src/ai/host');

const HOME = '/Users/test';
const CLAUDE = `${HOME}/.local/bin/claude`;
const CODEX = '/opt/homebrew/bin/codex';
global.window = globalThis;

/* a Mac: Node reachable through window.require */
function mac(files, script) {
  const cp = fakeCp(script || ((ch, call) => { ch.stdout.emit('data', call.file === CODEX ? codexOk('From the plan') : claudeOk('From the plan')); ch.emit('close', 0, null); }));
  const mods = { child_process: cp, fs: fakeFs(files), os: fakeOs(HOME) };
  globalThis.require = n => { if (!(n in mods)) throw new Error('no ' + n); return mods[n]; };
  return cp;
}
const mem = new Map();
const plugin = () => ({ app: { loadLocalStorage: k => (mem.has(k) ? mem.get(k) : null), saveLocalStorage: (k, v) => { if (v === null || v === '') mem.delete(k); else mem.set(k, v); } }, settings: {}, saveSettings: async () => {} });
const EMULATED = { isMobile: true, isIosApp: true, isPhone: true, isTablet: false, isDesktop: false, isDesktopApp: true };
const REAL_PHONE = { isMobile: true, isIosApp: true, isPhone: true, isTablet: false, isDesktop: false, isDesktopApp: false };
const MAC = { isMobile: false, isIosApp: false, isPhone: false, isTablet: false, isDesktop: true, isDesktopApp: true };
const as = (platform, files, script) => { mem.clear(); Object.assign(stub.Platform, MAC, platform); return mac(files, script); };

(async () => {
  /* ---- emulation on the Mac: on, plan routes, default Claude Code ---- */
  {
    const cp = as(EMULATED, [CLAUDE, CODEX]);
    const ai = attachAi(plugin());
    assert.ok(ai, 'Ask AI is on under mobile emulation');
    assert.strictEqual(ai.current().id, 'claude-code', 'and starts on the Claude plan');
    assert.deepStrictEqual(ai.providers().slice(0, 2).map(p => p.id), ['claude-code', 'codex'], 'the plan routes are offered');
    const r = await ai.ask({ system: 's', rules: 'rules', page: 'page', messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(r.text, 'From the plan', 'and a question is answered through the plan');
    assert.strictEqual(cp.calls[0].file, CLAUDE);
    assert.deepStrictEqual(await ai.check('claude-code').then(x => x.path), CLAUDE);
  }

  /* ---- a real phone or tablet: nothing at all ---- */
  {
    as(REAL_PHONE, [CLAUDE, CODEX]);
    delete globalThis.require;
    assert.strictEqual(attachAi(plugin()), null, 'real phone (no isDesktopApp, no window.require): no Ask AI');
    as({ ...REAL_PHONE, isPhone: false, isTablet: true }, [CLAUDE]);
    delete globalThis.require;
    assert.strictEqual(attachAi(plugin()), null, 'real tablet: no Ask AI');
    as({ isDesktopApp: false }, [CLAUDE, CODEX]);
    assert.strictEqual(attachAi(plugin()), null, 'no isDesktopApp: off even if a require existed');
    as(MAC, [CLAUDE]);
    delete globalThis.require;
    assert.strictEqual(attachAi(plugin()), null, 'isDesktopApp but no window.require: off');
    as(MAC, [CLAUDE]);
    globalThis.require = n => (n === 'child_process' ? {} : {});
    assert.strictEqual(attachAi(plugin()), null, 'child_process without spawn: off');
    as(MAC, [CLAUDE]);
    globalThis.require = () => { throw new Error('blocked'); };
    assert.strictEqual(attachAi(plugin()), null, 'window.require throwing: off');
  }

  /* ---- the default route (spec 1) ---- */
  {
    as(MAC, [CLAUDE, CODEX]);
    assert.strictEqual(attachAi(plugin()).current().id, 'claude-code', 'Claude Code first');
    as(MAC, [CODEX]);
    assert.strictEqual(attachAi(plugin()).current().id, 'codex', 'else Codex');
    as(MAC, []);
    assert.strictEqual(attachAi(plugin()).current().id, 'anthropic', 'else the API-key route, as before');
    /* a saved plan choice is respected */
    as(MAC, [CLAUDE, CODEX]);
    let ai = attachAi(plugin());
    ai.device.setProvider('codex');
    assert.strictEqual(ai.current().id, 'codex');
    /* a saved API route with no key on this device: the plan wins */
    ai.device.setProvider('anthropic');
    assert.strictEqual(ai.current().id, 'claude-code', 'saved API route, no key, plan found: plan');
    ai.device.setKey('anthropic', 'sk-test');
    assert.strictEqual(ai.current().id, 'anthropic', 'with a key the saved choice stands');
    as(MAC, [CODEX]);
    ai = attachAi(plugin());
    ai.device.setProvider('gemini');
    assert.strictEqual(ai.current().id, 'codex', 'only Codex found: Codex');
    as(MAC, []);
    ai = attachAi(plugin());
    ai.device.setProvider('gemini');
    assert.strictEqual(ai.current().id, 'gemini', 'no plan route found: the saved key route stays');
  }

  /* ---- the picker: plan routes first, labelled as the plan ---- */
  {
    as(MAC, [CLAUDE, CODEX]);
    const ai = attachAi(plugin());
    assert.deepStrictEqual(ai.providers().map(p => p.id), ['claude-code', 'codex', 'anthropic', 'openai', 'xai', 'gemini']);
    assert.deepStrictEqual(ai.providers().slice(0, 2).map(p => p.menu), ['Claude plan (Claude Code)', 'ChatGPT plan (Codex)']);
    assert.ok(ai.providers().slice(2).every(p => p.kind === 'api' && /API key/.test(p.menu)), 'the rest are API keys');
  }

  /* ---- the one door still holds ---- */
  const fs = require('node:fs'), path = require('node:path');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const src = path.join(__dirname, '..', 'src');
  const hosts = walk(src).filter(f => f.endsWith('.js') && /require\('(\.\/|\.\.\/ai\/)providers'\)/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(src, f)).sort();
  assert.ok(hosts.every(h => h.startsWith('ai/')), 'only src/ai/ imports the providers');
  /* and nothing in src decides "can I run a CLI" from the mobile flags */
  for (const f of ['ai/host.js', 'ai/cli.js']) {
    const code = fs.readFileSync(path.join(src, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/isMobile|isIosApp|isPhone|isTablet|is-mobile/.test(code), `${f} must not decide by a mobile flag`);
  }
  console.log('ai platform OK');
})().catch(e => { console.error(e); process.exit(1); });
