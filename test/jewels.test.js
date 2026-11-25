'use strict';
// The Jewels page: timeless jewels (checked against values known from the game), radius jewels,
// cluster jewels, and the table download.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const D = require('../src/core/jewels/data');
const T = require('../src/core/jewels/timeless');
const R = require('../src/core/jewels/radius');
const { Tables, POB_COMMIT } = require('../src/core/jewels/tables');

const data = D.load();
const named = (name) => data.raw.tree.nodes.find((n) => n.name === name);
const near = (node) => data.sockets.find((s) => D.dist2(s, node) <= D.RADIUS.large ** 2).id;

// Real slices of Path of Building's tables for two notables (Instability and Eagle Eye), built
// into empty tables of the right size, so these tests need no download.
const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'timeless.json.gz'))));
const SEEDS = { 1: 7901, 2: 8001, 3: 7501, 4: 8001, 5: 7901, 6: 7901 };
function table(type) {
  const t = data.timeless;
  if (type === 1) {
    const order = Object.values(t.index).sort((a, b) => a[0] - b[0]);
    const starts = {};
    let at = t.size * SEEDS[1];
    for (const [i, size] of order) { starts[i] = at; at += size; }
    const buf = Buffer.alloc(at);
    for (const f of fixture.vanity) {
      const i = t.index[f.node][0];
      Buffer.from(f.sizes, 'base64').copy(buf, i * SEEDS[1]);
      Buffer.from(f.block, 'base64').copy(buf, starts[i]);
    }
    return buf;
  }
  const buf = Buffer.alloc(t.notables * SEEDS[type]);
  for (const f of fixture.notables.filter((x) => x.type === type)) Buffer.from(f.bytes, 'base64').copy(buf, t.index[f.node][0] * SEEDS[type]);
  return buf;
}
const tables = {};
const tableOf = (type) => (tables[type] = tables[type] || table(type));

function changeOf(key, seed, conqueror, nodeName) {
  const node = named(nodeName);
  const jewel = T.jewelByKey(key);
  const r = T.describe(data, tableOf(jewel.type), { jewel: key, seed, conqueror, socket: near(node) });
  return r.nodes.find((n) => n.id === node.id);
}
const lines = (c) => c.parts.map((p) => `${p.tpl} ${p.vals.join(',')}`);

test('the tree has its sockets, named after what is near them', () => {
  assert.strictEqual(data.sockets.length, 21);
  assert.ok(data.sockets.every((s) => /^By /.test(s.label)));
  assert.ok(data.sockets.some((s) => s.label === 'By Iron Reflexes'));
});

test('Glorious Vanity replaces notables with rolled stats (seed 2000)', () => {
  const inst = changeOf('vanity', 2000, 'Xibaqua', 'Instability');
  assert.strictEqual(inst.mode, 'replace');
  assert.deepStrictEqual(lines(inst), ['#% Chance to Block Spell Damage 8', '#% increased Defences from Equipped Shield 22']);
  const eye = changeOf('vanity', 2000, 'Xibaqua', 'Eagle Eye');
  assert.strictEqual(eye.name, 'Legacy of the Vaal');
  assert.deepStrictEqual(lines(eye), ['+#% to Critical Strike Multiplier 6', '#% increased maximum Mana 5', '+#% to Lightning Resistance 11']);
});

test('the other jewels add a stat to notables or replace them', () => {
  assert.deepStrictEqual(lines(changeOf('pride', 12000, 'Kaom', 'Instability')).slice(-1), ['#% increased Armour 20']);
  assert.deepStrictEqual(lines(changeOf('pride', 12000, 'Kaom', 'Eagle Eye')).slice(-1), ['#% increased Totem Placement speed 12']);
  assert.deepStrictEqual(lines(changeOf('restraint', 2000, 'Asenath', 'Instability')).slice(-1), ['#% increased Flask Charges gained 10']);
  assert.deepStrictEqual(lines(changeOf('restraint', 2000, 'Asenath', 'Eagle Eye')).slice(-1), ['#% increased Projectile Damage 20']);
  assert.deepStrictEqual(lines(changeOf('faith', 2000, 'Avarius', 'Instability')).slice(-1), ['+# to Devotion 5']);
  const hub = changeOf('hubris', 2000, 'Cadiro', 'Instability');
  assert.strictEqual(hub.mode, 'replace');
  assert.deepStrictEqual(lines(hub), ['#% increased Effect of Shock 30']);
  assert.deepStrictEqual(lines(changeOf('hubris', 2000, 'Cadiro', 'Eagle Eye')), ['#% increased Physical Damage 80']);
});

