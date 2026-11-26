'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItemText } = require('../src/core/itemText');
const { StatIndex, wordings } = require('../src/core/tradeStats');
const { searchable, buildFilters, applyEdits, isNarrow, buildQuery, summarize, floorFor, ticks } = require('../src/core/tradeQuery');
const { TradeClient, parseLimits, readListing, searchUrl, currencyName } = require('../src/core/tradeApi');
const { checkMessage, tradeMessage } = require('../src/core/checkMessage');
const { checkPanelBounds, inside, shouldClose, PANEL_WIDTH, IDLE_MS } = require('../src/core/checkPanel');

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
  const slower = index.match('10% reduced Attack Speed', 'explicit', 'Ring');
  assert.deepEqual([slower.value, slower.negated, index.match('10% increased Attack Speed', 'explicit', 'Ring').negated], [-10, true, false]);
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
  assert.deepEqual(bow.size, [2, 4]); // two wide: its sockets snake

  const hh = buildFilters(parseItemText(HEADHUNTER), index);
  assert.deepEqual([hh.name, hh.type.value, hh.type.enabled, hh.category, hh.props], ['Headhunter', 'Leather Belt', true, null, []]);
  assert.deepEqual(hh.size, [2, 1]);
  assert.deepEqual(hh.flags[0], { key: 'corrupted', label: 'Corrupted', value: true, enabled: true });
  assert.ok(hh.stats.length >= 3 && hh.stats.every((s) => !s.enabled));
  assert.deepEqual(hh.unknown, []); // flavour text is not reported

  const flask = buildFilters(parseItemText(FLASK), index);
  assert.deepEqual([flask.type, flask.category.id, flask.unknown.length], [null, 'flask', 0]);
  assert.equal(isNarrow(flask), false); // nothing ticked: searching would only find the cheapest flask
  // A "reduced" stat is searched as written, a tenth below the item's own: at least 23% reduced.
  assert.deepEqual([stat(flask, 'Charges per use').min, stat(flask, 'Charges per use').max], [null, -23]);

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
  // Numbers of 10 or more are whole: damage per second 211.03 gives 190, not 189.9.
  assert.deepEqual([floorFor(211.03), floorFor(12.5), floorFor(9.5)], [190, 11, 8.6]);
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
  assert.deepEqual(hh.query.filters.misc_filters, { filters: { corrupted: { option: 'true' }, twice_corrupted: { option: 'false' } } });

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
  const raw = { id: 'x1', listing: { indexed: '2026-11-24T08:00:00Z', account: { name: 'acc#1234', lastCharacterName: 'Seller', online: { league: 'L' } }, price: { type: '~b/o', amount: 2, currency: 'divine' } }, item: { name: 'Doom Loop', typeLine: 'Two-Stone Ring', ilvl: 84, corrupted: true } };
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
  assert.deepEqual(tradeMessage(done, 200), { title: 'Doom Loop, Two-Stone Ring: from 45c', detail: '37 listed. Typical price: 2.00 div.', bad: false });
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

