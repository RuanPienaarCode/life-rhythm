'use strict';
/* Ask AI: an answer is Markdown, shown as Markdown (plan-ai spec 5):
   headings, lists, tables inside a wrapper that scrolls sideways, code blocks
   with their own sideways scroll. Built with createElement and textContent only
   (no innerHTML), so nothing an answer says can become markup. */
const assert = require('node:assert');
require('./reminders-_stub.cjs');

class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.className = ''; this.textContent = ''; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  set href(v) { this.attrs.href = v; }
  get firstChild() { return this.children[0] || null; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); }
}
global.document = { createElement: tag => new N(tag), createTextNode: t => { const n = new N('#text'); n.textContent = t; return n; } };
const M = require('../src/ai/md');

const esc = s => String(s).replace(/</g, '&lt;');
function ser(n) {
  if (n.tag === '#text') return esc(n.textContent);
  const cls = n.className ? '.' + n.className.split(' ').join('.') : '';
  const at = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  const inner = n.children.length ? n.children.map(ser).join('') : esc(n.textContent);
  return `<${n.tag}${cls}${at}>${inner}</${n.tag}>`;
}
const draw = text => { const root = new N('div'); M.render(root, text); return root.children.map(ser).join(''); };

/* headings: any depth is drawn small, none bigger than the chat can hold */
assert.strictEqual(draw('# Big\n## Next\n###### Tiny'), '<h3.rv-md-h.rv-md-h1>Big</h3><h4.rv-md-h.rv-md-h2>Next</h4><h6.rv-md-h.rv-md-h6>Tiny</h6>');

/* paragraphs, soft line breaks, inline marks */
assert.strictEqual(draw('One **bold** and *it* and `code`.\nSecond line.\n\nNew para'), '<p.rv-md-p>One <strong>bold</strong> and <em>it</em> and <code.rv-md-code>code</code>.<br></br>Second line.</p><p.rv-md-p>New para</p>');
assert.strictEqual(draw('snake_case_name and 2*3*4 stay'), '<p.rv-md-p>snake_case_name and 2*3*4 stay</p>', 'underscores inside words and spaced stars are not emphasis');
assert.strictEqual(draw('**unclosed'), '<p.rv-md-p>**unclosed</p>');

/* lists */
assert.strictEqual(draw('- a\n- b\n\n1. one\n2. two'), '<ul.rv-md-ul><li>a</li><li>b</li></ul><ol.rv-md-ol><li>one</li><li>two</li></ol>');
assert.strictEqual(draw('* a\n  * inner\n* b'), '<ul.rv-md-ul><li>a<ul.rv-md-ul><li>inner</li></ul></li><li>b</li></ul>');
assert.strictEqual(draw('3. start at three\n4. next'), '<ol.rv-md-ol start="3"><li>start at three</li><li>next</li></ol>');
assert.strictEqual(draw('- [ ] todo\n- [x] done'), '<ul.rv-md-ul><li>☐ todo</li><li>☑ done</li></ul>');

/* tables sit in a wrapper that scrolls sideways */
const t = draw('| Name | Due |\n|:--|--:|\n| Call mom | Tue |\n| Pay `rent` | **Fri** |');
assert.strictEqual(t, '<div.rv-md-scroll><table.rv-md-table><thead><tr><th>Name</th><th.is-right>Due</th></tr></thead><tbody><tr><td>Call mom</td><td.is-right>Tue</td></tr><tr><td>Pay <code.rv-md-code>rent</code></td><td.is-right><strong>Fri</strong></td></tr></tbody></table></div>');
assert.strictEqual(draw('| a | b |\n|---|---|').includes('<tbody></tbody>'), true, 'a table with no rows still draws');
assert.ok(!/<table/.test(draw('a | b\nnot a table')), 'a pipe in a sentence is not a table');

/* code blocks */
assert.strictEqual(draw('```js\nconst a = 1;\n  indented\n```'), '<pre.rv-md-pre><code data-lang="js">const a = 1;\n  indented</code></pre>');
assert.strictEqual(draw('```\nno close\nstill code'), '<pre.rv-md-pre><code>no close\nstill code</code></pre>', 'an unclosed fence runs to the end');
assert.strictEqual(draw('```\n# not a heading\n- not a list\n```'), '<pre.rv-md-pre><code># not a heading\n- not a list</code></pre>');

/* quotes and rules */
assert.strictEqual(draw('> quoted\n> more'), '<blockquote.rv-md-quote>quoted<br></br>more</blockquote>');
assert.strictEqual(draw('a\n\n---\n\nb'), '<p.rv-md-p>a</p><hr.rv-md-hr></hr><p.rv-md-p>b</p>');

/* links: web addresses only; images and markup never become elements */
assert.strictEqual(draw('[site](https://example.com/a?b=1)'), '<p.rv-md-p><a.external-link href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">site</a></p>');
assert.ok(!/<a/.test(draw('[x](javascript:alert(1)) [y](file:///etc/passwd) [z](obsidian://open)')), 'only http(s) is a link');
assert.ok(draw('[x](javascript:alert(1))').includes('x'), 'its words stay');
assert.ok(!/<img/.test(draw('![pic](https://example.com/p.png)')), 'no images');
assert.strictEqual(draw('<script>alert(1)</script> <img src=x onerror=1>'), '<p.rv-md-p>&lt;script>alert(1)&lt;/script> &lt;img src=x onerror=1></p>', 'raw HTML is text, not an element');
assert.strictEqual(draw('<b>x</b>'), '<p.rv-md-p>&lt;b>x&lt;/b></p>');

/* empty and odd input */
assert.strictEqual(draw(''), '');
assert.strictEqual(draw(null), '');
assert.strictEqual(draw('\n\n  \n'), '');
assert.ok(draw('x'.repeat(5000)).length > 5000, 'a long run is kept');

/* no innerHTML anywhere in the renderer */
const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/ai/md.js'), 'utf8');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src), 'no innerHTML');
assert.ok(!src.includes('(?<'), 'no lookbehind');

/* the stylesheet gives the scroll wrappers their overflow */
const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/ai/styles.css'), 'utf8');
assert.ok(/\.rv-md-scroll\s*\{[^}]*overflow-x:\s*auto/.test(css), 'tables scroll sideways in their wrapper');
assert.ok(/\.rv-md-table\s*\{[^}]*width:\s*max-content/.test(css) && /\.rv-md-table\s*\{[^}]*min-width:\s*100%/.test(css), 'the table keeps its natural width');
assert.ok(/\.rv-md-pre\s*\{[^}]*overflow-x:\s*auto/.test(css), 'code blocks scroll sideways');
assert.ok(/\.rv-md-pre[^{]*\{[^}]*font-family:\s*var\(--font-monospace/.test(css) || /\.rv-md-pre code[^{]*\{[^}]*font-family:\s*var\(--font-monospace/.test(css), 'code is monospace');
assert.ok(/\.rv-ai-msg\.is-ai[^{]*\{[^}]*(min-width:\s*0|overflow)/.test(css) || /\.rv-ai-md\s*\{[^}]*min-width:\s*0/.test(css), 'a wide table cannot stretch the bubble');

console.log('ai markdown OK');
