'use strict';
// The timeless jewel tables: for every seed, what each notable (and for Glorious Vanity every
// passive) in reach turns into. They come from Path of Building (MIT licence, see
// src/core/data/NOTICE.md) and are 0.9 to 23 MB each, too big to ship in every update (the
// updater downloads the whole app). So each is downloaded the first time it is needed, kept in the
// app's folder, and read from there afterwards.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Moving this downloads the tables again for everyone. Keep it on the commit build-jewels.js used.
const POB_COMMIT = '5606cc64fa9f15694e69001a52b90aa968d01a86';
const BASE = `https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/${POB_COMMIT}/src/Data/TimelessJewelData/`;
// File name and how many parts it is split into (0 = one .zip file).
const FILES = {
  1: ['GloriousVanity', 5], 2: ['LethalPride', 0], 3: ['BrutalRestraint', 0], 4: ['MilitantFaith', 0], 5: ['ElegantHubris', 0], 6: ['HeroicTragedy', 0],
};

class Tables {
  // dir: where downloaded tables are kept. fetchImpl: fetch(url) -> Response (for tests).
  constructor({ dir, fetchImpl, onProgress } = {}) {
    this.dir = dir;
    this.fetch = fetchImpl || ((url) => fetch(url));
    this.onProgress = onProgress || (() => {});
    this.loaded = new Map(); // type -> Buffer (unpacked)
    this.pending = new Map(); // type -> Promise
  }

  has(type) { return this.loaded.has(type); }

  isDownloaded(type) { return !!this.dir && fs.existsSync(this.file(type)); }

  // The unpacked table of one jewel type; downloads it first if it is not on disk yet.
  get(type) {
    if (this.loaded.has(type)) return Promise.resolve(this.loaded.get(type));
    if (!FILES[type]) return Promise.reject(new Error('Unknown jewel'));
    if (!this.pending.has(type)) {
      const p = this.read(type).then((buf) => { this.loaded.set(type, buf); this.pending.delete(type); return buf; },
        (err) => { this.pending.delete(type); throw err; });
      this.pending.set(type, p);
    }
    return this.pending.get(type);
  }

  file(type) {
    const [name] = FILES[type];
    return this.dir && path.join(this.dir, `${POB_COMMIT.slice(0, 8)}-${name}.zip`);
  }

  // Downloads a table to disk if it is not there yet (checked by unpacking it before it is kept).
  // Returns the unpacked table when it had to be downloaded, otherwise null.
  async download(type) {
    if (!FILES[type]) throw new Error('Unknown jewel');
    const file = this.file(type);
    if (file && fs.existsSync(file)) return null;
    const [name, parts] = FILES[type];
    const urls = parts ? Array.from({ length: parts }, (_, i) => `${BASE}${name}.zip.part${i}`) : [`${BASE}${name}.zip`];
    const chunks = [];
    for (let i = 0; i < urls.length; i++) {
      this.onProgress({ type, part: i + 1, parts: urls.length });
      const res = await this.fetch(urls[i]);
      if (!res.ok) throw new Error(`Could not download the jewel table (${res.status})`);
      chunks.push(Buffer.from(await res.arrayBuffer()));
    }
    const packed = Buffer.concat(chunks);
    const buf = unpack(packed);
    if (file) {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, packed);
      fs.renameSync(`${file}.tmp`, file);
    }
    return buf;
  }

  async read(type) {
    const file = this.file(type);
    if (file && fs.existsSync(file)) return unpack(fs.readFileSync(file));
    return this.download(type);
  }
}

function unpack(buf) {
  try { return zlib.inflateSync(buf); } catch (_) { return zlib.inflateRawSync(buf); }
}

module.exports = { Tables, FILES, POB_COMMIT, unpack };
