'use strict';
// Also loaded by the main window (src/ui/index.html) for the Under the hood page: kept in one
// function so its names do not mix with the page's.
(function () {
// Under the hood: what the app is doing in the background, in numbers. Always on, and cheap.
//  - jobs: how long each kind of work takes (a price check, an inventory reading, a web
//    request, a state update, a file written, a button pressed in the window...): how often,
//    the usual time, the slow end, the worst and the last one.
//  - slow moments: each job that went over its limit, and each freeze (the app could not do
//    anything else for that long), with what was running at the time.
//  - usage: processor and memory of each part of the app, a reading every few seconds.
//  - errors: what went wrong without anyone being told.
// The Under the hood page shows it live, every recording and report gets it as
// diagnostics.json.gz, and report() writes it out as text for Claude.
// No Electron here, so it is tested on its own (test/diag.test.js). src/diagnose.js feeds it.

const LAST = 200;        // durations kept per job, for the usual time and the slow end
const MAX_JOBS = 300;    // kinds of job; more than that go under "other"
const MAX_SLOW = 150;    // slow moments kept
const MAX_SAMPLES = 360; // usage readings kept: half an hour at one every 5 s
const MAX_ERRORS = 60;
const RECENT = 40;       // the latest jobs, to say what ran during a freeze
const DEFAULT_LIMIT = 100;
// When a job counts as slow, in ms, by the start of its name. The first match wins. Work that
// keeps the app from doing anything else has a low limit; waiting for a website a high one.
const LIMITS = [
  ['state update', 16],
  ['window: drawing', 30],
  ['window:', 60],
  ['inventory: capture', 150],
  ['inventory: reading', 60],
  ['inventory:', 250],
  ['price check: copy', 450],
  ['price check:', 2500],
  ['web:', 2000],
  ['file:', 40],
  ['game log', 20],
  ['key:', 600],
  // Buttons and questions that go out to a website, or do a lot, by their nature.
  ['button: troubleSend', 120000],
  ['button: troubleToggle', 5000],
  ['button: applyUpdate', 120000],
  ['button:', 300],
  ['asked by the window: tracker', 4000],
  ['asked by the window: dev', 4000],
  ['asked by the window: account', 4000],
  ['asked by the window: jewels', 2500],
  ['asked by the window: trouble-video', 60000],
  ['asked by the window: trouble-new', 2000],
  ['asked by the window:', 100],
  ['start:', 8000],
  ['under the hood:', 30],
];
// Jobs during which the main process does nothing else (the rest mostly wait for an answer).
// A freeze is put down to these; run() knows it by itself.
const BUSY = ['state update', 'inventory: reading', 'file:', 'game log', 'under the hood:'];
const limitOf = (name) => { for (const [start, ms] of LIMITS) if (name.startsWith(start)) return ms; return DEFAULT_LIMIT; };
const r1 = (n) => Math.round(n * 10) / 10;
const short = (v, n = 300) => { const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}…` : s; };

class Diag {
  // now(): the time of day in ms. tick(): a steady clock in ms for durations.
  constructor({ now = () => Date.now(), tick } = {}) {
    this.now = now;
    this.tick = tick || (typeof performance !== 'undefined' ? () => performance.now() : now);
    this.kids = new Set();
    this.onSlow = null; // (moment) => {} for each slow moment and freeze
    this.onTime = null; // (name, ms, slow, detail) => {} for every job
    this.reset();
  }
  reset() {
    this.since = this.now();
    this.jobs = new Map();   // name -> { n, total, max, maxAt, last, lastAt, over, ring, at }
    this.slow = [];
    this.stalls = {};        // where -> { n, total, max, maxAt }
    this.samples = [];
    this.parts = new Map();  // part of the app -> { cpu, mem, cpuPeak, memPeak, cpuSum, n }
    this.peaks = { cpu: 0, mem: 0, pcCpu: 0, pcFreeLow: null };
    this.gauges = new Map(); // name -> { value, peak, unit, at }
    this.errors = [];
    this.recent = [];
    this.pc = this.pc || null; // what PC this is: kept when the count starts over
  }

  // A second set of numbers that gets everything from now on, until end(): a recording's own.
  fork() {
    const kid = new Diag({ now: this.now, tick: this.tick });
    kid.pc = this.pc;
    kid.end = () => this.kids.delete(kid);
    this.kids.add(kid);
    return kid;
  }

  // A job took ms. detail: anything short worth knowing about this one (shown with slow ones).
  // busy: the app did nothing else meanwhile (worked out from the name when not given).
  time(name, ms, detail, busy) {
    if (!(ms >= 0)) return;
    let key = String(name);
    if (!this.jobs.has(key) && this.jobs.size >= MAX_JOBS) key = 'other';
    let j = this.jobs.get(key);
    if (!j) { j = { n: 0, total: 0, max: 0, maxAt: 0, last: 0, lastAt: 0, over: 0, ring: [], at: 0, limit: limitOf(key) }; this.jobs.set(key, j); }
    const at = this.now();
    j.n++; j.total += ms; j.last = ms; j.lastAt = at;
    if (ms > j.max) { j.max = ms; j.maxAt = at; }
    if (j.ring.length < LAST) j.ring.push(ms); else { j.ring[j.at] = ms; j.at = (j.at + 1) % LAST; }
    if (busy === undefined) busy = BUSY.some((b) => key.startsWith(b));
    this.recent.push({ name: key, ms, at, busy });
    if (this.recent.length > RECENT) this.recent.shift();
    const slow = ms >= j.limit;
    if (slow) { j.over++; this.moment({ at, kind: 'slow', name: key, ms: r1(ms), limit: j.limit, ...(detail != null && detail !== '' ? { detail: short(detail) } : {}) }); }
    if (this.onTime) this.onTime(key, ms, slow, detail);
    for (const k of this.kids) k.time(name, ms, detail, busy);
  }
  // Starts the clock for a job; call what it gives back when the job is done.
  start(name, detail) {
    const t0 = this.tick();
    return (more, busy) => { const ms = this.tick() - t0; this.time(name, ms, more !== undefined ? more : detail, busy); return ms; };
  }
  // Runs fn and times it, whether it answers at once or later. Its answer (or error) is passed on.
  run(name, fn, detail) {
    const done = this.start(name, detail);
    let out;
    try { out = fn(); } catch (e) { done(undefined, true); throw e; }
    if (out && typeof out.then === 'function') return out.then((v) => { done(undefined, false); return v; }, (e) => { done(undefined, false); throw e; });
    done(undefined, true);
    return out;
  }

  // The app (where: 'main process', 'main window'...) could do nothing else for ms.
  stall(where, ms) {
    const at = this.now();
    const s = this.stalls[where] || (this.stalls[where] = { n: 0, total: 0, max: 0, maxAt: 0 });
    s.n++; s.total += ms;
    if (ms > s.max) { s.max = ms; s.maxAt = at; }
    // What ended in that time and took long enough to be the reason.
    const during = where === 'main process'
      ? this.recent.filter((r) => r.busy && r.at >= at - ms - 400 && r.ms >= Math.min(40, ms / 3)).sort((a, b) => b.ms - a.ms).slice(0, 3).map((r) => `${r.name} ${Math.round(r.ms)} ms`)
      : [];
    this.moment({ at, kind: 'freeze', name: where, ms: r1(ms), ...(during.length ? { detail: `while: ${during.join(', ')}` } : {}) });
    for (const k of this.kids) k.stall(where, ms);
  }
  moment(m) {
    this.slow.push(m);
    if (this.slow.length > MAX_SLOW) this.slow.shift();
    if (this.onSlow) this.onSlow(m);
  }

  // A usage reading: { cpu, mem, pcCpu, pcFree, parts: [{ name, cpu, mem }] }. cpu: percent of
  // the whole PC's processor; mem and pcFree: MB.
  sample(s) {
    const at = this.now();
    const row = { at, cpu: r1(s.cpu || 0), mem: Math.round(s.mem || 0), pcCpu: s.pcCpu == null ? null : r1(s.pcCpu), pcFree: s.pcFree == null ? null : Math.round(s.pcFree) };
    this.samples.push(row);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    const p = this.peaks;
    p.cpu = Math.max(p.cpu, row.cpu); p.mem = Math.max(p.mem, row.mem);
    if (row.pcCpu != null) p.pcCpu = Math.max(p.pcCpu, row.pcCpu);
    if (row.pcFree != null) p.pcFreeLow = p.pcFreeLow == null ? row.pcFree : Math.min(p.pcFreeLow, row.pcFree);
    const seen = new Set();
    for (const part of s.parts || []) {
      seen.add(part.name);
      const x = this.parts.get(part.name) || { cpu: 0, mem: 0, cpuPeak: 0, memPeak: 0, cpuSum: 0, n: 0, on: true };
      x.cpu = r1(part.cpu || 0); x.mem = Math.round(part.mem || 0); x.on = true;
      x.cpuPeak = Math.max(x.cpuPeak, x.cpu); x.memPeak = Math.max(x.memPeak, x.mem);
      x.cpuSum += x.cpu; x.n++;
      this.parts.set(part.name, x);
    }
    for (const [name, x] of this.parts) if (!seen.has(name)) { x.on = false; x.cpu = 0; x.mem = 0; } // closed since
    for (const k of this.kids) k.sample(s);
  }
  // A number worth watching that is not a time (the size of a state update, say).
  gauge(name, value, unit = '') {
    const g = this.gauges.get(name) || { value: 0, peak: 0, unit, at: 0 };
    g.value = value; g.peak = Math.max(g.peak, value); g.unit = unit; g.at = this.now();
    this.gauges.set(name, g);
    for (const k of this.kids) k.gauge(name, value, unit);
  }
  error(where, text) {
    const t = short(text, 1500);
    const last = this.errors[this.errors.length - 1];
    // The same one again right away is counted, not listed again.
    if (last && last.where === where && last.text === t) { last.n++; last.at = this.now(); } else {
      this.errors.push({ at: this.now(), where, text: t, n: 1 });
      if (this.errors.length > MAX_ERRORS) this.errors.shift();
    }
    for (const k of this.kids) k.error(where, text);
  }

  // Everything, as plain data: for the page, the diagnostics file and report().
  snapshot() {
    const jobs = [...this.jobs].map(([name, j]) => {
      const sorted = [...j.ring].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      return { name, n: j.n, total: Math.round(j.total), usual: r1(at(0.5)), slowEnd: r1(at(0.95)), max: r1(j.max), maxAt: j.maxAt, last: r1(j.last), lastAt: j.lastAt, limit: j.limit, over: j.over };
    }).sort((a, b) => b.total - a.total);
    const stalls = Object.entries(this.stalls).map(([where, s]) => ({ where, n: s.n, total: Math.round(s.total), max: r1(s.max), maxAt: s.maxAt }));
    return {
      since: this.since, at: this.now(), pc: this.pc, jobs, stalls,
      slow: this.slow.slice(), samples: this.samples.slice(),
      parts: [...this.parts].map(([name, x]) => ({ name, on: x.on, cpu: x.cpu, mem: x.mem, cpuPeak: x.cpuPeak, memPeak: x.memPeak, cpuUsual: x.n ? r1(x.cpuSum / x.n) : 0 })).sort((a, b) => b.memPeak - a.memPeak),
      peaks: { ...this.peaks },
      gauges: [...this.gauges].map(([name, g]) => ({ name, value: g.value, peak: g.peak, unit: g.unit, at: g.at })),
      errors: this.errors.slice(),
    };
  }
}

// ---- in words --------------------------------------------------------------------------
const ms = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)} s` : n >= 100 ? `${Math.round(n)} ms` : `${r1(n)} ms`);
const pad = (n) => String(n).padStart(2, '0');
const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const span = (a, b) => { const s = Math.max(0, Math.round((b - a) / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

// The few lines that say the most: worst freeze, slowest jobs, peaks, errors. Small enough to
// sit in a recording's meta.json, so it shows for recordings fetched from GitHub too.
function brief(snap) {
  if (!snap) return null;
  const freezes = snap.stalls.reduce((a, s) => ({ n: a.n + s.n, max: Math.max(a.max, s.max), total: a.total + s.total }), { n: 0, max: 0, total: 0 });
  return {
    seconds: Math.round((snap.at - snap.since) / 1000),
    freezes,
    slowest: snap.jobs.slice().sort((a, b) => b.max - a.max).slice(0, 6).map((j) => ({ name: j.name, n: j.n, usual: j.usual, max: j.max, over: j.over })),
    slowJobs: snap.jobs.reduce((n, j) => n + j.over, 0),
    cpu: { usual: r1(avg(snap.samples.map((s) => s.cpu))), peak: snap.peaks.cpu },
    mem: { last: snap.samples.length ? snap.samples[snap.samples.length - 1].mem : 0, peak: snap.peaks.mem },
    pcCpuPeak: snap.peaks.pcCpu, pcFreeLow: snap.peaks.pcFreeLow,
    errors: snap.errors.reduce((n, e) => n + e.n, 0),
  };
}
// A brief in a few plain lines, for the Troubleshooting page.
function briefLines(b) {
  if (!b) return [];
  const out = [];
  out.push(b.freezes.n ? `The app froze ${b.freezes.n} time${b.freezes.n === 1 ? '' : 's'}, the longest for ${ms(b.freezes.max)}.` : 'The app never froze.');
  const slow = (b.slowest || []).filter((j) => j.over);
  out.push(slow.length ? `Slow: ${slow.slice(0, 4).map((j) => `${j.name} (up to ${ms(j.max)})`).join(', ')}.` : 'No job was slow.');
  if (b.mem && b.mem.peak) out.push(`Processor ${b.cpu.usual}% of the PC usually, ${b.cpu.peak}% at most; memory up to ${b.mem.peak} MB.`);
  if (b.errors) out.push(`${b.errors} error${b.errors === 1 ? '' : 's'}.`);
  return out;
}

// The whole thing as text (Markdown), written for Claude: paste it in a chat, or read it in a
// recording's README. title: the heading; t0: when given, times are shown from it (a recording's
// own clock, mm:ss) instead of as the time of day.
function report(snap, { title = 'Under the hood', t0 = null, version = '' } = {}) {
  if (!snap) return '';
  const when = (t) => (t0 != null ? (() => { const s = Math.max(0, (t - t0) / 1000); return `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}.${String(Math.floor((s % 1) * 10))}`; })() : hm(t));
  const out = [`## ${title}`, ''];
  out.push(`Covers ${span(snap.since, snap.at)} (${hm(snap.since)} to ${hm(snap.at)})${version ? `, app ${version}` : ''}.${snap.pc ? ` PC: ${snap.pc}.` : ''}`);
  out.push('');
  // Usage
  const sm = snap.samples;
  if (sm.length) {
    const pcs = sm.filter((s) => s.pcCpu != null);
    out.push('### Processor and memory', '');
    out.push(`- The app: processor ${r1(avg(sm.map((s) => s.cpu)))}% of the whole PC usually, ${snap.peaks.cpu}% at most; memory ${sm[sm.length - 1].mem} MB now, ${snap.peaks.mem} MB at most (${sm[0].mem} MB at the start of this stretch).`);
    if (pcs.length) out.push(`- The whole PC (game included): processor ${r1(avg(pcs.map((s) => s.pcCpu)))}% usually, ${snap.peaks.pcCpu}% at most; least free memory ${snap.peaks.pcFreeLow} MB.`);
    out.push('', '| Part of the app | Processor usual | Processor most | Memory now | Memory most |', '|---|---|---|---|---|');
    for (const p of snap.parts) out.push(`| ${p.name}${p.on ? '' : ' (closed)'} | ${p.cpuUsual}% | ${p.cpuPeak}% | ${p.on ? `${p.mem} MB` : '-'} | ${p.memPeak} MB |`);
    out.push('');
  }
  // Freezes
  out.push('### Freezes', '');
  if (!snap.stalls.length) out.push('None: no part of the app was held up for longer than a blink.', '');
  else { for (const s of snap.stalls) out.push(`- ${s.where}: ${s.n} time${s.n === 1 ? '' : 's'}, ${ms(s.total)} in all, the longest ${ms(s.max)} at ${when(s.maxAt)}.`); out.push(''); }
  // Jobs
  out.push('### Jobs, by time spent', '');
  if (!snap.jobs.length) out.push('Nothing was timed.', '');
  else {
    out.push('| Job | Times | Usual | Slow end | Worst | Over its limit | Limit |', '|---|---|---|---|---|---|---|');
    for (const j of snap.jobs.slice(0, 60)) out.push(`| ${j.name} | ${j.n} | ${ms(j.usual)} | ${ms(j.slowEnd)} | ${ms(j.max)} | ${j.over || '-'} | ${ms(j.limit)} |`);
    if (snap.jobs.length > 60) out.push(`| … ${snap.jobs.length - 60} more in diagnostics.json.gz | | | | | | |`);
    out.push('');
  }
  if (snap.gauges.length) {
    out.push('### Sizes', '');
    for (const g of snap.gauges) out.push(`- ${g.name}: ${g.value} ${g.unit} now, ${g.peak} ${g.unit} at most.`);
    out.push('');
  }
  // Slow moments
  out.push('### Slow moments, newest last', '');
  if (!snap.slow.length) out.push('None.', '');
  else {
    out.push('```');
    for (const m of snap.slow.slice(-80)) out.push(`${when(m.at)}  ${m.kind === 'freeze' ? `FROZE  ${m.name} for ${ms(m.ms)}` : `slow   ${m.name} took ${ms(m.ms)} (limit ${ms(m.limit)})`}${m.detail ? `  ${m.detail}` : ''}`);
    out.push('```', '');
  }
  out.push('### Errors', '');
  if (!snap.errors.length) out.push('None.', '');
  else { out.push('```'); for (const e of snap.errors) out.push(`${when(e.at)}  ${e.where}${e.n > 1 ? ` (x${e.n})` : ''}: ${e.text}`); out.push('```', ''); }
  return out.join('\n');
}

const api = { Diag, report, brief, briefLines, limitOf, LIMITS, DEFAULT_LIMIT, MAX_SAMPLES, fmtMs: ms };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.Diagnostics = api;
})();