test('keystones become the conqueror\'s keystone, small passives follow the jewel\'s rule', () => {
  const ks = named('Iron Reflexes');
  const sock = near(ks);
  const doryani = T.describe(data, tableOf(2), { jewel: 'pride', seed: 12000, conqueror: 'Rakiata', socket: sock });
  assert.strictEqual(doryani.nodes.find((n) => n.id === ks.id).name, 'Tempered by War');
  const small = doryani.nodes.find((n) => n.kind === 'small' && !n.attr && !data.byId.get(n.id).attr);
  assert.deepStrictEqual(small.parts.slice(-1), [{ tpl: '+# to Strength', vals: [4] }]);
  const attr = doryani.nodes.find((n) => n.kind === 'small' && data.byId.get(n.id).attr);
  if (attr) assert.deepStrictEqual(attr.parts.slice(-1), [{ tpl: '+# to Strength', vals: [2] }]);
  const hub = T.describe(data, tableOf(5), { jewel: 'hubris', seed: 2000, conqueror: 'Caspiro', socket: sock });
  assert.ok(hub.nodes.filter((n) => n.kind === 'small').every((n) => n.name === 'Price of Glory' && !n.parts.length));
});

test('seeds out of range or off the step are refused', () => {
  assert.throws(() => T.describe(data, tableOf(2), { jewel: 'pride', seed: 9000, conqueror: 'Kaom', socket: data.sockets[0].id }), /10000 to 18000/);
  assert.throws(() => T.describe(data, tableOf(5), { jewel: 'hubris', seed: 2010, conqueror: 'Cadiro', socket: data.sockets[0].id }), /steps of 20/);
});

test('reads the jewel from the text the game copies', () => {
  assert.deepStrictEqual(T.readJewelText('Rarity: Unique\nGlorious Vanity\nTimeless Jewel\n--------\nBathed in the blood of 4521 sacrificed in the name of Ahuana\n'), { jewel: 'vanity', seed: 4521, conqueror: 'Mazcotl' });
  assert.deepStrictEqual(T.readJewelText('Commissioned 13520 coins to commemorate Caspiro'), { jewel: 'hubris', seed: 13520, conqueror: 'Caspiro' });
  assert.deepStrictEqual(T.readJewelText('Remembrancing 2400 songworthy deeds by the line of Medved'), { jewel: 'tragedy', seed: 2400, conqueror: 'Medved' });
  // Separators in the number, Windows line ends, a written \n between lines (as the trade site shows it).
  assert.deepStrictEqual(T.readJewelText('Item Class: Jewels\r\nRarity: Unique\r\nElegant Hubris\r\nTimeless Jewel\r\n--------\r\nCommissioned 115,080 coins to commemorate Cadiro\\nPassives in radius are Conquered by the Eternal Empire\r\n'), { jewel: 'hubris', seed: 115080, conqueror: 'Cadiro' });
  assert.deepStrictEqual(T.readJewelText('Carved to glorify 6\u00a0248 new faithful converted by High Templar Dominus'), { jewel: 'faith', seed: 6248, conqueror: 'Dominus' });
  // Other wording: the jewel's name and a line with a conqueror and a number are enough.
  assert.deepStrictEqual(T.readJewelText('Lethal Pride\nTimeless Jewel\n--------\n13628 warriors follow Akoya'), { jewel: 'pride', seed: 13628, conqueror: 'Akoya' });
  // The advanced copy (Ctrl+Alt+C), as copied by the owner.
  const advanced = 'Item Class: Jewels\nRarity: Unique\nElegant Hubris\nTimeless Jewel\n--------\nLimited to: 1 Historic\nRadius: Large\n--------\nItem Level: 83\n--------\n{ Unique Modifier }\nCommissioned 24440(2000-160000) coins to commemorate Caspiro(...)\nPassives in radius are Conquered by the Eternal Empire\n(Conquered Passive Skills cannot be modified by other Jewels)\nHistoric \u2014 Unscalable Value\n--------\n';
  assert.deepStrictEqual(T.readJewelText(advanced), { jewel: 'hubris', seed: 24440, conqueror: 'Caspiro' });
  assert.deepStrictEqual(T.readJewelText('Bathed in the blood of 3200(100-8000) sacrificed in the name of Doryani(...)'), { jewel: 'vanity', seed: 3200, conqueror: 'Doryani' });
  assert.strictEqual(T.readJewelText('Rarity: Rare\nGloom Spark\nCobalt Jewel'), null);
});

