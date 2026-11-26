'use strict';
// The advanced price check: the value table, scoring a rare, the searches it writes, and the
// range worked out from listings. No web: the searches are only looked at, never sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItemText } = require('../src/core/itemText');
const { StatIndex } = require('../src/core/tradeStats');
const advanced = require('../src/core/advanced');
const { PROFILES, TOTALS, BENCH } = require('../src/core/advanced/values');
const { KINDS, MAX_COST, STEPS, lowest, costOf, scoreListing, listingLines } = require('../src/core/advanced/score');
const { estimate, DAY } = require('../src/core/advanced/estimate');

const index = StatIndex.load();
const plan = (text) => advanced.plan(parseItemText(text), index);

const CHEST = `Item Class: Body Armours
Rarity: Rare
Havoc Shell
Zodiac Leather
--------
Evasion Rating: 1820 (augmented)
--------
Requirements:
Level: 65
Dex: 197
--------
Sockets: G-G-G-G-G-G
--------
Item Level: 85
--------
{ Prefix Modifier "Prime" (Tier: 1) — Life }
+124(120-129) to maximum Life
{ Prefix Modifier "Unassailable" (Tier: 2) — Defences }
105(101-110)% increased Evasion Rating
{ Suffix Modifier "of Snuffing" (Tier: 1) — Defences }
+22(20-22)% chance to Suppress Spell Damage
{ Suffix Modifier "of the Volcano" (Tier: 2) — Elemental, Fire, Resistance }
+44(42-45)% to Fire Resistance
{ Suffix Modifier "of the Lightning" (Tier: 3) — Elemental, Lightning, Resistance }
+38(36-41)% to Lightning Resistance
`;
const ES_CHEST = `Item Class: Body Armours
Rarity: Rare
Soul Shroud
Vaal Regalia
--------
Energy Shield: 612 (augmented)
--------
Sockets: B-B-B-B-B-B
--------
Item Level: 86
--------
+92 to maximum Energy Shield
118% increased Energy Shield
+41% to Cold Resistance
+39% to Lightning Resistance
+48 to Intelligence
`;
const RING = `Item Class: Rings
Rarity: Rare
Doom Loop
Two-Stone Ring
--------
Requirements:
Level: 64
--------
Item Level: 84
--------
+14% to Fire and Cold Resistances (implicit)
--------
+38 to Strength
Adds 8 to 14 Physical Damage to Attacks
+72 to maximum Life
+41% to Lightning Resistance
+17% to Chaos Resistance
12% increased Rarity of Items found
+25 to maximum Mana (crafted)
--------
Shaper Item
`;
const JUNK = `Item Class: Rings
Rarity: Rare
Sad Loop
Iron Ring
--------
Item Level: 70
--------
Adds 1 to 4 Physical Damage to Attacks (implicit)
--------
+31 to maximum Life
+18% to Fire Resistance
+9 to Strength
`;
const AMULET = `Item Class: Amulets
Rarity: Rare
Rune Pendant
Onyx Amulet
--------
Item Level: 85
--------
+14 to all Attributes (implicit)
--------
+1 to Level of all Skill Gems
+36% to Global Critical Strike Multiplier
+68 to maximum Life
22% increased Spell Damage
+31% to Cold Resistance
`;
const WAND = `Item Class: Wands
Rarity: Rare
Storm Song
Prophecy Wand
--------
Wand
Physical Damage: 28-52
Critical Strike Chance: 8.00%
Attacks per Second: 1.50
--------
Item Level: 84
--------
36% increased Spell Damage (implicit)
--------
+1 to Level of all Spell Skill Gems
+1 to Level of all Lightning Spell Skill Gems
94% increased Spell Damage
22% increased Cast Speed
+25% to Global Critical Strike Multiplier
`;
const BOW = `Item Class: Bows
Rarity: Rare
Dread Thirst
Thicket Bow
--------
Bow
Quality: +20% (augmented)
Physical Damage: 115-312 (augmented)
Elemental Damage: 12-210 (augmented)
Critical Strike Chance: 6.50% (augmented)
Attacks per Second: 1.73 (augmented)
--------
Sockets: G-G-G-G-G-G
--------
Item Level: 83
--------
+1 to Level of Socketed Bow Gems
155% increased Physical Damage
Adds 12 to 24 Physical Damage
Adds 12 to 210 Lightning Damage
15% increased Attack Speed
+28% to Global Critical Strike Multiplier (fractured)
--------
Fractured Item
`;
const JEWEL = `Item Class: Jewels
Rarity: Rare
Vortex Bliss
Cobalt Jewel
--------
Item Level: 84
--------
7% increased maximum Life
+16% to Global Critical Strike Multiplier
+12% to Critical Strike Multiplier with Fire Skills
14% increased Spell Damage
`;
const CLUSTER = `Item Class: Jewels
Rarity: Rare
Blight Shard
Large Cluster Jewel
--------
Item Level: 84
--------
Adds 8 Passive Skills (enchant)
2 Added Passive Skills are Jewel Sockets (enchant)
Added Small Passive Skills grant: 12% increased Physical Damage (enchant)
--------
1 Added Passive Skill is Battle-Hardened
Added Small Passive Skills also grant: +6 to Maximum Life
`;
const EVERY = { CHEST, ES_CHEST, RING, AMULET, WAND, BOW, JEWEL };

const group = (body, type) => body.query.stats.filter((g) => g.type === type);
const idsIn = (g) => g.filters.map((f) => f.id);

