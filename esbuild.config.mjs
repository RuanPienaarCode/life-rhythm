/* The build, as one reproducible Node script (same layout as gym-vault and
   budget-vault). BOTH root main.js and root styles.css are BUILD OUTPUT:
     main.js    <- bundled from src/*.js
     styles.css <- src/styles.css, then the two module stylesheets
                   (src/reminders, src/planner), then src/embed.css
   An edit made directly to a root artifact is lost on the next build. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const rel = p => join(root, p);

/* The build stamp: the commit (and whether the tree had uncommitted
   changes) at the top of main.js and in Settings, so what is installed can
   always be named — scripts/deploy-check.mjs refuses a deploy that would
   replace it with a build that does not contain it. */
const git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim(); } catch (e) { return ''; } };
const sha = git('rev-parse', '--short', 'HEAD') || 'nogit';
/* Dirty = a tracked file changed, or an untracked file sits among the build
   inputs (esbuild bundles whatever is required, committed or not). */
const dirty = git('status', '--porcelain', '--untracked-files=no') !== ''
  || git('ls-files', '--others', '--exclude-standard', '--', 'src', 'esbuild.config.mjs', 'package.json', 'package-lock.json') !== '';
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || 'unknown';
const stamp = `${sha}${dirty ? '-dirty' : ''} ${branch} ${new Date().toISOString().slice(0, 10)}`;

const CSS = ['src/styles.css', 'src/reminders/styles.css', 'src/planner/styles.css', 'src/embed.css', 'src/ai/styles.css'];
writeFileSync(rel('styles.css'), CSS.map(f => readFileSync(rel(f), 'utf8').replace(/\s+$/, '') + '\n').join('\n'));

/* target safari15 = the engine floor this plugin must parse on (Obsidian
   mobile runs the OS WebView; minAppVersion is not the floor). format cjs +
   external obsidian: Obsidian loads main.js as CommonJS and provides the
   `obsidian` module itself. */
await esbuild.build({
  entryPoints: [rel('src/main.js')],
  outfile: rel('main.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'safari15',
  external: ['obsidian'],
  minify: true,
  legalComments: 'none',
  banner: { js: `/* rhythm-build: ${stamp} */` },
  define: { RHYTHM_BUILD: JSON.stringify(stamp) },
  logLevel: 'info',
});
