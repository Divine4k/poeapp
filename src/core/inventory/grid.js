'use strict';
// Finds the inventory grid in a full-screen capture and cuts it into cells.
//
// Path of Exile scales its panels with screen height and anchors the inventory to the right
// edge, so the grid position follows from the frame size. The ratios below were measured on
// 1920x1080 captures.
//
// A frame is { data, width, height, bgr } with 4 bytes per pixel (RGBA, or BGRA when bgr is true).

const CANON = 52; // every cell is resampled to 52x52 so the rest of the pipeline is resolution independent
const COLS = 12;
const ROWS = 5;
const GEOMETRY = { cell: (632 / 12) / 1080, right: 17 / 1080, top: 586.5 / 1080 };

function gridRect(width, height, geometry = GEOMETRY) {
  const cell = height * geometry.cell;
  return { cell, x0: width - height * geometry.right - COLS * cell, y0: height * geometry.top };
}

// Bilinear sample; writes r,g,b into out[o..o+2].
function sample(frame, x, y, out, o) {
  const w = frame.width, h = frame.height, d = frame.data;
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
  const xi = Math.floor(x), yi = Math.floor(y);
  const x1 = Math.min(w - 1, xi + 1), y1 = Math.min(h - 1, yi + 1);
  const fx = x - xi, fy = y - yi;
  const p00 = (yi * w + xi) * 4, p10 = (yi * w + x1) * 4, p01 = (y1 * w + xi) * 4, p11 = (y1 * w + x1) * 4;
  for (let k = 0; k < 3; k++) {
    const ch = frame.bgr ? 2 - k : k;
    const top = d[p00 + ch] * (1 - fx) + d[p10 + ch] * fx;
    const bot = d[p01 + ch] * (1 - fx) + d[p11 + ch] * fx;
    out[o + k] = top * (1 - fy) + bot * fy;
  }
}

// Returns a Uint8Array of CANON*CANON*3 RGB values for one cell.
function extractCell(frame, rect, row, col) {
  const out = new Uint8Array(CANON * CANON * 3);
  const tmp = [0, 0, 0];
  const step = rect.cell / CANON;
  const bx = rect.x0 + col * rect.cell, by = rect.y0 + row * rect.cell;
  for (let j = 0; j < CANON; j++) {
    for (let i = 0; i < CANON; i++) {
      sample(frame, bx + (i + 0.5) * step - 0.5, by + (j + 0.5) * step - 0.5, tmp, 0);
      const o = (j * CANON + i) * 3;
      out[o] = Math.round(tmp[0]); out[o + 1] = Math.round(tmp[1]); out[o + 2] = Math.round(tmp[2]);
    }
  }
  return out;
}

// Mean and standard deviation of brightness inside the cell (edges skipped).
function cellStats(cell) {
  let sum = 0, sq = 0, n = 0;
  for (let j = 4; j < CANON - 4; j++) {
    for (let i = 4; i < CANON - 4; i++) {
      const o = (j * CANON + i) * 3;
      const v = (cell[o] + cell[o + 1] + cell[o + 2]) / 3;
      sum += v; sq += v * v; n++;
    }
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

// An empty slot is near-black with only a faint emblem.
function isEmptyCell(cell) {
  const s = cellStats(cell);
  return s.mean < 18 && s.std < 9;
}

// The inventory is open when the frame bar directly above the grid is there: a dark line with
// an evenly lit grey-brown line right under it. An item tooltip can cover a good part of that
// bar, so it only has to show along 40% of the grid width.
function isInventoryOpen(frame, rect = gridRect(frame.width, frame.height)) {
  const tmp = [0, 0, 0];
  const at = (x, dy) => { sample(frame, x, rect.y0 + dy * rect.cell, tmp, 0); return (tmp[0] + tmp[1] + tmp[2]) / 3; };
  let good = 0, n = 0, sum = 0, sq = 0;
  for (let x = rect.x0 + rect.cell * 0.5; x <= rect.x0 + rect.cell * (COLS - 0.5); x += rect.cell / 4) {
    n++;
    const dark = at(x, -0.2), lit = at(x, -0.05);
    if (dark < 18 && lit > 28 && lit < 80) { good++; sum += lit; sq += lit * lit; }
  }
  if (good < n * 0.4) return false;
  const mean = sum / good;
  return Math.sqrt(Math.max(0, sq / good - mean * mean)) < 14; // the lit line is the same shade all along
}

function extractGrid(frame, rect = gridRect(frame.width, frame.height)) {
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push(extractCell(frame, rect, r, c));
  return cells;
}

module.exports = { CANON, COLS, ROWS, GEOMETRY, gridRect, extractCell, extractGrid, cellStats, isEmptyCell, isInventoryOpen };
