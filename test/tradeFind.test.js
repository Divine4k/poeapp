'use strict';
// The Trade page's Search: picking an item and stats by words, and the search made from the form.
const test = require('node:test');
const assert = require('node:assert/strict');
const { StatIndex } = require('../src/core/tradeStats');
const { TradeClient, tokensOf, readListing } = require('../src/core/tradeApi');
const { readItems, findItems, statList, findStats, cleanForm, isEmpty, buildFind, nameOf, cleanSaved } = require('../src/core/tradeFind');

const SITE_ITEMS = { result: [
  { id: 'armour', label: 'Armour', entries: [
    { type: 'Simple Robe' }, { name: 'Tabula Rasa', type: 'Simple Robe', text: 'Tabula Rasa Simple Robe', flags: { unique: true } },
    { type: 'Astral Plate' }, { name: 'The Brass Dome', type: 'Gladiator Plate', text: 'The Brass Dome Gladiator Plate', flags: { unique: true } },
  ] },
  { id: 'gems', label: 'Gems', entries: [{ type: 'Spark' }, { type: 'Spark', text: 'Spark of the Nova', disc: 'alt_x' }, { type: 'Stable Thing' }] },
  { id: 'broken', entries: null }, null,
] };
const index = StatIndex.load();

test('the site\'s item list becomes names to pick from', () => {
  const list = readItems(SITE_ITEMS);
  assert.equal(list.length, 7);
  const tab = list.find((x) => x.name === 'Tabula Rasa');
  assert.deepEqual([tab.label, tab.type, tab.unique, tab.group], ['Tabula Rasa Simple Robe', 'Simple Robe', true, 'Armour']);
  assert.equal(list.find((x) => x.disc === 'alt_x').label, 'Spark of the Nova');
  assert.deepEqual(readItems(null), []);
});

test('items are found by every word typed, a name that starts with it first', () => {
  const list = readItems(SITE_ITEMS);
  assert.deepEqual(findItems(list, 'tab').map((x) => x.label), ['Tabula Rasa Simple Robe', 'Stable Thing']);
  assert.deepEqual(findItems(list, 'robe simple').map((x) => x.label), ['Simple Robe', 'Tabula Rasa Simple Robe']);
  assert.deepEqual(findItems(list, 'spark').map((x) => x.label), ['Spark', 'Spark of the Nova']);
  assert.deepEqual(findItems(list, '  '), []);
  assert.equal(findItems(list, 'a', 2).length, 2);
  assert.equal('find' in findItems(list, 'spark')[0], false);
});

test('stats are found by words, the plainest wording first', () => {
  const list = statList(index);
  assert.ok(list.length > 5000);
  const life = findStats(list, 'maximum life');
  assert.equal(life[0].ref, '+# to maximum Life');
  assert.ok(life[0].kinds.includes('explicit') && life[0].kinds.includes('crafted'));
  assert.deepEqual(findStats(list, ''), []);
  assert.ok(findStats(list, 'movement speed').length > 3);
});

test('an empty form is not searched', () => {
  assert.equal(isEmpty({}), true);
  assert.equal(isEmpty({ priceMax: 5, rarity: 'rare' }), true);
  assert.equal(isEmpty({ category: 'armour.boots' }), false);
  assert.equal(isEmpty({ text: 'Headhunter' }), false);
  assert.equal(isEmpty({ stats: [{ ref: '+# to maximum Life' }] }), false);
});

test('the form is cleaned: only known choices, numbers as numbers', () => {
  const f = cleanForm({ category: 'nonsense', rarity: 'rare', seller: 'hax', priceMax: '2,5', currency: 'mirror', links: 'six', corrupted: 'maybe', item: { type: '' }, text: ' Head\nhunter ', stats: [{ ref: '' }, { ref: 'x', kind: 'weird', min: '10', kinds: ['explicit', 'hax'] }] });
  assert.deepEqual([f.category, f.rarity, f.seller, f.priceMax, f.currency, f.links, f.corrupted, f.item, f.text], ['', 'rare', 'available', 2.5, '', '', '', null, 'Head hunter']);
  assert.deepEqual(f.stats, [{ ref: 'x', kind: 'any', min: 10, max: '', kinds: ['explicit'] }]);
});

test('a unique picked from the list is searched by name and base', () => {
  const { body } = buildFind({ item: { label: 'Tabula Rasa Simple Robe', name: 'Tabula Rasa', type: 'Simple Robe' }, links: 6, priceMax: 20, currency: 'chaos', seller: 'securable' }, index);
  assert.equal(body.query.name, 'Tabula Rasa');
  assert.equal(body.query.type, 'Simple Robe');
  assert.deepEqual(body.query.status, { option: 'securable' });
  assert.deepEqual(body.query.filters.socket_filters, { filters: { links: { min: 6 } } });
  assert.deepEqual(body.query.filters.trade_filters, { filters: { price: { max: 20, option: 'chaos' } } });
  assert.deepEqual(body.sort, { price: 'asc' });
});

