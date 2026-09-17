/* Minimal `obsidian` stand-in for the browser harness. setIcon draws a plain
   24x24 stroke path per name so the layout matches what lucide occupies. */
const PATHS = {
  compass: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6L9 17l-5-5',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-down': 'M6 9l6 6 6-6',
  'external-link': 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14M19 12l-7 7-7-7',
  pencil: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  ellipsis: 'M12 12h.01M19 12h.01M5 12h.01',
  clock: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 6v6l4 2',
  x: 'M18 6L6 18M6 6l12 12',
  'rotate-ccw': 'M3 12a9 9 0 1 0 3-6.7M3 3v5h5',
  calendar: 'M8 2v4M16 2v4M3 8h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  'calendar-days': 'M8 2v4M16 2v4M3 8h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01',
  flag: 'M4 22V4a1 1 0 0 1 1-1h13l-3 5 3 5H5',
  sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  'grip-vertical': 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  layers: 'M12 2l9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  'undo-2': 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4',
  bold: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z',
  italic: 'M19 4h-9M14 20H5M15 4L9 20',
  heading: 'M6 4v16M18 4v16M6 12h12',
  'square-check': 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 12l2 2 4-4',
  'text-quote': 'M17 6H3M21 12H8M21 18H8M3 12v6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  flame: 'M12 2s5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s1 2 2 2 2-8 2-8z',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
};
export function setIcon(node, name) {
  const d = PATHS[name];
  if (!d) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.append(p);
  node.append(svg);
}
export class Notice {
  constructor(msg) {
    const n = document.createElement('div');
    n.className = 'stub-notice';
    n.textContent = msg;
    document.body.append(n);
    setTimeout(() => n.remove(), 4000);
    console.log('[Notice]', msg);
  }
}
export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal stub-modal';
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'modal-content';
    this.modalEl.append(this.contentEl);
    this.bg = document.createElement('div');
    this.bg.className = 'stub-modal-bg';
    this.bg.addEventListener('click', () => this.close());
  }
  open() { document.body.append(this.bg, this.modalEl); this.onOpen && this.onOpen(); }
  close() { this.onClose && this.onClose(); this.modalEl.remove(); this.bg.remove(); }
}
/* A context menu: a floating list, closes on click or outside click. */
export class Menu {
  constructor() { this.items = []; }
  addItem(fn) {
    const item = { title: '', icon: '', onClick: null,
      setTitle(t) { this.title = t; return this; },
      setIcon(i) { this.icon = i; return this; },
      onClick(f) { this.onClick = f; return this; } };
    fn(item);
    this.items.push(item);
    return this;
  }
  showAtPosition(pos) {
    const m = document.createElement('div');
    m.className = 'stub-menu';
    m.style.left = pos.x + 'px';
    m.style.top = pos.y + 'px';
    for (const it of this.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.title;
      b.addEventListener('click', () => { close(); it.onClick && it.onClick(); });
      m.append(b);
    }
    const close = () => { m.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = e => { if (!m.contains(e.target)) close(); };
    document.body.append(m);
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }
  showAtMouseEvent(e) { this.showAtPosition({ x: e.clientX, y: e.clientY }); }
}
export class Plugin {}
export class ItemView {}
export class PluginSettingTab {}
export class Setting {}
export class TFile {}
export class TFolder {}
export const normalizePath = p => p.replace(/\\/g, '/').replace(/\/+$/, '');
export const requestUrl = async () => ({ status: 404, text: '' });