test('price check window in game: beside the panel the item is in, and gone when no longer wanted', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 };
  // The game's inventory and stash panels are 666 points wide at 1080p.
  const inv = checkPanelBounds(screen, 1600, 500);
  assert.deepEqual(inv, { x: 1920 - 666 - PANEL_WIDTH, y: 76, width: PANEL_WIDTH, height: 500 });
  const stash = checkPanelBounds(screen, 300, 500);
  assert.deepEqual([stash.x, stash.y], [666, 76]);
  // Never taller than most of the screen, and on a second screen it stays on that screen.
  assert.equal(checkPanelBounds(screen, 300, 5000).height, 929);
  const second = checkPanelBounds({ x: 1920, y: 0, width: 2560, height: 1440 }, 1920 + 2400, 400);
  assert.deepEqual([second.x, second.y], [1920 + 2560 - 888 - PANEL_WIDTH, 101]);
  // A narrow screen: the two game panels would leave no room, so the window sits in the middle.
  const narrow = checkPanelBounds({ x: 0, y: 0, width: 1280, height: 1024 }, 1000, 400);
  assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 1280);

  // Dragged somewhere in layout mode: it opens there whichever side the item is on, and a
  // spot in the lower half of the screen keeps its bottom edge as the window gets taller.
  const high = { x: 0.1, y: 0.2, grow: 'down' }, low = { x: 0.5, y: 0.9, grow: 'up' };
  assert.deepEqual(checkPanelBounds(screen, 1600, 500, high), { x: 192, y: 216, width: PANEL_WIDTH, height: 500 });
  assert.deepEqual(checkPanelBounds(screen, 300, 500, high), checkPanelBounds(screen, 1600, 500, high));
  assert.deepEqual([checkPanelBounds(screen, 300, 300, low).y, checkPanelBounds(screen, 300, 500, low).y], [672, 472]);
  assert.deepEqual(checkPanelBounds(screen, 300, 500, { x: 0.99, y: 0.99, grow: 'down' }), { x: 1920 - PANEL_WIDTH, y: 580, width: PANEL_WIDTH, height: 500 }); // kept on the screen
  assert.deepEqual(checkPanelBounds(screen, 1600, 500, {}), inv); // nothing saved: the usual spot

  const rect = { x: 100, y: 100, width: 460, height: 300 };
  assert.deepEqual([inside(rect, { x: 100, y: 100 }), inside(rect, { x: 560, y: 200 }), inside(rect, { x: 565, y: 200 }, 12), inside(null, { x: 1, y: 1 })], [true, false, true, false]);

  // Never touched: it goes by itself, but not while an answer is on its way.
  assert.equal(shouldClose({ entered: false, sinceInside: 0, sinceNews: IDLE_MS - 1, busy: false }), false);
  assert.equal(shouldClose({ entered: false, sinceInside: 0, sinceNews: IDLE_MS + 1, busy: false }), true);
  assert.equal(shouldClose({ entered: false, sinceInside: 0, sinceNews: IDLE_MS + 1, busy: true }), false);
  // Once the mouse has been on it, it stays, also after the mouse has left it again.
  assert.equal(shouldClose({ entered: true, sinceInside: 100, sinceNews: IDLE_MS * 10, busy: false }), false);
  assert.equal(shouldClose({ entered: true, sinceInside: 60000, sinceNews: 60000, busy: false }), false);
});

const CLOAK_FULL = `Item Class: Body Armours
Rarity: Unique
Cloak of Flame
Scholar's Robe
--------
Energy Shield: 48
--------
Sockets: B-B-B-B B-B 
--------
Item Level: 85
--------
{ Corruption Implicit Modifier \u2014 Elemental, Fire }
4(4-6)% reduced Fire Damage taken (implicit)
--------
{ Unique Modifier \u2014 Physical, Elemental, Fire }
40% of Physical Damage taken as Fire Damage
{ Unique Modifier \u2014 Damage, Elemental, Fire }
Reflects 100 Fire Damage to Melee Attackers
{ Unique Modifier \u2014 Elemental, Fire, Resistance }
+62(50-75)% to Fire Resistance
{ Unique Modifier \u2014 Elemental, Fire, Ailment }
60(40-75)% increased Ignite Duration on Enemies
--------
Corrupted
--------
He who sows an ember shall reap an inferno.
`;
const RING_FULL = `Item Class: Rings
Rarity: Rare
Doom Loop
Two-Stone Ring
--------
Item Level: 84
--------
{ Implicit Modifier \u2014 Elemental, Fire, Cold, Resistance }
+14(12-16)% to Fire and Cold Resistances (implicit)
--------
{ Fractured Prefix Modifier "Rotund" (Tier: 3) \u2014 Life }
+72(70-79) to maximum Life (fractured)
{ Prefix Modifier "Annealed" (Tier: 6) \u2014 Damage, Physical, Attack }
Adds 8(6-9) to 14(13-15) Physical Damage to Attacks
{ Suffix Modifier "of the Maelstrom" (Tier: 2) \u2014 Elemental, Lightning, Resistance }
+41(36-41)% to Lightning Resistance
{ Master Crafted Suffix Modifier "of Craft" (Rank: 3) \u2014 Attribute }
+25(21-25) to Strength (crafted)
(Attributes grant bonuses)
{ Suffix Modifier "of Zzz" \u2014 Speed }
-12(-15--10)% to Chaos Resistance
1 Added Passive Skill is a Jewel Socket \u2014 Unscalable Value
--------
Fractured Item
`;

