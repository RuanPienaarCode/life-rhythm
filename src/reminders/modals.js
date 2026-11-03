'use strict';
/* The editor. The fields are built by hand rather than out of Obsidian's
   Setting rows — a settings screen is the wrong shape for "when is this due",
   and the quick-date row and the plain sentence under it are the whole point.
   The chrome around them stays Obsidian's own modal, so the dialog still
   belongs to the app the user is in. */

const { Modal } = require('obsidian');
const { el, icon, button, input, clear } = require('./dom');
const { PRIORITIES } = require('./tasks');
const R = require('./recur');
const D = require('./dates');

const PRIORITY_LABEL = { highest: 'Highest', high: 'High', medium: 'Medium', normal: 'Normal', low: 'Low', lowest: 'Lowest' };

let fieldSeq = 0;

class EditorModal extends Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts || {};
    this.item = Object.assign({ title: '', due: '', time: '', priority: 'normal', repeat: '', tags: [], group: '' }, this.opts.item || {});
    this.draft = {
      title: this.item.title, due: this.item.due, time: this.item.time,
      priority: this.item.priority || 'normal', repeat: this.item.repeat || '',
      tags: (this.item.tags || []).slice(), group: this.item.group || '',
    };
  }

  onOpen() {
    const c = this.contentEl;
    clear(c);
    c.classList.add('nd-modal');
    if (this.modalEl) this.modalEl.classList.add('nd-modal-shell');

    el(c, 'div', 'nd-modal-title', this.opts.isNew ? 'New reminder' : 'Edit reminder');

    const f = el(c, 'div', 'nd-form');

    /* what */
    this.field(f, 'What', row => {
      this.titleEl = input(row, 'nd-in nd-in-title', { type: 'text', value: this.draft.title, placeholder: 'Renew the car licence', 'aria-label': 'What' });
      this.titleEl.addEventListener('input', () => { this.draft.title = this.titleEl.value; });
      this.titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.save(); } });
    });

    /* when */
    this.field(f, 'When', row => {
      this.dueEl = input(row, 'nd-in nd-in-date', { type: 'date', value: this.draft.due, 'aria-label': 'Due date' });
      this.dueEl.addEventListener('change', () => { this.draft.due = this.dueEl.value; this.renderWhen(); });
      this.timeEl = input(row, 'nd-in nd-in-time', { type: 'time', value: this.draft.time, 'aria-label': 'Time' });
      this.timeEl.addEventListener('change', () => { this.draft.time = this.timeEl.value; this.renderWhen(); });
    });

    const quick = el(f, 'div', 'nd-quickdates');
    const today = this.opts.today || D.todayISO();
    for (const q of [
      { label: 'Today', due: today }, { label: 'Tomorrow', due: D.addDays(today, 1) },
      { label: 'In 3 days', due: D.addDays(today, 3) }, { label: 'Next week', due: D.addDays(today, 7) },
      { label: 'Someday', due: '' },
    ]) {
      button(quick, 'nd-quickdate', q.label, () => {
        this.draft.due = q.due;
        this.dueEl.value = q.due;
        this.renderWhen();
      });
    }
    this.whenEl = el(f, 'div', 'nd-when-note', '');

    /* how urgent */
    this.field(f, 'Priority', row => {
      this.prioEl = el(row, 'div', 'nd-seg');
      this.prioEl.setAttribute('role', 'group');
      this.prioEl.setAttribute('aria-label', 'Priority');
      for (const p of PRIORITIES) {
        const b = button(this.prioEl, 'nd-seg-b' + (this.draft.priority === p ? ' is-on' : ''), PRIORITY_LABEL[p], () => {
          this.draft.priority = p;
          for (const n of Array.prototype.slice.call(this.prioEl.children)) {
            n.classList.remove('is-on');
            n.setAttribute('aria-pressed', 'false');
          }
          b.classList.add('is-on');
          b.setAttribute('aria-pressed', 'true');
        });
        b.setAttribute('data-priority', p);
        b.setAttribute('aria-pressed', this.draft.priority === p ? 'true' : 'false');
      }
    });

    /* repeat */
    this.field(f, 'Repeat', row => {
      this.repeatEl = input(row, 'nd-in', { type: 'text', value: this.draft.repeat, placeholder: 'every month', list: 'nd-repeat-presets', 'aria-label': 'Repeat' });
      const dl = el(row, 'datalist', null);
      dl.id = 'nd-repeat-presets';
      for (const p of R.PRESETS) { const o = el(dl, 'option', null); o.value = p.rule; }
      this.repeatEl.addEventListener('input', () => { this.draft.repeat = this.repeatEl.value.trim(); this.renderWhen(); });
    });

    /* where it belongs */
    this.field(f, 'Group', row => {
      this.groupEl = input(row, 'nd-in', { type: 'text', value: this.draft.group, placeholder: 'Home', list: 'nd-group-presets', 'aria-label': 'Group' });
      const dl = el(row, 'datalist', null);
      dl.id = 'nd-group-presets';
      for (const g of this.opts.groups || []) { const o = el(dl, 'option', null); o.value = g; }
      this.groupEl.addEventListener('input', () => { this.draft.group = this.groupEl.value.trim(); });
    });

    this.field(f, 'Tags', row => {
      this.tagsEl = input(row, 'nd-in', { type: 'text', value: (this.draft.tags || []).join(' '), placeholder: '#home #admin', 'aria-label': 'Tags' });
      this.tagsEl.addEventListener('input', () => {
        /* "work, urgent" is two tags, not "#work," and "#urgent". */
        this.draft.tags = this.tagsEl.value.split(/[\s,]+/).filter(Boolean).map(t => (t.charAt(0) === '#' ? t : '#' + t)).filter(t => t.length > 1);
      });
    });

    const foot = el(c, 'div', 'nd-modal-foot');
    if (!this.opts.isNew && this.opts.onDelete) {
      button(foot, 'nd-btn nd-btn-danger', 'Delete', () => {
        if (this.busy) return undefined;
        this.busy = true;
        const p = this.opts.onDelete();
        this.close();
        return p;
      }, 'trash-2');
    }
    el(foot, 'div', 'nd-spacer');
    button(foot, 'nd-btn', 'Cancel', () => this.close());
    button(foot, 'nd-btn nd-btn-cta', this.opts.isNew ? 'Add' : 'Save', () => this.save(), 'check');

    this.renderWhen();
    setTimeout(() => { if (this.titleEl) this.titleEl.focus(); }, 0);
  }

  field(parent, label, fn) {
    const w = el(parent, 'div', 'nd-field');
    const lab = el(w, 'label', 'nd-label', label);
    const row = el(w, 'div', 'nd-field-row');
    fn(row);
    /* The label points at the field's first input, so a click on it focuses
       the field; each input also carries its own aria-label for a screen
       reader (the date and time share one label). */
    const first = row.querySelector('input');
    if (first) {
      if (!first.id) first.id = 'nd-f-' + (++fieldSeq);
      lab.setAttribute('for', first.id);
    }
    return w;
  }

  /* One plain sentence saying what will actually happen — the thing a date
     input and a repeat box together never quite tell you. */
  renderWhen() {
    if (!this.whenEl) return;
    const today = this.opts.today || D.todayISO();
    const bits = [];
    if (this.draft.due) {
      bits.push(`Due ${D.relative(this.draft.due, today).toLowerCase()}${this.draft.time ? ' at ' + this.draft.time : ''}`);
    } else {
      bits.push('No date — it waits in Someday');
      /* A time is only ever a time ON a day: with no day nothing will alert. */
      if (this.draft.time) bits.push("a time alone won't alert you");
    }
    const desc = R.describe(this.draft.repeat);
    if (this.draft.repeat && !desc) bits.push("that repeat isn't one I understand yet");
    else if (desc) bits.push(desc.toLowerCase() + ' after that');
    this.whenEl.textContent = bits.join(', ') + '.';
    this.whenEl.classList.toggle('is-warn', !!this.draft.repeat && !desc);
  }

  save() {
    const title = String(this.draft.title || '').trim();
    if (!title) { if (this.titleEl) this.titleEl.focus(); return undefined; }
    /* Enter held down, or Save tapped twice: one write, not two. */
    if (this.busy) return undefined;
    this.busy = true;
    const fields = {
      title, due: this.draft.due || '', time: this.draft.time || '',
      priority: this.draft.priority || 'normal', repeat: this.draft.repeat || '',
      tags: this.draft.tags || [], group: this.draft.group || '',
    };
    const p = this.opts.onSave ? this.opts.onSave(fields) : null;
    this.close();
    return p;
  }

  onClose() { clear(this.contentEl); }
}

function openEditor(app, opts) {
  const m = new EditorModal(app, opts);
  m.open();
  return m;
}

module.exports = { openEditor, EditorModal };
