'use strict';
// The trade overlay: a small window that sits on top of the game and shows open offers.
// It never takes keyboard focus, so the game keeps receiving your keys while you click it,
// and it is only as large as the offers it shows, so the rest of the screen stays clickable.
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const { overlayBounds, OVERLAY_WIDTH: WIDTH } = require('./core/trade');
const { checkPanelBounds, inside, shouldClose, PANEL_WIDTH } = require('./core/checkPanel');
const { menuBounds, MENU_WIDTH } = require('./core/stashSearch');

// The app's own windows over the game are left out of screen captures (Windows 10 2004 and
// later), so an inventory reading sees the game behind them, never the price check or a
// message. Streams and recordings by other programs do not show them either. While a
// troubleshooting recording runs they are shown again, so the recording has them.
let hiddenFromCapture = true;
const guarded = new Set();
function guard(win) {
  guarded.add(win);
  win.on('closed', () => guarded.delete(win));
  try { win.setContentProtection(hiddenFromCapture); } catch (_) { /* not on this system */ }
  return win;
}
function hideFromCapture(on) {
  if (hiddenFromCapture === !!on) return;
  hiddenFromCapture = !!on;
  for (const w of guarded) if (!w.isDestroyed()) try { w.setContentProtection(hiddenFromCapture); } catch (_) { /* not on this system */ }
}

class Overlay {
  constructor({ preload, page }) {
    this.preload = preload;
    this.page = page;
    this.win = null;
    this.height = 0;
    this.placement = {};
    this.displayId = null;
    this.wanted = false;
    this.last = null;
  }

  display() {
    const all = screen.getAllDisplays();
    return all.find((d) => String(d.id) === String(this.displayId)) || screen.getPrimaryDisplay();
  }

