'use strict';
// Timeless jewels: what a jewel with a given seed and conqueror does to the passives around a
// socket, and the other way round, which seeds give the stats you want. Pure: the tables come in
// as Buffers (see tables.js), the tree from data.js.
//
// How the tables work (the same as Path of Building, which made them):
//  - every passive that a timeless jewel can change has an index (data.timeless.index[nodeId]);
//    the first `notables` indexes are notables, the rest small passives.
//  - Lethal Pride, Brutal Restraint, Militant Faith, Elegant Hubris, Heroic Tragedy: one byte per
//    notable and seed, at index * seeds + (seed - first seed). It is a passive id local to the jewel;
//    `localToGlobal` turns it into the shared id. Ids from 337 up replace the notable with
//    timeless.nodes[id - 337]; lower ids add timeless.additions[id] to it. Small passives follow
//    fixed rules per jewel (smallRule below).
//  - Glorious Vanity changes every passive and rolls numbers, so its entries have different
//    lengths: first a byte per passive and seed with the length, then the entries one passive
//    after the other. Length 2 or 3: [id, roll, roll] (the passive is replaced). Length 6 or 8:
//    3 or 4 addition ids, then their rolls (the notable becomes Might or Legacy of the Vaal).
const { inRadius, RADIUS } = require('./data');

const ADDITIONS = 337;

// The six jewels. id: the conqueror's number in the keystone ids (vaal_keystone_3 and so on).
// `old` conquerors no longer drop but old jewels still exist (Standard), so their text is known.
const JEWELS = [
  { key: 'vanity', name: 'Glorious Vanity', type: 1, faction: 'vaal', min: 100, max: 8000,
    text: /Bathed in the blood of (\d+) sacrificed in the name of (\w+)/i,
    conquerors: [{ name: 'Doryani', id: '3' }, { name: 'Xibaqua', id: '1' }, { name: 'Mazcotl', id: '2_v2', also: ['Ahuana'] }, { name: 'Zerphi', id: '2', old: true }] },
  { key: 'pride', name: 'Lethal Pride', type: 2, faction: 'karui', min: 10000, max: 18000,
    text: /Commanded leadership over (\d+) warriors under (\w+)/i,
    conquerors: [{ name: 'Kaom', id: '1' }, { name: 'Rakiata', id: '2' }, { name: 'Akoya', id: '3_v2' }, { name: 'Kiloava', id: '3', old: true }] },
  { key: 'restraint', name: 'Brutal Restraint', type: 3, faction: 'maraketh', min: 500, max: 8000,
    text: /Denoted service of (\d+) dekhara in the akhara of (\w+)/i,
    conquerors: [{ name: 'Asenath', id: '2' }, { name: 'Nasima', id: '3' }, { name: 'Balbala', id: '1_v2' }, { name: 'Deshret', id: '1', old: true }] },
  { key: 'faith', name: 'Militant Faith', type: 4, faction: 'templar', min: 2000, max: 10000,
    text: /Carved to glorify (\d+) new faithful converted by High Templar (\w+)/i,
    conquerors: [{ name: 'Avarius', id: '3' }, { name: 'Dominus', id: '2' }, { name: 'Maxarius', id: '1_v2' }, { name: 'Venarius', id: '1', old: true }] },
  { key: 'hubris', name: 'Elegant Hubris', type: 5, faction: 'eternal', min: 2000, max: 160000, step: 20,
    text: /Commissioned (\d+) coins to commemorate (\w+)/i,
    conquerors: [{ name: 'Cadiro', id: '1' }, { name: 'Victario', id: '2' }, { name: 'Caspiro', id: '3_v2' }, { name: 'Chitus', id: '3', old: true }] },
  { key: 'tragedy', name: 'Heroic Tragedy', type: 6, faction: 'kalguur', min: 100, max: 8000,
    text: /Remembrancing (\d+) songworthy deeds by the line of (\w+)/i,
    conquerors: [{ name: 'Vorana', id: '1' }, { name: 'Uhtred', id: '2' }, { name: 'Medved', id: '3' }] },
];
const jewelByKey = (key) => JEWELS.find((j) => j.key === key);
const step = (j) => j.step || 1;
const seedCount = (j) => (j.max - j.min) / step(j) + 1;