test('item text: the game\'s fuller text, with a line above each modifier and rolled ranges, reads the same', () => {
  const cloak = parseItemText(CLOAK_FULL);
  assert.deepEqual(cloak.modLines.filter((l) => l.section < 6).map((l) => [l.text, l.type, !!l.corruption]), [
    ['4% reduced Fire Damage taken', 'implicit', true],
    ['40% of Physical Damage taken as Fire Damage', 'explicit', false],
    ['Reflects 100 Fire Damage to Melee Attackers', 'explicit', false],
    ['+62% to Fire Resistance', 'explicit', false],
    ['60% increased Ignite Duration on Enemies', 'explicit', false],
  ]);
  const f = buildFilters(cloak, index);
  // Every modifier is offered and the corruption's own is named as such. On this corrupted
  // unique all of them are ticked (see the test on uniques), the fire resistance as its total.
  assert.deepEqual(f.stats.map((s) => [s.text, s.kind, s.enabled]), [
    ['+62% total Elemental Resistance', 'pseudo', true],
    ['4% reduced Fire Damage taken', 'corruption', true],
    ['40% of Physical Damage taken as Fire Damage', 'explicit', true],
    ['Reflects 100 Fire Damage to Melee Attackers', 'explicit', true],
    ['60% increased Ignite Duration on Enemies', 'explicit', true],
  ]);
  // "4% reduced" is searched as written: at least 4% reduced, which the trade site keeps as -4.
  const taken = f.stats[1];
  assert.deepEqual([taken.ids, taken.min, taken.max, taken.negated], [['implicit.stat_3743301799'], null, -4, true]);
  const q = buildQuery(applyEdits(f, { stats: Object.fromEntries(f.stats.map((x) => [x.key, { enabled: x === taken }])) }));
  assert.deepEqual(q.query.stats[0].filters, [{ id: 'implicit.stat_3743301799', value: { max: -4 } }]);
  assert.deepEqual([q.query.name, q.query.filters.misc_filters], ['Cloak of Flame', { filters: { corrupted: { option: 'true' }, twice_corrupted: { option: 'false' } } }]);

  const ring = parseItemText(RING_FULL);
  assert.deepEqual(ring.modLines.map((l) => [l.text, l.type]), [
    ['+14% to Fire and Cold Resistances', 'implicit'], ['+72 to maximum Life', 'fractured'], ['Adds 8 to 14 Physical Damage to Attacks', 'explicit'],
    ['+41% to Lightning Resistance', 'explicit'], ['+25 to Strength', 'crafted'], ['-12% to Chaos Resistance', 'explicit'], ['1 Added Passive Skill is a Jewel Socket', 'explicit'],
  ]);
  assert.deepEqual(ring.influences, []);
  const rf = buildFilters(ring, index);
  assert.equal(stat(rf, 'total Elemental Resistance').value, 69);
  assert.equal(stat(rf, 'total maximum Life').value, 84); // 72 and half of 25 strength
  assert.deepEqual(rf.unknown, []);

  // The short text of the same cloak gives the same stats, without knowing it is a corruption's.
  const short = CLOAK_FULL.split('\n').filter((l) => !l.startsWith('{')).join('\n').replace(/\(\d+-\d+\)/g, '');
  // Without the rolls nothing is combined into a total and nothing is ticked.
  const fromShort = buildFilters(parseItemText(short), index).stats;
  assert.deepEqual(fromShort.map((s) => [s.text, s.kind, s.enabled]), cloak.modLines.filter((l) => l.section < 6).map((l) => [l.text, l.type, false]));
  // A map's mods are read without the extra lines too.
  const map = parseItemText('Item Class: Maps\nRarity: Rare\nX\nStrand Map\n--------\nMap Tier: 16\n--------\nItem Level: 83\n--------\n{ Prefix Modifier "Punishing" (Tier: 1) }\nRare Monsters have Physical Thorns reflecting 800(400-800) Physical Damage\n{ Rare-only Suffix Modifier "of the Mirage" }\nArea contains a Mirage\n--------\nTwice Corrupted\n');
  assert.deepEqual(map.mods, ['Rare Monsters have Physical Thorns reflecting 800 Physical Damage', 'Area contains a Mirage']);
  assert.deepEqual([map.corrupted, map.twiceCorrupted], [true, true]);
  assert.equal(parseItemText('Item Class: Maps\nRarity: Rare\nX\nStrand Map\n--------\nMap Tier: 16\nAtlas Drops: +92% (augmented)\n--------\nItem Level: 83\n').quantity, 92);
});

