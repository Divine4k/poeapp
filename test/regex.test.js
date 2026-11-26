'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/core/regex');
const { DEFAULT_RULES } = require('../src/core/mapMods');

const num = (n) => new RegExp(`^${R.atLeast(n)}$`);

test('"at least N" finds exactly the numbers from N up, to 999', () => {
  for (const n of [1, 5, 9, 10, 19, 20, 80, 85, 99, 100, 120, 155, 199, 250, 999]) {
    const re = num(n);
    for (let x = 0; x <= 999; x++) assert.equal(re.test(String(x)), x >= n, `at least ${n}: ${x} (${R.atLeast(n)})`);
  }
  assert.equal(R.atLeast(0), '\\d+');
  assert.equal(R.atLeast(80), '([8-9]\\d|\\d{3})');
});

test('every map mod piece finds its mod and nothing else on a map', () => {
  const ids = new Set();
  for (const m of R.MAP_MODS) {
    assert.ok(!ids.has(m.id), `id ${m.id} twice`); ids.add(m.id);
    const re = new RegExp(m.tok, 'i');
    assert.ok(re.test(m.text), `${m.id}: "${m.tok}" should find "${m.text}"`);
    for (const o of R.MAP_MODS) if (o !== m) assert.ok(!re.test(o.text), `${m.id}: "${m.tok}" also finds "${o.text}"`);
    for (const line of R.MAP_LINES) assert.ok(!re.test(line), `${m.id}: "${m.tok}" also finds "${line}"`);
  }
  // the numbers and kinds of quality find only their own line, and no mod finds them
  const numLines = [...R.YIELDS, ...R.QUALITY];
  for (const x of numLines) {
    const re = new RegExp(`${x.tok}.*${R.atLeast(1)}%`, 'i');
    const own = [...numLines.map((y) => y.line), ...R.MAP_LINES].filter((l) => re.test(l));
    assert.deepEqual(own, [x.line], `${x.tok} finds ${JSON.stringify(own)}`);
    for (const m of R.MAP_MODS) assert.ok(!re.test(m.text), `${x.tok} finds "${m.text}"`);
  }
  for (const m of R.MAP_MODS) for (const x of numLines) assert.ok(!new RegExp(m.tok, 'i').test(x.line), `${m.id} finds "${x.line}"`);
});

test('every Map check tick has its mods here', () => {
  for (const r of DEFAULT_RULES) {
    assert.ok(R.RULE_MODS[r.id], `no mods for rule ${r.id}`);
    for (const id of R.RULE_MODS[r.id]) assert.ok(R.MAP_MODS.some((m) => m.id === id), `${r.id} -> ${id}`);
  }
  assert.deepEqual(R.modsFromRules([{ id: 'curses', enabled: true }, { id: 'no-regen', enabled: false }]), ['curse-vuln', 'curse-tc', 'curse-ew', 'curse-enf']);
});

const MAP = (mods, extra = [], rarity = 'Rare') => ['Item Class: Maps', `Rarity: ${rarity}`, 'Dread Cell', 'Strand Map', '--------', 'Map Tier: 16',
  'Monster Pack Size: +31% (augmented)', 'Item Rarity: +48% (augmented)', 'More Currency: +70% (augmented)', 'Quality (Currency): +20% (augmented)', '--------', ...mods, ...extra].join('\n');
const on = (o, text) => R.testSearch(R.mapSearch(R.cleanBuilders({ map: o }).map).text, text).ok;

