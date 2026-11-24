'use strict';
// Recognises which item sits in an inventory cell by comparing a small fingerprint of the cell
// picture against known item pictures.
const { CANON } = require('./grid');

const BLOCK = 4;                 // 52 / 4 = 13 blocks per side
const SIDE = CANON / BLOCK;
// The stack number covers the top-left corner; those blocks are left out of the fingerprint.
const MASK_ROWS = 6;
const MASK_COLS = 7;

// rgb: CANON*CANON*3 values. Returns a unit-length Float32Array.
function fingerprint(rgb) {
  const values = [];
  for (let by = 0; by < SIDE; by++) {
    for (let bx = 0; bx < SIDE; bx++) {
      if (by < MASK_ROWS && bx < MASK_COLS) continue;
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < BLOCK; j++) {
        for (let i = 0; i < BLOCK; i++) {
          const o = ((by * BLOCK + j) * CANON + bx * BLOCK + i) * 3;
          r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2];
        }
      }
      values.push(r, g, b);
    }
  }
  const out = new Float32Array(values.length);
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let energy = 0;
  for (let k = 0; k < values.length; k++) { out[k] = values[k] - mean; energy += out[k] * out[k]; }
  const norm = Math.sqrt(energy) || 1;
  for (let k = 0; k < out.length; k++) out[k] /= norm;
  return out;
}

function similarity(a, b) {
  let dot = 0;
  for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
  return dot;
}

class IconIndex {
  // Pictures captured in game (named by you, or shared through the repository) are the exact
  // in-game rendering, so they must match almost perfectly. Downloaded item art is rendered
  // slightly differently, so it has to beat the runner-up as well. The numbers come from a real
  // capture: correct matches scored 0.83 to 0.99 and look-alikes (the two scrolls) were 0.05 apart,
  // while an item missing from the art list reached 0.80 against a wrong picture, only 0.03 ahead.
  constructor({ learnedThreshold = 0.9, artThreshold = 0.82, artMargin = 0.04 } = {}) {
    this.learnedThreshold = learnedThreshold;
    this.artThreshold = artThreshold;
    this.artMargin = artMargin;
    this.learned = []; // { name, print }  name '' means "ignore this item"
    this.shared = [];  // same shape, downloaded from the repository
    this.art = [];     // { name, print }
    this.closeCall = 0.03; // two names this close in score count as look-alikes
    this.priceOf = null;   // optional: name -> price, used to settle look-alikes
  }

  get size() { return this.learned.length + this.shared.length + this.art.length; }

  addLearned(name, print) { this.learned.push({ name, print }); }
  setShared(list) { this.shared = list; }
  addArt(name, print) { this.art.push({ name, print }); }
  clearArt() { this.art = []; }
  forget(name) { this.learned = this.learned.filter((e) => e.name !== name); }

  static best(list, print) {
    let best = null, score = -1, second = -1;
    for (const e of list) {
      const s = similarity(print, e.print);
      if (s > score) {
        if (best && best.name !== e.name) second = score;
        score = s; best = e;
      } else if (s > second && e.name !== best.name) second = s;
    }
    return { best, score, second };
  }

  // The closest downloaded pictures, however weak: [{ name, score }], best first, one per name.
  suggest(print, count = 3) {
    const byName = new Map();
    for (const e of this.art) {
      const s = similarity(print, e.print);
      if (s > (byName.get(e.name) || -1)) byName.set(e.name, s);
    }
    return [...byName].map(([name, score]) => ({ name, score })).sort((x, y) => y.score - x.score).slice(0, count);
  }

  // Can a picture be recognised as this name at all? False for names given to one slot by hand
  // (divination cards, uniques), which no picture leads to.
  knows(name) {
    return [this.learned, this.shared, this.art].some((list) => list.some((e) => e.name === name));
  }

