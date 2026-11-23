'use strict';
// Reads the stack number drawn in the top-left corner of an inventory cell.
//
// The game always uses the same font at the same place, so this matches small digit pictures
// (digitTemplates.json, cut from real captures) against the cell, left to right.
const { CANON } = require('./grid');
const TEMPLATES = require('./digitTemplates.json').map((t) => {
  let sum = 0;
  for (const v of t.data) sum += v;
  const mean = sum / t.data.length;
  let energy = 0;
  const centered = t.data.map((v) => { const c = v - mean; energy += c * c; return c; });
  const strokes = t.data.map((v) => v > 200);
  return { ...t, centered, norm: Math.sqrt(energy), strokes };
});

const MATCH = 0.72;      // minimum correlation for a digit
const STROKE_MIN = 150;  // digit strokes must really be bright

function minChannel(cell) {
  const out = new Float32Array(CANON * CANON);
  for (let p = 0, o = 0; p < out.length; p++, o += 3) out[p] = Math.min(cell[o], cell[o + 1], cell[o + 2]);
  return out;
}

// Normalised cross-correlation of template t placed at (x, y); -1 when it does not fit.
function score(img, t, x, y) {
  if (x < 0 || y < 0 || x + t.w > CANON || y + t.h > CANON) return -1;
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
  if (energy <= 0) return -1;
  return dot / (Math.sqrt(energy) * t.norm);
}

// Returns the stack size shown in the cell, or 0 when no number is drawn.
function readStack(cell) {
  const img = minChannel(cell);
  let text = '';
  let from = 4, to = 9; // where the first digit's template may start
  for (let k = 0; k < 5; k++) {
    let best = null;
    for (const t of TEMPLATES) {
      for (let x = from; x <= to; x++) {
        for (let y = t.y - 1; y <= t.y + 1; y++) {
          const s = score(img, t, x, y);
          if (!best || s > best.s) best = { s, t, x };
        }
      }
    }
    if (!best || best.s < MATCH) break;
    text += best.t.d;
    from = best.x + best.t.w - 2;
    to = best.x + best.t.w + 2;
  }
  return text ? parseInt(text, 10) : 0;
}

module.exports = { readStack };
