'use strict';
// Reads Path of Exile's Client.txt. Read-only: this file is never written to.
const fs = require('fs');
const { EventEmitter } = require('events');

const RE_TS = /^(\d{4})\/(\d\d)\/(\d\d) (\d\d):(\d\d):(\d\d)/;
const RE_AREA = /Generating level (\d+) area "([^"]+)" with seed (\d+)/;
// System lines look like "[INFO Client 123] : text"; chat lines have a name before the colon.
const RE_ENTERED = /\] : You have entered (.+)\.\s*$/;
const RE_SLAIN = /\] : (.+) has been slain\.\s*$/;
// Whispers: "@From <GUILD> Name: text" and "@To Name: text". Used for trade offers.
const RE_WHISPER = /\] @(From|To) (?:<[^>]*> )?([^\s:]+): (.*)$/;
const RE_JOINED = /\] : (\S+) has (joined|left) the area\.\s*$/;
const RE_TRADE = /\] : Trade (accepted|cancelled)\.\s*$/;
// Accepting a party invite. Used to follow a seller to their hideout.
const RE_PARTY = /\] : You have joined the party\.\s*$/;
const RE_AFK = /\] : AFK mode is now (ON|OFF)/;

function parseTimestamp(line) {
  const m = RE_TS.exec(line);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

// kind: 'map' | 'hideout' | 'town' | 'other'
function classifyArea(code) {
  if (/hideout/i.test(code)) return 'hideout';
  if (/town$/i.test(code) || /^(HeistHub|KalguuranSettlersLeague|Menagerie|Azurite Mine)/i.test(code)) return 'town';
  if (/^Map/i.test(code)) return 'map';
  return 'other';
}

function parseLine(line) {
  let m = RE_AREA.exec(line);
  if (m) {
    return {
      type: 'area', ts: parseTimestamp(line),
      level: parseInt(m[1], 10), code: m[2], seed: m[3], kind: classifyArea(m[2]),
    };
  }
  m = RE_ENTERED.exec(line);
  if (m) return { type: 'entered', ts: parseTimestamp(line), name: m[1] };
  m = RE_SLAIN.exec(line);
  if (m) return { type: 'death', ts: parseTimestamp(line), name: m[1] };
  m = RE_JOINED.exec(line);
  if (m) return { type: m[2] === 'joined' ? 'joined' : 'left', ts: parseTimestamp(line), name: m[1] };
  m = RE_TRADE.exec(line);
  if (m) return { type: 'trade', ts: parseTimestamp(line), result: m[1] };
  if (RE_PARTY.test(line)) return { type: 'party', ts: parseTimestamp(line) };
  m = RE_AFK.exec(line);
  if (m) return { type: 'afk', ts: parseTimestamp(line), on: m[1] === 'ON' };
  m = RE_WHISPER.exec(line);
  if (m) return { type: 'whisper', ts: parseTimestamp(line), dir: m[1] === 'From' ? 'in' : 'out', player: m[2], text: m[3] };
  return null;
}

// Where the game is usually installed, relative to a drive. The game keeps Client.txt in the
// "logs" folder of its install folder.
const INSTALL_FOLDERS = [
  'Program Files (x86)\\Grinding Gear Games\\Path of Exile',
  'Program Files\\Grinding Gear Games\\Path of Exile',
  'Grinding Gear Games\\Path of Exile',
  'Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile',
  'Program Files\\Steam\\steamapps\\common\\Path of Exile',
  'Steam\\steamapps\\common\\Path of Exile',
  'SteamLibrary\\steamapps\\common\\Path of Exile',
  'Games\\Steam\\steamapps\\common\\Path of Exile',
  'Games\\SteamLibrary\\steamapps\\common\\Path of Exile',
  'Program Files\\Epic Games\\PathOfExile',
  'Epic Games\\PathOfExile',
  'Games\\Path of Exile',
  'Path of Exile',
];
const STEAM_LIBRARY_LISTS = [
  'C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf',
  'C:\\Program Files\\Steam\\steamapps\\libraryfolders.vdf',
];

// The library folders Steam knows about, from the text of its libraryfolders.vdf.
function steamLibraries(vdfText) {
  const out = [];
  const re = /"path"\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(String(vdfText || '')))) out.push(m[1].replace(/\\\\/g, '\\'));
  return out;
}

// Every place worth checking for Client.txt: the usual folders on each drive, plus every Steam
// library, wherever the player put it.
function candidateLogPaths({ drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), exists = fs.existsSync, readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const out = [];
  for (const d of drives) {
    let present = false;
    try { present = exists(`${d}:\\`); } catch (_) { /* no such drive */ }
    if (!present) continue;
    for (const f of INSTALL_FOLDERS) out.push(`${d}:\\${f}\\logs\\Client.txt`);
  }
  for (const list of STEAM_LIBRARY_LISTS) {
    let text = '';
    try { text = readFile(list); } catch (_) { continue; }
    for (const lib of steamLibraries(text)) out.push(`${lib.replace(/[\\/]+$/, '')}\\steamapps\\common\\Path of Exile\\logs\\Client.txt`);
  }
  return [...new Set(out)];
}
const DEFAULT_LOG_PATHS = INSTALL_FOLDERS.map((f) => `C:\\${f}\\logs\\Client.txt`);

// Of the logs that exist, the one written to most recently: with two installs on one PC (say an
// old standalone one and Steam), that is the one being played.
function findLogPath(candidates) {
  const list = candidates || candidateLogPaths();
  let best = null, bestTime = -1;
  for (const p of list) {
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.mtimeMs > bestTime) { best = p; bestTime = st.mtimeMs; }
    } catch (_) { /* keep looking */ }
  }
  return best;
}

// The events in the last part of the log, oldest first. Used once at start to pick up what was
// written while the app was not running.
function readRecent(filePath, maxBytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (start > 0) lines.shift(); // the first line is cut off
    return lines.map(parseLine).filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* nothing to close */ }
  }
}

// Follows the file by polling its size. fs.watch misses writes from the game on Windows.
class LogTail extends EventEmitter {
  constructor(filePath, { intervalMs = 400 } = {}) {
    super();
    this.filePath = filePath;
    this.intervalMs = intervalMs;
    this.offset = null;
    this.rest = '';
    this.timer = null;
    this.busy = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.poll();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    if (this.busy) return;
    this.busy = true;
    fs.stat(this.filePath, (err, st) => {
      if (err) { this.busy = false; this.emit('status', { ok: false, error: err.code || String(err) }); return; }
      if (this.offset === null) { this.offset = st.size; this.busy = false; this.emit('status', { ok: true }); return; }
      if (st.size < this.offset) { this.offset = 0; this.rest = ''; } // log was truncated
      if (st.size === this.offset) { this.busy = false; return; }
      const start = this.offset, end = st.size;
      const stream = fs.createReadStream(this.filePath, { start, end: end - 1, encoding: 'utf8' });
      let chunk = '';
      stream.on('data', (d) => { chunk += d; });
      stream.on('error', () => { this.busy = false; });
      stream.on('end', () => {
        this.offset = end;
        this.busy = false;
        const text = this.rest + chunk;
        const lines = text.split(/\r?\n/);
        this.rest = lines.pop();
        for (const line of lines) {
          const ev = parseLine(line);
          if (ev) this.emit('event', ev);
        }
      });
    });
  }
}

module.exports = { readRecent, parseLine, parseTimestamp, classifyArea, findLogPath, LogTail, DEFAULT_LOG_PATHS, candidateLogPaths, steamLibraries };
