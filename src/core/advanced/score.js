'use strict';
// The advanced price check's own search for a rare. The item is scored with the value table
// (values.js); then the trade site is asked for items of its kind with about the same score,
// not the same exact stats: an item with other stats of the same worth counts as "like it",
// so there are matches where an exact search finds none. What the item is plainly bought for
// (20% spell suppression, +1 to gems, its damage) is asked for outright on top of that.
// When too few are listed the search is widened step by step. Plain logic, no Electron.

const { PROFILES, TOTALS, BENCH, WORTH_FROM } = require('./values');
const { buildFilters, buildQuery, gearKind } = require('../tradeQuery');

// The ways a modifier can be on an item, each with its own id on the trade site.
const KINDS = ['explicit', 'fractured', 'crafted', 'implicit'];
// The trade site takes a search of limited size. Path of Building, which sends the same kind of
// search, counts 54 for the weighted part, 4 per stat and 200 in all: about 34 stats. MAX_STATS
// is every stat of a search together (weighed and asked for outright), with some room left.
const MAX_STATS = 30, MAX_WEIGHTS = 26, LEAST_WEIGHTS = 10;
// The steps of a search, strict first: how much of the item's score a listing needs, and how
// much of each selling point (null: no longer asked for outright).
const STEPS = [{ score: 0.9, point: 0.9 }, { score: 0.78, point: 0.75 }, { score: 0.65, point: null }];

// Every modifier line of the item with the trade site's stat for it, read as buildFilters reads
// them (a modifier can run over several lines; the longest run is tried first).
function readLines(item, index, category) {
  const lines = item.modLines || [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let hit = null;
    for (let n = Math.min(3, lines.length - i); n >= 1 && !hit; n--) {
      const run = lines.slice(i, i + n);
      if (run.some((l) => l.section !== run[0].section || l.type !== run[0].type || l.group !== run[0].group)) continue;
      const found = index.match(run.map((l) => l.text).join('\n'), run[0].type, category);
      if (found) hit = { ref: found.ref, value: found.value, type: found.pseudo ? 'total' : run[0].type, tier: run[0].tier || null, text: run.map((l) => l.text).join(' '), n };
    }
    if (hit) { out.push(hit); i += hit.n - 1; } else out.push({ ref: null, value: null, type: lines[i].type, tier: lines[i].tier || null, text: lines[i].text, n: 1 });
  }
  return out;
}

// The trade site's ids for one stat of the table on this kind of item: a total has one; a
// modifier one for each way it can be on an item. null: the site has no such stat there.
function idsOf(stat, index, category) {
  if (stat.t) { const ids = index.pseudo(stat.t); return ids && ids.length ? { ref: stat.t, total: ids[0] } : null; }
  const out = { ref: null };
  for (const kind of KINDS) {
    const f = index.match(stat.m, kind, category);
    if (f && !f.pseudo && f.ids && f.ids.length) { out.ref = out.ref || f.ref; out[kind] = f.ids; }
  }
  return out.ref ? out : null;
}

// What a stat is made of on the item: the modifiers that count towards it, and how much.
const madeOf = (stat, ids) => (stat.t ? (TOTALS[stat.t] || { [stat.t]: 1 }) : { [ids.ref]: 1 });

// One profile against one item: every stat's worth in points. null: this buyer does not want it.
function scoreFor(profile, { item, category, index, lines }) {
  const entries = [];
  for (const stat of profile.stats) {
    if (stat.on && !stat.on.includes(category)) continue;
    const ids = idsOf(stat, index, category);
    if (!ids) continue;
    const parts = madeOf(stat, ids);
    let value = 0;
    const kinds = new Set();
    for (const l of lines) {
      if (!l.ref || l.value === null || l.type === 'enchant' || !parts[l.ref]) continue;
      value += l.value * parts[l.ref];
      if (KINDS.includes(l.type)) kinds.add(l.type);
    }
    value = Math.max(0, value);
    entries.push({ stat, ids, value, points: value * stat.w, kinds: [...kinds] });
  }
  let prop = null;
  if (profile.prop) {
    const p = profile.prop, props = item.props || {};
    // a weapon is bought for the larger of its two kinds of damage
    const phys = Math.round(props.pdps || 0), ele = Math.round(props.edps || 0);
    const value = p.key === 'dps' ? Math.max(phys, ele) : Math.round(props[p.of] || 0);
    const bench = (BENCH[p.key] || {})[category];
    if (!bench || value < bench * p.least) return null;
    prop = { key: p.key === 'dps' ? (phys >= ele ? 'pdps' : 'edps') : p.key, group: p.group, floor: p.floor, as: p.as, value, points: (p.points * value) / bench };
  }
  if (profile.need) {
    const got = entries.filter((e) => e.stat.as === profile.need.as).reduce((n, e) => n + e.points, 0);
    if (got < profile.need.points) return null;
  }
  const statScore = entries.reduce((n, e) => n + e.points, 0);
  return { profile, entries, prop, statScore, score: statScore + (prop ? prop.points : 0) };
}

