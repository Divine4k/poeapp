'use strict';
// The advanced price check's own search for a rare. The item is scored with the value table
// (values.js); then it is compared with listed items that score about as much, not with items
// that have the same exact stats: an item with other stats of the same worth counts as "like
// it", so there are matches where an exact search finds none.
//
// The trade site has a search for exactly that (a weighted sum), but it only takes one from an
// account that is logged in, and the app cannot log in. Measured on the live site without a
// login on 2026-11-26: every `weight` or `weight2` group is refused as "too complex", even with
// one stat; an `and` group costs 1 and 1 for each stat, a `count` group 10 and 1 for each stat,
// the kind of item with rarity and corrupted 9; a search of 46 was taken and one of 55 refused
// (the site's answer names the cost as `complexity`). Path of Building's 200 is the limit of a
// logged-in account.
//
// So the scoring is done here. The site is asked for items of its kind that have most of what
// carries this item's score (a `count` group: all but one of its strongest stats, each at a
// good part of its value), cheapest first, with what the item is plainly bought for (20% spell
// suppression, +1 to gems, its damage) asked for outright. Their results are scored with the
// same table (scoreListing), and those that reach nearly the item's own score are what it is
// compared with. When too few are listed the search is widened step by step. Plain logic.

const { PROFILES, TOTALS, BENCH, WORTH_FROM } = require('./values');
const { buildFilters, buildQuery, gearKind } = require('../tradeQuery');
const { modText, plainText } = require('../tradeApi');

