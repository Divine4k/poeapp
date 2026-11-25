'use strict';
// How much Thaumaturgic Dust a unique gives at the Disenchanting bench in Kingsmarch.
// Each unique has a base value (data/dust.json, from Awakened PoE Trade, MIT licence); the item
// level multiplies it, and quality, influences and corruption implicits add to that. The same
// working-out Awakened PoE Trade uses.
const path = require('path');
const fs = require('fs');

let table = null;
function values() {
  if (!table) {
    try { table = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'dust.json'), 'utf8')); } catch (_) { table = {}; }
  }
  return table;
}

// item: { name, itemLevel, quality, influences, corruptionImplicits }. Returns a whole number,
// or null when the unique's base value is not known.
function dustValue(item) {
  const base = item && values()[item.name];
  if (!base) return null;
  const ilvl = Number(item.itemLevel) || 84; // an unidentified copy shows no item level: counted as the usual 84
  // +50% per influence, +2% per 1% quality, +50% per corruption implicit
  const more = (item.influences || []).length * 50 + (Number(item.quality) || 0) * 2 + (Number(item.corruptionImplicits) || 0) * 50;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const level = 50 // item level 46 and below
    + 2 * (clamp(ilvl, 46, 68) - 46) + Math.floor((3 * (clamp(ilvl, 46, 68) - 46)) / 11) // 47 to 68
    + 25 * (clamp(ilvl, 68, 84) - 68); // 69 to 84
  return Math.floor(base * 5 * level * ((100 + more) / 100));
}

module.exports = { dustValue };
