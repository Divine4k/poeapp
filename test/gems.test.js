'use strict';
// Gems in the price check: read from the copied text, priced by level and quality, searched on
// the trade site by name, level, quality and corrupted or not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItemText, priceName } = require('../src/core/itemText');
const { parseItemOverview, PriceTable } = require('../src/core/prices');
const { searchable, gemType, buildFilters, applyEdits, isNarrow, buildQuery, compareSpec } = require('../src/core/tradeQuery');
const { TradeClient, readListing } = require('../src/core/tradeApi');

const GRACE = `Item Class: Skill Gems
Rarity: Gem
Grace
--------
Aura, Spell, AoE
Level: 21 (Max)
Reservation: 50% Mana
Cooldown Time: 1.20 sec
Cast Time: Instant
Quality: +23% (augmented)
--------
Requirements:
Level: 72
Dex: 159
--------
Casts an aura that grants evasion to you and your allies.
--------
+20% increased Area of Effect
You and nearby Allies gain 2045 additional Evasion Rating
--------
Place into an item socket of the right colour to gain this skill. Right click to remove from a socket.
--------
Corrupted`;

const VAAL = `Item Class: Skill Gems
Rarity: Gem
Grace
--------
Aura, Vaal, Spell, AoE, Duration
Level: 20 (Max)
Quality: +20% (augmented)
--------
Requirements:
Level: 70
Dex: 155
--------
Casts an aura that grants evasion to you and your allies.
--------
You and nearby Allies gain 1934 additional Evasion Rating
--------
Vaal Grace
--------
Souls Per Use: 50
Can Store 1 Use
--------
Casts an aura that grants you and your allies a chance to dodge.
--------
Corrupted`;

const FRESH = `Item Class: Support Gems
Rarity: Gem
Enlighten Support
--------
Support
Level: 3
--------
Requirements:
Level: 50
--------
Supports any skill gem.
--------
Experience: 1/226,854,909
--------
This is a Support Gem. It does not grant a bonus to your character, but to skills in sockets connected to it.`;

test('gems: level, quality and corruption are read; the first Level line is the gem\'s', () => {
  const g = parseItemText(GRACE);
  assert.equal(g.isGem, true);
  assert.deepEqual([g.name, g.gemLevel, g.gemMax, g.quality, g.corrupted], ['Grace', 21, true, 23, true]);
  const e = parseItemText(FRESH);
  assert.deepEqual([e.name, e.gemLevel, e.gemMax, e.quality, e.corrupted], ['Enlighten Support', 3, false, null, false]);
});

test('gems: a Vaal gem goes by its Vaal name', () => {
  const v = parseItemText(VAAL);
  assert.equal(v.name, 'Vaal Grace');
  assert.equal(priceName(v), 'Vaal Grace');
  assert.equal(v.gemLevel, 20);
});

test('gems: poe.ninja\'s price is the one for this level and quality', () => {
  const t = new PriceTable();
  t.load(parseItemOverview({ lines: [
    { name: 'Grace', chaosValue: 1, variant: '1' }, { name: 'Grace', chaosValue: 3, variant: '1/20' },
    { name: 'Grace', chaosValue: 5, variant: '20/20' }, { name: 'Grace', chaosValue: 4, variant: '20/20c' },
    { name: 'Grace', chaosValue: 60, variant: '21/20c' }, { name: 'Grace', chaosValue: 90, variant: '21/23c' },
    { name: 'Grace', chaosValue: 30, variant: '21c' },
    { name: 'Grace of Something', chaosValue: 999, variant: '21/23c' }, { name: 'Grace of Something', chaosValue: 9, variant: '1' },
  ] }, 'SkillGem'));
  const of = (...a) => { const e = t.gem('Grace', ...a); return e && e.chaos; };
  assert.equal(of(21, 23, true), 90);
  assert.equal(of(21, 20, true), 60);
  assert.equal(of(21, 5, true), 30);
  assert.equal(of(20, 23, true), 4);
  assert.equal(of(20, 20, false), 5);
  assert.equal(of(19, 20, false), 3); // not yet 20: priced as a quality gem
  assert.equal(of(12, 0, false), 1);
  assert.equal(of(12, 0, true), null); // no corrupted version that low is listed
  assert.deepEqual(t.gem('Grace', 21, 23, true).gem, { level: 21, quality: 23, corrupted: true });
  assert.equal(t.get('Grace').chaos, 1); // the plain name stays the cheapest
});

