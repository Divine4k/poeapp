'use strict';
// Works out what was picked up from successive inventory readings.
//
// In a map, any item count above the baseline is loot. Only the highest count seen is credited,
// so a reading where something was briefly hidden cannot create loot out of nothing.
//
// After leaving the map the ledger stays in "arrival" mode: readings in the hideout still count
// for the map just left (this catches loot picked up while the inventory was never opened).
// Arrival ends the moment any count goes down, because that means stashing has started. From
// then on hideout readings only move the baseline: stashing, or taking scarabs out, is not loot.
class LootLedger {
  constructor() {
    this.baseline = null;      // Map(name -> qty)
    this.credited = new Map(); // gain already counted per item since the baseline
    this.last = null;          // previous reading since arriving in the hideout, to notice stashing
    this.inMap = false;
    this.pendingArrival = false;
  }

  enterMap(isNewRun) {
    if (isNewRun) this.credited = new Map();
    this.inMap = true;
    this.pendingArrival = false;
  }

  leaveMap() {
    if (this.inMap) { this.pendingArrival = true; this.last = null; }
    this.inMap = false;
  }

  // counts: Map(name -> qty). Returns [{ name, qty }] newly gained.
  reading(counts) {
    if (!this.baseline) { this.baseline = new Map(counts); return []; }
    // Counts going down between two hideout readings means stashing has started. The first
    // reading after arriving is never judged this way: scrolls get used up inside the map.
    let dropped = false;
    if (this.pendingArrival) {
      if (this.last) for (const [name, qty] of this.last) if ((counts.get(name) || 0) < qty) { dropped = true; break; }
      this.last = new Map(counts);
    }

    const gains = [];
    const credit = this.inMap || (this.pendingArrival && !dropped);
    if (credit) {
      for (const [name, qty] of counts) {
        const gain = qty - (this.baseline.get(name) || 0);
        const done = this.credited.get(name) || 0;
        if (gain > done) { gains.push({ name, qty: gain - done }); this.credited.set(name, gain); }
      }
    }
    if (!this.inMap && (dropped || !this.pendingArrival)) {
      this.baseline = new Map(counts);
      this.credited = new Map();
      this.pendingArrival = false;
    }
    return gains;
  }

  toJSON() {
    const list = (m) => (m ? [...m] : null);
    return { baseline: list(this.baseline), credited: list(this.credited), last: list(this.last), inMap: this.inMap, pendingArrival: this.pendingArrival };
  }

  // Restores a saved ledger after the app was closed. If it was closed mid-map, the next
  // hideout reading still counts for that map.
  restore(o) {
    if (!o || !Array.isArray(o.baseline)) return;
    this.baseline = new Map(o.baseline);
    this.credited = new Map(o.credited || []);
    this.last = o.last ? new Map(o.last) : null;
    this.inMap = false;
    this.pendingArrival = !!(o.inMap || o.pendingArrival);
    if (o.inMap) this.last = null;
  }
}

module.exports = { LootLedger };
