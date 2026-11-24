'use strict';
// Links a modifier line from an item ("+92 to maximum Life") to its id on the trade site.
// The list comes from Awakened PoE Trade (see data/NOTICE.md) and the matching follows the
// same idea: swap the numbers for # and look the wording up. Plain logic, no Electron.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WEAPON = new Set(['Fishing Rod', 'Bow', 'Wand', 'One-Handed Axe', 'One-Handed Mace', 'One-Handed Sword', 'Claw', 'Dagger', 'Rune Dagger', 'Sceptre', 'Two-Handed Axe', 'Two-Handed Mace', 'Two-Handed Sword', 'Staff', 'Warstaff']);
const ARMOUR = new Set(['Body Armour', 'Boots', 'Gloves', 'Helmet', 'Shield']);
const HEIST_EQUIPMENT = new Set(['Heist Tool', 'Heist Brooch', 'Heist Gear', 'Heist Cloak']);

function categoryIs(actual, expected) {
  if (!actual) return false;
  if (expected === 'WEAPON') return WEAPON.has(actual);
  if (expected === 'ARMOUR') return ARMOUR.has(actual);
  if (expected === 'HEIST_EQUIPMENT') return HEIST_EQUIPMENT.has(actual);
  return expected === actual;
}

// Which of a line's numbers to keep as written while the rest become #. Some wordings hold a
// fixed number ("1 Added Passive Skill is a Jewel Socket"), so every sensible mix is tried,
// most # first.
const KEEP = [
  [[]],
  [[], [0]],
  [[], [1], [0], [0, 1]],
  [[2], [1], [0], [1, 2], [0, 2], [0, 1], [0, 1, 2]],
  [[2, 3], [1, 3], [1, 2], [0, 3], [0, 2], [0, 1], [1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2], [0, 1, 2, 3]],
];
const NUMBER = /(?<![\d)])[+-]?\d+(?:\.\d+)?/g;

function* wordings(text) {
  const found = text.match(NUMBER) || [];
  if (found.length < KEEP.length) {
    for (const keep of KEEP[found.length]) {
      let i = -1;
      const string = text.replace(NUMBER, (n) => { i += 1; return keep.includes(i) ? n : '#'; });
      yield { string, values: found.filter((_, k) => !keep.includes(k)).map(Number) };
    }
  }
  if (found.length) yield { string: text, values: [] };
}

class StatIndex {
  // entries: the parsed lines of stats.ndjson, each a stat or a group of stats that share wording.
  constructor(entries) {
    this.byMatch = new Map();
    this.byRef = new Map();
    for (const entry of entries) {
      for (const stat of entry.stats || [entry]) {
        if (!this.byRef.has(stat.ref)) this.byRef.set(stat.ref, stat);
        for (const m of stat.matchers) if (!this.byMatch.has(m.string)) this.byMatch.set(m.string, entry);
      }
    }
  }

  static load(file = path.join(__dirname, 'data', 'stats.ndjson.gz')) {
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
    return new StatIndex(text.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  }

  // The trade site's own ids for a made-up total such as "+# total maximum Life".
  pseudo(ref) {
    const stat = this.byRef.get(ref);
    return stat && stat.ids.pseudo ? stat.ids.pseudo : null;
  }

  // Picks the stat a wording belongs to. Several stats can read the same on an item: a weapon's
  // own "Adds # to # Physical Damage" and the one on a ring are different stats on the trade site.
  resolve(entry, string, type, category) {
    if (!entry.stats) return entry;
    const has = (s) => s.matchers.some((m) => m.string === string);
    if (entry.resolve && entry.resolve.strat === 'select') {
      let i = entry.resolve.test.findIndex((t) => t !== null && categoryIs(category, t));
      if (i === -1) i = entry.resolve.test.indexOf(null);
      return i === -1 ? null : entry.stats[i];
    }
    const fit = entry.stats.filter((s) => has(s) && s.ids[type]);
    if (fit.length <= 1) return fit[0] || null;
    // The same stat listed under several ids: search for any of them.
    return { ...fit[0], ids: { ...fit[0].ids, [type]: [...new Set(fit.flatMap((s) => s.ids[type]))] } };
  }

  // text: one modifier line without its "(implicit)" style ending. type: explicit, implicit,
  // crafted, fractured, enchant... category: the kind of item, such as "Ring" or "Bow".
  // Returns { ref, ids, value, better, inverted } or null when the trade site has no such stat.
  match(text, type = 'explicit', category = null) {
    for (const w of wordings(text)) {
      const entry = this.byMatch.get(w.string);
      if (!entry) {
        // A few modifiers exist on the trade site only as a total ("#% increased Rarity of
        // Items found"). Those are listed with a space at the end of their wording.
        const total = this.byMatch.get(`${w.string} `);
        if (total && !total.stats && total.ids.pseudo && w.values.length) {
          const value = w.values.length === 2 ? (w.values[0] + w.values[1]) / 2 : w.values[0];
          return { ref: total.ref, ids: total.ids.pseudo, value, better: total.better, inverted: false, pseudo: true };
        }
        continue;
      }
      const stat = this.resolve(entry, w.string, type, category);
      if (!stat || !stat.ids[type] || stat.option) continue;
      const matcher = stat.matchers.find((m) => m.string === w.string);
      if (!matcher) continue;
      let values = w.values;
      if (matcher.negate) values = values.map((v) => -v);
      if (!values.length && matcher.value !== undefined) values = [matcher.value];
      const value = values.length === 2 ? (values[0] + values[1]) / 2 : (values.length ? values[0] : null);
      return { ref: stat.ref, ids: stat.ids[type], value, better: stat.better, inverted: !!stat.inverted };
    }
    return null;
  }
}

module.exports = { StatIndex, wordings, categoryIs };