test('value table: every stat is one the trade site knows, on a kind of item it is listed for', () => {
  const ids = new Set();
  for (const p of PROFILES) {
    assert.ok(p.id && p.name && p.slots.length, `profile ${p.id}`);
    assert.ok(!ids.has(p.id), `two profiles are called ${p.id}`);
    ids.add(p.id);
    for (const s of p.stats) {
      const what = `${p.id}: ${s.t || s.m}`;
      assert.ok(s.w > 0 && s.as, `${what} needs points and a name`);
      assert.ok(!!s.t !== !!s.m, `${what} is a total or a modifier, not both`);
      const slots = s.on || p.slots;
      for (const slot of slots) assert.ok(p.slots.includes(slot), `${what} is for ${slot}, which the profile is not`);
      const known = slots.some((c) => (s.t ? index.pseudo(s.t) : KINDS.some((k) => { const f = index.match(s.m, k, c); return f && !f.pseudo; })));
      assert.ok(known, `${what} is not in the trade site's stat list`);
    }
    if (p.prop) for (const slot of p.slots) assert.ok(BENCH[p.prop.key][slot] > 0, `${p.id}: no usual value for a ${slot}`);
    if (p.need) assert.ok(p.stats.some((s) => s.as === p.need.as), `${p.id}: needs ${p.need.as}, which it does not weigh`);
  }
  // what a total is made of must be modifiers the stat list knows
  for (const [total, parts] of Object.entries(TOTALS)) {
    assert.ok(index.pseudo(total), `${total} is not a total on the trade site`);
    for (const ref of Object.keys(parts)) assert.ok(index.byRef.has(ref), `${total}: no modifier "${ref}"`);
  }
});

test('a rare is scored for the buyer it is worth most to, and says what carries it', () => {
  const p = plan(CHEST);
  assert.equal(p.ok, true);
  assert.equal(p.kind, 'score');
  assert.equal(p.profile.id, 'life');
  assert.equal(p.score, 316); // 124 life + 82 resistance + 22 x 5 suppression
  assert.deepEqual(p.parts.map((x) => x.as), ['life', 'spell suppression', 'resistances']);
  assert.equal(p.parts.reduce((n, x) => n + x.share, 0), 100);
  assert.deepEqual(p.fits, ['life builds']);
  assert.equal(p.worth, true);
  // an amulet with +1 to all skills is as good for attacks as for spells: both are named
  const a = plan(AMULET);
  assert.equal(a.profile.id, 'spell');
  assert.deepEqual(a.fits, ['spell builds', 'attack builds']);
  assert.equal(a.parts[0].as, '+ skill gems');
  // the implicit counts towards a total, as on the trade site
  const w = plan(WAND);
  assert.equal(w.profile.id, 'caster');
  assert.equal(Math.round(w.scored.entries.find((e) => e.stat.t === '#% increased Spell Damage').value), 130);
});

test('the search: the selling point asked for outright, and its other strong stats all needed at first', () => {
  const p = plan(CHEST);
  const body = p.body(0);
  assert.deepEqual(body.sort, { price: 'asc' });
  assert.equal(body.query.status.option, 'available');
  assert.deepEqual(body.query.filters.type_filters.filters, { category: { option: 'armour.chest' }, rarity: { option: 'nonunique' } });
  assert.equal(body.query.filters.misc_filters.filters.corrupted.option, 'false');
  // the site refuses a weighted search from someone not logged in: none is ever sent
  for (let i = 0; i < p.steps; i++) for (const lean of [false, true]) assert.deepEqual(p.body(i, { lean }).query.stats.filter((g) => g.type !== 'and' && g.type !== 'count'), []);
  const [point, near] = group(body, 'count');
  // 22% suppression is what this chest is bought for: at least nine tenths of it, however it got on the item
  assert.equal(point.value.min, 1);
  assert.deepEqual(idsIn(point), ['explicit.stat_3680664274', 'fractured.stat_3680664274', 'crafted.stat_3680664274']);
  assert.ok(point.filters.every((f) => f.value.min === 19));
  // what else carries its score, each at nine tenths: both needed in the first step
  assert.deepEqual(near.filters, [{ id: 'pseudo.pseudo_total_life', value: { min: 111 } }, { id: 'pseudo.pseudo_total_elemental_resistance', value: { min: 73 } }]);
  assert.equal(near.value.min, 2);
  // sellers who are offline too, when the window's chip says so
  assert.equal(p.body(0, { offline: true }).query.status.option, 'any');
});

test('the search widens step by step: less of each stat, one may be missing, then the selling point is no longer a must', () => {
  const p = plan(CHEST);
  assert.equal(p.steps, STEPS.length);
  const [point1, near1] = group(p.body(1), 'count');
  assert.equal(point1.filters[0].value.min, 16); // three quarters of 22
  assert.deepEqual([near1.value.min, near1.filters.map((f) => f.value.min)], [1, [93, 61]]); // one of the two is enough
  const last = group(p.body(2), 'count');
  assert.equal(last.length, 1); // suppression is now one of its strong stats like the others
  assert.ok(idsIn(last[0]).includes('explicit.stat_3680664274') && idsIn(last[0]).includes('pseudo.pseudo_total_life'));
  // a ring's four strong stats: all, then all but one, then all but two
  const r = plan(RING);
  assert.deepEqual([0, 1].map((i) => group(r.body(i), 'count')[0].value.min), [3, 2]);
  assert.equal(group(r.body(2), 'count')[0].value.min, 2); // of four: the attack damage has joined them
  // what the item is stays in every step: its influence
  for (const i of [0, 1, 2]) assert.ok(idsIn(group(r.body(i), 'and')[0]).includes('pseudo.pseudo_has_shaper_influence'), `step ${i + 1}`);
  // and a fractured modifier, with what the weapon is bought for: its damage
  const b = plan(BOW);
  assert.equal(b.profile.id, 'weapon');
  assert.ok(idsIn(group(b.body(2), 'and')[0]).some((id) => /^fractured\./.test(id)));
  assert.deepEqual([0, 1, 2].map((i) => b.body(i).query.filters.weapon_filters.filters.pdps.min), [332, 295, 258]); // of 369
});

