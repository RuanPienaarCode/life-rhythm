'use strict';
/* Modals: add or edit an item (with a quick-add line that fills the form as
   you type), and the "next step" prompt when a goal's step is ticked. Plain
   DOM inside an Obsidian Modal so the preview harness only stubs the shell. */

const { Modal, Notice } = require('obsidian');
const { el, button, clear, input, select } = require('./dom');
const D = require('./dates');
const { WHEN } = require('./constants');
const { parseQuickAdd } = require('./quickadd');
const { applyAccent } = require('./accents');
const { TOOLS } = require('./markdown-edit');

const KINDS = [
  { id: 'practice', label: 'Practice', hint: 'Something you want to keep a rhythm with — daily, weekly or monthly.' },
  { id: 'goal', label: 'Goal', hint: 'An outcome with a horizon and one next step.' },
  { id: 'event', label: 'Event', hint: 'A dated thing: a hike, a date night, a course.' },
  { id: 'area', label: 'Area', hint: 'A part of life to keep a rhythm in. Order it on the Areas page.' },
];

const CADENCES = [
  { value: 'daily', label: 'Daily' },
  { value: '2/week', label: 'Twice a week' },
  { value: '3/week', label: '3 times a week' },
  { value: '4/week', label: '4 times a week' },
  { value: '5/week', label: '5 times a week' },
  { value: 'weekly', label: 'Weekly' },
  { value: '2/month', label: 'Twice a month' },
  { value: 'monthly', label: 'Monthly' },
];

const WHEN_OPTS = [{ value: '', label: 'Any time' }, ...WHEN.map(w => ({ value: w, label: { morning: 'Morning', day: 'During the day', evening: 'Evening', night: 'Before bed' }[w] }))];

class ItemModal extends Modal {
  /* opts: { kind, rec } — rec present means edit. */
  constructor(app, ctx, opts) {
    super(app);
    this.ctx = ctx;
    this.kind = (opts && opts.kind) || 'practice';
    this.rec = (opts && opts.rec) || null;
    const r = this.rec || {};
    this.values = {
      name: r.name || '', area: r.area || '', cadence: r.cadence || 'daily', when: r.when || '',
      minutes: r.minutes || '', next: r.next || '', horizon: r.horizon || '', date: r.date || '', time: r.time || '',
      body: '', status: r.status || 'active', aside: !!r.aside, days: r.days || null,
    };
    this.quick = '';
    /* Which fields the user actually touched, so a Save on an edit only
       ever writes what changed — leaving an unrecognised value (a renamed
       area, a wikilinked one) alone rather than quietly overwriting it
       with whatever the form happened to default to. */
    this.touched = new Set();
  }

  onOpen() {
    this.modalEl && this.modalEl.classList.add('rv-modal');
    /* A modal is mounted outside the view root, so it never inherits the
       accent the root carries — paint it here too. */
    applyAccent(this.contentEl, this.ctx.settings);
    this.render();
  }

