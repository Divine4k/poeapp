'use strict';
// Saved stash searches: short texts (often regex from poe.re and the like) kept under a name,
// opened at the mouse with one key and put into the game's stash search box with one click,
// as in Awakened PoE Trade. Plain logic, no Electron.

// The game's stash search box takes at most this many characters; a longer search is cut.
const GAME_LIMIT = 250; // Path of Exile 1 (Path of Exile 2 still takes 50)
const MAX_SEARCHES = 60;
const MAX_NAME = 60;
const MAX_TEXT = 500; // kept even when too long for the game, so nothing typed is lost
const MENU_WIDTH = 280;

// The list as saved in config.json: [{ name, text }]. Rows being written (empty) are kept, so
// a new row does not vanish while you type in it; the menu only shows rows with a search.
function cleanSearches(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SEARCHES).filter((s) => s && typeof s === 'object').map((s) => ({
    name: String(s.name == null ? '' : s.name).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME),
    // One line: the box takes no line breaks.
    text: String(s.text == null ? '' : s.text).replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_TEXT),
  }));
}

// What the menu over the game shows: rows with a search, each with its place in the saved list
// (that is what a click sends back) and a name to show (the search itself when unnamed).
function menuEntries(list) {
  return cleanSearches(list).map((s, i) => ({ i, name: s.name || s.text, text: s.text, long: s.text.length > GAME_LIMIT })).filter((s) => s.text);
}

const tooLong = (text) => String(text || '').length > GAME_LIMIT;

// Where the menu opens: at the mouse, a little up and left so the pointer lands on the first
// rows, and kept inside the game's screen. bounds: the game's screen; cursor: the mouse.
function menuBounds(bounds, cursor, height) {
  const b = bounds;
  const w = Math.min(MENU_WIDTH, b.width);
  const h = Math.max(1, Math.min(Math.round(height), Math.round(b.height * 0.9)));
  const c = cursor || { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const x = Math.max(b.x, Math.min(Math.round(c.x - 24), b.x + b.width - w));
  const y = Math.max(b.y, Math.min(Math.round(c.y - 18), b.y + b.height - h));
  return { x, y, width: w, height: h };
}

module.exports = { cleanSearches, menuEntries, tooLong, menuBounds, GAME_LIMIT, MAX_SEARCHES, MENU_WIDTH };
