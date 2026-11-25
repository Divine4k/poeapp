'use strict';
// Records the game's screen to a video file, for troubleshooting recordings. A hidden window
// does the recording with Chromium's own screen capture and video encoder (the same capture
// the inventory reader uses, as a video stream instead of single pictures), and hands the
// video to this process in pieces, which are written straight to the file.
const fs = require('fs');
const path = require('path');
const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');

const MAX_WIDTH = 1920;   // full HD: a bigger screen is scaled down to 1920 wide
const MAX_HEIGHT = 1080;
const FPS = 60;
const BITRATE = 8000000;  // bits per second, about 60 MB a minute; sent in pieces GitHub takes

class ScreenRecorder {
  constructor({ page, preload }) {
    this.page = page; this.preload = preload;
    this.win = null; this.out = null; this.bytes = 0; this.wait = null; this.info = null;
    const mine = (e) => this.win && !this.win.isDestroyed() && e.sender === this.win.webContents;
    ipcMain.on('rec-started', (e, info) => { if (mine(e)) this.settle('started', null, info); });
    ipcMain.on('rec-failed', (e, msg) => { if (mine(e)) this.settle('started', new Error(String(msg || 'The screen could not be recorded.'))); });
    ipcMain.on('rec-chunk', (e, data) => {
      if (!mine(e) || !data) return;
      const b = Buffer.from(data);
      this.bytes += b.length;
      if (this.out) this.out.write(b); else (this.early = this.early || []).push(b);
    });
    ipcMain.on('rec-stopped', (e) => { if (mine(e)) this.settle('stopped'); });
  }
  get active() { return !!this.win; }

  settle(what, err = null, value) {
    const w = this.wait;
    if (!w || w.what !== what) return;
    this.wait = null; clearTimeout(w.timer);
    if (err) w.reject(err); else w.resolve(value);
  }
  waitFor(what, ms) {
    return new Promise((resolve, reject) => {
      this.wait = { what, resolve, reject, timer: setTimeout(() => this.settle(what, new Error(what === 'started' ? 'The screen recording did not start in time.' : 'The video did not finish in time; it may be cut short.')), ms) };
    });
  }

  // Starts recording the screen the game is on. Answers { width, height, mime } once it runs.
  async start({ displayId, dir }) {
    if (this.win) throw new Error('Already recording.');
    const all = screen.getAllDisplays();
    const display = all.find((d) => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src) throw new Error('No screen to record was found.');
    const w = Math.round(display.size.width * display.scaleFactor), h = Math.round(display.size.height * display.scaleFactor);
    const scale = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h);
    const width = Math.round(w * scale), height = Math.round(h * scale);
    // The file is opened once the format is known (MP4 or WebM): dir/video.mp4 or video.webm.
    this.dir = dir;
    this.out = null;
    this.bytes = 0;
    this.win = new BrowserWindow({ show: false, width: 200, height: 100, webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.win.on('closed', () => { this.win = null; });
    try {
      await this.win.loadFile(this.page);
      const started = this.waitFor('started', 15000);
      this.win.webContents.send('rec-start', { sourceId: src.id, width, height, fps: FPS, bitrate: BITRATE });
      const got = await started;
      const ext = /mp4/.test(got.mime || '') ? 'mp4' : 'webm';
      this.out = fs.createWriteStream(path.join(this.dir, `video.${ext}`));
      for (const b of this.early || []) this.out.write(b);
      this.early = null;
      this.info = { ...got, file: `video.${ext}`, screen: { width: w, height: h, scaleFactor: display.scaleFactor, displayId: display.id } };
      return this.info;
    } catch (e) {
      await this.close();
      throw e;
    }
  }

  // Stops, writes the end of the video, and answers { bytes }.
  async stop() {
    if (!this.win) return { bytes: this.bytes };
    let problem = null;
    try {
      const stopped = this.waitFor('stopped', 20000);
      this.win.webContents.send('rec-stop');
      await stopped;
    } catch (e) { problem = e.message; }
    await this.close();
    return { bytes: this.bytes, problem };
  }

  async close() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    const out = this.out; this.out = null;
    if (out) await new Promise((resolve) => out.end(resolve));
  }
}

module.exports = { ScreenRecorder };
