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
  assert.ok(rows.every((r) => r.totals['#% increased Armour'] >= 20));
  const gv = T.search(data, tableOf(1), { jewel: 'vanity', want: [{ tpl: '+#% to Lightning Resistance' }], sockets: [near(named('Eagle Eye'))], onlyNodes: ids, limit: 5000 });
  assert.ok(gv.some((r) => r.seed === 2000 && r.totals['+#% to Lightning Resistance'] >= 11));
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

// ---- builds, goals, verdicts ----
const B = require('../src/core/jewels/build');
const G = require('../src/core/jewels/goals');
const { verdict, GUIDE } = require('../src/core/jewels/guide');
const { JewelService } = require('../src/jewels');

// A small made-up build: the Instability and Eagle Eye corner, the socket near them, and a
// Glorious Vanity in that socket.
const inst = named('Instability'), eye = named('Eagle Eye');
const buildSocket = near(inst);
const lifeNodes = data.raw.tree.nodes.filter((n) => n.kind !== 'mastery' && (n.stats || []).some((l) => /maximum Life/.test(l))).slice(0, 12).map((n) => n.id);
const buildNodes = [inst.id, eye.id, buildSocket, ...lifeNodes];
const pobXml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" className="Ranger" ascendClassName="Deadeye" mainSocketGroup="1">
    <PlayerStat stat="Life" value="5200"/><PlayerStat stat="EnergyShield" value="120"/>
  </Build>
  <Tree activeSpec="2">
    <Spec treeVersion="3_27" classId="2" nodes="1,2"><Sockets/></Spec>
    <Spec treeVersion="3_27" classId="2" nodes="${buildNodes.join(',')}">
      <Sockets><Socket nodeId="${buildSocket}" itemId="7"/></Sockets>
    </Spec>
  </Tree>
  <Skills><SkillSet id="1"><Skill enabled="true"><Gem nameSpec="Tornado Shot"/></Skill></SkillSet></Skills>
  <Items><Item id="7">Rarity: UNIQUE