  create() {
    if (this.win && !this.win.isDestroyed()) return;
    this.win = new BrowserWindow({
      width: WIDTH, height: 10, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, title: 'Map Companion trades',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false },
    });
    guard(this.win);
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setMenuBarVisibility(false);
    this.win.loadFile(this.page);
    this.win.webContents.on('did-finish-load', () => { if (this.last) this.send(this.last); });
    this.win.on('closed', () => { this.win = null; });
  }

  send(data) {
    this.last = data;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('trade', data);
  }

  // show: whether there is anything to show. The window appears once the page has reported
  // how tall its content is.
  update(data, { show, displayId, placement }) {
    this.displayId = displayId;
    this.placement = placement || {};
    this.wanted = !!show;
    if (!this.wanted) {
      if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
      this.last = data;
      return;
    }
    this.create();
    this.send(data);
    this.place();
  }

  // Called by the overlay page with the height of what it drew.
  setHeight(h) {
    this.height = Math.max(0, Number(h) || 0);
    this.place();
  }

  place() {
    if (!this.win || this.win.isDestroyed()) return;
    if (!this.wanted || this.height < 2) { if (this.win.isVisible()) this.win.hide(); return; }
    // Moving or resizing a see-through window costs Windows a redraw of the whole window, so
    // it is only done when the place or size really changed.
    const rect = overlayBounds(this.display(), this.height, this.placement);
    // Compared with where the window really is, so it is put back if Windows moved it.
    const now = this.win.getBounds();
    const same = this.win.isVisible() && ['x', 'y', 'width', 'height'].every((k) => now[k] === rect[k]);
    if (!same) this.win.setBounds(rect);
    if (!this.win.isVisible()) { this.win.showInactive(); this.win.setAlwaysOnTop(true, 'screen-saver'); }
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

// A short message on top of the game that goes away by itself. Clicks pass through it.
class Toast {
  constructor({ page }) {
    this.page = page;
    this.win = null;
    this.timer = null;
  }

  // rect: where to draw, in screen points. message: { title, detail, bad }. ms: how long it stays.
  show(rect, message, ms) {
    const hash = encodeURIComponent(JSON.stringify(message));
    if (!this.win || this.win.isDestroyed()) {
      this.win = new BrowserWindow({
        ...rect, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
        title: 'Map Companion message', webPreferences: { contextIsolation: true, nodeIntegration: false },
      });
      guard(this.win);
      this.win.setIgnoreMouseEvents(true);
      this.win.setAlwaysOnTop(true, 'screen-saver');
      this.win.on('closed', () => { this.win = null; });
    }
    this.win.loadFile(this.page, { hash });
    this.win.setBounds(rect);
    if (!this.win.isVisible()) { this.win.showInactive(); this.win.setAlwaysOnTop(true, 'screen-saver'); }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), ms);
  }

  hide() {
    clearTimeout(this.timer);
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  destroy() {
    clearTimeout(this.timer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

// The price check on top of the game: the item's stats with tick boxes, and what the trade
// site lists like it. Like the trade overlay it never takes the keyboard, so the game keeps
// your keys while you click it. It closes with its cross (or Escape and the inventory key, in
// main.js), or by itself when it was never touched.
class CheckPanel {
  constructor({ preload, page, onClose, onKeys }) {
    this.preload = preload;
    this.page = page;
    this.onClose = onClose || (() => {});
    this.onKeys = onKeys || (() => {}); // typing a number starts or ends: main.js holds or frees the keys
    this.win = null;
    this.height = 0;
    this.wanted = false;
    this.last = null;
    this.bounds = null;  // the game's screen
    this.cursorX = 0;    // where the mouse was when the item was checked
    this.rect = null;    // where the window is now
    this.timer = null;
    this.entered = false;
    this.insideAt = 0;
    this.newsAt = 0;
    this.rev = null;
  }

  create() {
    if (this.win && !this.win.isDestroyed()) return;
    this.win = new BrowserWindow({
      width: PANEL_WIDTH, height: 10, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, title: 'Map Companion price check',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false },
    });
    guard(this.win);
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setMenuBarVisibility(false);
    this.win.loadFile(this.page);
    this.win.webContents.on('did-finish-load', () => { if (this.last) this.send(this.last); });
    this.win.on('closed', () => { this.win = null; });
  }

  get visible() { return this.wanted; }

  send(data) {
    this.last = data;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('check', data);
  }

  // A newly checked item. bounds: the game's screen. cursor: the mouse, in screen points.
  // custom: the spot picked in layout mode, if any.
  show(data, { bounds, cursor, custom = null }) {
    this.custom = custom;
    this.bounds = bounds;
    this.cursorX = cursor ? cursor.x : bounds.x + bounds.width;
    this.wanted = true;
    this.entered = false;
    this.newsAt = Date.now();
    this.rev = data.rev;
    this.height = 0; // the page reports the new item's height before the window shows
    this.create();
    this.send(data);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.watch(), 150);
  }

  // The same item with news: a search started or its answer came.
  update(data) {
    if (!this.wanted) return;
    if (data.rev !== this.rev) { this.rev = data.rev; this.newsAt = Date.now(); }
    this.send(data);
  }

  // A press of the left mouse button seen by the app at this spot of the window (see check.js).
  press(x, y) { if (this.wanted && this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.webContents.send('check-press', { x, y }); }

  // While a number is typed in. The window never takes the keyboard: the game keeps it, and the
  // app holds only the keys a number needs until the typing ends (see typingKeys in main.js).
  // Taking the keyboard meant moving the game out of the front, and Windows did that badly:
  // Explorer came in front, the check closed and its key stopped working.
  takeKeys(on) {
    if (this.typing === !!on) return;
    this.typing = !!on;
    this.onKeys(this.typing);
  }

  // A key held for the typing, passed on to the window: '0'-'9', '.', '-', 'Backspace',
  // 'Enter', 'Escape', or 'done' (a click somewhere else: keep the number).
  key(k) { if (this.win && !this.win.isDestroyed()) this.win.webContents.send('check-key', k); }

  setHeight(h) {
    const height = Math.max(0, Number(h) || 0);
    // Moving or resizing a see-through window costs Windows a redraw of the whole window, so it
    // is only done when the height really changed (a click on + or - does not change it).
    if (height === this.height && this.win && !this.win.isDestroyed() && this.win.isVisible()) return;
    this.height = height;
    this.place();
  }

  place() {
    if (!this.win || this.win.isDestroyed() || !this.wanted || !this.bounds) return;
    if (this.height < 2) return;
    const rect = checkPanelBounds(this.bounds, this.cursorX, this.height, this.custom);
    const same = this.rect && ['x', 'y', 'width', 'height'].every((k) => this.rect[k] === rect[k]);
    this.rect = rect;
    if (!same || !this.win.isVisible()) this.win.setBounds(this.rect);
    if (!this.win.isVisible()) { this.win.showInactive(); this.win.setAlwaysOnTop(true, 'screen-saver'); }
  }

  watch() {
    if (!this.wanted) return;
    const now = Date.now();
    if (this.rect && inside(this.rect, screen.getCursorScreenPoint(), 12)) { this.entered = true; this.insideAt = now; }
    const busy = !!(this.last && this.last.state === 'searching');
    if (shouldClose({ entered: this.entered, sinceInside: now - this.insideAt, sinceNews: now - this.newsAt, busy })) { this.hide(); this.onClose(); }
  }

  hide() {
    if (this.typing) this.takeKeys(false);
    this.wanted = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  destroy() {
    clearInterval(this.timer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

// Saved stash searches, opened at the mouse with their key. Like the price check it never
// takes the keyboard, so the game keeps it and the search typed after a click lands in the
// game's stash search box. It closes on a pick, its key, Escape or a click anywhere else
// (main.js), and once the mouse has left it for a moment.
const MENU_LEAVE_MS = 1200;
class SearchMenu {
  constructor({ preload, page }) {
    this.preload = preload;
    this.page = page;
    this.win = null;
    this.wanted = false;
    this.last = null;
    this.bounds = null;
    this.cursor = null;
    this.height = 0;
    this.rect = null;
    this.timer = null;
    this.entered = false;
    this.outsideAt = 0;
  }

  create() {
    if (this.win && !this.win.isDestroyed()) return;
    this.win = new BrowserWindow({
      width: MENU_WIDTH, height: 10, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, title: 'Map Companion stash searches',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false },
    });
    guard(this.win);
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setMenuBarVisibility(false);
    this.win.loadFile(this.page);
    this.win.webContents.on('did-finish-load', () => { if (this.last) this.send(this.last); });
    this.win.on('closed', () => { this.win = null; });
  }

  get visible() { return this.wanted; }

  send(data) {
    this.last = data;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('searches', data);
  }

  // data: { entries, key }. bounds: the game's screen. cursor: the mouse, in screen points.
  show(data, { bounds, cursor }) {
    this.bounds = bounds;
    this.cursor = cursor;
    this.wanted = true;
    this.entered = false;
    this.outsideAt = Date.now();
    this.create();
    this.send(data);
    this.place();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.watch(), 150);
  }

  setHeight(h) {
    const height = Math.max(0, Number(h) || 0);
    if (height === this.height && this.win && !this.win.isDestroyed() && this.win.isVisible()) return;
    this.height = height;
    this.place();
  }

  place() {
    if (!this.win || this.win.isDestroyed() || !this.wanted || !this.bounds || this.height < 2) return;
    const rect = menuBounds(this.bounds, this.cursor, this.height);
    const same = this.rect && ['x', 'y', 'width', 'height'].every((k) => this.rect[k] === rect[k]);
    this.rect = rect;
    if (!same || !this.win.isVisible()) this.win.setBounds(rect);
    if (!this.win.isVisible()) { this.win.showInactive(); this.win.setAlwaysOnTop(true, 'screen-saver'); }
  }

  // Whether a point on the screen is on the menu.
  holds(p) { return !!(this.wanted && this.rect && inside(this.rect, p)); }

  // A press of the left mouse button the app saw on the menu, at this spot of the window: over
  // the game the window does not always get the click itself (as with the price check).
  press(x, y) { if (this.wanted && this.win && !this.win.isDestroyed()) this.win.webContents.send('search-press', { x, y }); }

  // Opened by mistake or looked at and left: it goes once the mouse has been off it a moment.
  watch() {
    if (!this.wanted || !this.rect) return;
    const now = Date.now();
    if (inside(this.rect, screen.getCursorScreenPoint(), 16)) { this.entered = true; this.outsideAt = now; return; }
    if (this.entered && now - this.outsideAt > MENU_LEAVE_MS) this.hide();
  }

  hide() {
    this.wanted = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  destroy() {
    clearInterval(this.timer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { Overlay, Toast, CheckPanel, SearchMenu, overlayBounds, WIDTH, guard, hideFromCapture };
