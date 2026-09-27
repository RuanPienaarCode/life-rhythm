/* An in-memory stand-in for Obsidian's Vault, exposing exactly the surface
   src/io.js touches: getFolderByPath, getFileByPath, cachedRead, read,
   create, modify, createFolder, process, on. */
export function makeMemoryVault(initial) {
  const files = new Map(Object.entries(initial || {}));
  const folders = new Set();
  const listeners = {};
  const locks = new Map();
  const parent = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const ensureParents = p => { let d = parent(p); while (d) { folders.add(d); d = parent(d); } };
  for (const p of files.keys()) ensureParents(p);

  const fileObj = p => {
    const name = p.slice(p.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return { path: p, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : '' };
  };
  const emit = (ev, ...a) => (listeners[ev] || []).forEach(cb => cb(...a));

  return {
    files,
    getFolderByPath(p) {
      if (!folders.has(p) && ![...files.keys()].some(f => f.startsWith(p + '/'))) return null;
      const children = [];
      for (const f of files.keys()) if (parent(f) === p) children.push(fileObj(f));
      for (const d of folders) if (parent(d) === p) children.push({ path: d, name: d.slice(d.lastIndexOf('/') + 1), children: [] });
      return { path: p, children };
    },
    getFileByPath(p) { return files.has(p) ? fileObj(p) : null; },
    async cachedRead(f) { return files.get(f.path) ?? ''; },
    async read(f) { return files.get(f.path) ?? ''; },
    async create(p, content) { if (files.has(p)) throw new Error('exists: ' + p); ensureParents(p); files.set(p, content); emit('create', fileObj(p)); return fileObj(p); },
    async modify(f, content) { files.set(f.path, content); emit('modify', fileObj(f.path)); },
    /* fn is SYNCHRONOUS (data: string) => string, per the real Vault.process
       signature. Calls on the SAME path are chained on a lock so two
       concurrent process() calls can never both read the pre-write value —
       the atomicity src/io.js relies on for the tick race fix. */
    async process(f, fn) {
      const path = f.path;
      const prior = locks.get(path) || Promise.resolve();
      const run = prior.then(() => {
        const next = fn(files.get(path) ?? '');
        files.set(path, next);
        emit('modify', fileObj(path));
        return next;
      });
      locks.set(path, run.catch(() => {}));
      return run;
    },
    async createFolder(p) { folders.add(p); ensureParents(p + '/x'); },
    async rename(f, newPath) { const c = files.get(f.path); files.delete(f.path); ensureParents(newPath); files.set(newPath, c); emit('rename', fileObj(newPath), f.path); },
    /* The harness stores an image as its own data URI, so the resource
       path IS the content — enough to prove the glass reads over one. */
    getResourcePath(f) { return files.get(f.path) || ''; },
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return { ev, cb }; },
  };
}
