'use strict';
/* Ask AI: the round button at the bottom right, and the chat it opens.

   The AI is told about the page you are on (src/ai/context.js) — read
   afresh at every question, so it follows you when the page changes — and,
   when you asked from an item's menu, that item. An answer can end with
   suggested changes (src/ai/actions.js); each becomes a button, and nothing
   is written until you tap it. The chat lives in memory only; "Save" writes
   it to a note when you want to keep it.

   Wide: a floating card above the page, which stays usable beside it. Phone
   (the narrow pane): a sheet over a scrim, like the dock's More sheet.
   DOM on the standard API only (no innerHTML), so the preview harness runs
   this exact code. What answering, running and saving DO is passed in. */

const { el, button, clear } = require('../dom');
const C = require('./context');
const A = require('./actions');
const MD = require('./md');

const ASK = ['What should I do first?', 'Sum up this page', 'What am I forgetting?'];
const ASK_ITEM = ['Help me get this done', 'Break it into small steps', 'When should I do it?'];

/* root: the app root. o: {
     enabled() -> show the button at all,
     snapshot(focus) -> { page, date, today, screen, focus } as it is NOW,
     ask({ system, rules, page, messages }) -> Promise<{ text, model }> — system is rules + page together (API routes); the plan CLIs take them apart,
       with the page on stdin,
     providerName() -> 'Claude Code', 'Gemini', …,
     run(action) -> Promise<{ ok, text }> — make one confirmed change,
     save(markdown, title) -> Promise<string|null> — the note's path,
     openSettings(),
   } */
