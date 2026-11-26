'use strict';
// Where the main window opens. Pure: main.js hands in what was saved (window.json) and the
// screens as Electron lists them, and gets back { x, y, width, height, maximized, from }.
//
// The saved place is used when enough of it still lies on a screen that is there now, so a
// window never opens out of sight after a monitor was unplugged or rearranged. Otherwise the
// first start's place: the second screen, maximised (the game is on the first), or the only one.

const MIN_W = 600, MIN_H = 400; // smaller than this was not a place anyone chose
const SEEN_W = 200, SEEN_H = 100; // this much of the window must lie on one screen

const whole = (r) => !!r && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k]));

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { w: Math.max(0, w), h: Math.max(0, h) };
}

function firstPlace(displays, primaryId) {
  const primary = displays.find((d) => d.id === primaryId) || displays[0];
  const second = displays.find((d) => d !== primary);
  const a = (second || primary).workArea;
  return {
    x: a.x + 40, y: a.y + 40,
    width: Math.min(1500, a.width - 80), height: Math.min(950, a.height - 80),
    maximized: !!second, from: 'first start',
  };
}

function placeWindow(saved, displays, primaryId) {
  const first = firstPlace(displays, primaryId);
  if (!saved || !whole(saved.bounds)) return first;
  const b = saved.bounds;
  if (b.width < MIN_W || b.height < MIN_H) return { ...first, from: 'first start (saved one too small)' };
  const seen = displays.some((d) => { const o = overlap(b, d.workArea); return o.w >= Math.min(SEEN_W, b.width) && o.h >= Math.min(SEEN_H, b.height); });
  if (!seen) return { ...first, from: 'first start (saved screen is gone)' };
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height), maximized: !!saved.maximized, from: 'where it was' };
}

module.exports = { placeWindow };
