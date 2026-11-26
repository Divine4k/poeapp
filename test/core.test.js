'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalize } = require('../src/core/fuzzy');
const { parseLine, classifyArea } = require('../src/core/clientLog');
const { parseExchange, parseItemOverview, PriceTable } = require('../src/core/prices');
const { parseItemText, priceName } = require('../src/core/itemText');
const { DEFAULT_RULES, checkMods, mergeRules } = require('../src/core/mapMods');
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
  // A whisper that quotes a system message is a whisper, never the system message itself.
  assert.equal(parseLine('2026/11/23 15:03:02 124999 cff945b9 [INFO Client 4321] @From Bob: You have entered Strand.').type, 'whisper');
  assert.equal(classifyArea('HideoutCelestial'), 'hideout');
  assert.equal(classifyArea('1_1_town'), 'town');
  assert.equal(classifyArea('1_2_3'), 'other');
});

test('prices: exchange and item overview parsing', () => {
  const ex = parseExchange({
    // real shape: core.items holds only the reference currencies, the full list is top-level
    core: { primary: 'chaos', rates: { divine: 0.005 }, items: [{ id: 'divine', name: 'Divine Orb' }] },
    items: [{ id: 'divine', name: 'Divine Orb' }, { id: 'alt', name: 'Orb of Alteration', image: '/gen/image/x/y/CurrencyRerollMagic.png' }],
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
    { name: 'Headhunter', chaosValue: 9000, baseType: 'Leather Belt' }, { name: 'Headhunter', chaosValue: 8000, baseType: 'Leather Belt' },
    { name: 'Wurm\'s Molt', chaosValue: 2, baseType: 'Leather Belt' },
  ] }, 'UniqueAccessory');
  assert.deepEqual(it.map((e) => [e.name, e.chaos]), [['Tabula Rasa', 30], ['Headhunter', 8000], ['Wurm\'s Molt', 2]]);

  const t = new PriceTable();
  t.load([...ex, ...it]);
  assert.equal(t.chaosOf('divine orb'), 200);
  assert.equal(t.chaosOf('Chaos Orb'), 1);
  assert.equal(t.divine, 200);
  assert.equal(t.search('orb')[0].name, 'Orb of Alteration'); // prefix matches first
  assert.deepEqual(t.iconEntries(), [{ name: 'Orb of Alteration', icon: 'https://web.poecdn.com/gen/image/x/y/CurrencyRerollMagic.png' }]);
  assert.equal(PriceTable.fromJSON(JSON.parse(JSON.stringify(t))).chaosOf('Headhunter'), 8000);
  // an unidentified Leather Belt: the uniques it can be, dearest first (kept in the saved copy too)
  assert.deepEqual(PriceTable.fromJSON(JSON.parse(JSON.stringify(t))).uniquesOfBase('Leather Belt').map((e) => [e.name, e.chaos]), [['Headhunter', 8000], ['Wurm\'s Molt', 2]]);
  assert.deepEqual(t.uniquesOfBase('Golden Mask'), []);
  // a unique listed per variant: the cheapest, and the dearest commonly listed variant as its top
  const mb = parseItemOverview({ lines: [
    { name: 'Mageblood', baseType: 'Heavy Belt', chaosValue: 15303, variant: '2 Flasks', listingCount: 68 },
    { name: 'Mageblood', baseType: 'Heavy Belt', chaosValue: 43464, variant: '4 Flasks', listingCount: 240 },
    { name: 'Mageblood', baseType: 'Heavy Belt', chaosValue: 386616, variant: '5 Flasks', listingCount: 1 },
  ] }, 'UniqueAccessory');
  assert.deepEqual([mb[0].name, mb[0].chaos, mb[0].high], ['Mageblood', 15303, 43464]);
  const mt = new PriceTable(); mt.load(mb);
  assert.deepEqual(mt.uniquesOfBase('Heavy Belt').map((e) => [e.name, e.chaos, e.high]), [['Mageblood', 15303, 43464]]);
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
Rare Monsters have Physical Thorns reflecting 800 Physical Damage
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
  const rules = DEFAULT_RULES.map((r) => ({ ...r, enabled: r.id === 'thorns-phys' }));
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
  s.setUncounted(s.runs[1].id, 2, 1);
  s.setUncounted(s.runs[1].id, 1, 4);
  assert.deepEqual(s.summary(prices).runs[1].uncounted, { stacks: 2, singles: 4 });
  assert.deepEqual(s.summary(prices).runs[0].uncounted, { stacks: 0, singles: 0 });
  s.addHidden(s.runs[1].id, 2);
  s.setUncounted(s.runs[1].id, 1, 1);                              // keeps the hidden slots
  assert.deepEqual(s.summary(prices).runs[1].uncounted, { stacks: 2, singles: 4, hidden: 2 });

  const s2 = new Session({ now: () => t });
  s2.restore(JSON.parse(JSON.stringify(s)));
  assert.equal(s2.runs.length, 2);
  assert.equal(s2.current.segmentStart, null);
});


