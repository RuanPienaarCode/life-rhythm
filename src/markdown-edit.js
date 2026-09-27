'use strict';
/* What a small writing box's toolbar does, as pure transforms over
   (text, selectionStart, selectionEnd) → { text, start, end }.

   None of this touches the DOM, which is the point: every button has an
   OFF state — press bold on bold text and it should come back off — and
   the off case is the one that is easy to get wrong. Keeping the logic
   here means it can be tested by assertion rather than by clicking.

   No lookbehind regex anywhere (iOS 15 parses this file). */

/* ---- inline markers -------------------------------------------------- */

/* Wrap the selection in `marker`, or take the marker off if it is already
   there — whether it sits inside the selection ("**word**" selected) or
   just outside it ("word" selected between the stars). */
function wrap(text, start, end, marker) {
  const len = marker.length;
  /* Pull the ends in past whitespace first. Dragging a selection almost
     always catches the trailing newline, and "**line\n**" is not bold
     text, it is two broken markers — the spaces stay outside. */
  let a = start, b = end;
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  if (a === b) { a = start; b = end; }
  start = a; end = b;
  const sel = text.slice(start, end);

  if (sel.length >= 2 * len && sel.slice(0, len) === marker && sel.slice(sel.length - len) === marker) {
    const inner = sel.slice(len, sel.length - len);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  if (start >= len && text.slice(start - len, start) === marker && text.slice(end, end + len) === marker) {
    return { text: text.slice(0, start - len) + sel + text.slice(end + len), start: start - len, end: end - len };
  }
  return {
    text: text.slice(0, start) + marker + sel + marker + text.slice(end),
    start: start + len,
    end: end + len,
  };
}

/* ---- line prefixes --------------------------------------------------- */

/* The whole lines the selection touches. A selection that ends exactly at
   a line break belongs to the line before it, not the one after — or
   selecting three lines by dragging would quietly format four. */
function lineRange(text, start, end) {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const tail = end > start && text[end - 1] === '\n' ? end - 1 : end;
  let to = text.indexOf('\n', tail);
  if (to === -1) to = text.length;
  return [from, to];
}

const TASK_RE = /^(\s*)[-*+] \[[ xX]\] /;
const BULLET_RE = /^(\s*)[-*+] /;

/* `re` strips the marker; `has` decides whether the line already counts as
   this kind. They differ for the bullet: "- [ ] thing" starts with "- ",
   so a naive test would call a task a bullet and then strip only the dash,
   leaving "[ ] thing" behind. */
const PREFIXES = {
  bullet: { re: BULLET_RE, has: l => BULLET_RE.test(l) && !TASK_RE.test(l), make: () => '- ' },
  task: { re: TASK_RE, has: l => TASK_RE.test(l), make: () => '- [ ] ' },
  quote: { re: /^(\s*)> /, has: l => /^(\s*)> /.test(l), make: () => '> ' },
  heading: { re: /^(\s*)#{1,6} /, has: l => /^(\s*)#{1,6} /.test(l), make: () => '### ' },
  number: { re: /^(\s*)\d+\. /, has: l => /^(\s*)\d+\. /.test(l), make: (i) => `${i + 1}. ` },
};

/* Add the prefix to every line the selection touches, or strip it from all
   of them when they all already have it. Blank lines inside a block are
   left alone rather than turned into empty bullets.

   A collapsed caret (start === end, always a single line — see
   lineRange) never SELECTS the transformed line: it stays collapsed at
   the same logical spot in the text, so typing continues the line rather
   than replacing a highlighted marker. A real multi-char selection keeps
   selecting the whole transformed block, as before. */
function linePrefix(text, start, end, kind) {
  const spec = PREFIXES[kind];
  if (!spec) return { text, start, end };
  const collapsed = start === end;
  const [from, to] = lineRange(text, start, end);
  const relIn = collapsed ? start - from : null;
  const lines = text.slice(from, to).split('\n');
  const real = lines.filter(l => l.trim() !== '');
  const allHave = real.length > 0 && real.every(spec.has);

  let n = 0;
  let relOut = null;
  const out = lines.map(l => {
    if (l.trim() === '' && lines.length > 1) return l;
    if (allHave) {
      const stripped = l.replace(spec.re, '$1');
      if (collapsed) {
        const m = spec.re.exec(l);
        const lead = m[1].length;
        const removedLen = m[0].length - lead;
        relOut = relIn <= lead ? relIn : (relIn <= lead + removedLen ? lead : relIn - removedLen);
      }
      return stripped;
    }
    /* A line already carrying a DIFFERENT list marker swaps rather than
       stacking, so a bullet list becomes a task list cleanly. Task first:
       it is the longer marker and contains the bullet's. */
    const bare = l.replace(TASK_RE, '$1').replace(BULLET_RE, '$1').replace(PREFIXES.number.re, '$1');
    const marker = spec.make(n++);
    const made = bare.replace(/^(\s*)/, `$1${marker}`);
    if (collapsed) {
      const lead = /^(\s*)/.exec(l)[1].length;
      const strippedLen = l.length - bare.length;
      const bpos = relIn <= lead ? relIn : Math.max(lead, relIn - strippedLen);
      relOut = lead + marker.length + Math.max(0, bpos - lead);
    }
    return made;
  }).join('\n');

  if (collapsed) {
    const at = from + relOut;
    return { text: text.slice(0, from) + out + text.slice(to), start: at, end: at };
  }
  return { text: text.slice(0, from) + out + text.slice(to), start: from, end: from + out.length };
}

/* ---- links ----------------------------------------------------------- */

const URLISH = /^(https?:\/\/|obsidian:\/\/|mailto:)/i;

/* Selecting a URL puts it in the target and leaves the cursor in the
   label; selecting words does the reverse. Either way the next thing you
   type is the thing you still have to supply. */
function link(text, start, end) {
  const sel = text.slice(start, end).trim();
  if (sel && URLISH.test(sel)) {
    const out = `${text.slice(0, start)}[](${sel})${text.slice(end)}`;
    return { text: out, start: start + 1, end: start + 1 };
  }
  const label = sel || 'text';
  const out = `${text.slice(0, start)}[${label}](url)${text.slice(end)}`;
  const at = start + 1 + label.length + 2;
  return { text: out, start: at, end: at + 3 };
}

/* ---- the toolbar ----------------------------------------------------- */

/* id, label, icon and the transform — one table so the modal only has to
   loop, and a button can never exist without an action behind it. */
const TOOLS = [
  { id: 'bold', label: 'Bold', icon: 'bold', key: 'b', run: (t, s, e) => wrap(t, s, e, '**') },
  { id: 'italic', label: 'Italic', icon: 'italic', key: 'i', run: (t, s, e) => wrap(t, s, e, '*') },
  { id: 'heading', label: 'Heading', icon: 'heading', run: (t, s, e) => linePrefix(t, s, e, 'heading') },
  { id: 'bullet', label: 'Bullet list', icon: 'list', run: (t, s, e) => linePrefix(t, s, e, 'bullet') },
  { id: 'task', label: 'Task', icon: 'square-check', run: (t, s, e) => linePrefix(t, s, e, 'task') },
  { id: 'quote', label: 'Quote', icon: 'text-quote', run: (t, s, e) => linePrefix(t, s, e, 'quote') },
  { id: 'link', label: 'Link', icon: 'link', key: 'k', run: (t, s, e) => link(t, s, e) },
];

module.exports = { wrap, linePrefix, link, lineRange, TOOLS, PREFIXES };
