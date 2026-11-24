'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItemText } = require('../src/core/itemText');
const { StatIndex, wordings } = require('../src/core/tradeStats');
const { searchable, buildFilters, applyEdits, isNarrow, buildQuery, summarize, floorFor } = require('../src/core/tradeQuery');
const { TradeClient, parseLimits, readListing, searchUrl, currencyName } = require('../src/core/tradeApi');
const { checkMessage, tradeMessage } = require('../src/core/checkMessage');

const index = StatIndex.load();

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
Requirements:
Level: 68
Dex: 212
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
const HEADHUNTER = `Item Class: Belts
Rarity: Unique
Headhunter
Leather Belt
--------
Requirements:
Level: 40
--------
Item Level: 85
--------
+35 to maximum Life (implicit)
--------
+52 to Strength
+55 to maximum Life
When you Kill a Rare monster, you gain its Modifiers for 60 seconds
--------
"A man's soul rules from a cavern of bone, learns and
judges through flesh-born windows."
--------
Corrupted
`;
const FLASK = `Item Class: Utility Flasks
Rarity: Magic
Chemist's Quicksilver Flask of the Cheetah
--------
Lasts 6.00 Seconds
Consumes 24 (augmented) of 60 Charges on use
--------
Item Level: 84
--------
25% reduced Charges per use
14% increased Movement Speed during Effect
--------
Right click to drink. Can only hold charges while in belt. Refills as you kill monsters.
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
--------
Place into an allocated Large Jewel Socket on the Passive Skill Tree. Added passives do not interact with jewel radiuses. Right click to remove from the Socket.
`;
const BOOTS = `Item Class: Boots
Rarity: Rare
Kraken Spark
Two-Toned Boots
--------
Armour: 251 (augmented)
Evasion Rating: 251 (augmented)
--------
Sockets: R-G-G-R 
--------
Item Level: 86
--------
+88 to maximum Life
30% increased Movement Speed
(Reminder text the game adds
over two lines)
+38% to Fire Resistance
`;

const stat = (f, text) => f.stats.find((s) => s.text.includes(text));

test('item text: gear is read with every modifier, its kind, and what the game works out', () => {
  const ring = parseItemText(RING);
  assert.deepEqual([ring.rarity, ring.name, ring.baseType, ring.itemLevel, ring.corrupted], ['Rare', 'Doom Loop', 'Two-Stone Ring', 84, false]);
  assert.deepEqual(ring.influences, ['Shaper']);
  assert.deepEqual(ring.modLines.map((l) => l.type), ['implicit', 'explicit', 'explicit', 'explicit', 'explicit', 'explicit', 'explicit', 'crafted']);
  assert.equal(ring.modLines[7].text, '+25 to maximum Mana');
  const bow = parseItemText(BOW);
  assert.equal(bow.links, 6);
  assert.equal(Math.round(bow.props.pdps), 369); // (115 + 312) / 2 x 1.73
  assert.equal(Math.round(bow.props.edps), 192);
  assert.equal(bow.modLines.at(-1).type, 'fractured');
  const boots = parseItemText(BOOTS);
  assert.deepEqual([boots.props.armour, boots.props.evasion, boots.links], [251, 251, 4]);
  // The game's explanations in brackets and its usage hints are not modifiers.
  assert.deepEqual(boots.modLines.map((l) => l.text), ['+88 to maximum Life', '30% increased Movement Speed', '+38% to Fire Resistance']);
  assert.ok(!parseItemText(FLASK).modLines.some((l) => /Right click/.test(l.text)));
  assert.equal(parseItemText(HEADHUNTER).corrupted, true);
  // Maps keep going to the map check.
  assert.equal(parseItemText('Item Class: Maps\nRarity: Rare\nX\nStrand Map\n--------\nMap Tier: 16\n--------\nItem Level: 83\n--------\nArea contains many Totems\n').modLines, undefined);
});

