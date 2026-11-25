'use strict';
// Rebuilds src/core/data/jewels.json.gz, everything the Jewels page needs except the big
// timeless jewel tables (those are downloaded on first use, see src/core/jewels/tables.js).
//
//   node scripts/build-jewels.js <PathOfBuilding checkout> <skilltree-export checkout>
//
// Sources:
//  - the passive tree: GGG's skilltree-export (data.json), https://github.com/grindinggear/skilltree-export
//  - timeless jewel passives, node order of the tables, cluster jewels: Path of Building Community
//    (MIT licence, see src/core/data/NOTICE.md). Only these files are read:
//    src/Data/TimelessJewelData/{LegionPassives,NodeIndexMapping}.lua, src/Data/ClusterJewels.lua,
//    src/Data/ModJewelCluster.lua
// Run it when a league changes the tree. If Path of Building changed its tables too, also move
// POB_COMMIT in src/core/jewels/tables.js to the commit used here.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [pob, treeDir] = process.argv.slice(2);
if (!pob || !treeDir) { console.error('Give the Path of Building folder and the skilltree-export folder.'); process.exit(1); }
const read = (p) => fs.readFileSync(path.join(pob, p), 'utf8');

// ---- a small reader for the Lua table literals these files are made of ----
function parseLua(src) {
  let i = 0;
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('--', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
      return;
    }
  };
  const str = () => {
    const q = src[i++];
    let s = '';
    while (src[i] !== q) {
      if (src[i] === '\\') {
        const c = src[++i];
        s += c === 'n' ? '\n' : c === 't' ? '\t' : c;
        i++;
      } else s += src[i++];
    }
    i++;
    return s;
  };
  const value = () => {
    ws();
    const c = src[i];
    if (c === '{') return table();
    if (c === '"' || c === "'") return str();
    const m = /^(-?(?:0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?)|true|false|nil)/.exec(src.slice(i, i + 40));
    if (!m) throw new Error(`Cannot read Lua at ${i}: ${src.slice(i, i + 40)}`);
    i += m[0].length;
    return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'nil' ? null : Number(m[0]);
  };
  const table = () => {
    i++; // {
    const arr = [];
    const obj = {};
    let keyed = false;
    for (;;) {
      ws();
      if (src[i] === '}') { i++; break; }
      let key;
      if (src[i] === '[') {
        i++; key = value(); ws(); i++; // ]
        ws(); i++; // =
        keyed = true;
      } else {
        const m = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(src.slice(i, i + 80));
        if (m) { key = m[1]; i += m[0].length; keyed = true; }
      }
      const v = value();
      if (key === undefined) arr.push(v); else obj[key] = v;
      ws();
      if (src[i] === ',' || src[i] === ';') i++;
    }
    if (!keyed) return arr;
    arr.forEach((v, n) => { obj[n + 1] = v; });
    return obj;
  };
  const r = src.indexOf('return');
  i = r >= 0 ? r + 6 : 0;
  return value();
}
// Lua arrays written with [1] = ... keys come out as objects; this turns them into arrays.
const list = (t) => (Array.isArray(t) ? t : Object.keys(t || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => t[k]));

// ---- passive tree ----
// GGG's text links some words to their wiki page as [Page|Shown text] or [Word]: keep the shown text.
const plain = (line) => String(line).replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');
const tree = JSON.parse(fs.readFileSync(path.join(treeDir, 'data.json'), 'utf8'));
for (const n of Object.values(tree.nodes)) if (n.stats) n.stats = n.stats.map(plain);
const radii = tree.constants.orbitRadii;
const perOrbit = tree.constants.skillsPerOrbit;
const ANGLES = {
  16: [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330],
  40: [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230, 240, 250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350],
};
const angle = (orbit, idx) => {
  const n = perOrbit[orbit];
  return ((ANGLES[n] ? ANGLES[n][idx] : (360 * idx) / n) * Math.PI) / 180;
};
const ATTR = new Set(['Strength', 'Dexterity', 'Intelligence']);
const nodes = [];
const clusterNotables = {};
for (const [id, n] of Object.entries(tree.nodes)) {
  if (id === 'root') continue;
  if (n.group === undefined) {
    // Cluster jewel notables are kept without a place on the tree.
    if (n.isNotable && n.name) clusterNotables[n.name] = n.stats || [];
    continue;
  }
  const g = tree.groups[n.group];
  if (n.ascendancyName || n.isBloodline || n.isProxy || (n.expansionJewel && n.expansionJewel.parent)) continue;
  if (g.isProxy) continue;
  const a = angle(n.orbit, n.orbitIndex);
  const kind = n.isKeystone ? 'keystone' : n.isNotable ? 'notable' : n.isJewelSocket ? 'socket' : n.isMastery ? 'mastery' : n.classStartIndex !== undefined ? 'start' : 'small';
  const out = { id: Number(id), name: n.name, kind, x: Math.round(g.x + Math.sin(a) * radii[n.orbit]), y: Math.round(g.y - Math.cos(a) * radii[n.orbit]) };
  if (n.stats && n.stats.length && kind !== 'mastery') out.stats = n.stats;
  if (kind === 'small' && ATTR.has(n.name)) out.attr = true;
  const links = (n.out || []).map(Number).filter((o) => { const t = tree.nodes[o]; return t && !t.ascendancyName && !t.isProxy; });
  if (links.length) out.out = links;
  nodes.push(out);
}
const keep = new Set(nodes.map((n) => n.id));
for (const n of nodes) {
  if (n.out) n.out = n.out.filter((o) => keep.has(o));
  if (n.out && !n.out.length) delete n.out;
  if (n.kind === 'start' || n.kind === 'mastery') delete n.out; // the class starts and masteries draw no lines
}

