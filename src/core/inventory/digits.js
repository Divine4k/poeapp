'use strict';
// Reads the stack number drawn in the top-left corner of an inventory cell.
//
// The game always uses the same font at the same place, so this matches small digit pictures
// (digitTemplates.json, cut from real captures) against the cell, left to right.
//
// Each digit is tried two ways. The first compares the whole digit box and is the most exact on
// ordinary icons. On bright icons (Exalted Orb, Blessed Orb) the area around the digit is bright
// too and that comparison fails, so the second way looks only at the digit's strokes and the
// thin dark outline the game draws around them.
const { CANON } = require('./grid');

const TEMPLATES = require('./digitTemplates.json').map((t) => {
  let sum = 0;
  for (const v of t.data) sum += v;
  const mean = sum / t.data.length;
  let energy = 0;
  const centered = t.data.map((v) => { const c = v - mean; energy += c * c; return c; });
  const strokes = t.data.map((v) => v > 200);

  // Pixels on or right next to a stroke.
  const mask = [], values = [], strokeIdx = [];
  for (let j = 0; j < t.h; j++) {
    for (let i = 0; i < t.w; i++) {
      let near = false;
      for (let dj = -1; dj <= 1 && !near; dj++) {
        for (let di = -1; di <= 1; di++) {
          const x = i + di, y = j + dj;
          if (x >= 0 && y >= 0 && x < t.w && y < t.h && t.data[y * t.w + x] > 140) { near = true; break; }
        }
      }
      if (!near) continue;
      if (t.data[j * t.w + i] > 200) strokeIdx.push(mask.length);
      mask.push(j * t.w + i);
      values.push(t.data[j * t.w + i]);
    }
  }
  const mMean = values.reduce((a, b) => a + b, 0) / values.length;
  const mCentered = values.map((v) => v - mMean);
  const mNorm = Math.sqrt(mCentered.reduce((a, b) => a + b * b, 0));
  return { ...t, centered, norm: Math.sqrt(energy), strokes, mask, mCentered, mNorm, strokeIdx };
});

const FULL_MATCH = 0.72;        // whole-box comparison
const OUTLINE_FIRST = 0.6;      // strokes-and-outline comparison, first digit
const OUTLINE_NEXT = 0.7;       // later digits need more, so a bright icon cannot add a stray digit
const STROKE_MIN = 150;         // digit strokes must really be bright (near white)

function minChannel(cell) {
  const out = new Float32Array(CANON * CANON);
  for (let p = 0, o = 0; p < out.length; p++, o += 3) out[p] = Math.min(cell[o], cell[o + 1], cell[o + 2]);
  return out;
}

// Normalised cross-correlation over the whole template box; -1 when the strokes are not bright.
function fullScore(img, t, x, y) {
  let sum = 0, strokeSum = 0, strokeN = 0;
  for (let j = 0; j < t.h; j++) {
    for (let i = 0; i < t.w; i++) {
      const v = img[(y + j) * CANON + x + i];
      sum += v;
      if (t.strokes[j * t.w + i]) { strokeSum += v; strokeN++; }
    }
  }
  if (strokeN && strokeSum / strokeN < STROKE_MIN) return -1;
  const mean = sum / (t.w * t.h);
  let dot = 0, energy = 0;
  for (let j = 0; j < t.h; j++) {
    for (let i = 0; i < t.w; i++) {
      const c = img[(y + j) * CANON + x + i] - mean;
      dot += c * t.centered[j * t.w + i];
      energy += c * c;
    }
  }
  return energy > 0 ? dot / (Math.sqrt(energy) * t.norm) : -1;
}

// The same comparison restricted to the strokes and their immediate outline.
function outlineScore(img, t, x, y) {
  const n = t.mask.length;
  const v = new Float32Array(n);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const m = t.mask[k];
    v[k] = img[(y + Math.floor(m / t.w)) * CANON + x + (m % t.w)];
    sum += v[k];
  }
  let strokeSum = 0;
  for (const k of t.strokeIdx) strokeSum += v[k];
  if (strokeSum / t.strokeIdx.length < STROKE_MIN) return -1;
  const mean = sum / n;
  let dot = 0, energy = 0;
  for (let k = 0; k < n; k++) { const c = v[k] - mean; dot += c * t.mCentered[k]; energy += c * c; }
  return energy > 0 ? dot / (Math.sqrt(energy) * t.mNorm) : -1;
}

// Returns the stack size shown in the cell, or 0 when no number is drawn.
function readStack(cell) {
  const img = minChannel(cell);
  let text = '';
  let from = 4, to = 9; // where the first digit's template may start
  for (let k = 0; k < 5; k++) {
    let full = null, outline = null;
    for (const t of TEMPLATES) {
      for (let x = from; x <= to; x++) {
        for (let y = t.y - 1; y <= t.y + 1; y++) {
          if (x < 0 || y < 0 || x + t.w > CANON || y + t.h > CANON) continue;
          const f = fullScore(img, t, x, y);
          if (!full || f > full.s) full = { s: f, t, x };
          const o = outlineScore(img, t, x, y);
          if (!outline || o > outline.s) outline = { s: o, t, x };
        }
      }
    }
    let pick = null;
    if (full && full.s >= FULL_MATCH) pick = full;
    else if (outline && outline.s >= (k === 0 ? OUTLINE_FIRST : OUTLINE_NEXT)) pick = outline;
    if (!pick) break;
    text += pick.t.d;
    from = pick.x + pick.t.w - 2;
    to = pick.x + pick.t.w + 2;
  }
  return text ? parseInt(text, 10) : 0;
}

module.exports = { readStack };