test('energy shield gear is bought for its energy shield', () => {
  const p = plan(ES_CHEST);
  assert.equal(p.profile.id, 'es');
  assert.equal(p.body(0).query.filters.armour_filters.filters.es.min, 520); // 85% of 612
  assert.equal(p.parts[0].as, 'energy shield');
  // a chest without any is not offered to those builds
  assert.ok(!plan(CHEST).fits.includes('energy shield builds'));
});

test('a search never costs more than the trade site takes from someone not logged in', () => {
  for (const [name, text] of Object.entries(EVERY)) {
    const p = plan(text);
    assert.equal(p.ok, true, name);
    for (let i = 0; i < p.steps; i++) {
      assert.ok(costOf(p.body(i)) <= MAX_COST, `${name}, step ${i + 1}: ${costOf(p.body(i))}`);
      // the smaller form, for when the site still finds it too large
      assert.ok(costOf(p.body(i, { lean: true })) <= costOf(p.body(i)), `${name}, step ${i + 1}: the lean search is no larger`);
    }
  }
  // the cost as the live site counted it on 2026-11-26 (its answer's `complexity`)
  const stat = (id) => ({ id, value: { min: 1 } });
  const body = (stats) => ({ query: { stats, filters: { type_filters: {}, misc_filters: {} } } });
  assert.equal(costOf(body([{ type: 'and', filters: [stat('a')] }])), 11);
  assert.equal(costOf(body([{ type: 'count', filters: [stat('a'), stat('b'), stat('c')] }])), 22);
  assert.equal(costOf(body([{ type: 'and', filters: [stat('a'), stat('b')] }, { type: 'count', filters: Array.from({ length: 8 }, (_, i) => stat(i)) }, { type: 'count', filters: Array.from({ length: 6 }, (_, i) => stat(i)) }])), 46);
});

// Three of the trade site's own results for boots with movement speed and resistances, as it
// sent them on 2026-11-26: each modifier an object, a crafted one in the explicit list.
const LIVE_BOOTS = require('./fixtures/trade-boots.json');
const BOOTS = `Item Class: Boots
Rarity: Rare
Dread Spur
Two-Toned Boots
--------
Armour: 126
Evasion Rating: 126
--------
Requirements:
Level: 70
Str: 62
Dex: 62
--------
Sockets: R-G-G-R 
--------
Item Level: 84
--------
+12% to Fire and Cold Resistances (implicit)
--------
+45% to Fire Resistance
+42% to Cold Resistance
+38% to Lightning Resistance
30% increased Movement Speed
+38 to Dexterity
`;

test('listed items are scored like the item itself, from what the trade site sends', () => {
  const p = plan(BOOTS);
  assert.equal(p.score, 265);
  // every modifier is read, and a crafted one is known as crafted
  const lines = LIVE_BOOTS.map((l) => listingLines(l.item, index, 'Boots'));
  assert.deepEqual(lines.map((l) => l.length), [7, 9, 6]);
  assert.ok(lines.every((l) => l.every((x) => x.ref && x.value !== null)));
  assert.deepEqual(lines[0].find((x) => x.ref === '+#% to Fire Resistance'), { ref: '+#% to Fire Resistance', value: 29, type: 'crafted' });
  assert.ok(lines[1].some((x) => x.ref === '+#% to Item Rarity' && x.value === 17)); // "[PlayerItemRarity|Item Rarity]" as the site writes it
  // 120 resistance and 30 speed; 109 and 30; 102, 30 and 49 life (life counts for these buyers)
  assert.deepEqual(LIVE_BOOTS.map((l) => scoreListing(p, l.item, index)), [225, 233, 285]);
  // plain lines of text, as the site used to send them, read the same
  const plain = { explicitMods: ['+48% to Cold Resistance', '+43% to Lightning Resistance', '30% increased Movement Speed'], craftedMods: ['+29% to Fire Resistance'] };
  assert.equal(scoreListing(p, plain, index), 225);
  assert.equal(scoreListing(p, {}, index), 0);
});

test('nothing buyers look for: no search of its own', () => {
  const p = plan(JUNK);
  assert.equal(p.ok, true);
  assert.equal(p.worth, false);
  assert.equal(p.steps, 0);
  assert.deepEqual(p.fits, []);
  assert.match(advanced.describe(p), /under the least worth searching for/);
});

test('a top-tier modifier the table gives nothing for is named, not passed over', () => {
  const p = plan(CHEST);
  assert.deepEqual(p.unknown, []); // tier 1 life and suppression are both weighed
  const odd = plan(CHEST.replace('{ Suffix Modifier "of the Lightning" (Tier: 3) — Elemental, Lightning, Resistance }\n+38(36-41)% to Lightning Resistance', '{ Suffix Modifier "of Nullification" (Tier: 1) — Chaos }\n+15(13-15)% chance to Avoid Elemental Ailments'));
  assert.deepEqual(odd.unknown, ['+15% chance to Avoid Elemental Ailments']);
});

