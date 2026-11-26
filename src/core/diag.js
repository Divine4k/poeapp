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
//  - what happened: one line for everything the app did, in order (each job with its outcome,
//    each key and button, what changed in the app's state, messages, the game's log events).
//  - running right now: jobs that started and have not finished.
//  - counts and sizes: how often things were skipped and why, how big the app's lists are.
//  - facts: the PC, the screens, the versions, the settings.
// The Under the hood page shows it live, every recording and report gets it as
// diagnostics.json.gz, and report() writes it out as text for Claude.
// No Electron here, so it is tested on its own (test/diag.test.js). src/diagnose.js feeds it.

const LAST = 200;        // durations kept per job, for the usual time and the slow end
const MAX_JOBS = 300;    // kinds of job; more than that go under "other"
const MAX_SLOW = 400;    // slow moments kept
const MAX_LOG = 4000;    // lines of "what happened" kept
const TOP = 8;           // worst freezes kept for good, however long the app runs
const QUICK_MS = 2;      // jobs quicker than this are counted but get no line of their own
// ...except what you set off yourself and what goes out to a website: always a line.
const ALWAYS = ['helper:', 'start step', 'item pictures:', 'price check:', 'key:', 'button:', 'web:', 'inventory: reading', 'asked by the window:', 'start:'];
// Counted only, never a line: they come round all the time and say nothing one by one.
const NEVER = ['main process: heartbeat', 'under the hood:', 'asked by the window: run-snapshot', 'asked by the window: get-state'];
const MAX_SAMPLES = 360; // usage readings kept: half an hour at one every 5 s
const MAX_ERRORS = 60;
const RECENT = 40;       // the latest jobs, to say what ran during a freeze
const DEFAULT_LIMIT = 100;
// When a job counts as slow, in ms, by the start of its name. The first match wins. Work that
// keeps the app from doing anything else has a low limit; waiting for a website a high one.
const LIMITS = [
  ['helper:', 6000],
  ['start step: Electron ready', 2500],
  ['start step', 150],
  ['under the hood: report sent', 8000],
  ['state update', 16],
  ['window: drawing', 30],
  ['window:', 60],
  ['inventory: capture', 150],
  ['inventory: picture', 60],
  ['inventory: asking Windows', 150],
  ['inventory: reading', 60],
  ['inventory:', 250],
  ['price check: copy', 450],
  ['price check: advanced plan', 30],
  ['price check: advanced', 9000], // up to three searches, each waiting its turn with the trade site
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
  ['asked by the window: ultimatum scan', 90000], // up to 100 items, ten at a time, at the trade site's pace
  ['asked by the window: trouble-new', 2000],
  ['asked by the window:', 100],
  ['start:', 8000],
  ['main process: heartbeat', 1e12], // every beat's lateness, for the usual figure; a late one is a freeze already
  ['under the hood:', 30],
];
// Jobs during which the main process does nothing else (the rest mostly wait for an answer).
// A freeze is put down to these; run() knows it by itself.
const BUSY = ['state update', 'inventory: reading', 'inventory: picture made', 'file:', 'game log', 'under the hood:'];
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
    this.log = [];            // what happened: { at, kind, text, ms?, bad? }
    this.logDropped = 0;
    this.open = this.open || new Map(); // jobs under way: id -> { name, t0, at, detail }; they outlive a reset
    this.openId = this.openId || 0;
    this.counts = new Map();  // name -> { n, at }
    this.worst = [];          // the longest freezes: [{ at, where, ms, detail }]
    this.facts = this.facts || {}; // what PC, screens, versions, settings: kept when the count starts over
    this.pc = this.pc || null; // what PC this is: kept when the count starts over
  }

  // A second set of numbers that gets everything from now on, until end(): a recording's own.
  fork() {
    const kid = new Diag({ now: this.now, tick: this.tick });
    kid.pc = this.pc;
    kid.facts = this.facts;
    kid.open = this.open; // a freeze during the recording names what the app was in the middle of
    kid.end = () => this.kids.delete(kid);
    this.kids.add(kid);
    return kid;
  }

  // A job took ms. detail: anything short worth knowing about this one (shown with slow ones).
  // busy: the app did nothing else meanwhile (worked out from the name when not given).
  // failed: it ended in an error (run() knows by itself).
  time(name, ms, detail, busy, failed) {
    if (!(ms >= 0)) return;
    let key = String(name);
    if (!this.jobs.has(key) && this.jobs.size >= MAX_JOBS) key = 'other';
    let j = this.jobs.get(key);
    if (!j) { j = { n: 0, total: 0, max: 0, maxAt: 0, last: 0, lastAt: 0, over: 0, failed: 0, lastDetail: '', ring: [], at: 0, limit: limitOf(key) }; this.jobs.set(key, j); }
    const at = this.now();
    j.n++; j.total += ms; j.last = ms; j.lastAt = at;
    if (failed) j.failed++;
    if (detail != null && detail !== '') j.lastDetail = short(detail, 160);
    if (ms > j.max) { j.max = ms; j.maxAt = at; }
    if (j.ring.length < LAST) j.ring.push(ms); else { j.ring[j.at] = ms; j.at = (j.at + 1) % LAST; }
    if (busy === undefined) busy = BUSY.some((b) => key.startsWith(b));
    const never = NEVER.some((a) => key.startsWith(a));
    if (!never) { this.recent.push({ name: key, ms, at, busy }); if (this.recent.length > RECENT) this.recent.shift(); }
    const slow = ms >= j.limit;
    if (slow) { j.over++; this.moment({ at, kind: 'slow', name: key, ms: r1(ms), limit: j.limit, ...(detail != null && detail !== '' ? { detail: short(detail) } : {}) }); }
    if ((ms >= QUICK_MS || slow || failed || ALWAYS.some((a) => key.startsWith(a))) && !never) {
      this.line({ at, kind: failed ? 'failed' : slow ? 'slow' : 'job', text: key, ms: r1(ms), ...(detail != null && detail !== '' ? { detail: short(detail) } : {}), ...(failed || slow ? { bad: true } : {}) });
    }
    if (this.onTime && !never) this.onTime(key, ms, slow, detail);
    for (const k of this.kids) k.time(name, ms, detail, busy, failed);
  }
  // Starts the clock for a job; call what it gives back when the job is done.
  // Until then it is listed under "running right now", and a freeze names it.
  // done(detail, busy, failed): what came of it, in a few words.
  start(name, detail) {
    const t0 = this.tick(), id = ++this.openId;
    this.open.set(id, { name: String(name), t0, at: this.now(), detail });
    return (more, busy, failed) => {
      if (!this.open.delete(id)) return 0; // told twice: counted once
      const ms = this.tick() - t0;
      this.time(name, ms, more !== undefined ? more : detail, busy, failed);
      return ms;
    };
  }
  // Runs fn and times it, whether it answers at once or later. Its answer (or error) is passed on.
  run(name, fn, detail) {
    const done = this.start(name, detail);
    let out;
    const why = (e) => `failed: ${short((e && e.message) || e, 200)}`;
    try { out = fn(); } catch (e) { done(why(e), true, true); throw e; }
    if (out && typeof out.then === 'function') return out.then((v) => { done(undefined, false); return v; }, (e) => { done(why(e), false, true); throw e; });
    done(undefined, true);
    return out;
  }

  // Something happened that is not a timed job: a line in "what happened". kind: a word for
  // the sort of thing ('state', 'notice', 'hotkey', 'log'...), data: anything short.
  note(kind, data, bad) {
    this.line({ at: this.now(), kind: String(kind), text: typeof data === 'string' ? data : short(data, 400), ...(bad ? { bad: true } : {}) });
    for (const k of this.kids) k.note(kind, data, bad);
  }
  line(l) {
    this.log.push(l);
    if (this.log.length > MAX_LOG) { this.log.splice(0, MAX_LOG / 8); this.logDropped += MAX_LOG / 8; }
  }
  // One more of something that is only worth a number: a reading skipped and why, say.
  count(name, n = 1) {
    const c = this.counts.get(name) || { n: 0, at: 0 };
    c.n += n; c.at = this.now();
    this.counts.set(name, c);
    for (const k of this.kids) k.count(name, n);
  }

  // The app (where: 'main process', 'main window'...) could do nothing else for ms.
  stall(where, ms) {
    const at = this.now();
    const s = this.stalls[where] || (this.stalls[where] = { n: 0, total: 0, max: 0, maxAt: 0 });
    s.n++; s.total += ms;
    if (ms > s.max) { s.max = ms; s.maxAt = at; }
    // What ended in that time and took long enough to be the reason.
    const main = where === 'main process';
    const during = main
      ? this.recent.filter((r) => r.busy && r.at >= at - ms - 400 && r.ms >= Math.min(40, ms / 3)).sort((a, b) => b.ms - a.ms).slice(0, 3).map((r) => `${r.name} ${Math.round(r.ms)} ms`)
      : [];
    // What had started and was not done yet: the freeze happened in the middle of these.
    const tick = this.tick();
    const mid = main ? [...this.open.values()].filter((o) => !NEVER.some((a) => o.name.startsWith(a))).map((o) => `${o.name} (started ${Math.round(tick - o.t0)} ms before)`).slice(0, 4) : [];
    const detail = [during.length ? `while: ${during.join(', ')}` : '', mid.length ? `in the middle of: ${mid.join(', ')}` : ''].filter(Boolean).join('; ');
    const m = { at, kind: 'freeze', name: where, ms: r1(ms), ...(detail ? { detail } : {}) };
    this.worst.push({ at, where, ms: r1(ms), detail });
    this.worst.sort((a, b) => b.ms - a.ms);
    if (this.worst.length > TOP) this.worst.length = TOP;
    this.line({ at, kind: 'freeze', text: `the ${where} froze`, ms: r1(ms), ...(detail ? { detail } : {}), bad: true });
    this.moment(m);
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
    const row = { at, cpu: r1(s.cpu || 0), mem: Math.round(s.mem || 0), pcCpu: s.pcCpu == null ? null : r1(s.pcCpu), pcFree: s.pcFree == null ? null : Math.round(s.pcFree), parts: Object.fromEntries((s.parts || []).map((p) => [p.name, [r1(p.cpu || 0), Math.round(p.mem || 0)]])) };
    this.samples.push(row);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    const p = this.peaks;
    p.cpu = Math.max(p.cpu, row.cpu); p.mem = Math.max(p.mem, row.mem);
    if (row.pcCpu != null) p.pcCpu = Math.max(p.pcCpu, row.pcCpu);
    if (row.pcFree != null) p.pcFreeLow = p.pcFreeLow == null ? row.pcFree : Math.min(p.pcFreeLow, row.pcFree);
    const seen = new Set();
    for (const part of s.parts || []) {
      seen.add(part.name);
      const x = this.parts.get(part.name) || { cpu: 0, mem: 0, cpuPeak: 0, memPeak: 0, cpuSum: 0, n: 0, on: true, memFirst: Math.round(part.mem || 0), firstAt: at };
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
    const g = this.gauges.get(name) || { value: 0, peak: 0, unit, at: 0, first: value, firstAt: this.now() };
    g.value = value; g.peak = Math.max(g.peak, value); g.unit = unit; g.at = this.now();
    this.gauges.set(name, g);
    for (const k of this.kids) k.gauge(name, value, unit);
  }
  // listed: false when the failure has its line in "what happened" already (a failed job).
  error(where, text, listed = true) {
    const t = short(text, 1500);
    if (listed) this.line({ at: this.now(), kind: 'error', text: `${where}: ${short(t, 300)}`, bad: true });
    const last = this.errors[this.errors.length - 1];
    // The same one again right away is counted, not listed again.
    if (last && last.where === where && last.text === t) { last.n++; last.at = this.now(); } else {
      this.errors.push({ at: this.now(), where, text: t, n: 1 });
      if (this.errors.length > MAX_ERRORS) this.errors.shift();
    }
    for (const k of this.kids) k.error(where, text, listed);
  }

  // Everything, as plain data: for the page, the diagnostics file and report().
  snapshot() {
    const jobs = [...this.jobs].map(([name, j]) => {
      const sorted = [...j.ring].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      return { name, n: j.n, total: Math.round(j.total), usual: r1(at(0.5)), slowEnd: r1(at(0.95)), max: r1(j.max), maxAt: j.maxAt, last: r1(j.last), lastAt: j.lastAt, limit: j.limit, over: j.over, failed: j.failed, lastDetail: j.lastDetail };
    }).sort((a, b) => b.total - a.total);
    const stalls = Object.entries(this.stalls).map(([where, s]) => ({ where, n: s.n, total: Math.round(s.total), max: r1(s.max), maxAt: s.maxAt }));
    return {
      since: this.since, at: this.now(), pc: this.pc, jobs, stalls,
      slow: this.slow.slice(), samples: this.samples.slice(),
      parts: [...this.parts].map(([name, x]) => ({ name, on: x.on, cpu: x.cpu, mem: x.mem, cpuPeak: x.cpuPeak, memPeak: x.memPeak, memFirst: x.memFirst, firstAt: x.firstAt, cpuUsual: x.n ? r1(x.cpuSum / x.n) : 0 })).sort((a, b) => b.memPeak - a.memPeak),
      peaks: { ...this.peaks },
      gauges: [...this.gauges].map(([name, g]) => ({ name, value: g.value, peak: g.peak, first: g.first, firstAt: g.firstAt, unit: g.unit, at: g.at })),
      errors: this.errors.slice(),
      log: this.log.slice(), logDropped: this.logDropped,
      running: [...this.open.values()].map((o) => ({ name: o.name, at: o.at, ms: Math.round(this.tick() - o.t0), detail: o.detail == null ? '' : short(o.detail, 160) })),
      counts: [...this.counts].map(([name, c]) => ({ name, n: c.n, at: c.at })).sort((a, b) => b.n - a.n),
      worst: this.worst.slice(), facts: this.facts,
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

// One line of "what happened", for reading: `01:49:18  job     inventory: reading the slots  56.9 ms  37 recognised`.
function logLine(l, when) {
  return `${when(l.at)}  ${String(l.kind).padEnd(7)} ${l.text}${l.ms != null ? `  ${ms(l.ms)}` : ''}${l.detail ? `  ${l.detail}` : ''}`;
}
// The whole thing as text (Markdown), written for Claude: paste it in a chat, or read it in a
// recording's README. title: the heading; t0: when given, times are shown from it (a recording's
// own clock, mm:ss) instead of as the time of day. lines: how much of "what happened" to print
// (all of it is in diagnostics.json.gz).
function report(snap, { title = 'Under the hood', t0 = null, version = '', lines = 600 } = {}) {
  if (!snap) return '';
  const when = (t) => (t0 != null ? (() => { const s = Math.max(0, (t - t0) / 1000); return `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}.${String(Math.floor((s % 1) * 10))}`; })() : hm(t));
  const out = [`## ${title}`, ''];
  out.push(`Covers ${span(snap.since, snap.at)} (${hm(snap.since)} to ${hm(snap.at)})${version ? `, app ${version}` : ''}.${snap.pc ? ` PC: ${snap.pc}.` : ''}`);
  out.push('');
  const facts = snap.facts || {};
  const plain = Object.entries(facts).filter(([k, v]) => k !== 'settings' && v != null && v !== '');
  if (plain.length) { out.push('### Facts', ''); for (const [k, v] of plain) out.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`); out.push(''); }
  // Usage
  const sm = snap.samples;
  if (sm.length) {
    const pcs = sm.filter((s) => s.pcCpu != null);
    out.push('### Processor and memory', '');
    out.push(`- The app: processor ${r1(avg(sm.map((s) => s.cpu)))}% of the whole PC usually, ${snap.peaks.cpu}% at most; memory ${sm[sm.length - 1].mem} MB now, ${snap.peaks.mem} MB at most.`);
    if (pcs.length) out.push(`- The whole PC (game included): processor ${r1(avg(pcs.map((s) => s.pcCpu)))}% usually, ${snap.peaks.pcCpu}% at most; least free memory ${snap.peaks.pcFreeLow} MB.`);
    out.push('', '| Part of the app | Processor usual | Processor most | Memory when first seen | Memory now | Memory most |', '|---|---|---|---|---|---|');
    for (const p of snap.parts) out.push(`| ${p.name}${p.on ? '' : ' (closed)'} | ${p.cpuUsual}% | ${p.cpuPeak}% | ${p.memFirst != null ? `${p.memFirst} MB at ${when(p.firstAt)}` : '-'} | ${p.on ? `${p.mem} MB` : '-'} | ${p.memPeak} MB |`);
    out.push('');
    // The memory of each part over the time kept, in about twelve steps: shows what grows.
    const names = snap.parts.map((p) => p.name), step = Math.max(1, Math.ceil(sm.length / 12));
    const rows = sm.filter((_, i) => i % step === 0 || i === sm.length - 1).filter((r) => r.parts);
    if (rows.length > 2) {
      out.push('Memory over time, MB:', '', `| Time | All | ${names.join(' | ')} |`, `|---|---|${names.map(() => '---').join('|')}|`);
      for (const r of rows) out.push(`| ${when(r.at)} | ${r.mem} | ${names.map((n) => (r.parts[n] ? r.parts[n][1] : '-')).join(' | ')} |`);
      out.push('');
    }
  }
  // Freezes
  out.push('### Freezes', '');
  if (!snap.stalls.length) out.push('None: no part of the app was held up for longer than a blink.', '');
  else {
    for (const s of snap.stalls) out.push(`- ${s.where}: ${s.n} time${s.n === 1 ? '' : 's'}, ${ms(s.total)} in all, the longest ${ms(s.max)} at ${when(s.maxAt)}.`);
    if ((snap.worst || []).length) { out.push('', 'The longest:', '', '```'); for (const w of snap.worst) out.push(`${when(w.at)}  ${w.where} for ${ms(w.ms)}${w.detail ? `  ${w.detail}` : ''}`); out.push('```'); }
    out.push('');
  }
  if ((snap.running || []).length) {
    out.push('### Running when this was written', '');
    for (const r of snap.running) out.push(`- ${r.name}: started ${ms(r.ms)} ago${r.detail ? ` (${r.detail})` : ''}`);
    out.push('');
  }
  // Jobs
  out.push('### Jobs, by time spent', '');
  if (!snap.jobs.length) out.push('Nothing was timed.', '');
  else {
    out.push('| Job | Times | Usual | Slow end | Worst | Over its limit | Limit | Failed | Last outcome |', '|---|---|---|---|---|---|---|---|---|');
    for (const j of snap.jobs.slice(0, 90)) out.push(`| ${j.name} | ${j.n} | ${ms(j.usual)} | ${ms(j.slowEnd)} | ${ms(j.max)} | ${j.over || '-'} | ${j.limit >= 1e9 ? '-' : ms(j.limit)} | ${j.failed || '-'} | ${String(j.lastDetail || '').replace(/\|/g, '/')} |`);
    if (snap.jobs.length > 90) out.push(`| … ${snap.jobs.length - 90} more in diagnostics.json.gz | | | | | | | | |`);
    out.push('');
  }
  if ((snap.counts || []).length) {
    out.push('### Counts', '');
    for (const c of snap.counts) out.push(`- ${c.name}: ${c.n} (last at ${when(c.at)})`);
    out.push('');
  }
  if (snap.gauges.length) {
    out.push('### Sizes', '');
    const u = (g, v) => `${v}${g.unit ? ` ${g.unit}` : ''}`;
    for (const g of snap.gauges) out.push(`- ${g.name}: ${u(g, g.value)} now, ${g.first != null && g.first !== g.value ? `${u(g, g.first)} when first measured, ` : ''}${u(g, g.peak)} at most.`);
    out.push('');
  }
  // Slow moments
  out.push('### Slow moments, newest last', '');
  if (!snap.slow.length) out.push('None.', '');
  else {
    out.push('```');
    if (snap.slow.length > 120) out.push(`… ${snap.slow.length - 120} earlier ones left out here`);
    for (const m of snap.slow.slice(-120)) out.push(`${when(m.at)}  ${m.kind === 'freeze' ? `FROZE  ${m.name} for ${ms(m.ms)}` : `slow   ${m.name} took ${ms(m.ms)} (limit ${ms(m.limit)})`}${m.detail ? `  ${m.detail}` : ''}`);
    out.push('```', '');
  }
  out.push('### Errors', '');
  if (!snap.errors.length) out.push('None.', '');
  else { out.push('```'); for (const e of snap.errors) out.push(`${when(e.at)}  ${e.where}${e.n > 1 ? ` (x${e.n})` : ''}: ${e.text}`); out.push('```', ''); }
  // What happened
  const log = snap.log || [];
  if (log.length && lines > 0) {
    out.push('### What happened, newest last', '');
    out.push('```');
    const left = log.length - lines + (snap.logDropped || 0);
    if (left > 0) out.push(`… ${left} earlier lines left out here`);
    for (const l of log.slice(-lines)) out.push(logLine(l, when));
    out.push('```', '');
  }
  if (facts.settings) out.push('### Settings', '', '```json', JSON.stringify(facts.settings), '```', '');
  return out.join('\n');
}

const api = { Diag, report, logLine, brief, briefLines, limitOf, LIMITS, DEFAULT_LIMIT, MAX_SAMPLES, fmtMs: ms };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.Diagnostics = api;
})();
