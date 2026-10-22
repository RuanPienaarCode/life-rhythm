'use strict';
/* Bundle-safety gates for the real mobile floor (iOS 15 WebKit):
   1. no lookbehind regex literals in src/;  2. no Node APIs in src/;
   3. no innerHTML assignment, outerHTML, insertAdjacentHTML, document.write;
   4. no Node globals (process., __dirname, Buffer);  5. src/styles.css uses
   nothing iOS 15 WebKit cannot parse (see lintCss);  6. the built main.js (when
   present) re-parses for safari15 with no esbuild warning, evaluates against an
   obsidian stub and exports a Plugin subclass. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src', 'reminders');
const NODE_REQUIRES = /require\(\s*['"](?:node:)?(fs|path|os|child_process|crypto|http|https|net|electron)['"]\s*\)/;

/* Each ban is a [regex, why]. `process.` and `Buffer` are anchored so a word
   that merely ends in them (a comment saying "post-process.") does not trip. */
const JS_BANS = [
  [/\.innerHTML\s*=/, 'innerHTML assignment — build DOM instead'],
  [/outerHTML/, 'outerHTML — build DOM instead'],
  [/insertAdjacentHTML/, 'insertAdjacentHTML — build DOM instead'],
  [/document\.write\b/, 'document.write'],
  [/(^|[^\w.$-])process\./, 'Node global process — undefined on mobile'],
  [/__dirname|__filename/, 'Node global __dirname/__filename'],
  [/(^|[^\w.$])Buffer\b/, 'Node global Buffer — undefined on mobile'],
];

for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
  assert.ok(!text.includes('(?<'), `${f}: lookbehind/named-group regex literal — iOS 15 fatal`);
  assert.ok(!NODE_REQUIRES.test(text), `${f}: Node API require — mobile fatal`);
  for (const [re, why] of JS_BANS) assert.ok(!re.test(text), `${f}: ${why}`);
}

/* ---- src/styles.css ---------------------------------------------------------
   An unknown token on iOS 15 either drops the declaration or (for a selector)
   the whole rule, silently, and only on the phone. So the stylesheet may not use:
   color-mix(), :has(, @container, dvh units, @layer, CSS nesting, or a
   backdrop-filter without its -webkit- twin in the same rule; and !important is
   banned outright (the store review bot flags it; win on specificity instead).
   Comments are stripped first, so prose that names a banned thing is fine. */
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

