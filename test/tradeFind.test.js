'use strict';
// The Trade page's Search: picking an item and stats by words, the site's filter list, and the
// searches made from the form (listed items with every filter and stat group; bulk exchange).
const test = require('node:test');
const assert = require('node:assert/strict');
const { StatIndex } = require('../src/core/tradeStats');
const { TradeClient, tokensOf, readListing, readBulk } = require('../src/core/tradeApi');
const T = require('../src/core/tradeFind');
const F = require('../src/core/tradeFilters');

const SITE_ITEMS = { result: [
  { id: 'armour', label: 'Armour', entries: [
    { type: 'Simple Robe' }, { name: 'Tabula Rasa', type: 'Simple Robe', text: 'Tabula Rasa Simple Robe', flags: { unique: true } },
    { type: 'Astral Plate' }, { name: 'The Brass Dome', type: 'Gladiator Plate', text: 'The Brass Dome Gladiator Plate', flags: { unique: true } },
  ] },
  { id: 'gems', label: 'Gems', entries: [{ type: 'Spark' }, { type: 'Spark', text: 'Spark of the Nova', disc: 'alt_x' }, { type: 'Stable Thing' }] },
  { id: 'broken', entries: null }, null,
] };
// The site's filter list as it is taken to look (a few groups of it).
const SITE_FILTERS = { result: [
  { id: 'type_filters', title: 'Type Filters', filters: [
    { id: 'category', text: 'Item Category', fullSpan: true, option: { options: [{ id: null, text: 'Any' }, { id: 'armour.boots', text: 'Boots' }] } },
    { id: 'rarity', text: 'Item Rarity', option: { options: [{ id: null, text: 'Any' }, { id: 'rare', text: 'Rare' }] } }] },
  { id: 'socket_filters', title: 'Socket Filters', filters: [{ id: 'sockets', text: 'Sockets', minMax: true }, { id: 'links', text: 'Links', minMax: true }] },
  { id: 'misc_filters', title: 'Miscellaneous', filters: [{ id: 'ilvl', text: 'Item Level', minMax: true }, { id: 'twice_corrupted', text: 'Twice Corrupted', option: { options: [{ id: 'true', text: 'Yes' }, { id: 'false', text: 'No' }] } }] },
  { id: 'trade_filters', title: 'Trade Filters', filters: [{ id: 'account', text: 'Seller Account' },
    { id: 'price', text: 'Buyout Price', minMax: true, option: { options: [{ id: null, text: 'Chaos Orb Equivalent' }, { id: 'divine', text: 'Divine Orb' }] } }, { id: 'bad id!' }, null] },
  { id: 'Bad Group', filters: [] },
] };
const index = StatIndex.load();
const LIFE = '+# to maximum Life';

test('the site\'s item list becomes names to pick from', () => {
  const list = T.readItems(SITE_ITEMS);
  assert.equal(list.length, 7);
  const tab = list.find((x) => x.name === 'Tabula Rasa');
  assert.deepEqual([tab.label, tab.type, tab.unique, tab.group], ['Tabula Rasa Simple Robe', 'Simple Robe', true, 'Armour']);
  assert.deepEqual(T.readItems(null), []);
});

test('items are found by every word typed, a name that starts with it first', () => {
  const list = T.readItems(SITE_ITEMS);
  assert.deepEqual(T.findItems(list, 'tab').map((x) => x.label), ['Tabula Rasa Simple Robe', 'Stable Thing']);
  assert.deepEqual(T.findItems(list, 'spark').map((x) => x.label), ['Spark', 'Spark of the Nova']);
  assert.deepEqual(T.findItems(list, '  '), []);
  assert.equal('find' in T.findItems(list, 'spark')[0], false);
});

test('stats are found by words, the plainest wording first', () => {
  const list = T.statList(index);
  const life = T.findStats(list, 'maximum life');
  assert.equal(life[0].ref, LIFE);
  assert.ok(life[0].kinds.includes('explicit') && life[0].kinds.includes('crafted'));
});

test('the site\'s filter list is read, each filter as the kind it is', () => {
  const groups = F.readFilters(SITE_FILTERS);
  assert.deepEqual(groups.map((g) => g.id), ['type_filters', 'socket_filters', 'misc_filters', 'trade_filters']);
  const all = F.indexOf(groups);
  assert.equal(all.get('type_filters.category').kind, 'option');
  assert.deepEqual(all.get('type_filters.category').options[0], { id: '', text: 'Any' });
  assert.equal(all.get('socket_filters.links').kind, 'sockets');
  assert.equal(all.get('misc_filters.ilvl').kind, 'range');
  assert.equal(all.get('misc_filters.twice_corrupted').options[0].id, '', 'a yes/no list without "Any" gets one');
  assert.equal(all.get('trade_filters.account').kind, 'text');
  assert.equal(all.get('trade_filters.price').kind, 'price');
  assert.equal(all.has('trade_filters.bad id!'), false);
  assert.equal(F.readFilters({ result: [] }), null);
  assert.equal(F.readFilters(null), null);
});

