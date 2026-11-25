'use strict';
// Starts the page: timer tick and the first state.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- go -------------------------------------------------------------------------------
setInterval(() => {
  if (!state || document.hidden || $('tab-mapping').hidden) return;
  const run = currentRun();
  // The bar under the timer: how far into your usual time for this map.
  const bar = $('usual-fill');
  if (run && bar) { const u = usualMs(run.name); if (u) bar.setAttribute('width', String(Math.round(Math.min(1, liveDuration(run) / u) * 100))); }
}, 500);

// The map card's clock is drawn by clockStart (render.js), only while a map runs on the open Mapping page.
document.addEventListener('visibilitychange', () => { if (!document.hidden && state) render(); });

api.onState(setState);
api.getState().then(setState);
