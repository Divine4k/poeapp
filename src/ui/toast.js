'use strict';
// A short message on top of the game. What to say comes in the address.
(() => {
  let m = {};
  try { m = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch (_) { /* nothing to show */ }
  document.getElementById('title').textContent = m.title || '';
  document.getElementById('detail').textContent = m.detail || '';
  document.getElementById('detail').hidden = !m.detail;
  document.getElementById('box').classList.toggle('bad', !!m.bad);
})();