test('the built-in list has every group of the site\'s page', () => {
  assert.deepEqual(F.BUILT_IN.map((g) => g.title), ['Type Filters', 'Weapon Filters', 'Armour Filters', 'Socket Filters', 'Requirements', 'Map Filters', 'Heist Filters', 'Sanctum Filters', 'Ultimatum Filters', 'Miscellaneous', 'Trade Filters']);
  const all = F.indexOf(F.BUILT_IN);
  for (const id of ['weapon_filters.pdps', 'armour_filters.es', 'req_filters.class', 'map_filters.map_tier', 'heist_filters.heist_lockpicking', 'misc_filters.corrupted', 'misc_filters.twice_corrupted', 'trade_filters.indexed', 'trade_filters.collapse']) assert.ok(all.has(id), id);
});

test('filled filters are cleaned against the list and become the site\'s filters', () => {
  const groups = F.readFilters(SITE_FILTERS);
  const v = F.cleanFilters({
    type_filters: { category: { option: 'armour.boots' }, rarity: { option: 'mythic' } },
    socket_filters: { links: { r: '2', b: 'x', min: '5' }, sockets: {} },
    misc_filters: { ilvl: { min: '84', max: '' }, twice_corrupted: { option: 'false' } },
    trade_filters: { account: '  Seller#1234 ', price: { option: 'divine' } },
    'Bad!': { x: 1 },
  }, groups);
  assert.deepEqual(v, {
    type_filters: { category: { option: 'armour.boots' } },
    socket_filters: { links: { min: 5, r: 2 } },
    misc_filters: { ilvl: { min: 84 }, twice_corrupted: { option: 'false' } },
    trade_filters: { account: 'Seller#1234' },
  });
  assert.deepEqual(F.queryFilters(v).trade_filters, { filters: { account: { input: 'Seller#1234' } } });
  assert.deepEqual(F.queryFilters(v).socket_filters, { filters: { links: { min: 5, r: 2 } } });
});

test('a form from before 0.67 is read into the new shape', () => {
  const f = T.cleanForm({ category: 'armour.boots', rarity: 'rare', links: '6', ilvlMin: 84, corrupted: 'no', priceMax: '2,5', currency: 'divine', stats: [{ ref: LIFE, kind: 'explicit', min: 90 }] });
  assert.deepEqual(f.filters, {
    type_filters: { category: { option: 'armour.boots' }, rarity: { option: 'rare' } },
    socket_filters: { links: { min: 6 } }, misc_filters: { ilvl: { min: 84 }, corrupted: { option: 'false' } },
    trade_filters: { price: { max: 2.5, option: 'divine' } },
  });
  assert.equal(f.groups.length, 1);
  assert.deepEqual([f.groups[0].type, f.groups[0].stats[0].ref, f.groups[0].stats[0].min], ['and', LIFE, 90]);
  assert.equal(f.mode, 'items');
  assert.deepEqual(f.sort, { by: 'price', dir: 'asc' });
});

test('an empty form is not searched; any one filter is enough', () => {
  assert.equal(T.isEmpty({}), true);
  assert.equal(T.isEmpty({ filters: { trade_filters: { account: 'Someone' } } }), false);
  assert.equal(T.isEmpty({ text: 'Headhunter' }), false);
  assert.equal(T.isEmpty({ groups: [{ stats: [{ ref: LIFE }] }] }), false);
  assert.equal(T.isEmpty({ mode: 'bulk', bulk: { have: [{ id: 'chaos' }] } }), true);
  assert.equal(T.isEmpty({ mode: 'bulk', bulk: { want: [{ id: 'divine', label: 'Divine Orb' }] } }), false);
});

test('a unique picked from the list is searched by name and base, with its filters', () => {
  const { body } = T.buildFind({ item: { label: 'Tabula Rasa Simple Robe', name: 'Tabula Rasa', type: 'Simple Robe' }, seller: 'securable', filters: { socket_filters: { links: { min: 6, w: 6 } } } }, index, F.BUILT_IN);
  assert.equal(body.query.name, 'Tabula Rasa');
  assert.equal(body.query.type, 'Simple Robe');
  assert.deepEqual(body.query.status, { option: 'securable' });
  assert.deepEqual(body.query.filters, { socket_filters: { filters: { links: { min: 6, w: 6 } } } });
  assert.deepEqual(body.sort, { price: 'asc' });
});