test('gems: searched by name, level, quality and corrupted', () => {
  const item = parseItemText(GRACE);
  assert.equal(searchable(item), true);
  const f = buildFilters(item, null);
  assert.equal(f.ok, true);
  assert.equal(f.title, 'Grace');
  assert.deepEqual(f.props.map((p) => [p.key, p.value, p.min, p.enabled]), [['gem_level', 21, 21, true], ['quality', 23, 23, true]]);
  assert.equal(isNarrow(f), true);
  const q = buildQuery(f).query;
  assert.equal(q.type, 'Grace');
  assert.deepEqual(q.filters.misc_filters.filters, { corrupted: { option: 'true' }, gem_level: { min: 21 }, quality: { min: 23 } });
  assert.equal(q.filters.type_filters, undefined);
  // a lower number typed in the window, quality switched off
  const q2 = buildQuery(applyEdits(f, { props: { gem_level: { enabled: true, min: 20 }, quality: { enabled: false, min: 23 } } })).query;
  assert.deepEqual(q2.filters.misc_filters.filters, { corrupted: { option: 'true' }, gem_level: { min: 20 } });
});

test('gems: low levels and little quality start unticked; small gems count from level 2', () => {
  const low = buildFilters(parseItemText(GRACE.replace('Level: 21 (Max)', 'Level: 12').replace('+23%', '+8%')), null);
  assert.deepEqual(low.props.map((p) => p.enabled), [false, false]);
  const q = buildQuery(low).query;
  assert.deepEqual(q.filters.misc_filters.filters, { corrupted: { option: 'true' } });
  const en = buildFilters(parseItemText(FRESH), null);
  assert.deepEqual(en.props.map((p) => [p.value, p.enabled]), [[3, true], [0, false]]);
  assert.equal(en.flags[0].label, 'Not corrupted');
});

test('gems: a transfigured gem is named the way the trade site lists it', async () => {
  const list = [{ type: 'Ice Nova', text: 'Ice Nova', disc: '' }, { type: 'Ice Nova', text: 'Ice Nova of Frostbolts', disc: 'alt_x' }, { type: 'Herald of Ash', text: '', disc: '' }];
  assert.deepEqual(gemType(list, 'Ice Nova of Frostbolts'), { option: 'Ice Nova', discriminator: 'alt_x' });
  assert.equal(gemType(list, 'Ice Nova'), null);
  assert.equal(gemType(list, 'Herald of Ash'), null);
  assert.equal(gemType([], 'Ice Nova of Frostbolts'), null);
  const f = buildFilters(parseItemText(GRACE.replace('\nGrace\n', '\nIce Nova of Frostbolts\n')), null);
  f.type.as = gemType(list, f.type.value);
  assert.deepEqual(buildQuery(applyEdits(f, {})).query.type, { option: 'Ice Nova', discriminator: 'alt_x' });

  // the list is asked for once and kept; a failure is tried again
  let calls = 0, ok = false;
  const client = new TradeClient({ fetchImpl: async () => { calls += 1; return ok ? { ok: true, status: 200, json: async () => ({ result: [{ id: 'gems', entries: list }] }) } : { ok: false, status: 503, json: async () => ({}) }; } });
  assert.deepEqual(await client.gems(), []);
  ok = true;
  assert.equal((await client.gems()).length, 3);
  await client.gems();
  assert.equal(calls, 2);
});

test('gems: each listing shows its own level and quality', () => {
  const f = buildFilters(parseItemText(GRACE), null);
  const cmp = compareSpec(f);
  assert.equal(cmp.mine, '21/23');
  const l = readListing({ id: 'a', listing: { price: { amount: 2, currency: 'divine' } }, item: { typeLine: 'Grace', properties: [{ name: 'Aura, Spell, AoE', values: [] }, { name: 'Level', values: [['21 (Max)', 0]] }, { name: 'Quality', values: [['+20%', 1]] }] } }, () => 400, cmp);
  assert.equal(l.cmp, '21/20');
  const plain = readListing({ id: 'b', listing: {}, item: { typeLine: 'Grace', properties: [{ name: 'Level', values: [['20 (Max)', 0]] }] } }, () => null, cmp);
  assert.equal(plain.cmp, '20/0');
});
