'use strict';
// A window tells the app what it measured about itself, for the Under the hood page: how long
// its drawing took (Hood.note), when it froze (a "long task": one piece of work that kept the
// window from reacting), and errors in it. Loaded by every window that has the api bridge.
// Sent in one go every few seconds, and only when there is something to send.
(function () {
  const bridge = window.api && window.api.hoodPage ? window.api : null;
  const FREEZE_MS = 60, SEND_MS = 3000;
  let times = [], long = [], errors = [], timer = 0;
  const send = () => {
    timer = 0;
    if (bridge && (times.length || long.length || errors.length)) bridge.hoodPage({ times, long, errors });
    times = []; long = []; errors = [];
  };
  const soon = () => { if (!timer) timer = setTimeout(send, SEND_MS); };
  // name: what was done, ms: how long it took.
  const note = (name, ms) => { if (times.length < 200) times.push([name, Math.round(ms * 10) / 10]); soon(); };
  // Times a piece of work: Hood.run('drawing the list', () => draw()).
  const run = (name, fn) => { const t = performance.now(); try { return fn(); } finally { note(name, performance.now() - t); } };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration >= FREEZE_MS && long.length < 100) { long.push(Math.round(e.duration)); soon(); }
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) { /* this browser does not report long tasks */ }
  const bad = (text) => { if (errors.length < 20) errors.push(String(text).slice(0, 600)); soon(); };
  window.addEventListener('error', (e) => bad(`${e.message || 'error'}${e.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => bad(`a job failed and nothing caught it: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`));
  window.Hood = { note, run };
})();
