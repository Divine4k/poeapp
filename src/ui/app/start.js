'use strict';
// Starts the page: timer tick and the first state.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- go -------------------------------------------------------------------------------
setInterval(() => {
  if (!state) return;
  const run = currentRun();
  // The bar under the timer: how far into your usual time for this map.
  const bar = $('usual-fill');
  if (run && bar) { const u = usualMs(run.name); if (u) bar.setAttribute('width', String(Math.round(Math.min(1, liveDuration(run) / u) * 100))); }
}, 500);

// The map card's clock with its thousandths: every screen refresh while a map runs.
(function tick() {
  if (state) { const run = currentRun(); if (run && run.segmentStart !== null) drawClock(liveDuration(run)); }
  requestAnimationFrame(tick);
})();

api.onState(setState);
api.getState().then(setState);
