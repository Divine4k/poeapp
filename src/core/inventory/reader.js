'use strict';
// Reads the whole inventory from one captured frame.
const { COLS, ROWS, gridRect, extractCell, isEmptyCell, isInventoryOpen } = require('./grid');
const { readStack } = require('./digits');
const { fingerprint } = require('./icons');

class InventoryReader {
  constructor(index) {
    this.index = index;
    this.memory = new Array(COLS * ROWS).fill(null); // last known { name, qty } per cell
    this.prints = new Array(COLS * ROWS).fill(null); // picture fingerprint per filled cell, from the last clean read
  }

  forgetCells() { this.memory.fill(null); }

  // Returns null when the inventory is not open, otherwise:
  // { counts: Map(name -> qty), recognised, unknown: [{ cell, qty, print, rgb }],
  //   cells: [{ cell, rgb, print, status, name, qty, score, source }] }
  // status: 'item' recognised now, 'remembered' covered but known from before,
  //         'unknown' has a stack number but no match, 'skipped' no stack number, 'ignored'.
  read(frame) {
    const rect = gridRect(frame.width, frame.height);
    if (!isInventoryOpen(frame, rect)) return null;
    const counts = new Map();
    const unknown = [];
    const cells = [];
    let recognised = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = r * COLS + c;
        const rgb = extractCell(frame, rect, r, c);
        if (isEmptyCell(rgb)) { this.memory[k] = null; this.prints[k] = null; continue; }
        const print = fingerprint(rgb);
        this.prints[k] = print;
        let hit = this.index.match(print);
        const info = { cell: k, rgb, print, status: 'skipped', name: null, qty: 0, score: null, source: null };
        cells.push(info);
        if (hit && hit.ignored) { this.memory[k] = null; info.status = 'ignored'; continue; }
        const stack = readStack(rgb);
        info.qty = stack;
        // Downloaded art only covers stackable items, and those always show a number. A cell
        // without one that merely resembles such an item is something else.
        if (hit && hit.source === 'art' && !stack) hit = null;
        if (hit) {
          this.memory[k] = { name: hit.name, qty: stack || 1 };
          info.status = 'item'; info.score = hit.score; info.source = hit.source;
        } else if (!this.memory[k]) {
          // Not recognised, and nothing was known here before. Only cells with a stack number
          // are worth asking about; gear and other single items are skipped.
          if (stack > 0) { unknown.push({ cell: k, qty: stack, print, rgb }); info.status = 'unknown'; }
          continue;
        } else {
          // An unrecognised cell that held a known item a moment ago is most likely covered by
          // a tooltip or the cursor, so the remembered item stays.
          info.status = 'remembered';
        }
        const m = this.memory[k];
        info.name = m.name; info.qty = m.qty;
        counts.set(m.name, (counts.get(m.name) || 0) + m.qty);
        recognised++;
      }
    }
    return { counts, recognised, unknown, cells };
  }
}

module.exports = { InventoryReader };
