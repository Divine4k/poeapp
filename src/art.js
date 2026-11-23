'use strict';
// Downloads item pictures (the URLs come with poe.ninja's price data) and turns each into a
// fingerprint the inventory reader can compare against. Fingerprints are cached on disk, so
// every picture is downloaded once.
const fs = require('fs');
const { nativeImage } = require('electron');
const { CANON } = require('./core/inventory/grid');
const { fingerprint, compositeOnCell, encodePrint, decodePrint } = require('./core/inventory/icons');

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

  async fetchPrint(url) {
    const res = await this.fetch(url, { headers: { 'User-Agent': this.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    if (img.isEmpty()) throw new Error('not an image');
    const size = img.getSize();
    if (Math.abs(size.width - size.height) > 2) return null; // not a one-cell item
    const small = img.resize({ width: CANON, height: CANON, quality: 'best' });
    return fingerprint(compositeOnCell(small.toBitmap(), { bgr: true }));
  }

  // entries: [{ name, icon }]. Fills index.art; calls onProgress({ done, total, failed }).
  async sync(entries, index, onProgress = () => {}) {
    if (this.running) return;
    this.running = true;
    try {
      index.clearArt();
      const missing = [];
      for (const e of entries) {
        const c = this.cache[e.icon];
        if (c === 'skip') continue;
        if (c) index.addArt(e.name, decodePrint(c)); else missing.push(e);
      }
      let done = 0, failed = 0;
      const total = missing.length;
      onProgress({ done, total, failed });
      const worker = async () => {
        while (missing.length) {
          const e = missing.pop();
          try {
            const print = await this.fetchPrint(e.icon);
            if (print) { this.cache[e.icon] = encodePrint(print); index.addArt(e.name, print); } else this.cache[e.icon] = 'skip';
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
