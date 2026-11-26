'use strict';
// Downloads item pictures (the URLs come with poe.ninja's price data) and turns each into a
// fingerprint the inventory reader can compare against. Fingerprints are cached on disk, so
// every picture is downloaded once.
const fs = require('fs');
const { nativeImage } = require('electron');
const { diag } = require('./diagnose');
const { CANON } = require('./core/inventory/grid');
const { fingerprint, sharpPrint, compositeOnCell, encodePrint, decodePrint, packPrint, unpackPrint, oneSlot } = require('./core/inventory/icons');

class ArtLoader {
  constructor({ cacheFile, fetchImpl, userAgent = 'poe-map-companion/0.3 (personal use)' }) {
    this.cacheFile = cacheFile;
    this.fetch = fetchImpl;
    this.userAgent = userAgent;
    this.cache = {};
    this.running = false;
    try { this.cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) { /* first run */ }
  }

  save() {
    try { fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache)); } catch (e) { console.error('art cache save failed', e.message); }
  }

  // Downloads one picture and returns it as CANON-sized RGB on the cell background,
  // plus its original size. null when it is not a one-cell item.
  async fetchRgb(url) {
    const res = await this.fetch(url, { headers: { 'User-Agent': this.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    if (img.isEmpty()) throw new Error('not an image');
    const size = img.getSize();
    if (Math.abs(size.width - size.height) > 2) return null;
    const small = img.resize({ width: CANON, height: CANON, quality: 'best' });
    return { rgb: compositeOnCell(small.toBitmap(), { bgr: true }), size };
  }

  async fetchPrint(url) {
    const r = await this.fetchRgb(url);
    return r ? fingerprint(r.rgb) : null;
  }

  // entries: [{ name, icon }]. Fills index.art; calls onProgress({ done, total, failed }).
  // Only items that take one slot: a bigger item's picture shrunk to one slot matches nothing
  // real (a 2x2 item never lies in one slot) and mostly empty ones matched dark slots (the
  // "Scarecrow's Pitchfork" that kept being asked about).
  async sync(entries, index, onProgress = () => {}) {
    if (this.running) return;
    this.running = true;
    try {
      const t0 = performance.now();
      index.clearArt();
      const missing = [];
      let skipped = 0;
      for (const e of entries) {
        // Cache entry: { p: fingerprint, s: sharp print }. Entries from before the sharp print
        // existed are plain strings; those pictures are downloaded once more.
        const c = this.cache[e.icon];
        if (c === 'skip') continue;
        if (!oneSlot(e.icon)) { skipped++; continue; }
        if (c && c.p && c.s) index.addArt(e.name, decodePrint(c.p), unpackPrint(c.s)); else missing.push(e);
      }
      // This part runs in one go on the main process, at start and after each price refresh.
      diag.time('item pictures: made ready from the kept ones', performance.now() - t0, `${entries.length} items, ${missing.length} to fetch, ${skipped} bigger than one slot left out`);
      let done = 0, failed = 0;
      const total = missing.length;
      onProgress({ done, total, failed });
      const worker = async () => {
        while (missing.length) {
          const e = missing.pop();
          try {
            const r = await this.fetchRgb(e.icon);
            if (r) {
              const print = fingerprint(r.rgb), sharp = sharpPrint(r.rgb);
              this.cache[e.icon] = { p: encodePrint(print), s: packPrint(sharp) };
              index.addArt(e.name, print, unpackPrint(this.cache[e.icon].s));
            } else this.cache[e.icon] = 'skip';
          } catch (_) { failed++; }
          done++;
          if (done % 50 === 0) { this.save(); onProgress({ done, total, failed }); }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (total) this.save();
      onProgress({ done, total, failed });
    } finally {
      this.running = false;
    }
  }
}

module.exports = { ArtLoader };
