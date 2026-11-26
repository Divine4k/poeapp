'use strict';
// Screen capture through the operating system's normal capture API (the same mechanism
// recording software uses). Nothing here reads game memory, touches game files or sends input.
const { desktopCapturer, screen } = require('electron');
const { diag } = require('./diagnose');

function pickDisplay(displayId) {
  const all = screen.getAllDisplays();
  return all.find((d) => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
}

// Returns a frame { data, width, height, bgr: true, display }.
async function captureFrame(displayId) {
  const display = pickDisplay(displayId);
  const width = Math.round(display.size.width * display.scaleFactor);
  const height = Math.round(display.size.height * display.scaleFactor);
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
  return { data, width: size.width, height: size.height, bgr: true, display };
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

module.exports = { captureFrame, cursorInFrame, cursorOnDisplay };