test('what has no search of its own: uniques, magic items, kinds without a table; a cluster jewel is searched exactly', () => {
  assert.equal(plan(CHEST.replace('Rarity: Rare', 'Rarity: Magic')).ok, false);
  assert.equal(plan('Item Class: Belts\nRarity: Unique\nHeadhunter\nLeather Belt\n--------\nItem Level: 84\n--------\n+40 to maximum Life (implicit)\n--------\n+60 to Strength\n').ok, false);
  assert.equal(plan('Item Class: Utility Flasks\nRarity: Rare\nX Y\nQuicksilver Flask\n--------\nItem Level: 84\n--------\n25% increased Charge Recovery\n').ok, false);
  const c = plan(CLUSTER);
  assert.deepEqual([c.ok, c.kind, c.steps], [true, 'exact', 1]);
  const passives = c.body(0).query.stats.flatMap((g) => g.filters).find((f) => f.value && f.value.min === 8);
  assert.deepEqual(passives.value, { min: 8, max: 8 }); // eight passives, not "eight or more"
  assert.equal(c.body(0).query.filters.type_filters.filters.category.option, 'jewel.cluster');
});

test('the lowest value asked for keeps whole numbers whole and never asks for nothing', () => {
  assert.equal(lowest(22, 0.9), 19);
  assert.equal(lowest(1, 0.9), 1);  // +1 to gems stays +1
  assert.equal(lowest(2, 0.75), 1);
  assert.equal(lowest(11.5, 0.9), 10.4);
});

// ---- its own ticks (ticks.js) ----
const { buildFilters, buildQuery } = require('../src/core/tradeQuery');
const { rungs, applyRung, classOf, probeLines, withoutLine, judgeLines, dropRung } = require('../src/core/advanced/ticks');
// The owner's gloves of 2026-11-26: 5 chaos by the usual ticks, about 30 divine with every real
// modifier ticked (9 listed). What he ticked by hand is what the advanced check must tick.
const GLOVES = `Item Class: Gloves
Rarity: Rare
Morbid Hold
Assassin's Mitts
--------
Quality: +20% (augmented)
Evasion Rating: 127 (augmented)
Energy Shield: 26 (augmented)
--------
Requirements:
Level: 58
Dex: 45
Int: 45
--------
Sockets: G-B-G-B 
--------
Item Level: 85
--------
{ Searing Exarch Implicit Modifier (Lesser) }
Freezes you inflict spread to other Enemies within 1.1 metres (implicit)
{ Eater of Worlds Implicit Modifier (Lesser) }
Projectiles Pierce an additional Target (implicit)
--------
{ Fractured Prefix Modifier "Frost-touched" (Tier: 1) — Physical Damage, Elemental Damage, Cold }
30(28-30)% of Physical Damage Converted to Cold Damage (fractured)
{ Prefix Modifier "Pirate's" (Tier: 2) }
+9(8-12)% to Item Rarity
{ Master Crafted Prefix Modifier "Upgraded" — Physical Damage, Elemental Damage, Lightning }
25(21-25)% of Physical Damage Converted to Lightning Damage (crafted)
{ Suffix Modifier "of the Maelstrom" (Tier: 6) — Elemental, Lightning, Resistance }
+40(36-41)% to Lightning Resistance
{ Suffix Modifier "of Bameth" (Tier: 2) — Chaos, Resistance }
+27(26-30)% to Chaos Resistance
{ Suffix Modifier "of Recovery" (Tier: 3) }
14(14-16)% increased Stun and Block Recovery
--------
Fractured Item
`;

test('its own ticks: every real modifier first, then the strong ones, then the usual', () => {
  const f = buildFilters(parseItemText(GLOVES), index);
  const r = rungs(f);
  assert.deepEqual(r.map((x) => [x.id, x.lines]), [['all', 7], ['strong', 4], ['usual', 2]]);
  const texts = (rung) => f.stats.filter((s) => rung.ticks[s.key]).map((s) => s.text.replace(/^\+?\d+% (of |to |total )?/, ''));
  // what the owner ticked by hand: the implicits and the crafted modifier too; stun recovery is nobody's reason to buy
  assert.deepEqual(texts(r[0]), ['Elemental Resistance', 'Freezes you inflict spread to other Enemies within 1.1 metres', 'Projectiles Pierce an additional Target', 'Physical Damage Converted to Cold Damage', 'Item Rarity', 'Physical Damage Converted to Lightning Damage', 'Chaos Resistance']);
  // fractured, tier 2 and what the standard check ticks; not the implicits or the crafted one, which a buyer can add himself
  assert.deepEqual(texts(r[1]), ['Elemental Resistance', 'Physical Damage Converted to Cold Damage', 'Item Rarity', 'Chaos Resistance']);
  assert.deepEqual(texts(r[2]), ['Elemental Resistance', 'Physical Damage Converted to Cold Damage']);
  // the first search, as the live trade site took it on 2026-11-26: 9 listed, from 25 divine (the usual ticks: 759, from 5 chaos)
  const all = applyRung(f, r[0]);
  assert.deepEqual(buildQuery(all).query.stats, [{ type: 'and', filters: [
    { id: 'pseudo.pseudo_total_elemental_resistance', value: { min: 36 } }, { id: 'implicit.stat_1623640288', value: { min: 1 } }, { id: 'implicit.stat_2067062068', value: { min: 1 } },
    { id: 'fractured.stat_2133341901', value: { min: 27 } }, { id: 'explicit.stat_3917489142', value: { min: 8 } }, { id: 'crafted.stat_3240769289', value: { min: 23 } }, { id: 'explicit.stat_2923486259', value: { min: 24 } },
  ] }]);
  assert.ok(costOf(buildQuery(all)) <= MAX_COST);
  // only the ticks change
  assert.deepEqual([all.flags, all.category, all.props, all.stats.map((s) => s.min)], [f.flags, f.category, f.props, f.stats.map((s) => s.min)]);
  assert.equal(f.stats.find((s) => /Item Rarity/.test(s.text)).enabled, false); // the filters handed in are left as they were
});