function lintCss(raw) {
  const css = stripComments(raw);
  const problems = [];
  const bans = [
    [/color-mix\s*\(/, 'color-mix() needs Safari 16.2'],
    [/:has\s*\(/, ':has() needs Safari 15.4'],
    [/@container\b/, '@container needs Safari 16'],
    [/\d(?:dvh|svh|lvh|dvw|svw|lvw)\b/, 'dvh/svh/lvh units need Safari 15.4/16'],
    [/@layer\b/, '@layer needs Safari 15.4'],
    [/!\s*important/, '!important'],
    [/(^|[^\w-])inset\s*:/, 'the inset shorthand needs Safari 14.1 and is banned here'],
  ];
  for (const [re, why] of bans) if (re.test(css)) problems.push(why);
  /* Walk the braces: a rule block opened inside another rule block is nesting;
     inside an @media/@supports/@keyframes block it is not. Selectors carrying
     a bare `&` are nesting too. */
  const stack = [];
  let head = '';
  const rules = [];
  let body = '';
  for (const ch of css) {
    if (ch === '{') {
      const sel = head.trim();
      const isAt = sel.startsWith('@');
      if (stack.length && stack[stack.length - 1].kind === 'rule') problems.push('nested rule inside ' + stack[stack.length - 1].sel);
      if (!isAt && /&/.test(sel)) problems.push('nesting selector: ' + sel);
      stack.push({ kind: isAt ? 'at' : 'rule', sel, body: '' });
      head = '';
    } else if (ch === '}') {
      const top = stack.pop();
      if (top && top.kind === 'rule') rules.push(top);
      head = '';
    } else if (stack.length && stack[stack.length - 1].kind === 'rule') {
      stack[stack.length - 1].body += ch;
    } else {
      head += ch;
    }
  }
  for (const r of rules) {
    if (/(^|[;\s])backdrop-filter\s*:/.test(r.body) && !/-webkit-backdrop-filter\s*:/.test(r.body)) {
      problems.push('backdrop-filter without -webkit-backdrop-filter: ' + r.sel);
    }
  }
  return problems;
}
module.exports = { lintCss, stripComments };

const cssProblems = lintCss(fs.readFileSync(path.join(srcDir, 'styles.css'), 'utf8'));
assert.deepStrictEqual(cssProblems, [], 'src/styles.css: ' + cssProblems.join('; '));

/* Negative controls: the linter must reject each hazard, and must not reject
   the sanctioned forms - otherwise the gate above proves nothing. */
const bad = {
  'color-mix()': '.a { color: color-mix(in srgb, red, blue); }',
  ':has(': '.a:has(.b) { color: red; }',
  '@container': '@container (min-width: 1px) { .a { color: red; } }',
  'dvh': '.a { height: 100dvh; }',
  '@layer': '@layer x { .a { color: red; } }',
  '!important': '.a { display: none !important; }',
  'nesting (&)': '.a { & .b { color: red; } }',
  'nesting (nested block)': '.a { .b { color: red; } }',
  'unpaired backdrop-filter': '.a { backdrop-filter: blur(4px); }',
  'webkit twin wrong rule': '.a { -webkit-backdrop-filter: blur(4px); } .b { backdrop-filter: blur(4px); }',
  'inset shorthand': '.a { inset: 0; }',
};
for (const [name, css] of Object.entries(bad)) assert.ok(lintCss(css).length > 0, `lintCss must reject ${name}`);
const good = [
  '.a { -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); box-shadow: inset 0 1px 0 red; }',
  '/* mentions color-mix() and !important and :has( in prose */ .a { color: red; }',
  '@media (max-width: 600px) { .a { color: red; } } @keyframes k { 0% { opacity: 0; } 100% { opacity: 1; } }',
];
for (const css of good) assert.deepStrictEqual(lintCss(css), [], 'lintCss must accept: ' + css);

const bundlePath = path.join(root, 'main.js');
if (fs.existsSync(bundlePath)) {
  const stub = {
    Plugin: class Plugin {}, ItemView: class ItemView {}, Modal: class Modal {}, Setting: class Setting {},
    PluginSettingTab: class PluginSettingTab {}, Notice: class Notice {}, TFile: class TFile {}, TFolder: class TFolder {},
    normalizePath: p => p, setIcon: () => {}, FuzzySuggestModal: class FuzzySuggestModal {}, Menu: class Menu {}, Platform: { isMobile: false },
  };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'obsidian') return stub;
    return origLoad.call(this, request, ...rest);
  };
  try {
    const text = fs.readFileSync(bundlePath, 'utf8');
    assert.ok(!text.includes('(?<'), 'main.js: lookbehind survived into the bundle');
    for (const [re, why] of JS_BANS) assert.ok(!re.test(text), `main.js: ${why}`);
    /* esbuild is the parser the build uses. It does not warn about newer syntax
       (a lookbehind literal, a class static block, `??`): it silently lowers
       it for the target. So the proof is a fixed point - the bundle, already
       built for safari15, must come out byte-identical whether esbuild lowers
       it for safari15 or leaves it alone (esnext). Any difference means the
       bundle holds syntax iOS 15 WebKit cannot parse. Any warning fails too. */
    const esbuild = require('esbuild');
    const lower = target => esbuild.transformSync(text, { loader: 'js', target, logLevel: 'silent', legalComments: 'none' });
    const safari = lower('safari15');
    assert.deepStrictEqual(safari.warnings.map(w => w.text), [], 'main.js: esbuild safari15 re-parse warned');
    assert.strictEqual(safari.code, lower('esnext').code, 'main.js: holds syntax newer than safari15 (esbuild had to lower it)');
    delete require.cache[bundlePath];
    const exported = require(bundlePath);
    assert.strictEqual(typeof exported, 'function', 'bundle must export the plugin class');
    assert.ok(exported.prototype instanceof stub.Plugin, 'export must extend obsidian.Plugin');
  } finally {
    Module._load = origLoad;
  }
  console.log('ios hazards OK (bundle evaluated)');
} else {
  console.log('ios hazards OK (src only — main.js not built yet)');
}