test('session clock: runs between maps, stops after 5 idle minutes back to leaving, pause and stop by hand', () => {
  let t = 1_000_000;
  const s = new Session({ now: () => t });
  const area = (code, seed, kind) => s.handleLogEvent({ type: 'area', code, seed, kind, level: 83 });
  const prices = { chaosOf: () => 1, divine: 200 };
  area('Hideout', '1', 'hideout');
  t += 600_000; // waiting in the hideout before the first map does not count
  assert.equal(s.clockMs(), 0);
  area('MapA', '1', 'map');
  t += 300_000;
  area('Hideout', '1', 'hideout');
  t += 120_000; // between maps: still counting
  assert.equal(s.clockMs(), 420_000);
  area('MapA', '2', 'map');
  t += 300_000;
  area('Hideout', '1', 'hideout'); // left at 720 s of play
  t += 299_000;
  assert.equal(s.tick(), false);
  t += 10 * 3600_000; // gone for the night
  assert.equal(s.tick(), true);
  assert.equal(s.clockMs(), 720_000);
  assert.equal(s.summary(prices).clock.running, false);
  area('MapA', '3', 'map'); // the next map starts it again
  t += 60_000;
  assert.equal(s.clockMs(), 780_000);
  s.addLoot([{ name: 'x', qty: 130 }], 'scan');
  const sum = s.summary(prices);
  assert.equal(sum.totals.playMs, 780_000);
  assert.equal(Math.round(sum.totals.netPerHour), 600); // 130 over 13 minutes

  s.clockAction('pause');
  t += 60_000;
  area('Hideout', '1', 'hideout'); area('MapA', '3', 'map'); // a paused clock stays paused
  assert.equal(s.clockMs(), 780_000);
  assert.equal(s.summary(prices).clock.paused, true);
  s.clockAction('resume');
  t += 60_000;
  s.clockAction('stop');
  t += 60_000;
  assert.equal(s.clockMs(), 840_000);
  area('Hideout', '1', 'hideout'); area('MapA', '4', 'map'); // stopped: the next map starts it
  t += 60_000;
  assert.equal(s.clockMs(), 900_000);

  // Restored after a close: counts up to the last save, then waits for a map.
  const saved = JSON.parse(JSON.stringify(s));
  t += 3600_000;
  const s2 = new Session({ now: () => t });
  s2.restore(saved);
  assert.equal(s2.clockMs(), 900_000);
  // A session saved before the clock existed starts from its maps' time.
  const s3 = new Session({ now: () => t });
  s3.restore({ runs: [{ id: 'a', activeMs: 5000 }, { id: 'b', activeMs: 7000 }] });
  assert.equal(s3.clockMs(), 12_000);
});

test('prices: Chaos Orb keeps its picture and is always worth 1', () => {
  const t = new PriceTable();
  t.load([{ name: 'Chaos Orb', chaos: 0.98, category: 'Currency', icon: 'https://web.poecdn.com/c.png' }]);
  assert.equal(t.chaosOf('Chaos Orb'), 1);
  assert.deepEqual(t.iconEntries(), [{ name: 'Chaos Orb', icon: 'https://web.poecdn.com/c.png' }]);
});

