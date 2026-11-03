'use strict';
/* The workspace view hosting the app. Each pane remembers its page in the
   workspace layout, so Fortnight can sit beside Today across restarts. */

const { ItemView } = require('obsidian');
const { VIEW_TYPE } = require('./constants');
const { mountApp } = require('./app');

class RhythmView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.initialTab = null;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Rhythm'; }
  getIcon() { return 'compass'; }

  getState() {
    const s = super.getState ? super.getState() : {};
    const tab = this.appCtl ? this.appCtl.ctx.state.tab : this.initialTab;
    return Object.assign({}, s, tab ? { page: tab } : {});
  }

  async setState(state, result) {
    const page = state && typeof state.page === 'string' ? state.page : null;
    if (page) {
      if (this.appCtl) this.appCtl.ctx.setTab(page);
      else this.initialTab = page;
    }
    if (super.setState) await super.setState(state, result);
  }

  /* The app changed page: keep the layout's copy current. */
  pageChanged() {
    const ws = this.app && this.app.workspace;
    if (ws && ws.requestSaveLayout) ws.requestSaveLayout();
  }

  async onOpen() {
    this.appCtl = mountApp(this);
    await this.appCtl.start();
  }

  onResize() {
    if (this.appCtl && this.appCtl.relayout) this.appCtl.relayout();
  }

  async onClose() {
    if (this.appCtl) this.appCtl.stop();
  }
}

module.exports = { RhythmView };