// Reads a timeless jewel from the text the game copies (Ctrl+C on the item). Forgiving on
// purpose: numbers may come with separators (115,080 or 115 080), lines may be joined by a
// written "\n", and if the usual sentence is not found, the jewel's name plus a line with a
// conqueror's name and a number is enough.
const NUM = '(\\d[\\d.,\\u00a0\\u202f ]*\\d|\\d)';
const digits = (s) => Number(String(s).replace(/\D/g, ''));
function conquerorOf(j, word) {
  const name = String(word || '').toLowerCase();
  const c = j.conquerors.find((x) => x.name.toLowerCase() === name || (x.also || []).some((a) => a.toLowerCase() === name));
  return c ? c.name : null;
}
function readJewelText(text) {
  const t = String(text || '').replace(/\\n/g, '\n').replace(/\r/g, '').replace(/[\u00a0\u202f]/g, ' ')
    // The advanced copy (Ctrl+Alt+C) writes each roll's range right after it: "24440(2000-160000)", "Caspiro(...)".
    .replace(/(\S)\((?:[\d.,\s\u2013\u2014-]+|\.\.\.|\u2026)\)/g, '$1');
  for (const j of JEWELS) {
    const m = new RegExp(j.text.source.replace('(\\d+)', NUM), 'i').exec(t);
    if (m) return { jewel: j.key, seed: digits(m[1]), conqueror: conquerorOf(j, m[2]) };
  }
  // The sentence was not found: look for the jewel's name and a line naming one of its conquerors.
  for (const j of JEWELS) {
    if (!t.toLowerCase().includes(j.name.toLowerCase())) continue;
    for (const line of t.split('\n')) {
      const c = j.conquerors.find((x) => [x.name, ...(x.also || [])].some((n) => new RegExp(`\\b${n}\\b`, 'i').test(line)));
      const n = new RegExp(NUM).exec(line);
      if (c && n) return { jewel: j.key, seed: digits(n[1]), conqueror: c.name };
    }
  }
  return null;
}

// ---- stat lines as templates: "+#% to Fire Resistance" with the numbers apart ----
// Every line is kept as a template (numbers replaced by #) and its slots, so that lines can be
// added up across passives and searched quickly.
const tplIds = new Map();
const tplId = (t) => { if (!tplIds.has(t)) tplIds.set(t, tplIds.size); return tplIds.get(t); };

function scaleOf(stat) {
  if (stat.fmt !== 'g') return (v) => v;
  if (/per_minute/.test(stat.key)) return (v) => Math.round((v / 60) * 10) / 10;
  if (/permyriad/.test(stat.key)) return (v) => v / 100;
  if (/_ms/.test(stat.key)) return (v) => v / 1000;
  return (v) => v;
}

// One line of text with what each number in it is: a fixed number, or a stat that is rolled.
function compileLine(line, stats) {
  const used = new Set();
  const slots = [];
  const tpl = line.replace(/\((-?[\d.]+)-(-?[\d.]+)\)|(-?\d+(?:\.\d+)?)/g, (m, a, b, n) => {
    if (a !== undefined) {
      const lo = Number(a), hi = Number(b);
      let s = stats.find((x) => !used.has(x) && scaleOf(x)(x.min) === lo && scaleOf(x)(x.max) === hi);
      if (!s) s = stats.find((x) => !used.has(x) && x.min !== x.max);
      if (s) used.add(s);
      slots.push({ stat: s || null, lo, hi });
    } else {
      const v = Number(n);
      // Might and Legacy of the Vaal add rolls to a stat written with a fixed number.
      const s = stats.find((x) => !used.has(x) && x.min === x.max && scaleOf(x)(x.min) === v);
      if (s) used.add(s);
      slots.push({ stat: s || null, fixed: v });
    }
    return '#';
  });
  return { tpl, id: tplId(tpl), slots };
}

