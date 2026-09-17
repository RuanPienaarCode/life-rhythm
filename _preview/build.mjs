/* Build the browser harness: real src/ modules, the shipped stylesheet, a
   stubbed `obsidian` and an in-memory vault. Outputs are gitignored.
   Serve:  python3 -m http.server 8820   then /_preview/preview.html?seeded=1 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
writeFileSync(join(here, 'rhythm.css'), readFileSync(join(root, 'styles.css'), 'utf8'));
await esbuild.build({
  entryPoints: [join(here, 'entry.js')],
  outfile: join(here, 'bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'safari15',
  alias: { obsidian: join(here, 'obsidian-stub.js') },
  logLevel: 'info',
});
