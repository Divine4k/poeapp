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
  // and the wanted numbers find only their own line
  for (const w of R.MAP_WANTS) {
    const re = new RegExp(`${w.tok}${R.atLeast(1)}%`, 'i');
    const own = R.MAP_LINES.filter((l) => re.test(l));
    assert.equal(own.length, 1, `${w.id} finds ${JSON.stringify(own)}`);
    for (const m of R.MAP_MODS) assert.ok(!re.test(m.text), `${w.id} finds "${m.text}"`);
  }
});

test('every Map check tick has its mods here', () => {
  for (const r of DEFAULT_RULES) {
    assert.ok(R.RULE_MODS[r.id], `no mods for rule ${r.id}`);
    for (const id of R.RULE_MODS[r.id]) assert.ok(R.MAP_MODS.some((m) => m.id === id), `${r.id} -> ${id}`);
  }
  assert.deepEqual(R.modsFromRules([{ id: 'curses', enabled: true }, { id: 'no-regen', enabled: false }]), ['curse-vuln', 'curse-tc', 'curse-ew', 'curse-enf']);
});

const MAP = (mods, extra = []) => ['Item Class: Maps', 'Rarity: Rare', 'Dread Cell', 'Strand Map', '--------', 'Map Tier: 16', 'Item Quantity: +92% (augmented)',
  'Item Rarity: +48% (augmented)', 'Monster Pack Size: +31% (augmented)', '--------', ...mods, ...extra].join('\n');

test('the map search lights up the maps to run, or the ones to skip', () => {
  const o = { avoid: ['reflect-phys', 'no-regen'], want: { quantity: 90, pack: 30 } };
  const s = R.mapSearch(o).text;
  assert.equal(s, '"!f phys|regen" "tity: .(9\\d|\\d{3})%" "ze: .([3-9]\\d|\\d{3})%"');
  assert.equal(R.testSearch(s, MAP(['Monsters have 30% more Life'])).ok, true);
  assert.equal(R.testSearch(s, MAP(['Monsters reflect 18% of Physical Damage'])).ok, false);
  assert.equal(R.testSearch(s, MAP(['Players cannot Regenerate Life, Mana or Energy Shield'])).ok, false);
  assert.equal(R.testSearch(s, MAP([]).replace('+92%', '+88%')).ok, false); // quantity too low
  assert.equal(R.testSearch(s, MAP([]).replace('+92%', '+192%')).ok, true);
  // any one of the numbers
  const any = R.mapSearch({ want: { quantity: 100, pack: 30 }, wantAny: true }).text;
  assert.equal(any, '"tity: .(\\d{3})%|ze: .([3-9]\\d|\\d{3})%"'.replace('(\\d{3})', '[1-9]\\d\\d'));
  assert.equal(R.testSearch(any, MAP([])).ok, true);
  // skip mode
  const skip = R.mapSearch({ ...o, mode: 'skip' }).text;
  assert.equal(skip, '"f phys|regen"');
  assert.equal(R.testSearch(skip, MAP(['Monsters reflect 18% of Physical Damage'])).ok, true);
  assert.equal(R.testSearch(skip, MAP([])).ok, false);
  // own words, corrupted, unidentified
  const own = R.mapSearch({ extra: 'ghosts, "beyond"', corrupted: 'not', unidentified: 'not' }).text;
  assert.equal(own, '"!ghosts|beyond" "!corrupted" "!unidentified"');
  assert.equal(R.testSearch(own, MAP([], ['Corrupted'])).ok, false);
  assert.equal(R.mapSearch({}).text, '');
});

test('map tiers: one digit never finds two', () => {
  for (const [lo, hi] of [[14, 16], [16, 16], [1, 17], [5, 12], [3, 3], [9, 10]]) {
    const re = new RegExp(`tier: ${R.tierPattern(lo, hi)}`, 'i');
    for (let t = 1; t <= 17; t++) assert.equal(re.test(`Map Tier: ${t}\nItem Quantity: +1%`), t >= lo && t <= hi, `${lo}-${hi}: ${t} (${R.tierPattern(lo, hi)})`);
  }
  assert.equal(R.mapSearch({ tierMin: 14, tierMax: 16 }).text, '"tier: 1[4-6]"');
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
  const r = R.testSearch('maps "!f phys" quantity', MAP([]));
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

test('builder choices are tidied for config.json', () => {
  const c = R.cleanBuilders({ map: { avoid: ['regen-typo', 'no-regen'], want: { quantity: '80', rarity: 0, pack: -3 }, tierMin: 99, mode: 'x' }, vendor: { links: 7, sockets: 6, moveMin: 'a' } });
  assert.deepEqual(c.map.avoid, ['no-regen']);
  assert.deepEqual(c.map.want, { quantity: 80 });
  assert.equal(c.map.tierMin, 17);
  assert.equal(c.map.mode, 'run');
  assert.equal(c.vendor.links, 0);
  assert.equal(c.vendor.sockets, 6);
  assert.equal(c.vendor.moveMin, 0);
  assert.deepEqual(R.cleanBuilders(null), R.cleanBuilders({}));
});
