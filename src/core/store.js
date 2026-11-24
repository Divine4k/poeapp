'use strict';
// Things kept on disk beside the running session: the inventory as it was read for each map,
// and sessions that were closed with "Start new session". Plain files, no Electron.
const fs = require('fs');
const path = require('path');

const safe = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
function readFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

const MAX_TRIPS = 6;

// One file per map: { trips: [{ trip, at, filled, sig, image, cells: [{ cell, status, name, qty }] }] }.
//
// A map can be left and entered again, and the inventory is emptied into the stash in between,
// so each trip into the map keeps its own picture. In the map the newest reading wins. Back in
// the hideout (growing: false) a reading only replaces the picture when it shows at least as
// many items, because once stashing starts the inventory only gets emptier.
class SnapshotStore {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map(); // run id -> file contents, for the few maps being looked at
  }

  file(runId) { return path.join(this.dir, `${safe(runId)}.json`); }

  get(runId) {
    if (!this.cache.has(runId)) {
      if (this.cache.size > 20) this.cache.clear();
      this.cache.set(runId, readFile(this.file(runId)) || { trips: [] });
    }
    return this.cache.get(runId);
  }

  // Is this reading worth keeping? Asked before the picture is made, which is the slow part.
  wants(runId, trip, cells, growing = true) {
    const prev = this.get(runId).trips.find((t) => t.trip === trip);
    if (!prev) return cells.length > 0;
    return (growing || cells.length >= prev.filled) && signature(cells) !== prev.sig;
  }

  // cells: [{ cell, status, name, qty }]. image: a data URL of the whole grid.
  record(runId, trip, { at, cells, image, growing = true, stale = false }) {
    if (!this.wants(runId, trip, cells, growing)) return false;
    const data = this.get(runId);
    const entry = {
      trip, at, filled: cells.length, sig: signature(cells), image, ...(stale ? { stale: true } : {}),
      cells: cells.map((c) => {
        const o = { cell: c.cell, status: c.status, name: c.name || null, qty: c.qty || 0, source: c.source || null, carried: !!c.carried, carriedQty: c.carriedQty || 0 };
        // How the slot was read (score in percent, closest names, exact fingerprint), kept so a
        // read can be explained and repeated later.
        for (const k of ['score', 'how', 'near', 'packed']) if (c[k]) o[k] = c[k];
        return o;
      }),
    };
    const i = data.trips.findIndex((t) => t.trip === trip);
    if (i >= 0) data.trips[i] = entry; else data.trips.push(entry);
    if (data.trips.length > MAX_TRIPS) data.trips.splice(0, data.trips.length - MAX_TRIPS);
    try { writeFile(this.file(runId), data); } catch (e) { console.error('snapshot save failed', e.message); }
    return true;
  }

  // Saves a map's pictures again after their slots were changed in place.
  rewrite(runId) {
    const data = this.get(runId);
    for (const t of data.trips) t.sig = signature(t.cells);
    writeFile(this.file(runId), data);
  }

  remove(runId) {
    this.cache.delete(runId);
    try { fs.unlinkSync(this.file(runId)); } catch (_) { /* never had one */ }
  }
}

function signature(cells) {
  return cells.map((c) => `${c.cell}:${c.status}:${c.name || ''}:${c.qty || 0}:${c.carriedQty || 0}`).join('|');
}

// Marks what was already in the inventory when the map was entered, slot by slot.
// base: the inventory as last read before entering, [{ cell, name, qty, print }].
// similar(a, b): whether two picture fingerprints show the same item (for items without a name).
// Each cell gets carriedQty (how many of its stack were brought in; 1 for a single item) and
// carried (true when none of it is loot). A stack that grew in the map is only partly carried.
function markCarried(cells, base, similar) {
  const by = new Map((base || []).map((b) => [b.cell, b]));
  return cells.map((c) => {
    const b = by.get(c.cell);
    let n = 0;
    if (b && c.name) { if (b.name === c.name) n = Math.min(b.qty || 1, c.qty || 1); }
    else if (b && !b.name && b.print && c.print && similar(b.print, c.print)) n = 1;
    return { ...c, carriedQty: n, carried: n > 0 && (!c.name || n >= (c.qty || 1)) };
  });
}

