'use strict';
/* Ask AI: the chat can be copied (Ruan, 5 Nov 2026).
   1. chatText(): the whole chat as plain text for the clipboard.
   2. The chat's DOM, mounted for real over a fake DOM: a header button that
      copies the whole chat (disabled while there is nothing), a Copy button
      under each answer, an icon-only one on each question; each writes the
      right text with navigator.clipboard.writeText, shows "Copied" with a
      check for 1.6 s, and a failed write shows an error line.
   3. The stylesheet: every kind of message is selectable (Obsidian makes the
      whole app unselectable; iOS 15 reads only the prefixed property), the
      buttons are not, and the question's button shows on hover, at .6 on touch.
   Negative control (done when written): remove user-select from .rv-ai-log,
   or the writeText call, or the catch, and a named check below fails. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const stub = require('./reminders-_stub.cjs');
const icons = [];
stub.setIcon = (n, name) => { n.iconName = name; icons.push(name); };
const { install, FakeEl } = require('./ai-_dom.cjs');
const { body } = install();
FakeEl.ROOT = null;

const C = require('../src/ai/context');

/* ---- 1. chatText ---------------------------------------------------------- */
assert.strictEqual(
  C.chatText({ page: 'Today', ai: 'Claude Code', messages: [{ role: 'user', content: 'What first?' }, { role: 'assistant', content: '  Call mom.\n\n' }] }),
  'Ask AI: Today\n\nYou: What first?\n\nClaude Code: Call mom.',
  'who said what, the answer trimmed');
assert.strictEqual(C.chatText({ page: 'Today', ai: 'X', messages: [] }), 'Ask AI: Today', 'no messages: the heading only');
assert.strictEqual(
  C.chatText({ page: 'P', ai: 'X', messages: [{ role: 'user', content: 'q' }, { role: 'assistant', error: true, content: 'Could not reach X' }, { role: 'assistant', content: 'a' }] }),
  'Ask AI: P\n\nYou: q\n\nX: a', 'an error line is not part of the conversation');

/* ---- 2. the chat, mounted ------------------------------------------------- */
const { mountAskAi } = require('../src/ai/chat');
const written = [];
let clipboardMode = 'ok';
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get: () => (clipboardMode === 'none' ? {} : { clipboard: { writeText: async t => { if (clipboardMode === 'deny') throw new Error('Document is not focused'); written.push(t); } } }),
});
const timers = [];
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
global.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].dead = true; };
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

