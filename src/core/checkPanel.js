'use strict';
// The price check window on top of the game: where it goes and when it closes by itself.
// Plain logic, no Electron.

const PANEL_WIDTH = 460;
// The game's inventory and stash panels are this wide, as a share of the screen's height.
const GAME_PANEL = 370 / 600;
const IDLE_MS = 15000; // never touched: gone after this long without news
const LEFT_MS = 400;   // used, then the mouse moved off it: gone after this long

// bounds: the game's screen { x, y, width, height }. cursorX: where the mouse was when the
// item was checked. The window goes beside the panel the item is in, as in Awakened PoE Trade:
// left of the inventory for an item in the inventory, right of the stash for one in the stash.
// custom: a spot picked by dragging in layout mode, { x, y, grow }, as for the other overlay
// parts (see overlayBounds). It wins: the window then always opens there.
function checkPanelBounds(bounds, cursorX, height, custom = null) {
  const b = bounds;
  const w = Math.min(PANEL_WIDTH, b.width);
  const h = Math.max(1, Math.min(Math.round(height), Math.round(b.height * 0.86)));
  if (custom && isFinite(custom.x) && isFinite(custom.y)) {
    const cx = b.x + custom.x * b.width;
    const cy = b.y + custom.y * b.height - (custom.grow === 'up' ? h : 0);
    return { x: Math.round(Math.max(b.x, Math.min(cx, b.x + b.width - w))), y: Math.round(Math.max(b.y, Math.min(cy, b.y + b.height - h))), width: w, height: h };
  }
  const gamePanel = Math.min(b.height * GAME_PANEL, (b.width - w) / 2);
  const right = cursorX >= b.x + b.width / 2;
  const x = right ? b.x + b.width - gamePanel - w : b.x + gamePanel;
  const y = b.y + b.height * 0.07;
  return { x: Math.round(Math.max(b.x, Math.min(x, b.x + b.width - w))), y: Math.round(y), width: w, height: h };
}

const inside = (r, p, margin = 0) => !!r && !!p && p.x >= r.x - margin && p.x < r.x + r.width + margin && p.y >= r.y - margin && p.y < r.y + r.height + margin;

// Whether the window should close now. entered: the mouse has been on it. sinceInside: ms since
// the mouse was last on it. sinceNews: ms since it was shown or last got something new.
// busy: a search is running, so an answer is on its way.
function shouldClose({ entered, sinceInside, sinceNews, busy }) {
  if (entered) return sinceInside > LEFT_MS;
  return !busy && sinceNews > IDLE_MS;
}

module.exports = { checkPanelBounds, inside, shouldClose, PANEL_WIDTH, IDLE_MS, LEFT_MS };
