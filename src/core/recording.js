'use strict';
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
  start() { this.startedAt = this.now(); this.events = []; this.dropped = 0; }
  add(kind, data = {}) {
    if (this.events.length >= MAX_EVENTS) { this.dropped++; return; }
    this.events.push({ t: this.now() - this.startedAt, kind, ...small(data) });
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
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}.${pad(ms % 1000, 3)}`;
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

const MAX_LINES = 6000;
// The README.md that goes up with a recording: the note first, then the facts, then the timeline.
function readme(meta, events) {
  // A written report: the note, who and when, and its pictures shown inline on GitHub.
  if (meta.kind === 'note') {
    return [
      `# Report ${meta.id}`, '', '## Note', '', meta.note ? meta.note : '(no note)', '',
      '## Facts', '',
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
    `- By: ${meta.by || 'not logged in'}${meta.role ? ` (${meta.role})` : ''}`,
    `- App version: ${meta.version || 'unknown'}`,
    `- Started: ${new Date(meta.startedAt).toISOString()}, length ${clockOf(Math.max(0, meta.endedAt - meta.startedAt))}`,
    `- Screen: ${meta.screen ? `${meta.screen.width}x${meta.screen.height} at scale ${meta.screen.scaleFactor}, video ${meta.video ? `${(meta.video.bytes / 1048576).toFixed(1)} MB` : 'none'}` : 'unknown'}`,
    `- Events: ${events.length}${meta.dropped ? ` (${meta.dropped} more were not kept)` : ''}; ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`,
    '',
    '## Files',
    '',
    '- `video.webm`: the game screen. Times below are from the start of the video.',
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

module.exports = { Trace, small, keyNames, keyLabel, buttonName, stateBrief, briefChanges, clockOf, eventLine, readme, recordingId, ID, MAX_EVENTS };