(async () => {
  const root = new FakeEl('div'); FakeEl.ROOT = root; root.classList.add('rv-app');
  body.appendChild(root);
  const ai = mountAskAi(root, {
    enabled: () => true,
    snapshot: focus => ({ page: 'Today', date: '2026-11-05', today: '2026-11-05', screen: 'Call mom', focus }),
    ask: async () => ({ text: 'Start with **Call mom**.' }),
    providerName: () => 'Claude Code',
    run: async () => ({ ok: true }), save: async () => null, openSettings() {},
  });
  ai.open(null);
  const q = s => root.querySelector(s);
  const all = s => root.querySelectorAll(s);
  const copyAll = q('.rv-ai-copyall');
  assert.ok(copyAll, 'the header has a copy-the-whole-chat button');
  assert.strictEqual(copyAll.getAttribute('aria-label'), 'Copy the whole chat');
  assert.strictEqual(copyAll.querySelector('.rv-icon').iconName, 'copy', 'it wears the lucide copy icon');
  assert.strictEqual(copyAll.disabled, true, 'nothing to copy yet: disabled');
  assert.strictEqual(all('.rv-ai-copy').length, 0, 'no per-message buttons in an empty chat');

  /* one exchange through the real submit path (the AI is a fake) */
  q('.rv-ai-input').value = 'What first?';
  q('.rv-ai-form').dispatch('submit');
  await flush();
  assert.strictEqual(copyAll.disabled, false, 'a chat to copy: enabled');
  assert.strictEqual(all('.rv-ai-msg').length, 2);

  const answerBtn = q('.is-ai').querySelector('.rv-ai-copy');
  assert.ok(answerBtn, 'a Copy button under the answer');
  assert.strictEqual(answerBtn.querySelector('.rv-btn-label').textContent, 'Copy');
  assert.strictEqual(answerBtn.getAttribute('aria-label'), 'Copy this answer');
  const textAt = (m, cls) => m.querySelector(cls);
  const ansEl = q('.is-ai'), youEl = q('.is-you');
  assert.ok(ansEl.children.indexOf(answerBtn.parentNode) > ansEl.children.indexOf(textAt(ansEl, '.rv-ai-text')), 'the button sits after the answer text');
  const qBtn = youEl.querySelector('.rv-ai-copy-q');
  assert.ok(qBtn, 'an icon-only copy button on the question');
  assert.strictEqual(qBtn.querySelector('.rv-btn-label'), null, 'no label on the question button');
  assert.strictEqual(qBtn.getAttribute('aria-label'), 'Copy this question');
  assert.ok(!q('.is-ai').querySelector('.rv-ai-copy-q'), 'only questions get the icon-only button');

  /* the answer: the text as written, Markdown source and all */
  answerBtn.click(); await flush();
  assert.deepStrictEqual(written, ['Start with **Call mom**.'], 'Copy writes the answer');
  assert.ok(answerBtn.classList.contains('is-copied'), 'the button says it worked');
  assert.strictEqual(answerBtn.querySelector('.rv-btn-label').textContent, 'Copied');
  assert.strictEqual(answerBtn.querySelector('.rv-icon').iconName, 'check', 'with a check');
  const t = timers[timers.length - 1];
  assert.ok(t.ms >= 1500 && t.ms <= 1700, 'for about 1.6 s');
  t.fn();
  assert.ok(!answerBtn.classList.contains('is-copied') && answerBtn.querySelector('.rv-btn-label').textContent === 'Copy', 'and goes back');
  assert.strictEqual(answerBtn.querySelector('.rv-icon').iconName, 'copy');

  qBtn.click(); await flush();
  assert.strictEqual(written[1], 'What first?', 'the question button writes the question');
  assert.ok(qBtn.classList.contains('is-copied') && qBtn.querySelector('.rv-icon').iconName === 'check');
  timers[timers.length - 1].fn();
  assert.strictEqual(qBtn.querySelector('.rv-icon').iconName, 'copy');

  copyAll.click(); await flush();
  assert.strictEqual(written[2], 'Ask AI: Today\n\nYou: What first?\n\nClaude Code: Start with **Call mom**.', 'the header button writes the whole chat');
  assert.ok(copyAll.classList.contains('is-copied'));

  /* a refused write is shown, never swallowed */
  const errors = () => all('.is-error').map(e => e.textContent);
  assert.deepStrictEqual(errors(), []);
  clipboardMode = 'deny';
  q('.is-ai').querySelector('.rv-ai-copy').click(); await flush();
  assert.ok(errors().some(e => /Could not copy: Document is not focused/.test(e)), 'a failed write shows an error line: ' + errors());
  assert.ok(!q('.is-ai').querySelector('.rv-ai-copy').classList.contains('is-copied'), 'and no false "Copied"');
  clipboardMode = 'none';
  q('.rv-ai-copyall').click(); await flush();
  assert.strictEqual(errors().filter(e => /Could not copy/.test(e)).length, 2, 'no clipboard at all is shown too');
  assert.ok(!/Could not copy/.test(C.chatText({ page: 'P', ai: 'X', messages: [{ role: 'assistant', error: true, content: 'Could not copy: x' }] })), 'and is not copied into a chat');
  assert.ok(all('.rv-ai-copy').every(b => b.getAttribute('aria-label')), 'every copy button is named');

  /* the chat that was just closed has no buttons left over */
  ai.close(false);
  assert.strictEqual(all('.rv-ai-copy').length + all('.rv-ai-copyall').length, 0);

  /* ---- 3. the stylesheet ---------------------------------------------------- */
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ sel: m[1].trim(), body: m[2], at: m.index });
  const sel = rx => rules.filter(r => r.sel.split(',').some(s => rx.test(s.trim())));
  const hasSel = (rx, prop) => sel(rx).some(r => prop.test(r.body));
  const SEL = /(?:^|[^-])user-select:\s*text/;
  const SEL_PFX = /-webkit-user-select:\s*text/;
  for (const cls of ['rv-ai-log', 'rv-ai-msg', 'rv-ai-text', 'rv-ai-md']) {
    const rx = new RegExp(`^\\.rv-app \\.${cls}$`);
    assert.ok(hasSel(rx, SEL) && hasSel(rx, SEL_PFX), `.${cls} is selectable, prefixed and plain`);
  }
  assert.ok(hasSel(/^\.rv-app \.rv-ai-act-note$/, SEL), 'an action note is selectable');
  for (const rx of [/^\.rv-app \.rv-ai-log button$/, /^\.rv-app button\.rv-ai-copy$/]) {
    assert.ok(hasSel(rx, /-webkit-user-select:\s*none/) && hasSel(rx, /(?:^|[^-])user-select:\s*none/), `buttons stay unselectable: ${rx}`);
  }
  assert.ok(hasSel(/^\.rv-app button\.rv-ai-copy-q$/, /opacity:\s*0\b/), 'the question button is hidden until hover');
  const media = cond => { let out = ''; for (let i = css.indexOf(cond); i >= 0; i = css.indexOf(cond, i + 1)) out += css.slice(i, css.indexOf('\n}', i)); return out; };
  assert.ok(/rv-ai-copy-q\s*\{[^}]*opacity:\s*1/.test(media('@media (hover: hover)')), 'it shows on hover (inside @media (hover: hover))');
  assert.ok(/rv-ai-copy-q\s*\{[^}]*opacity:\s*0\.6/.test(media('@media (hover: none)')), 'and sits at .6 on touch');
  assert.ok(!/\(\?<[=!]|color-mix|:has\(/.test(css), 'nothing the iOS 15 floor lacks');
  for (const m of css.matchAll(/:focus-visible/g)) {
    const ruleStart = css.lastIndexOf('}', m.index) + 1;
    const head = css.slice(ruleStart, css.indexOf('{', m.index));
    assert.ok(!head.includes(','), ':focus-visible stands alone in its rule');
  }

  console.log('ai copy OK');
})().catch(e => { console.error(e); process.exit(1); });