test('3.30: a Twice Corrupted item is corrupted, and is compared with its like', () => {
  const once = buildFilters(parseItemText(HEADHUNTER), index);
  assert.deepEqual(once.flags.filter((f) => f.key === 'twice').map((f) => [f.label, f.value, f.enabled]), [['Corrupted once only', false, true]]);
  const item = parseItemText(HEADHUNTER.replace(/^Corrupted$/m, 'Twice Corrupted'));
  assert.deepEqual([item.corrupted, item.twiceCorrupted], [true, true]);
  assert.ok(!item.modLines.some((l) => /Corrupted/.test(l.text)));
  const f = buildFilters(item, index);
  assert.deepEqual(f.flags.filter((x) => x.key === 'twice').map((x) => [x.label, x.value, x.enabled]), [['Twice corrupted', true, true]]);
  assert.deepEqual(buildQuery(f).query.filters.misc_filters, { filters: { corrupted: { option: 'true' }, twice_corrupted: { option: 'true' } } });
  // unticked in the window: any corrupted one
  assert.deepEqual(buildQuery(applyEdits(f, { flags: { twice: false } })).query.filters.misc_filters, { filters: { corrupted: { option: 'true' } } });
  // an item that is not corrupted has no such choice
  assert.deepEqual(buildFilters(parseItemText(HEADHUNTER.replace(/^Corrupted$/m, 'Mirrored')), index).flags.filter((x) => x.key === 'twice'), []);
});

const FLASK_FULL = `Item Class: Utility Flasks
Rarity: Magic
Chemist's Quicksilver Flask of the Cheetah
--------
Item Level: 84
--------
{ Prefix Modifier "Chemist's" (Tier: 2) \u2014 Charges }
25(23-25)% reduced Charges per use
{ Suffix Modifier "of the Cheetah" (Tier: 1) \u2014 Speed }
14(12-14)% increased Movement Speed during Effect
`;

test('tiers of modifiers, and the search for the base item', () => {
  // The fuller text names each modifier's tier; a total shows the tiers of what went into it.
  const ring = parseItemText(RING_FULL);
  assert.deepEqual(ring.modLines.map((l) => l.tier || 0), [0, 3, 6, 2, 0, 0, 0]);
  const f = buildFilters(ring, index);
  assert.deepEqual(stat(f, 'total maximum Life').tiers, [3]);
  assert.deepEqual(stat(f, 'total Elemental Resistance').tiers, [2]); // the implicit has no tier
  assert.deepEqual(stat(f, 'Physical Damage to Attacks').tiers, [6]);
  assert.deepEqual(stat(f, 'Chaos Resistance').tiers, []);
  assert.deepEqual(stat(buildFilters(parseItemText(RING), index), 'total maximum Life').tiers, []); // the short text has none

  // Two ready-made searches. "Stats" is what is ticked from the start.
  assert.deepEqual(f.presets.stats, ticks(f));
  // "Base item": this base type at this item level, with what cannot be changed on it.
  const base = f.presets.base;
  assert.deepEqual([base.category, base.type, base['flag:ilvl'], base['flag:corrupted']], [false, true, true, true]);
  const life = stat(f, 'total maximum Life'), fractured = f.stats.find((x) => x.kind === 'fractured');
  // The fractured life counts in the total and is also listed by itself; only it stays in the base search.
  assert.deepEqual([fractured.text, fractured.enabled, fractured.tiers], ['+72 to maximum Life', true, [3]]);
  assert.equal(base[`stat:${life.key}`], false);
  assert.deepEqual(Object.keys(base).filter((k) => k.startsWith('stat:') && base[k]), [`stat:${fractured.key}`]);
  // As the windows send it: every tick by its name.
  const edits = { category: base.category, type: base.type, flags: { ilvl: true, corrupted: true }, stats: Object.fromEntries(f.stats.map((x) => [x.key, { enabled: base[`stat:${x.key}`] }])) };
  const q = buildQuery(applyEdits(f, edits));
  assert.equal(q.query.type, 'Two-Stone Ring');
  assert.deepEqual(q.query.filters.type_filters, { filters: { rarity: { option: 'nonunique' } } });
  assert.deepEqual(q.query.filters.misc_filters, { filters: { corrupted: { option: 'false' }, ilvl: { min: 84 } } });
  assert.deepEqual(q.query.stats[0].filters, [{ id: 'fractured.stat_3299347043', value: { min: 65 } }]);
  assert.equal(isNarrow(applyEdits(f, edits)), true);

  // An influenced, fractured base keeps both in its base search.
  const bow = buildFilters(parseItemText(BOW.replace('Fractured Item', 'Fractured Item\nShaper Item').replace('Item Level: 83', 'Item Level: 100')), index);
  const kept = Object.keys(bow.presets.base).filter((k) => k.startsWith('stat:') && bow.presets.base[k]);
  assert.deepEqual(kept.map((k) => bow.stats.find((x) => `stat:${x.key}` === k).text), ['Shaper influence', '+28% to Global Critical Strike Multiplier']);
  assert.equal(bow.presets.base['prop:pdps'], false);
  // Nothing rolls better above item level 86.
  assert.deepEqual(bow.flags.find((x) => x.key === 'ilvl'), { key: 'ilvl', label: 'Item level 86 or higher', value: 86, enabled: false });

  // A magic item's base type is its name without its affixes' names, once those are known.
  const flask = parseItemText(FLASK_FULL);
  assert.equal(flask.magicBase, 'Quicksilver Flask');
  const ff = buildFilters(flask, index);
  assert.deepEqual([ff.type, !!ff.presets, ff.presets.base.type], [{ value: 'Quicksilver Flask', enabled: false }, true, true]);
  assert.deepEqual(stat(ff, 'Movement Speed during Effect').tiers, [1]);
  assert.equal(buildFilters(parseItemText(FLASK), index).presets, undefined); // short text: base unknown
  // A unique has one search only.
  assert.equal(buildFilters(parseItemText(HEADHUNTER), index).presets, undefined);
});

