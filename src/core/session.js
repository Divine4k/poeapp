'use strict';
// Session state: map runs, timers, deaths, loot and costs. Pure logic, no Electron or file access.

let nextId = 1;
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
      this.pause(cur);
      this.away = true;
      return true;
    }
    const known = cur && (cur.key === key || cur.subKeys.includes(key));
    if (known) {
      this.resume(cur);
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
    this.pause(cur);
    cur.endedAt = this.now();
    this.currentId = null;
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
    run.uncounted = { stacks: Math.max(u.stacks, stacks), singles: Math.max(u.singles, singles) };
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
    totals.netPerHour = elapsedMs > 60000 ? totals.net / (elapsedMs / 3600000) : 0;
    totals.avgMapMs = runs.length ? totals.mapMs / runs.length : 0;
    const divine = prices ? prices.divine : 0;
    return {
      now: this.now(), startedAt: this.startedAt, currentId: this.currentId,
      away: this.away, location: this.location, divine, runs, totals,
    };
  }

  toJSON() {
    return { startedAt: this.startedAt, runs: this.runs, currentId: this.currentId, away: this.away, location: this.location };
  }

  // Restores a saved session. Any run that was mid-map is paused, since the app was closed.
  restore(o) {
    if (!o || !Array.isArray(o.runs)) return;
    this.startedAt = o.startedAt || this.now();
    this.runs = o.runs.map((r) => ({ subKeys: [], loot: [], seen: [], costs: [], ...r, segmentStart: null }));
    this.currentId = o.currentId || null;
    this.away = true;
    this.location = o.location || this.location;
  }
}

module.exports = { Session };
