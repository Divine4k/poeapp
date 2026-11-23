'use strict';
// Finds the open stash tab on a screen capture, and compares a tab name read from the screen
// with the one a trade whisper gave.
//
// Measured on 1920x1080 screenshots: the tab bar runs from y 104 to 131, the tabs sit between
// the two arrow buttons (x 48 to 592), and every tab except the open one fades to dark along
// its bottom edge. Between y 125 and y 130 a closed tab loses a third of its brightness or
// more, while the open tab keeps it. Everything scales with the screen's height.
//
// A frame is { data, width, height, bgr } with 4 bytes per pixel, as in inventory/grid.js.
const BAR = { x0: 48, x1: 592, top: 100, bottom: 134, upper: 125, lower: 130, base: 1080 };
const KEEP = 0.8;      // lower row at least this share of the upper row: no fade, so the open tab
const MIN_LIGHT = 30;  // darker than this is the gap between tabs
const MIN_WIDTH = 16;  // narrower than this (at 1080p) is an edge, not a tab

function lum(frame, x, y) {
  const p = (Math.min(frame.height - 1, Math.max(0, Math.round(y))) * frame.width + Math.min(frame.width - 1, Math.max(0, Math.round(x)))) * 4;
  const d = frame.data;
  return (frame.bgr ? d[p + 2] : d[p]) * 0.299 + d[p + 1] * 0.587 + (frame.bgr ? d[p] : d[p + 2]) * 0.114;
}

// The open tab as { x0, x1, y0, y1 } in frame pixels (the tab's body on the bar), or null.
function openTabRect(frame) {
  const f = frame.height / BAR.base;
  const from = Math.round(BAR.x0 * f), to = Math.round(BAR.x1 * f);
  let best = null, start = -1;
  for (let x = from; x <= to + 1; x++) {
    let ok = false;
    if (x <= to) {
      const up = (lum(frame, x, (BAR.upper - 1) * f) + lum(frame, x, BAR.upper * f)) / 2;
      const low = (lum(frame, x, (BAR.lower - 1) * f) + lum(frame, x, BAR.lower * f)) / 2;
      ok = up >= MIN_LIGHT && low >= up * KEEP;
    }
    if (ok && start < 0) start = x;
    if (!ok && start >= 0) {
      // A few stray columns (an icon's edge) do not end a tab.
      let gap = 0;
      for (let k = x; k <= Math.min(to, x + Math.round(3 * f)); k++) {
        const up = lum(frame, k, BAR.upper * f), low = lum(frame, k, BAR.lower * f);
        if (up >= MIN_LIGHT && low >= up * KEEP) { gap = k; break; }
      }
      if (gap) { x = gap; continue; }
      if (x - start >= MIN_WIDTH * f && (!best || x - start > best.x1 - best.x0)) best = { x0: start, x1: x };
      start = -1;
    }
  }
  if (!best) return null;
  return { ...best, y0: Math.round(BAR.top * f), y1: Math.round(BAR.bottom * f) };
}

// A short fingerprint of what the tab looks like, so the same tab is not read twice.
function tabKey(frame, rect) {
  const parts = [rect.x0, rect.x1];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 12; i++) {
      parts.push(Math.round(lum(frame, rect.x0 + ((i + 0.5) * (rect.x1 - rect.x0)) / 12, rect.y0 + ((j + 0.5) * (rect.y1 - rect.y0)) / 4) / 24));
    }
  }
  return parts.join('.');
}

// The tab cut out of the frame as { data (BGRA), width, height }, with a little room around it.
function cropTab(frame, rect, pad = 6) {
  const x0 = Math.max(0, rect.x0 - pad), x1 = Math.min(frame.width, rect.x1 + pad);
  const w = x1 - x0, h = rect.y1 - rect.y0;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((rect.y0 + y) * frame.width + x0 + x) * 4, d = (y * w + x) * 4;
      data[d] = frame.data[s + (frame.bgr ? 0 : 2)]; data[d + 1] = frame.data[s + 1]; data[d + 2] = frame.data[s + (frame.bgr ? 2 : 0)]; data[d + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

// Text recognition mixes up look-alikes (l, I and 1; O and 0; S and 5) and drops signs such as
// "~". Both names are reduced the same way before they are compared.
const fold = (s) => String(s || '').toLowerCase().replace(/[il|!]/g, '1').replace(/o/g, '0').replace(/s/g, '5').replace(/[^a-z0-9]+/g, '');

function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = keep;
    }
  }
  return prev[b.length];
}

// Whether the text read off the open tab is the wanted tab's name. A coin picture in front of
// the name can read as a stray letter or two, so the name may also sit inside the text.
// Returns null when either side has nothing to compare.
function sameTabName(read, wanted) {
  const a = fold(read), b = fold(wanted);
  if (!a || !b) return null;
  const slack = Math.max(b.length <= 2 ? 0 : 1, Math.floor(b.length * 0.25));
  if (distance(a, b) <= slack) return true;
  if (b.length >= 3 && a.length > b.length) {
    for (let i = 0; i + b.length <= a.length; i++) if (distance(a.slice(i, i + b.length), b) <= Math.floor(b.length * 0.2)) return true;
  }
  return false;
}

module.exports = { openTabRect, tabKey, cropTab, sameTabName, fold, BAR };