// The weighted part of the search: each stat with its points per 1. Stats the item has go in
// first (most points first, in the way they are on this item), then the rest of the table and
// the other ways a modifier can be on an item, while there is room.
// max: how many stats there is room for. lean: only what the item has (a smaller search, sent
// when the site finds the full one too large).
function weightsFor(entries, max = MAX_WEIGHTS, lean = false) {
  const has = entries.filter((e) => e.points > 0).sort((a, b) => b.points - a.points);
  const order = lean ? has : [...has, ...entries.filter((e) => !(e.points > 0))];
  const out = [], seen = new Set();
  const add = (id, w) => {
    if (seen.has(id)) return true;
    if (out.length >= max) return false;
    seen.add(id); out.push({ id, value: { weight: w } });
    return true;
  };
  for (const e of order) {
    if (e.ids.total) { e.searched = add(e.ids.total, e.stat.w); continue; }
    e.searched = false;
    for (const k of (e.kinds.length ? e.kinds : ['explicit'])) for (const id of e.ids[k] || []) e.searched = add(id, e.stat.w) || e.searched;
  }
  if (!lean) for (const e of order) {
    if (e.ids.total) continue;
    for (const k of KINDS.slice(0, 3)) for (const id of e.ids[k] || []) add(id, e.stat.w);
  }
  return out;
}

// The ids a selling point is asked for under: the way it is on this item, and the usual ways.
const pointIds = (e) => (e.ids.total ? [e.ids.total] : [...new Set([...e.kinds, 'explicit', 'fractured', 'crafted'].flatMap((k) => e.ids[k] || []))]);

// The lowest value still asked for when `share` of the item's own is enough. A whole number
// stays one, and at least 1 ("+1 to Level of all Skill Gems" must not become 0).
function lowest(value, share) {
  const v = value * share;
  return Number.isInteger(value) ? Math.max(value >= 1 ? 1 : 0, Math.floor(v + 1e-9)) : Math.round(v * 10) / 10;
}

// What the item is plainly bought for: its two strongest stats that reach the table's `from`.
function pointsOf(entries) {
  return entries.filter((e) => e.stat.from !== undefined && e.stat.from !== null && e.value >= e.stat.from && e.points > 0)
    .sort((a, b) => b.points - a.points).slice(0, 2);
}

// What is shown as carrying the price: the item's points by name, largest first.
function partsOf(scored) {
  const by = new Map();
  for (const e of scored.entries) if (e.points > 0) by.set(e.stat.as, (by.get(e.stat.as) || 0) + e.points);
  if (scored.prop) by.set(scored.prop.as, (by.get(scored.prop.as) || 0) + scored.prop.points);
  return [...by].map(([as, points]) => ({ as, share: Math.round((100 * points) / scored.score) }))
    .filter((p) => p.share >= 8).sort((a, b) => b.share - a.share).slice(0, 3);
}

// The search of one step. offline: sellers who are not online too (the window's own chip).
// lean: the smaller form of the weighted part (see weightsFor).
function bodyFor(plan, i, { offline = false, lean = false } = {}) {
  const step = STEPS[i], s = plan.scored;
  const and = { type: 'and', filters: [] };
  const stats = [];
  const weights = lean ? weightsFor(s.entries, MAX_WEIGHTS, true) : plan.weights;
  if (weights.length && plan.searchScore > 0) stats.push({ type: 'weight', value: { min: Math.max(1, Math.floor(plan.searchScore * step.score)) }, filters: weights });
  stats.push(and);
  // kept in every step: its influence and a fractured modifier are part of what the item is
  for (const m of plan.must) {
    const one = (id) => (m.min !== null && m.min !== undefined ? { id, value: { min: m.min } } : { id });
    if (m.ids.length === 1) and.filters.push(one(m.ids[0])); else stats.push({ type: 'count', value: { min: 1 }, filters: m.ids.map(one) });
  }
  if (step.point !== null) {
    for (const e of plan.points) {
      const min = lowest(e.value, step.point);
      const ids = pointIds(e);
      if (ids.length === 1) and.filters.push({ id: ids[0], value: { min } }); else stats.push({ type: 'count', value: { min: 1 }, filters: ids.map((id) => ({ id, value: { min } })) });
    }
  }
  const query = {
    status: { option: offline ? 'any' : 'available' }, stats,
    filters: { type_filters: { filters: { category: { option: plan.tradeId }, rarity: { option: 'nonunique' } } }, misc_filters: { filters: { corrupted: { option: String(!!plan.corrupted) } } } },
  };
  if (s.prop) query.filters[s.prop.group] = { filters: { [s.prop.key]: { min: Math.round(s.prop.value * s.prop.floor[i]) } } };
  return { query, sort: { price: 'asc' } };
}

