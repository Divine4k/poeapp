'use strict';
// Turns a parsed item into the choices of a trade search (which stats, how high) and those
// choices into the request the trade site expects. Plain logic, no Electron.

// "Item Class:" as the game writes it -> the kind of item, and its category on the trade site.
const CLASSES = {
  Helmets: ['Helmet', 'armour.helmet'], 'Body Armours': ['Body Armour', 'armour.chest'], Gloves: ['Gloves', 'armour.gloves'],
  Boots: ['Boots', 'armour.boots'], Shields: ['Shield', 'armour.shield'], Quivers: ['Quiver', 'armour.quiver'],
  Amulets: ['Amulet', 'accessory.amulet'], Rings: ['Ring', 'accessory.ring'], Belts: ['Belt', 'accessory.belt'],
  Trinkets: ['Trinket', 'accessory.trinket'], Jewels: ['Jewel', 'jewel'], 'Abyss Jewels': ['Abyss Jewel', 'jewel.abyss'],
  Claws: ['Claw', 'weapon.claw'], Daggers: ['Dagger', 'weapon.dagger'], 'Rune Daggers': ['Rune Dagger', 'weapon.runedagger'],
  Wands: ['Wand', 'weapon.wand'], Sceptres: ['Sceptre', 'weapon.sceptre'], Bows: ['Bow', 'weapon.bow'],
  Staves: ['Staff', 'weapon.staff'], Warstaves: ['Warstaff', 'weapon.warstaff'], 'Fishing Rods': ['Fishing Rod', 'weapon.rod'],
  'One Hand Swords': ['One-Handed Sword', 'weapon.onesword'], 'Thrusting One Hand Swords': ['One-Handed Sword', 'weapon.onesword'],
  'One Hand Axes': ['One-Handed Axe', 'weapon.oneaxe'], 'One Hand Maces': ['One-Handed Mace', 'weapon.onemace'],
  'Two Hand Swords': ['Two-Handed Sword', 'weapon.twosword'], 'Two Hand Axes': ['Two-Handed Axe', 'weapon.twoaxe'],
  'Two Hand Maces': ['Two-Handed Mace', 'weapon.twomace'],
  'Life Flasks': ['Flask', 'flask'], 'Mana Flasks': ['Flask', 'flask'], 'Hybrid Flasks': ['Flask', 'flask'], 'Utility Flasks': ['Flask', 'flask'],
  Tinctures: ['Tincture', 'tincture'],
};

function gearKind(item) {
  if (!item) return null;
  const c = CLASSES[item.itemClass];
  if (!c) return null;
  if (c[0] === 'Jewel' && /Cluster Jewel$/.test(item.baseType || '')) return { category: 'Cluster Jewel', tradeId: 'jewel.cluster' };
  return { category: c[0], tradeId: c[1] };
}

// Whether the trade search can price this item: gear, jewels and flasks that are magic, rare or unique.
function searchable(item) {
  return !!gearKind(item) && ['Magic', 'Rare', 'Unique'].includes(item.rarity);
}

// Resistances that count towards the trade site's "total Elemental Resistance", and how often.
const ELEMENTAL = {
  '+#% to Fire Resistance': 1, '+#% to Cold Resistance': 1, '+#% to Lightning Resistance': 1,
  '+#% to Fire and Cold Resistances': 2, '+#% to Fire and Lightning Resistances': 2, '+#% to Cold and Lightning Resistances': 2,
  '+#% to all Elemental Resistances': 3,
  '+#% to Fire and Chaos Resistances': 1, '+#% to Cold and Chaos Resistances': 1, '+#% to Lightning and Chaos Resistances': 1,
  '+#% to All Resistances': 3,
};
// Ten Strength is five Life, and the trade site counts it in "total maximum Life".
const STRENGTH = ['+# to Strength', '+# to all Attributes', '+# to Strength and Intelligence', '+# to Strength and Dexterity'];
const LIFE = '+# to maximum Life';

