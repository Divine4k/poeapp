'use strict';
// Starts the page: timer tick and the first state.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- go -------------------------------------------------------------------------------
setInterval(() => {
  if (!state) return;
  const run = currentRun();
  const t = $('timer');
  if (run && t) t.textContent = fmtTime(liveDuration(run));
}, 500);

api.onState(setState);
api.getState().then(setState);
