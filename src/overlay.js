'use strict';
// The trade overlay: a small window that sits on top of the game and shows open offers.
// It never takes keyboard focus, so the game keeps receiving your keys while you click it,
// and it is only as large as the offers it shows, so the rest of the screen stays clickable.
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const { overlayBounds, stashCellRect, OVERLAY_WIDTH: WIDTH } = require('./core/trade');

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

// A frame around one stash slot. Clicks go straight through it to the game.
class Highlight {
  constructor({ page }) {
    this.page = page;
    this.win = null;
  }

  // rect: where the slot is, in screen points, or null to hide.
  show(rect) {
    if (!rect) { if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide(); return; }
    if (!this.win || this.win.isDestroyed()) {
      this.win = new BrowserWindow({
        ...rect, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
        title: 'Map Companion stash slot', webPreferences: { contextIsolation: true, nodeIntegration: false },
      });
      this.win.setIgnoreMouseEvents(true);
      this.win.setAlwaysOnTop(true, 'screen-saver');
      this.win.loadFile(this.page);
      this.win.on('closed', () => { this.win = null; });
    }
    const now = this.win.getBounds();
    if (now.x !== rect.x || now.y !== rect.y || now.width !== rect.width || now.height !== rect.height) this.win.setBounds(rect);
    if (!this.win.isVisible()) { this.win.showInactive(); this.win.setAlwaysOnTop(true, 'screen-saver'); }
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { Overlay, Highlight, overlayBounds, stashCellRect, WIDTH };
