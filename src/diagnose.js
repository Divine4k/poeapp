'use strict';
// Under the hood, the Electron side: the one Diag the whole app writes to (src/core/diag.js),
// and what feeds it by itself: a usage reading every few seconds (processor and memory of each
// part of the app, and of the PC), a freeze meter for the main process, what the windows report
// about themselves, and errors nobody was told about. See "Under the hood" in CLAUDE.md.
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { app, webContents, screen } = require('electron');
const { performance } = require('perf_hooks');
const { Diag } = require('./core/diag');

const diag = new Diag();

const SAMPLE_MS = 5000;
const BEAT_MS = 250;      // the freeze meter looks this often
const FREEZE_MS = 60;     // later than this counts as a freeze
const ASLEEP_MS = 30000;  // later than this was the PC sleeping, not the app
const SIZES_EVERY = 6;    // the app's list sizes: every sixth usage reading (half a minute)
const KEEP_EVERY = 12;    // written to disk: every twelfth (a minute)

// The windows, by the page they show.
const PAGES = {
  'index.html': 'Main window', 'check.html': 'Price check window', 'overlay.html': 'Trade overlay', 'toast.html': 'Message over the game',
  'search.html': 'Stash search menu', 'layout.html': 'Layout mode', 'recorder.html': 'Screen recorder',
};
function pageOf(wc) {
  let file = '';
  try { file = new URL(wc.getURL()).pathname.split('/').pop(); } catch (_) { /* not loaded yet */ }
  return PAGES[file] || (file ? `Window ${file}` : 'Window');
}
// Each part of the app with its processor share (percent of the whole PC) and memory (MB).
function partsNow() {
  const byPid = new Map();
  for (const wc of webContents.getAllWebContents()) {
    try { const pid = wc.getOSProcessId(); if (pid) byPid.set(pid, [...(byPid.get(pid) || []), pageOf(wc)]); } catch (_) { /* closing */ }
  }
  const sum = new Map();
  for (const m of app.getAppMetrics()) {
    const name = m.type === 'Browser' ? 'Main process' : m.type === 'GPU' ? 'Drawing (GPU)'
      : m.type === 'Tab' ? [...new Set(byPid.get(m.pid) || ['Window'])].join(' + ')
        : m.name || m.serviceName || m.type;
    const x = sum.get(name) || { name, cpu: 0, mem: 0 };
    x.cpu += (m.cpu && m.cpu.percentCPUUsage) || 0;
    x.mem += ((m.memory && m.memory.workingSetSize) || 0) / 1024;
    sum.set(name, x);
  }
  return [...sum.values()];
}
// The whole PC's processor since the last look, in percent.
let cpuWas = null;
function pcCpu() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { for (const v of Object.values(c.times)) total += v; idle += c.times.idle; }
  const was = cpuWas;
  cpuWas = { idle, total };
  if (!was || total <= was.total) return null;
  return 100 * (1 - (idle - was.idle) / (total - was.total));
}

let sampleTimer = null, beatTimer = null;
let onSample = null, sizesOf = null, keepDir = '', readings = 0;
function sampleNow() {
  const done = diag.start('under the hood: usage reading');
  try {
    const parts = partsNow();
    const s = { cpu: parts.reduce((n, p) => n + p.cpu, 0), mem: parts.reduce((n, p) => n + p.mem, 0), pcCpu: pcCpu(), pcFree: os.freemem() / 1048576, parts };
    diag.sample(s);
    // Inside the main process: what its own code holds (heap), and what it holds outside it
    // (pictures, files read). Memory that only ever grows shows here first.
    const m = process.memoryUsage(), mb = (n) => Math.round(n / 1048576);
    diag.gauge('Main process: its own data', mb(m.heapUsed), 'MB');
    diag.gauge('Main process: pictures and file data', mb(m.external), 'MB');
    if (process.getActiveResourcesInfo) diag.gauge('Main process: timers and open connections', process.getActiveResourcesInfo().length, '');
    diag.gauge('Windows open', webContents.getAllWebContents().length, '');
    if (readings % SIZES_EVERY === 0) {
      if (sizesOf) for (const [name, n] of Object.entries(sizesOf() || {})) diag.gauge(name, Number(n) || 0, '');
      diag.facts['Screens'] = screensNow();
      diag.facts['Running for'] = `${Math.round(process.uptime() / 60)} min`;
    }
    if (readings % KEEP_EVERY === KEEP_EVERY - 1) keep();
    readings++;
    if (onSample) onSample(s);
  } catch (e) { diag.error('under the hood', e.message || String(e)); }
  done();
}
function screensNow() {
  try { return screen.getAllDisplays().map((d) => `${d.size.width}x${d.size.height} at scale ${d.scaleFactor}${d.displayFrequency ? `, ${Math.round(d.displayFrequency)} Hz` : ''}`).join('; '); } catch (_) { return ''; }
}