Glorious Vanity
Timeless Jewel
{range:0.5}Bathed in the blood of 2000 sacrificed in the name of Xibaqua
Passives in radius are Conquered by the Vaal &amp; more</Item></Items>
</PathOfBuilding>`;
const pobCode = zlib.deflateSync(Buffer.from(pobXml)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

test('build: where a pasted text points', () => {
  assert.deepStrictEqual(B.buildSource('https://pobb.in/AbC_12'), { url: 'https://pobb.in/AbC_12/raw' });
  assert.deepStrictEqual(B.buildSource('pastebin.com/xYz123'), { url: 'https://pastebin.com/raw/xYz123' });
  assert.ok(B.buildSource('https://example.com/x').error);
  assert.ok(B.buildSource('hello').error);
  assert.strictEqual(B.buildSource(pobCode).code, pobCode);
});

test('build: a Path of Building code gives the passives, class, skill and jewel', () => {
  const b = B.readPob(B.decodePob(pobCode), data);
  assert.strictEqual(b.className, 'Deadeye');
  assert.strictEqual(b.level, 92);
  assert.strictEqual(b.skill, 'Tornado Shot');
  assert.deepStrictEqual(b.nodes.sort(), buildNodes.filter((id) => data.byId.has(id)).sort()); // the active tree, not the first
  assert.deepStrictEqual(b.sockets, [buildSocket]);
  assert.deepStrictEqual(b.jewels, [{ jewel: 'vanity', seed: 2000, conqueror: 'Xibaqua', socket: buildSocket }]);
  assert.strictEqual(b.life, 5200);
  assert.throws(() => B.decodePob('not-a-code-at-all-but-long-enough-to-look-like-one'), /could not be read/);
});

test('build: a character from pathofexile.com', () => {
  const slot = data.raw.tree.jewelSlots.indexOf(buildSocket);
  const b = B.readCharacter({ hashes: buildNodes, items: [{ x: slot, name: 'Brutal Restraint', explicitMods: ['Denoted service of 4000 dekhara in the akhara of Nasima', 'Passives in radius are Conquered by the Maraketh'] }] }, { name: 'MyRanger', class: 'Deadeye', level: 90, league: 'Standard' }, data);
  assert.strictEqual(b.name, 'MyRanger');
  assert.deepStrictEqual(b.jewels, [{ jewel: 'restraint', seed: 4000, conqueror: 'Nasima', socket: buildSocket }]);
  assert.throws(() => B.readCharacter({ hashes: [] }, null, data), /no passives/);
});

test('build: how far each socket is, and what the build cares about', () => {
  const dist = D.distances(data, new Set(buildNodes));
  assert.strictEqual(dist[buildSocket], 0);
  assert.ok(Object.values(dist).some((v) => v > 0));
  const b = B.readPob(B.decodePob(pobCode), data);
  const i = G.interests(data, b);
  assert.strictEqual(i.defence, 'life'); // 5200 life against 120 energy shield
  assert.ok(G.interests(data, { ...b, life: null, energyShield: null, ci: true }).defence === 'es');
});

test('goals: plain choices turn into weighed lines', () => {
  const lines = T.searchable(data, 'vanity');
  const goals = G.goalsFor(lines);
  assert.ok(goals.some((g) => g.key === 'life') && goals.some((g) => g.key === 'minion'));
  const want = G.goalWant(lines, 'life');
  assert.ok(want.some((w) => w.tpl === '#% increased maximum Life'));
  // one full roll of a line counts about as 1, whatever its size
  const life = want.find((w) => w.tpl === '#% increased maximum Life');
  assert.ok(life.weight > 0 && life.weight < 1);
  assert.ok(!G.goalWant(lines, 'fire').some((w) => /Fire Resistance/.test(w.tpl)));
  assert.deepStrictEqual(G.goalWant(lines, 'nope'), []);
});

test('rank: one seed against every seed in its socket, and the verdict', () => {
  const ids = [inst.id, eye.id];
  const want = [{ tpl: '+#% to Lightning Resistance' }];
  const r = T.rank(data, tableOf(1), { jewel: 'vanity', want, socket: near(eye), seed: 2000, onlyNodes: ids });
  assert.strictEqual(r.count, 7901);
  assert.strictEqual(r.totals['+#% to Lightning Resistance'], 11);
  assert.ok(r.better < r.count && r.best.score >= r.score);
  // the scoring is kept between seeds: the same answer again, another seed, and a new
  // scoring when what is wanted changes
  const args = { jewel: 'vanity', want, socket: near(eye), seed: 2000, onlyNodes: ids };
  assert.deepStrictEqual(T.rank(data, tableOf(1), args), r);
  const other = T.rank(data, tableOf(1), { ...args, seed: 2001 });
  assert.strictEqual(other.count, 7901);
  assert.deepStrictEqual(other.best, r.best);
  const all = T.rank(data, tableOf(1), { ...args, onlyNodes: null });
  assert.ok(all.score >= r.score);
  assert.deepStrictEqual(T.rank(data, tableOf(1), args), r);
  const v = verdict({ r, goals: ['Resistances'], jewelKey: 'vanity' });
  assert.ok(['great', 'good', 'ok'].includes(v.level));
  assert.match(v.notes[0], /11% to Lightning Resistance/);
  // a seed that gives nothing wanted
  const none = verdict({ r: { ...r, score: 0, totals: {} }, jewelKey: 'vanity' });
  assert.strictEqual(none.level, 'poor');
});

test('verdict warns about a keystone that changes and small passives lost to Elegant Hubris', () => {
  const ks = named('Iron Reflexes');
  const sock = near(ks);
  const result = T.describe(data, tableOf(5), { jewel: 'hubris', seed: 2000, conqueror: 'Cadiro', socket: sock });
  const smalls = result.nodes.filter((n) => n.kind === 'small').slice(0, 3).map((n) => n.id);
  const v = verdict({ r: null, result, build: { nodes: [ks.id, ...smalls] }, jewelKey: 'hubris' });
  assert.ok(v.notes.some((n) => /Iron Reflexes turns into Supreme Decadence/.test(n)));
  assert.ok(v.notes.some((n) => /lose the stats of 3 small passives/.test(n)));
  assert.ok(Object.keys(GUIDE).length === 6);
});

test('service: builds from a link, and the account messages', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://pobb.in/abc/raw') return { ok: true, status: 200, text: async () => `${pobCode}\n` };
    if (url.includes('get-characters') && url.includes('Private')) return { ok: false, status: 403 };
    if (url.includes('get-characters')) return { ok: true, status: 200, json: async () => [{ name: 'MyRanger', league: 'Standard', level: 90, class: 'Deadeye' }] };
    if (url.includes('get-passive-skills')) return { ok: true, status: 200, json: async () => ({ hashes: buildNodes, items: [] }) };
    return { ok: false, status: 404 };
  };
  const svc = new JewelService({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'jewels-')), fetchImpl });
  const b = await svc.buildFromText('https://pobb.in/abc');
  assert.strictEqual(b.className, 'Deadeye');
  assert.strictEqual(b.distances[buildSocket], 0);
  assert.ok(b.interests.top.length >= 1);
  await assert.rejects(svc.characters('Private#1'), /private/);
  const c = await svc.character('Me#1234', 'MyRanger');
  assert.strictEqual(c.name, 'MyRanger');
  assert.ok(calls.some((u) => u.includes('accountName=Me%231234')));
  assert.ok(svc.goals('pride').some((g) => g.key === 'attributes'));
  svc.stop();
});