  render() {
    const c = this.contentEl;
    clear(c);
    c.classList.add('rv-app', 'rv-modal-body');
    const editing = !!this.rec;
    el(c, 'h2', 'rv-modal-title', editing ? 'Edit' : 'Add');

    const areas = [...this.ctx.state.data.areas].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    const areaOpts = areas.map(a => ({ value: a.name, label: a.name }));
    const v = this.values;

    if (!editing) {
      const q = input(c, 'rv-input rv-quick', { type: 'text', placeholder: 'Type it fast: Practice guitar daily 20min @evening #Craft', value: this.quick, autocomplete: 'off' });
      q.setAttribute('aria-label', 'Add something: type it in one line');
      q.addEventListener('input', () => {
        this.quick = q.value;
        const p = parseQuickAdd(q.value, areas);
        v.name = p.name || '';
        if (p.cadence) v.cadence = p.cadence;
        if (p.minutes) v.minutes = String(p.minutes);
        if (p.when) v.when = p.when;
        if (p.area) v.area = p.area;
        if (p.date) v.date = p.date;
        if (p.relative) v.date = p.relative === 'today' ? D.todayISO() : D.addDays(D.todayISO(), 1);
        if (p.time) v.time = p.time;
        if (p.horizon) v.horizon = p.horizon;
        if (p.kind && p.kind !== this.kind) this.kind = p.kind;
        this.renderForm(form, areaOpts, editing);
      });
      el(c, 'p', 'rv-modal-hint rv-quick-hint', 'Words like daily, 3/week, 20min, @evening, #Area, a date or "by 2027-03" fill the fields below.');
    }

    const seg = el(c, 'div', 'rv-seg');
    for (const k of KINDS) {
      const b = button(seg, 'rv-seg-btn' + (this.kind === k.id ? ' is-active' : ''), k.label, () => { this.kind = k.id; this.render(); });
      b.setAttribute('aria-pressed', this.kind === k.id ? 'true' : 'false');
      if (editing && k.id !== this.kind) b.disabled = true;
    }
    el(c, 'p', 'rv-modal-hint', KINDS.find(k => k.id === this.kind).hint);

    const form = el(c, 'div', 'rv-form');
    this.renderForm(form, areaOpts, editing);

    const actions = el(c, 'div', 'rv-modal-actions');
    if (editing && this.kind === 'practice') {
      button(actions, 'rv-btn rv-btn-quiet', v.aside ? 'Bring back' : 'Set aside', () => { this.close(); this.ctx.setAside(this.rec, !v.aside); });
    }
    if (editing && this.kind === 'goal') {
      button(actions, 'rv-btn rv-btn-quiet', 'Mark done', async () => { this.close(); await this.ctx.patch(this.rec.path, { status: 'done' }); });
    }
    el(actions, 'span', 'rv-spacer');
    button(actions, 'rv-btn', 'Cancel', () => this.close());
    button(actions, 'rv-btn rv-btn-primary', editing ? 'Save' : 'Add', () => this.submit());
    window.setTimeout(() => { const first = c.querySelector('.rv-quick') || c.querySelector('.rv-input'); if (first) first.focus(); }, 30);
  }

  renderForm(form, areaOpts, editing) {
    clear(form);
    const v = this.values;
    const field = (label, node) => {
      const f = el(form, 'label', 'rv-field');
      el(f, 'span', 'rv-field-label', label);
      f.appendChild(node);
      return node;
    };
    const nameInput = field('Name', input(null, 'rv-input', { type: 'text', placeholder: 'Name', value: v.name, autocomplete: 'off' }));
    nameInput.addEventListener('input', () => { v.name = nameInput.value; this.touched.add('name'); });

    if (this.kind !== 'area') {
      /* An area the current value doesn't match — renamed out from under
         it, or written as a wikilink — is kept as its own option, shown
         as-is, rather than silently reset to the first area in the list. */
      let opts = areaOpts;
      if (v.area && !opts.some(o => o.value === v.area)) opts = [{ value: v.area, label: v.area }, ...opts];
      if (!opts.length) el(form, 'p', 'rv-muted', 'No areas yet — add an area first.');
      else {
        if (!v.area) v.area = opts[0].value;
        const areaSel = field('Area', select(null, 'rv-input', opts, v.area));
        areaSel.addEventListener('change', () => { v.area = areaSel.value; this.touched.add('area'); });
      }
    }

    if (this.kind === 'practice') {
      if (!CADENCES.some(c => c.value === v.cadence)) CADENCES.push({ value: v.cadence, label: v.cadence });
      const cad = field('How often', select(null, 'rv-input', CADENCES, v.cadence));
      cad.addEventListener('change', () => { v.cadence = cad.value; this.touched.add('cadence'); });
      const when = field('When', select(null, 'rv-input', WHEN_OPTS, v.when));
      when.addEventListener('change', () => { v.when = when.value; this.touched.add('when'); });
      const at = field('At (optional)', input(null, 'rv-input', { type: 'time', value: v.time }));
      at.addEventListener('input', () => { v.time = at.value; this.touched.add('time'); });
      const mins = field('Minutes', input(null, 'rv-input', { type: 'number', inputmode: 'numeric', min: '1', placeholder: 'Minutes', value: v.minutes }));
      mins.addEventListener('input', () => { v.minutes = mins.value; this.touched.add('minutes'); });
    } else if (this.kind === 'goal') {
      const next = field('Next step', input(null, 'rv-input', { type: 'text', placeholder: 'The one next step', value: v.next }));
      next.addEventListener('input', () => { v.next = next.value; this.touched.add('next'); });
      const hz = field('By (month)', input(null, 'rv-input', { type: 'text', inputmode: 'numeric', placeholder: 'YYYY-MM', value: v.horizon }));
      hz.addEventListener('input', () => { v.horizon = hz.value; this.touched.add('horizon'); });
    } else if (this.kind === 'event') {
      if (!v.date) v.date = D.todayISO();
      const date = field('Date', input(null, 'rv-input', { type: 'date', value: v.date }));
      date.addEventListener('input', () => { v.date = date.value; this.touched.add('date'); });
      const time = field('Time', input(null, 'rv-input', { type: 'time', value: v.time }));
      time.addEventListener('input', () => { v.time = time.value; this.touched.add('time'); });
    } else if (!editing) {
      const note = field('About', input(null, 'rv-input', { type: 'text', placeholder: 'A line about what this area is for', value: v.body }));
      note.addEventListener('input', () => { v.body = note.value; });
    }
  }