const KAOM = `Item Class: Rings
Rarity: Unique
Kaom's Sign
Coral Ring
--------
Requirements:
Level: 20
--------
Item Level: 85
--------
{ Implicit Modifier \u2014 Life }
+30(20-30) to maximum Life (implicit)
--------
{ Unique Modifier \u2014 Attribute }
+17(10-20) to Strength
{ Unique Modifier }
+1 to Maximum Endurance Charges
{ Unique Modifier \u2014 Gem }
Grants Level 10 \u200bEnduring Cry \u2014 Unscalable Value
--------
Corrupted
--------
Kaom's strength was rivalled only by
the power of his ancestors.
`;

test('uniques: what can roll differently is ticked, as in Awakened PoE Trade', () => {
  // Corrupted: the life total (implicit 20 to 30, and half of 10 to 20 strength), the strength,
  // and the modifier that is normally fixed, since a corruption can change it. What cannot
  // change at all ("Unscalable Value") is listed, unticked.
  const f = buildFilters(parseItemText(KAOM), index);
  assert.deepEqual(f.stats.map((s) => [s.text, s.kind, s.enabled, s.min]), [
    ['+38 total maximum Life', 'pseudo', true, 37],          // 38.5, less a tenth of its range of 15
    ['+17 to Strength', 'explicit', true, 16],               // 17, less a tenth of its range of 10
    ['+1 to Maximum Endurance Charges', 'explicit', true, 1],
    ['Grants Level 10 \u200bEnduring Cry', 'explicit', false, 10],
  ]);
  const q = buildQuery(f);
  assert.deepEqual([q.query.name, q.query.type], ["Kaom's Sign", 'Coral Ring']);
  assert.deepEqual(q.query.stats[0].filters.map((x) => [x.id.split('.')[0], x.value.min]), [['pseudo', 37], ['explicit', 16], ['explicit', 1]]);

  // Not corrupted: the fixed modifier is the same on every copy, so it is left out of the search.
  const clean = buildFilters(parseItemText(KAOM.replace('Corrupted\n--------\n', '')), index);
  assert.deepEqual(clean.stats.map((s) => s.enabled), [true, true, false, false]);
  // The short item text does not say what can vary: nothing is ticked, nothing combined.
  const short = KAOM.split('\n').filter((l) => !l.startsWith('{')).join('\n').replace(/\(\d+-\d+\)/g, '').replace(' \u2014 Unscalable Value', '');
  assert.deepEqual(buildFilters(parseItemText(short), index).stats.map((s) => [s.text, s.enabled]), [
    ['+30 to maximum Life', false], ['+17 to Strength', false], ['+1 to Maximum Endurance Charges', false], ['Grants Level 10 \u200bEnduring Cry', false],
  ]);
  // A rare keeps its own rule: a tenth below its value, totals ticked.
  const ring = buildFilters(parseItemText(RING_FULL), index);
  assert.deepEqual([stat(ring, 'total maximum Life').min, stat(ring, 'total maximum Life').enabled, stat(ring, 'Physical Damage to Attacks').enabled], [76, true, false]);
});