function mountAskAi(root, o) {
  const fab = button(root, 'rv-ai-fab', null, () => open(null), 'wand-2');
  fab.setAttribute('aria-label', 'Ask AI');
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.title = 'Ask AI';

  let ui = null; /* the open chat's elements */
  let focus = null;
  let messages = []; /* { role, content, actions?: [{ a, state, note }] , error? } */
  let busy = false;
  let savedPath = null;
  /* Which chat this is: an answer that lands after New chat, Close or a
     new item is for a chat that no longer exists, and is dropped. */
  let chatId = 0;

  function snapshot() { return o.snapshot(focus); }

  /* From the button: the page. From an item's menu: that item — a new chat
     unless it is the item already being talked about. */
  function open(item) {
    if (item && !focusSame(item)) { messages = []; savedPath = null; busy = false; chatId++; focus = item; }
    if (!ui) build();
    draw();
    fab.hidden = true;
    /* On a phone the keyboard waits for a tap in the box: raised at once it
       covers the suggestions on a small screen. */
    if (narrow()) ui.panel.focus(); else ui.input.focus();
  }
  const narrow = () => root.classList.contains('is-narrow');
  const focusSame = item => focus && item && focus.text === item.text && focus.kind === item.kind;

  /* Closing ends the chat: it lives only while open ("Save" keeps it). */
  function close(restore) {
    if (!ui) return;
    ui.wrap.remove();
    ui = null;
    messages = []; focus = null; savedPath = null; busy = false; chatId++;
    sync();
    if (restore && fab.isConnected && !fab.hidden) fab.focus();
  }

  function reset() { messages = []; focus = null; savedPath = null; busy = false; chatId++; draw(); if (ui && !narrow()) ui.input.focus(); }

  function build() {
    const wrap = el(root, 'div', 'rv-ai-wrap');
    const scrim = el(wrap, 'div', 'rv-scrim rv-ai-scrim');
    scrim.addEventListener('click', () => close(true));
    const panel = el(wrap, 'section', 'rv-ai');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ask AI');
    panel.tabIndex = -1;

    const head = el(panel, 'header', 'rv-ai-head');
    const title = el(head, 'div', 'rv-ai-title');
    el(title, 'span', 'rv-ai-h', 'Ask AI');
    const who = el(title, 'button', 'rv-ai-who');
    who.type = 'button';
    who.addEventListener('click', e => { e.preventDefault(); o.openSettings(); });
    const save = button(head, 'rv-ai-icon', null, () => saveChat(), 'file-down');
    save.setAttribute('aria-label', 'Save this chat to a note');
    save.title = 'Save to a note';
    const fresh = button(head, 'rv-ai-icon', null, () => reset(), 'rotate-ccw');
    fresh.setAttribute('aria-label', 'New chat');
    fresh.title = 'New chat';
    const shut = button(head, 'rv-ai-icon', null, () => close(true), 'x');
    shut.setAttribute('aria-label', 'Close');

    const seen = el(panel, 'details', 'rv-ai-seen');
    const seenSum = el(seen, 'summary', 'rv-ai-seen-sum');
    const seenBody = el(seen, 'pre', 'rv-ai-seen-body');
    seen.addEventListener('toggle', () => { if (seen.open) seenBody.textContent = C.pageContext(snapshot()); });

    const log = el(panel, 'div', 'rv-ai-log');
    log.setAttribute('aria-live', 'polite');

    const form = el(panel, 'form', 'rv-ai-form');
    const input = el(form, 'textarea', 'rv-ai-input');
    input.rows = 1;
    input.placeholder = 'Ask about this page…';
    input.setAttribute('aria-label', 'Your question');
    const send = button(form, 'rv-ai-send', null, null, 'arrow-up');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Send');
    form.addEventListener('submit', e => { e.preventDefault(); submit(); });
    input.addEventListener('input', grow);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !root.ownerDocument.body.classList.contains('is-mobile')) { e.preventDefault(); submit(); }
    });

    /* The root listens for single keys (n, t, 1-7, arrows); none are meant
       for the chat. Escape closes it. */
    wrap.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
    });

    ui = { wrap, panel, who, save, seen, seenSum, seenBody, log, input, send };
  }

  function grow() {
    if (!ui) return;
    ui.input.style.height = 'auto';
    ui.input.style.height = Math.min(ui.input.scrollHeight + (ui.input.offsetHeight - ui.input.clientHeight), 140) + 'px';
  }

  function draw() {
    if (!ui) return;
    const snap = snapshot();
    clear(ui.who);
    el(ui.who, 'span', 'rv-ai-who-name', o.providerName());
    ui.who.setAttribute('aria-label', `Using ${o.providerName()} — change in Settings`);
    ui.seenSum.textContent = 'Sees: ' + C.seenLine(snap);
    if (ui.seen.open) ui.seenBody.textContent = C.pageContext(snap);
    ui.save.disabled = !messages.some(m => m.role === 'assistant' && !m.error);
    ui.save.classList.toggle('is-saved', !!savedPath);
    ui.save.title = savedPath ? 'Saved to ' + savedPath : 'Save to a note';
    ui.save.setAttribute('aria-label', savedPath ? 'Saved to ' + savedPath : 'Save this chat to a note');
    ui.input.placeholder = focus ? `Ask about "${focus.text}"…` : 'Ask about this page…';
    ui.send.disabled = busy;

    const log = ui.log;
    clear(log);
    if (!messages.length) {
      const empty = el(log, 'div', 'rv-ai-empty');
      el(empty, 'p', 'rv-ai-empty-lead', focus ? `Ask anything about "${focus.text}".` : `Ask anything about ${snap.page}.`);
      el(empty, 'p', 'rv-ai-empty-note', 'It reads what is on this page, nothing else. It can suggest changes; nothing changes until you tap one.');
      const chips = el(empty, 'div', 'rv-ai-chips');
      for (const q of focus ? ASK_ITEM : ASK) button(chips, 'rv-ai-chip', q, () => { ui.input.value = q; submit(); });
    }
    for (const m of messages) {
      const b = el(log, 'div', 'rv-ai-msg ' + (m.role === 'user' ? 'is-you' : m.error ? 'is-error' : 'is-ai'));
      /* Your words and an error stay plain; an answer is Markdown. */
      if (m.role === 'assistant' && !m.error) MD.render(el(b, 'div', 'rv-ai-text rv-ai-md'), m.content);
      else el(b, 'div', 'rv-ai-text', m.content);
      if (m.error && /Settings/.test(m.content)) button(b, 'rv-ai-link', 'Open Settings', () => o.openSettings());
      if (m.actions && m.actions.length) {
        const acts = el(b, 'div', 'rv-ai-acts');
        for (const act of m.actions) {
          const done = act.state === 'done';
          const btn = button(acts, 'rv-ai-act' + (done ? ' is-done' : act.state === 'failed' ? ' is-failed' : ''), done ? '✓ ' + act.label : act.label, () => runAction(act), done ? null : 'check');
          btn.disabled = act.state !== 'idle' && act.state !== 'failed';
          if (act.note) el(acts, 'div', 'rv-ai-act-note', act.note);
        }
      }
    }
    if (busy) {
      const t = el(log, 'div', 'rv-ai-msg is-ai is-thinking');
      t.setAttribute('aria-label', 'Thinking');
      for (let i = 0; i < 3; i++) el(t, 'span', 'rv-ai-dot');
    }
    log.scrollTop = log.scrollHeight;
  }

  async function submit() {
    if (!ui || busy) return;
    const q = ui.input.value.trim();
    if (!q) return;
    ui.input.value = '';
    grow();
    messages.push({ role: 'user', content: q });
    savedPath = null;
    busy = true;
    draw();
    const snap = snapshot();
    const page = C.pageContext(snap);
    const system = C.systemPrompt({ context: page, today: snap.today, focus: snap.focus });
    const rules = C.rules({ today: snap.today, focus: snap.focus });
    const history = messages.filter(m => !m.error).map(m => ({ role: m.role, content: m.raw || m.content }));
    const asked = chatId;
    try {
      const r = await o.ask({ system, rules, page, messages: history });
      if (asked !== chatId) return;
      const split = A.splitReply(r.text, snap.today);
      messages.push({
        role: 'assistant', raw: r.text, content: split.text || (split.actions.length ? 'Here is what I would change:' : '…'),
        actions: split.actions.map(a => ({ a, label: A.label(a, snap.today), state: 'idle', note: '' })),
      });
    } catch (e) {
      if (asked !== chatId) return;
      messages.push({ role: 'assistant', error: true, content: String((e && e.message) || e) });
    }
    busy = false;
    const typing = ui && root.ownerDocument.activeElement === ui.input;
    draw();
    if (ui && (typing || !narrow())) ui.input.focus();
  }

  async function runAction(act) {
    if (act.state === 'busy' || act.state === 'done') return;
    act.state = 'busy';
    act.note = '';
    draw();
    let r;
    try { r = await o.run(act.a); } catch (e) { r = { ok: false, text: String((e && e.message) || e) }; }
    act.state = r && r.ok ? 'done' : 'failed';
    act.note = r && r.ok ? '' : ((r && r.text) || 'That could not be done.');
    draw();
  }

  async function saveChat() {
    if (!messages.length) return;
    const snap = snapshot();
    const lines = [`Page: ${snap.page}${focus ? ` · about "${focus.text}"` : ''} · ${o.providerName()}`, ''];
    for (const m of messages) lines.push(`**${m.role === 'user' ? 'You' : 'AI'}:** ${m.content}`, '');
    try {
      savedPath = await o.save(lines.join('\n').trim() + '\n', focus ? focus.text : snap.page);
      if (!savedPath) throw new Error('there are already too many saved chats with that name today');
    } catch (e) { savedPath = null; messages.push({ role: 'assistant', error: true, content: 'Could not save the chat: ' + String((e && e.message) || e) }); }
    draw();
  }

  /* The app redrew: the page may have changed under the chat, and the
     setting may have turned the button off. */
  function sync() {
    const on = !!o.enabled();
    if (!on && ui) close(false);
    fab.hidden = !on || !!ui;
    root.classList.toggle('has-ai-fab', on);
    if (ui) draw();
  }

  return {
    open, close, sync,
    isOpen: () => !!ui,
    stop() { close(false); fab.remove(); root.classList.remove('has-ai-fab'); },
  };
}

module.exports = { mountAskAi };
