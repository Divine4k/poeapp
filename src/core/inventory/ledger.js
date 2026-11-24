'use strict';
// Works out what was picked up from successive inventory readings.
//
// A reading is { counts: Map(name -> qty), cells: [{ cell, name, qty }], empties: [cell] }.
//
// In a map: any item count above the baseline is loot. Only the highest count seen is credited,
// so a reading where something was briefly hidden cannot create loot out of nothing.
//
// Back in the hideout ("arrival"): the inventory is often never fully visible at once, because
// tooltips cover slots and items are being moved to the stash. So each slot is remembered the
// first time it is seen after arriving. Items only leave during stashing, so those first
// sightings add up to everything that came out of the map. A slot first seen empty that fills
// up later is a withdrawal from the stash (threads, a map), not loot.
//
// Entering a map: the inventory as last seen in the hideout becomes the new baseline.
class LootLedger {
  constructor() {
    this.baseline = null;       // Map(name -> qty)
    this.credited = new Map();  // gain already counted per item since the baseline
    this.inMap = false;
    this.pendingArrival = false;
    this.arrival = new Map();   // cell -> { name, qty } | null (first seen empty)
    this.hideout = null;        // counts from the latest hideout reading
  }

  enterMap() {
    if (this.hideout) {
      this.baseline = this.hideout;
      this.credited = new Map();
    }
    this.hideout = null;
    this.arrival = new Map();
    this.inMap = true;
    this.pendingArrival = false;
  }

  leaveMap() {
    if (this.inMap) { this.pendingArrival = true; this.arrival = new Map(); this.hideout = null; }
    this.inMap = false;
  }

  credit(counts) {
    const gains = [];
    for (const [name, qty] of counts) {
      const gain = qty - (this.baseline.get(name) || 0);
      const done = this.credited.get(name) || 0;
      if (gain > done) { gains.push({ name, qty: gain - done }); this.credited.set(name, gain); }
    }
    return gains;
  }

  // Returns [{ name, qty }] newly gained.
  reading({ counts, cells = [], empties = [] }) {
    if (!this.baseline) {
      // Nothing to compare against yet: this reading is the starting point.
      this.baseline = new Map(counts);
      if (!this.inMap) this.hideout = new Map(counts);
      return [];
    }
    if (this.inMap) return this.credit(counts);

    let gains = [];
    if (this.pendingArrival) {
      for (const k of empties) if (!this.arrival.has(k)) this.arrival.set(k, null);
      for (const c of cells) {
        // Only the first sighting counts: a stack that grows later was topped up from the stash.
        if (!this.arrival.has(c.cell)) this.arrival.set(c.cell, { name: c.name, qty: c.qty });
      }
      const arrived = new Map();
      for (const v of this.arrival.values()) if (v) arrived.set(v.name, (arrived.get(v.name) || 0) + v.qty);
      gains = this.credit(arrived);
    }
    this.hideout = new Map(counts);
    return gains;
  }

  // An item turned out to be something else (a wrong name was corrected, or an item that was not
  // recognised got its name). Moves what was already counted, so the next reading does not
  // count it a second time. from: the old name, or null when it had none.
  // carried: how many of them were in the inventory before the map. gained: how many were
  // already counted as loot under the old name, or have just been added by hand under the new.
  rename(from, to, { carried = 0, gained = 0, cell = null } = {}) {
    const move = (map, n) => {
      if (!map || !(n > 0)) return;
      if (from) { const left = (map.get(from) || 0) - n; if (left > 0) map.set(from, left); else map.delete(from); }
      map.set(to, (map.get(to) || 0) + n);
    };
    move(this.baseline, carried);
    move(this.credited, gained);
    move(this.hideout, carried + gained);
    if (cell !== null) { const a = this.arrival.get(cell); if (a && (a.name === from || !from)) a.name = to; }
  }

  toJSON() {
    const list = (m) => (m ? [...m] : null);
    return {
      baseline: list(this.baseline), credited: list(this.credited), hideout: list(this.hideout), arrival: list(this.arrival),
      inMap: this.inMap, pendingArrival: this.pendingArrival,
    };
  }

  // Restores a saved ledger after the app was closed. If it was closed mid-map, the next
  // hideout reading still counts for that map.
  restore(o) {
    if (!o || !Array.isArray(o.baseline)) return;
    this.baseline = new Map(o.baseline);
    this.credited = new Map(o.credited || []);
    this.hideout = o.hideout ? new Map(o.hideout) : null;
    this.arrival = new Map(o.arrival || []);
    this.inMap = false;
    this.pendingArrival = !!(o.inMap || o.pendingArrival);
  }
}

module.exports = { LootLedger };
