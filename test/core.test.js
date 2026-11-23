'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalize } = require('../src/core/fuzzy');
const { parseLine, classifyArea } = require('../src/core/clientLog');
const { parseExchange, parseItemOverview, PriceTable } = require('../src/core/prices');
const { parseItemText, priceName } = require('../src/core/itemText');
const { DEFAULT_RULES, checkMods } = require('../src/core/mapMods');
const { Session } = require('../src/core/session');

test('normalize: case, punctuation and spacing', () => {
  assert.equal(normalize('  Orb  of-Alteration '), 'orb of alteration');
  assert.equal(normalize('Kalandra’s Touch'), "kalandra's touch");
});

test('client log: areas, entering, deaths, chat is ignored', () => {
  const a = parseLine('2026/11/23 15:00:01 123456 1186a0e0 [DEBUG Client 4321] Generating level 83 area "MapWorldsStrand" with seed 3141592653');
  assert.equal(a.type, 'area'); assert.equal(a.kind, 'map'); assert.equal(a.level, 83); assert.equal(a.seed, '3141592653');
  assert.equal(parseLine('2026/11/23 15:00:02 123999 cff945b9 [INFO Client 4321] : You have entered Strand.').name, 'Strand');
  assert.equal(parseLine('2026/11/23 15:03:02 124999 cff945b9 [INFO Client 4321] : Exile_One has been slain.').name, 'Exile_One');
  assert.equal(parseLine('2026/11/23 15:03:02 124999 cff945b9 [INFO Client 4321] #Troll: Exile_One has been slain.'), null);
  assert.equal(parseLine('2026/11/23 15:03:02 124999 cff945b9 [INFO Client 4321] @From Bob: You have entered Strand.'), null);
  assert.equal(classifyArea('HideoutCelestial'), 'hideout');
  assert.equal(classifyArea('1_1_town'), 'town');
  assert.equal(classifyArea('1_2_3'), 'other');
});

test('prices: exchange and item overview parsing', () => {
  const ex = parseExchange({
    core: { primary: 'chaos', rates: { divine: 0.005 }, items: [{ id: 'divine', name: 'Divine Orb' }, { id: 'alt', name: 'Orb of Alteration' }] },
    lines: [{ id: 'divine', primaryValue: 200 }, { id: 'alt', primaryValue: 0.1 }, { id: 'ghost', primaryValue: 5 }],
  }, 'Currency');
  assert.deepEqual(ex.map((e) => [e.name, e.chaos]), [['Divine Orb', 200], ['Orb of Alteration', 0.1]]);

  const exDiv = parseExchange({
    core: { primary: 'divine', rates: { chaos: 200 }, items: [{ id: 'mirror', name: 'Mirror of Kalandra' }] },
    lines: [{ id: 'mirror', primaryValue: 500 }],
  }, 'Currency');
  assert.equal(exDiv[0].chaos, 100000);

  const it = parseItemOverview({ lines: [
    { name: 'Tabula Rasa', chaosValue: 30, links: 6 },
    { name: 'Headhunter', chaosValue: 9000 }, { name: 'Headhunter', chaosValue: 8000 },
  ] }, 'UniqueAccessory');
  assert.deepEqual(it.map((e) => [e.name, e.chaos]), [['Headhunter', 8000]]);

  const t = new PriceTable();
  t.load([...ex, ...it]);
  assert.equal(t.chaosOf('divine orb'), 200);
  assert.equal(t.chaosOf('Chaos Orb'), 1);
  assert.equal(t.divine, 200);
  assert.equal(t.search('orb')[0].name, 'Orb of Alteration'); // prefix matches first
  assert.deepEqual(t.iconEntries(), []); // no art URLs in this sample
  assert.equal(PriceTable.fromJSON(JSON.parse(JSON.stringify(t))).chaosOf('Headhunter'), 8000);
});

const MAP_TEXT = `Item Class: Maps
Rarity: Rare
Dread Pit
Strand Map
--------
Map Tier: 16
Item Quantity: +92% (augmented)
Item Rarity: +51% (augmented)
Monster Pack Size: +33% (augmented)
Quality: +20% (augmented)
--------
Item Level: 84
--------
Monsters reflect 18% of Physical Damage
Players cannot Regenerate Life, Mana or Energy Shield
Area contains many Totems
--------
Travel to this Map by using it in a personal Map Device. Maps can only be used once.
`;

