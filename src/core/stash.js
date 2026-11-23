'use strict';
// Tells from a screen capture whether the stash panel is open, by looking for the "STASH" title
// plate at the top left. The game scales its panels with the screen's height and anchors the
// stash to the left edge, so the plate's place follows from the frame size.
//
// A frame is { data, width, height, bgr } with 4 bytes per pixel, as in inventory/grid.js.
const TEMPLATE = require('./stashTemplate.json');

// The plate on a 1920x1080 capture, and the grid of brightness samples taken from it.
const PLATE = { x: 225, y: 50, width: 215, height: 38, base: 1080 };
const COLS = 32, ROWS = 8;

// Brightness of the plate area as COLS x ROWS block averages, with the mean removed and scaled
// to length 1, so overall brightness and contrast do not matter.
function plateSignature(frame) {
  const f = frame.height / PLATE.base;
  const out = new Float64Array(COLS * ROWS);
  const bw = (PLATE.width * f) / COLS, bh = (PLATE.height * f) / ROWS;
  const r = frame.bgr ? 2 : 0, b = frame.bgr ? 0 : 2;
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const x0 = Math.floor(PLATE.x * f + i * bw), x1 = Math.max(x0 + 1, Math.floor(PLATE.x * f + (i + 1) * bw));
      const y0 = Math.floor(PLATE.y * f + j * bh), y1 = Math.max(y0 + 1, Math.floor(PLATE.y * f + (j + 1) * bh));
      let sum = 0, n = 0;
      for (let y = y0; y < y1 && y < frame.height; y++) {
        for (let x = x0; x < x1 && x < frame.width; x++) {
          const p = (y * frame.width + x) * 4;
          sum += frame.data[p + r] * 0.299 + frame.data[p + 1] * 0.587 + frame.data[p + b] * 0.114; n++;
        }
      }
      out[j * COLS + i] = n ? sum / n : 0;
    }
  }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length;
  let norm = 0;
  for (let k = 0; k < out.length; k++) { out[k] -= mean; norm += out[k] * out[k]; }
  norm = Math.sqrt(norm);
  if (norm < 1e-6) return out.fill(0);
  for (let k = 0; k < out.length; k++) out[k] /= norm;
  return out;
}

// How alike the plate area is to the real plate: 1 is identical, around 0 is unrelated.
function stashScore(frame) {
  const sig = plateSignature(frame);
  let dot = 0;
  for (let k = 0; k < sig.length; k++) dot += sig[k] * TEMPLATE[k];
  return dot;
}

const THRESHOLD = 0.75;
const isStashOpen = (frame) => stashScore(frame) >= THRESHOLD;

module.exports = { plateSignature, stashScore, isStashOpen, THRESHOLD, PLATE };
