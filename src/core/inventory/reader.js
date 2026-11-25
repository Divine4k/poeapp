'use strict';
// Reads the whole inventory from one captured frame.
const { COLS, ROWS, gridRect, extractCell, isEmptyCell, isInventoryOpen, multiSlotCells } = require('./grid');
const { readStack } = require('./digits');
const { fingerprint, similarity, sharpShifts } = require('./icons');
const { readMapTier } = require('./maps');

// How alike a cell without a stack number must be to downloaded item art to count as that item.
// Numbered cells match from 0.82; a wrong picture has reached 0.80 in a real capture.
const SINGLE_ART_SCORE = 0.88;

class InventoryReader {
  constructor(index) {
    this.index = index;
    this.memory = new Array(COLS * ROWS).fill(null); // last known { name, qty } per cell
    this.prints = new Array(COLS * ROWS).fill(null); // picture fingerprint per filled cell, from the last clear view of it
    this.pins = new Array(COLS * ROWS).fill(null);   // items counted by hand for one slot: { name, qty, print }
    this.ignoreNames = new Set();                    // items you chose never to count, by name
    // What was worked out from each slot's picture the last time: { rgb, empty, stack, print,
    // stamp, hit, near, map }. A slot whose picture is exactly the same as last time (most of
    // them, on most readings) is not read again: the same pixels against the same lists give
    // the same answer, and the matching is by far the slowest part of a reading.
    this.seen = new Array(COLS * ROWS).fill(null);
  }

  // The kept answers for slot k, started afresh when its picture changed.
  look(k, rgb) {
    const s = this.seen[k];
    if (s && Buffer.compare(s.rgb, rgb) === 0) return s;
    return (this.seen[k] = { rgb, empty: isEmptyCell(rgb), stack: undefined, print: null, stamp: null, hit: undefined, near: undefined, map: undefined });
  }
  // The answers that depend on the item lists are dropped when those changed.
  fresh(s) {
    const stamp = this.index.stamp;
    if (s.stamp !== stamp) { s.stamp = stamp; s.hit = undefined; s.near = undefined; }
    return s;
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
    // First the whole grid is cut out, so pieces of items that take several slots (a bow, a
    // body armour) can be told from items of one slot. A piece is never matched to a picture:
    // a corner of a bow on its backdrop can look like a thin one-slot item.
    const rgbs = [], empty = [], stacks = [], seen = [];
    for (let k = 0; k < COLS * ROWS; k++) {
      const s = this.look(k, extractCell(frame, rect, Math.floor(k / COLS), k % COLS));
      if (s.stack === undefined) s.stack = s.empty ? 0 : readStack(s.rgb);
      seen.push(s); rgbs.push(s.rgb); empty.push(s.empty); stacks.push(s.stack);
    }
    const pieces = multiSlotCells(rgbs.map((rgb, k) => (empty[k] || stacks[k] ? null : rgb)));
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = r * COLS + c;
        const unsure = !!cursor && (r < cursor.row || (r === cursor.row && c === cursor.col));
        const rgb = rgbs[k];
        if (empty[k]) {
          if (unsure && this.memory[k]) {
            cells.push({ cell: k, rgb, print: this.prints[k], status: 'remembered', name: this.memory[k].name, qty: this.memory[k].qty, score: null, source: null });
            add(k);
          } else if (!unsure) {
            this.memory[k] = null; this.prints[k] = null; this.pins[k] = null;
            empties.push(k);
          }
          continue;
        }
        const s = this.fresh(seen[k]);
        const print = s.print || (s.print = fingerprint(rgb));
        if (!unsure) this.prints[k] = print;
        // near: the closest names with their scores, kept when the read was not clear-cut.
        // how: 'sharp' when look-alikes were told apart on the sharp picture, 'doubt' when they could not be.
        const info = { cell: k, rgb, print, status: 'skipped', name: null, qty: 0, score: null, source: null, stack: 0, near: null, how: null, clear: false };
        cells.push(info);

        const pin = this.pins[k];
        if (pin) {
          if (unsure || similarity(print, pin.print) > 0.88) {
            const stack = unsure ? 0 : stacks[k];
            this.memory[k] = { name: pin.name, qty: stack || pin.qty };
            info.status = 'item'; info.source = 'pinned'; info.name = pin.name; info.qty = this.memory[k].qty;
            add(k);
            continue;
          }
          this.pins[k] = null; // something else is in this slot now
          this.memory[k] = null;
        }

        if (pieces.has(k) && !unsure) {
          this.memory[k] = null;
          info.part = true; // status stays 'skipped'
          continue;
        }

        if (s.hit === undefined) s.hit = this.index.match(print, () => sharpShifts(rgb)) || null;
        let hit = s.hit;
        if (hit && hit.ignored) { this.memory[k] = null; info.status = 'ignored'; continue; }
        const stack = stacks[k];
        info.qty = stack; info.stack = stack;
        if (hit) { info.how = hit.sharp ? 'sharp' : (hit.doubt ? 'doubt' : null); info.clear = !!hit.clear || !!hit.sharp; }
        if (!hit || hit.sharp || hit.doubt || hit.score < 0.9) info.near = s.near || (s.near = this.index.nearest(print, 3));
        // A cell without a stack number is a single item: one of something that does not stack
        // (an emblem, an invitation), or gear. It counts as one of the matched item, but only on
        // a clearly better match than a numbered cell needs, because gear can resemble an item's
        // picture and has no number to back the match up.
        if (hit && hit.source === 'art' && !stack && hit.score < SINGLE_ART_SCORE) hit = null;
        // Maps: a single item whose tier is read from the numeral on its picture.
        if (!hit && !stack) {
          if (s.map === undefined) s.map = readMapTier(rgb) || null;
          const map = s.map;
          if (map) hit = { name: map.name, score: map.score, source: 'map' };
        }
        // Recognised, but you chose never to count this item.
        if (hit && this.ignoreNames.has(hit.name)) { this.memory[k] = null; info.status = 'ignored'; info.off = hit.name; continue; }
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

// Which slots of a reading are safe to save as "this is how the item really looks in game":
// recognised only through downloaded art, with a stack number, a comfortable score, and either
// no look-alike near or a sharp verdict.
function learnable(cells, minScore = 0.84) {
  return cells.filter((c) => c.status === 'item' && c.source === 'art' && c.stack > 0 && c.clear && c.score >= minScore && c.print && c.rgb);
}

module.exports = { InventoryReader, SINGLE_ART_SCORE, learnable };
