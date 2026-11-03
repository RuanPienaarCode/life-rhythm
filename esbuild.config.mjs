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

const root = dirname(fileURLToPath(import.meta.url));
const rel = p => join(root, p);

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
  logLevel: 'info',
});