// ---- kept on disk, for after a crash ----
// The numbers of this run are written once a minute (in the background) and when the app
// closes. At the next start that file becomes "the run before": what the app was doing before
// it closed, or before it crashed (then the file has no "closed normally" in it).
const fileNow = () => path.join(keepDir, 'this-run.json.gz');
const fileLast = () => path.join(keepDir, 'the-run-before.json.gz');
let keeping = false;
function keep() {
  if (!keepDir || keeping) return;
  keeping = true;
  const done = diag.start('under the hood: kept on disk');
  zlib.gzip(Buffer.from(JSON.stringify(diag.snapshot())), (err, data) => {
    if (err) { keeping = false; done('failed', false, true); return; }
    fs.promises.writeFile(`${fileNow()}.tmp`, data).then(() => fs.promises.rename(`${fileNow()}.tmp`, fileNow())).then(() => done(`${Math.round(data.length / 1024)} KB`, false), () => done('failed', false, true)).finally(() => { keeping = false; });
  });
}
function keepAtQuit() {
  if (!keepDir) return;
  try { fs.writeFileSync(fileNow(), zlib.gzipSync(Buffer.from(JSON.stringify({ ...diag.snapshot(), ended: 'closed normally' })))); } catch (_) { /* closing anyway */ }
}
const hasLastRun = () => { try { return !!keepDir && fs.existsSync(fileLast()); } catch (_) { return false; } };
function lastRun() {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(fileLast()))); } catch (_) { return null; }
}
// sampled(s): told about each usage reading (a recording keeps them). sizes(): the app's own
// list sizes, asked for every half minute. dir: where the run's numbers are kept on disk.
function start({ sampled, sizes, dir } = {}) {
  if (sampleTimer) return;
  onSample = sampled || null;
  sizesOf = sizes || null;
  keepDir = dir || '';
  if (keepDir) {
    try { fs.mkdirSync(keepDir, { recursive: true }); if (fs.existsSync(fileNow())) fs.renameSync(fileNow(), fileLast()); } catch (_) { keepDir = ''; }
  }
  const v = process.versions;
  Object.assign(diag.facts, {
    'App': `${require('../package.json').version}${app.isPackaged ? ', installed' : ', run from its folder'}`,
    'Built on': `Electron ${v.electron}, Chrome ${v.chrome}, Node ${v.node}`,
    'Started': new Date(Date.now() - process.uptime() * 1000).toISOString(),
    'Screens': screensNow(),
  });
  // Read again whenever Chromium learns more: asked at start, before the graphics card has
  // answered, it says "disabled" for everything, which is not how the app ends up drawing.
  const graphics = async () => {
    try {
      const g = app.getGPUFeatureStatus();
      diag.facts['Graphics'] = `drawing ${g.gpu_compositing || '?'}, pages ${g.rasterization || '?'}, video ${g.video_decode || '?'} / ${g.video_encode || '?'} (read ${Math.round(process.uptime())} s after the start)`;
    } catch (_) { /* not told */ }
    try {
      const info = await app.getGPUInfo('basic');
      const cards = (info.gpuDevice || []).map((d) => `${d.active ? 'in use: ' : ''}${d.deviceString || `${d.vendorId}:${d.deviceId}`}${d.driverVersion ? ` (driver ${d.driverVersion})` : ''}`);
      if (cards.length) diag.facts['Graphics cards'] = cards.join('; ');
      const aux = info.auxAttributes || {};
      const bits = ['glRenderer', 'softwareRendering', 'inProcessGpu', 'sandboxed', 'directComposition', 'supportsOverlays'].filter((k) => aux[k] !== undefined).map((k) => `${k} ${aux[k]}`);
      if (bits.length) diag.facts['Graphics, in detail'] = bits.join(', ');
    } catch (_) { /* not told */ }
  };
  graphics();
  app.on('gpu-info-update', () => { graphics(); });
  setTimeout(graphics, 20000);
  const flags = process.argv.slice(1).filter((a) => /^--/.test(a) && !/^--(after-pid|type|user-data-dir)/.test(a));
  if (flags.length) diag.facts['Started with'] = flags.join(' ');
  const cpus = os.cpus();
  diag.pc = `${cpus.length} threads (${(cpus[0] && cpus[0].model.trim()) || 'unknown processor'}), ${Math.round(os.totalmem() / 1073741824)} GB memory, ${os.type()} ${os.release()}`;
  pcCpu();
  sampleTimer = setInterval(sampleNow, SAMPLE_MS);
  setTimeout(sampleNow, 1500);
  // The freeze meter: a timer that should come round every BEAT_MS. When it is late, the main
  // process was busy with one thing for that long, and nothing else (keys, the window, the
  // overlay) was served meanwhile.
  let due = performance.now() + BEAT_MS;
  beatTimer = setInterval(() => {
    const now = performance.now(), late = now - due;
    due = now + BEAT_MS;
    if (late >= ASLEEP_MS) { diag.note('pc', `The PC slept, or the app was held, for ${Math.round(late / 1000)} s`); return; }
    diag.time('main process: heartbeat came late by', Math.max(0, late)); // every beat: shows how smooth it is between freezes
    if (late >= FREEZE_MS) diag.stall('main process', late);
  }, BEAT_MS);
  for (const t of [sampleTimer, beatTimer]) if (t.unref) t.unref();
  // Errors that would otherwise only be in a console nobody sees. Only watched, never swallowed.
  process.on('uncaughtExceptionMonitor', (e) => diag.error('main process (crashed here)', (e && e.stack) || String(e)));
  process.on('unhandledRejection', (e) => { diag.error('main process (a job failed and nothing caught it)', (e && e.stack) || String(e)); console.error('Unhandled rejection:', e); });
  app.on('render-process-gone', (_e, wc, d) => diag.error(`${pageOf(wc)} stopped`, `${d.reason}${d.exitCode ? ` (code ${d.exitCode})` : ''}`));
  app.on('child-process-gone', (_e, d) => diag.error(`${d.name || d.serviceName || d.type} stopped`, `${d.reason}${d.exitCode ? ` (code ${d.exitCode})` : ''}`));
}
function stop() { clearInterval(sampleTimer); clearInterval(beatTimer); sampleTimer = beatTimer = null; keepAtQuit(); }