test('listings: pictures, sockets, the number compared, bait prices', () => {
  const { compareSpec, markBait } = require('../src/core/tradeQuery');
  const { socketText } = require('../src/core/tradeApi');
  assert.equal(socketText([{ group: 0, sColour: 'R' }, { group: 0, sColour: 'G' }, { group: 1, sColour: 'B' }, { group: 1, sColour: 'W' }]), 'R-G B-W');
  assert.equal(socketText(undefined), '');
  assert.equal(socketText([{ group: 0, attr: 'S' }, { group: 0, attr: 'D' }, { group: 0, attr: 'I' }, { group: 1, sColour: 'DV' }]), 'R-G-B D'); // no colour given: from the attribute
  const raw = {
    id: 'q', listing: { price: { amount: 3, currency: 'chaos' }, account: { name: 'a' } },
    item: {
      icon: 'https://web.poecdn.com/gen/image/x.png', baseType: 'Viper Edge', w: 2, h: 3, sockets: [{ group: 0, sColour: 'R' }, { group: 0, sColour: 'R' }],
      extended: { pdps: 262.4, hashes: { explicit: [['explicit.stat_1', [1]], ['explicit.stat_2', [0]]] } },
      explicitMods: ['Adds 2 to 10 Lightning Damage', '+71 to maximum Life'],
    },
  };
  const byProp = readListing(raw, () => 3, { prop: 'pdps' });
  assert.deepEqual([byProp.icon, byProp.base, byProp.w, byProp.h, byProp.sockets, byProp.cmp], ['https://web.poecdn.com/gen/image/x.png', 'Viper Edge', 2, 3, 'R-R', 262.4]);
  assert.equal(readListing(raw, () => 3, { ids: ['explicit.stat_1'] }).cmp, 71);
  assert.equal(readListing(raw, () => 3, { ids: ['explicit.stat_2'] }).cmp, 6); // the average of 2 and 10
  assert.equal(readListing(raw, () => 3, { ids: ['nope'] }).cmp, null);
  assert.equal(readListing({ ...raw, item: { ...raw.item, icon: 'https://evil.example/x.png' } }).icon, null);

  const filters = { ok: true, props: [{ key: 'pdps', label: 'Physical damage per second', value: 250, enabled: true }], stats: [{ text: '+88 to maximum Life', ids: ['s'], value: 88, enabled: true }] };
  assert.deepEqual(compareSpec(filters), { prop: 'pdps', label: 'Physical damage per second', mine: 250, lower: false });
  filters.props[0].enabled = false;
  assert.deepEqual(compareSpec(filters), { ids: ['s'], label: '# to maximum Life', mine: 88, lower: false });
  filters.stats[0].enabled = false;
  assert.equal(compareSpec(filters), null);

  const ls = markBait([{ chaos: 1 }, { chaos: 10 }, { chaos: 11 }, { chaos: 12 }, { chaos: null }]);
  assert.deepEqual(ls.map((l) => !!l.bait), [true, false, false, false, false]);
  assert.deepEqual(markBait([{ chaos: 1 }, { chaos: 10 }]).map((l) => !!l.bait), [false, false]); // too few to tell
  assert.deepEqual(markBait([{ chaos: 0.1 }, { chaos: 0.1 }, { chaos: 1 }, { chaos: 1 }, { chaos: 1 }]).map((l) => !!l.bait), [false, false, false, false, false]); // a cheap item
});

test('disenchanting: the dust a unique gives, by item level, quality, influences and corruptions', () => {
  const { dustValue } = require('../src/core/dust');
  const hh = parseItemText(HEADHUNTER);
  assert.equal(dustValue(hh), Math.floor(891.16 * 2500)); // item level 85: counted as 84
  assert.equal(dustValue({ ...hh, itemLevel: 46 }), Math.floor(891.16 * 250));
  assert.equal(dustValue({ ...hh, quality: 20, influences: ['Shaper'], corruptionImplicits: 1 }), Math.floor(891.16 * 2500 * 2.4));
  assert.equal(dustValue({ name: 'Not a unique' }), null);
});

