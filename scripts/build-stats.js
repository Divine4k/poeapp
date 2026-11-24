'use strict';
// Rebuilds src/core/data/stats.ndjson.gz, the list that links a modifier's wording to its id on
// the trade site. The source is Awakened PoE Trade's stats.ndjson (MIT licence, see
// src/core/data/NOTICE.md). Run this at the start of a league, when new modifiers appear:
//
//   node scripts/build-stats.js path/to/awakened-poe-trade/renderer/public/data/en/stats.ndjson
//
// Only what the price check uses is kept.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const src = process.argv[2];
if (!src) { console.error('Give the path to stats.ndjson.'); process.exit(1); }

const slimStat = (s) => {
  const out = { ref: s.ref, better: s.better, matchers: s.matchers.map((m) => { const o = { string: m.string }; if (m.negate) o.negate = true; if (m.value !== undefined) o.value = m.value; return o; }), ids: s.trade.ids };
  if (s.trade.inverted) out.inverted = true;
  if (s.trade.option) out.option = true;
  return out;
};

const lines = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean);
const out = [];
for (const line of lines) {
  const e = JSON.parse(line);
  out.push(JSON.stringify(e.stats ? { resolve: e.resolve, stats: e.stats.map(slimStat) } : slimStat(e)));
}
const dest = path.join(__dirname, '..', 'src', 'core', 'data', 'stats.ndjson.gz');
fs.writeFileSync(dest, zlib.gzipSync(out.join('\n'), { level: 9 }));
console.log(`${out.length} entries, ${fs.statSync(dest).size} bytes -> ${dest}`);
