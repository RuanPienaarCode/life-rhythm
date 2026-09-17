'use strict';
/* The workspace view hosting the app. */

const { ItemView } = require('obsidian');
const { VIEW_TYPE } = require('./constants');
const { mountApp } = require('./app');

class RhythmView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Rhythm'; }
  getIcon() { return 'compass'; }

  async onOpen() {
    this.appCtl = mountApp(this);
    await this.appCtl.start();
  }

  async onClose() {
    if (this.appCtl) this.appCtl.stop();
  }
}

module.exports = { RhythmView };