// The ways a modifier can be on an item, each with its own id on the trade site.
const KINDS = ['explicit', 'fractured', 'crafted', 'implicit'];
// What a search may cost on the site (see above; 46 is known to pass), and its smaller form,
// sent when the site still finds one too large.
const MAX_COST = 45, LEAN_COST = 34;
const COST = { base: 9, filter: 3, and: 1, count: 10, stat: 1 };
// The strongest stats of an item, at most this many, that a listing must mostly have too.
const MAX_ANCHORS = 6;
// The steps of a search, strict first. point: how much of each selling point is asked for
// outright (null: no longer). near: how much of each of its strongest stats a listing needs,
// and miss: how many of those it may lack. score: how much of the item's score a result needs
// to be compared with it. The first step asks for all of them, so nearly every result counts
// and the cheapest ten are enough; the wider ones let another stat stand in for one of them,
// and there the scoring sorts out what the site sends.
const STEPS = [
  { score: 0.85, point: 0.9, near: 0.9, miss: 0 },
  { score: 0.8, point: 0.75, near: 0.75, miss: 1 },
  { score: 0.65, point: null, near: 0.5, miss: 2 },
];

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
// Kept per stat list and kind of item: every listing read is scored with it.
const idsKept = new WeakMap(); // a StatIndex -> Map("<kind of item>" -> Map(stat -> ids))
function idsOf(stat, index, category) {
  let byKind = idsKept.get(index);
  if (!byKind) idsKept.set(index, (byKind = new Map()));
  let known = byKind.get(category);
  if (!known) byKind.set(category, (known = new Map()));
  if (known.has(stat)) return known.get(stat);
  let out = null;
  if (stat.t) { const ids = index.pseudo(stat.t); out = ids && ids.length ? { ref: stat.t, total: ids[0] } : null; } else {
    out = { ref: null };
    for (const kind of KINDS) {
      const f = index.match(stat.m, kind, category);
      if (f && !f.pseudo && f.ids && f.ids.length) { out.ref = out.ref || f.ref; out[kind] = f.ids; }
    }
    if (!out.ref) out = null;
  }
  known.set(stat, out);
  return out;
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

// The item's strongest stats, most points first: what a listing must mostly have to be looked at.
function anchorsOf(scored) {
  return scored.entries.filter((e) => e.points > 0 && e.points >= scored.statScore * 0.08)
    .sort((a, b) => b.points - a.points).slice(0, MAX_ANCHORS);
}

// What the site counts a search as (measured, see the top of this file).
function costOf(body) {
  const f = body.query.filters || {};
  const extra = Object.keys(f).filter((k) => k !== 'type_filters' && k !== 'misc_filters').length;
  return COST.base + extra * COST.filter + (body.query.stats || []).reduce((n, g) => n + (g.type === 'and' ? COST.and : COST.count) + g.filters.length * COST.stat, 0);
}

// The search of one step. offline: sellers who are not online too (the window's own chip).
// lean: the smaller form, sent when the site finds the search too large.
function bodyFor(plan, i, { offline = false, lean = false } = {}) {
  const step = STEPS[i], s = plan.scored;
  const budget = lean ? LEAN_COST : MAX_COST;
  const one = (id, min) => (min !== null && min !== undefined ? { id, value: { min } } : { id });
  const and = [], groups = [];
  let cost = COST.base + (s.prop ? COST.filter : 0) + COST.and;
  // Asked for outright. A stat that can be on an item in several ways (explicit, fractured,
  // crafted) is "any one of these" while there is room; else the way it is on this item.
  const outright = (ids, min) => {
    const group = COST.count + ids.length * COST.stat;
    if (ids.length > 1 && cost + group + COST.count + 3 <= budget) { groups.push({ type: 'count', value: { min: 1 }, filters: ids.map((id) => one(id, min)) }); cost += group; } else { and.push(one(ids[0], min)); cost += COST.stat; }
  };
  // kept in every step: its influence and a fractured modifier are part of what the item is
  for (const m of plan.must) outright(m.ids, m.min);
  const asked = new Set();
  if (step.point !== null) for (const e of plan.points) { outright(pointIds(e), lowest(e.value, step.point)); asked.add(e); }
  // what carries its score: its strongest stats, each at `near` of its value, all but `miss` of them
  const near = [];
  let held = 0;
  for (const e of plan.anchors) {
    if (asked.has(e)) continue;
    const ids = e.ids.total ? [e.ids.total] : pointIds(e).slice(0, lean ? 1 : 3);
    if (cost + COST.count + (near.length + ids.length) * COST.stat > budget) break;
    const min = lowest(e.value, step.near);
    for (const id of ids) near.push(one(id, min));
    held += 1;
  }
  if (held) groups.push({ type: 'count', value: { min: Math.max(1, held - Math.min(step.miss, held - 1)) }, filters: near });
  const query = {
    status: { option: offline ? 'any' : 'available' }, stats: [...(and.length ? [{ type: 'and', filters: and }] : []), ...groups],
    filters: { type_filters: { filters: { category: { option: plan.tradeId }, rarity: { option: 'nonunique' } } }, misc_filters: { filters: { corrupted: { option: String(!!plan.corrupted) } } } },
  };
  if (s.prop) query.filters[s.prop.group] = { filters: { [s.prop.key]: { min: Math.round(s.prop.value * s.prop.floor[i]) } } };
  return { query, sort: { price: 'asc' } };
}

// The modifiers of a listed item as the trade site sends them, read like the checked item's own.
// The site sends each as a line of text or (seen on the live site, 2026-11-26) as an object
// with the line as `description` and the way it is on the item as `domain`: a crafted modifier
// then comes in the explicit list, marked crafted.
function listingLines(it, index, category) {
  const out = [];
  const add = (list, listed) => {
    for (const t of Array.isArray(list) ? list : []) {
      const text = plainText(modText(t));
      if (!text) continue;
      const type = t && typeof t === 'object' && (KINDS.includes(t.domain) || t.domain === 'enchant') ? t.domain : listed;
      const whole = index.match(text, type, category);
      const found = whole ? [whole] : (text.includes('\n') ? text.split('\n').map((l) => index.match(l, type, category)).filter(Boolean) : []);
      for (const f of found) out.push({ ref: f.ref, value: f.value, type: f.pseudo ? 'total' : type });
    }
  };
  add(it.implicitMods, 'implicit'); add(it.fracturedMods, 'fractured'); add(it.explicitMods, 'explicit'); add(it.craftedMods, 'crafted');
  return out;
}

// What a listed item scores for the buyer the checked item was scored for (0: that buyer would
// not want it). it: the item of one of the site's results.
function scoreListing(plan, it, index) {
  if (!plan || !plan.scored || !it) return 0;
  const ext = it.extended || {};
  const n = (v) => (isFinite(Number(v)) ? Number(v) : 0);
  const item = { props: { pdps: n(ext.pdps), edps: n(ext.edps), energyShield: n(ext.es), armour: n(ext.ar), evasion: n(ext.ev) } };
  const s = scoreFor(plan.scored.profile, { item, category: plan.category, index, lines: listingLines(it, index, plan.category) });
  return s ? Math.round(s.score) : 0;
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
//   { ok: true, kind: 'score', worth, profile, fits, score, parts, points, anchors, unknown, steps }
// and `body(i, { offline, lean })` for the search of step i (0 is the strictest).
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
  const counted = new Set(best.entries.flatMap((e) => Object.keys(madeOf(e.stat, e.ids))));
  const out = {
    ok: true, kind: 'score', category: kind.category, tradeId: kind.tradeId, corrupted: !!item.corrupted,
    worth: best.score >= WORTH_FROM, score: Math.round(best.score), profile: { id: best.profile.id, name: best.profile.name },
    // every kind of buyer it is nearly as good for
    fits: [...new Set(scores.filter((s) => s.score >= best.score * 0.85 && s.score >= WORTH_FROM).map((s) => s.profile.name))].slice(0, 2),
    parts: partsOf(best), scored: best, anchors: anchorsOf(best), points, must,
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
  return `${p.profile.name}, ${p.score} points${p.scored.prop ? ` (${Math.round(p.scored.prop.points)} of them its ${p.scored.prop.as})` : ''}${p.worth ? `${asked ? `, asks for ${asked}` : ''}, looks for ${p.anchors.map((e) => e.stat.as).join(', ') || 'its kind only'}` : ': under the least worth searching for'}`;
}

module.exports = { plan, describe, readLines, scoreFor, scoreListing, listingLines, bodyFor, costOf, lowest, STEPS, MAX_COST, LEAN_COST, MAX_ANCHORS, KINDS };