test('a transfigured gem keeps the site\'s own way of naming it', () => {
  const { body } = T.buildFind({ item: { label: 'Spark of the Nova', type: 'Spark', disc: 'alt_x' } }, index);
  assert.deepEqual(body.query.type, { option: 'Spark', discriminator: 'alt_x' });
});

test('stat groups of every kind go to the site as their kind', () => {
  const form = { category: 'armour.boots', groups: [
    { type: 'and', stats: [{ ref: LIFE, kind: 'explicit', min: 90 }, { ref: '#% increased Movement Speed', kind: 'explicit', min: 25, off: true }] },
    { type: 'not', stats: [{ ref: LIFE, kind: 'crafted' }] },
    { type: 'count', min: 2, stats: [{ ref: '+#% to Fire Resistance', kind: 'explicit', min: 30 }, { ref: '+#% to Cold Resistance', kind: 'explicit', min: 30 }] },
    { type: 'weight', min: 100, off: true, stats: [{ ref: LIFE, kind: 'explicit', weight: 1 }] },
  ] };
  const q = T.buildFind(form, index).body.query;
  assert.equal(q.stats.length, 4);
  assert.deepEqual(q.stats[0].filters[0], { id: 'explicit.stat_3299347043', value: { min: 90 } });
  assert.equal(q.stats[0].filters[1].disabled, true);
  assert.deepEqual([q.stats[1].type, q.stats[1].filters[0].id], ['not', 'crafted.stat_3299347043']);
  assert.deepEqual([q.stats[2].type, q.stats[2].value, q.stats[2].filters.length], ['count', { min: 2 }, 2]);
  assert.deepEqual([q.stats[3].type, q.stats[3].value, q.stats[3].disabled], ['weight', { min: 100 }, true]);
  assert.deepEqual(q.stats[3].filters[0].value, { weight: 1 });
  assert.equal(T.needsSignIn(form), false, 'a weighted group that is switched off asks for nothing');
  assert.equal(T.needsSignIn({ groups: [{ type: 'weight2', stats: [{ ref: LIFE }] }] }), true);
});

test('in an And group a stat of any kind is one of its kinds (its own Count group)', () => {
  const q = T.buildFind({ category: 'armour.boots', groups: [{ type: 'and', stats: [{ ref: LIFE, kind: 'any', min: 90, max: 120 }] }] }, index).body.query;
  assert.equal(q.stats[0].filters.length, 0);
  assert.deepEqual([q.stats[1].type, q.stats[1].value], ['count', { min: 1 }]);
  assert.ok(q.stats[1].filters.length >= 4 && q.stats[1].filters.every((x) => x.value.min === 90 && x.value.max === 120));
});

test('results can be sorted by price, by a stat or by a weighted sum', () => {
  const groups = [{ type: 'and', stats: [{ ref: LIFE, kind: 'any' }] }, { type: 'weight', stats: [{ ref: LIFE, kind: 'explicit', weight: 1 }] }];
  assert.deepEqual(T.buildFind({ text: 'x', sort: { by: 'price', dir: 'desc' } }, index).body.sort, { price: 'desc' });
  assert.deepEqual(T.buildFind({ text: 'x', groups, sort: { by: 'stat', ref: LIFE } }, index).body.sort, { [`stat.${index.byRef.get(LIFE).ids.explicit[0]}`]: 'desc' });
  // The And group's stat of any kind went into a Count group of its own, so the weighted one is third.
  assert.deepEqual(T.buildFind({ text: 'x', groups, sort: { by: 'group', i: 1 } }, index).body.sort, { 'statgroup.2': 'desc' });
  assert.deepEqual(T.buildFind({ text: 'x', groups, sort: { by: 'group', i: 0 } }, index).body.sort, { price: 'asc' }, 'only a weighted group can be sorted by');
});

test('a stat the list no longer has is left out and named', () => {
  const r = T.buildFind({ text: 'x', groups: [{ stats: [{ ref: 'A stat from an old league' }, { ref: LIFE, kind: 'enchant' }] }] }, index);
  assert.deepEqual(r.unknown, ['A stat from an old league', LIFE]);
});

test('a bulk search asks for every want and have, with the minimum stock', () => {
  const body = T.buildBulk({ mode: 'bulk', bulk: { want: [{ id: 'divine', label: 'Divine Orb' }, { id: 'bad id!' }], have: [{ id: 'chaos', label: 'Chaos Orb' }], minimum: '5', seller: 'any' } });
  assert.deepEqual(body, { engine: 'new', query: { status: { option: 'any' }, want: ['divine'], have: ['chaos'], minimum: 5 }, sort: { have: 'asc' } });
  assert.equal(T.nameOf({ mode: 'bulk', bulk: { want: [{ id: 'divine', label: 'Divine Orb' }], have: [{ id: 'chaos', label: 'Chaos Orb' }] } }), 'Divine Orb for Chaos Orb');
});