test('stat list: a modifier line finds its id on the trade site', () => {
  assert.deepEqual([...wordings('+72 to maximum Life')][0], { string: '# to maximum Life', values: [72] });
  const life = index.match('+72 to maximum Life', 'explicit', 'Ring');
  assert.deepEqual([life.ref, life.ids, life.value], ['+# to maximum Life', ['explicit.stat_3299347043'], 72]);
  assert.deepEqual(index.match('+35 to maximum Life', 'implicit', 'Belt').ids, ['implicit.stat_3299347043']);
  // A range counts by its middle.
  assert.equal(index.match('Adds 8 to 14 Physical Damage to Attacks', 'explicit', 'Ring').value, 11);
  // The same words are a different stat on a weapon than on anything else.
  const onBow = index.match('15% increased Attack Speed', 'explicit', 'Bow');
  const onRing = index.match('15% increased Attack Speed', 'explicit', 'Ring');
  assert.notDeepEqual(onBow.ids, onRing.ids);
  assert.deepEqual(onBow.ids, ['explicit.stat_210067635']);
  // "reduced" is the same stat as "increased", counted below zero.
  assert.equal(index.match('10% reduced Attack Speed', 'explicit', 'Ring').value, -10);
  // A fixed number that is part of the wording stays in it.
  assert.equal(index.match('1 Added Passive Skill is a Jewel Socket', 'enchant', 'Cluster Jewel').value, 1);
  // Stats the trade site only has as a total.
  const rarity = index.match('12% increased Rarity of Items found', 'explicit', 'Ring');
  assert.deepEqual([rarity.ids, rarity.value, rarity.pseudo], [['pseudo.pseudo_increased_rarity'], 12, true]);
  assert.equal(index.match('This line is no modifier at all', 'explicit', 'Ring'), null);
  assert.equal(index.match('+72 to maximum Life', 'enchant', 'Ring'), null);
  assert.deepEqual(index.pseudo('+# total maximum Life'), ['pseudo.pseudo_total_life']);
});

test('search choices: a rare is compared by its totals', () => {
  const f = buildFilters(parseItemText(RING), index);
  assert.equal(f.ok, true);
  assert.equal(f.title, 'Doom Loop, Two-Stone Ring');
  assert.deepEqual([f.category.id, f.category.enabled, f.type.enabled], ['accessory.ring', true, false]);
  // 72 life and half of 38 strength; 14% twice, and 41%.
  const life = stat(f, 'total maximum Life'), res = stat(f, 'total Elemental Resistance');
  assert.deepEqual([life.value, life.min, life.enabled], [91, 82, true]);
  assert.deepEqual([res.value, res.min, res.enabled], [69, 62, true]);
  assert.equal(stat(f, 'Shaper influence').enabled, true);
  // What went into a total is not listed again; the rest is listed, unticked.
  assert.equal(stat(f, '+72 to maximum Life'), undefined);
  assert.equal(stat(f, 'Lightning Resistance'), undefined);
  assert.deepEqual([stat(f, 'Chaos Resistance').enabled, stat(f, 'maximum Mana').kind], [false, 'crafted']);
  assert.equal(stat(f, 'Rarity of Items').kind, 'pseudo');
  assert.deepEqual(f.unknown, []);
  assert.equal(isNarrow(f), true);
  assert.equal(searchable(parseItemText(RING)), true);
});

