'use strict';
/* Light or dark glass: 'auto' follows Obsidian's theme; a pinned mode wins. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { isLightLook, DEFAULT_SETTINGS, MODES } = require('../src/reminders/constants');

assert.strictEqual(DEFAULT_SETTINGS.mode, 'auto', 'the default follows the theme');
assert.strictEqual(isLightLook('auto', true), true);
assert.strictEqual(isLightLook('auto', false), false);
assert.strictEqual(isLightLook('light', false), true, 'pinned light ignores a dark theme');
assert.strictEqual(isLightLook('dark', true), false, 'pinned dark ignores a light theme');
assert.strictEqual(isLightLook(undefined, true), true, 'settings saved before the mode existed follow the theme');
assert.strictEqual(isLightLook('bogus', false), false);
assert.deepStrictEqual(MODES.map(m => m.id), ['auto', 'light', 'dark']);

/* ---- contrast of the sealed palette -----------------------------------------
   The look is declared in src/styles.css as custom properties. This computes
   WCAG contrast from those DECLARED values, so a palette edit that drops text
   under 4.5:1 fails here instead of on a phone.

   What it approximates (it is a floor-check, not a renderer):
     - the field behind the glass is modelled as the tint's ground with each of
       the three blob colours laid over it at HALF their declared strength (a
       radial blob is full only at its centre and fades to nothing), then the
       veil laid over that, tried at both of its stops;
     - surfaces are alpha-composited over that page in the order the CSS stacks
       them: glass, glass-2 (a pill on glass), solid (a mobile row), solid-late;
     - backdrop blur and saturate(165%) are ignored, as are the host's own
       backgrounds. The 'plain' surface (borrowed Obsidian colours) is not
       covered: its values come from the user's theme, not from this file.
   Not claimed: that every pixel of every tint passes. Directly under a blob's
   centre the field is up to twice as strong as modelled. */
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'reminders', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector) {
  const out = {};
  const esc = selector.replace(/[.[\]"():*+?^$|\\-]/g, '\\$&');
  const m = new RegExp('(?:^|})\\s*' + esc + '\\s*\\{([^}]*)\\}').exec(css);
  assert.ok(m, 'styles.css has a rule for ' + selector);
  for (const d of m[1].split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
}
function color(str) {
  const s = str.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return { rgb: [...m[1]].map(c => parseInt(c + c, 16)), a: 1 };
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return { rgb: [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)), a: 1 };
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error('unreadable colour: ' + str);
}
const over = (top, bottom) => top.rgb.map((c, i) => c * top.a + bottom[i] * (1 - top.a));
const lum = c => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/* Translucent ink over a surface: the colour the eye actually gets. */
const ink = (token, surface) => over(color(token), surface);

const TINTS = ['aurora', 'dusk', 'moss', 'ember', 'ink'];
const dark = block('.nd-app');
const light = block('.nd-app.is-light');
const looks = {
  dark: { vars: dark, tint: t => block(`.nd-app[data-tint="${t}"]`), ground: (v, tv) => tv['--nd-ground'] },
  light: {
    vars: { ...dark, ...light },
    tint: t => block(`.nd-app[data-tint="${t}"]`),
    /* The light tints re-declare only some grounds (aurora keeps the base). */
    ground: (v, tv, t) => {
      const m = new RegExp(`\\.nd-app\\.is-light:not\\(\\.is-plain\\)\\[data-tint="${t}"\\]\\s*\\{([^}]*)\\}`).exec(css);
      const g = m && /--nd-ground:\s*(#[0-9a-f]{6})/i.exec(m[1]);
      return g ? g[1] : light['--nd-ground'];
    },
  },
};
const MIN = 4.5;
const fails = [];
let checked = 0;
function need(look, tint, what, fg, bg) {
  checked++;
  const r = ratio(fg, bg);
  if (r < MIN) fails.push(`${look}/${tint}: ${what} = ${r.toFixed(2)}:1 (< ${MIN})`);
}
for (const [look, L] of Object.entries(looks)) {
  const v = L.vars;
  const veilStops = [...v['--nd-veil'].matchAll(/rgba\([^)]*\)/g)].map(m => color(m[0]));
  assert.strictEqual(veilStops.length, 2, 'the veil has two stops');
  const strength = parseFloat(v['--nd-bg-strength']);
  for (const t of TINTS) {
    const tv = L.tint(t);
    const ground = color(L.ground(v, tv, t)).rgb;
    for (const blobKey of ['--nd-a', '--nd-b', '--nd-c']) {
      const blob = over({ rgb: color(tv[blobKey]).rgb, a: strength * 0.5 }, ground);
      for (const vs of veilStops) {
        const page = over(vs, blob);
        const glass = over(color(v['--nd-glass']), page);
        const glass2 = over(color(v['--nd-glass-2']), glass);
        const solid = over(color(v['--nd-solid']), page);
        const solidLate = over(color(v['--nd-solid-late']), page);
        const lateSoft = over(color(v['--nd-late-soft']), glass);
        const tag = `${t} ${blobKey}`;
        for (const [sn, s] of [['page', page], ['glass', glass], ['pill', glass2], ['solid row', solid]]) {
          need(look, tag, `ink on ${sn}`, ink(v['--nd-ink'], s), s);
          need(look, tag, `dim on ${sn}`, ink(v['--nd-dim'], s), s);
        }
        /* faint is page, card and row text. It is not asked of a filled pill:
           the only faint pill (.nd-group) has a transparent ground. */
        for (const [sn, s] of [['page', page], ['glass', glass], ['solid row', solid], ['solid-late row', solidLate]]) {
          need(look, tag, `faint on ${sn}`, ink(v['--nd-faint'], s), s);
        }
        for (const [sn, s] of [['glass', glass], ['solid row', solid]]) {
          need(look, tag, `ok on ${sn}`, color(v['--nd-ok']).rgb, s);
        }
        need(look, tag, 'late on late-soft glass', color(v['--nd-late']).rgb, lateSoft);
        need(look, tag, 'late on solid-late row', color(v['--nd-late']).rgb, solidLate);
        need(look, tag, 'tick (ok-ink on ok)', color(v['--nd-ok-ink']).rgb, color(v['--nd-ok']).rgb);
      }
    }
  }
}
{
  const m = /\.nd-badge\.is-late\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, 'styles.css has the late badge rule');
  const bg = /background:\s*(#[0-9a-f]{3,6})/i.exec(m[1]);
  const fg = /(?:^|[;\s])color:\s*(#[0-9a-f]{3,6})/i.exec(m[1]);
  assert.ok(bg && fg, 'the late badge sets both colours');
  need('badge', 'late', 'badge text on badge', color(fg[1]).rgb, color(bg[1]).rgb);
}
assert.ok(checked > 500, 'the contrast guard actually evaluated the palette (' + checked + ')');
assert.deepStrictEqual(fails.slice(0, 12), [], `${fails.length} contrast failure(s), first 12 shown`);

/* --nd-ghost (about 2:1) is for strokes and icons. Text may not use it, and
   neither may the placeholders, which are the only prompt for those inputs. */
const GHOST_TEXT_OK = /^\.nd-app \.nd-empty-icon$/;
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (!/(^|[;\s{])color:\s*var\(--nd-ghost\)/.test(m[2])) continue;
  const sel = m[1].trim();
  assert.ok(GHOST_TEXT_OK.test(sel) && !/placeholder/.test(sel), `text rule ${sel} uses --nd-ghost (use --nd-faint)`);
}

/* A done row is told apart by tick + strikethrough, never by fading it: an
   opacity on the row or the Done section is what took its text under 2:1. */
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim();
  if (/\.is-done|\.is-muted/.test(sel) && !/::before/.test(sel)) {
    assert.ok(!/(^|[;\s])opacity\s*:/.test(m[2]), `${sel}: done/muted must not fade text with opacity`);
  }
}

console.log(`look ok (${checked} contrast checks)`);
