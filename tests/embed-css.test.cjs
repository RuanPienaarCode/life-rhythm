'use strict';
/* src/embed.css re-points the theme variables the Reminders and Fortnight
   boards read at Rhythm's tokens. The page colour must stay SOLID in every
   case: both boards use it as text on filled controls and as the ground of
   their overlays. Making it transparent under a wallpaper (23 Oct 2026) left
   the selected "All" chip as a blank white pill in dark mode. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const embed = read('embed.css');
/* every declaration of a re-pointed theme variable */
const decls = [...embed.matchAll(/(--(?:background|text|interactive)[a-z-]*)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]);
assert.ok(decls.length >= 10, 'the theme variables are re-pointed');
for (const [name, value] of decls) {
  assert.ok(!/transparent|rgba\([^)]*,\s*0\)|none/.test(value), `${name} is never cleared (got "${value}")`);
}
assert.ok(decls.some(([n]) => n === '--background-primary'), '--background-primary is re-pointed');

/* the boards really do use the page colour as text and as overlay ground,
   so the rule above guards something */
const nudge = read('reminders/styles.css');
const fort = read('planner/styles.css');
assert.ok(/button\.nd-chip\.is-on\s*\{[^}]*color:\s*var\(--background-primary\)/.test(nudge), 'Nudge\'s selected chip text is the page colour');
assert.ok(/color:\s*var\(--fn-paper\)/.test(fort), 'Fortnight uses its paper as text');
assert.ok((fort.match(/background-color:\s*var\(--fn-paper\)/g) || []).length >= 4, 'and as the ground of its overlays');

/* under a wallpaper only the roots go clear */
assert.ok(/\.rv-app\.has-bg \.rv-embed\.nd-app\s*\{\s*background:\s*transparent;\s*\}/.test(embed));
assert.ok(/\.rv-app\.has-bg \.rv-embed\.fortnight\s*\{[^}]*background-color:\s*transparent/.test(embed));

console.log('embed css OK');
