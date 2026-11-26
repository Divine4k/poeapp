'use strict';
// Screen capture through the operating system's normal capture API (the same mechanism
// recording software uses). Nothing here reads game memory, touches game files or sends input.
const { desktopCapturer, screen } = require('electron');
const { diag } = require('./diagnose');
const { CaptureHelper, Trial, slotsSame, overReadArea } = require('./capturehelper');
const { COLS, ROWS, isInventoryOpen } = require('./core/inventory/grid');

// ---- the quick way ----
// Asking Windows through Electron for the picture of a screen freezes the app for about half
// a second each time (it makes full-size pictures of every screen, in the app's own process).
// The helper (capturehelper.js) copies the one screen in a process of its own. It is only used
// after it has been shown, on this PC and in this run, to give the very same pixels: for the
// first readings with the inventory open both pictures are taken and the 60 slots compared
// byte for byte (judge). Reading loot is only as good as its pixels, so on any doubt the app
// stays with the old way.
const helper = new CaptureHelper({ onStarted: (ms) => diag.time('helper: capture helper started (on its own thread)', ms) });
const CHECK_EVERY = 30;  // once trusted, every so many pictures both are taken and compared again
let quickShots = 0;
// On trial, trusted or off: see Trial in capturehelper.js for the rules.
const quick = new Trial({ on: process.platform === 'win32' });
let noTwin = 0; // comparisons in a row for which the helper gave no picture
let ownWindows = () => []; // set by main.js: where the app's own windows over the game are right now
let ownWindowsShown = () => false; // replaced per capture, see captureFrame
function quickFact() { diag.facts['Screen capture'] = quick.fact; }
quickFact();
// final: no point in trying again in this run (the helper cannot be started).
function quickOff(why, final) { quick.off(why, final); helper.stop(); diag.note('capture', `Screen capture the old way: ${why}`); quickFact(); }

// The screen's rectangle in real pixels, as the helper needs it; null where Electron cannot say.
function realRect(display, width, height) {
  try {
    const r = screen.dipToScreenRect(null, display.bounds);
    return r.width === width && r.height === height ? r : null;
  } catch (_) { return null; }
}
async function quickShot(display, width, height) {
  const rect = realRect(display, width, height);
  if (!rect) return null;
  const done = diag.start('inventory: the quick picture of the screen', `${width}x${height}`);
  let data = await helper.shot(rect);
  // One colour from corner to corner is no picture of a game (a screen that cannot be copied
  // this way, the game in exclusive full screen): the old way is asked.
  if (data && blank(data)) { diag.count('inventory: the quick picture was blank'); data = null; }
  done(data ? `${width}x${height}, ${Math.round(data.length / 1048576)} MB` : 'none came back', false, !data);
  return data ? { data, width, height, bgr: true, display, quick: true } : null;
}

function blank(data) {
  const step = Math.max(4, Math.floor(data.length / 4 / 997) * 4);
  for (let i = step; i + 2 < data.length; i += step) if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) return false;
  return true;
}

// After a reading that found the inventory open: compare the old picture with its twin from
// the helper, slot by slot. Called by main.js with the frame and the grid's rectangle.
function judge(frame, rect) {
  const twin = frame && frame.twin;
  if (!twin || quick.state === 'off') return;
  frame.twin = null;
  const same = slotsSame(frame, twin, rect);
  // The twin was taken half a second after the other: it only counts if it shows the open
  // inventory too and none of the app's windows came up over it in between.
  const clear = !frame.twinCovered && isInventoryOpen(twin, rect);
  const was = quick.state, said = quick.compared(same, COLS * ROWS, clear);
  diag.note('capture', `Quick picture compared with the old one: ${same} of ${COLS * ROWS} slots the same${clear ? '' : frame.twinCovered ? ', not counted (a window of the app was over the inventory)' : ', not counted (the inventory was not open in both)'} -> ${said}`);
  if (said === 'unclear') diag.count('inventory: a comparison of the two pictures was not counted');
  if (said === 'different' || said === 'back on trial' || said === 'off') diag.count('inventory: the quick picture differed from the old one');
  if (said === 'off') helper.stop();
  if (quick.state !== was) diag.note('capture', `Screen capture: ${quick.fact}`);
  quickFact();
}

