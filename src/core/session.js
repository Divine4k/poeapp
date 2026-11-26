'use strict';
// Session state: map runs, timers, deaths, loot and costs. Pure logic, no Electron or file access.

let nextId = 1;
// The session clock stops by itself when no map has been entered for this long after leaving one,
// and the time since leaving is taken off again.
const IDLE_MS = 5 * 60 * 1000;
const uid = () => `${Date.now().toString(36)}-${(nextId++).toString(36)}`;

class Session {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.reset();
  }

  reset() {
    this.startedAt = this.now();
    this.runs = [];
    this.currentId = null;
    this.away = true; // true while in hideout/town (or before the first map)
    this.location = { kind: 'unknown', code: '', name: '' };
    this.pendingNameFor = null;
    // The session's own clock, for the per hour number. It starts with the first map, keeps going
    // between maps, and stops when no map follows within IDLE_MS (see tick). ms: time counted
    // before `since`; since: when the running stretch began (null = not running); leftAt: when
    // the last map was left; paused: held by hand, maps do not start it again.
    this.clock = { ms: 0, since: null, leftAt: null, paused: false };
  }

  get current() { return this.runs.find((r) => r.id === this.currentId) || null; }

  // ---- log events -------------------------------------------------------
  handleLogEvent(ev, { characterName = '', loadout = [] } = {}) {
    if (ev.type === 'area') return this.onArea(ev, loadout);
    if (ev.type === 'entered') return this.onEntered(ev.name);
    if (ev.type === 'death') return this.onDeath(ev.name, characterName);
    return false;
  }

  onArea(ev, loadout) {
    const key = `${ev.code}:${ev.seed}`;
    const cur = this.current;
    this.location = { kind: ev.kind, code: ev.code, name: '' };
    this.pendingNameFor = null;

    if (ev.kind === 'hideout' || ev.kind === 'town') {
      if (!this.away) this.clock.leftAt = this.now();
      this.pause(cur);
      this.away = true;
      return true;
    }
    const known = cur && (cur.key === key || cur.subKeys.includes(key));
    if (known) {
      this.resume(cur);
      this.inMap();
      this.away = false;
      return true;
    }
    if (cur && !this.away && cur.segmentStart !== null) {
      // Went straight from the map into another area: a side area or boss room of the same run.
      cur.subKeys.push(key);
      return true;
    }
    if (ev.kind === 'map') {
      this.startRun({ key, code: ev.code, level: ev.level, loadout });
      this.pendingNameFor = this.currentId;
      this.away = false;
      return true;
    }
    return true; // campaign zones and the like are not tracked
  }

  onEntered(name) {
    this.location.name = name;
    const cur = this.current;
    if (cur && this.pendingNameFor === cur.id) { cur.name = name; this.pendingNameFor = null; }
    return true;
  }

  onDeath(name, characterName) {
    const cur = this.current;
    if (!cur || cur.segmentStart === null) return false;
    if (characterName && name.toLowerCase() !== characterName.toLowerCase()) return false;
    cur.deaths += 1;
    return true;
  }

  // ---- runs -------------------------------------------------------------
  startRun({ key = `manual:${uid()}`, code = '', level = null, name = '', loadout = [] } = {}) {
    this.endRun();
    const t = this.now();
    this.inMap();
    const run = {
      id: uid(), key, subKeys: [], code, level, name,
      startedAt: t, endedAt: null, activeMs: 0, segmentStart: t,
      deaths: 0, loot: [], seen: [],
      costs: (loadout || []).map((c) => ({ id: uid(), name: c.name || '', qty: Number(c.qty) || 1, chaos: c.chaos != null ? Number(c.chaos) : null })),
    };
    this.runs.push(run);
    this.currentId = run.id;
    return run;
  }

  pause(run) {
    if (run && run.segmentStart !== null) {
      run.activeMs += this.now() - run.segmentStart;
      run.segmentStart = null;
    }
  }

  resume(run) {
    if (run && run.segmentStart === null && run.endedAt === null) run.segmentStart = this.now();
  }

  endRun() {
    const cur = this.current;
    if (!cur) return;
    if (cur.segmentStart !== null) this.clock.leftAt = this.now();
    this.pause(cur);
    cur.endedAt = this.now();
    this.currentId = null;
  }

  // ---- the session clock ------------------------------------------------
  // A map is entered: the clock runs (unless held by hand) and the idle wait is off.
  inMap() {
    const c = this.clock;
    c.leftAt = null;
    if (!c.paused && c.since === null) c.since = this.now();
  }

  halt(at = this.now()) {
    const c = this.clock;
    if (c.since === null) return;
    c.ms += Math.max(0, at - c.since);
    c.since = null;
  }

  // Stops the clock when no map was entered for IDLE_MS after leaving one, counting only up to
  // the moment of leaving. Returns true when it stopped.
  tick() {
    const c = this.clock;
    if (c.since === null || c.leftAt === null || this.now() - c.leftAt < IDLE_MS) return false;
    this.halt(Math.max(c.since, c.leftAt));
    c.leftAt = null;
    return true;
  }

  // The buttons: pause holds the clock until resumed by hand; stop ends this stretch and the next
  // map starts it again; start/resume count from now (and stop again by themselves when no map follows).
  clockAction(op) {
    const c = this.clock;
    this.tick();
    if (op === 'pause') { this.halt(); c.paused = true; c.leftAt = null; }
    else if (op === 'stop') { this.halt(); c.paused = false; c.leftAt = null; }
    else if (op === 'start' || op === 'resume') {
      c.paused = false;
      if (c.since === null) c.since = this.now();
      c.leftAt = this.current && this.current.segmentStart !== null ? null : this.now();
    } else return false;
    return true;
  }

  clockMs() {
    const c = this.clock;
    return c.ms + (c.since !== null ? Math.max(0, this.now() - c.since) : 0);
  }

  deleteRun(runId) {
    if (this.currentId === runId) this.currentId = null;
    this.runs = this.runs.filter((r) => r.id !== runId);
  }

  // ---- loot and costs ---------------------------------------------------
  // entries: [{ name, qty }]. Returns the batch id, or null when there is no map to add to.
  addLoot(entries, source, runId = this.currentId) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run || !entries.length) return null;
    const batch = uid();
    const ts = this.now();
    for (const e of entries) {
      const qty = Math.max(1, Math.round(Number(e.qty) || 1));
      run.loot.push({ id: uid(), name: e.name, qty, ts, source, batch });
    }
    return batch;
  }

  addSeen(entries, runId = this.currentId) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) return;
    const ts = this.now();
    for (const e of entries) run.seen.push({ name: e.name, qty: e.qty || 1, ts });
    if (run.seen.length > 400) run.seen.splice(0, run.seen.length - 400);
  }

  // Records how much of the inventory could not be counted while this run was being read.
  // The highest numbers seen are kept.
  setUncounted(runId, stacks, singles) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) return;
    const u = run.uncounted || { stacks: 0, singles: 0 };
    run.uncounted = { ...u, stacks: Math.max(u.stacks, stacks), singles: Math.max(u.singles, singles) };
  }

  // Back from this run, n slots were hidden by a tooltip every time they were looked at and
  // then found empty: whatever they held went to the stash without being counted.
  addHidden(runId, n) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run || !(n > 0)) return;
    const u = run.uncounted || { stacks: 0, singles: 0 };
    run.uncounted = { ...u, hidden: (u.hidden || 0) + n };
  }

  // A trip is one stay in the map between two visits to the hideout. The inventory picture
  // kept for a map is kept per trip, because the inventory is stashed in between.
  nextTrip(runId = this.currentId) {
    const run = this.runs.find((r) => r.id === runId);
    if (run) run.trip = (run.trip || 0) + 1;
  }

  // Notes when the inventory picture for this run last changed, so the window can fetch it again.
  markSnapshot(runId) {
    const run = this.runs.find((r) => r.id === runId);
    if (run) run.snapAt = this.now();
  }

  removeLoot(runId, lootId) {
    const run = this.runs.find((r) => r.id === runId);
    if (run) run.loot = run.loot.filter((l) => l.id !== lootId);
  }

  removeLootName(runId, name) {
    const run = this.runs.find((r) => r.id === runId);
    if (run) run.loot = run.loot.filter((l) => l.name !== name);
  }

  // Corrects loot that was counted under the wrong name: up to qty of `from` becomes `to`.
  // Loot added by hand is left alone. With no `from` (the item was not recognised at the time)
  // the quantity is added. Returns how many were corrected.
  moveLoot(runId, from, to, qty) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run || !(qty > 0)) return 0;
    if (!from) { this.addLoot([{ name: to, qty }], 'recheck', runId); return qty; }
    let left = qty;
    const extra = [];
    for (const l of run.loot) {
      if (!left) break;
      if (l.name !== from || l.source === 'manual') continue;
      const n = Math.min(l.qty, left);
      if (n === l.qty) l.name = to;
      else { l.qty -= n; extra.push({ ...l, id: uid(), name: to, qty: n }); }
      left -= n;
    }
    run.loot.push(...extra);
    return qty - left;
  }

  removeBatch(runId, batch) {
    const run = this.runs.find((r) => r.id === runId);
    if (run) run.loot = run.loot.filter((l) => l.batch !== batch);
  }

  addCost(runId, cost) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) return;
    run.costs.push({ id: uid(), name: cost.name || '', qty: Number(cost.qty) || 1, chaos: cost.chaos != null ? Number(cost.chaos) : null });
  }

  removeCost(runId, costId) {
    const run = this.runs.find((r) => r.id === runId);
    if (run) run.costs = run.costs.filter((c) => c.id !== costId);
  }

  // ---- reporting --------------------------------------------------------
  runDuration(run) {
    return run.activeMs + (run.segmentStart !== null ? this.now() - run.segmentStart : 0);
  }

  // prices: object with chaosOf(name) and a divine getter
  summary(prices) {
    this.tick();
    const chaosOf = (n) => (prices ? prices.chaosOf(n) : 0);
    const runs = this.runs.map((run) => {
      const grouped = new Map();
      let lootValue = 0;
      for (const l of run.loot) {
        const v = chaosOf(l.name) * l.qty;
        lootValue += v;
        const g = grouped.get(l.name) || { name: l.name, qty: 0, chaos: 0, byHand: 0 };
        g.qty += l.qty; g.chaos += v;
        if (l.source === 'manual') g.byHand += l.qty;
        grouped.set(l.name, g);
      }
      let costValue = 0;
      const costs = run.costs.map((c) => {
        const each = c.chaos != null ? c.chaos : chaosOf(c.name);
        costValue += each * c.qty;
        return { ...c, each, total: each * c.qty, priced: c.chaos != null || each > 0 };
      });
      return {
        id: run.id, name: run.name || run.code || 'Map', level: run.level,
        startedAt: run.startedAt, endedAt: run.endedAt,
        activeMs: run.activeMs, segmentStart: run.segmentStart,
        durationMs: this.runDuration(run), deaths: run.deaths,
        lootValue, costValue, net: lootValue - costValue,
        uncounted: run.uncounted || { stacks: 0, singles: 0 },
        snapAt: run.snapAt || 0,
        items: [...grouped.values()].sort((a, b) => b.chaos - a.chaos),
        loot: run.loot.map((l) => ({ ...l, chaos: chaosOf(l.name) * l.qty })),
        seen: run.seen.slice(-40).map((s) => ({ ...s, chaos: chaosOf(s.name) * s.qty })),
        costs,
      };
    });
    const totals = { maps: runs.length, deaths: 0, lootValue: 0, costValue: 0, net: 0, mapMs: 0 };
    for (const r of runs) {
      totals.deaths += r.deaths; totals.lootValue += r.lootValue; totals.costValue += r.costValue;
      totals.net += r.net; totals.mapMs += r.durationMs;
    }
    const first = this.runs[0];
    const elapsedMs = first ? Math.max(1, this.now() - first.startedAt) : 0;
    totals.elapsedMs = elapsedMs;
    // Per hour over the session clock, not the time since the first map: the session may have
    // been left open for days between playing.
    const playMs = this.clockMs();
    totals.playMs = playMs;
    totals.netPerHour = playMs > 60000 ? totals.net / (playMs / 3600000) : 0;
    totals.avgMapMs = runs.length ? totals.mapMs / runs.length : 0;
    const divine = prices ? prices.divine : 0;
    return {
      now: this.now(), startedAt: this.startedAt, currentId: this.currentId,
      away: this.away, location: this.location, divine, runs, totals,
      clock: { ms: playMs, running: this.clock.since !== null, paused: this.clock.paused, leftAt: this.clock.leftAt, idleMs: IDLE_MS },
    };
  }

  toJSON() {
    return { startedAt: this.startedAt, runs: this.runs, currentId: this.currentId, away: this.away, location: this.location, clock: this.clock, savedAt: this.now() };
  }

  // Restores a saved session. Any run that was mid-map is paused, since the app was closed.
  restore(o) {
    if (!o || !Array.isArray(o.runs)) return;
    this.startedAt = o.startedAt || this.now();
    this.runs = o.runs.map((r) => ({ subKeys: [], loot: [], seen: [], costs: [], ...r, segmentStart: null }));
    this.currentId = o.currentId || null;
    this.away = true;
    this.location = o.location || this.location;
    // A clock that was running when the app closed counts up to leaving the last map, or else up
    // to the last save. Sessions from before the clock existed start from their maps' time.
    if (o.clock) {
      const c = { ms: Number(o.clock.ms) || 0, since: o.clock.since ?? null, leftAt: o.clock.leftAt ?? null, paused: !!o.clock.paused };
      if (c.since !== null) c.ms += Math.max(0, (c.leftAt ?? o.savedAt ?? c.since) - c.since);
      this.clock = { ms: c.ms, since: null, leftAt: null, paused: c.paused };
    } else {
      this.clock = { ms: this.runs.reduce((a, r) => a + (r.activeMs || 0), 0), since: null, leftAt: null, paused: false };
    }
  }
}

module.exports = { Session, IDLE_MS };
