'use strict';
/* Fakes for the Ask AI tests: a child_process that records every spawn and
   plays a scripted program, an fs holding a few executable files, an os.
   Not a test itself (the runner only runs *.test.cjs). */
const { EventEmitter } = require('node:events');

/* script(child, call) is called after spawn; it may emit output and 'close'. */
function fakeCp(script) {
  const calls = [];
  return {
    calls,
    spawn(file, args, opts) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = [];
      child.stdinText = null;
      child.stdin = new EventEmitter();
      child.stdin.end = t => { child.stdinText = t; };
      child.kill = sig => { child.killed.push(sig); setImmediate(() => child.emit('close', null, sig)); };
      const call = { file, args, opts, child };
      calls.push(call);
      setImmediate(() => script && script(child, call));
      return child;
    },
  };
}

/* files: absolute paths that exist and are executable. made/removed record temp dirs. */
function fakeFs(files) {
  const made = [], removed = [];
  const set = new Set(files);
  return {
    made, removed,
    constants: { X_OK: 1 },
    statSync: p => { if (!set.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { isFile: () => true }; },
    accessSync: p => { if (!set.has(p)) throw new Error('EACCES'); },
    existsSync: p => set.has(p),
    mkdtempSync: prefix => { const d = prefix + 'AbC123'; made.push(d); return d; },
    rmSync: d => { removed.push(d); },
  };
}

const fakeOs = (home = '/Users/test') => ({ homedir: () => home, tmpdir: () => '/var/folders/zz/T/', userInfo: () => ({ username: 'test' }) });

/* The result line streams a Claude Code run ends with. */
const claudeOk = text => `{"type":"system","subtype":"init","model":"claude-x"}\n{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]}}\n{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)}}\n`;
const codexOk = text => `{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":${JSON.stringify(text)}}}\n{"type":"turn.completed"}\n`;

module.exports = { fakeCp, fakeFs, fakeOs, claudeOk, codexOk };