test('its own ticks: what is never ticked, and what it is not for', () => {
  const line = (text, more = {}) => ({ key: 'stat:0', text, kind: 'explicit', enabled: false, tiers: [1], ...more });
  for (const junk of ['17% increased Stun and Block Recovery', 'Reflects 22 Physical Damage to Melee Attackers', '15% increased Light Radius', 'Gain 14 Life per Enemy Killed', '18% reduced Attribute Requirements']) assert.equal(classOf(line(junk), false), 'junk', junk);
  // a chest's own evasion is one of the window's number lines already; on a ring energy shield is a modifier like any other
  assert.equal(classOf(line('+225 to Evasion Rating'), true), 'junk');
  assert.equal(classOf(line('105% increased Evasion and Energy Shield'), true), 'junk');
  assert.equal(classOf(line('+44 to maximum Energy Shield'), false), 'strong');
  assert.equal(classOf(line('+44 to maximum Energy Shield', { tiers: [4] }), false), 'weak');
  assert.equal(classOf(line('+31% to Cold Resistance', { kind: 'crafted', tiers: [] }), false), 'weak');
  assert.equal(classOf(line('+12% to Fire Resistance', { kind: 'fractured', tiers: [7] }), false), 'strong');
  assert.equal(classOf(line('Shaper influence', { key: 'influence:Shaper', kind: 'pseudo', tiers: [] }), false), 'strong');
  // a plain copy names no tiers: nothing is taken for strong that is not known to be
  assert.equal(classOf(line('+70 to maximum Mana', { tiers: [] }), false), 'weak');
  // uniques, gems and cluster jewels keep the ticks they have; so does an item with nothing more to tick
  const unique = buildFilters(parseItemText('Item Class: Rings\nRarity: Unique\nKaom\'s Sign\nCoral Ring\n--------\nItem Level: 70\n--------\n+25 to maximum Life (implicit)\n--------\n+18 to Strength\n'), index);
  assert.deepEqual(rungs(unique), []);
  assert.deepEqual(rungs(buildFilters(parseItemText(CLUSTER), index)), []);
  assert.deepEqual(rungs({ ok: false }), []);
  const bare = buildFilters(parseItemText('Item Class: Rings\nRarity: Rare\nA B\nCoral Ring\n--------\nItem Level: 70\n--------\n+62 to maximum Life\n+30% to Fire Resistance\n'), index);
  assert.deepEqual(rungs(bare), []); // life and resistance are the usual ticks already
  // the test chest has no weak lines: two sets, each given once, the usual ticks last
  const chest = rungs(buildFilters(parseItemText(CHEST), index));
  assert.deepEqual(chest.map((x) => x.id), ['strong', 'usual']);
  assert.ok(chest[0].lines > chest[1].lines);
});

test('too few with every line: each is tried by itself, and the one that matters least is dropped', () => {
  const f = buildFilters(parseItemText(GLOVES), index);
  const r = rungs(f);
  const all = applyRung(f, r[0]);
  // what may go: not the usual ticks, not the fractured modifier; what a buyer can add himself first
  const lines = probeLines(all, r[0], r[r.length - 1]);
  assert.deepEqual(lines.map((l) => l.text.replace(/^\+?\d+% (of |to )?/, '')), ['Freezes you inflict spread to other Enemies within 1.1 metres', 'Projectiles Pierce an additional Target', 'Physical Damage Converted to Lightning Damage', 'Item Rarity', 'Chaos Resistance']);
  // one search each, with that line unticked and nothing else changed
  const one = withoutLine(all, lines[1].key);
  assert.deepEqual(one.stats.filter((s) => s.enabled).length, 6);
  assert.equal(one.stats.find((s) => s.key === lines[1].key).enabled, false);
  assert.equal(all.stats.find((s) => s.key === lines[1].key).enabled, true);
  // without Item Rarity there are hundreds from 5c (it carries the price); without the pierce implicit a dozen from 3,900c
  const tried = [
    { key: 'stat:3', text: '+9% to Item Rarity', total: 759, low: 5 },
    { key: 'stat:1', text: 'Projectiles Pierce an additional Target', total: 12, low: 3900 },
    { key: 'stat:5', text: '+27% to Chaos Resistance', total: 31, low: 1800 },
    { key: 'stat:0', text: 'Freezes you inflict spread', total: 2, low: 9000 }, // two listings are no evidence
    { key: 'stat:4', text: '25% converted to Lightning', total: 0, low: null },
  ];
  assert.equal(judgeLines(tried).key, 'stat:1');
  // nearly as dear with twice as many listed is the better evidence
  assert.equal(judgeLines([{ key: 'a', total: 3, low: 4000 }, { key: 'b', total: 9, low: 3300 }, { key: 'c', total: 40, low: 900 }]).key, 'b');
  // the owner's boots, as the live site answered on 2026-11-26: all four strong lines 2 listed at 2 divine;
  // without Item Rarity 20 from 1 divine, without Chaos Resistance 271 from 3 chaos: rarity is the one to let go
  assert.equal(judgeLines([{ key: 'rarity', total: 20, low: 164 }, { key: 'chaos', total: 271, low: 3 }]).key, 'rarity');
  assert.equal(judgeLines([{ key: 'a', total: 2, low: 4000 }, { key: 'b', total: 0, low: null }]), null);
  assert.equal(judgeLines([]), null);
  // the set of ticks that follows: all but that one line
  const most = dropRung(r[0], tried[1]);
  assert.deepEqual([most.id, most.lines, most.dropped, most.ticks['stat:1'], most.ticks['stat:3']], ['most', 6, 'Projectiles Pierce an additional Target', false, true]);
  assert.equal(r[0].ticks['stat:1'], true); // the set it came from is left as it was
});