test('the map search: mods not wanted, mods wanted, any or all', () => {
  const o = { avoid: ['reflect-phys', 'no-regen'] };
  assert.equal(R.mapSearch(o).text, '"!f phys|regen"');
  assert.equal(on(o, MAP(['Monsters have 30% more Life'])), true);
  assert.equal(on(o, MAP(['Monsters reflect 18% of Physical Damage'])), false);
  assert.equal(on(o, MAP(['Players cannot Regenerate Life, Mana or Energy Shield'])), false);
  const want = { wantMods: ['blind', 'maim'] };
  assert.equal(R.mapSearch(want).text, '"blind|maim"');
  assert.equal(on(want, MAP(['Monsters Blind on Hit'])), true);
  assert.equal(on(want, MAP([])), false);
  const all = { wantMods: ['blind', 'maim'], wantAll: true };
  assert.equal(on(all, MAP(['Monsters Blind on Hit'])), false);
  assert.equal(on(all, MAP(['Monsters Blind on Hit', 'Monsters Maim on Hit with Attacks'])), true);
  // one mod in both lists stays only in "don't want"
  assert.deepEqual(R.cleanBuilders({ map: { avoid: ['blind'], wantMods: ['blind', 'maim'] } }).map.wantMods, ['maim']);
  assert.equal(R.mapSearch({}).text, '');
});

test('the map search: numbers, quality, rarity, corrupted, unidentified, map types', () => {
  assert.equal(R.mapSearch({ yields: { pack: 25, rarity: 60 } }).text, '"r pa.*(2[5-9]|[3-9]\\d|\\d{3})%" "m rar.*([6-9]\\d|\\d{3})%"');
  assert.equal(on({ yields: { pack: 30 } }, MAP([])), true);
  assert.equal(on({ yields: { pack: 35 } }, MAP([])), false);
  assert.equal(on({ yields: { pack: 35, currency: 60 }, yieldAny: true }, MAP([])), true);
  assert.equal(on({ yields: { pack: 35, currency: 60 } }, MAP([])), false);
  assert.equal(R.mapSearch({ yields: { pack: 85 }, yieldShort: true }).text, '"r pa.*([8-9]\\d|\\d{3})%"');
  assert.equal(on({ quality: { currency: 20 } }, MAP([])), true);
  assert.equal(on({ quality: { pack: 10 } }, MAP([])), false);
  assert.equal(on({ quality: { pack: 10, currency: 10 } }, MAP([])), true); // one kind is enough by default
  assert.equal(on({ quality: { pack: 10, currency: 10 }, qualAny: false }, MAP([])), false);
  assert.equal(R.mapSearch({ rarity: { normal: false, magic: true, rare: true } }).text, '"y: (m|r)"');
  assert.equal(on({ rarity: { normal: false, magic: false, rare: true } }, MAP([], [], 'Magic')), false);
  assert.equal(on({ rarity: { normal: false, magic: false, rare: true }, rarityMode: 'exclude' }, MAP([], [], 'Magic')), true);
  assert.equal(R.mapSearch({ rarity: { normal: true, magic: true, rare: true } }).text, ''); // all three: nothing to do
  assert.equal(on({ corruptedOn: true, corruptedMode: 'exclude' }, MAP([], ['Corrupted'])), false);
  assert.equal(on({ corruptedOn: true }, MAP([], ['Corrupted'])), true);
  assert.equal(on({ unidOn: true }, MAP([], ['Unidentified'])), false);
  assert.equal(R.mapSearch({ typesOn: true, typeMode: { shaper: 'include' }, typeOn: { blighted: false, ravaged: false } }).text, '"!the elder|citadel|originator" "the shaper"');
  assert.equal(R.mapSearch({ typeMode: { shaper: 'include' } }).text, ''); // map types only count when switched on
});

test('the number on a mod is the characters it adds', () => {
  assert.equal(R.modCost({}, 'no-regen', 'avoid'), '"!regen"'.length);
  assert.equal(R.modCost({ avoid: ['reflect-phys'] }, 'no-regen', 'avoid'), '|regen'.length);
  assert.equal(R.modCost({ avoid: ['reflect-phys', 'no-regen'] }, 'no-regen', 'avoid'), '|regen'.length); // picked: what it takes away
  assert.equal(R.modCost({}, 'blind', 'wantMods'), '"blind"'.length);
});

const ITEM = (sockets, more = []) => ['Item Class: Boots', 'Rarity: Magic', 'Runner\'s Two-Toned Boots of the Ox', '--------', `Sockets: ${sockets}`, '--------', ...more].join('\n');