const compiled = new WeakMap();
function compileEntry(entry) {
  if (!compiled.has(entry)) compiled.set(entry, (entry.sd || []).map((l) => compileLine(l, entry.stats || [])));
  return compiled.get(entry);
}
const plainCache = new Map();
function compilePlain(lines) {
  const key = lines.join('\n');
  if (!plainCache.has(key)) plainCache.set(key, lines.map((l) => compileLine(l, [])));
  return plainCache.get(key);
}

// The numbers of a line with its rolls filled in (null for a range that has no roll).
function slotValues(line, rolls) {
  return line.slots.map((s) => {
    if (s.stat && rolls && rolls[s.stat.index] != null) return scaleOf(s.stat)(rolls[s.stat.index]);
    return s.fixed !== undefined ? s.fixed : null;
  });
}
function lineText(line, rolls) {
  const vals = slotValues(line, rolls);
  let k = 0;
  return line.tpl.replace(/#/g, () => { const s = line.slots[k], v = vals[k++]; return v == null ? `(${s.lo}-${s.hi})` : String(v); });
}
// What a part of a passive gives, as [{ tpl, vals }] (vals null where a range was not rolled).
const partLines = (lines, rolls) => lines.map((l) => ({ tpl: l.tpl, vals: slotValues(l, rolls) }));

// ---- one passive under a jewel ----
function nodeEntry(data, id) {
  const t = data.timeless;
  if (!t.byId) t.byId = new Map(t.nodes.map((n) => [n.id, n]));
  return t.byId.get(id);
}
const globalId = (data, type, local) => {
  const map = data.timeless.localToGlobal[type];
  return map && map[local] !== undefined ? map[local] : local;
};

// Glorious Vanity: where each seed's entry starts, per passive (worked out once per passive).
function vanityOffsets(data, table, index) {
  const t = data.timeless, seeds = seedCount(JEWELS[0]);
  if (!table.vanity) {
    // Where each passive's block starts: after the length bytes, the passives in index order.
    const starts = new Float64Array(t.size + 1);
    const order = Object.values(t.index).sort((a, b) => a[0] - b[0]);
    let at = t.size * seeds;
    for (const [i, size] of order) { starts[i] = at; at += size; }
    table.vanity = { starts, per: new Map() };
  }
  const v = table.vanity;
  if (!v.per.has(index)) {
    const off = new Uint32Array(seeds + 1);
    let at = 0;
    for (let s = 0; s < seeds; s++) { off[s] = at; at += table[index * seeds + s]; }
    off[seeds] = at;
    v.per.set(index, off);
  }
  return { start: v.starts[index], off: v.per.get(index) };
}

// What the tables say for one passive and seed: { replace: entry, rolls } or { add: [entry, rolls][] },
// or null when the passive stays as it is.
function lookup(data, jewel, table, node, tableSeed) {
  const t = data.timeless;
  const idx = t.index[node.id];
  if (!idx) return null;
  const s = tableSeed - jewel.min / step(jewel);
  if (jewel.type === 1) {
    const seeds = seedCount(jewel);
    const len = table[idx[0] * seeds + s];
    if (!len) return null;
    const { start, off } = vanityOffsets(data, table, idx[0]);
    const at = start + off[s];
    const bytes = table.subarray(at, at + len);
    if (len === 2 || len === 3) {
      const id = globalId(data, 1, bytes[0]);
      return { replace: t.nodes[id - ADDITIONS], rolls: Array.from(bytes) };
    }
    if (len === 6 || len === 8) {
      const half = len / 2;
      const ids = Array.from(bytes.subarray(0, half), (b) => globalId(data, 1, b));
      const sums = new Map();
      ids.forEach((id, k) => sums.set(id, (sums.get(id) || 0) + bytes[half + k]));
      const bias = ids.reduce((b, id) => b + (id <= 21 ? 1 : -1), 0);
      return { replace: t.nodes[bias >= 0 ? 76 : 77], rolls: [], add: [...sums].map(([id, roll]) => [t.additions[id], [0, roll]]) };
    }
    return null;
  }
  if (idx[0] >= t.notables) return null;
  const id = globalId(data, jewel.type, table[idx[0] * seedCount(jewel) + s]);
  if (id >= ADDITIONS) return { replace: t.nodes[id - ADDITIONS], rolls: null };
  return { add: [[t.additions[id], null]] };
}

// Small passives under the jewels other than Glorious Vanity always change the same way.
function smallRule(data, jewel, node) {
  const attr = !!node.attr;
  switch (jewel.faction) {
    case 'karui': return { add: [[null, null, [`+${attr ? 2 : 4} to Strength`]]] };
    case 'maraketh': return { add: [[null, null, [`+${attr ? 2 : 4} to Dexterity`]]] };
    case 'kalguur': return { add: [[null, null, [`${attr ? 1 : 2}% increased Ward`]]] };
    case 'templar': return attr ? { replace: nodeEntry(data, 'templar_devotion_node'), rolls: null } : { add: [[null, null, ['+5 to Devotion']]] };
    case 'eternal': return { replace: nodeEntry(data, 'eternal_small_blank'), rolls: null };
    default: return null;
  }
}

// One passive's change as plain data: name after, its lines as templates, and how it changed.
function change(data, jewel, conqueror, table, node, tableSeed) {
  let r;
  if (node.kind === 'keystone') {
    const c = jewel.conquerors.find((x) => x.name === conqueror) || jewel.conquerors[0];
    r = { replace: nodeEntry(data, `${jewel.faction}_keystone_${c.id}`), rolls: null };
  } else if (node.kind === 'notable' || jewel.type === 1) {
    r = lookup(data, jewel, table, node, tableSeed);
  } else {
    r = smallRule(data, jewel, node);
  }
  const before = compilePlain(node.stats || []);
  if (!r) return { mode: 'same', name: node.name, parts: partLines(before, null) };
  const parts = [];
  if (r.replace) parts.push(...partLines(compileEntry(r.replace), r.rolls));
  else parts.push(...partLines(before, null));
  for (const [entry, rolls, lines] of r.add || []) parts.push(...partLines(entry ? compileEntry(entry) : compilePlain(lines), rolls));
  return { mode: r.replace ? 'replace' : 'add', name: r.replace ? r.replace.name : node.name, parts };
}

function checkSeed(jewel, seed) {
  if (!Number.isInteger(seed) || seed < jewel.min || seed > jewel.max) return `${jewel.name} numbers go from ${jewel.min} to ${jewel.max}.`;
  if (seed % step(jewel)) return `${jewel.name} numbers are steps of ${step(jewel)}.`;
  return null;
}

// Everything a jewel does in one socket. table: the jewel's unpacked table (tables.js).
function describe(data, table, { jewel: key, seed, conqueror, socket }) {
  const jewel = jewelByKey(key);
  if (!jewel) throw new Error('Unknown jewel');
  const err = checkSeed(jewel, seed);
  if (err) throw new Error(err);
  const center = data.byId.get(socket);
  if (!center || center.kind !== 'socket') throw new Error('Pick a jewel socket.');
  const tableSeed = seed / step(jewel);
  const nodes = inRadius(data, center, RADIUS.large).map((n) => {
    const c = change(data, jewel, conqueror, table, n, tableSeed);
    return { id: n.id, kind: n.kind, x: n.x, y: n.y, was: n.name, before: n.stats || [], ...c };
  });
  return { jewel: key, seed, conqueror, socket, nodes };
}

// ---- searching seeds ----
// The stat lines a jewel can give, for the search list: [{ tpl, from }] where from says whether
// it comes from notables or small passives.
function searchable(data, key) {
  const jewel = jewelByKey(key);
  const t = data.timeless;
  const seen = new Map();
  const note = (tpl, from) => { if (!seen.has(tpl)) seen.set(tpl, new Set()); seen.get(tpl).add(from); };
  const mine = (e) => e && e.id.startsWith(`${jewel.faction}_`) && !e.ks;
  for (const e of t.nodes) if (mine(e)) for (const l of compileEntry(e)) note(l.tpl, /small|devotion_node|attribute/.test(e.id) ? 'small' : 'notable');
  for (const e of t.additions) if (mine(e)) for (const l of compileEntry(e)) note(l.tpl, /small|attribute/.test(e.id) ? 'small' : 'notable');
  if (jewel.type !== 1) {
    const fake = { attr: false };
    const r = smallRule(data, jewel, fake);
    for (const [, , lines] of (r && r.add) || []) for (const l of compilePlain(lines)) note(l.tpl, 'small');
  }
  // Lines with no number (most keystone-like effects) cannot be added up but can still be wanted.
  return [...seen].map(([tpl, from]) => ({ tpl, from: [...from] })).sort((a, b) => a.tpl.replace(/^[^A-Za-z]+/, '').localeCompare(b.tpl.replace(/^[^A-Za-z]+/, '')));
}

// What each wanted line adds up to for one change.
function addWanted(parts, wantIdx, acc) {
  for (const p of parts) {
    const k = wantIdx.get(p.tpl);
    if (k === undefined) continue;
    const v = p.vals.find((x) => x != null);
    acc[k] += v == null ? 1 : v; // a line without a number counts as 1 (it is there or not)
  }
}

// Glorious Vanity searches read the bytes straight away: going through change() for 60 passives
// and 7,901 seeds in every socket took ten seconds.
const wantCache = new WeakMap();
function wantedOf(entry, wantIdx) {
  let byWant = wantCache.get(entry);
  if (!byWant || byWant.idx !== wantIdx) {
    const list = [];
    for (const l of compileEntry(entry)) {
      const k = wantIdx.get(l.tpl);
      if (k === undefined) continue;
      const s = l.slots[0];
      if (!s) list.push({ k, fixed: 1 });
      else list.push({ k, at: s.stat ? s.stat.index : null, scale: s.stat ? scaleOf(s.stat) : null, fixed: s.fixed !== undefined ? s.fixed : (s.lo || 0) });
    }
    byWant = { idx: wantIdx, list };
    wantCache.set(entry, byWant);
  }
  return byWant.list;
}
function addVanity(data, table, node, s, wantIdx, acc) {
  const t = data.timeless;
  const idx = t.index[node.id];
  if (!idx) return;
  const len = table[idx[0] * seedCount(JEWELS[0]) + s];
  if (!len) return;
  const { start, off } = vanityOffsets(data, table, idx[0]);
  const at = start + off[s];
  if (len === 2 || len === 3) {
    for (const w of wantedOf(t.nodes[globalId(data, 1, table[at]) - ADDITIONS], wantIdx)) {
      acc[w.k] += w.at != null && w.at < len ? w.scale(table[at + w.at]) : w.fixed;
    }
  } else if (len === 6 || len === 8) {
    const half = len / 2;
    for (let k = 0; k < half; k++) {
      for (const w of wantedOf(t.additions[globalId(data, 1, table[at + k])], wantIdx)) acc[w.k] += w.at != null ? w.scale(table[at + half + k]) : w.fixed;
    }
  }
}

// Finds the seeds whose passives add up to the most of what is wanted.
// want: [{ tpl, min?, weight? }]. sockets: socket ids (all when empty). smalls: count small
// passives too (otherwise only notables). Returns the best `limit` as
// [{ seed, socket, score, totals: [n per wanted line] }].
function search(data, table, { jewel: key, want, sockets, smalls = false, limit = 50, onlyNodes = null }) {
  const jewel = jewelByKey(key);
  if (!want || !want.length) return [];
  const wantIdx = new Map(want.map((w, k) => [w.tpl, k]));
  const weights = want.map((w) => (w.weight == null ? 1 : Number(w.weight)));
  const mins = want.map((w) => Number(w.min) || 0);
  const ids = sockets && sockets.length ? sockets : data.sockets.map((s) => s.id);
  const best = [];
  const keep = (row) => {
    if (best.length < limit) { best.push(row); if (best.length === limit) best.sort((a, b) => b.score - a.score); return; }
    if (row.score <= best[best.length - 1].score) return;
    best[best.length - 1] = row;
    best.sort((a, b) => b.score - a.score);
  };
  const first = jewel.min / step(jewel), count = seedCount(jewel);
  for (const socket of ids) {
    const center = data.byId.get(socket);
    if (!center) continue;
    let nodes = inRadius(data, center, RADIUS.large).filter((n) => n.kind !== 'keystone');
    if (onlyNodes) nodes = nodes.filter((n) => onlyNodes.includes(n.id));
    const notables = nodes.filter((n) => n.kind === 'notable');
    const small = nodes.filter((n) => n.kind === 'small');
    // Small passives under the other jewels do not depend on the seed: add them once.
    const fixed = new Float64Array(want.length);
    if (smalls && jewel.type !== 1) for (const n of small) addWanted(change(data, jewel, null, table, n, first).parts, wantIdx, fixed);
    const varying = jewel.type === 1 && smalls ? notables.concat(small) : notables;
    // For the jewels other than Glorious Vanity a notable can only become a few things: work
    // out what each id adds once.
    const memo = new Map();
    for (let s = 0; s < count; s++) {
      const tableSeed = first + s;
      const acc = Float64Array.from(fixed);
      for (const n of varying) {
        if (jewel.type === 1) { addVanity(data, table, n, s, wantIdx, acc); continue; }
        const idx = data.timeless.index[n.id];
        if (!idx) continue;
        const b = table[idx[0] * count + s];
        let add = memo.get(`${n.id}:${b}`);
        if (!add) {
          add = new Float64Array(want.length);
          addWanted(change(data, jewel, null, table, n, tableSeed).parts, wantIdx, add);
          memo.set(`${n.id}:${b}`, add);
        }
        for (let k = 0; k < acc.length; k++) acc[k] += add[k];
      }
      let ok = true, score = 0;
      for (let k = 0; k < acc.length; k++) { if (acc[k] < mins[k]) ok = false; score += acc[k] * weights[k]; }
      if (ok && score > 0) keep({ seed: tableSeed * step(jewel), socket, score: Math.round(score * 100) / 100, totals: Array.from(acc, (v) => Math.round(v * 100) / 100) });
    }
  }
  return best.sort((a, b) => b.score - a.score || a.seed - b.seed);
}

// Adds up what the chosen passives give: [{ tpl, vals, count }], biggest first by count.
function totals(nodes) {
  const out = new Map();
  for (const n of nodes) {
    for (const p of n.parts) {
      const cur = out.get(p.tpl);
      if (!cur) out.set(p.tpl, { tpl: p.tpl, vals: p.vals.slice(), count: 1 });
      else { cur.count++; cur.vals = cur.vals.map((v, k) => (v == null || p.vals[k] == null ? v : Math.round((v + p.vals[k]) * 100) / 100)); }
    }
  }
  return [...out.values()];
}

// The official trade site query for a jewel with this seed (any of its conquerors when none given).
function tradeQuery(key, seed, conqueror) {
  const jewel = jewelByKey(key);
  // The trade site still calls Mazcotl by the old name Ahuana.
  const names = jewel.conquerors.filter((c) => !c.old && (!conqueror || c.name === conqueror)).map((c) => (c.also ? c.also[0] : c.name).toLowerCase());
  const filters = names.map((n) => ({ id: `explicit.pseudo_timeless_jewel_${n}`, value: { min: seed, max: seed } }));
  return { query: { status: { option: 'online' }, name: jewel.name, type: 'Timeless Jewel', stats: [{ type: 'count', value: { min: 1 }, filters }] }, sort: { price: 'asc' } };
}

module.exports = { JEWELS, jewelByKey, readJewelText, describe, search, searchable, totals, tradeQuery, lineText, compileLine, checkSeed };