// What a window says about itself (preload: api.hood): { times: [[name, ms]], long: [ms], errors: [text] }.
// Nothing in it is trusted further than a number and a short name.
function pageNews(wc, d) {
  if (!d || typeof d !== 'object') return;
  let page = 'Window';
  try { page = pageOf(wc); } catch (_) { /* gone */ }
  const where = page.toLowerCase();
  for (const t of Array.isArray(d.times) ? d.times.slice(0, 200) : []) {
    const ms = Number(t && t[1]);
    if (Array.isArray(t) && typeof t[0] === 'string' && ms >= 0 && ms < 600000) diag.time(`window: ${t[0].slice(0, 60)}`, ms, page === 'Main window' ? undefined : page);
  }
  for (const v of Array.isArray(d.long) ? d.long.slice(0, 100) : []) { const ms = Number(v); if (ms >= FREEZE_MS && ms < ASLEEP_MS) diag.stall(where, ms); }
  for (const e of Array.isArray(d.errors) ? d.errors.slice(0, 20) : []) diag.error(where, String(e));
  if (d.sizes && typeof d.sizes === 'object') {
    if (Number(d.sizes.heap) >= 0 && d.sizes.heap !== null) diag.gauge(`${page}: its own data`, Math.round(Number(d.sizes.heap)), 'MB');
    if (Number(d.sizes.nodes) >= 0) diag.gauge(`${page}: things on the page`, Math.round(Number(d.sizes.nodes)), '');
  }
}

// A web request, for http.js: named by where it goes, so the table reads "web: trade site, search".
function webName(url) {
  let u;
  try { u = new URL(url); } catch (_) { return { name: 'web: other', path: '' }; }
  const h = u.host, p = u.pathname;
  let name = h;
  if (/pathofexile\.com$/.test(h)) name = /\/api\/trade\/search/.test(p) ? 'trade site, search' : /\/api\/trade\/fetch/.test(p) ? 'trade site, listings' : /\/api\/trade\/exchange/.test(p) ? 'trade site, bulk exchange' : /\/api\/trade/.test(p) ? 'trade site, other' : 'pathofexile.com';
  else if (/poe\.ninja$/.test(h)) name = 'poe.ninja';
  else if (/github/.test(h)) name = 'GitHub';
  else if (/workers\.dev$/.test(h)) name = 'app server';
  else if (/poecdn\.com$/.test(h)) name = 'item pictures';
  return { name: `web: ${name}`, path: p.length > 80 ? `${p.slice(0, 80)}…` : p };
}

module.exports = { diag, start, stop, pageNews, webName, lastRun, hasLastRun, SAMPLE_MS };
