'use strict';
/* A module's board, mounted as one of Rhythm's pages.

   The Reminders and Fortnight boards were written to own a whole workspace
   view: they take the view, use its contentEl as their root, its plugin as
   their host, and hand it their timers. Here they get a stand-in view whose
   contentEl is the page's container and whose plugin is the module's host,
   so the boards run unchanged. The page owns the board's life: started when
   the page is shown, stopped (timers cleared) when it is left. */

const { mountBoard: mountReminders } = require('./reminders/board');
const { mountBoard: mountPlanner } = require('./planner/board');

/* page id -> module */
const EMBEDS = {
  reminders: { kind: 'reminders', mount: mountReminders, host: p => p.reminders },
  fortnight: { kind: 'planner', mount: mountPlanner, host: p => p.planner },
};

function mountEmbed(page, el, plugin, view) {
  const spec = EMBEDS[page];
  const intervals = [];
  let stopped = false;
  const stand = {
    contentEl: el,
    plugin: spec.host(plugin),
    app: plugin.app,
    /* A board that registers its timer only once its first load lands can
       do so after the page was already left: clear that one at once. */
    registerInterval(id) { if (stopped) window.clearInterval(id); else intervals.push(id); return id; },
    registerEvent(ref) { if (view && view.registerEvent) view.registerEvent(ref); },
    registerDomEvent(target, type, fn, opts) {
      if (view && view.registerDomEvent) view.registerDomEvent(target, type, fn, opts);
      else target.addEventListener(type, fn, opts);
    },
  };
  const ctl = spec.mount(stand);
  const embed = {
    page,
    kind: spec.kind,
    ctl,
    ready: null,
    start() {
      embed.ready = Promise.resolve(ctl.start()).then(() => ctl, e => { console.error('rhythm ' + page, e); return ctl; });
      return embed.ready;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try { ctl.stop(); } catch (e) { console.error('rhythm ' + page + ' stop', e); }
      for (const id of intervals) window.clearInterval(id);
    },
  };
  return embed;
}

module.exports = { mountEmbed, EMBEDS };