test('search choices: weapons, uniques, magic items, cluster jewels and what cannot be searched', () => {
  const bow = buildFilters(parseItemText(BOW), index);
  const pdps = bow.props.find((p) => p.key === 'pdps'), edps = bow.props.find((p) => p.key === 'edps');
  assert.deepEqual([pdps.value, pdps.min, pdps.enabled, edps.enabled], [369, 332, true, false]);
  assert.equal(bow.flags.find((x) => x.key === 'links').enabled, true);
  assert.equal(stat(bow, 'Critical Strike Multiplier').enabled, true); // fractured
  assert.equal(stat(bow, 'Socketed Bow Gems').min, 1);

  const hh = buildFilters(parseItemText(HEADHUNTER), index);
  assert.deepEqual([hh.name, hh.type.value, hh.type.enabled, hh.category, hh.props], ['Headhunter', 'Leather Belt', true, null, []]);
  assert.deepEqual(hh.flags[0], { key: 'corrupted', label: 'Corrupted', value: true, enabled: true });
  assert.ok(hh.stats.length >= 3 && hh.stats.every((s) => !s.enabled));
  assert.deepEqual(hh.unknown, []); // flavour text is not reported

  const flask = buildFilters(parseItemText(FLASK), index);
  assert.deepEqual([flask.type, flask.category.id, flask.unknown.length], [null, 'flask', 0]);
  assert.equal(isNarrow(flask), false); // nothing ticked: searching would only find the cheapest flask
  // Fewer charges per use is better: the search asks for at least this much "reduced".
  assert.deepEqual([stat(flask, 'Charges per use').min, stat(flask, 'Charges per use').max], [null, -25]);

  const cluster = buildFilters(parseItemText(CLUSTER), index);
  assert.equal(cluster.category.id, 'jewel.cluster');
  assert.deepEqual([stat(cluster, 'Adds 8 Passive Skills').enabled, stat(cluster, 'Battle-Hardened').enabled, stat(cluster, 'Jewel Sockets').enabled], [true, true, false]);
  assert.deepEqual(stat(cluster, 'Adds 8 Passive Skills').max, 8);

  assert.equal(stat(buildFilters(parseItemText(BOOTS), index), 'Movement Speed').enabled, true);
  assert.equal(buildFilters(parseItemText('Item Class: Stackable Currency\nRarity: Currency\nChaos Orb\n--------\nStack Size: 3/20\n'), index).ok, false);
  assert.equal(searchable(parseItemText('Item Class: Stackable Currency\nRarity: Currency\nChaos Orb\n')), false);
  assert.match(buildFilters(parseItemText('Item Class: Rings\nRarity: Rare\nTwo-Stone Ring\n--------\nItem Level: 80\n--------\nUnidentified\n'), index).why, /Identify/);
  assert.equal(buildFilters(parseItemText('Item Class: Rings\nRarity: Rare\nDoom Loop\nSynthesised Two-Stone Ring\n--------\nItem Level: 80\n--------\n+72 to maximum Life\n'), index).type.value, 'Two-Stone Ring');
  assert.deepEqual([floorFor(1), floorFor(88), floorFor(-10), floorFor(1.5), floorFor(null)], [1, 79, -11, 1.4, null]);
});

