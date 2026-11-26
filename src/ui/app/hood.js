'use strict';
// Under the hood page (Developer tools; admins and moderators): what the app is doing in the
// background, live. Processor and memory of each part of the app, how long every kind of job
// takes, slow moments and freezes, errors. The numbers come from the main process
// (src/core/diag.js, src/diagnose.js) and are asked for every 2 s, only while this page is on screen.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

let hdSnap = null;
let hdTimer = 0;
let hdSort = 'total';
let hdBusy = false;
const HD_EVERY = 2000;
const hdMs = (n) => window.Diagnostics.fmtMs(n);
const hd2 = (n) => String(n).padStart(2, '0');
const hdClock = (t) => { const d = new Date(t); return `${hd2(d.getHours())}:${hd2(d.getMinutes())}:${hd2(d.getSeconds())}`; };
const hdAgo = (t, now) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 5 ? 'now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`; };
const hdSpan = (msLong) => { const s = Math.round(msLong / 1000); return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min` : `${s} s`; };
const hdMem = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

function renderHood() {
  const can = !!(state.trouble && (state.trouble.can || state.trouble.admin));
  if (!can && !$('tab-hood').hidden) { showTab('mapping'); return; }
  if (!$('tab-hood').hidden) hoodShown();
}
// The page is on screen: read now, and keep reading until it is not.
function hoodShown() {
  if (hdTimer || document.hidden) return;
  hoodLoad();
  hdTimer = setInterval(() => {
    if ($('tab-hood').hidden || document.hidden) { clearInterval(hdTimer); hdTimer = 0; return; }
    hoodLoad();
  }, HD_EVERY);
}
async function hoodLoad(op = 'get') {
  if (hdBusy) return;
  hdBusy = true;
  try { const s = await api.hood({ op }); if (s && typeof s === 'object') { hdSnap = s; hoodDraw(); } } catch (_) { /* the next look will do */ }
  hdBusy = false;
}

// One line of a chart: points for values against the highest value shown (top), in a 600 x 100 box.
function hdLine(values, top) {
  const n = window.Diagnostics.MAX_SAMPLES, from = n - values.length;
  return values.map((v, i) => (v == null ? '' : `${(((from + i) / (n - 1)) * 600).toFixed(1)},${(100 - Math.min(1, v / top) * 96 - 2).toFixed(1)}`)).filter(Boolean).join(' ');
}
const hdTop = (max, steps) => steps.find((x) => x >= max) || Math.ceil(max / 1000) * 1000;

function hoodDraw() {
  const s = hdSnap;
  if (!s || $('tab-hood').hidden) return;
  const now = s.at, sm = s.samples, last = sm[sm.length - 1] || null;
  $('hd-since').textContent = `Counting for ${hdSpan(now - s.since)}, since ${hdClock(s.since)}.`;
  // ---- the numbers on top ----
  const freezes = s.stalls.reduce((a, x) => ({ n: a.n + x.n, max: Math.max(a.max, x.max) }), { n: 0, max: 0 });
  const slowN = s.jobs.reduce((n, j) => n + j.over, 0);
  const worst = s.jobs.filter((j) => j.over).sort((a, b) => b.max / b.limit - a.max / a.limit)[0];
  const errN = s.errors.reduce((n, e) => n + e.n, 0);
  const tile = (label, value, sub, cls = '') => `<div class="${cls}"><small>${esc(label)}</small><b>${esc(value)}</b><i>${esc(sub)}</i></div>`;
  setHtml($('hd-tiles'), [
    tile('The app, processor', last ? `${last.cpu}%` : '…', last ? `of the whole PC · most ${s.peaks.cpu}%` : 'first reading in a moment'),
    tile('The app, memory', last ? hdMem(last.mem) : '…', last ? `most ${hdMem(s.peaks.mem)}` : ''),
    tile('The whole PC', last && last.pcCpu != null ? `${last.pcCpu}%` : '…', last && last.pcFree != null ? `processor, game included · ${hdMem(last.pcFree)} memory free` : ''),
    tile('Freezes', String(freezes.n), freezes.n ? `longest ${hdMs(freezes.max)}` : 'the app never stood still', freezes.max >= 250 ? 'hd-bad' : ''),
    tile('Slow jobs', String(slowN), worst ? `worst: ${worst.name}, ${hdMs(worst.max)}` : 'everything within its limit', slowN ? 'hd-warn' : ''),
    tile('Errors', String(errN), errN ? 'listed at the bottom' : 'none', errN ? 'hd-bad' : ''),
  ].join(''));
  // ---- processor and memory over time ----
  const cpuTop = hdTop(Math.max(1, ...sm.map((x) => Math.max(x.cpu, x.pcCpu || 0))), [5, 10, 25, 50, 100]);
  const memTop = hdTop(Math.max(1, ...sm.map((x) => x.mem)), [250, 500, 750, 1000, 1500, 2000, 3000, 4000]);
  const mins = Math.round((window.Diagnostics.MAX_SAMPLES * (s.every || 5000)) / 60000);
  const chart = (title, top, unit, lines, legend) => `<div class="hd-chart"><div class="hd-chart-head"><b>${title}</b><span class="hd-legend">${legend}</span></div>
    <div class="hd-plot"><span class="hd-top">${top}${unit}</span><svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true"><line class="hd-mid" x1="0" y1="50" x2="600" y2="50"/>${lines}</svg><span class="hd-zero">0</span></div>
    <div class="hd-axis"><span>${mins} min ago</span><span>now</span></div></div>`;
  setHtml($('hd-charts'), sm.length < 2 ? '<p class="dim">The first readings come in a few seconds.</p>' : [
    chart('Processor', cpuTop, '%', `<polyline class="hd-pc" points="${hdLine(sm.map((x) => x.pcCpu), cpuTop)}"/><polyline class="hd-app" points="${hdLine(sm.map((x) => x.cpu), cpuTop)}"/>`, '<span class="hd-k app">the app</span><span class="hd-k pc">the whole PC</span>'),
    chart('Memory', hdMem(memTop), '', `<polyline class="hd-app" points="${hdLine(sm.map((x) => x.mem), memTop)}"/>`, '<span class="hd-k app">the app</span>'),
  ].join(''));
  setHtml($('hd-parts'), s.parts.length ? `<table class="hd-table"><thead><tr><th>Part of the app</th><th class="num" title="Share of the whole PC's processor, right now">Processor</th><th class="num">usual</th><th class="num">most</th><th class="num">Memory</th><th class="num">most</th></tr></thead><tbody>${
    s.parts.map((p) => `<tr class="${p.on ? '' : 'off'}"><td>${esc(p.name)}${p.on ? '' : ' <em>closed</em>'}</td><td class="num">${p.on ? `${p.cpu}%` : '–'}</td><td class="num dim">${p.cpuUsual}%</td><td class="num dim">${p.cpuPeak}%</td><td class="num">${p.on ? hdMem(p.mem) : '–'}</td><td class="num dim">${hdMem(p.memPeak)}</td></tr>`).join('')
  }</tbody></table>${s.gauges.map((g) => `<p class="fine">${esc(g.name)}: ${g.value} ${esc(g.unit)} now, ${g.peak} ${esc(g.unit)} at most.</p>`).join('')}` : '');
  // ---- slow moments ----
  const slow = s.slow.slice(-60).reverse();
  setHtml($('hd-slow'), slow.length ? slow.map((m) => `<li class="${m.kind === 'freeze' ? 'freeze' : ''}"><time>${hdClock(m.at)}</time><span><b>${m.kind === 'freeze' ? `The ${esc(m.name)} froze for ${hdMs(m.ms)}` : `${esc(m.name)} took ${hdMs(m.ms)}`}</b>${m.kind === 'slow' ? ` <i>limit ${hdMs(m.limit)}</i>` : ''}${m.detail ? `<small>${esc(m.detail)}</small>` : ''}</span></li>`).join('')
    : '<li class="empty">Nothing was slow and nothing froze.</li>');
  // ---- every job ----
  const q = $('hd-filter').value.trim().toLowerCase();
  const by = { total: (j) => j.total, max: (j) => j.max, n: (j) => j.n, usual: (j) => j.usual, last: (j) => j.lastAt, over: (j) => j.over }[hdSort];
  const jobs = s.jobs.filter((j) => !q || j.name.toLowerCase().includes(q)).sort((a, b) => by(b) - by(a));
  const th = (key, label, tip) => `<th class="num"><button type="button" class="link${hdSort === key ? ' on' : ''}" data-hdsort="${key}" title="${esc(tip)}">${label}</button></th>`;
  setHtml($('hd-jobs'), jobs.length ? `<table class="hd-table hd-jobtable"><thead><tr><th>Job</th>${th('n', 'Times', 'How often it ran')}${th('usual', 'Usual', 'Half of the runs were quicker than this')}<th class="num" title="19 of 20 runs were quicker than this">Slow end</th>${th('max', 'Worst', 'The slowest run')}${th('last', 'Last', 'The latest run')}${th('total', 'In all', 'All runs added up')}${th('over', 'Slow', 'Runs that went over the limit')}</tr></thead><tbody>${
    jobs.map((j) => `<tr class="${j.over ? 'slow' : ''}"><td>${esc(j.name)}</td><td class="num">${j.n}</td><td class="num">${hdMs(j.usual)}</td><td class="num dim">${hdMs(j.slowEnd)}</td><td class="num${j.max >= j.limit ? ' over' : ''}" title="at ${hdClock(j.maxAt)}">${hdMs(j.max)}</td><td class="num dim" title="${hdAgo(j.lastAt, now)}">${hdMs(j.last)}</td><td class="num dim">${hdMs(j.total)}</td><td class="num${j.over ? ' over' : ' dim'}" title="Slow from ${hdMs(j.limit)}">${j.over || '–'}</td></tr>`).join('')
  }</tbody></table>` : `<p class="dim">${q ? 'No job with that in its name.' : 'Nothing has been timed yet.'}</p>`);
  // ---- errors ----
  setHtml($('hd-errors'), s.errors.length ? s.errors.slice().reverse().map((e) => `<li><time>${hdClock(e.at)}</time><span><b>${esc(e.where)}${e.n > 1 ? ` ×${e.n}` : ''}</b><small>${esc(e.text)}</small></span></li>`).join('') : '<li class="empty">No errors.</li>');
}

$('tab-hood').addEventListener('click', async (e) => {
  const sort = e.target.closest('[data-hdsort]');
  if (sort) { hdSort = sort.dataset.hdsort; hoodDraw(); return; }
  if (e.target.closest('#hd-reset')) { hdBusy = false; hoodLoad('reset'); return; }
  const copy = e.target.closest('#hd-copy');
  if (copy) {
    const ok = await api.hood({ op: 'copy' });
    copy.textContent = ok ? 'Copied' : 'Could not copy';
    setTimeout(() => { copy.textContent = 'Copy for Claude'; }, 1800);
  }
});
$('hd-filter').addEventListener('input', hoodDraw);
