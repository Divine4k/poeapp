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
// filters: buildFilters' result (the craft is priced through its total life or resistance line).
const LIFE_CRAFT = { Helmet: [56, 70], 'Body Armour': [56, 70], Gloves: [56, 70], Boots: [56, 70], Shield: [56, 70] };
const RES_CRAFT = [29, 35]; // one resistance, the bench's usual best
function craftRoom(item, filters) {
  if (!item || item.rarity !== 'Rare' || !item.slots || !item.slots.known || item.corrupted) return null;
  const open = { prefix: Math.max(0, 3 - item.slots.prefix), suffix: Math.max(0, 3 - item.slots.suffix) };
  if (!open.prefix && !open.suffix) return null;
  const has = (key) => !!(filters && filters.stats || []).find((s) => s.key === key);
  const kind = filters && filters.category ? filters.category.label : '';
  const ideas = [];
  if (open.prefix && LIFE_CRAFT[kind]) ideas.push({ slot: 'prefix', stat: 'pseudo:life', text: `+${LIFE_CRAFT[kind][0]}–${LIFE_CRAFT[kind][1]} to maximum Life`, add: LIFE_CRAFT[kind][0], priced: has('pseudo:life') });
  if (open.suffix) ideas.push({ slot: 'suffix', stat: 'pseudo:res', text: `+${RES_CRAFT[0]}–${RES_CRAFT[1]}% to a resistance`, add: RES_CRAFT[0], priced: has('pseudo:res') });
  return { open, crafted: !!item.slots.crafted, ideas };
}

module.exports = { vendorRecipe, verdict, craftRoom, WORTH_SELLING };