test('prices: every variant is listed, the plain name is the cheapest ordinary one', () => {
  const gems = parseItemOverview({ lines: [
    { name: 'Enlighten Support', chaosValue: 9000, variant: '4/0c', gemLevel: 4, corrupted: true },
    { name: 'Enlighten Support', chaosValue: 40, variant: '1' },
    { name: 'Enlighten Support', chaosValue: 700, variant: '3' },
  ] }, 'SkillGem');
  assert.deepEqual(gems.map((e) => [e.name, e.chaos]), [
    ['Enlighten Support', 40], ['Enlighten Support (4/0c)', 9000], ['Enlighten Support (1)', 40], ['Enlighten Support (3)', 700],
  ]);
  const bases = parseItemOverview({ lines: [
    { name: 'Unset Ring', chaosValue: 500, levelRequired: 85, variant: 'Shaper/Hunter' },
    { name: 'Unset Ring', chaosValue: 5, levelRequired: 82 },
  ] }, 'BaseType');
  assert.deepEqual(bases.map((e) => e.name), ['Unset Ring', 'Unset Ring (ilvl 85, Shaper/Hunter)', 'Unset Ring (ilvl 82)']);
  const maps = parseItemOverview({ lines: [{ name: 'Strand Map', chaosValue: 3, mapTier: 16 }, { name: 'Strand Map', chaosValue: 1, mapTier: 14 }] }, 'Map');
  assert.deepEqual(maps.map((e) => [e.name, e.chaos]), [['Strand Map', 1], ['Strand Map (T16)', 3], ['Strand Map (T14)', 1]]);

  // pictures are kept only for categories the inventory reader can recognise
  const visc = parseItemOverview({ lines: [{ name: 'Greater Skeletal Tail', chaosValue: 2, icon: 'https://web.poecdn.com/v.png' }] }, 'Viscera');
  const uniq = parseItemOverview({ lines: [{ name: 'Headhunter', chaosValue: 2, icon: 'https://web.poecdn.com/h.png' }] }, 'UniqueAccessory');
  const cards = parseExchange({ core: { primary: 'chaos' }, items: [{ id: 'd', name: 'The Doctor', image: '/c.png' }], lines: [{ id: 'd', primaryValue: 900 }] }, 'DivinationCard');
  const t = new PriceTable();
  t.load([...gems, ...visc, ...uniq, ...cards]);
  assert.deepEqual(t.iconEntries(), [{ name: 'Greater Skeletal Tail', icon: 'https://web.poecdn.com/v.png' }]);
  assert.equal(t.chaosOf('The Doctor'), 900);
  assert.equal(t.chaosOf('enlighten support (3)'), 700);
});

test('prices: divination cards without a picture of their own all get the shared card picture', () => {
  const { SHARED_ICONS } = require('../src/core/prices');
  const json = { core: { primary: 'chaos' }, items: [{ id: 'a', name: 'Abandoned Wealth' }, { id: 'd', name: 'The Doctor', image: '/own.png' }], lines: [{ id: 'a', primaryValue: 2 }, { id: 'd', primaryValue: 900 }] };
  const cards = parseExchange(json, 'DivinationCard');
  assert.equal(cards[0].icon, SHARED_ICONS.DivinationCard);
  assert.equal(cards[1].icon, 'https://web.poecdn.com/own.png');
  assert.equal(parseExchange(json, 'Currency')[0].icon, null);
  const t = new PriceTable();
  t.load([cards[0]]);
  assert.equal(t.categoryIcons().DivinationCard, SHARED_ICONS.DivinationCard);
  assert.deepEqual(t.iconEntries(), []);
});

test('prices: your own prices win and are listed under their own category', () => {
  const t = new PriceTable();
  t.load([{ name: 'Map (Tier 16)', chaos: 4, category: 'Map' }]);
  t.setCustom({ 'Originator Map (Tier 16)': 60, 'Map (Tier 16)': 5, '': 3, Bad: 'x' });
  assert.equal(t.chaosOf('originator map (tier 16)'), 60);
  assert.equal(t.chaosOf('Map (Tier 16)'), 5);
  assert.equal(t.categoryCounts().Custom, 2);
  assert.deepEqual(t.list('Custom').rows.map((r) => r.name), ['Originator Map (Tier 16)', 'Map (Tier 16)']);
  t.setCustom({});
  assert.equal(t.chaosOf('Map (Tier 16)'), 4);
});