// Looks at the kept slots of one inventory again with what is known about items now.
// identify(cell): { name } for what the slot's picture is recognised as today, or null.
// canChange(name): whether a name came from a picture at all. Names given to one slot by hand
// (a divination card named with the check key) are left alone.
// Changes the cells in place and returns [{ cell, from, to, qty }], qty being how much of the
// slot was loot (what was taken into the map is left out).
function recheckCells(cells, identify, canChange = () => true) {
  const changes = [];
  for (const c of cells) {
    if (!['item', 'remembered', 'unknown'].includes(c.status) || !(c.qty > 0)) continue;
    if (c.source === 'pinned' || c.source === 'map') continue;
    // Slots saved since 0.15 say how they were read; for older ones the name has to be one a
    // picture can lead to.
    if (c.name && !c.source && !canChange(c.name)) continue;
    const hit = identify(c);
    if (!hit || !hit.name || hit.name === c.name) continue;
    const loot = c.carried ? 0 : Math.max(0, c.qty - (c.carriedQty || 0));
    changes.push({ cell: c.cell, from: c.name || null, to: hit.name, qty: loot });
    c.name = hit.name; c.source = hit.source || null; c.how = hit.sharp ? 'sharp' : (hit.doubt ? 'doubt' : null);
    if (c.status === 'unknown') c.status = 'item';
  }
  return changes;
}

// Closed sessions, one file each, with every value frozen as it was when the session ended:
// prices move, and an old session should keep showing what it was worth on the day.
class SessionArchive {
  constructor(dir) {
    this.dir = dir;
    this.index = null; // [{ id, startedAt, endedAt, divine, totals }], newest first
  }

  file(id) { return path.join(this.dir, `${safe(id)}.json`); }

  list() {
    if (!this.index) {
      let names = [];
      try { names = fs.readdirSync(this.dir).filter((n) => n.endsWith('.json')); } catch (_) { /* nothing saved yet */ }
      this.index = names.map((n) => readFile(path.join(this.dir, n))).filter((s) => s && s.id && s.totals)
        .map(brief).sort((a, b) => b.endedAt - a.endedAt);
    }
    return this.index;
  }

  // summary: what Session.summary() returns, taken after the last map was ended.
  // Returns the saved entry, or null when there was nothing to save.
  // extra: fields to keep with it, such as the strategy it was run under.
  save(summary, endedAt = Date.now(), extra = {}) {
    if (!summary || !summary.runs.length) return null;
    const first = summary.runs[0].startedAt;
    const entry = {
      ...extra,
      id: `${first.toString(36)}-${endedAt.toString(36)}`,
      startedAt: first, endedAt, divine: summary.divine || 0, totals: summary.totals,
      runs: summary.runs.map((r) => ({ ...r, seen: undefined, segmentStart: null, endedAt: r.endedAt || endedAt })),
    };
    writeFile(this.file(entry.id), entry);
    this.list().unshift(brief(entry));
    return entry;
  }

  get(id) { return readFile(this.file(id)); }

  // Deletes a saved session. Returns the ids of its maps, so their pictures can go too.
  remove(id) {
    const s = this.get(id);
    try { fs.unlinkSync(this.file(id)); } catch (_) { /* already gone */ }
    this.index = this.list().filter((x) => x.id !== id);
    return s ? s.runs.map((r) => r.id) : [];
  }
}

// Time spent per map name, so the Mapping page can say how long a map usually takes you.
// Maps under half a minute (opened and left at once) would only pull the usual time down.
function mapTimes(runs) {
  const out = {};
  for (const r of runs || []) {
    const ms = r.durationMs || r.activeMs || 0;
    if (!r.name || ms < 30000) continue;
    const m = out[r.name] || (out[r.name] = { n: 0, ms: 0 });
    m.n++; m.ms += ms;
  }
  return out;
}
const brief = (s) => ({ id: s.id, strategyId: s.strategyId || null, startedAt: s.startedAt, endedAt: s.endedAt, divine: s.divine, totals: s.totals, mapTimes: mapTimes(s.runs) });

module.exports = { recheckCells, SnapshotStore, SessionArchive, markCarried, mapTimes, MAX_TRIPS };
