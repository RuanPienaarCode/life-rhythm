'use strict';
/* Runs the person's own AI app (Claude Code, Codex) for one turn of a chat
   — on a computer only. Node is reached at run time through window.require,
   and only when Platform.isDesktopApp, so nothing here is bundled and the
   phone never touches it (makeRunner() is null there). The ONE file in src/
   allowed window.require (tests/ios-hazards.test.cjs).

   Each run gets a fresh empty folder in the system temp dir as its working
   directory and is removed after. The prompt goes in on stdin. A run longer
   than timeoutMs is killed and rejects with code 'TIMEOUT'; a missing app
   rejects with 'ENOENT'. What the app may do (nothing but answer) is set by
   its arguments in src/ai/providers.js. Same runner as Find a Deal's. */

const { Platform } = require('obsidian');

function nodeApi() {
  if (!Platform || !Platform.isDesktopApp || typeof window === 'undefined' || typeof window.require !== 'function') return null;
  try {
    return { cp: window.require('child_process'), fs: window.require('fs'), os: window.require('os'), path: window.require('path'), proc: window.require('process') };
  } catch (e) { return null; }
}

function makeRunner() {
  const n = nodeApi();
  if (!n) return null;
  const home = n.os.homedir();
  /* Where these apps install themselves. Obsidian started from the Dock
     does not see the shell's PATH, so they are looked for here too. */
  const dirs = [n.path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', n.path.join(home, '.npm-global', 'bin'), n.path.join(home, '.bun', 'bin'), n.path.join(home, '.claude', 'local'), '/usr/bin'];
  /* The Node process comes through window.require too: a bare global would
     be one more name the phone does not have. */
  const env = () => ({ ...n.proc.env, PATH: [...new Set([...dirs, ...String(n.proc.env.PATH || '').split(n.path.delimiter)])].filter(Boolean).join(n.path.delimiter) });

  /* The app's full path: the one set in Settings if it exists, else the
     first of the usual places, else its bare name (PATH decides). */
  function find(bin, configured) {
    const c = String(configured || '').trim();
    if (c && n.fs.existsSync(c)) return c;
    for (const d of dirs) {
      const p = n.path.join(d, bin);
      if (n.fs.existsSync(p)) return p;
    }
    return c || bin;
  }

  function run(bin, args, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
      let dir = '';
      try { dir = n.fs.mkdtempSync(n.path.join(n.os.tmpdir(), 'rhythm-ai-')); } catch (e) { reject(e); return; }
      const cleanup = () => { try { n.fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS clears temp */ } };
      let out = '', err = '', done = false, timer = null;
      const finish = fn => { if (done) return; done = true; if (timer) clearTimeout(timer); cleanup(); fn(); };
      let child;
      try {
        child = n.cp.spawn(find(bin, o.configured), args, { cwd: dir, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) { finish(() => reject(e)); return; }
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => finish(() => reject(e)));
      child.on('close', code => finish(() => resolve({ code, stdout: out, stderr: err })));
      if (o.timeoutMs) {
        timer = setTimeout(() => {
          try { child.kill('SIGTERM'); } catch (e) { /* already gone */ }
          const e = new Error('timeout');
          e.code = 'TIMEOUT';
          finish(() => reject(e));
        }, o.timeoutMs);
      }
      child.stdin.on('error', () => { /* the app closed stdin early; its exit says why */ });
      child.stdin.end(o.stdin || '');
    });
  }

  /* `<app> --version`: free, proves the app is there and runs. */
  async function check(bin, configured) {
    const r = await run(bin, ['--version'], { timeoutMs: 20000, configured });
    if (r.code !== 0) throw new Error(String(r.stderr || r.stdout).trim().split(/\r?\n/).pop() || `exit ${r.code}`);
    return { path: find(bin, configured), version: String(r.stdout).trim().split(/\r?\n/)[0] };
  }

  return { find, run, check };
}

module.exports = { makeRunner };
