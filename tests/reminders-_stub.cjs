'use strict';
/* Route require('obsidian') to a stub for the modules that import it. */
const Module = require('node:module');
const stub = {
  Plugin: class Plugin {}, ItemView: class ItemView {}, Modal: class Modal {}, Setting: class Setting {},
  PluginSettingTab: class PluginSettingTab {}, FuzzySuggestModal: class FuzzySuggestModal {}, Menu: class Menu {},
  Notice: class Notice { constructor(m) { stub.notices.push(m); } }, TFile: class TFile {}, TFolder: class TFolder {},
  Platform: { isMobile: false }, normalizePath: p => p, setIcon: () => {}, notices: [],
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'obsidian') return stub;
  return origLoad.call(this, request, ...rest);
};
module.exports = stub;