const round1 = (v) => Math.round(v * 10) / 10;
// The lowest roll still counted as "like mine": a tenth below it. Small whole numbers keep
// their value ("+1 to Level of Socketed Gems" must not become 0).
function floorFor(value) {
  if (value === null || !isFinite(value)) return null;
  const v = value >= 0 ? value * 0.9 : value * 1.1;
  return Number.isInteger(value) ? Math.round(v) : round1(v);
}

// Numbers the game works out for the whole item, which the trade site can search on directly.
const PROPS = [
  ['pdps', 'Physical damage per second', 'weapon_filters'], ['edps', 'Elemental damage per second', 'weapon_filters'],
  ['ar', 'Armour', 'armour_filters'], ['ev', 'Evasion Rating', 'armour_filters'], ['es', 'Energy Shield', 'armour_filters'], ['ward', 'Ward', 'armour_filters'],
];
function propFilters(item) {
  const p = item.props || {};
  const have = { pdps: p.pdps, edps: p.edps, ar: p.armour, ev: p.evasion, es: p.energyShield, ward: p.ward };
  const out = [];
  for (const [key, label, group] of PROPS) {
    const value = Math.round(have[key] || 0);
    if (value > 0) out.push({ key, label, group, value, min: floorFor(value), enabled: false });
  }
  // A weapon is bought for its damage: the larger of the two is searched for unless unticked.
  const dps = out.filter((f) => f.group === 'weapon_filters').sort((a, b) => b.value - a.value)[0];
  if (dps) dps.enabled = true;
  return out;
}

// Modifiers an item of this kind is bought for, ticked from the start.
function keyStat(category, m) {
  if (category === 'Cluster Jewel') return (m.type === 'enchant' && !/Jewel Socket/.test(m.found.ref)) || /^1 Added Passive Skill is /.test(m.text);
  if (category === 'Boots') return m.found.ref === '#% increased Movement Speed' && m.found.value >= 25;
  return false;
}

function statFilter(key, text, kind, found, enabled) {
  const f = { key, text, kind, ids: found.ids, value: found.value, min: null, max: null, enabled, inverted: !!found.inverted, negated: !!found.negated };
  if (found.value !== null) {
    // "4% reduced Fire Damage taken" is searched as written: at least about that much reduced,
    // which on the trade site is "at most -4% increased".
    if (found.negated && found.better !== 0) f.max = -floorFor(Math.abs(found.value));
    else if (found.better === -1) f.max = found.value;
    else if (found.better === 0) { f.min = found.value; f.max = found.value; }
    else f.min = floorFor(found.value);
  }
  return f;
}