test('game log: looked for on every drive and in every Steam library, newest wins', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { candidateLogPaths, steamLibraries, findLogPath } = require('../src/core/clientLog');
  assert.deepEqual(steamLibraries('"0" { "path"\t\t"C:\\\\Program Files (x86)\\\\Steam" }\n"1" { "path"\t\t"E:\\\\Spiele\\\\SteamLib" }'),
    ['C:\\Program Files (x86)\\Steam', 'E:\\Spiele\\SteamLib']);
  const list = candidateLogPaths({ drives: ['C', 'E'], exists: (p) => p === 'E:\\', readFile: () => '"path" "F:\\\\My Games\\\\"' });
  assert.ok(list.every((p) => p.startsWith('E:\\') || p.startsWith('F:\\')));          // drive C is not there
  assert.ok(list.includes('E:\\SteamLibrary\\steamapps\\common\\Path of Exile\\logs\\Client.txt'));
  assert.ok(list.includes('F:\\My Games\\steamapps\\common\\Path of Exile\\logs\\Client.txt')); // a Steam library in a custom folder

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-log-'));
  const old = path.join(dir, 'old.txt'), live = path.join(dir, 'live.txt');
  fs.writeFileSync(old, 'x'); fs.writeFileSync(live, 'y');
  fs.utimesSync(old, new Date('2026-01-01'), new Date('2026-01-01'));
  assert.equal(findLogPath([old, path.join(dir, 'missing.txt'), live]), live);            // the install being played
  assert.equal(findLogPath([path.join(dir, 'missing.txt')]), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('game log check: area lines are passed on, chat never is', () => {
  const { isAreaTalk } = require('../src/core/clientLog');
  assert.equal(isAreaTalk('2026/11/24 11:00:00 1 a [DEBUG Client 1] Generating level 83 area "MapWorldsJungleValley" with seed 5'), true);
  assert.equal(isAreaTalk('2026/11/24 11:00:01 1 a [INFO Client 1] : You have entered Jungle Valley.'), true);
  assert.equal(isAreaTalk('2026/11/24 11:00:01 1 a [INFO Client 1] : Bob has joined the area.'), true);
  assert.equal(isAreaTalk('2026/11/24 11:00:02 1 a [INFO Client 1] #Bob: I entered the area "MapX"'), false);
  assert.equal(isAreaTalk('2026/11/24 11:00:02 1 a [INFO Client 1] @From Bob: Generating level 83 area'), false);
  assert.equal(isAreaTalk('2026/11/24 11:00:03 1 a [INFO Client 1] : Trade accepted.'), false);
});

test('map check: saved ticks are kept, and a tick on a mod that left the game moves to what replaced it', () => {
  const rules = mergeRules([
    { id: 'reflect-phys', label: 'Physical reflect', pattern: 'reflect \\d+% of Physical', enabled: true },
    { id: 'reflect-ele', label: 'Elemental reflect', pattern: 'reflect \\d+% of Elemental', enabled: false },
    { id: 'no-leech', label: 'Cannot leech', pattern: 'Cannot Leech', enabled: true },
    { id: 'mine', label: 'My own', pattern: 'Totems', enabled: true },
  ]);
  assert.deepEqual(rules.filter((r) => r.enabled).map((r) => r.id), ['thorns-phys', 'no-leech', 'mine']);
  assert.ok(!rules.some((r) => /^reflect/.test(r.id)));
  // the wording is today's, not the saved one
  const hit = (mod) => checkMods([mod], rules)[0].labels;
  assert.deepEqual(hit('Monsters cannot be Leeched from'), ['Cannot leech']);
  assert.deepEqual(hit('Rare Monsters have Physical Thorns reflecting 800 Physical Damage'), ['Physical thorns (was reflect)']);
  assert.deepEqual(hit('Rare Monsters have Elemental Thorns reflecting 1500 Elemental Damage'), []);
  assert.deepEqual(mergeRules(undefined).map((r) => r.id), DEFAULT_RULES.map((r) => r.id));
});