// ---- timeless jewels ----
const legion = parseLua(read('src/Data/TimelessJewelData/LegionPassives.lua'));
const slimLegion = (e) => ({ id: e.id, name: e.dn, sd: list(e.sd).map(plain), stats: list(e.sortedStats).map((k) => ({ key: k, ...e.stats[k] })) });
const legionNodes = list(legion.nodes).map((e) => ({ ...slimLegion(e), ks: !!e.ks, not: !!e.not }));
const legionAdds = list(legion.additions).map(slimLegion);

const mapping = read('src/Data/TimelessJewelData/NodeIndexMapping.lua');
const nodeIndex = {};
for (const m of mapping.matchAll(/^nodeIDList\[(\d+)\] = \{ index = (\d+), size = (\d+) \}/gm)) nodeIndex[m[1]] = [Number(m[2]), Number(m[3])];
const localToGlobal = {};
for (const m of mapping.matchAll(/^nodeIDList\["localIdToGlobalId"\]\[(\d+)\]\[(\d+)\] = (\d+)/gm)) {
  // An id without an entry stays as it is (as in Path of Building), so only real changes are kept.
  if (m[2] !== m[3]) (localToGlobal[m[1]] = localToGlobal[m[1]] || {})[m[2]] = Number(m[3]);
}
const num = (re) => Number(re.exec(mapping)[1]);

// ---- cluster jewels ----
const clusters = parseLua(read('src/Data/ClusterJewels.lua'));
const jewels = Object.entries(clusters.jewels).map(([base, j]) => ({
  base, size: j.size, minNodes: j.minNodes, maxNodes: j.maxNodes,
  skills: Object.entries(j.skills).map(([key, s]) => ({ key, name: s.name, tag: s.tag, stats: list(s.stats).map(plain), enchant: list(s.enchant).map(plain) })),
}));
const mods = parseLua(read('src/Data/ModJewelCluster.lua'));
const notables = [];
for (const m of Object.values(mods)) {
  const line = m[1] || (Array.isArray(m) ? m[0] : '');
  const hit = /^1 Added Passive Skill is (.+)$/.exec(line || '');
  if (!hit || m.affix !== 'Notable') continue;
  const keys = list(m.weightKey), vals = list(m.weightVal);
  const mk = list(m.weightMultiplierKey), mv = list(m.weightMultiplierVal);
  const weights = {};
  keys.forEach((k, n) => { if (vals[n] > 0) weights[k] = vals[n]; });
  if (!Object.keys(weights).length) continue; // cannot roll any more (old notables)
  const sizes = ['large', 'medium', 'small'].filter((s) => { const n = mk.indexOf(`expansion_jewel_${s}`); return n >= 0 && mv[n] > 0; });
  const name = hit[1];
  notables.push({ name, prefix: m.type === 'Prefix', level: m.level, weights, sizes, order: clusters.notableSortOrder[name] || 0, stats: clusterNotables[name] || [] });
}

const data = {
  built: new Date().toISOString().slice(0, 10),
  // jewelSlots: the socket ids in the order the game's character data numbers them (an item's x).
  tree: { version: tree.tree, nodes, jewelSlots: tree.jewelSlots },
  timeless: {
    nodes: legionNodes, additions: legionAdds,
    index: nodeIndex, size: num(/nodeIDList\["size"\] = (\d+)/), notables: num(/nodeIDList\["sizeNotable"\] = (\d+)/),
    localToGlobal,
  },
  cluster: { jewels, notables },
};
const dest = path.join(__dirname, '..', 'src', 'core', 'data', 'jewels.json.gz');
fs.writeFileSync(dest, zlib.gzipSync(JSON.stringify(data), { level: 9 }));
console.log(`${nodes.length} tree nodes, ${legionNodes.length} timeless passives, ${legionAdds.length} additions, ${Object.keys(nodeIndex).length} indexed nodes, ${jewels.length} cluster sizes, ${notables.length} cluster notables -> ${dest} (${fs.statSync(dest).size} bytes)`);
