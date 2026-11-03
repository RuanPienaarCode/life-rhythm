'use strict';
/* Runs the person's own AI app (Claude Code, Codex) for one turn of a chat,
   on a computer only. The ONE file in src/ allowed window.require
   (tests/ios-hazards.test.cjs).

   Whether this device can run a program is decided by the real platform and
   nothing else: Platform.isDesktopApp AND window.require is a function AND
   child_process.spawn is a function. Never by isMobile / isPhone /
   body.is-mobile: Obsidian's mobile emulation on a Mac sets those and leaves
   the Mac able to run programs, and a real phone has no child_process
   (makeRunner() is null there, so the feature is off).

   A program is found as an ABSOLUTE path (the one saved in Settings if it is
   an executable file, else the first hit in the usual places: Obsidian
   started from the Dock does not see the shell's PATH). A bare name is never
   spawned. Each run gets a fresh empty folder in the system temp dir as its
   working directory (removed after), the prompt on stdin only, no shell, five
   environment variables and not Obsidian's own, 120 seconds, 1 MB of output,
   and is killed the moment it starts to use a tool. What the program may do
   (nothing but answer) is its command line, built in src/ai/providers.js. */

const { Platform } = require('obsidian');
const P = require('./providers');

const PREFIX = 'rhythm-ask-';

/* The Node modules, or null where there are none (a phone, a test without them). */
function nodeApi() {
  if (!Platform || !Platform.isDesktopApp || typeof window === 'undefined' || typeof window.require !== 'function') return null;
  try {
    const cp = window.require('child_process');
    if (!cp || typeof cp.spawn !== 'function') return null;
    return { cp, fs: window.require('fs'), os: window.require('os') };
  } catch (e) { return null; }
}

/* deps: { cp, fs, os } (a test hands in fakes); none → the real ones.
   → null where programs cannot be run. */
function makeRunner(deps) {
  const d = deps === undefined ? nodeApi() : deps;
  if (!d || !d.cp || typeof d.cp.spawn !== 'function' || !d.fs || !d.os) return null;
  const home = () => { try { return String(d.os.homedir()); } catch (e) { return ''; } };
  const tmp = () => String(d.os.tmpdir()).replace(/\/+$/, '');

  const isFile = p => { try { return d.fs.statSync(p).isFile(); } catch (e) { return false; } };
  const canRun = p => { try { d.fs.accessSync(p, d.fs.constants ? d.fs.constants.X_OK : 1); return true; } catch (e) { return false; } };
  const usable = p => typeof p === 'string' && p.charAt(0) === '/' && isFile(p) && canRun(p);

  /* → { path, source: 'setting' | 'auto' | '', badSetting }. A path set in
     Settings wins; one that is no longer an executable file falls back to
     the search and says so. Nothing found: path ''. */
  function locate(bin, configured) {
    const set = String(configured || '').trim();
    if (set && usable(set)) return { path: set, source: 'setting', badSetting: false };
    for (const dir of P.searchDirs(home())) {
      const p = `${dir}/${bin}`;
      if (usable(p)) return { path: p, source: 'auto', badSetting: !!set };
    }
    return { path: '', source: '', badSetting: !!set };
  }

  /* Only a folder this file made (its own prefix, under the temp folder) is ever removed. */
  function removeTemp(dir) {
    if (!dir || dir.indexOf('/' + PREFIX) < 0) return;
    try { d.fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS to clear */ }
  }

  /* Start the program and read it to the end, within the caps. Never rejects.
     guard: the provider id whose stream is watched for tool use, or ''. */
  function spawnCapped(cmd, guard, timeoutMs) {
    return new Promise(resolve => {
      const out = { code: null, signal: null, stdout: '', stderr: '', timedOut: false, tooBig: false, aborted: false, breach: '', spawnError: null };
      let child;
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(out);
      };
      const kill = () => { try { child.kill('SIGKILL'); } catch (e) { /* gone already */ } };
      try {
        child = d.cp.spawn(cmd.file, cmd.args, { cwd: cmd.cwd, env: cmd.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) { out.spawnError = e; finish(); return; }
      child.on('error', e => { out.spawnError = e; finish(); });
      child.on('close', (code, sig) => { out.code = code; out.signal = sig; finish(); });
      timer = setTimeout(() => { out.timedOut = true; kill(); }, timeoutMs);
      if (child.stdout) child.stdout.on('data', b => {
        if (out.tooBig || out.breach) return;
        out.stdout += String(b);
        if (out.stdout.length > P.MAX_STDOUT) { out.tooBig = true; kill(); return; }
        const why = guard ? P.breachOf(guard, out.stdout) : '';
        if (why) { out.breach = why; kill(); }
      });
      if (child.stderr) child.stderr.on('data', b => { if (out.stderr.length < P.MAX_STDERR) out.stderr += String(b).slice(0, P.MAX_STDERR - out.stderr.length); });
      if (child.stdin) {
        child.stdin.on('error', () => { /* the program stopped reading: its own exit says why */ });
        try { child.stdin.end(cmd.input); } catch (e) { /* same */ }
      }
    });
  }

  /* Run one question. o: { configured, model, system, input }. → the run's
     result ({ code, stdout, stderr, timedOut, tooBig, breach, spawnError }),
     for providers.cliResult to read. Never rejects. */
  async function run(id, o) {
    const p = P.provider(id);
    const loc = locate(p.bin, o.configured);
    if (!loc.path) return { code: null, stdout: '', stderr: '', spawnError: { code: 'ENOENT' } };
    let cwd = '';
    try {
      cwd = d.fs.mkdtempSync(`${tmp()}/${PREFIX}`);
      let user = '';
      try { user = d.os.userInfo().username; } catch (e) { user = ''; }
      const cmd = P.buildCommand(id, { file: loc.path, model: o.model, system: o.system, input: o.input, cwd, home: home(), user, lang: 'en_US.UTF-8', tmpdir: tmp() });
      if (cmd.error) return { code: null, stdout: '', stderr: '', spawnError: { code: 'REFUSED', message: cmd.error } };
      return await spawnCapped(cmd, id, P.TIMEOUT_MS);
    } catch (e) {
      return { code: null, stdout: '', stderr: '', spawnError: e };
    } finally {
      removeTemp(cwd);
    }
  }

  /* `<app> --version`: free, proves the app is there and runs. */
  async function check(bin, configured) {
    const loc = locate(bin, configured);
    if (!loc.path) {
      const e = new Error(`${bin} wasn’t found on this computer. Install it, or set its path in ${P.WHERE}.`);
      e.code = 'ENOENT';
      throw e;
    }
    let user = '';
    try { user = d.os.userInfo().username; } catch (e) { user = ''; }
    const r = await spawnCapped({ file: loc.path, args: ['--version'], input: '', cwd: tmp() || '/', env: P.cliEnv(loc.path, { home: home(), user, tmpdir: tmp() }) }, '', 20000);
    if (r.spawnError) throw r.spawnError;
    if (r.timedOut || r.code !== 0) throw new Error(String(r.stderr || r.stdout).trim().split(/\r?\n/).pop() || (r.timedOut ? 'no answer in 20 seconds' : `exit ${r.code}`));
    return { path: loc.path, version: String(r.stdout).trim().split(/\r?\n/)[0] };
  }

  return { locate, run, check };
}

module.exports = { makeRunner };
