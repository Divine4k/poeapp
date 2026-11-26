'use strict';
// Unique pieces (Vaal Aspects, Harbinger pieces) in the price check: searchable by name and
// base once identified; unidentified, their possible names come from the trade site's item list.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItemText } = require('../src/core/itemText');
const { searchable, buildFilters, buildQuery, applyEdits } = require('../src/core/tradeQuery');
const { TradeClient } = require('../src/core/tradeApi');

// As the game copies it (shape assumed from other unique items; not checked against a real copy).
const UNID = `Item Class: Pieces
Rarity: Unique
Vaal Aspect
--------
Unidentified
--------
This item will transform when correctly arranged with other items.`;
const ID = UNID.replace('Vaal Aspect\n--------\nUnidentified\n', 'Ambition\nVaal Aspect\n');

test('pieces: an unidentified Vaal Aspect goes to the pick list, an identified one is searched by name', () => {
  const unid = parseItemText(UNID);
  assert.equal(unid.unidentified, true);
  assert.equal(unid.baseType, 'Vaal Aspect');
  assert.equal(searchable(unid), true);
  const id = parseItemText(ID);
  const f = buildFilters(id, null);
  assert.equal(f.ok, true);
  assert.equal(f.name, 'Ambition');
  assert.equal(f.type.value, 'Vaal Aspect');
  const q = buildQuery(applyEdits(f, {})).query;
  assert.equal(q.name, 'Ambition');
  assert.equal(q.type, 'Vaal Aspect');
});

test('pieces: the uniques of a base come from the trade site item list, asked for once', async () => {
  let calls = 0;
  const list = [
    { id: 'accessory', entries: [{ name: 'Headhunter', type: 'Leather Belt', text: 'Headhunter Leather Belt' }] },
    { id: 'jewel', entries: [{ name: 'The Adorned', type: 'Crimson Jewel' }] },
    { id: 'pieces', entries: [{ name: 'Ambition', type: 'Vaal Aspect' }, { name: 'Beauty', type: 'Vaal Aspect' }, { type: 'Vaal Aspect' }] },
    { id: 'gems', entries: [{ type: 'Grace', text: 'Grace' }] },
  ];
  const client = new TradeClient({ fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ result: list }) }; } });
  assert.deepEqual(await client.uniquesOfBase('Vaal Aspect'), [{ name: 'Ambition' }, { name: 'Beauty' }]);
  assert.deepEqual(await client.uniquesOfBase('Golden Mask'), []);
  assert.equal((await client.gems()).length, 1);
  assert.equal(calls, 1);
});