test('the bulk names come from the site\'s list of stackables', () => {
  const list = T.readStatic({ result: [{ id: 'Currency', label: 'Currency', entries: [{ id: 'divine', text: 'Divine Orb', image: '/gen/image/div.png' }, { id: 'chaos', text: 'Chaos Orb' }, { id: 'divine', text: 'Again' }, { text: 'no id' }] }] });
  assert.deepEqual(list.map((x) => x.id), ['divine', 'chaos']);
  assert.equal(list[0].image, 'https://www.pathofexile.com/gen/image/div.png');
  assert.deepEqual(T.findStatic(list, 'div').map((x) => x.id), ['divine']);
});

test('each offer of a bulk listing is a row with the site\'s own whisper line', () => {
  const raw = { id: 'abc', listing: { indexed: '2026-11-26T10:00:00Z', whisper: '@Seller Hi, I\'d like to buy your {0} for my {1} in Keepers.', account: { name: 'S#1', lastCharacterName: 'Seller', online: { league: 'Keepers' } },
    offers: [{ exchange: { currency: 'divine', amount: 1, whisper: '{0} Divine Orb' }, item: { currency: 'chaos', amount: 210, stock: 840, whisper: '{0} Chaos Orb' } },
      { exchange: { currency: 'exalted', amount: 0 }, item: { currency: 'chaos', amount: 5 } }] } };
  const rows = readBulk(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'abc#0');
  assert.equal(rows[0].whisper, '@Seller Hi, I\'d like to buy your 210 Chaos Orb for my 1 Divine Orb in Keepers.');
  assert.deepEqual([rows[0].stock, rows[0].status, rows[0].seller], [840, 'online', 'Seller']);
  assert.equal(readBulk({ id: 'x', listing: { offers: [{ exchange: { currency: 'divine', amount: 1 }, item: { currency: 'chaos', amount: 2 } }] } })[0].whisper, '', 'no pieces, no line');
});

test('a search gets a short name, and saved ones are kept clean', () => {
  assert.equal(T.nameOf({ item: { label: 'Tabula Rasa Simple Robe', type: 'Simple Robe' } }), 'Tabula Rasa Simple Robe');
  assert.equal(T.nameOf({ filters: { type_filters: { category: { option: 'armour.boots' }, rarity: { option: 'rare' } } }, groups: [{ stats: [{ ref: LIFE, min: 90 }, { ref: '#% increased Movement Speed' }] }] }), 'Rare Boots, +90 to maximum Life +1');
  const saved = T.cleanSaved([{ name: '  ', form: { text: 'Mageblood' } }, null, { name: 'Boots', form: { category: 'armour.boots', seller: 'nope' } }]);
  assert.deepEqual(saved.map((x) => x.name), ['Mageblood', 'Boots']);
  assert.equal(saved[1].form.seller, 'available');
  assert.deepEqual(saved[1].form.filters, { type_filters: { category: { option: 'armour.boots' } } });
});

test('the site\'s lists are asked for once each and shared', async () => {
  const calls = [];
  const client = new TradeClient({ fetchImpl: async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => (/items$/.test(url) ? SITE_ITEMS : SITE_FILTERS) }; } });
  assert.equal(T.readItems({ result: await client.itemList() }).length, 7);
  assert.equal((await client.gems()).length, 3);
  assert.equal((await client.dataList('filters')).length, 5);
  await client.dataList('filters');
  assert.deepEqual(await client.dataList('nonsense'), []);
  assert.equal(calls.length, 2);
  const down = new TradeClient({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  assert.deepEqual(await down.dataList('static'), []);
});

test('a listing\'s buttons of the site stay apart from what is shown', async () => {
  const raw = { id: 'a', listing: { hideout_token: 'h.h.h', whisper_token: 'w.w.w', fee: 100, price: { amount: 1, currency: 'divine' }, account: { name: 'Seller#1' } }, item: { typeLine: 'Simple Robe' } };
  assert.deepEqual(tokensOf(raw), { hideout: 'h.h.h', whisper: 'w.w.w' });
  const shown = readListing(raw, () => 200);
  assert.equal(JSON.stringify(shown).includes('h.h.h'), false);
  const sent = [];
  const client = new TradeClient({ fetchImpl: async (url, init) => { sent.push([url, init]); return { ok: true, status: 200, json: async () => ({ success: true }) }; } });
  assert.equal(await client.act('h.h.h'), true);
  assert.deepEqual(JSON.parse(sent[0][1].body), { token: 'h.h.h' });
  await assert.rejects(() => client.act(''), /no such button/);
});
