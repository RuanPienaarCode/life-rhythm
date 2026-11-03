'use strict';
/* Ask AI on the plugin: which AI this device uses, its key, and ask().

   Computers only (no AI on a phone or tablet). Per device, never in the
   vault (a key must not ride iCloud to every device): the provider, each
   API key and each app path live in Obsidian's local storage for this vault
   on this device. Per vault, in data.json: the model name for each AI
   (settings.aiModels) and whether the button shows (settings.askAi). */

const { requestUrl, Platform } = require('obsidian');
const P = require('./providers');
const { makeRunner } = require('./cli');

const PREFIX = 'rhythm-ai-';
const CLI_TIMEOUT = 3 * 60 * 1000;

/* No AI on mobile (Ruan, 3 Nov 2026): on a phone or tablet there is no Ask
   AI at all — null, so no button, no item menu entry, no key field, and
   nothing leaves the device. Every caller already reads null as "off".
   ask() below is the ONLY caller of providers.ask (tests/ai-host.test.cjs
   pins that), and it refuses again at call time, so even if mobile turns on
   after load (a phone-sized emulation) no request is made. */
const mobile = () => !!(Platform && Platform.isMobile);
const OFF = 'Ask AI is for your computer. It is off on phones and tablets.';

function attachAi(plugin) {
  if (mobile()) return null;
  const app = plugin.app;
  let runner;
  const getRunner = () => (runner === undefined ? (runner = makeRunner()) : runner);

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

  const desktop = !!(Platform && Platform.isDesktopApp);
  const device = {
    desktop,
    /* Starts on Claude Code (the plan you already pay for). */
    provider() {
      const id = load('provider');
      const p = P.PROVIDERS.find(x => x.id === id);
      if (p && (p.kind === 'api' || desktop)) return p.id;
      return desktop ? 'claude-code' : 'anthropic';
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
    providers: () => P.PROVIDERS.filter(p => p.kind === 'api' || desktop),
    current: () => P.provider(device.provider()),
    model(id) { return String(models()[id] || ''); },
    async setModel(id, v) {
      plugin.settings.aiModels = Object.assign({}, models(), { [id]: String(v || '').trim() });
      if (!plugin.settings.aiModels[id]) delete plugin.settings.aiModels[id];
      await plugin.saveSettings();
    },
    /* system: the rules + page; messages: the chat so far. */
    ask({ system, messages }) {
      if (mobile()) return Promise.reject(new Error(OFF));
      const p = P.provider(device.provider());
      const r = p.kind === 'cli' ? getRunner() : null;
      return P.ask({
        provider: p.id, system, messages,
        model: models()[p.id] || p.model,
        apiKey: device.key(p.id),
        request: requestUrl,
        run: r ? (bin, args, opts) => r.run(bin, args, Object.assign({ configured: device.binPath(p.id) }, opts)) : undefined,
        timeoutMs: CLI_TIMEOUT,
      });
    },
    async check(id) {
      if (mobile()) throw new Error(OFF);
      const p = P.provider(id);
      const r = getRunner();
      if (!r || p.kind !== 'cli') throw new Error('Only on a computer.');
      return r.check(p.bin, device.binPath(id));
    },
  };
}

module.exports = { attachAi };