test('the vendor search finds links, sockets, colours and movement speed', () => {
  const t = (o, item) => R.testSearch(R.vendorSearch(o).text, item).ok;
  assert.equal(t({ rgb: true }, ITEM('R-G-B')), true);
  assert.equal(t({ rgb: true }, ITEM('B-R-G G')), true);
  assert.equal(t({ rgb: true }, ITEM('R-G B')), false);
  assert.equal(t({ links: 3 }, ITEM('R-G-B')), true);
  assert.equal(t({ links: 3 }, ITEM('R-G B-B')), false); // "Two-Toned" is no link
  assert.equal(t({ links: 4 }, ITEM('R-G-B-B')), true);
  assert.equal(t({ links: 4 }, ITEM('R-G-B B')), false);
  assert.equal(t({ links: 6 }, ITEM('R-G-B-B-G-R')), true);
  assert.equal(t({ links: 5 }, ITEM('R-G-B-B G-R')), false);
  assert.equal(t({ sockets: 5 }, ITEM('R G B B G')), true);
  assert.equal(t({ sockets: 6 }, ITEM('R G B B G')), false);
  assert.equal(t({ white: true }, ITEM('R-W G')), true);
  assert.equal(t({ white: true }, ITEM('R-G')), false);
  assert.equal(t({ moveMin: 20 }, ITEM('R', ['25% increased Movement Speed'])), true);
  assert.equal(t({ moveMin: 20 }, ITEM('R', ['15% increased Movement Speed'])), false);
  assert.equal(t({ moveMin: -1 }, ITEM('R', ['10% increased Movement Speed'])), true);
  // ticked things: any one of them lights the item up
  assert.equal(R.vendorSearch({ rgb: true, links: 4 }).text, '"r-g-b|r-b-g|b-r-g|b-g-r|g-r-b|g-b-r|-\\w-\\w-"');
  assert.equal(R.vendorSearch({}).text, '');
});

test('the tester reads a search as the stash box does', () => {
  assert.deepEqual(R.parseSearch('currency "m q.*1[6-9]" !unique "!a b|c"').map((x) => [x.body, x.neg]),
    [['currency', false], ['m q.*1[6-9]', false], ['unique', true], ['a b|c', true]]);
  const r = R.testSearch('maps "!f phys" pack', MAP([]));
  assert.equal(r.ok, true);
  assert.deepEqual(r.terms.map((x) => x.pass), [true, true, true]);
  assert.equal(R.testSearch('maps elder', MAP([])).ok, false); // every word must be found
  assert.equal(R.testSearch('', MAP([])).ok, false);
  const bad = R.testSearch('"a(b"', 'a(b');
  assert.equal(bad.ok, false);
  assert.ok(bad.error);
  assert.deepEqual(R.problems('"(x"'), ['"(x" is not a valid pattern.']);
  assert.deepEqual(R.problems('"abc'), ['A quote is not closed.']);
  assert.equal(R.problems('x'.repeat(R.GAME_LIMIT + 1)).length, 1);
});

test('builder choices are tidied for config.json, and old ones carried over', () => {
  const c = R.cleanBuilders({ map: { avoid: ['regen-typo', 'no-regen'], want: { quantity: 80, pack: '25', rarity: 0 }, corrupted: 'not', unidentified: 'not', tierMin: 14 }, vendor: { links: 7, sockets: 6, moveMin: 'a' } });
  assert.deepEqual(c.map.avoid, ['no-regen']);
  assert.deepEqual(c.map.yields, { pack: 25 }); // quantity is gone from maps; pack size carried over
  assert.equal(c.map.corruptedOn, true);
  assert.equal(c.map.corruptedMode, 'exclude');
  assert.equal(c.map.unidOn, true);
  assert.equal(c.map.tierMin, undefined);
  assert.equal(c.vendor.links, 0);
  assert.equal(c.vendor.sockets, 6);
  assert.equal(c.vendor.moveMin, 0);
  assert.deepEqual(R.cleanBuilders(null), R.cleanBuilders({}));
});
