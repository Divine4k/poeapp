'use strict';
// Screen capture + OCR. Uses the operating system's normal screen capture (the same mechanism
// recording software uses). It never reads game memory, never touches game files and never
// sends input to the game.
const { desktopCapturer, screen, nativeImage } = require('electron');
const { grayInvert } = require('./core/imaging');

class ScreenScanner {
  constructor({ cachePath }) {
    this.cachePath = cachePath;
    this.worker = null;
    this.starting = null;
    this.busy = false;
    this.error = null;
  }

  get ready() { return !!this.worker; }

  async init() {
    if (this.worker) return;
    if (!this.starting) {
      this.starting = (async () => {
        const { createWorker, PSM } = require('tesseract.js');
        // First run downloads the English language data (about 10 MB) into cachePath.
        const worker = await createWorker('eng', 1, { cachePath: this.cachePath });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        this.worker = worker;
        this.error = null;
      })().catch((e) => { this.error = e.message || String(e); this.starting = null; throw e; });
    }
    return this.starting;
  }

  pickDisplay(displayId) {
    const all = screen.getAllDisplays();
    return all.find((d) => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
  }

  async capture({ displayId, scale = 1, cropBottom = 0.82 }) {
    const d = this.pickDisplay(displayId);
    const width = Math.round(d.size.width * d.scaleFactor * scale);
    const height = Math.round(d.size.height * d.scaleFactor * scale);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('Screen capture returned nothing. Run the game in Windowed Fullscreen.');
    let img = src.thumbnail;
    const full = img.getSize();
    // The bottom strip is the flask and skill bar: no loot labels there, only OCR noise.
    const keep = Math.max(1, Math.round(full.height * Math.min(1, Math.max(0.3, cropBottom))));
    if (keep < full.height) img = img.crop({ x: 0, y: 0, width: full.width, height: keep });
    const size = img.getSize();
    const bitmap = grayInvert(img.toBitmap());
    const png = nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height }).toPNG();
    return { png, width: full.width, height: full.height };
  }

  // Returns { lines: [{ text, bbox }], width, height, ms } or null when a scan is already running.
  async scan(opts) {
    if (this.busy) return null;
    this.busy = true;
    const t0 = Date.now();
    try {
      await this.init();
      const frame = await this.capture(opts);
      const { data } = await this.worker.recognize(frame.png);
      const lines = (data.lines || []).map((l) => ({ text: l.text, bbox: l.bbox, confidence: l.confidence }));
      this.error = null;
      return { lines, width: frame.width, height: frame.height, ms: Date.now() - t0 };
    } catch (e) {
      this.error = e.message || String(e);
      throw e;
    } finally {
      this.busy = false;
    }
  }

  async stop() {
    if (this.worker) { try { await this.worker.terminate(); } catch (_) { /* closing anyway */ } }
    this.worker = null;
    this.starting = null;
  }
}

module.exports = { ScreenScanner };
