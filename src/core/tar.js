'use strict';
// Minimal .tar.gz reader, enough for the source archives GitHub serves. No dependencies.
const zlib = require('zlib');

const text = (buf, start, len) => {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? len : end).toString('utf8');
};

// Returns [{ path, type: 'file' | 'dir', data }] with paths exactly as stored in the archive.
function readTarGz(gz) {
  const buf = zlib.gunzipSync(gz);
  const out = [];
  let off = 0;
  let longName = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(text(header, 124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = text(header, 345, 155);
    let name = text(header, 0, 100);
    if (prefix) name = `${prefix}/${name}`;
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;

    if (type === 'L') { longName = text(data, 0, data.length); continue; }          // GNU long name
    if (type === 'x') {                                                             // pax header for the next entry
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (m) longName = m[1];
      continue;
    }
    if (type === 'g') continue;                                                     // pax global header
    if (longName) { name = longName; longName = null; }
    if (type === '0' || type === '7') out.push({ path: name, type: 'file', data: Buffer.from(data) });
    else if (type === '5') out.push({ path: name, type: 'dir', data: null });
    // links and other entry types are ignored
  }
  return out;
}

// Maps archive entries to relative paths inside the app folder. GitHub archives wrap everything
// in one top folder, which is stripped. Anything that could escape the folder is rejected.
function planFiles(entries) {
  const files = [];
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const parts = e.path.split('/').filter(Boolean).slice(1);
    if (!parts.length) continue;
    if (parts.some((p) => p === '..' || p === '.' || /[\\:]/.test(p))) throw new Error(`Unsafe path in update: ${e.path}`);
    if (parts[0] === 'node_modules' || parts[0] === '.git') continue;
    files.push({ rel: parts.join('/'), data: e.data });
  }
  return files;
}

module.exports = { readTarGz, planFiles };