test('a transfigured gem keeps the site\'s own way of naming it', () => {
  const { body } = buildFind({ item: { label: 'Spark of the Nova', type: 'Spark', disc: 'alt_x' }, gemLevel: 20, quality: 20, corrupted: 'no' }, index);
  assert.deepEqual(body.query.type, { option: 'Spark', discriminator: 'alt_x' });
  assert.deepEqual(body.query.filters.misc_filters.filters, { quality: { min: 20 }, gem_level: { min: 20 }, corrupted: { option: 'false' } });
});

test('words typed without a pick are searched as the site\'s free text', () => {
  const { body } = buildFind({ text: 'Headhunter' }, index);
  assert.equal(body.query.term, 'Headhunter');
  assert.equal('name' in body.query, false);
});

test('a stat of one kind is one line; of any kind, one of its kinds is enough', () => {
  const one = buildFind({ category: 'armour.boots', rarity: 'rare', ilvlMin: 84, stats: [{ ref: '+# to maximum Life', kind: 'explicit', min: 90 }] }, index).body.query;
  assert.deepEqual(one.stats, [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043', value: { min: 90 } }] }]);
  assert.deepEqual(one.filters.type_filters, { filters: { category: { option: 'armour.boots' }, rarity: { option: 'rare' } } });
  assert.deepEqual(one.filters.misc_filters, { filters: { ilvl: { min: 84 } } });
  const any = buildFind({ category: 'armour.boots', stats: [{ ref: '+# to maximum Life', kind: 'any', min: 90, max: 120 }] }, index).body.query;
  assert.equal(any.stats[0].filters.length, 0);
  assert.equal(any.stats[1].type, 'count');
  assert.deepEqual(any.stats[1].value, { min: 1 });
  assert.ok(any.stats[1].filters.length >= 4);
  assert.ok(any.stats[1].filters.every((x) => x.value.min === 90 && x.value.max === 120));
});

test('a stat the list no longer has is left out and named', () => {
  const r = buildFind({ category: 'jewel', stats: [{ ref: 'A stat from an old league', kind: 'any' }, { ref: '+# to maximum Life', kind: 'enchant' }] }, index);
  assert.deepEqual(r.unknown, ['A stat from an old league', '+# to maximum Life']);
  assert.deepEqual(r.body.query.stats, [{ type: 'and', filters: [] }]);
});

test('a search gets a short name, and saved ones are kept clean', () => {
  assert.equal(nameOf({ item: { label: 'Tabula Rasa Simple Robe', type: 'Simple Robe' } }), 'Tabula Rasa Simple Robe');
  assert.equal(nameOf({ category: 'armour.boots', rarity: 'rare', stats: [{ ref: '+# to maximum Life', min: 90 }, { ref: '#% increased Movement Speed' }] }), 'Rare Boots, +90 to maximum Life +1');
  assert.equal(nameOf({}), 'Search');
  const saved = cleanSaved([{ name: '  ', form: { text: 'Mageblood' } }, null, 'x', { name: 'Boots', form: { category: 'armour.boots', seller: 'nope' } }]);
  assert.deepEqual(saved.map((x) => x.name), ['Mageblood', 'Boots']);
  assert.equal(saved[1].form.seller, 'available');
  assert.equal(cleanSaved(Array.from({ length: 60 }, (_, i) => ({ name: `n${i}`, form: { text: 'x' } }))).length, 40);
});

test('the item list is asked for once and shared with the gem names', async () => {
  let calls = 0;
  const client = new TradeClient({ fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => SITE_ITEMS }; } });
  assert.equal(readItems({ result: await client.itemList() }).length, 7);
  assert.equal((await client.gems()).length, 3);
  assert.equal(calls, 1);
});

test('a listing\'s buttons of the site stay apart from what is shown', async () => {
  const raw = { id: 'a', listing: { hideout_token: 'h.h.h', whisper_token: 'w.w.w', fee: 100, price: { amount: 1, currency: 'divine' }, account: { name: 'Seller#1' } }, item: { typeLine: 'Simple Robe' } };
  assert.deepEqual(tokensOf(raw), { hideout: 'h.h.h', whisper: 'w.w.w' });
  assert.deepEqual(tokensOf({}), { hideout: '', whisper: '' });
  const shown = readListing(raw, () => 200);
  assert.equal(shown.status, 'instant');
  assert.equal(JSON.stringify(shown).includes('h.h.h'), false);
  const sent = [];
  const client = new TradeClient({ fetchImpl: async (url, init) => { sent.push([url, init]); return { ok: true, status: 200, json: async () => ({ success: true }) }; } });
  assert.equal(await client.act('h.h.h'), true);
  assert.equal(sent[0][0], 'https://www.pathofexile.com/api/trade/whisper');
  assert.deepEqual(JSON.parse(sent[0][1].body), { token: 'h.h.h' });
  await assert.rejects(() => client.act(''), /no such button/);
  const refused = new TradeClient({ fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Your account must be in-game' } }) }) });
  await assert.rejects(() => refused.act('x'), /must be in-game/);
});
