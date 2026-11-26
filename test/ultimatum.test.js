'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { accountQuery, readUltimatum, valueOf, searchFor, sortByWorth, tabsOf, scan } = require('../src/core/ultimatum');
const { TradeClient } = require('../src/core/tradeApi');

// One result as the trade site sends it (the shape of its properties, cut to what matters).
const raw = (id, sacrifice, count, reward, x, y, extra = {}) => ({
  id,
  listing: { stash: { name: 'MAPS', x, y }, account: { name: 'Someone#1234' }, ...(extra.listing || {}) },
  item: {
    typeLine: 'Inscribed Ultimatum',
    properties: [
      { name: 'Challenge', values: [['Survive', 0]] },
      { name: 'Area Level', values: [['83', 0]] },
      count ? { name: 'Requires Sacrifice: {0} {1}', values: [[sacrifice, 0], [`x${count}`, 0]] } : { name: 'Requires Sacrifice: {0}', values: [[sacrifice, 0]] },
      { name: 'Reward: {0}', values: [[reward, 0]] },
    ],
    ultimatumMods: [{ type: 'Choking Miasma', tier: 3 }, { type: 'Blistering Cold', tier: 1 }],
  },
});
const PRICES = { 'Exalted Orb': 14, 'Chaos Orb': 1, "Atziri's Acuity": 340, "Atziri's Step": 10 };
const chaosOf = (name) => PRICES[name] || 0;

test('the search asks for one account, priced or not, online or not', () => {
  const q = accountQuery(' Someone#1234 ');
  assert.equal(q.query.type, 'Inscribed Ultimatum');
  assert.equal(q.query.status.option, 'any');
  assert.deepEqual(q.query.filters.trade_filters.filters, { account: { input: 'Someone#1234' }, sale_type: { option: 'any' } });
});

test('an ultimatum is read: challenge, level, sacrifice with its count, reward, mods, place', () => {
  const u = readUltimatum(raw('a', 'Exalted Orb', 4, 'Doubles sacrificed Currency', 3, 5));
  assert.equal(u.challenge, 'Survive');
  assert.equal(u.areaLevel, 83);
  assert.deepEqual(u.sacrifice, { name: 'Exalted Orb', count: 4 });
  assert.equal(u.reward, 'Doubles sacrificed Currency');
  assert.deepEqual(u.mods, ['Choking Miasma III', 'Blistering Cold']);
  assert.deepEqual([u.tab, u.x, u.y], ['MAPS', 3, 5]);
  assert.equal(u.listed, null);
});

test('other shapes of the same lines are read too', () => {
  const u = readUltimatum({ id: 'b', listing: { price: { amount: 1, currency: 'exalted' } }, item: { properties: [
    { name: 'Requires Sacrifice', values: [['[Unique|Atziri\'s Step]', 0]] },
    { name: 'Reward', values: [["Atziri's Acuity", 0]] },
  ] } });
  assert.deepEqual(u.sacrifice, { name: "Atziri's Step", count: 1 });
  assert.equal(u.reward, "Atziri's Acuity");
  assert.equal(u.x, null);
  assert.deepEqual(u.listed, { amount: 1, currency: 'exalted' });
});

test('doubling is worth what you put in; a named reward is worth it less the sacrifice', () => {
  const double = valueOf(readUltimatum(raw('a', 'Exalted Orb', 4, 'Doubles sacrificed Currency', 0, 0)), chaosOf);
  assert.equal(double.kind, 'double');
  assert.equal(double.chaos, 56);
  const item = valueOf(readUltimatum(raw('b', "Atziri's Step", 0, "Atziri's Acuity", 0, 1)), chaosOf);
  assert.equal(item.kind, 'item');
  assert.equal(item.chaos, 330);
});

test('without a price it says so and gives no number', () => {
  const noSac = valueOf(readUltimatum(raw('a', 'Some New Orb', 3, 'Doubles sacrificed Currency', 0, 0)), chaosOf);
  assert.equal(noSac.chaos, null);
  assert.match(noSac.why, /No price for Some New Orb/);
  const noPrize = valueOf(readUltimatum(raw('b', 'Rare Ring', 0, 'Mirrored Rare Item', 0, 0)), chaosOf);
  assert.equal(noPrize.kind, 'unknown');
  assert.equal(noPrize.chaos, null);
});

test('dearest first, those without a price last; a far cell makes the tab a quad tab', () => {
  const list = [raw('a', 'Chaos Orb', 10, 'Doubles sacrificed Currency', 0, 0), raw('b', 'Rare Ring', 0, 'Mirrored Rare Item', 1, 0), raw('c', 'Exalted Orb', 4, 'Doubles sacrificed Currency', 13, 2)]
    .map(readUltimatum).map((u) => ({ ...u, value: valueOf(u, chaosOf) }));
  assert.deepEqual(sortByWorth(list).map((u) => u.id), ['c', 'a', 'b']);
  const [tab] = tabsOf(list);
  assert.equal(tab.size, 24);
  assert.equal(tab.count, 3);
  assert.equal(tab.cells['13,2'], 'c');
  assert.equal(tabsOf(list.slice(0, 2))[0].size, 12);
});

test('a look-up reads every result ten at a time and waits when the site asks', async () => {
  let now = 1000;
  const calls = [], slept = [];
  const ids = Array.from({ length: 23 }, (_x, i) => `id${i}`);
  const fetchImpl = async (url, init) => {
    calls.push(url);
    const json = /\/search\//.test(url)
      ? { id: 'Q', total: 23, result: ids }
      : { result: decodeURIComponent(url.split('/fetch/')[1].split('?')[0]).split(',').map((id) => raw(id, 'Chaos Orb', 2, 'Doubles sacrificed Currency', 0, 0)) };
    if (init && init.body) assert.match(init.body, /Someone#1234/);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => json };
  };
  const client = new TradeClient({ fetchImpl, now: () => now });
  const parts = [];
  const r = await scan({ client, league: 'Covens', account: 'Someone#1234', sleep: async (ms) => { slept.push(ms); now += ms; }, onPart: (d, t) => parts.push([d, t]) });
  assert.equal(r.items.length, 23);
  assert.equal(r.total, 23);
  assert.equal(calls.length, 4); // one search, three lots of results
  assert.deepEqual(parts, [[0, 23], [10, 23], [20, 23], [23, 23]]);
  assert.ok(slept.length >= 2, 'it waited between the lots of results');
  assert.equal(client.busy, false);
});

test('a look-up without an account name or league says what is missing', async () => {
  const client = new TradeClient({ fetchImpl: async () => { throw new Error('not reached'); } });
  await assert.rejects(scan({ client, league: 'Covens', account: ' ', sleep: async () => {} }), /account name/);
  await assert.rejects(scan({ client, league: '', account: 'A#1', sleep: async () => {} }), /league/);
});

test('the stash search for one names its sacrifice, level and challenge; a named reward too', () => {
  assert.equal(searchFor(readUltimatum(raw('a', 'Exalted Orb', 4, 'Doubles sacrificed Currency', 0, 0))), '"Exalted Orb x4" "Level: 83" "Survive"');
  assert.equal(searchFor(readUltimatum(raw('b', "Atziri's Step", 0, "Atziri's Acuity", 0, 1))), '"Atziri\'s Step" "Atziri\'s Acuity" "Level: 83" "Survive"');
  assert.equal(searchFor({ sacrifice: null, reward: '', areaLevel: null, challenge: '' }), '');
});