  async submit() {
    const v = this.values;
    const name = (v.name || '').trim();
    if (!name) { new Notice('Rhythm: give it a name.'); return; }
    const kind = this.kind;
    if (kind !== 'area' && !v.area) { new Notice('Rhythm: add an area first.'); return; }
    if (kind === 'goal' && v.horizon && !/^\d{4}-\d{2}(-\d{2})?$/.test(v.horizon.trim())) { new Notice('Rhythm: "By" wants YYYY-MM.'); return; }
    if (kind === 'event' && !D.isISO(v.date)) { new Notice('Rhythm: pick a date.'); return; }
    this.close();
    if (this.rec) {
      const candidate = {};
      if (kind === 'practice') { candidate.area = v.area; candidate.cadence = v.cadence; candidate.when = v.when || undefined; candidate.time = (v.time || '').trim() || undefined; candidate.minutes = v.minutes ? parseInt(v.minutes, 10) : undefined; }
      else if (kind === 'goal') { candidate.area = v.area; candidate.next = (v.next || '').trim() || undefined; candidate.horizon = (v.horizon || '').trim() || undefined; }
      else if (kind === 'event') { candidate.area = v.area; candidate.date = v.date; candidate.time = (v.time || '').trim() || undefined; }
      /* Only the fields the user actually touched go to disk — opening and
         saving without touching anything must be a no-op. */
      const fields = {};
      for (const k of Object.keys(candidate)) if (this.touched.has(k)) fields[k] = candidate[k];
      await this.ctx.update(this.rec, fields, name);
      return;
    }
    let rec;
    if (kind === 'practice') rec = { name, area: v.area, cadence: v.cadence || 'daily', when: v.when || '', time: (v.time || '').trim(), minutes: v.minutes ? parseInt(v.minutes, 10) : undefined };
    else if (kind === 'goal') rec = { name, area: v.area, next: (v.next || '').trim(), horizon: (v.horizon || '').trim(), status: 'active' };
    else if (kind === 'event') rec = { name, area: v.area, date: v.date, time: (v.time || '').trim() };
    else rec = { name, order: this.ctx.state.data.areas.length + 1, body: (v.body || '').trim() };
    await this.ctx.create(kind, rec);
  }

  onClose() { clear(this.contentEl); }
}

/* "That step is done. What's next?" */
class NextStepModal extends Modal {
  constructor(app, ctx, goal) {
    super(app);
    this.ctx = ctx;
    this.goal = goal;
    this.value = '';
  }
  onOpen() {
    this.modalEl && this.modalEl.classList.add('rv-modal');
    applyAccent(this.contentEl, this.ctx.settings);
    const c = this.contentEl;
    clear(c);
    c.classList.add('rv-app', 'rv-modal-body');
    el(c, 'h2', 'rv-modal-title', 'Step done');
    el(c, 'p', 'rv-modal-hint', `"${this.goal.next}" is done for ${this.goal.name}. What is the one next step?`);
    const form = el(c, 'div', 'rv-form');
    const f = el(form, 'label', 'rv-field');
    el(f, 'span', 'rv-field-label', 'Next step');
    const inp = input(f, 'rv-input', { type: 'text', placeholder: 'Leave empty if you do not know yet' });
    inp.addEventListener('input', () => { this.value = inp.value; });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.save(); } });
    const actions = el(c, 'div', 'rv-modal-actions');
    button(actions, 'rv-btn', 'Cancel', () => this.close());
    button(actions, 'rv-btn rv-btn-primary', 'Save', () => this.save());
    window.setTimeout(() => inp.focus(), 30);
  }
  async save() {
    this.close();
    await this.ctx.completeStep(this.goal, (this.value || '').trim());
  }
  onClose() { clear(this.contentEl); }
}