  // Returns { name, score, source } or null when nothing matches well enough.
  // An item you chose to ignore comes back as { ignored: true }.
  //
  // All three lists are weighed together. They used to be tried in turn (yours, the shared list,
  // then downloaded art), which let a shared picture of a look-alike win before the art for the
  // real item was even considered: a plain Chaos Orb was read as an Eldritch Chaos Orb on a PC
  // that had the shared Eldritch picture but no Chaos one.
  match(print) {
    const names = new Map(); // name -> { score, source } for names that pass their list's bar
    let top = { name: null, score: -1 };   // best score of any name, passing or not
    let next = -1;                         // best score of a different name than top
    const artOf = new Map();               // name -> score of its downloaded picture
    const see = (list, source, bar) => {
      const best = new Map();
      for (const e of list) {
        const sc = similarity(print, e.print);
        if (sc > (best.get(e.name) || -1)) best.set(e.name, sc);
      }
      for (const [name, sc] of best) {
        if (source === 'art') artOf.set(name, sc);
        if (sc >= bar && sc > ((names.get(name) || {}).score || -1)) names.set(name, { score: sc, source });
        if (name === top.name) { if (sc > top.score) top.score = sc; } else if (sc > top.score) { next = Math.max(next, top.score); top = { name, score: sc }; } else if (sc > next) next = sc;
      }
    };
    see(this.learned, 'learned', this.learnedThreshold);
    see(this.shared, 'shared', this.learnedThreshold);
    see(this.art, 'art', this.artThreshold);
    if (!names.size) return null;

    let winner = null;
    for (const [name, v] of names) if (!winner || v.score > winner.score) winner = { name, ...v };
    // A shared picture can carry the wrong name (someone picked the wrong suggestion once, and a
    // plain Chaos Orb went out to everyone as "Eldritch Chaos Orb"). The downloaded art is the
    // check: when the art of another item fits clearly better than the art of the shared name,
    // the art's name is taken.
    if (winner.source === 'shared' && winner.name && artOf.has(winner.name)) {
      let other = null;
      for (const [name, v] of names) if (v.source === 'art' && name !== winner.name && (!other || v.score > other.score)) other = { name, ...v };
      if (other && other.score - artOf.get(winner.name) >= this.artMargin) return { name: other.name, score: other.score, source: 'art' };
    }
    // Look-alikes: other passing names almost as close. When prices are known the cheapest of
    // them is taken, so a doubtful read can never overstate the loot.
    const close = [...names].filter(([name, v]) => name !== winner.name && v.score >= winner.score - this.closeCall).map(([name, v]) => ({ name, ...v }));
    if (close.length && this.priceOf && winner.name) {
      const priced = [winner, ...close].filter((c) => c.name).map((c) => ({ ...c, price: Number(this.priceOf(c.name)) || 0 }));
      const cheapest = priced.reduce((m, c) => (c.price < m.price ? c : m));
      winner = cheapest;
    } else if (winner.source === 'art') {
      // Downloaded art alone must also beat every other picture clearly, passing or not.
      const rival = winner.name === top.name ? next : top.score;
      if (winner.score - rival < this.artMargin) return null;
    }
    if (!winner.name) return { ignored: true };
    return { name: winner.name, score: winner.score, source: winner.source };
  }
}

// Turns a decoded picture with transparency (4 bytes per pixel, BGRA or RGBA) into CANON-sized
// RGB on the inventory's dark blue cell background. The picture must already be CANON x CANON.
const CELL_BACKGROUND = [4, 4, 29];
function compositeOnCell(pixels, { bgr = true } = {}) {
  const n = CANON * CANON;
  // Chromium bitmaps are usually premultiplied; detect it instead of assuming.
  let premultiplied = true;
  for (let p = 0; p < n; p++) {
    const a = pixels[p * 4 + 3];
    if (pixels[p * 4] > a || pixels[p * 4 + 1] > a || pixels[p * 4 + 2] > a) { premultiplied = false; break; }
  }
  const out = new Uint8Array(n * 3);
  for (let p = 0; p < n; p++) {
    const a = pixels[p * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) {
      const v = pixels[p * 4 + (bgr ? 2 - k : k)];
      const c = premultiplied ? v + CELL_BACKGROUND[k] * (1 - a) : v * a + CELL_BACKGROUND[k] * (1 - a);
      out[p * 3 + k] = Math.max(0, Math.min(255, Math.round(c)));
    }
  }
  return out;
}

const encodePrint = (print) => Buffer.from(print.buffer, print.byteOffset, print.byteLength).toString('base64');
const decodePrint = (text) => { const b = Buffer.from(text, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

// Compact form for the shared list in the repository: one signed byte per value.
function packPrint(print) {
  let max = 0;
  for (const v of print) if (Math.abs(v) > max) max = Math.abs(v);
  const out = Buffer.alloc(print.length);
  for (let k = 0; k < print.length; k++) out.writeInt8(Math.round((print[k] / (max || 1)) * 127), k);
  return out.toString('base64');
}
function unpackPrint(text) {
  const b = Buffer.from(text, 'base64');
  const out = new Float32Array(b.length);
  let energy = 0;
  for (let k = 0; k < b.length; k++) { out[k] = b.readInt8(k); energy += out[k] * out[k]; }
  const norm = Math.sqrt(energy) || 1;
  for (let k = 0; k < out.length; k++) out[k] /= norm;
  return out;
}

module.exports = { fingerprint, similarity, IconIndex, compositeOnCell, encodePrint, decodePrint, packPrint, unpackPrint, CELL_BACKGROUND, SIDE };
