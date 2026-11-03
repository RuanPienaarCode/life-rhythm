'use strict';
/* Ask AI on the plugin: which AI this device uses, its key, and ask().

   Only where the device can run a program (src/ai/cli.js makeRunner(): the
   real platform, Platform.isDesktopApp + window.require + child_process; never
   a mobile flag). On a real phone or tablet that is false, attachAi returns
   null, and null is "no Ask AI at all": no button, no menu entry, no key
   field, no request, no app link (Ruan, 3 Nov 2026). Obsidian's mobile
   emulation on a Mac does not change this: the Mac can still run programs, so
   Ask AI stays and works.

   The plan routes (Claude Code, Codex) come first and are the default. API
   keys remain as a later choice on the computer. Per device, never in the
   vault (a key must not ride iCloud to every device): the provider, each API
   key and each app path live in Obsidian's local storage for this vault on
   this device. Per vault, in data.json: the model name for each AI
   (settings.aiModels) and whether the button shows (settings.askAi).
   ask() below is the ONLY caller of providers.ask (tests pin that). */

const { requestUrl } = require('obsidian');
const P = require('./providers');
const { makeRunner } = require('./cli');

const PREFIX = 'rhythm-ai-';

function attachAi(plugin) {
  const runner = makeRunner();
  if (!runner) return null;
  const app = plugin.app;

  function load(key) {
    try {
      if (typeof app.loadLocalStorage === 'function') return app.loadLocalStorage(PREFIX + key);
      const raw = window.localStorage.getItem(PREFIX + key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) { return null; }
  }
  function save(key, value) {
    try {
      if (typeof app.saveLocalStorage === 'function') app.saveLocalStorage(PREFIX + key, value);
      else if (value === null || value === undefined || value === '') window.localStorage.removeItem(PREFIX + key);
      else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) { /* storage blocked: nothing remembered */ }
  }

  const device = {
    desktop: true,
    /* The saved choice is respected, except a saved API route with no key on
       this device while a plan route is found: the plan wins (no keys are
       needed on this computer). With no choice: Claude Code when it is found,
       else Codex when it is found, else the API route. */
    provider() {
      const saved = P.PROVIDERS.find(x => x.id === load('provider'));
      const plan = P.CLIS.find(id => !!runner.locate(P.provider(id).bin, device.binPath(id)).path);
      if (saved && saved.kind === 'cli') return saved.id;
      if (saved && (device.key(saved.id) || !plan)) return saved.id;
      return plan || 'anthropic';
    },
    setProvider(id) { save('provider', id); },
    key(id) { return String(load('key-' + id) || ''); },
    setKey(id, v) { save('key-' + id, String(v || '').trim()); },
    binPath(id) { return String(load('bin-' + id) || ''); },
    setBinPath(id, v) { save('bin-' + id, String(v || '').trim()); },
  };

  const models = () => (plugin.settings.aiModels && typeof plugin.settings.aiModels === 'object' ? plugin.settings.aiModels : {});

  return {
    device,
    /* The plan routes first, then the API-key ones. */
    providers: () => P.PROVIDERS,
    current: () => P.provider(device.provider()),
    /* Where a plan route's program was found on this computer ('' = not found). */
    where: id => runner.locate(P.provider(id).bin, device.binPath(id)),
    model(id) { return String(models()[id] || ''); },
    async setModel(id, v) {
      plugin.settings.aiModels = Object.assign({}, models(), { [id]: String(v || '').trim() });
      if (!plugin.settings.aiModels[id]) delete plugin.settings.aiModels[id];
      await plugin.saveSettings();
    },
    /* system: the rules + page together (the API routes); rules + page apart
       and the chat so far in messages (the plan routes put the page on stdin,
       never in a command line). */
    ask({ system, rules, page, messages }) {
      const p = P.provider(device.provider());
      return P.ask({
        provider: p.id, system, rules, page, messages,
        model: models()[p.id] || p.model,
        apiKey: device.key(p.id),
        request: requestUrl,
        run: p.kind === 'cli' ? o => runner.run(o.id, Object.assign({ configured: device.binPath(p.id) }, o)) : undefined,
      });
    },
    async check(id) {
      const p = P.provider(id);
      if (p.kind !== 'cli') throw new Error('Only the Claude Code and Codex routes have an app to check.');
      return runner.check(p.bin, device.binPath(id));
    },
  };
}

module.exports = { attachAi };