/* Write — a title, a body, and the seven marks worth having a button for.
   It only ever APPENDS to the day's note, which is what lets it exist at
   all: the plugin's standing rule is that it never rewrites prose a person
   typed, so a box that could overwrite the day would have to be a real
   editor with a real merge story. "Open the note" is one tap away for
   everything this cannot do. */
class NoteModal extends Modal {
  constructor(app, ctx, date) {
    super(app);
    this.ctx = ctx;
    this.date = date;
    this.heading = '';
    this.ta = null;
  }

  onOpen() {
    this.modalEl && this.modalEl.classList.add('rv-modal', 'rv-modal-note');
    applyAccent(this.contentEl, this.ctx.settings);
    const c = this.contentEl;
    clear(c);
    c.classList.add('rv-app', 'rv-modal-body');

    el(c, 'h2', 'rv-modal-title', 'Write');
    el(c, 'p', 'rv-modal-hint', D.fmtLong(this.date));

    const titleField = el(c, 'label', 'rv-field');
    el(titleField, 'span', 'rv-field-label', 'Title');
    const titleInput = input(titleField, 'rv-input', { type: 'text', placeholder: 'Optional — becomes a heading', autocomplete: 'off' });
    titleInput.addEventListener('input', () => { this.heading = titleInput.value; });

    const bodyField = el(c, 'div', 'rv-field rv-note-field');
    el(bodyField, 'span', 'rv-field-label', 'Note');

    const bar = el(bodyField, 'div', 'rv-md-bar');
    bar.setAttribute('role', 'toolbar');
    for (const tool of TOOLS) {
      const b = button(bar, 'rv-md-btn', null, () => this.apply(tool.run), tool.icon);
      b.setAttribute('aria-label', tool.label);
      b.setAttribute('title', tool.key ? `${tool.label} (${cmdLabel()}${tool.key.toUpperCase()})` : tool.label);
      /* Keep the caret where it was: without this the button takes focus
         on mousedown and the selection is gone before the click lands. */
      b.addEventListener('mousedown', e => e.preventDefault());
    }

    const ta = el(bodyField, 'textarea', 'rv-input rv-note-body');
    ta.rows = 9;
    ta.placeholder = 'However it comes out.';
    ta.addEventListener('keydown', e => this.onKey(e));
    this.ta = ta;

    const existing = (this.ctx.state.data.log.get(this.date) || {}).body;
    if (existing && existing.trim()) {
      el(c, 'p', 'rv-modal-hint', 'Added under what you have already written today.');
    }

    const actions = el(c, 'div', 'rv-modal-actions');
    button(actions, 'rv-btn rv-btn-quiet', 'Open the note', () => { this.close(); this.ctx.openLog(this.date); });
    el(actions, 'span', 'rv-spacer');
    button(actions, 'rv-btn', 'Cancel', () => this.close());
    button(actions, 'rv-btn rv-btn-primary', 'Save', () => this.save());
    window.setTimeout(() => ta.focus(), 30);
  }

  /* Run one toolbar transform over the live selection and put the caret
     back where the transform asked for it. */
  apply(run) {
    const ta = this.ta;
    const r = run(ta.value, ta.selectionStart, ta.selectionEnd);
    ta.value = r.text;
    ta.focus();
    ta.setSelectionRange(r.start, r.end);
  }

  onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'Enter') { e.preventDefault(); this.save(); return; }
    const tool = TOOLS.find(t => t.key && t.key === e.key.toLowerCase());
    if (tool) { e.preventDefault(); this.apply(tool.run); }
  }

  async save() {
    const title = (this.heading || '').trim();
    const body = (this.ta.value || '').replace(/\s+$/, '');
    if (!title && !body) { this.close(); return; }
    this.close();
    await this.ctx.saveNote(this.date, title, body);
  }

  onClose() { clear(this.contentEl); }
}

const cmdLabel = () => (navigator.platform && /mac|iphone|ipad/i.test(navigator.platform) ? '⌘' : 'Ctrl+');

function openAddModal(app, ctx, kind) { new ItemModal(app, ctx, { kind }).open(); }
function openNoteModal(app, ctx, date) { new NoteModal(app, ctx, date).open(); }
function openEditModal(app, ctx, kind, rec) { new ItemModal(app, ctx, { kind, rec }).open(); }
function openNextStepModal(app, ctx, goal) { new NextStepModal(app, ctx, goal).open(); }

module.exports = { openAddModal, openEditModal, openNextStepModal, openNoteModal, ItemModal, NextStepModal, NoteModal, KINDS, CADENCES };