const NOW = 1_800_000_000_000;
const listed = (chaos, days, extra = {}) => ({ chaos, listedAt: NOW - days * DAY, ...extra });

test('range from listings: fresh ones count most, bait counts for nothing', () => {
  const e = estimate({ now: NOW, total: 46, listings: [listed(2, 0.1, { bait: true }), listed(30, 0.2), listed(32, 0.1), listed(35, 0.5), listed(36, 0.3), listed(40, 0.4), listed(45, 0.2), listed(50, 0.6), listed(60, 0.1), listed(70, 0.2)] });
  assert.deepEqual([e.low, e.typical, e.high], [30, 35, 40]); // the cheap end: about the cheapest, a third of the way up, the middle
  assert.equal(e.sure, 'sure');
  assert.equal(e.speed, 'fast');
  assert.deepEqual([e.seen, e.fresh, e.total], [9, 9, 46]);
  assert.match(e.why.join('; '), /46 like it listed; 9 of the 9 seen listed within a day/);
  // the same prices, but the cheap ones have sat for ten days: they pull less, and it sells slowly
  const old = estimate({ now: NOW, total: 46, listings: [listed(30, 10), listed(32, 10), listed(35, 10), listed(36, 10), listed(40, 10), listed(45, 0.2), listed(50, 0.6), listed(60, 0.1), listed(70, 0.2)] });
  assert.ok(old.low > e.low && old.typical > e.typical, `${old.low} ${old.typical}`);
  assert.equal(old.speed, 'slow');
  assert.equal(old.high, old.typical); // the upper end is not being paid
  assert.equal(old.sure, 'fair');
});

test('an instant buyout that has stood for a day caps the price; hundreds listed is not "sells fast"', () => {
  // anyone could have bought the 40c one at any hour for three days, and nobody did
  const stood = estimate({ now: NOW, total: 30, listings: [listed(30, 0.2), listed(35, 0.3), listed(40, 3, { status: 'instant' }), listed(60, 0.1), listed(80, 0.2), listed(90, 0.1), listed(95, 0.1)] });
  assert.deepEqual(stood.capped, { chaos: 40, days: 3 });
  assert.ok(stood.high <= 40 && stood.typical <= 40);
  assert.match(stood.why.join('; '), /an instant buyout has stood unsold for 3 days/);
  assert.notEqual(stood.sure, 'sure');
  assert.notEqual(stood.speed, 'fast');
  // a fresh instant buyout says nothing yet
  assert.equal(estimate({ now: NOW, total: 30, listings: [listed(30, 0.2, { status: 'instant' }), listed(35, 0.3), listed(40, 0.1), listed(60, 0.1), listed(80, 0.2), listed(90, 0.1)] }).capped, null);
  // 759 listed and the cheapest are young: new ones keep coming, which is not the same as selling
  const ten = Array.from({ length: 10 }, (_, i) => listed(5 + i, 0.3));
  const crowd = estimate({ now: NOW, total: 759, listings: ten });
  assert.equal(crowd.speed, 'crowded');
  assert.equal(crowd.high, crowd.typical); // the upper end is not being paid
  assert.equal(estimate({ now: NOW, total: 80, listings: ten }).speed, 'fast');
});

test('how sure: few listings, a widened search and prices far apart are all said', () => {
  const few = estimate({ now: NOW, total: 2, listings: [listed(100, 1), listed(300, 2)] });
  assert.equal(few.sure, 'guess');
  assert.match(few.why.join('; '), /only 2 listed/);
  assert.equal(few.speed, null); // two listings say nothing about how fast
  const ten = Array.from({ length: 10 }, (_, i) => listed(20 + i, 0.5));
  assert.equal(estimate({ now: NOW, total: 80, listings: ten, step: 0 }).sure, 'sure');
  assert.equal(estimate({ now: NOW, total: 80, listings: ten, step: 1 }).sure, 'fair');
  const wide = estimate({ now: NOW, total: 80, listings: ten, step: 2 });
  assert.equal(wide.sure, 'guess');
  assert.match(wide.why.join('; '), /weaker items were compared/);
  assert.equal(estimate({ now: NOW, total: 80, listings: [listed(5, 0.1), listed(6, 0.1), listed(8, 0.1), listed(30, 0.1), listed(40, 0.1), listed(90, 0.1)] }).sure, 'fair');
  // nothing with a price: no estimate at all
  assert.equal(estimate({ now: NOW, total: 5, listings: [{ chaos: null, listedAt: NOW }] }), null);
  assert.equal(estimate({ now: NOW, total: 0, listings: [] }), null);
});

test('base value: poe.ninja prices a base by item level and influence', () => {
  const table = { 'Vaal Regalia (ilvl 86)': 12, 'Vaal Regalia (ilvl 84)': 4, 'Two-Stone Ring (ilvl 84, Shaper)': 55, 'Opal Ring (ilvl 85, Hunter/Warlord)': 300 };
  const get = (name) => (table[name] ? { chaos: table[name] } : null);
  assert.deepEqual(advanced.baseValue(parseItemText(ES_CHEST), get), { chaos: 12, what: 'Vaal Regalia, item level 86' });
  assert.deepEqual(advanced.baseValue(parseItemText(ES_CHEST.replace('Item Level: 86', 'Item Level: 85')), get), { chaos: 4, what: 'Vaal Regalia, item level 84' });
  assert.deepEqual(advanced.baseValue(parseItemText(RING), get), { chaos: 55, what: 'Two-Stone Ring, item level 84, Shaper' });
  assert.equal(advanced.baseValue(parseItemText(JUNK), get), null); // item level 70: no price for it
  assert.equal(advanced.baseValue(parseItemText(BOW), get), null);  // fractured: priced by the standard check's Base item search
  const two = parseItemText('Item Class: Rings\nRarity: Rare\nA B\nOpal Ring\n--------\nItem Level: 86\n--------\n+20 to maximum Life\n--------\nWarlord Item\nHunter Item\n');
  assert.deepEqual(advanced.baseValue(two, get), { chaos: 300, what: 'Opal Ring, item level 85, Hunter and Warlord' });
});

