'use strict';
// Screen capture through the operating system's normal capture API (the same mechanism
// recording software uses). Nothing here reads game memory, touches game files or sends input.
const { desktopCapturer, screen } = require('electron');
const { diag } = require('./diagnose');
const { CaptureHelper, slotsSame } = require('./capturehelper');
const { COLS, ROWS } = require('./core/inventory/grid');

// ---- the quick way ----
// Asking Windows through Electron for the picture of a screen freezes the app for about half
// a second each time (it makes full-size pictures of every screen, in the app's own process).
// The helper (capturehelper.js) copies the one screen in a process of its own. It is only used
// after it has been shown, on this PC and in this run, to give the very same pixels: for the
// first readings with the inventory open both pictures are taken and the 60 slots compared
// byte for byte (judge). Reading loot is only as good as its pixels, so on any doubt the app
// stays with the old way.
const helper = new CaptureHelper();
const TRUST_AFTER = 3;   // readings in a row whose slots matched
const SAME_SLOTS = 56;   // of 60: a tooltip or the mouse may move between the two pictures
const CHECK_EVERY = 30;  // once trusted, every so many pictures both are taken and compared again
let quickShots = 0;
const quick = { state: process.platform === 'win32' ? 'trial' : 'off', good: 0, bad: 0, why: '' };
let ownWindowsShown = () => false; // set by main.js: is one of the app's windows over the game?
function quickFact() {
  diag.facts['Screen capture'] = quick.state === 'trusted' ? 'the quick way (helper process), after its pictures matched the old way'
    : quick.state === 'trial' ? `the old way, the quick way is being compared (${quick.good} of ${TRUST_AFTER} matched)`
      : `the old way${quick.why ? ` (${quick.why})` : ''}`;
}
quickFact();
function quickOff(why) { quick.state = 'off'; quick.why = why; helper.stop(); diag.note('capture', `Screen capture stays the old way: ${why}`); quickFact(); }

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
  diag.note('capture', `Quick picture compared with the old one: ${same} of ${COLS * ROWS} slots the same`);
  if (same >= SAME_SLOTS) {
    quick.good++; quick.bad = 0;
    if (quick.state === 'trial' && quick.good >= TRUST_AFTER) { quick.state = 'trusted'; diag.note('capture', 'Screen capture now the quick way: its pictures matched'); }
  } else {
    quick.good = 0; quick.bad++;
    diag.count('inventory: the quick picture differed from the old one');
    // Trusted and now different: back on trial at once, the old way until it has matched again.
    if (quick.state === 'trusted') { quick.state = 'trial'; diag.note('capture', `Screen capture back to the old way for now: a later comparison differed, ${same} of ${COLS * ROWS} slots the same`); }
    if (quick.bad >= 2) { quickOff(`its pictures differed, ${same} of ${COLS * ROWS} slots the same`); return; }
  }
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
  if (quick.state !== 'off' && !helper.usable) quickOff('the helper could not be started');
  // The app's own windows are left out of the old way's pictures (see guard in overlay.js);
  // whether the helper's copy leaves them out too is not known, so with one of them showing
  // the old way is used.
  // Trusted is not for ever: every so often both pictures are taken again and compared (judge),
  // so a change on the PC in the middle of a session (HDR, a colour filter) is caught.
  const again = quick.state === 'trusted' && ++quickShots % CHECK_EVERY === 0 && !ownWindowsShown();
  if (quick.state === 'trusted' && !again) {
    if (ownWindowsShown()) diag.count('inventory: old way of capture, a window of the app was showing');
    else {
      const frame = await quickShot(display, width, height);
      if (frame) return frame;
      diag.count('inventory: old way of capture, the quick one gave nothing');
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
    if (!frame.twin) { quick.bad++; if (quick.bad >= 3) quickOff('the helper gave no picture'); }
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
function watchOwnWindows(fn) { ownWindowsShown = fn; }

module.exports = { captureFrame, cursorInFrame, cursorOnDisplay, judge, warmUp, shutDown, watchOwnWindows, quick };
