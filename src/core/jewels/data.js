'use strict';
// The passive tree and jewel data for the Jewels page, read once from data/jewels.json.gz
// (built by scripts/build-jewels.js). Pure: no Electron, no network.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FILE = path.join(__dirname, '..', 'data', 'jewels.json.gz');

// Jewel radius sizes on the current tree (since 3.16), in tree units.
const RADIUS = { small: 960, medium: 1440, large: 1800, veryLarge: 2400, massive: 2880 };
// Thread of Hope only reaches a ring.
const RINGS = {
  small: [960, 1320], medium: [1320, 1680], large: [1680, 2040], veryLarge: [2040, 2400], massive: [2400, 2880],
};

let cached = null;

function load(file = FILE) {
  if (cached && cached.file === file) return cached;
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const byId = new Map(raw.tree.nodes.map((n) => [n.id, n]));
  // Lines between nodes, each once.
  const links = [];
  for (const n of raw.tree.nodes) for (const o of n.out || []) if (byId.has(o)) links.push([n.id, o]);
  const sockets = raw.tree.nodes.filter((n) => n.kind === 'socket').map((s) => ({ id: s.id, x: s.x, y: s.y, label: socketLabel(raw.tree.nodes, s) }));
  sockets.sort((a, b) => a.label.localeCompare(b.label));
  cached = { file, raw, byId, links, sockets, timeless: raw.timeless, cluster: raw.cluster, version: raw.tree.version };
  return cached;
}

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// A socket is named after what is near it: a keystone in a timeless jewel's reach first (that is
// what people remember), otherwise the closest notable.
function socketLabel(nodes, s) {
  let best = null, bestD = Infinity, key = null, keyD = Infinity;
  for (const n of nodes) {
    const d = dist2(n, s);
    if (n.kind === 'keystone' && d <= RADIUS.large ** 2 && d < keyD) { key = n; keyD = d; }
    if (n.kind === 'notable' && d < bestD) { best = n; bestD = d; }
  }
  return (key || best) ? `By ${(key || best).name}` : `Socket ${s.id}`;
}

// The nodes within reach of a point, closest first. inner/outer are distances; inner is excluded,
// outer included (as in the game).
function inRadius(data, center, outer, inner = 0) {
  const out = [];
  for (const n of data.raw.tree.nodes) {
    if (n.id === center.id || n.kind === 'start' || n.kind === 'mastery' || n.kind === 'socket') continue;
    const d = dist2(n, center);
    if (d <= outer * outer && d > inner * inner) out.push(n);
  }
  return out.sort((a, b) => dist2(a, center) - dist2(b, center));
}

// The tree around a point, for drawing: nodes and lines inside a square of the given half size.
function area(data, center, half) {
  const inside = (n) => Math.abs(n.x - center.x) <= half && Math.abs(n.y - center.y) <= half;
  const nodes = data.raw.tree.nodes.filter(inside).map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y, name: n.name }));
  const keep = new Set(nodes.map((n) => n.id));
  const links = data.links.filter(([a, b]) => keep.has(a) || keep.has(b)).map(([a, b]) => {
    const p = data.byId.get(a), q = data.byId.get(b);
    return [p.x, p.y, q.x, q.y];
  });
  return { nodes, links };
}

// How many passives a build still has to take to reach each socket (0 = it has it).
// taken: Set of node ids. Lines are walked both ways; class starts count as reached by their
// neighbours.
function distances(data, taken) {
  if (!data.adj) {
    data.adj = new Map();
    for (const [a, b] of data.links) {
      if (!data.adj.has(a)) data.adj.set(a, []);
      if (!data.adj.has(b)) data.adj.set(b, []);
      data.adj.get(a).push(b); data.adj.get(b).push(a);
    }
  }
  const dist = new Map();
  const queue = [];
  for (const id of taken) if (data.byId.has(id)) { dist.set(id, 0); queue.push(id); }
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    for (const next of data.adj.get(at) || []) {
      if (dist.has(next)) continue;
      const n = data.byId.get(next);
      if (!n || n.kind === 'mastery') continue;
      dist.set(next, dist.get(at) + 1);
      queue.push(next);
    }
  }
  const out = {};
  for (const s of data.sockets) out[s.id] = dist.has(s.id) ? dist.get(s.id) : null;
  return out;
}

// The whole tree, small, for picking a socket: every node as a dot and every line.
function overview(data) {
  if (data.overview) return data.overview;
  const nodes = data.raw.tree.nodes.filter((n) => n.kind !== 'mastery').map((n) => [n.x, n.y, n.kind === 'keystone' ? 3 : n.kind === 'notable' ? 2 : n.kind === 'socket' ? 4 : 1, n.id]);
  const links = data.links.map(([a, b]) => { const p = data.byId.get(a), q = data.byId.get(b); return [p.x, p.y, q.x, q.y]; });
  data.overview = { nodes, links, sockets: data.sockets };
  return data.overview;
}

module.exports = { load, inRadius, area, overview, distances, RADIUS, RINGS, dist2 };
