'use strict';
/* Ask AI: an answer drawn as Markdown. Headings, paragraphs, bullet and
   numbered lists (nested), task boxes, tables, fenced code, quotes, rules,
   and **bold**, *italic*, `code` and [links](https://…) inside a line.

   Every node is built with createElement / createTextNode, so nothing an
   answer says can become markup: raw HTML shows as text, an image shows as
   its description, and only http(s) addresses become links. A table sits in
   a wrapper that scrolls sideways and a code block scrolls on its own
   (src/ai/styles.css), so a wide one never stretches the chat.
   No Obsidian renderer: this runs the same in the preview harness and in the
   tests. */

const { el } = require('../dom');

const text = (parent, s) => { if (s) parent.appendChild(document.createTextNode(s)); };
const WEB = /^https?:\/\/[^\s<>"']+$/i;

/* ---- inline ------------------------------------------------------------ */

const isWord = c => !!c && /[A-Za-z0-9]/.test(c);
const LINK = /^\[([^\]]*)\]\(([^)\s]*(?:\([^)\s]*\)[^)\s]*)*)(?:\s+"[^"]*")?\)/;

/* depth stops a link's words from holding another link or a pile of nesting. */
function inline(parent, src, depth) {
  const s = String(src);
  let buf = '';
  const flush = () => { text(parent, buf); buf = ''; };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    let m;
    if (c === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|>~]/.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(s.slice(i));
      if (m) { flush(); el(parent, 'code', 'rv-md-code', m[2].trim()); i += m[0].length; continue; }
    }
    if (c === '!' && s[i + 1] === '[') {
      m = LINK.exec(s.slice(i + 1));
      if (m) { buf += m[1]; i += 1 + m[0].length; continue; }
    }
    if (c === '[' && !depth) {
      m = LINK.exec(s.slice(i));
      if (m) {
        flush();
        if (WEB.test(m[2])) {
          const a = el(parent, 'a', 'external-link');
          a.setAttribute('href', m[2]);
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
          inline(a, m[1], 1);
        } else inline(parent, m[1], 1);
        i += m[0].length;
        continue;
      }
    }
    if ((c === '*' || c === '_') && s[i + 1] === c && depth < 3) {
      m = new RegExp('^\\' + c + '\\' + c + '(?=\\S)([\\s\\S]*?\\S)\\' + c + '\\' + c).exec(s.slice(i));
      if (m) { flush(); inline(el(parent, 'strong'), m[1], (depth || 0) + 1); i += m[0].length; continue; }
    }
    if ((c === '*' || c === '_') && s[i + 1] !== c && depth < 3 && !isWord(s[i - 1]) && s[i + 1] && /\S/.test(s[i + 1])) {
      m = new RegExp('^\\' + c + '([^\\s' + (c === '*' ? '*' : '_') + '](?:[^' + (c === '*' ? '*' : '_') + ']*[^\\s' + (c === '*' ? '*' : '_') + '])?)\\' + c).exec(s.slice(i));
      if (m && !isWord(s[i + m[0].length])) { flush(); inline(el(parent, 'em'), m[1], (depth || 0) + 1); i += m[0].length; continue; }
    }
    buf += c;
    i++;
  }
  flush();
}

/* Lines of one paragraph or quote: a soft line break between them. */
function lines(parent, arr) {
  arr.forEach((l, k) => { if (k) el(parent, 'br'); inline(parent, l, 0); });
}

/* ---- blocks ------------------------------------------------------------ */

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const blank = l => !/\S/.test(l);

