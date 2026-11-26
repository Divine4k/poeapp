'use strict';
// The advanced price check: the value table, scoring a rare, the searches it writes, and the
// range worked out from listings. No web: the searches are only looked at, never sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItemText } = require('../src/core/itemText');
const { StatIndex } = require('../src/core/tradeStats');
const advanced = require('../src/core/advanced');
const { PROFILES, TOTALS, BENCH } = require('../src/core/advanced/values');
const { KINDS, MAX_STATS, STEPS, lowest } = require('../src/core/advanced/score');
const { estimate, pickRanks, DAY } = require('../src/core/advanced/estimate');

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
// every stat a search holds, whatever group it is in
const size = (body) => body.query.stats.reduce((n, g) => n + g.filters.length, 0);

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

test('the search: the selling point asked for outright, the rest as one weighted total', () => {
  const p = plan(CHEST);
  const body = p.body(0);
  assert.deepEqual(body.sort, { price: 'asc' });
  assert.equal(body.query.status.option, 'available');
  assert.deepEqual(body.query.filters.type_filters.filters, { category: { option: 'armour.chest' }, rarity: { option: 'nonunique' } });
  assert.equal(body.query.filters.misc_filters.filters.corrupted.option, 'false');
  const [w] = group(body, 'weight');
  assert.equal(body.query.stats[0], w, 'the weighted part comes first');
  assert.equal(w.value.min, 284); // nine tenths of 316
  const by = Object.fromEntries(w.filters.map((f) => [f.id, f.value.weight]));
  assert.equal(by['pseudo.pseudo_total_life'], 1);
  assert.equal(by['pseudo.pseudo_total_elemental_resistance'], 1);
  assert.equal(by['explicit.stat_3680664274'], 5); // spell suppression as rolled
  assert.equal(by['crafted.stat_3680664274'], 5);  // and from the bench: worth the same to a buyer
  // 22% suppression is what this chest is bought for: at least nine tenths of it, however it got on the item
  const [c] = group(body, 'count');
  assert.equal(c.value.min, 1);
  assert.ok(c.filters.some((f) => f.id === 'explicit.stat_3680664274') && c.filters.some((f) => f.id === 'crafted.stat_3680664274'));
  assert.ok(c.filters.every((f) => f.value.min === 19));
  // sellers who are offline too, when the window's chip says so
  assert.equal(p.body(0, { offline: true }).query.status.option, 'any');
});

test('the search widens step by step: less of the score, less of the selling point, then none of it', () => {
  const p = plan(CHEST);
  assert.equal(p.steps, STEPS.length);
  const mins = [0, 1, 2].map((i) => group(p.body(i), 'weight')[0].value.min);
  assert.ok(mins[0] > mins[1] && mins[1] > mins[2], `${mins}`);
  assert.equal(group(p.body(1), 'count')[0].filters[0].value.min, 16); // three quarters of 22
  assert.equal(group(p.body(2), 'count').length, 0);
  // what the item is stays in every step: its influence
  const r = plan(RING);
  for (const i of [0, 1, 2]) assert.ok(group(r.body(i), 'and')[0].filters.some((f) => f.id === 'pseudo.pseudo_has_shaper_influence'), `step ${i + 1}`);
  // and a fractured modifier, with what the weapon is bought for: its damage
  const b = plan(BOW);
  assert.equal(b.profile.id, 'weapon');
  assert.ok(group(b.body(2), 'and')[0].filters.some((f) => /^fractured\./.test(f.id)));
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

test('a search never holds more stats than the trade site takes', () => {
  for (const [name, text] of Object.entries(EVERY)) {
    const p = plan(text);
    assert.equal(p.ok, true, name);
    for (let i = 0; i < p.steps; i++) assert.ok(size(p.body(i)) <= MAX_STATS + 2, `${name}, step ${i + 1}: ${size(p.body(i))} stats`);
    // the smaller form, for when the site still finds it too large: only what the item has
    if (p.steps) assert.ok(size(p.body(0, { lean: true })) < size(p.body(0)), `${name}: the lean search is smaller`);
  }
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

const NOW = 1_800_000_000_000;
const listed = (chaos, days, extra = {}) => ({ chaos, listedAt: NOW - days * DAY, ...extra });

test('range from listings: fresh ones count most, bait counts for nothing', () => {
  const e = estimate({ now: NOW, total: 46, listings: [listed(2, 0.1, { bait: true }), listed(30, 0.2), listed(32, 0.1), listed(35, 0.5), listed(36, 0.3), listed(40, 0.4), listed(45, 0.2), listed(50, 0.6), listed(60, 0.1), listed(70, 0.2)] });
  assert.deepEqual([e.low, e.typical, e.high], [35, 40, 50]);
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

test('which results are looked at: the cheapest, and a few from further up when there are plenty', () => {
  assert.deepEqual(pickRanks(100), [0, 1, 2, 3, 4, 6, 8, 11, 14, 18]);
  assert.deepEqual(pickRanks(12), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(pickRanks(3), [0, 1, 2]);
  assert.deepEqual(pickRanks(0), []);
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
  assert.match(advanced.describe(plan(CHEST)), /^life builds, 316 points, \d+ stats weighed, asks for spell suppression 19\+$/);
  assert.equal(advanced.outcome({ state: 'done', source: 'score', step: 1, total: 46, low: 30, high: 45.25, sure: 'fair', speed: 'fast' }), '30 to 45.3 chaos, fair, sells fast, from its own search (step 2 of 3, 46 found)');
  assert.equal(advanced.outcome({ state: 'none', why: 'nothing listed' }), 'none: nothing listed');
});

// ---- sending the searches (run.js), against a stand-in for the trade client ----
const { run } = require('../src/core/advanced/run');
const { markBait } = require('../src/core/tradeQuery');

// totals: how many each search in turn finds. Every result is listed at 10c more than the one before.
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
  site.fetchItems = async (ids, queryId) => { site.fetched.push({ ids, queryId }); return ids.map((id) => ({ id, chaos: 20 + Number(id.slice(2)) * 10, listedAt: NOW - DAY / 2 })); };
  return site;
}
const go = (site, more = {}) => run({ plan: plan(CHEST), league: 'Test', client: site, read: (raw) => markBait(raw), sleep: site.sleep, now: () => NOW, ...more });

test('sending: enough listed at the first step is one search and ten of its results', async () => {
  const site = fakeSite({ totals: [46] });
  const r = await go(site);
  assert.deepEqual([r.state, r.step, r.total, r.queryId, r.sent], ['done', 0, 46, 'q1', 2]);
  assert.equal(site.searches.length, 1);
  assert.deepEqual(site.fetched[0].ids, ['id0', 'id1', 'id2', 'id3', 'id4', 'id6', 'id8', 'id11', 'id14', 'id18']); // the cheapest and a few from further up
  assert.equal(r.est.sure, 'sure');
  assert.ok(r.est.low < r.est.high);
});

test('sending: few listed widens the search, and says how far it had to go', async () => {
  const site = fakeSite({ totals: [2, 5, 30] });
  const r = await go(site);
  assert.deepEqual([r.state, r.step, r.total, site.searches.length, site.fetched.length, r.sent], ['done', 2, 30, 3, 1, 4]);
  assert.equal(r.est.sure, 'guess'); // weaker items were compared
  // each step asks for less of the score
  const mins = site.searches.map((b) => b.query.stats[0].value.min);
  assert.ok(mins[0] > mins[1] && mins[1] > mins[2]);
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
  const stats = (b) => b.query.stats[0].filters.length;
  assert.ok(stats(site.searches[1]) < stats(site.searches[0]), 'the second try weighs fewer stats');
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