test('bulk exchange: one request, offers read as the price of one, cheapest first', async () => {
  const { TradeClient, readOffer, exchangeUrl } = require('../src/core/tradeApi');
  const offer = (id, pay, get, stock, status) => ({ id, listing: { indexed: '2026-11-20T10:00:00Z', account: { name: `a${id}`, lastCharacterName: `c${id}`, online: status ? { status } : null }, offers: [{ exchange: { currency: 'chaos', amount: pay }, item: { currency: 'alch', amount: get, stock } }] } });
  const site = fakeSite([{ headers: LIMIT(1), body: { id: 'X1', total: 37, result: { b: offer('b', 1, 3, 300, 'afk'), a: offer('a', 2, 10, 5000, 'online'), z: { id: 'z', listing: { offers: [] } } } } }]);
  const client = new TradeClient({ fetchImpl: site.fetchImpl, now: () => 1e6 });
  const r = await client.exchange('Keepers', 'alch', 'chaos');
  assert.equal(site.calls[0].url, 'https://www.pathofexile.com/api/trade/exchange/Keepers');
  assert.deepEqual(JSON.parse(site.calls[0].init.body), { engine: 'new', query: { status: { option: 'online' }, have: ['chaos'], want: ['alch'] }, sort: { have: 'asc' } });
  assert.deepEqual([r.queryId, r.total, r.offers.length], ['X1', 37, 2]); // the one offering nothing is left out
  await client.exchange('Keepers', 'alch', 'chaos'); // the same within a minute: not asked again
  assert.equal(site.calls.length, 1);
  const read = r.offers.map((o) => readOffer(o, (n, c) => (c === 'chaos' ? n : null)));
  assert.deepEqual(read.map((o) => [o.seller, Math.round(o.price.amount * 100) / 100, o.chaos !== null, o.stock, o.status]), [['cb', 0.33, true, 300, 'afk'], ['ca', 0.2, true, 5000, 'online']]);
  assert.equal(exchangeUrl('Keepers', 'X1'), 'https://www.pathofexile.com/trade/exchange/Keepers/X1');
});

test('a listing unfolds to the item as the game shows it: name, base, properties, every modifier', () => {
  const { itemDetail } = require('../src/core/tradeApi');
  const d = itemDetail({
    name: 'Rapture Shroud', typeLine: 'Royal Plate', frameType: 2, ilvl: 85, corrupted: true,
    properties: [{ name: 'Body Armour', values: [] }, { name: 'Quality', values: [['+20%', 1]] }, { name: '[Armour]', values: [['2548', 1]] }],
    implicitMods: ['+1 to Level of Socketed Gems'], explicitMods: ['+160 to maximum [Life|Life]'], craftedMods: ['13% increased Stun and Block Recovery'], fracturedMods: ['+394 to [Armour]'],
  });
  assert.deepEqual([d.name, d.base, d.rarity, d.ilvl, d.corrupted], ['Rapture Shroud', 'Royal Plate', 'rare', 85, true]);
  assert.deepEqual(d.props, [['Quality', '+20%'], ['Armour', '2548']]);
  // a modifier sent as an object instead of a line: its text is found all the same
  const o = itemDetail({ typeLine: 'Lion Pelt', explicitMods: [{ description: '+80 to maximum [Life|Life]', hash: 'x' }, { weird: 1 }] });
  assert.deepEqual(o.mods.map((m) => m.text), ['+80 to maximum Life', '(a modifier the app could not read)']);
  assert.equal(o.mods[1].raw, '{"weird":1}');
  assert.deepEqual(d.mods.map((m) => `${m.kind}: ${m.text}`), ['implicit: +1 to Level of Socketed Gems', 'fractured: +394 to Armour', 'explicit: +160 to maximum Life', 'crafted: 13% increased Stun and Block Recovery']);
});

