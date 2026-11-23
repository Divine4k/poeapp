'use strict';
// Reads the whole inventory from one captured frame.
const { COLS, ROWS, gridRect, extractCell, isEmptyCell, isInventoryOpen } = require('./grid');
const { readStack } = require('./digits');
const { fingerprint, similarity } = require('./icons');
const { readMapTier, mapName } = require('./maps');

class InventoryReader {
  constructor(index) {
    this.index = index;
    this.memory = new Array(COLS * ROWS).fill(null); // last known { name, qty } per cell
    this.prints = new Array(COLS * ROWS).fill(null); // picture fingerprint per filled cell, from the last clear view of it
    this.pins = new Array(COLS * ROWS).fill(null);   // items counted by hand for one slot: { name, qty, print }
  }

  forgetCells() { this.memory.fill(null); this.pins.fill(null); }

  // Counts whatever sits in this slot as the named item until the slot changes. Used for items
  // that cannot be told apart by picture (divination cards, maps, uniques).
  pin(cell, name, qty) {
    if (!this.prints[cell]) return false;
    this.pins[cell] = { name, qty: Math.max(1, qty || 1), print: this.prints[cell] };
    this.memory[cell] = { name, qty: this.pins[cell].qty };
    return true;
  }

  // cursor: { row, col } when the mouse is over the grid, otherwise null. The hovered item's
  // tooltip opens upwards, so the hovered slot and every row above it may be covered: what was
  // known there is kept, and nothing new is concluded from those slots in this read.
  //
  // Returns null when the inventory is not open, otherwise:
  // { counts: Map(name -> qty), recognised, unknown: [{ cell, qty, print, rgb }], empties: [cell],
  //   cells: [{ cell, rgb, print, status, name, qty, score, source }] }
  // status: 'item' recognised now, 'remembered' covered but known from before,
  //         'unknown' has a stack number but no match, 'skipped' no stack number, 'ignored'.
  read(frame, { cursor = null } = {}) {
    const rect = gridRect(frame.width, frame.height);
    if (!isInventoryOpen(frame, rect)) return null;
    const counts = new Map();
    const unknown = [];
    const cells = [];
    const empties = [];
    let recognised = 0;
    const add = (k) => { const m = this.memory[k]; counts.set(m.name, (counts.get(m.name) || 0) + m.qty); recognised++; };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = r * COLS + c;
        const unsure = !!cursor && (r < cursor.row || (r === cursor.row && c === cursor.col));
        const rgb = extractCell(frame, rect, r, c);
        if (isEmptyCell(rgb)) {
          if (unsure && this.memory[k]) {
            cells.push({ cell: k, rgb, print: this.prints[k], status: 'remembered', name: this.memory[k].name, qty: this.memory[k].qty, score: null, source: null });
            add(k);
          } else if (!unsure) {
            this.memory[k] = null; this.prints[k] = null; this.pins[k] = null;
            empties.push(k);
          }
          continue;
        }
        const print = fingerprint(rgb);
        if (!unsure) this.prints[k] = print;
        const info = { cell: k, rgb, print, status: 'skipped', name: null, qty: 0, score: null, source: null };
        cells.push(info);

        const pin = this.pins[k];
        if (pin) {
          if (unsure || similarity(print, pin.print) > 0.88) {
            const stack = unsure ? 0 : readStack(rgb);
            this.memory[k] = { name: pin.name, qty: stack || pin.qty };
            info.status = 'item'; info.source = 'pinned'; info.name = pin.name; info.qty = this.memory[k].qty;
            add(k);
            continue;
          }
          this.pins[k] = null; // something else is in this slot now
          this.memory[k] = null;
        }

        let hit = this.index.match(print);
        if (hit && hit.ignored) { this.memory[k] = null; info.status = 'ignored'; continue; }
        const stack = readStack(rgb);
        info.qty = stack;
        // Downloaded art only covers stackable items, and those always show a number. A cell
        // without one that merely resembles such an item is something else.
        if (hit && hit.source === 'art' && !stack) hit = null;
        // Maps: a single item whose tier is read from the numeral on its picture.
        if (!hit && !stack) {
          const map = readMapTier(rgb);
          if (map) hit = { name: mapName(map.tier), score: map.score, source: 'map' };
        }
        if (hit) {
          this.memory[k] = { name: hit.name, qty: stack || 1 };
          info.status = 'item'; info.score = hit.score; info.source = hit.source;
        } else if (!this.memory[k]) {
          // Not recognised, and nothing was known here before. Only cells with a stack number
          // are worth asking about; gear and other single items are skipped. A possibly covered
          // slot is never reported: it may just be a tooltip.
          if (stack > 0 && !unsure) { unknown.push({ cell: k, qty: stack, print, rgb }); info.status = 'unknown'; }
          else if (unsure) info.status = 'covered';
          continue;
        } else {
          // An unrecognised cell that held a known item a moment ago is most likely covered by
          // a tooltip or the cursor, so the remembered item stays.
          info.status = 'remembered';
        }
        info.name = this.memory[k].name; info.qty = this.memory[k].qty;
        add(k);
      }
    }
    return { counts, recognised, unknown, cells, empties };
  }
}

module.exports = { InventoryReader };
