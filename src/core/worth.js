'use strict';
// Quick judgements on a checked item, beside its price: what a vendor gives for it, a one-word
// verdict, and how much room it has left for a mod from the crafting bench.

// What selling it to a vendor gives, when one of the socket recipes applies (the best one).
// item: as parseItemText reads it. Returns { name, count } or null.
function vendorRecipe(item) {
  const s = String((item && item.sockets) || '').toUpperCase();
  if (!s) return null;
  const groups = s.split(' ').map((g) => g.split('-').filter(Boolean));
  const count = groups.reduce((n, g) => n + g.length, 0);
  if (groups.some((g) => g.length >= 6)) return { name: 'Orb of Fusing', count: 20, why: 'six linked sockets' };
  if (count >= 6) return { name: "Jeweller's Orb", count: 7, why: 'six sockets' };
  if (groups.some((g) => g.includes('R') && g.includes('G') && g.includes('B'))) return { name: 'Chromatic Orb', count: 1, why: 'linked red, green and blue sockets' };
  return null;
}

// One verdict for the item at a glance. price: what it sells for, in chaos (null: not known
// yet). vendor: { chaos } of the vendor recipe, or null. divine: a divine in chaos.
// Returns { kind, text } (kind: top, sell, vendor, low) or null.
const WORTH_SELLING = 5; // chaos
function verdict({ price, vendor, divine }) {
  const v = vendor && vendor.chaos > 0 ? vendor.chaos : 0;
  if (price === null || price === undefined || !isFinite(price)) return v ? { kind: 'vendor', text: 'Vendor recipe' } : null;
  if (divine > 0 && price >= divine) return { kind: 'top', text: 'Valuable item!' };
  if (v && v >= price) return { kind: 'vendor', text: 'Vendor it' };
  if (price >= WORTH_SELLING) return { kind: 'sell', text: 'Worth selling' };
  return { kind: 'low', text: 'Not worth selling' };
}

// What the crafting bench can still add to a rare: open prefixes and suffixes, and the usual
// craft for each, for the kinds of gear that take them. Only known from the fuller item text.
// filters: buildFilters' result. index: the trade stat list, for the total line to search a
// craft on when the item has none of its own (no life on it yet, say).
const LIFE_CRAFT = { Helmet: [56, 70], 'Body Armour': [56, 70], Gloves: [56, 70], Boots: [56, 70], Shield: [56, 70] };
const RES_CRAFT = [29, 35]; // one resistance, the bench's usual best
const TOTALS = { 'pseudo:life': ['+# total maximum Life', 'total maximum Life'], 'pseudo:res': ['+#% total Elemental Resistance', 'total Elemental Resistance'] };
function craftRoom(item, filters, index = null) {
  if (!item || item.rarity !== 'Rare' || !item.slots || !item.slots.known || item.corrupted) return null;
  const open = { prefix: Math.max(0, 3 - item.slots.prefix), suffix: Math.max(0, 3 - item.slots.suffix) };
  if (!open.prefix && !open.suffix) return null;
  const kind = filters && filters.category ? filters.category.label : '';
  const idea = (slot, stat, text, add) => {
    const has = !!((filters && filters.stats) || []).find((x) => x.key === stat);
    const ids = has ? null : (index && index.pseudo ? index.pseudo(TOTALS[stat][0]) : null);
    return { slot, stat, text, add, ids, priced: has || !!ids };
  };
  const ideas = [];
  if (open.prefix && LIFE_CRAFT[kind]) ideas.push(idea('prefix', 'pseudo:life', `+${LIFE_CRAFT[kind][0]}–${LIFE_CRAFT[kind][1]} to maximum Life`, LIFE_CRAFT[kind][0]));
  if (open.suffix) ideas.push(idea('suffix', 'pseudo:res', `+${RES_CRAFT[0]}–${RES_CRAFT[1]}% to a resistance`, RES_CRAFT[0]));
  return { open, crafted: !!item.slots.crafted, ideas };
}

// The search's choices as if the crafts were already on the item: the total line each one adds
// to is raised by the craft's lowest roll (and ticked), or added when the item had none.
function withCrafts(filters, ideas) {
  let stats = filters.stats;
  for (const i of ideas || []) {
    const line = stats.find((x) => x.key === i.stat);
    if (line) {
      const from = line.min !== null && line.min !== undefined ? line.min : (line.value || 0);
      stats = stats.map((x) => (x === line ? { ...x, enabled: true, min: from + i.add } : x));
    } else if (i.ids) {
      stats = [...stats, { key: i.stat, text: `+${i.add} ${TOTALS[i.stat][1]}`, kind: 'pseudo', ids: i.ids, value: null, min: i.add, max: null, enabled: true, inverted: false, negated: false, tiers: [] }];
    }
  }
  return { ...filters, stats };
}

// The price to compare a craft by: the average of the five cheapest real listings (bait left
// out). A stricter search only ever keeps some of the same listings, so its five cheapest can
// not be cheaper than the looser search's: the difference is never below zero, and one odd
// listing moves it less than a single cheapest or a middle price would. Fewer than three
// listed: too few to tell (null). chaos: each listing's price in chaos (null when unknown).
const TYPICAL_OF = 5, TOO_FEW = 3;
function typicalPrice(chaos) {
  const known = (chaos || []).filter((c) => c !== null && c !== undefined && isFinite(c)).sort((a, b) => a - b);
  if (known.length < TOO_FEW) return { value: null, n: known.length };
  const top = known.slice(0, TYPICAL_OF);
  return { value: Math.round((top.reduce((a, b) => a + b, 0) / top.length) * 10) / 10, n: known.length };
}

module.exports = { vendorRecipe, verdict, craftRoom, withCrafts, typicalPrice, WORTH_SELLING };