test('search finds the seeds that give the wanted stats', () => {
  const ids = [named('Instability').id, named('Eagle Eye').id];
  // Lethal Pride seed 12000 gives Instability 20% increased Armour: a search for armour on these
  // two notables must list it.
  const rows = T.search(data, tableOf(2), { jewel: 'pride', want: [{ tpl: '#% increased Armour', min: 20 }], sockets: [near(named('Instability'))], onlyNodes: ids, limit: 5000 });
  assert.ok(rows.some((r) => r.seed === 12000));
  assert.ok(rows.every((r) => r.totals[0] >= 20));
  const gv = T.search(data, tableOf(1), { jewel: 'vanity', want: [{ tpl: '+#% to Lightning Resistance' }], sockets: [near(named('Eagle Eye'))], onlyNodes: ids, limit: 5000 });
  assert.ok(gv.some((r) => r.seed === 2000 && r.totals[0] >= 11));
  assert.ok(T.searchable(data, 'vanity').some((s) => s.tpl === '#% increased Armour'));
  assert.ok(T.searchable(data, 'faith').some((s) => s.tpl === '+# to Devotion'));
});

test('totals add up lines across passives', () => {
  const sum = T.totals([{ parts: [{ tpl: '+# to Strength', vals: [4] }] }, { parts: [{ tpl: '+# to Strength', vals: [2] }, { tpl: 'X', vals: [] }] }]);
  assert.deepStrictEqual(sum, [{ tpl: '+# to Strength', vals: [6], count: 2 }, { tpl: 'X', vals: [], count: 1 }]);
});

test('trade query asks for the seed with any current conqueror', () => {
  const q = T.tradeQuery('vanity', 4521);
  assert.deepStrictEqual(q.query.stats[0].filters.map((f) => f.id), ['explicit.pseudo_timeless_jewel_doryani', 'explicit.pseudo_timeless_jewel_xibaqua', 'explicit.pseudo_timeless_jewel_ahuana']);
  assert.deepStrictEqual(q.query.stats[0].filters[0].value, { min: 4521, max: 4521 });
});

test('radius jewels: rings, keystones, and what Unnatural Instinct and Might of the Meek give', () => {
  const sock = data.sockets[0].id;
  const ring = R.reach(data, { jewel: 'thread', socket: sock, ring: 'large' });
  assert.ok(ring.nodes.length > 0);
  assert.ok(ring.nodes.every((n) => { const d = D.dist2(n, ring.center); return d > 1680 ** 2 && d <= 2040 ** 2; }));
  const ci = named('Chaos Inoculation');
  assert.ok(R.reach(data, { jewel: 'escape', keystone: ci.id }).nodes.length > 5);
  const ui = R.reach(data, { jewel: 'instinct', socket: sock });
  const smalls = ui.nodes.filter((n) => n.kind === 'small');
  assert.strictEqual(R.radiusGain(ui, []).length, smalls.length);
  assert.strictEqual(R.radiusGain(ui, smalls.map((n) => n.id)).length, 0);
  const meek = R.reach(data, { jewel: 'meek', socket: sock });
  const one = meek.nodes.find((n) => n.kind === 'small' && /^\+?\d/.test(n.stats[0] || ''));
  const g = R.radiusGain(meek, [one.id])[0];
  assert.strictEqual(g.parts[0].vals[0], Math.round(Number(/\d+(\.\d+)?/.exec(one.stats[0])[0]) * 1.5 * 100) / 100);
});

test('cluster jewels: notables per enchant with their chance', () => {
  const r = R.clusterNotables(data, 'Medium Cluster Jewel', 'affliction_fire_damage_over_time_multiplier');
  assert.ok(r.notables.some((n) => n.name === 'Burning Bright'));
  const sum = (side) => r.notables.filter((n) => n.prefix === side).reduce((s, n) => s + n.chance, 0);
  assert.ok(Math.abs(sum(true) - 100) < 1);
  assert.ok(r.notables.every((n) => n.stats.length));
  assert.throws(() => R.clusterNotables(data, 'Small Cluster Jewel', 'nope'), /Pick/);
});

test('tables are downloaded once and kept', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewels-'));
  const packed = zlib.deflateSync(Buffer.from([1, 2, 3]));
  let calls = 0;
  const fetchImpl = async (url) => { calls++; assert.ok(url.includes(POB_COMMIT) && url.endsWith('LethalPride.zip')); return { ok: true, arrayBuffer: async () => packed }; };
  const t = new Tables({ dir, fetchImpl });
  assert.deepStrictEqual([...(await t.get(2))], [1, 2, 3]);
  assert.ok(t.isDownloaded(2));
  const again = new Tables({ dir, fetchImpl });
  assert.deepStrictEqual([...(await again.get(2))], [1, 2, 3]);
  assert.strictEqual(calls, 1);
  const broken = new Tables({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'jewels-')), fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(broken.get(3), /404/);
});