test('item text: maps and stackables', () => {
  const m = parseItemText(MAP_TEXT);
  assert.equal(m.isMap, true);
  assert.equal(m.baseType, 'Strand Map');
  assert.equal(m.mapTier, 16);
  assert.equal(m.quantity, 92);
  assert.equal(m.packSize, 33);
  assert.equal(m.mods.length, 3);

  const c = parseItemText('Item Class: Stackable Currency\r\nRarity: Currency\r\nChaos Orb\r\n--------\r\nStack Size: 1,234/20\r\n--------\r\nReforges a rare item');
  assert.equal(c.stackSize, 1234);
  assert.equal(priceName(c), 'Chaos Orb');
  assert.equal(c.isMap, false);

  const u = parseItemText('Item Class: Belts\nRarity: Unique\nHeadhunter\nLeather Belt\n--------\nItem Level: 80');
  assert.equal(priceName(u), 'Headhunter');
  assert.equal(parseItemText('hello'), null);
});

test('map mods: only enabled rules warn', () => {
  const rules = DEFAULT_RULES.map((r) => ({ ...r, enabled: r.id === 'reflect-phys' }));
  const res = checkMods(parseItemText(MAP_TEXT).mods, rules);
  assert.deepEqual(res.map((r) => r.dangerous), [true, false, false]);
  const all = checkMods(parseItemText(MAP_TEXT).mods, DEFAULT_RULES.map((r) => ({ ...r, enabled: true })));
  assert.deepEqual(all.map((r) => r.dangerous), [true, true, false]);
  assert.equal(checkMods(['x'], [{ label: 'bad', pattern: '(', enabled: true }])[0].dangerous, false);
});

test('session: run lifecycle, timing, deaths, loot and costs', () => {
  let t = 1_000_000;
  const s = new Session({ now: () => t });
  const prices = { chaosOf: (n) => ({ 'Chaos Orb': 1, 'Divine Orb': 200, 'Ambush Scarab': 5 }[n] || 0), divine: 200 };
  const area = (code, seed, kind) => s.handleLogEvent({ type: 'area', code, seed, kind, level: 83 }, { characterName: 'Me', loadout: [{ name: 'Ambush Scarab', qty: 2 }, { name: 'Map', qty: 1, chaos: 4 }] });

  area('HideoutCelestial', '1', 'hideout');
  assert.equal(s.current, null);
  area('MapWorldsStrand', '77', 'map');
  s.handleLogEvent({ type: 'entered', name: 'Strand' });
  assert.equal(s.current.name, 'Strand');
  t += 60_000;
  s.handleLogEvent({ type: 'death', name: 'SomeoneElse' }, { characterName: 'Me' });
  s.handleLogEvent({ type: 'death', name: 'me' }, { characterName: 'Me' });
  assert.equal(s.current.deaths, 1);
  const batch = s.addLoot([{ name: 'Divine Orb', qty: 1 }, { name: 'Chaos Orb', qty: 7 }], 'scan');
  assert.ok(batch);

  area('MapSideAreaVaal', '5', 'map'); // side area, same run
  t += 30_000;
  assert.equal(s.runs.length, 1);
  area('HideoutCelestial', '1', 'hideout'); // pause
  t += 120_000;
  s.handleLogEvent({ type: 'death', name: 'Me' }, { characterName: 'Me' }); // not in a map
  assert.equal(s.current.deaths, 1);
  area('MapWorldsStrand', '77', 'map'); // same instance: resume
  t += 30_000;
  area('HideoutCelestial', '1', 'hideout');
  let sum = s.summary(prices);
  assert.equal(sum.runs.length, 1);
  assert.equal(sum.runs[0].durationMs, 120_000);
  assert.equal(sum.runs[0].lootValue, 207);
  assert.equal(sum.runs[0].costValue, 14);
  assert.equal(sum.runs[0].net, 193);

  area('MapWorldsStrand', '78', 'map'); // new instance: new run
  assert.equal(s.runs.length, 2);
  assert.ok(s.runs[0].endedAt);
  s.removeBatch(s.runs[0].id, batch);
  sum = s.summary(prices);
  assert.equal(sum.runs[0].lootValue, 0);
  assert.equal(sum.totals.maps, 2);
  assert.equal(s.addLoot([{ name: 'Chaos Orb', qty: 1 }], 'manual', 'nope'), null);

  const s2 = new Session({ now: () => t });
  s2.restore(JSON.parse(JSON.stringify(s)));
  assert.equal(s2.runs.length, 2);
  assert.equal(s2.current.segmentStart, null);
});

