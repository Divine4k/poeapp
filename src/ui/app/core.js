'use strict';
// Shared helpers for the main window: state, formatting, small DOM helpers.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// window.api (the bridge from preload.js, or demo.js in a browser) is used directly as `api`.
const $ = (id) => document.getElementById(id);
let state = null;
let receivedAt = 0;
let expanded = null;
let allItems = false; // the open map row lists every item, not only the most valuable

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// divine: the chaos value of a Divine Orb to show the value in. A saved session brings its own.
function fmtValue(c, divine = state ? state.summary.divine : 0) {
  if (!isFinite(c)) return '0c';
  const a = Math.abs(c);
  if (divine > 0 && a >= divine) return `${(c / divine).toFixed(a >= divine * 10 ? 1 : 2)} div`;
  return `${a >= 100 ? Math.round(c) : Math.round(c * 10) / 10}c`;
}
function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const currentRun = () => state.summary.runs.find((r) => r.id === state.summary.currentId) || null;
const liveDuration = (run) => run.durationMs + (run.segmentStart !== null ? Date.now() - receivedAt : 0);
const act = (a) => api.action(a);
// Redraws a box only when what it shows has changed, so nothing flickers under the mouse.
const setHtml = (el, html) => { if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; } };