test('search request: what is ticked becomes the trade site query', () => {
  const f = buildFilters(parseItemText(RING), index);
  const q = buildQuery(f);
  assert.deepEqual(q.sort, { price: 'asc' });
  assert.deepEqual(q.query.status, { option: 'available' });
  assert.deepEqual(q.query.filters.type_filters, { filters: { category: { option: 'accessory.ring' }, rarity: { option: 'nonunique' } } });
  assert.deepEqual(q.query.filters.misc_filters, { filters: { corrupted: { option: 'false' } } });
  assert.deepEqual(q.query.stats[0], { type: 'and', filters: [
    { id: 'pseudo.pseudo_has_shaper_influence' },
    { id: 'pseudo.pseudo_total_life', value: { min: 82 } },
    { id: 'pseudo.pseudo_total_elemental_resistance', value: { min: 62 } },
  ] });
  assert.equal(q.query.name, undefined);
  assert.equal(q.query.type, undefined);

  // The window's ticks and numbers are laid over the choices.
  const chaos = stat(f, 'Chaos Resistance');
  const edited = applyEdits(f, { offline: true, type: true, flags: { corrupted: false, ilvl: true }, stats: { 'pseudo:life': { enabled: false }, [chaos.key]: { enabled: true, min: '15', max: '' }, 'pseudo:res': { enabled: true, min: 'abc' } } });
  const q2 = buildQuery(edited);
  assert.deepEqual(q2.query.status, { option: 'any' });
  assert.equal(q2.query.type, 'Two-Stone Ring');
  assert.deepEqual(q2.query.filters.misc_filters, { filters: { ilvl: { min: 84 } } });
  assert.deepEqual(q2.query.stats[0].filters.map((x) => x.id), ['pseudo.pseudo_has_shaper_influence', 'pseudo.pseudo_total_elemental_resistance', chaos.ids[0]]);
  assert.deepEqual(q2.query.stats[0].filters[1], { id: 'pseudo.pseudo_total_elemental_resistance' }); // a number that is no number asks for any value
  assert.deepEqual(q2.query.stats[0].filters[2].value, { min: 15 });
  assert.equal(f.offline, false); // the first choices are left as they were

  const bow = buildQuery(buildFilters(parseItemText(BOW), index));
  assert.deepEqual(bow.query.filters.weapon_filters, { filters: { pdps: { min: 332 } } });
  assert.deepEqual(bow.query.filters.socket_filters, { filters: { links: { min: 6 } } });
  const bow2 = buildQuery(applyEdits(buildFilters(parseItemText(BOW), index), { props: { pdps: { enabled: false }, edps: { enabled: true, min: 150 } } }));
  assert.deepEqual(bow2.query.filters.weapon_filters, { filters: { edps: { min: 150 } } });

  const hh = buildQuery(buildFilters(parseItemText(HEADHUNTER), index));
  assert.deepEqual([hh.query.name, hh.query.type, hh.query.filters.type_filters], ['Headhunter', 'Leather Belt', undefined]);
  assert.deepEqual(hh.query.filters.misc_filters, { filters: { corrupted: { option: 'true' } } });

  // A stat stored the other way round on the trade site has its range turned over.
  const turned = buildQuery({ ok: true, rarity: 'Rare', flags: [], props: [], offline: false, stats: [{ key: 'a', ids: ['explicit.x'], enabled: true, min: null, max: 10, inverted: true }, { key: 'b', ids: ['explicit.y', 'explicit.z'], enabled: true, min: 5, max: null }] });
  assert.deepEqual(turned.query.stats[0].filters, [{ id: 'explicit.x', value: { min: -10 } }]);
  // One stat under several ids: any of them will do.
  assert.deepEqual(turned.query.stats[1], { type: 'count', value: { min: 1 }, filters: [{ id: 'explicit.y', value: { min: 5 } }, { id: 'explicit.z', value: { min: 5 } }] });
});

// A stand-in for the trade site: answers in order, and records what was asked.
function fakeSite(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const a = answers.shift() || { status: 500, body: null };
    const headers = new Map(Object.entries(a.headers || {}));
    return { status: a.status || 200, ok: (a.status || 200) < 400, headers: { get: (n) => (headers.has(n) ? headers.get(n) : null) }, json: async () => { if (a.body === null) throw new Error('not json'); return a.body; } };
  };
  return { calls, fetchImpl };
}
const LIMIT = (hits) => ({ 'x-rate-limit-rules': 'Ip', 'x-rate-limit-ip': '2:10:60', 'x-rate-limit-ip-state': `${hits}:10:0` });
const BODY = { query: { status: { option: 'available' } }, sort: { price: 'asc' } };