// item: from parseItemText. index: a StatIndex. Returns what the price check window shows:
// { ok, why, title, rarity, name, type, category, flags: [...], props: [...], stats: [...], unknown: [...], offline }.
function buildFilters(item, index) {
  const kind = gearKind(item);
  if (!kind || !searchable(item)) return { ok: false, why: 'The trade search covers magic, rare and unique gear, jewels and flasks.' };
  const unique = item.rarity === 'Unique';
  if (item.unidentified) return { ok: false, why: unique ? 'Identify the item first: the trade site needs its name.' : 'Identify the item first: an unidentified item has no stats to search for.' };
  // "Synthesised Two-Stone Ring" is listed under "Two-Stone Ring".
  const base = String(item.baseType || '').replace(/^Synthesised /, '');

  const out = {
    ok: true, rarity: item.rarity, title: unique ? item.name : `${item.rarity} ${kind.category}`,
    name: unique ? item.name : '',
    // A magic item's name holds its affixes, so its base cannot be told from the text.
    type: item.rarity === 'Magic' ? null : { value: base, enabled: unique },
    category: unique ? null : { id: kind.tradeId, label: kind.category, enabled: true },
    flags: [], props: unique ? [] : propFilters(item), stats: [], unknown: [], offline: false,
  };
  if (item.rarity === 'Rare' && item.name !== item.baseType) out.title = `${item.name}, ${item.baseType}`;
  if (item.rarity === 'Magic') out.title = item.name;

  out.flags.push({ key: 'corrupted', label: item.corrupted ? 'Corrupted' : 'Not corrupted', value: !!item.corrupted, enabled: true });
  if (item.links >= 5) out.flags.push({ key: 'links', label: `${item.links} linked sockets`, value: item.links, enabled: item.links === 6 });
  if (item.itemLevel) out.flags.push({ key: 'ilvl', label: `Item level ${item.itemLevel} or higher`, value: item.itemLevel, enabled: false });
  for (const name of item.influences || []) {
    const ids = index.pseudo(`Has ${name} Influence`);
    if (ids) out.stats.push({ key: `influence:${name}`, text: `${name} influence`, kind: 'pseudo', ids, value: null, min: null, max: null, enabled: true, inverted: false });
  }

  // A modifier can run over several lines; try the longest run first.
  const lines = item.modLines || [];
  const matched = [];
  for (let i = 0; i < lines.length; i++) {
    let hit = null;
    for (let n = Math.min(3, lines.length - i); n >= 1 && !hit; n--) {
      const run = lines.slice(i, i + n);
      if (run.some((l) => l.section !== run[0].section || l.type !== run[0].type || l.group !== run[0].group)) continue;
      const found = index.match(run.map((l) => l.text).join('\n'), run[0].type, kind.category);
      if (found) hit = { found, n, text: run.map((l) => l.text).join(' '), type: found.pseudo ? 'pseudo' : run[0].type, corruption: !!run[0].corruption };
    }
    if (hit) { matched.push(hit); i += hit.n - 1; } else if (!unique) out.unknown.push(lines[i].text);
  }

  // Rares are compared by totals: 40 fire and 30 cold resistance is worth what 70 cold is.
  const dropped = new Set();
  if (!unique) {
    let res = 0, life = 0, hasLife = false;
    for (const m of matched) {
      if (m.type === 'enchant' || m.type === 'pseudo' || m.found.value === null) continue;
      const times = ELEMENTAL[m.found.ref];
      if (times) { res += m.found.value * times; if (!/Chaos|All Resistances/.test(m.found.ref)) dropped.add(m); }
      if (m.found.ref === LIFE) { life += m.found.value; hasLife = true; dropped.add(m); }
      if (STRENGTH.includes(m.found.ref)) life += m.found.value / 2;
    }
    const resIds = index.pseudo('+#% total Elemental Resistance');
    const lifeIds = index.pseudo('+# total maximum Life');
    if (hasLife && lifeIds) out.stats.push(statFilter('pseudo:life', `+${Math.floor(life)} total maximum Life`, 'pseudo', { ids: lifeIds, value: Math.floor(life), better: 1 }, true));
    if (res > 0 && resIds) out.stats.push(statFilter('pseudo:res', `+${res}% total Elemental Resistance`, 'pseudo', { ids: resIds, value: res, better: 1 }, true));
    if (!hasLife || !lifeIds) for (const m of matched) if (m.found.ref === LIFE) dropped.delete(m);
    if (!(res > 0 && resIds)) for (const m of matched) if (ELEMENTAL[m.found.ref]) dropped.delete(m);
  }
  let n = 0;
  for (const m of matched) {
    if (dropped.has(m)) continue;
    // A fractured modifier can never be changed, so it is what the item is bought for.
    // kind is what the window shows beside the stat; a corruption's implicit is named as such.
    out.stats.push(statFilter(`stat:${n++}`, m.text, m.corruption ? 'corruption' : m.type, m.found, m.type === 'fractured' || keyStat(kind.category, m)));
  }
  return out;
}

