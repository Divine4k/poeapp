'use strict';
// Loads the inventory screenshot fixtures as full-size frames (everything outside the inventory
// crop is black), so tests go through the same code path as a real capture.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const dir = path.join(__dirname, 'fixtures');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));

function loadFrame(name) {
  const rgb = zlib.gunzipSync(fs.readFileSync(path.join(dir, `${name}.rgb.gz`)));
  const data = Buffer.alloc(meta.frameWidth * meta.frameHeight * 4);
  for (let y = 0; y < meta.height; y++) {
    for (let x = 0; x < meta.width; x++) {
      const s = (y * meta.width + x) * 3;
      const d = ((y + meta.y) * meta.frameWidth + (x + meta.x)) * 4;
      data[d] = rgb[s]; data[d + 1] = rgb[s + 1]; data[d + 2] = rgb[s + 2]; data[d + 3] = 255;
    }
  }
  return { data, width: meta.frameWidth, height: meta.frameHeight, bgr: false };
}

// What is really in the two screenshots: stack number per cell, 0 = no number shown,
// null = empty slot, 'x' = part of a multi-cell item.
const TRUTH = {
  inv_map: [
    [26, 2, 4, 2, 2, 1, 'x', 'x', null, null, null, null],
    [0, 1, 20, 20, 1, 2, 'x', 'x', null, null, null, null],
    [4, 3, 6, 6, 2, 0, 'x', 'x', null, null, null, null],
    [3, 5, 20, 5, 6, 20, null, null, null, null, null, null],
    [20, 2, 6, 1, 8, 8, null, null, null, null, null, null],
  ],
  inv_hideout: [
    [25, 2, 7, 7, 4, 1, 'x', 'x', 20, null, null, null],
    [0, 1, 20, 20, 1, 20, 'x', 'x', 20, null, null, null],
    [4, 3, 18, 10, 2, 0, 'x', 'x', 4, null, null, null],
    [5, 5, 20, 6, 19, 20, 1, 20, 0, null, null, null],
    [20, 2, 9, 1, 20, 8, 2, 0, null, null, null, null],
  ],
};

module.exports = { loadFrame, TRUTH };