test('trade site: one search, then the cheapest ten, and never more than it allows', async () => {
  let now = 1000000;
  const ids = Array.from({ length: 25 }, (_, i) => `id${i}`);
  const site = fakeSite([
    { headers: LIMIT(1), body: { id: 'Q1', total: 25, result: ids } },
    { headers: LIMIT(1), body: { result: [{ id: 'id0', listing: { price: { amount: 5, currency: 'chaos' } } }, null] } },
    { headers: LIMIT(2), body: { id: 'Q2', total: 0, result: [] } },
  ]);
  const client = new TradeClient({ fetchImpl: site.fetchImpl, now: () => now });
  const r = await client.check('Hardcore Keepers', BODY);
  assert.deepEqual([r.queryId, r.total, r.listings.length], ['Q1', 25, 1]);
  assert.equal(site.calls[0].url, 'https://www.pathofexile.com/api/trade/search/Hardcore%20Keepers');
  assert.deepEqual([site.calls[0].init.method, site.calls[0].init.body], ['POST', JSON.stringify(BODY)]);
  assert.equal(site.calls[1].url, `https://www.pathofexile.com/api/trade/fetch/${ids.slice(0, 10).join(',')}?query=Q1`);

  // The same search again within a minute is answered from memory.
  assert.equal(await client.check('Hardcore Keepers', BODY), r);
  assert.equal(site.calls.length, 2);

  // Two searches are never sent within two seconds of each other.
  const other = { ...BODY, sort: { price: 'desc' } };
  await assert.rejects(client.check('Hardcore Keepers', other), /allows another search in 2 s/);
  assert.equal(site.calls.length, 2);
  now += 2000;
  // Now it is allowed (1 of 2 used); it finds nothing, so no second request is spent.
  assert.deepEqual(await client.check('Hardcore Keepers', other).then((x) => [x.total, x.listings]), [0, []]);
  assert.equal(site.calls.length, 3);

  // Now the site has counted 2 of 2 in ten seconds: the next search is refused here, unsent.
  const third = { ...BODY, sort: { indexed: 'desc' } };
  await assert.rejects(client.check('Hardcore Keepers', third), /allows another search in 10 s/);
  assert.equal(site.calls.length, 3);
  now += 10000;
  site.calls.length = 0;
  await assert.rejects(client.check('Hardcore Keepers', third), /did not answer the search \(500\)/); // sent again once the window has passed
  assert.equal(site.calls.length, 1);
  await assert.rejects(client.check('', BODY), /Choose a league/);
});

test('trade site: a lock-out, an error in words, and limits not told yet are all respected', async () => {
  let now = 5000000;
  const site = fakeSite([
    { status: 429, headers: { ...LIMIT(3), 'retry-after': '45' }, body: { error: { code: 3, message: 'Rate limit exceeded' } } },
    { status: 400, body: { error: { code: 2, message: 'Unknown stat provided' } } },
    { body: { id: 'Q', total: 1, result: ['a'] } },
    { body: { result: [{ id: 'a', listing: {} }] } },
  ]);
  const client = new TradeClient({ fetchImpl: site.fetchImpl, now: () => now });
  await assert.rejects(client.check('L', BODY), /Too many searches\. The trade site allows another in 45 s/);
  await assert.rejects(client.check('L', BODY), /another search in 45 s/);
  assert.equal(site.calls.length, 1);
  now += 60000;
  await assert.rejects(client.check('L', BODY), /The trade site said: Unknown stat provided/);
  // That answer carried no limits: the short pause is kept all the same.
  await assert.rejects(client.check('L', BODY), /another search in 2 s/);
  now += 2000;
  assert.equal((await client.check('L', BODY)).listings.length, 1);
  assert.equal(client.busy, false);

  assert.deepEqual(parseLimits('8:10:60,15:60:120', '1:10:0,3:60:30'), [{ max: 8, windowMs: 10000, hits: 1, lockedMs: 0 }, { max: 15, windowMs: 60000, hits: 3, lockedMs: 30000 }]);
  assert.deepEqual(parseLimits('', ''), []);
});

