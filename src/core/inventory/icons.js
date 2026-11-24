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

// A fingerprint as a small picture, SIDE x SIDE pixels of RGB. Brightness and contrast are not
// kept in a fingerprint, so they are guessed: it shows the shapes and colours of the item as a
// blur, enough to tell what it is. The corner where the stack number sits is left dark.
function printPixels(print) {
  let peak = 0;
  for (const v of print) peak = Math.max(peak, Math.abs(v));
  const gain = peak ? 115 / peak : 0;
  const out = Buffer.alloc(SIDE * SIDE * 3, 18);
  let k = 0;
  for (let by = 0; by < SIDE; by++) {
    for (let bx = 0; bx < SIDE; bx++) {
      if (by < MASK_ROWS && bx < MASK_COLS) continue;
      const o = (by * SIDE + bx) * 3;
      for (let ch = 0; ch < 3; ch++) out[o + ch] = Math.max(0, Math.min(255, Math.round(120 + print[k++] * gain)));
    }
  }
  return out;
}

// The sharp print: the same idea as the fingerprint at four times the detail (2x2 pixel blocks,
// 26 a side), used to tell look-alikes apart. dx, dy shift the picture by a pixel, because
// downloaded art and the game's own drawing can sit a pixel apart.
const SHARP_BLOCK = 2;
const SHARP_SIDE = CANON / SHARP_BLOCK;
function sharpPrint(rgb, dx = 0, dy = 0) {
  const values = [];
  for (let by = 0; by < SHARP_SIDE; by++) {
    for (let bx = 0; bx < SHARP_SIDE; bx++) {
      if (by * SHARP_BLOCK < MASK_ROWS * BLOCK && bx * SHARP_BLOCK < MASK_COLS * BLOCK) continue;
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < SHARP_BLOCK; j++) {
        for (let i = 0; i < SHARP_BLOCK; i++) {
          const y = Math.min(CANON - 1, Math.max(0, by * SHARP_BLOCK + j + dy)), x = Math.min(CANON - 1, Math.max(0, bx * SHARP_BLOCK + i + dx));
          const o = (y * CANON + x) * 3;
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
// The slot's sharp print as it is and shifted one pixel each way.
function sharpShifts(rgb) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(sharpPrint(rgb, dx, dy));
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
    this.lookalike = 0.12;      // names within this of the leader get the sharp second look
    this.sharpLeadGame = 0.02;  // how far ahead the sharp winner must be among in-game pictures
    this.sharpLeadArt = 0.03;   // and among downloaded art (measured: right item at least 0.07 ahead)
  }

  get size() { return this.learned.length + this.shared.length + this.art.length; }

  // sharp: the sharp print of the same picture, when it is known. auto: learned by the app itself.
  addLearned(name, print, { sharp = null, auto = false } = {}) { this.learned.push({ name, print, sharp, auto }); }
  setShared(list) { this.shared = list; }
  addArt(name, print, sharp = null) { this.art.push({ name, print, sharp }); }
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

  // The closest names in every list, however weak: [{ name, score, source }], best first.
  // Kept with each slot so a wrong or missing read can be explained afterwards.
  nearest(print, count = 3) {
    const byName = new Map();
    for (const [list, source] of [[this.learned, 'learned'], [this.shared, 'shared'], [this.art, 'art']]) {
      for (const e of list) {
        if (!e.name) continue;
        const s = similarity(print, e.print);
        if (s > ((byName.get(e.name) || {}).score || -1)) byName.set(e.name, { name: e.name, score: s, source });
      }
    }
    return [...byName.values()].sort((x, y) => y.score - x.score).slice(0, count);
  }

  // Returns { name, score, source } or null when nothing matches well enough.
  // An item you chose to ignore comes back as { ignored: true }.
  //
  // sharpOf: optional function giving the slot's sharp prints (sharpShifts). It is only called
  // when look-alikes have to be told apart.
  //
  // First pass, on the blurred fingerprint: every list is scored and the best name that passes
  // its list's bar leads. Second pass, only when other names come close: the leader and those
  // look-alikes are compared again on sharp pictures of the same kind (all in-game pictures, or
  // all downloaded art, so no name has an unfair head start), and a clear winner there decides.
  // Without a clear winner the older cautious rules apply.
  match(print, sharpOf = null) {
    const names = new Map(); // name -> { score, source, auto } for names that pass their list's bar
    const all = new Map();   // name -> best score in any list, passing or not
    const artOf = new Map(); // name -> score of its downloaded picture
    const see = (list, source, bar) => {
      const best = new Map();
      for (const e of list) {
        const sc = similarity(print, e.print);
        const b = best.get(e.name);
        if (!b || sc > b.score) best.set(e.name, { score: sc, auto: !!e.auto });
      }
      for (const [name, v] of best) {
        if (source === 'art') artOf.set(name, v.score);
        if (v.score >= bar && v.score > ((names.get(name) || {}).score || -1)) names.set(name, { score: v.score, source, auto: v.auto });
        if (v.score > (all.get(name) || -1)) all.set(name, v.score);
      }
    };
    see(this.learned, 'learned', this.learnedThreshold);
    // A picture you named yourself settles it: the shared list is only asked when you have none.
    if (!names.size) see(this.shared, 'shared', this.learnedThreshold);
    see(this.art, 'art', this.artThreshold);
    if (!names.size) return null;

    let winner = null;
    for (const [name, v] of names) if (!winner || v.score > winner.score) winner = { name, ...v };
    if (!winner.name) return { ignored: true };
    const done = (w, extra = {}) => ({ name: w.name, score: w.score, source: w.source, ...extra });

    // Look-alikes: every other name whose blurred score comes near the leader's.
    const floor = Math.max(winner.score - this.lookalike, 0.7);
    const rivals = [...all].filter(([name, sc]) => name && name !== winner.name && sc >= floor).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([name]) => name);
    if (!rivals.length) return done(winner, { clear: true });

    // A picture you named by hand and that fits almost exactly stands, unless another picture
    // you have in game form is among the look-alikes.
    const mine = (name) => names.has(name) && names.get(name).source !== 'art';
    if (winner.source === 'learned' && !winner.auto && winner.score >= 0.95 && !rivals.some(mine)) return done(winner);

    if (sharpOf) {
      const group = [winner.name, ...rivals];
      const tiers = [
        { lists: [this.learned, this.shared], lead: this.sharpLeadGame },
        { lists: [this.art], lead: this.sharpLeadArt },
      ];
      let shifts = null;
      for (const tier of tiers) {
        const refs = new Map(group.map((n) => [n, []]));
        for (const list of tier.lists) for (const e of list) if (e.sharp && refs.has(e.name)) refs.get(e.name).push(e.sharp);
        if (group.some((n) => !refs.get(n).length)) continue; // only a fair fight counts
        shifts = shifts || sharpOf();
        const scored = group.map((n) => {
          let best = -1;
          for (const ref of refs.get(n)) for (const sh of shifts) { const sc = similarity(sh, ref); if (sc > best) best = sc; }
          return { name: n, sharp: best };
        }).sort((x, y) => y.sharp - x.sharp);
        if (scored[0].sharp - scored[1].sharp < tier.lead) continue;
        const pick = scored[0].name;
        // The sharp winner still needs blurred evidence of its own: it passed a bar, or it is
        // downloaded art that came close to its bar.
        if (names.has(pick)) return done({ name: pick, ...names.get(pick) }, { sharp: true });
        if (tier.lists[0] === this.art && (artOf.get(pick) || 0) >= this.artThreshold - 0.08) return done({ name: pick, score: artOf.get(pick), source: 'art' }, { sharp: true });
      }
    }

    // No sharp verdict. The cautious rules:
    // A shared picture can carry the wrong name (someone picked the wrong suggestion once, and a
    // plain Chaos Orb went out to everyone as "Eldritch Chaos Orb"). When the art of another
    // item fits clearly better than the art of the shared name, the art's name is taken.
    if (winner.source === 'shared' && artOf.has(winner.name)) {
      let other = null;
      for (const [name, v] of names) if (v.source === 'art' && name !== winner.name && (!other || v.score > other.score)) other = { name, ...v };
      if (other && other.score - artOf.get(winner.name) >= this.artMargin) return done(other, { doubt: true });
    }
    // Other passing names almost as close: the cheapest is taken, so a doubtful read can never
    // overstate the loot.
    const close = [...names].filter(([name, v]) => name && name !== winner.name && v.score >= winner.score - this.closeCall).map(([name, v]) => ({ name, ...v }));
    if (close.length && this.priceOf) {
      const priced = [winner, ...close].map((c) => ({ ...c, price: Number(this.priceOf(c.name)) || 0 }));
      return done(priced.reduce((m, c) => (c.price < m.price ? c : m)), { doubt: true });
    }
    // Downloaded art alone must beat every other picture clearly, passing or not.
    if (winner.source === 'art') {
      let rival = -1;
      for (const [name, sc] of all) if (name !== winner.name && sc > rival) rival = sc;
      if (winner.score - rival < this.artMargin) return null;
    }
    return done(winner, { doubt: winner.source !== 'art' });
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

module.exports = { sharpPrint, sharpShifts, printPixels, fingerprint, similarity, IconIndex, compositeOnCell, encodePrint, decodePrint, packPrint, unpackPrint, CELL_BACKGROUND, SIDE };
