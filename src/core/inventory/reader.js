'use strict';
// Reads the whole inventory from one captured frame.
const { COLS, ROWS, gridRect, extractCell, isEmptyCell, isInventoryOpen } = require('./grid');
const { readStack } = require('./digits');
const { fingerprint } = require('./icons');

class InventoryReader {
  constructor(index) {
    this.index = index;
    this.memory = new Array(COLS * ROWS).fill(null); // last known { name, qty } per cell
  }

  forgetCells() { this.memory.fill(null); }

  // Returns null when the inventory is not open, otherwise:
  // { counts: Map(name -> qty), recognised, unknown: [{ cell, qty, print, rgb }] }
  read(frame) {
    const rect = gridRect(frame.width, frame.height);
    if (!isInventoryOpen(frame, rect)) return null;
    const counts = new Map();
    const unknown = [];
    let recognised = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = r * COLS + c;
        const rgb = extractCell(frame, rect, r, c);
        if (isEmptyCell(rgb)) { this.memory[k] = null; continue; }
        const print = fingerprint(rgb);
        const hit = this.index.match(print);
        if (hit) {
          this.memory[k] = { name: hit.name, qty: readStack(rgb) || 1 };
        } else if (!this.memory[k]) {
          // Not recognised, and nothing was known here before. Only cells with a stack number
          // are worth asking about; gear and other single items are skipped.
          const qty = readStack(rgb);
          if (qty > 0) unknown.push({ cell: k, qty, print, rgb });
          continue;
        }
        // An unrecognised cell that held a known item a moment ago is most likely covered by a
        // tooltip or the cursor, so the remembered item stays.
        const m = this.memory[k];
        counts.set(m.name, (counts.get(m.name) || 0) + m.qty);
        recognised++;
      }
    }
    return { counts, recognised, unknown };
  }
}

module.exports = { InventoryReader };
