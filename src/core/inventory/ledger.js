'use strict';
// Works out what was picked up from successive inventory readings.
//
// In a map, any item count above the baseline is loot. Only the highest count seen is credited,
// so a reading where something was briefly hidden cannot create loot out of nothing.
// The first reading after arriving in the hideout still belongs to the map just left (it catches
// what was picked up after the inventory was last open). After that, hideout readings only move
// the baseline: stashing items or taking scarabs out is not loot.
class LootLedger {
  constructor() {
    this.baseline = null;      // Map(name -> qty)
    this.credited = new Map(); // gain already counted per item since the baseline
    this.inMap = false;
    this.pendingArrival = false;
  }

  enterMap(isNewRun) {
    if (isNewRun) this.credited = new Map();
    this.inMap = true;
    this.pendingArrival = false;
  }

  leaveMap() {
    if (this.inMap) this.pendingArrival = true;
    this.inMap = false;
  }

  // counts: Map(name -> qty). Returns [{ name, qty }] newly gained.
  reading(counts) {
    if (!this.baseline) { this.baseline = new Map(counts); return []; }
    const gains = [];
    if (this.inMap || this.pendingArrival) {
      for (const [name, qty] of counts) {
        const gain = qty - (this.baseline.get(name) || 0);
        const done = this.credited.get(name) || 0;
        if (gain > done) { gains.push({ name, qty: gain - done }); this.credited.set(name, gain); }
      }
    }
    if (!this.inMap) {
      this.baseline = new Map(counts);
      this.credited = new Map();
      this.pendingArrival = false;
    }
    return gains;
  }
}

module.exports = { LootLedger };
