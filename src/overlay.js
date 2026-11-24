'use strict';
// The trade overlay: a small window that sits on top of the game and shows open offers.
// It never takes keyboard focus, so the game keeps receiving your keys while you click it,
// and it is only as large as the offers it shows, so the rest of the screen stays clickable.
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const { overlayBounds, OVERLAY_WIDTH: WIDTH } = require('./core/trade');
const { checkPanelBounds, inside, shouldClose, PANEL_WIDTH } = require('./core/checkPanel');

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
    this.win.setBounds(overlayBounds(this.display(), this.height, this.placement));
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
  constructor({ preload, page, onClose }) {
    this.preload = preload;
    this.page = page;
    this.onClose = onClose || (() => {});
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

  // While a number is typed in, the window takes the keyboard; otherwise it never does.
  takeKeys(on) {
    this.typing = !!on;
    if (!this.win || this.win.isDestroyed()) return;
    if (on) { this.win.setFocusable(true); this.win.focus(); this.win.webContents.focus(); }
    else { this.win.setFocusable(false); this.win.setAlwaysOnTop(true, 'screen-saver'); }
  }

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

module.exports = { Overlay, Toast, CheckPanel, overlayBounds, WIDTH };