function cells(line) {
  let t = line.trim();
  if (t[0] === '|') t = t.slice(1);
  if (t[t.length - 1] === '|' && t[t.length - 2] !== '\\') t = t.slice(0, -1);
  const out = [];
  let cur = '', tick = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '`') tick = !tick;
    if (c === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|' && !tick) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

const startsTable = (l, next) => l.indexOf('|') >= 0 && next !== undefined && next.indexOf('|') >= 0 && SEP.test(next) && cells(l).length === cells(next).length;

const startsBlock = (l, next) => FENCE.test(l) || HEADING.test(l) || RULE.test(l) || QUOTE.test(l) || ITEM.test(l) || startsTable(l, next);

function drawList(parent, list) {
  const ul = el(parent, list.ordered ? 'ol' : 'ul', list.ordered ? 'rv-md-ol' : 'rv-md-ul');
  if (list.ordered && list.start !== 1) ul.setAttribute('start', String(list.start));
  for (const it of list.items) {
    const li = el(ul, 'li');
    let body = it.text;
    const task = /^\[([ xX])\]\s+/.exec(body);
    if (task) { text(li, task[1] === ' ' ? '☐ ' : '☑ '); body = body.slice(task[0].length); }
    lines(li, [body, ...it.more]);
    for (const k of it.kids) drawList(li, k);
  }
}

function render(parent, md) {
  const src = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < src.length) {
    const l = src[i];
    if (blank(l)) { i++; continue; }
    let m;
    if ((m = FENCE.exec(l))) {
      const mark = m[1];
      const body = [];
      i++;
      while (i < src.length && !(new RegExp('^\\s{0,3}' + (mark[0] === '`' ? '`' : '~') + '{' + mark.length + ',}\\s*$').test(src[i]))) body.push(src[i++]);
      i++;
      const pre = el(parent, 'pre', 'rv-md-pre');
      const code = el(pre, 'code', null, body.join('\n'));
      if (m[2]) code.setAttribute('data-lang', m[2]);
      continue;
    }
    if ((m = HEADING.exec(l))) {
      const level = m[1].length;
      inline(el(parent, 'h' + Math.min(6, level + 2), `rv-md-h rv-md-h${level}`), m[2], 0);
      i++;
      continue;
    }
    if (RULE.test(l)) { el(parent, 'hr', 'rv-md-hr'); i++; continue; }
    if (QUOTE.test(l)) {
      const q = [];
      while (i < src.length && QUOTE.test(src[i])) q.push(QUOTE.exec(src[i++])[1]);
      lines(el(parent, 'blockquote', 'rv-md-quote'), q);
      continue;
    }
    if (startsTable(l, src[i + 1])) {
      const head = cells(l);
      const align = cells(src[i + 1]).map(c => (/^:-+:$/.test(c) ? 'is-center' : /-:$/.test(c) ? 'is-right' : ''));
      i += 2;
      const wrap = el(parent, 'div', 'rv-md-scroll');
      const table = el(wrap, 'table', 'rv-md-table');
      const tr = el(el(table, 'thead'), 'tr');
      head.forEach((h, k) => inline(el(tr, 'th', align[k]), h, 0));
      const tb = el(table, 'tbody');
      while (i < src.length && !blank(src[i]) && src[i].indexOf('|') >= 0) {
        const row = cells(src[i++]);
        const r = el(tb, 'tr');
        head.forEach((h, k) => inline(el(r, 'td', align[k]), row[k] || '', 0));
      }
      continue;
    }
    if ((m = ITEM.exec(l))) {
      const rootOrdered = /\d/.test(m[2][0]);
      const root = { ordered: rootOrdered, start: rootOrdered ? parseInt(m[2], 10) : 1, items: [], indent: m[1].length };
      const stack = [root];
      let last = null;
      while (i < src.length) {
        const cur = src[i];
        if (blank(cur)) {
          let j = i;
          while (j < src.length && blank(src[j])) j++;
          const nx = j < src.length ? ITEM.exec(src[j]) : null;
          if (nx && (nx[1].length > root.indent || /\d/.test(nx[2][0]) === rootOrdered)) { i = j; continue; }
          break;
        }
        const it = ITEM.exec(cur);
        if (!it) {
          if (last && /^\s{2,}/.test(cur) && !startsBlock(cur.trim(), src[i + 1])) { last.more.push(cur.trim()); i++; continue; }
          break;
        }
        const indent = it[1].length;
        const ord = /\d/.test(it[2][0]);
        if (indent <= root.indent && ord !== rootOrdered) break;
        while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
        let top = stack[stack.length - 1];
        if (indent > top.indent && last) {
          const nested = { ordered: ord, start: ord ? parseInt(it[2], 10) : 1, items: [], indent };
          last.kids.push(nested);
          stack.push(nested);
          top = nested;
        }
        last = { text: it[3], more: [], kids: [] };
        top.items.push(last);
        i++;
      }
      drawList(parent, root);
      continue;
    }
    const para = [l.trim()];
    i++;
    while (i < src.length && !blank(src[i]) && !startsBlock(src[i], src[i + 1])) para.push(src[i++].trim());
    lines(el(parent, 'p', 'rv-md-p'), para);
  }
}

module.exports = { render, inline };