// What was ticked and typed in the window, laid over the choices it was built from.
// edits: { offline, type, category, flags: { key: bool }, props: { key: { enabled, min } }, stats: { key: { enabled, min, max } } }.
function applyEdits(filters, edits) {
  const e = edits || {};
  const numOrNull = (v) => (v === '' || v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v));
  const next = { ...filters, offline: e.offline === undefined ? filters.offline : !!e.offline };
  if (filters.type && e.type !== undefined) next.type = { ...filters.type, enabled: !!e.type };
  if (filters.category && e.category !== undefined) next.category = { ...filters.category, enabled: !!e.category };
  next.flags = filters.flags.map((f) => (e.flags && e.flags[f.key] !== undefined ? { ...f, enabled: !!e.flags[f.key] } : f));
  next.props = (filters.props || []).map((f) => {
    const p = e.props && e.props[f.key];
    if (!p) return f;
    return { ...f, enabled: p.enabled === undefined ? f.enabled : !!p.enabled, min: 'min' in p ? numOrNull(p.min) : f.min };
  });
  next.stats = filters.stats.map((s) => {
    const p = e.stats && e.stats[s.key];
    if (!p) return s;
    return { ...s, enabled: p.enabled === undefined ? s.enabled : !!p.enabled, min: 'min' in p ? numOrNull(p.min) : s.min, max: 'max' in p ? numOrNull(p.max) : s.max };
  });
  return next;
}

function range(stat) {
  let min = stat.min, max = stat.max;
  // Some stats are stored the other way round on the trade site ("reduced" for "increased").
  if (stat.inverted) [min, max] = [max === null ? null : -max, min === null ? null : -min];
  const v = {};
  if (min !== null) v.min = min;
  if (max !== null) v.max = max;
  return v;
}

// Whether anything but the kind of item is asked for. Without that a search only finds the
// cheapest item of its kind, which says nothing about this one.
function isNarrow(filters) {
  if (!filters || !filters.ok) return false;
  return filters.rarity === 'Unique' || filters.stats.some((s) => s.enabled) || (filters.props || []).some((p) => p.enabled && p.min !== null)
    || filters.flags.some((f) => f.enabled && f.key === 'links');
}

// The body of POST /api/trade/search/<league>, cheapest first. "available" is what the trade
// site itself searches for: instant buyout, and sellers who are online.
function buildQuery(filters) {
  const and = { type: 'and', filters: [] };
  const query = { status: { option: filters.offline ? 'any' : 'available' }, stats: [and], filters: {} };
  if (filters.name) query.name = filters.name;
  if (filters.type && filters.type.enabled && filters.type.value) query.type = filters.type.value;
  const type = {};
  if (filters.category && filters.category.enabled) type.category = { option: filters.category.id };
  if (filters.rarity !== 'Unique') type.rarity = { option: 'nonunique' };
  if (Object.keys(type).length) query.filters.type_filters = { filters: type };
  const misc = {};
  for (const f of filters.flags) {
    if (!f.enabled) continue;
    if (f.key === 'corrupted') misc.corrupted = { option: String(!!f.value) };
    if (f.key === 'ilvl') misc.ilvl = { min: f.value };
    if (f.key === 'links') query.filters.socket_filters = { filters: { links: { min: f.value } } };
  }
  if (Object.keys(misc).length) query.filters.misc_filters = { filters: misc };
  for (const p of filters.props || []) {
    if (!p.enabled || p.min === null) continue;
    query.filters[p.group] = query.filters[p.group] || { filters: {} };
    query.filters[p.group].filters[p.key] = { min: p.min };
  }
  for (const s of filters.stats) {
    if (!s.enabled) continue;
    const value = range(s);
    const one = (id) => (Object.keys(value).length ? { id, value } : { id });
    if (s.ids.length === 1) and.filters.push(one(s.ids[0]));
    else query.stats.push({ type: 'count', value: { min: 1 }, filters: s.ids.map(one) });
  }
  return { query, sort: { price: 'asc' } };
}

// What a search found, in three numbers: how many are listed, the cheapest price, and the
// typical price (the middle one of the cheapest ten, which a single underpriced item does not move).
// listings: [{ chaos }] cheapest first, chaos null when the currency has no known rate.
function summarize(total, listings) {
  const known = listings.map((l) => l.chaos).filter((c) => c !== null && isFinite(c)).sort((a, b) => a - b);
  if (!total) return { total: 0, low: null, median: null };
  return { total, low: known.length ? known[0] : null, median: known.length ? known[Math.floor((known.length - 1) / 2)] : null };
}

module.exports = { gearKind, searchable, buildFilters, applyEdits, isNarrow, buildQuery, summarize, floorFor };
