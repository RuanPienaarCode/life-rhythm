/* Refuse a deploy that could lose work (audit 3 Nov 2026, H2).

   Every build carries a banner — rhythm-build: <commit>[-dirty] <branch>
   <date> — written by esbuild.config.mjs. Before scripts/deploy.sh copies
   anything, this compares three things: the tree (clean?), the main.js
   about to be copied (built from HEAD?), and the main.js installed in the
   vault (is its commit in HEAD's history?). A deploy that would replace the
   installed build with one that does not contain it is a downgrade — the
   way a deploy from the wrong checkout once removed features without a
   word. Saying so on purpose: RHYTHM_ALLOW_DOWNGRADE=1, or
   RHYTHM_ALLOW_UNSTAMPED=1 for an installed build older than the stamp.

   decide() is pure (tests/deploy-check.test.cjs); main() reads git and the
   vault and exits non-zero with the reasons. */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const STAMP = /\/\* rhythm-build: ([0-9a-f]{7,40})(-dirty)? (\S+) /;

export function parseStamp(text) {
  const m = STAMP.exec(String(text || '').slice(0, 400));
  return m ? { sha: m[1], dirty: !!m[2], branch: m[3] } : null;
}

/* o: { dirty, head, built: stamp|null, installed: stamp|null|'none',
        isAncestor (installed commit is in HEAD's history), allow: { downgrade, unstamped } } */
export function decide(o) {
  const why = [];
  const allow = o.allow || {};
  if (o.dirty) why.push('the tree has uncommitted changes — commit first, so the stamp says what is installed');
  if (!o.built) why.push('main.js has no build stamp — run ./build.sh');
  else if (o.built.dirty) why.push('main.js was built from uncommitted work — commit, then ./build.sh');
  else if (!o.head.startsWith(o.built.sha) && !o.built.sha.startsWith(o.head)) why.push(`main.js was built from ${o.built.sha}, but HEAD is ${o.head} — run ./build.sh`);
  if (o.installed === null) {
    if (!allow.unstamped) why.push('the installed main.js has no build stamp, so there is no way to prove this deploy keeps everything in it — check what is installed, then RHYTHM_ALLOW_UNSTAMPED=1');
  } else if (o.installed && o.installed !== 'none') {
    if (o.installed.dirty && !allow.downgrade) why.push(`the installed build (${o.installed.sha}, ${o.installed.branch}) was made from uncommitted work — RHYTHM_ALLOW_DOWNGRADE=1 to replace it`);
    else if (!o.isAncestor && !allow.downgrade) why.push(`the installed build is ${o.installed.sha} (${o.installed.branch}), which is not in this branch's history — deploying would remove its work. Build from a branch that contains it, or RHYTHM_ALLOW_DOWNGRADE=1`);
  }
  return { ok: why.length === 0, why };
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function main() {
  const root = process.argv[2];
  const dest = process.argv[3];
  const head = git(root, 'rev-parse', 'HEAD');
  /* The same rule as the build stamp (esbuild.config.mjs): untracked files
     among the build inputs count, since the bundle includes them. */
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no') !== ''
    || git(root, 'ls-files', '--others', '--exclude-standard', '--', 'src', 'esbuild.config.mjs', 'package.json', 'package-lock.json') !== '';
  const built = parseStamp(readFileSync(join(root, 'main.js'), 'utf8'));
  const target = join(dest, 'main.js');
  const installed = existsSync(target) ? parseStamp(readFileSync(target, 'utf8')) : 'none';
  let isAncestor = true;
  if (installed && installed !== 'none') {
    try { execFileSync('git', ['merge-base', '--is-ancestor', installed.sha, 'HEAD'], { cwd: root, stdio: 'ignore' }); }
    catch (e) { isAncestor = false; }
  }
  const allow = { downgrade: process.env.RHYTHM_ALLOW_DOWNGRADE === '1', unstamped: process.env.RHYTHM_ALLOW_UNSTAMPED === '1' };
  const r = decide({ dirty, head, built, installed, isAncestor, allow });
  if (!r.ok) {
    console.error('Deploy refused:');
    for (const w of r.why) console.error('  - ' + w);
    process.exit(1);
  }
  const was = installed === 'none' ? 'nothing' : installed ? `${installed.sha} (${installed.branch})` : 'an unstamped build';
  console.log(`  check  replacing ${was} with ${built.sha} (${built.branch})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