test('worth: vendor recipes, the verdict at a glance, and room for a bench craft', () => {
  const { vendorRecipe, verdict, craftRoom, withCrafts } = require('../src/core/worth');
  assert.deepEqual(vendorRecipe({ sockets: 'R-G-B-B-R-G' }), { name: 'Orb of Fusing', count: 20, why: 'six linked sockets' });
  assert.deepEqual(vendorRecipe({ sockets: 'R-G B-B R-G' }).count, 7);
  assert.equal(vendorRecipe({ sockets: 'R-G-B' }).name, 'Chromatic Orb');
  assert.equal(vendorRecipe({ sockets: 'R-G B' }), null); // red, green and blue, but not linked together
  assert.equal(vendorRecipe({ sockets: '' }), null);

  assert.deepEqual(verdict({ price: 300, divine: 200 }), { kind: 'top', text: 'Valuable item!' });
  assert.equal(verdict({ price: 12, divine: 200 }).kind, 'sell');
  assert.equal(verdict({ price: 2, divine: 200, vendor: { chaos: 3 } }).kind, 'vendor');
  assert.equal(verdict({ price: 1, divine: 200 }).kind, 'low');
  assert.equal(verdict({ price: null, divine: 200 }), null);

  const ring = parseItemText(RING_FULL);
  assert.deepEqual(ring.slots, { prefix: 2, suffix: 3, crafted: true, known: true });
  assert.equal(craftRoom(ring, buildFilters(ring, index)), null); // it already has a crafted modifier
  assert.equal(parseItemText(CLOAK_FULL).corruptionImplicits, 1);
  assert.equal(craftRoom(parseItemText(BOOTS), null), null); // the short text: not known

  // Boots with an open prefix and suffix and no life on them: life is searched as a new total line.
  const boots = { rarity: 'Rare', slots: { prefix: 2, suffix: 2, crafted: false, known: true }, modLines: [{ text: '+38% to Fire Resistance', type: 'explicit' }, { text: '+12% to Cold Resistance', type: 'implicit' }] };
  const bf = { category: { label: 'Boots' }, stats: [{ key: 'pseudo:res', value: 80, min: 72, enabled: true }] };
  const br = craftRoom(boots, bf, index);
  assert.deepEqual(br.ideas.map((i) => [i.stat, i.add, i.priced, !!i.ids]), [['pseudo:life', 56, true, true], ['pseudo:res', 29, true, false]]);
  assert.equal(br.ideas[1].text, '+29–35% to Cold or Lightning Resistance'); // it has fire already (the implicit cold does not count)
  // what the bench would not take: life on an item with life, a resistance on one with all three
  const full = { ...boots, modLines: [{ text: '+80 to maximum Life', type: 'explicit' }, ...['Fire', 'Cold', 'Lightning'].map((e) => ({ text: `+30% to ${e} Resistance`, type: 'explicit' }))] };
  assert.equal(craftRoom(full, bf, index), null);
  assert.equal(craftRoom({ ...boots, slots: { ...boots.slots, suffix: 3 } }, { ...bf, category: { label: 'Jewel' } }, index), null); // a jewel: no bench crafts here
  const both = withCrafts(bf, br.ideas);
  assert.deepEqual(both.stats.map((x) => [x.key, x.min, x.enabled]), [['pseudo:res', 101, true], ['pseudo:life', 56, true]]);
  assert.deepEqual(bf.stats[0].min, 72); // the item's own choices are left as they were

  const { typicalPrice } = require('../src/core/worth');
  assert.deepEqual(typicalPrice([10, 12, 11, 30, 50, 9, 100, null]), { value: 14.4, n: 7 }); // the five cheapest
  assert.deepEqual(typicalPrice([10, 12]), { value: null, n: 2 }); // too few to tell
  // a stricter search keeps some of the same listings: its typical price is never lower
  const loose = [5, 6, 8, 9, 12, 15, 40], strict = [8, 12, 40, 41];
  assert.ok(typicalPrice(strict).value >= typicalPrice(loose).value);
});

test('bulk exchange: poe.ninja prices it, offers far under that are bait', () => {
  const { bulkPrice } = require('../src/core/worth');
  // RaQner's Dextral Catalyst (tracker #79): poe.ninja 144.2, the five cheapest averaged 12
  const offers = [1, 4, 10, 20, 25, 35, 40, 50, 80, 150].map((chaos) => ({ chaos }));
  assert.deepEqual(bulkPrice(offers, 144.2), { low: 80, typical: 144.2, from: 'ninja' });
  assert.deepEqual(offers.map((o) => o.bait), [true, true, true, true, true, true, true, true, false, false]);
  // plenty of honest offers: still poe.ninja's price, the offers are only listed
  const some = [1, 130, 140, 145, 150, 160, 200].map((chaos) => ({ chaos }));
  assert.deepEqual(bulkPrice(some, 144.2), { low: 130, typical: 144.2, from: 'ninja' });
  // a cheap thing: a low price is just a low price
  const cheap = [0.1, 0.5, 1, 1, 1].map((chaos) => ({ chaos }));
  assert.deepEqual(bulkPrice(cheap, 1), { low: 0.1, typical: 1, from: 'ninja' });
  assert.ok(cheap.every((o) => !o.bait));
  // no poe.ninja price: the offers as they are
  assert.deepEqual(bulkPrice([10, 12, 11, 30, 50].map((chaos) => ({ chaos })), null), { low: 10, typical: 22.6, from: 'offers' });
  assert.deepEqual(bulkPrice([{ chaos: 3 }, { chaos: 4 }], null), { low: 3, typical: 3, from: 'offers' });
});

test('the price check knows the item\'s quality, catalysts too', () => {
  assert.equal(buildFilters(parseItemText(BOW), index).quality, 20);
  assert.equal(buildFilters(parseItemText(RING), index).quality, 0);
  const ring = parseItemText(RING.replace('--------\n', '--------\nQuality (Attribute Modifiers): +20% (augmented)\n--------\n'));
  assert.deepEqual(ring.catalyst, { kind: 'Attribute', value: 20 });
  assert.equal(ring.quality, null);
});