test('listings and the message in game', () => {
  const chaosOf = (amount, currency) => (currency === 'chaos' ? amount : currency === 'divine' ? amount * 200 : null);
  const raw = { id: 'x1', listing: { indexed: '2026-11-24T08:00:00Z', whisper: '@Seller Hi, I would like to buy your ring', account: { name: 'acc#1234', lastCharacterName: 'Seller', online: { league: 'L' } }, price: { type: '~b/o', amount: 2, currency: 'divine' } }, item: { name: 'Doom Loop', typeLine: 'Two-Stone Ring', ilvl: 84, corrupted: true } };
  const l = readListing(raw, chaosOf);
  assert.deepEqual([l.id, l.price, l.chaos, l.seller, l.status, l.itemLevel, l.corrupted, l.name], ['x1', { amount: 2, currency: 'divine' }, 400, 'Seller', 'online', 84, true, 'Doom Loop, Two-Stone Ring']);
  assert.equal(l.listedAt, Date.parse('2026-11-24T08:00:00Z'));
  assert.equal(readListing({ ...raw, listing: { ...raw.listing, account: { name: 'a', online: { status: 'afk' } } } }).status, 'afk');
  assert.equal(readListing({ ...raw, listing: { ...raw.listing, account: { name: 'a' } } }).status, 'offline');
  assert.equal(readListing({ ...raw, listing: { ...raw.listing, fee: { amount: 100, currency: 'gold' } } }).status, 'instant');
  assert.deepEqual([readListing({ id: 'y' }).price, readListing({ id: 'y' }).chaos, readListing(raw, () => null).chaos], [null, null, null]);
  assert.deepEqual([currencyName('divine'), currencyName('nonsense')], ['Divine Orb', '']);
  assert.equal(searchUrl('Hardcore Keepers', 'Q1'), 'https://www.pathofexile.com/trade/search/Hardcore%20Keepers/Q1');

  assert.deepEqual(summarize(37, [{ chaos: 45 }, { chaos: null }, { chaos: 120 }, { chaos: 300 }]), { total: 37, low: 45, median: 120 });
  assert.deepEqual(summarize(0, []), { total: 0, low: null, median: null });
  assert.deepEqual(summarize(4, [{ chaos: null }]), { total: 4, low: null, median: null });

  const filters = { ok: true, title: 'Doom Loop, Two-Stone Ring' };
  const done = { state: 'done', filters, summary: { total: 37, low: 45, median: 400 }, error: '' };
  assert.deepEqual(tradeMessage(done, 200), { title: 'Doom Loop, Two-Stone Ring: from 45c', detail: '37 listed. Middle of the cheapest 10: 2.00 div.', bad: false });
  assert.match(tradeMessage({ ...done, summary: { total: 0, low: null, median: null } }).title, /nothing like it is listed/);
  assert.match(tradeMessage({ ...done, summary: { total: 3, low: null, median: null } }).title, /3 listed/);
  assert.deepEqual(tradeMessage({ state: 'error', filters, error: 'The trade site allows another search in 4 s.' }), { title: 'Doom Loop, Two-Stone Ring: not searched', detail: 'The trade site allows another search in 4 s.', bad: true });
  assert.equal(tradeMessage({ state: 'searching', filters }), null);
  assert.equal(tradeMessage(null), null);

  // The check key's first message for gear says that a search is on its way, not "no price found".
  const at = 5000, price = { at, name: 'Two-Stone Ring', qty: 1, found: false };
  assert.equal(checkMessage({ priceCheck: price, tradeCheck: { at, state: 'searching', filters } }, 4000).title, 'Doom Loop, Two-Stone Ring: searching the trade site');
  assert.match(checkMessage({ priceCheck: price, tradeCheck: { at, state: 'idle', filters } }, 4000).detail, /Prices page/);
  assert.equal(checkMessage({ priceCheck: price, tradeCheck: { at, state: 'idle', filters: { ok: false, why: 'x' } } }, 4000).title, 'Two-Stone Ring: no price found');
  assert.equal(checkMessage({ priceCheck: price }, 4000).title, 'Two-Stone Ring: no price found');
  // Over the inventory the search still leads: gear is never counted as loot.
  const note = { at, text: 'Two-Stone Ring has no known price, so it is not counted.', bad: true };
  assert.deepEqual(checkMessage({ priceCheck: price, notice: note, tradeCheck: { at, state: 'searching', filters } }, 4000), { title: 'Doom Loop, Two-Stone Ring: searching the trade site', detail: '', bad: false });
  assert.deepEqual(checkMessage({ priceCheck: price, notice: note, tradeCheck: { at, state: 'error', error: 'A search is already running.', filters } }, 4000), { title: 'Doom Loop, Two-Stone Ring: not searched', detail: 'A search is already running.', bad: true });
});
