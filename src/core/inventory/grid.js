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

// Items that take several slots (weapons, body armour) are drawn across the lines between
// their slots, while an item of one slot stays inside its own. So two neighbouring slots belong
// to one item when the picture runs on across their shared edge: the outermost line of pixels
// on both sides is busy (not plain backdrop) and the two lines look alike.
// Measured on real captures: across a body armour the lines vary by 35 to 60 and agree 0.81 to
// 0.98; between separate items the edge line varies by 3 or less.
const EDGE_BUSY = 20, EDGE_ALIKE = 0.7, EDGE_DIFF = 30, EDGE_SLIDE = 3;
function edgeLine(cell, side) {
  const out = new Float32Array(CANON * 3);
  for (let i = 0; i < CANON; i++) {
    const x = side === 'r' ? CANON - 1 : side === 'l' ? 0 : i, y = side === 'b' ? CANON - 1 : side === 't' ? 0 : i;
    const o = (y * CANON + x) * 3;
    out[i * 3] = cell[o]; out[i * 3 + 1] = cell[o + 1]; out[i * 3 + 2] = cell[o + 2];
  }
  return out;
}
function sameItemAcross(a, sideA, b, sideB) {
  const la = edgeLine(a, sideA), lb = edgeLine(b, sideB);
  const grey = (l) => { const v = new Float32Array(CANON); for (let i = 0; i < CANON; i++) v[i] = (l[i * 3] + l[i * 3 + 1] + l[i * 3 + 2]) / 3; return v; };
  const va = grey(la), vb = grey(lb);
  const spread = (v) => { let m = 0; for (const x of v) m += x; m /= CANON; let q = 0; for (const x of v) q += (x - m) ** 2; return Math.sqrt(q / CANON); };
  if (Math.min(spread(va), spread(vb)) < EDGE_BUSY) return false;
  // Something thin that crosses the edge at a slant (a bow limb) sits a pixel or two further
  // along on the other side, so the two lines may slide against each other a little.
  for (let d = -EDGE_SLIDE; d <= EDGE_SLIDE; d++) {
    let n = 0, ma = 0, mb = 0, diff = 0;
    for (let i = Math.max(0, -d); i < Math.min(CANON, CANON - d); i++) {
      n++; ma += va[i]; mb += vb[i + d];
      diff += Math.abs(la[i * 3] - lb[(i + d) * 3]) + Math.abs(la[i * 3 + 1] - lb[(i + d) * 3 + 1]) + Math.abs(la[i * 3 + 2] - lb[(i + d) * 3 + 2]);
    }
    ma /= n; mb /= n;
    let sa = 0, sb = 0, sab = 0;
    for (let i = Math.max(0, -d); i < Math.min(CANON, CANON - d); i++) { sa += (va[i] - ma) ** 2; sb += (vb[i + d] - mb) ** 2; sab += (va[i] - ma) * (vb[i + d] - mb); }
    if (sa > 0 && sb > 0 && sab / Math.sqrt(sa * sb) >= EDGE_ALIKE && diff / n / 3 <= EDGE_DIFF) return true;
  }
  return false;
}
// cells: the whole grid in reading order (Uint8Array per slot, or null for a slot to leave out,
// such as an empty one or one with a stack number: stacks always take one slot).
// Returns the set of slot numbers that are pieces of an item spanning several slots.
function multiSlotCells(cells) {
  const linked = new Set();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const k = r * COLS + c;
      if (!cells[k]) continue;
      if (c + 1 < COLS && cells[k + 1] && sameItemAcross(cells[k], 'r', cells[k + 1], 'l')) { linked.add(k); linked.add(k + 1); }
      if (r + 1 < ROWS && cells[k + COLS] && sameItemAcross(cells[k], 'b', cells[k + COLS], 't')) { linked.add(k); linked.add(k + COLS); }
    }
  }
  return linked;
}

function extractGrid(frame, rect = gridRect(frame.width, frame.height)) {
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push(extractCell(frame, rect, r, c));
  return cells;
}

module.exports = { multiSlotCells, sameItemAcross, CANON, COLS, ROWS, GEOMETRY, gridRect, extractCell, extractGrid, cellStats, isEmptyCell, isInventoryOpen };