// A cluster jewel is searched as the standard check does (its enchant and notables), but with
// exactly its number of passives: fewer is better there, and "8 or more" finds the worse ones.
function clusterBody(filters, offline) {
  const stats = filters.stats.map((s) => (s.kind === 'enchant' && /^Adds \d+ Passive Skills$/.test(s.text) && s.value ? { ...s, enabled: true, min: s.value, max: s.value } : s));
  return buildQuery({ ...filters, stats, offline: !!offline });
}

// item: from parseItemText. index: a StatIndex. Returns what the advanced check does with it:
//   { ok: false, why }                      not an item it has a search of its own for
//   { ok: true, kind: 'exact', steps: 1 }   a cluster jewel
//   { ok: true, kind: 'score', worth, profile, fits, score, parts, points, unknown, steps }
// and `body(i, { offline })` for the search of step i (0 is the strictest).
function plan(item, index) {
  const kind = gearKind(item);
  if (!kind || !item || item.rarity !== 'Rare' || item.unidentified) return { ok: false, why: 'only rares have a search of their own' };
  const filters = buildFilters(item, index);
  if (!filters.ok) return { ok: false, why: filters.why };
  if (kind.category === 'Cluster Jewel') return { ok: true, kind: 'exact', worth: true, steps: 1, body: (i, o = {}) => clusterBody(filters, o.offline) };
  const lines = readLines(item, index, kind.category);
  const scores = PROFILES.filter((p) => p.slots.includes(kind.category)).map((p) => scoreFor(p, { item, category: kind.category, index, lines })).filter(Boolean).sort((a, b) => b.score - a.score);
  if (!scores.length) return { ok: false, why: `no value table for a ${kind.category.toLowerCase()} yet` };
  const best = scores[0];
  const points = pointsOf(best.entries);
  // kept as the standard search keeps them: influence, and a fractured modifier at a tenth below its value
  const must = filters.stats.filter((s) => s.enabled && (s.key.startsWith('influence:') || s.kind === 'fractured') && s.ids && s.ids.length).map((s) => ({ ids: s.ids, min: s.min, text: s.text }));
  const outright = must.reduce((n, m) => n + m.ids.length, 0) + points.reduce((n, e) => n + pointIds(e).length, 0);
  const weights = weightsFor(best.entries, Math.max(LEAST_WEIGHTS, Math.min(MAX_WEIGHTS, MAX_STATS - outright)));
  const counted = new Set(best.entries.flatMap((e) => Object.keys(madeOf(e.stat, e.ids))));
  const out = {
    ok: true, kind: 'score', category: kind.category, tradeId: kind.tradeId, corrupted: !!item.corrupted,
    worth: best.score >= WORTH_FROM, score: Math.round(best.score), profile: { id: best.profile.id, name: best.profile.name },
    // every kind of buyer it is nearly as good for
    fits: [...new Set(scores.filter((s) => s.score >= best.score * 0.85 && s.score >= WORTH_FROM).map((s) => s.profile.name))].slice(0, 2),
    parts: partsOf(best), scored: best, weights,
    searchScore: best.entries.filter((e) => e.searched && e.points > 0).reduce((n, e) => n + e.points, 0),
    points, must,
    // top-tier modifiers the table gives no points for: said in the window, so a blind spot shows
    unknown: lines.filter((l) => l.tier === 1 && l.ref && l.type !== 'implicit' && l.type !== 'enchant' && !counted.has(l.ref)).map((l) => l.text).slice(0, 2),
  };
  out.steps = out.worth ? STEPS.length : 0;
  out.body = (i, o = {}) => bodyFor(out, i, o);
  return out;
}

// The plan in a few words, for Under the hood.
function describe(p) {
  if (!p || !p.ok) return `no search of its own (${p && p.why ? p.why : 'nothing to go by'})`;
  if (p.kind === 'exact') return 'cluster jewel: its enchant and notables with exactly its number of passives';
  const asked = p.points.map((e) => `${e.stat.as} ${lowest(e.value, STEPS[0].point)}+`).join(', ');
  return `${p.profile.name}, ${p.score} points${p.scored.prop ? ` (${Math.round(p.scored.prop.points)} of them its ${p.scored.prop.as})` : ''}${p.worth ? `, ${p.weights.length} stats weighed${asked ? `, asks for ${asked}` : ''}` : ': under the least worth searching for'}`;
}

module.exports = { plan, describe, readLines, scoreFor, weightsFor, bodyFor, lowest, STEPS, MAX_STATS, MAX_WEIGHTS, KINDS };
