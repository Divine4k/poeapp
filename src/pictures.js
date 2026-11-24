'use strict';
// Inventory pictures as small images: slot thumbnails, the whole grid kept per map, and the way
// back from a kept picture to pixels. Pure conversions; nothing here touches the app's state.
const { nativeImage } = require('electron');
const { CANON, COLS, ROWS } = require('./core/inventory/grid');
const { printPixels, SIDE } = require('./core/inventory/icons');

function thumbnail(rgb) {
  const bgra = Buffer.alloc(CANON * CANON * 4);
  for (let p = 0; p < CANON * CANON; p++) {
    bgra[p * 4] = rgb[p * 3 + 2]; bgra[p * 4 + 1] = rgb[p * 3 + 1]; bgra[p * 4 + 2] = rgb[p * 3]; bgra[p * 4 + 3] = 255;
  }
  return nativeImage.createFromBitmap(bgra, { width: CANON, height: CANON }).toDataURL();
}

// The whole inventory as one picture, for keeping with a map. cells: [{ cell, rgb }].
const EMPTY_SLOT = [16, 19, 23];
function gridPicture(cells) {
  const w = COLS * CANON, h = ROWS * CANON;
  const bgra = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) { bgra[p * 4] = EMPTY_SLOT[2]; bgra[p * 4 + 1] = EMPTY_SLOT[1]; bgra[p * 4 + 2] = EMPTY_SLOT[0]; bgra[p * 4 + 3] = 255; }
  for (const c of cells) {
    const x0 = (c.cell % COLS) * CANON, y0 = Math.floor(c.cell / COLS) * CANON;
    for (let y = 0; y < CANON; y++) {
      for (let x = 0; x < CANON; x++) {
        const s = (y * CANON + x) * 3, d = ((y0 + y) * w + x0 + x) * 4;
        bgra[d] = c.rgb[s + 2]; bgra[d + 1] = c.rgb[s + 1]; bgra[d + 2] = c.rgb[s];
      }
    }
  }
  const jpeg = nativeImage.createFromBitmap(bgra, { width: w, height: h }).toJPEG(93);
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

// The slots of a kept inventory picture, cut back out of it: cell number -> pixels.
function cellsOfPicture(dataUrl) {
  const img = nativeImage.createFromDataURL(dataUrl);
  const { width, height } = img.getSize();
  if (width !== COLS * CANON || height !== ROWS * CANON) return null;
  const bgra = img.toBitmap();
  return (cell) => {
    const x0 = (cell % COLS) * CANON, y0 = Math.floor(cell / COLS) * CANON;
    const rgb = Buffer.alloc(CANON * CANON * 3);
    for (let y = 0; y < CANON; y++) {
      for (let x = 0; x < CANON; x++) {
        const s = ((y0 + y) * width + x0 + x) * 4, d = (y * CANON + x) * 3;
        rgb[d] = bgra[s + 2]; rgb[d + 1] = bgra[s + 1]; rgb[d + 2] = bgra[s];
      }
    }
    return rgb;
  };
}

// A kept slot picture (data URL, 52x52) back as RGB pixels, or null.
function pixelsOfThumb(dataUrl) {
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    const { width, height } = img.getSize();
    if (width !== CANON || height !== CANON) return null;
    const bgra = img.toBitmap(), rgb = Buffer.alloc(CANON * CANON * 3);
    for (let p = 0; p < CANON * CANON; p++) { rgb[p * 3] = bgra[p * 4 + 2]; rgb[p * 3 + 1] = bgra[p * 4 + 1]; rgb[p * 3 + 2] = bgra[p * 4]; }
    return rgb;
  } catch (_) { return null; }
}

// A fingerprint as a small picture, for named items whose slot picture was not kept.
function printPicture(print) {
  const rgb = printPixels(print);
  const bgra = Buffer.alloc(SIDE * SIDE * 4);
  for (let p = 0; p < SIDE * SIDE; p++) { bgra[p * 4] = rgb[p * 3 + 2]; bgra[p * 4 + 1] = rgb[p * 3 + 1]; bgra[p * 4 + 2] = rgb[p * 3]; bgra[p * 4 + 3] = 255; }
  return nativeImage.createFromBitmap(bgra, { width: SIDE, height: SIDE }).toDataURL();
}

module.exports = { thumbnail, gridPicture, cellsOfPicture, pixelsOfThumb, printPicture };
