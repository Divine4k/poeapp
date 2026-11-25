'use strict';
// Also loaded by the Troubleshooting page (src/ui/index.html) for its summary: kept in one
// function so its names do not mix with the page's.
(function () {
// Troubleshooting recordings, the parts that are plain logic: the list of what happened while
// recording (keys, clicks, game log lines, what the app did), a short summary of the app's
// state to note changes in, and the readable timeline that goes up with the video.
// No Electron here, so it is tested on its own (test/recording.test.js).

const MAX_EVENTS = 200000; // a long recording of a busy session stays well under this
const MAX_TEXT = 2000;     // characters kept of one value (a log line, a notice, a setting)

// Shortens anything that could be large before it goes into the list.
function small(v, depth = 0) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v;
  if (depth > 4) return '…';
  if (Array.isArray(v)) return v.length > 50 ? [...v.slice(0, 50).map((x) => small(x, depth + 1)), `…${v.length - 50} more`] : v.map((x) => small(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      // Pictures are left out: they would make the list huge and the video shows the screen.
      if (typeof x === 'string' && /^data:image\//.test(x)) { out[k] = '(picture)'; continue; }
      out[k] = small(x, depth + 1);
    }
    return out;
  }
  return String(v);
}

// What happened while recording, each with its time in ms since the recording started.
class Trace {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.startedAt = 0;
    this.events = [];
    this.dropped = 0;
  }
  // at: when time 0 is (the video's first frame); now when not given.
  start(at) { this.startedAt = at === undefined ? this.now() : at; this.events = []; this.dropped = 0; }
  add(kind, data = {}) {
    if (this.events.length >= MAX_EVENTS) { this.dropped++; return; }
    // Kept to a tenth of a millisecond: exact enough to line up with single video frames.
    this.events.push({ t: Math.round((this.now() - this.startedAt) * 10) / 10, kind, ...small(data) });
  }
  toJSON() { return { startedAt: this.startedAt, dropped: this.dropped, events: this.events }; }
}

// Key names of the keyboard helper (uiohook), the other way round: code -> name.
function keyNames(table) {
  const names = {};
  for (const [name, code] of Object.entries(table || {})) if (names[code] === undefined) names[code] = name;
  return names;
}
function keyLabel(e, names) {
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean);
  const name = names[e.keycode] !== undefined ? names[e.keycode] : `key ${e.keycode}`;
  return [...mods.filter((m) => !String(name).startsWith(m)), name].join('+');
}
const BUTTONS = { 1: 'left', 2: 'right', 3: 'middle' };
const buttonName = (b) => BUTTONS[b] || `button ${b}`;

