'use strict';
// Prepares a captured frame for OCR. Works on raw 4-bytes-per-pixel buffers (BGRA or RGBA).

// Greyscale + invert, in place. Loot labels are light text on dark plates; Tesseract reads
// dark text on a light background more reliably.
function grayInvert(buf) {
  for (let i = 0; i + 3 < buf.length; i += 4) {
    // Use the brightest channel so coloured label text stays bright before inverting.
    const m = Math.max(buf[i], buf[i + 1], buf[i + 2]);
    const v = 255 - m;
    buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
  }
  return buf;
}

module.exports = { grayInvert };