test('the outcome in a few words, for Under the hood', () => {
  assert.equal(advanced.describe(plan(CHEST)), 'life builds, 316 points, asks for spell suppression 19+, looks for life, spell suppression, resistances');
  assert.equal(advanced.outcome({ state: 'done', source: 'score', step: 1, total: 46, seen: 6, looked: 20, low: 30, high: 45.25, sure: 'fair', speed: 'fast' }), '30 to 45.3 chaos, fair, sells fast, from its own search (step 2 of 3, 6 of the 20 looked at count, 46 like it)');
  assert.equal(advanced.outcome({ state: 'none', why: 'nothing listed' }), 'none: nothing listed');
  assert.equal(advanced.outcome({ state: 'done', source: 'near', near: { id: 'all', lines: 7 }, total: 9, low: 4100, high: 6560, sure: 'fair', speed: 'fast' }), '4100 to 6560 chaos, fair, sells fast, from the 9 listed with all 7 of its lines');
  assert.equal(advanced.outcome({ state: 'done', source: 'near', near: { id: 'most', lines: 6, dropped: 'Projectiles Pierce an additional Target' }, total: 12, low: 3900, high: 5000, sure: 'fair', speed: 'fast' }), '3900 to 5000 chaos, fair, sells fast, from the 12 listed with 6 (all but "Projectiles Pierce an additional Target") of its lines');
  assert.match(advanced.outcome({ state: 'done', source: 'standard', total: 759, low: 5, high: 5, sure: 'fair', speed: 'crowded' }), /fair, many listed, from the usual search \(759 found\)/);
});

// ---- sending the searches (run.js), against a stand-in for the trade client ----
const { run } = require('../src/core/advanced/run');
const { markBait } = require('../src/core/tradeQuery');

// totals: how many each search in turn finds. Every result is listed at 10c more than the one
// before. points: what result number n scores (the chest itself scores 316).
function fakeSite({ totals, waits = [], busyFor = 0, fail = null } = {}) {
  const site = { busy: false, searches: [], fetched: [], slept: 0, asked: 0 };
  let busyLeft = busyFor;
  site.sleep = async (ms) => { site.slept += ms; if (busyLeft > 0) { busyLeft -= ms; if (busyLeft <= 0) site.busy = false; } };
  site.busy = busyFor > 0;
  site.waitMs = () => (waits.length ? waits.shift() : 0);
  site.search = async (league, body) => {
    if (fail) { const e = fail(site.searches.length, body); if (e) { site.searches.push(body); throw e; } }
    const total = totals[Math.min(site.searches.length, totals.length - 1)];
    site.searches.push(body);
    return { queryId: `q${site.searches.length}`, total, ids: Array.from({ length: Math.min(100, total) }, (_, i) => `id${i}`) };
  };
  site.fetchItems = async (ids, queryId) => { site.fetched.push({ ids, queryId }); return ids.map((id) => ({ id, n: Number(id.slice(2)), chaos: 20 + Number(id.slice(2)) * 10, listedAt: NOW - DAY / 2 })); };
  return site;
}
const go = (site, more = {}) => run({ plan: plan(CHEST), league: 'Test', client: site, read: (raw) => markBait(raw), score: () => 316, sleep: site.sleep, now: () => NOW, ...more });

test('sending: enough listed at the first step is one search and its ten cheapest results', async () => {
  const site = fakeSite({ totals: [46] });
  const r = await go(site);
  assert.deepEqual([r.state, r.step, r.total, r.queryId, r.sent, r.looked], ['done', 0, 46, 'q1', 2, 10]);
  assert.equal(site.searches.length, 1);
  assert.deepEqual(site.fetched[0].ids, ['id0', 'id1', 'id2', 'id3', 'id4', 'id5', 'id6', 'id7', 'id8', 'id9']);
  assert.equal(r.est.sure, 'sure');
  assert.match(r.est.why[0], /^about 46 like it listed$/); // worked out from those looked at, so "about"
  assert.ok(r.est.low < r.est.high);
});

