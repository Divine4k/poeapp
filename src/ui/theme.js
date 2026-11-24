'use strict';
// Puts the last chosen theme on the page before anything is drawn, so the window does not
// flash in the default colours first. The app's settings say which theme it is; this copy is
// only kept for the first moment after the window opens.
(() => {
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* default look */ }
})();