function pickDisplay(displayId) {
  const all = screen.getAllDisplays();
  return all.find((d) => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
}

// Returns a frame { data, width, height, bgr: true, display }.
async function captureFrame(displayId) {
  const display = pickDisplay(displayId);
  const width = Math.round(display.size.width * display.scaleFactor);
  const height = Math.round(display.size.height * display.scaleFactor);
  if (quick.state !== 'off' && !helper.usable) quickOff('the helper could not be started', true);
  if (quick.again()) { diag.note('capture', 'Screen capture: the quick way is on trial again'); quickFact(); }
  // Asked again after a picture is taken: a window that came up meanwhile may be in it.
  const covered = () => ownWindows().some((w) => overReadArea(w, display, width, height));
  const inTheWay = covered();
  ownWindowsShown = () => inTheWay;
  // The app's own windows are left out of the old way's pictures (see guard in overlay.js);
  // whether the helper's copy leaves them out too is not known, so with one of them over the
  // inventory the old way is used. One showing elsewhere on the screen changes nothing.
  // Trusted is not for ever: every so often both pictures are taken again and compared (judge),
  // so a change on the PC in the middle of a session (HDR, a colour filter) is caught.
  const again = quick.state === 'trusted' && ++quickShots % CHECK_EVERY === 0 && !ownWindowsShown();
  if (quick.state === 'trusted' && !again) {
    if (ownWindowsShown()) diag.count('inventory: old way of capture, a window of the app was over the inventory');
    else {
      const frame = await quickShot(display, width, height);
      if (frame && !covered()) return frame;
      diag.count(frame ? 'inventory: old way of capture, a window of the app came up during the quick one' : 'inventory: old way of capture, the quick one gave nothing');
    }
  }
  // The two halves are timed apart (Under the hood): asking Windows for the pictures of every
  // screen, and turning the one wanted into plain pixels.
  const asked = diag.start('inventory: asking Windows for the screen', `${width}x${height}, ${screen.getAllDisplays().length} screen(s)`);
  let sources;
  try { sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } }); } catch (e) { asked(`failed: ${e.message || e}`, false, true); throw e; }
  asked(`${width}x${height}, ${sources.length} picture(s) came back`);
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) { diag.count('inventory: the capture came back empty'); throw new Error('Screen capture returned nothing. Run the game in Windowed Fullscreen.'); }
  const size = src.thumbnail.getSize();
  const made = diag.start('inventory: picture made into pixels');
  const data = src.thumbnail.toBitmap();
  made(`${size.width}x${size.height}, ${Math.round(data.length / 1048576)} MB`);
  const frame = { data, width: size.width, height: size.height, bgr: true, display };
  // While the quick way is on trial, its picture is taken right after, for judge().
  if ((quick.state === 'trial' || again) && !ownWindowsShown() && size.width === width && size.height === height) {
    frame.twin = await quickShot(display, width, height);
    frame.twinCovered = covered();
    if (!frame.twin && ++noTwin >= 3) { noTwin = 0; quickOff('the helper gave no picture'); }
    else if (frame.twin) noTwin = 0;
  }
  return frame;
}

// Mouse position in frame pixels, or null when the mouse is on another screen.
function cursorInFrame(frame) {
  const p = screen.getCursorScreenPoint();
  const b = frame.display.bounds;
  if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) return null;
  return { x: (p.x - b.x) * (frame.width / b.width), y: (p.y - b.y) * (frame.height / b.height) };
}

// Mouse position in physical pixels of the chosen screen, with that screen's size, without
// taking a capture. null when the mouse is on another screen.
function cursorOnDisplay(displayId) {
  const display = pickDisplay(displayId);
  const p = screen.getCursorScreenPoint();
  const b = display.bounds;
  if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) return null;
  const f = display.scaleFactor;
  return { x: (p.x - b.x) * f, y: (p.y - b.y) * f, width: Math.round(display.size.width * f), height: Math.round(display.size.height * f) };
}

// Starts the helper ahead of the first reading (it takes a second or two to be ready).
function warmUp() { if (quick.state !== 'off') helper.start(); }
function shutDown() { helper.stop(); }
function watchOwnWindows(fn) { ownWindows = fn; }

module.exports = { captureFrame, cursorInFrame, cursorOnDisplay, judge, warmUp, shutDown, watchOwnWindows, overReadArea, quick };