// The parts of the app's state worth noting each time they change. state: what buildState gives.
function stateBrief(s) {
  if (!s) return null;
  const st = s.status || {};
  const sum = s.summary || {};
  const cur = (sum.runs || []).find((r) => r.id === sum.currentId) || null;
  const trade = s.trade || {};
  return {
    log: st.log ? (st.log.ok ? 'ok' : st.log.error || 'not ok') : null,
    keyHook: st.inventory ? st.inventory.keyHook : null,
    inventory: st.inventory ? { open: !!st.inventory.open, recognised: st.inventory.recognised, error: st.inventory.error || null, awaitingArrival: !!st.inventory.awaitingArrival } : null,
    hotkeys: st.hotkeys || null,
    map: cur ? { id: cur.id, name: cur.name, running: cur.segmentStart != null, deaths: cur.deaths, loot: cur.lootCount != null ? cur.lootCount : (cur.loot || []).length, lootValue: Math.round(cur.lootValue || 0) } : null,
    maps: (sum.runs || []).length,
    notice: s.notice ? s.notice.text : null,
    unknown: (s.unknown || []).length,
    mapCheck: s.mapCheck ? s.mapCheck.at : null,
    priceCheck: s.priceCheck ? s.priceCheck.at : null,
    tradeCheck: s.tradeCheck ? `${s.tradeCheck.state || ''} ${s.tradeCheck.at || ''}`.trim() : null,
    offers: (trade.offers || []).map((o) => `${o.id}:${o.dir || ''}:${o.step || o.next || ''}`),
    update: st.update ? (st.update.available ? 'available' : st.update.applying ? 'applying' : '') : null,
  };
}
// Which top-level parts of the brief differ, with their new values. null when nothing did.
function briefChanges(before, after) {
  if (!after) return null;
  const out = {};
  for (const k of Object.keys(after)) if (JSON.stringify(after[k]) !== JSON.stringify(before ? before[k] : undefined)) out[k] = after[k];
  return Object.keys(out).length ? out : null;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function clockOf(ms) {
  const whole = Math.max(0, Math.floor(ms));
  const s = Math.floor(whole / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}.${pad(whole % 1000, 3)}`;
}
// One line per event, for reading.
function eventLine(e) {
  const { t, kind, ...rest } = e;
  let what;
  if (kind === 'key') what = `${rest.dir === 'up' ? 'released' : 'pressed'} ${rest.key}${rest.by === 'app' ? ' (sent by the app)' : ''}`;
  else if (kind === 'mouse') what = `${rest.dir === 'up' ? 'released' : 'clicked'} ${rest.button} at ${rest.x},${rest.y}`;
  else if (kind === 'wheel') what = `wheel ${rest.amount} at ${rest.x},${rest.y}`;
  else if (kind === 'log') what = rest.line;
  else if (kind === 'notice') what = `${rest.bad ? '(problem) ' : ''}${rest.text}`;
  else what = JSON.stringify(rest);
  return `${clockOf(t)}  ${kind.padEnd(8)} ${what}`;
}

// ---- the short version, for the Troubleshooting page ----
// Which of the three lanes an event belongs to: your keys and clicks, the game, the app.
const laneOf = (k) => (k === 'key' || k === 'mouse' || k === 'wheel' ? 'input' : k === 'log' ? 'game' : 'app');
// Game log lines worth a line of their own; the rest are counted, and shown under Everything.
const GAME_NEWS = /You have entered|has been slain|has joined the area|has left the area|@From|@To|Trade accepted|Trade cancelled|AFK mode|level \d+|Connecting to instance|abnormal disconnect/i;
const QUIET_APP = new Set(['console']);
const GROUP_GAP_MS = 1200; // keys and clicks closer together than this are one row

// Turns the raw list into rows: a key press and its release become one press with how long it
// was held, runs of keys and clicks become one row (opened with a click), and game log lines
// and console output that say nothing new are counted instead of listed.
// Row: { t, end, lane, kind, text, bad?, items?: [{ t, text }] }.
function summarise(events, { everything = false } = {}) {
  const rows = [];
  const downs = new Map(); // key or button -> its press row, until released
  let group = null;
  let quiet = 0;
  const label = (e) => (e.kind === 'mouse' ? `${e.button} click` : e.key);
  const close = () => { group = null; };
  for (const e of events) {
    const lane = laneOf(e.kind);
    if (lane === 'input') {
      if (e.kind !== 'wheel' && e.dir === 'up') {
        const id = e.kind === 'mouse' ? `m:${e.button}` : `k:${String(e.key).split('+').pop()}`;
        const press = downs.get(id);
        if (press) { press.held = Math.round(e.t - press.t); downs.delete(id); if (press.group) press.group.end = Math.max(press.group.end, e.t); }
        continue;
      }
      const item = { t: e.t, kind: e.kind, text: e.kind === 'wheel' ? `wheel ${e.amount}` : label(e), at: e.kind === 'key' ? '' : `${e.x}, ${e.y}`, by: e.by || '' };
      if (e.kind !== 'wheel') downs.set(e.kind === 'mouse' ? `m:${e.button}` : `k:${String(e.key).split('+').pop()}`, item);
      if (!group || e.t - group.end > GROUP_GAP_MS || (item.by === 'app') !== group.byApp) {
        group = { t: e.t, end: e.t, lane, kind: 'input', items: [], byApp: item.by === 'app' };
        rows.push(group);
      }
      item.group = group;
      group.items.push(item);
      group.end = Math.max(group.end, e.t);
      continue;
    }
    close();
    if (!everything && ((lane === 'game' && !GAME_NEWS.test(e.line || '')) || (QUIET_APP.has(e.kind) && e.level === 'log'))) { quiet++; continue; }
    rows.push({ t: e.t, end: e.t, lane, kind: e.kind, text: eventText(e), bad: !!e.bad || (e.kind === 'console' && e.level === 'error') });
  }
  // A group's line: what was pressed, in order, with repeats folded ("W ×3").
  for (const r of rows) {
    if (!r.items) continue;
    const parts = [];
    for (const it of r.items) {
      const last = parts[parts.length - 1];
      if (last && last.text === it.text) last.n++; else parts.push({ text: it.text, n: 1 });
    }
    const shown = parts.slice(0, 10).map((p) => (p.n > 1 ? `${p.text} ×${p.n}` : p.text));
    r.text = `${r.byApp ? 'Sent by the app: ' : ''}${shown.join(', ')}${parts.length > 10 ? `, … ${parts.length - 10} more` : ''}`;
    r.items = r.items.map((it) => ({ t: it.t, text: `${it.kind === 'mouse' ? 'Clicked' : it.kind === 'wheel' ? 'Turned the wheel' : 'Pressed'} ${it.kind === 'mouse' ? it.text.replace(/ click$/, '') : it.text}${it.at ? ` at ${it.at}` : ''}${it.held !== undefined ? `, held ${it.held} ms` : ''}${it.by === 'app' ? ' (sent by the app)' : ''}` }));
    delete r.byApp;
    // One key or click alone needs no list to open: its details are the line.
    if (r.items.length === 1) { r.text = r.items[0].text; delete r.items; }
  }
  // A state change that only repeats a message already on its own line says nothing more.
  return { rows: rows.filter((r) => r.text), quiet };
}
// One event in words, for the page.
function eventText(e) {
  const { t, kind, ...r } = e;
  if (kind === 'log') return String(r.line || '').replace(/^\S+ \S+ \d+ \S+ \[[^\]]*\] (: )?/, '');
  if (kind === 'notice') return r.text;
  if (kind === 'hotkey') return `App key ${r.key} (${r.job})`;
  if (kind === 'action') { const { type, ...rest } = r; return `Pressed in the app: ${type}${Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ''}`; }
  if (kind === 'chat') return `Typed in game: ${r.text}`;
  if (kind === 'toast') return `Shown over the game: ${r.message && typeof r.message === 'object' ? [r.message.title, r.message.text].filter(Boolean).join(' – ') || JSON.stringify(r.message) : r.message}`;
  if (kind === 'front') return `In front: ${r.name || (r.game ? 'the game' : 'another program')}`;
  if (kind === 'state') {
    // The notice is its own line already; the current map in words, the rest short.
    const parts = Object.entries(r).filter(([k]) => k !== 'notice').map(([k, v]) => {
      if (k === 'map') return v ? `map ${v.name}${v.running ? ' running' : ' paused'}, ${v.loot} loot${v.lootValue ? ` (${v.lootValue}c)` : ''}${v.deaths ? `, ${v.deaths} deaths` : ''}` : 'no map';
      if (v && typeof v === 'object') return `${k} ${JSON.stringify(v)}`;
      return `${k} ${v}`;
    });
    return parts.length ? `Changed: ${parts.join('; ')}` : '';
  }
  if (kind === 'console') return `${r.level}: ${r.text}`;
  if (kind === 'start') return `Recording started${r.video ? ` (${r.video})` : ''}`;
  if (kind === 'stop') return 'Recording stopped';
  if (kind === 'setting') return `Setting changed: ${JSON.stringify(r)}`;
  if (kind === 'account') return `Account: ${r.type}${r.error ? ` (${r.error})` : ''}`;
  if (kind === 'checkPanel') return `Price check window closed (${r.closed})`;
  if (kind === 'key') return `${r.dir === 'up' ? 'Released' : 'Pressed'} ${r.key}${r.by === 'app' ? ' (sent by the app)' : ''}`;
  if (kind === 'mouse') return `${r.dir === 'up' ? 'Released' : 'Clicked'} ${r.button} at ${r.x}, ${r.y}`;
  if (kind === 'wheel') return `Wheel ${r.amount} at ${r.x}, ${r.y}`;
  return `${kind} ${JSON.stringify(r)}`;
}

const MAX_LINES = 6000;
// The README.md that goes up with a recording: the note first, then the facts, then the timeline.
function readme(meta, events) {
  // A written report: the note, who and when, and its pictures shown inline on GitHub.
  if (meta.kind === 'note') {
    return [
      `# Report ${meta.id}`, '', '## Note', '', meta.note ? meta.note : '(no note)', '',
      '## Facts', '',
      `- Type: ${meta.type === 'suggestion' ? 'suggestion' : 'problem'}`,
      `- By: ${meta.by || 'not logged in'}${meta.role ? ` (${meta.role})` : ''}`,
      `- App version: ${meta.version || 'unknown'}`,
      `- Written: ${new Date(meta.startedAt).toISOString()}`,
      '- `state-start.json.gz`: everything the app window showed when the report was started.',
      '',
      ...((meta.images || []).length ? ['## Pictures', '', ...meta.images.map((n) => `![${n}](${n})`), ''] : []),
    ].join('\n');
  }
  const lines = events.length > MAX_LINES ? events.slice(0, MAX_LINES) : events;
  const kinds = {};
  for (const e of events) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  return [
    `# Recording ${meta.id}`,
    '',
    '## Note',
    '',
    meta.note ? meta.note : '(no note)',
    '',
    '## Facts',
    '',
    `- Type: ${meta.type === 'suggestion' ? 'suggestion' : 'problem'}`,
    `- By: ${meta.by || 'not logged in'}${meta.role ? ` (${meta.role})` : ''}`,
    `- App version: ${meta.version || 'unknown'}`,
    `- Started: ${new Date(meta.startedAt).toISOString()}, length ${clockOf(Math.max(0, meta.endedAt - meta.startedAt))}`,
    `- Screen: ${meta.screen ? `${meta.screen.width}x${meta.screen.height} at scale ${meta.screen.scaleFactor}, video ${meta.video ? `${(meta.video.bytes / 1048576).toFixed(1)} MB` : 'none'}` : 'unknown'}`,
    `- Events: ${events.length}${meta.dropped ? ` (${meta.dropped} more were not kept)` : ''}; ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`,
    '',
    '## Files',
    '',
    `- \`${meta.video && meta.video.file ? meta.video.file : 'video.webm'}\`${meta.video && meta.video.parts ? ` (in ${meta.video.parts} parts: join \`.part1\`, \`.part2\`… in order)` : ''}: the game screen${meta.video && meta.video.fps ? ` at ${meta.video.fps} frames a second` : ''}. Times below count from its first frame.`,
    '- `events.json.gz`: every event below in full.',
    '- `state-start.json.gz`, `state-end.json.gz`: everything the app window was given, at the start and the end.',
    '- `inventory-start.json.gz`, `inventory-end.json.gz`: what the inventory reader saw (as the F9 report).',
    '',
    '## Timeline',
    '',
    '```',
    ...lines.map(eventLine),
    ...(events.length > lines.length ? [`… ${events.length - lines.length} more in events.json.gz`] : []),
    '```',
    '',
  ].join('\n');
}

// Folder name of a recording: when it started, and by whom.
function recordingId(date, name) {
  const d = new Date(date);
  const who = String(name || 'local').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || 'local';
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${who}`;
}
const ID = /^[0-9]{8}-[0-9]{6}-[A-Za-z0-9_-]{1,20}$/;

const api = { summarise, eventText, laneOf, Trace, small, keyNames, keyLabel, buttonName, stateBrief, briefChanges, clockOf, eventLine, readme, recordingId, ID, MAX_EVENTS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.Recording = api;
})();