test('sending: results are scored here, and reading goes on until enough of them are worth as much', async () => {
  // every other result is junk (cheap items that have the stats asked for and little else)
  const half = fakeSite({ totals: [200] });
  const r = await go(half, { score: (l) => (l.n % 2 ? 316 : 120) });
  assert.deepEqual([r.state, r.step, half.fetched.length, r.looked, r.sent], ['done', 0, 2, 20, 3]); // 5 of the first ten, so ten more
  assert.ok(r.est.seen >= 8 && r.est.seen <= 10, `${r.est.seen}`); // the ten that count, less any priced as bait
  assert.equal(r.total, 100); // half of the 200 found
  assert.ok([r.est.low, r.est.typical, r.est.high].every((c) => c % 20 === 10)); // junk (20c, 40c, 60c...) is not what it is compared with
  // at most thirty are read; with only two that reach the first step's score, weaker ones count too, and that is said
  const thin = fakeSite({ totals: [200] });
  const t = await go(thin, { score: (l) => (l.n === 4 || l.n === 25 ? 316 : l.n % 3 === 0 ? 260 : 100) });
  assert.deepEqual([t.state, thin.fetched.length, t.looked, t.step], ['done', 3, 30, 1]); // 260 is over 80% of 316
  assert.ok(t.est.seen >= 9 && t.est.seen <= 12, `${t.est.seen}`);
  assert.notEqual(t.est.sure, 'sure');
  // nothing read is worth nearly as much: no price, and it says why
  const junk = fakeSite({ totals: [200] });
  const j = await go(junk, { score: () => 90 });
  assert.deepEqual([j.state, j.looked, j.total], ['none', 30, 0]);
  assert.match(j.why, /None of the 30 cheapest with stats like it is worth as much/);
  // every result read: the number like it is counted, not worked out
  const few = fakeSite({ totals: [9] });
  const f = await go(few, { score: (l) => (l.n < 7 ? 316 : 50) });
  assert.deepEqual([f.state, f.total, f.looked], ['done', 7, 9]);
  assert.ok(!/about/.test(f.est.why.join()));
  // a cluster jewel's exact search is not scored: its ten cheapest count as they are
  const exact = fakeSite({ totals: [40] });
  const e = await go(exact, { plan: plan(CLUSTER), score: null });
  assert.deepEqual([e.state, e.total, e.looked, exact.fetched.length], ['done', 40, 10, 1]);
});

test('sending: few listed widens the search, and says how far it had to go', async () => {
  const site = fakeSite({ totals: [2, 5, 30] });
  const r = await go(site);
  assert.deepEqual([r.state, r.step, site.searches.length, site.fetched.length, r.sent], ['done', 2, 3, 1, 4]);
  assert.equal(r.est.sure, 'guess'); // weaker items were compared
  // each step asks for less of its strong stats
  const least = site.searches.map((b) => Math.min(...b.query.stats[b.query.stats.length - 1].filters.map((f) => f.value.min)));
  assert.ok(least[0] > least[1] && least[1] > least[2], `${least}`);
  // still too few at the widest: the step that found most is read, not the last one
  const thin = fakeSite({ totals: [1, 6, 3] });
  const t = await go(thin);
  assert.deepEqual([t.state, t.step, t.total, thin.fetched[0].queryId], ['done', 1, 6, 'q2']);
  // nothing anywhere: said so, and no results are asked for
  const none = fakeSite({ totals: [0] });
  const n = await go(none);
  assert.deepEqual([n.state, n.total, none.searches.length, none.fetched.length], ['none', 0, 3, 0]);
  assert.match(n.why, /Nothing like it is listed/);
});

test('sending: an answer is kept for a minute, and offline sellers are a search of their own', async () => {
  const site = fakeSite({ totals: [46] });
  const kept = new Map();
  await go(site, { kept });
  const again = await go(site, { kept });
  assert.deepEqual([again.state, again.sent, site.searches.length, site.fetched.length], ['done', 0, 1, 1]);
  await go(site, { kept, now: () => NOW + 61000 });
  assert.equal(site.searches.length, 2);
  await go(site, { kept, offline: true, now: () => NOW + 61000 });
  assert.equal(site.searches.length, 3);
  assert.equal(site.searches[2].query.status.option, 'any');
});

test('sending: every request waits its turn, and a long pause is not waited out', async () => {
  // the site wants 3 s before the search: waited, then sent
  const site = fakeSite({ totals: [46], waits: [3000] });
  const waits = [];
  const r = await go(site, { waited: (ms) => waits.push(ms) });
  assert.equal(r.state, 'done');
  assert.deepEqual(waits, [3000]);
  assert.ok(site.slept >= 3000);
  // another search is out (a bench craft's): waited for
  const busy = fakeSite({ totals: [46], busyFor: 500 });
  assert.equal((await go(busy)).state, 'done');
  assert.ok(busy.slept >= 500);
  // a pause of a minute: said as "later", nothing sent
  const long = fakeSite({ totals: [46], waits: [60000] });
  await assert.rejects(go(long), (e) => e.later === true && /pause of 60 s/.test(e.message));
  assert.equal(long.searches.length, 0);
  // somebody got in between: tried again
  let first = true;
  const raced = fakeSite({ totals: [46], fail: () => { if (first) { first = false; return new Error('A search is already running.'); } return null; } });
  const counts = [];
  assert.equal((await go(raced, { count: (c) => counts.push(c) })).state, 'done');
  assert.match(counts.join(), /waited again/);
});

test('sending: a search the site finds too large goes again in its smaller form; other refusals are passed on', async () => {
  const site = fakeSite({ totals: [46], fail: (n) => (n === 0 ? new Error('The trade site said: Query is too complex.') : null) });
  const counts = [];
  const r = await go(site, { count: (c) => counts.push(c) });
  assert.equal(r.state, 'done');
  assert.equal(site.searches.length, 2);
  assert.ok(costOf(site.searches[1]) < costOf(site.searches[0]), 'the second try is a smaller search');
  assert.match(counts.join(), /smaller form/);
  const bad = fakeSite({ totals: [46], fail: () => new Error('The trade site said: Invalid query') });
  await assert.rejects(go(bad), /Invalid query/);
});

test('sending: another item checked meanwhile leaves the search where it is', async () => {
  const site = fakeSite({ totals: [46] });
  let stale = false;
  const fetchItems = site.fetchItems;
  site.search = ((search) => async (...a) => { const r = await search(...a); stale = true; return r; })(site.search);
  const r = await go(site, { stale: () => stale });
  assert.deepEqual([r.left, site.fetched.length], [true, 0]);
  assert.equal(site.fetchItems, fetchItems);
});
