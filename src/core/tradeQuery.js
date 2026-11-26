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

// How many inventory cells an item takes, [wide, tall], for the kinds where every base is the
// same size. It decides how the sockets are laid out on its picture (two wide: they snake).
const SIZES = {
  Helmets: [2, 2], Gloves: [2, 2], Boots: [2, 2], 'Body Armours': [2, 3], Quivers: [2, 3], Belts: [2, 1],
  Amulets: [1, 1], Rings: [1, 1], Jewels: [1, 1], 'Abyss Jewels': [1, 1], Wands: [1, 3], Daggers: [1, 3],
  'Rune Daggers': [1, 3], Claws: [2, 2], Bows: [2, 4], Staves: [2, 4], Warstaves: [2, 4], Tinctures: [1, 2],
  'Life Flasks': [1, 2], 'Mana Flasks': [1, 2], 'Hybrid Flasks': [1, 2], 'Utility Flasks': [1, 2],
};

function gearKind(item) {
  if (!item) return null;
  const c = CLASSES[item.itemClass];
  if (!c) return null;
  if (c[0] === 'Jewel' && /Cluster Jewel$/.test(item.baseType || '')) return { category: 'Cluster Jewel', tradeId: 'jewel.cluster' };
  return { category: c[0], tradeId: c[1] };
}

// Whether the trade search can price this item: gear, jewels and flasks that are magic, rare or
// unique, and gems.
function searchable(item) {
  return (!!item && !!item.isGem) || (!!gearKind(item) && ['Magic', 'Rare', 'Unique'].includes(item.rarity));
}

// Gems whose price starts to climb with their first levels: they stop at level 3 to 5.
const SMALL_GEM = /^(Awakened |(Empower|Enlighten|Enhance) Support$)/;
// A gem is searched by its name, its level, its quality and whether it is corrupted: those four
// are its whole price. Level and quality are lines with a number, like a weapon's damage.
// Levels below 20 and quality below 20% rarely change the price, so they start unticked (a level
// 12 gem is then compared with the cheapest of its name), and are one click away.
function gemFilters(item) {
  const level = item.gemLevel || 1, quality = item.quality || 0;
  return {
    ok: true, gem: true, rarity: 'Gem', title: item.name, name: '',
    type: { value: item.name, enabled: true }, category: null,
    flags: [{ key: 'corrupted', label: item.corrupted ? 'Corrupted' : 'Not corrupted', value: !!item.corrupted, enabled: true }],
    props: [
      { key: 'gem_level', label: 'Level', group: 'misc_filters', value: level, min: level, enabled: level >= 20 || (level > 1 && SMALL_GEM.test(item.name)) },
      { key: 'quality', label: 'Quality', unit: '%', group: 'misc_filters', value: quality, min: quality, enabled: quality >= 20 },
    ],
    stats: [], unknown: [], offline: false, sockets: '', itemLevel: null, quality: 0, catalyst: null, size: [1, 1],
    level, gemQuality: quality, corrupted: !!item.corrupted,
  };
}

// How the trade site wants a gem named in a search. A transfigured gem ("Ice Nova of Frostbolts")
// is listed under the plain gem's type with a mark telling which version it is.
// list: the gems of the site's own item list (TradeClient.gems). Returns { option, discriminator }
// for those, null for a gem searched by its plain name (and when the list does not know it).
function gemType(list, name) {
  const e = (list || []).find((x) => x && (x.text || x.type) === name);
  return e && e.disc && e.type ? { option: e.type, discriminator: e.disc } : null;
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
// Whole numbers for a stat that is whole on the item, and for any number of 10 or more
// (damage per second 211.03): a tenth there means nothing to anyone. Small numbers with a
// point keep it (1.5% critical strike chance).
const wholeFor = (value) => Number.isInteger(value) || Math.abs(value) >= 10;
// The lowest roll still counted as "like mine": a tenth below it. Small whole numbers keep
// their value ("+1 to Level of Socketed Gems" must not become 0).
function floorFor(value) {
  if (value === null || !isFinite(value)) return null;
  const v = value >= 0 ? value * 0.9 : value * 1.1;
  return wholeFor(value) ? Math.round(v) : round1(v);
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

// The lowest value still counted as "like mine" on a unique, whose every copy has the same
// modifiers and differs only in how they rolled: a tenth of the possible range below it.
// span: how far apart the roll could have been; 0 when it is always the same.
function uniqueFloor(value, span) {
  const v = Math.abs(value) - span * 0.1;
  return wholeFor(value) || Number.isInteger(value * 2) ? Math.round(v) : round1(v);
}

// tiers: the tier of each modifier the stat comes from, best first (1 is the best there is).
// span: given for a unique whose rolls are known (see uniqueFloor); otherwise the lowest value
// is a tenth below the item's own.
function statFilter(key, text, kind, found, enabled, tiers = [], span = null) {
  const f = { key, text, kind, ids: found.ids, value: found.value, min: null, max: null, enabled, inverted: !!found.inverted, negated: !!found.negated, tiers: [...new Set(tiers.filter(Boolean))].sort((a, b) => a - b) };
  if (found.value !== null) {
    // "4% reduced Fire Damage taken" is searched as written: at least about that much reduced,
    // which on the trade site is "at most -4% increased".
    const low = (v) => (span === null ? floorFor(v) : uniqueFloor(v, span));
    if (found.negated && found.better !== 0) f.max = -low(Math.abs(found.value));
    else if (found.better === -1) f.max = found.value;
    else if (found.better === 0) { f.min = found.value; f.max = found.value; }
    else f.min = found.value >= 0 ? low(found.value) : floorFor(found.value);
  }
  return f;
}

// item: from parseItemText. index: a StatIndex. Returns what the price check window shows:
// { ok, why, title, rarity, name, type, category, flags: [...], props: [...], stats: [...], unknown: [...], offline }.
function buildFilters(item, index) {
  if (item && item.isGem) return gemFilters(item);
  const kind = gearKind(item);
  if (!kind || !searchable(item)) return { ok: false, why: 'The trade search covers magic, rare and unique gear, jewels and flasks.' };
  const unique = item.rarity === 'Unique';
  if (item.unidentified) return { ok: false, why: unique ? 'Identify the item first: the trade site needs its name.' : 'Identify the item first: an unidentified item has no stats to search for.' };
  // "Synthesised Two-Stone Ring" is listed under "Two-Stone Ring". A magic item's base type is
  // only known when the fuller item text named its affixes.
  const magic = item.rarity === 'Magic';
  const base = String((magic ? item.magicBase : item.baseType) || '').replace(/^Synthesised /, '');

  const out = {
    ok: true, rarity: item.rarity, title: unique ? item.name : `${item.rarity} ${kind.category}`,
    name: unique ? item.name : '',
    type: base ? { value: base, enabled: unique } : null,
    category: unique ? null : { id: kind.tradeId, label: kind.category, enabled: true },
    flags: [], props: unique ? [] : propFilters(item), stats: [], unknown: [], offline: false,
    sockets: item.sockets || '', itemLevel: item.itemLevel || null, quality: item.quality || 0, catalyst: item.catalyst || null, size: SIZES[item.itemClass] || null,
  };
  if (item.rarity === 'Rare' && item.name !== item.baseType) out.title = `${item.name}, ${item.baseType}`;
  if (item.rarity === 'Magic') out.title = item.name;

  out.flags.push({ key: 'corrupted', label: item.corrupted ? 'Corrupted' : 'Not corrupted', value: !!item.corrupted, enabled: true });
  if (item.links >= 5) out.flags.push({ key: 'links', label: `${item.links} linked sockets`, value: item.links, enabled: item.links === 6 });
  // Nothing rolls better above item level 86, so a higher one is searched as 86.
  const ilvl = Math.min(item.itemLevel || 0, 86);
  if (ilvl) out.flags.push({ key: 'ilvl', label: `Item level ${ilvl} or higher`, value: ilvl, enabled: false });
  for (const name of item.influences || []) {
    const ids = index.pseudo(`Has ${name} Influence`);
    if (ids) out.stats.push({ key: `influence:${name}`, text: `${name} influence`, kind: 'pseudo', ids, value: null, min: null, max: null, enabled: true, inverted: false, tiers: [] });
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
      if (found) {
        hit = { found, n, text: run.map((l) => l.text).join(' '), type: found.pseudo ? 'pseudo' : run[0].type, corruption: !!run[0].corruption, tier: run[0].tier || null };
        // span: how far the roll could vary, known from the fuller item text only.
        hit.span = run.every((l) => l.span !== undefined) ? run.reduce((sum, l) => sum + l.span, 0) / run.length : null;
        hit.unscalable = run.some((l) => l.unscalable);
      }
    }
    if (hit) { matched.push(hit); i += hit.n - 1; } else if (!unique) out.unknown.push(lines[i].text);
  }

  // A unique's rolls are known when the fuller item text gave them. Every copy of a unique has
  // the same modifiers, so what tells one from another is how the modifiers that can vary
  // rolled: those are ticked, as in Awakened PoE Trade. On a corrupted one the modifiers that
  // are normally fixed are ticked too (a corruption can change them), and so is its implicit.
  const rolls = unique && matched.some((m) => m.span !== null);
  const uniqueTick = (m) => {
    if (!rolls || m.span === null || m.found.value === null) return false;
    if (m.corruption || m.span > 0) return true;
    return !!item.corrupted && m.type === 'explicit' && !m.unscalable;
  };

  // Items are compared by totals: 40 fire and 30 cold resistance is worth what 70 cold is.
  const dropped = new Set();
  if (!unique || rolls) {
    let res = 0, life = 0, hasLife = false, resSpan = 0, lifeSpan = 0, resTick = false, lifeTick = false;
    const resTiers = [], lifeTiers = [];
    for (const m of matched) {
      if (m.type === 'enchant' || m.type === 'pseudo' || m.found.value === null) continue;
      const times = ELEMENTAL[m.found.ref];
      // A fractured modifier and a corruption's implicit count towards their total and are also
      // kept by themselves: they are what the item is bought for.
      const keep = m.type === 'fractured' || m.corruption;
      if (times) {
        res += m.found.value * times; resSpan += (m.span || 0) * times; resTiers.push(m.tier); resTick = resTick || uniqueTick(m);
        if (!keep && !/Chaos|All Resistances/.test(m.found.ref)) dropped.add(m);
      }
      if (m.found.ref === LIFE) { life += m.found.value; lifeSpan += m.span || 0; hasLife = true; lifeTiers.push(m.tier); lifeTick = lifeTick || uniqueTick(m); if (!keep) dropped.add(m); }
      if (STRENGTH.includes(m.found.ref)) { life += m.found.value / 2; lifeSpan += (m.span || 0) / 2; lifeTick = lifeTick || (hasLife && uniqueTick(m)); }
    }
    const resIds = index.pseudo('+#% total Elemental Resistance');
    const lifeIds = index.pseudo('+# total maximum Life');
    // On a unique the lowest total is worked out from the exact sum (38.5), before it is shown whole.
    const total = (key, text, ids, value, tiers, span, tick) => {
      const f = statFilter(key, text, 'pseudo', { ids, value: Math.floor(value), better: 1 }, unique ? tick : true, tiers, unique ? span : null);
      if (unique) f.min = uniqueFloor(value, span);
      return f;
    };
    if (hasLife && lifeIds) out.stats.push(total('pseudo:life', `+${Math.floor(life)} total maximum Life`, lifeIds, life, lifeTiers, lifeSpan, lifeTick));
    if (res > 0 && resIds) out.stats.push(total('pseudo:res', `+${res}% total Elemental Resistance`, resIds, res, resTiers, resSpan, resTick));
    if (!hasLife || !lifeIds) for (const m of matched) if (m.found.ref === LIFE) dropped.delete(m);
    if (!(res > 0 && resIds)) for (const m of matched) if (ELEMENTAL[m.found.ref]) dropped.delete(m);
  }
  let n = 0;
  for (const m of matched) {
    if (dropped.has(m)) continue;
    // A fractured modifier can never be changed, so it is what the item is bought for.
    // kind is what the window shows beside the stat; a corruption's implicit is named as such.
    const tick = unique ? uniqueTick(m) : (m.type === 'fractured' || keyStat(kind.category, m));
    out.stats.push(statFilter(`stat:${n++}`, m.text, m.corruption ? 'corruption' : m.type, m.found, tick, [m.tier], rolls && m.span !== null ? m.span : null));
  }
  if (!unique && out.type) out.presets = { stats: ticks(out), base: baseTicks(out) };
  return out;
}

// Every tick box of a search by its name -> whether it is ticked.
function ticks(f) {
  const t = {};
  if (f.category) t.category = f.category.enabled;
  if (f.type) t.type = f.type.enabled;
  for (const x of f.flags) t[`flag:${x.key}`] = x.enabled;
  for (const x of f.props || []) t[`prop:${x.key}`] = x.enabled;
  for (const x of f.stats) t[`stat:${x.key}`] = x.enabled;
  return t;
}

// The "Base item" search: this base type at this item level, whatever is rolled on it. For
// someone who wants the item to craft on. Influences and a fractured modifier are part of a
// base, so they stay in.
function baseTicks(f) {
  const t = ticks(f);
  for (const k of Object.keys(t)) if (k.startsWith('stat:') || k.startsWith('prop:')) t[k] = false;
  for (const x of f.stats) if (x.kind === 'fractured' || x.key.startsWith('influence:')) t[`stat:${x.key}`] = true;
  t.category = false; t.type = true;
  if ('flag:ilvl' in t) t['flag:ilvl'] = true;
  return t;
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
    || filters.flags.some((f) => f.enabled && f.key === 'links') || !!(filters.type && filters.type.enabled);
}

// The body of POST /api/trade/search/<league>, cheapest first. "available" is what the trade
// site itself searches for: instant buyout, and sellers who are online.
function buildQuery(filters) {
  const and = { type: 'and', filters: [] };
  const query = { status: { option: filters.offline ? 'any' : 'available' }, stats: [and], filters: {} };
  if (filters.name) query.name = filters.name;
  // as: how the site wants a transfigured gem named (gemType), set just before its search
  if (filters.type && filters.type.enabled && filters.type.value) query.type = filters.type.as || filters.type.value;
  const type = {};
  if (filters.category && filters.category.enabled) type.category = { option: filters.category.id };
  if (filters.rarity !== 'Unique' && !filters.gem) type.rarity = { option: 'nonunique' };
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

// The one number each listing is compared on, beside its price: the first ticked total the game
// works out (damage, armour...), or else the first ticked stat with a number. mine: this item's.
// lower: a stat where less is better.
function compareSpec(filters) {
  if (!filters || !filters.ok) return null;
  // A gem: each listing's level and quality, side by side ("21/20"). Not better or worse, just shown.
  if (filters.gem) return { gem: true, label: 'Level / quality', mine: `${filters.level}/${filters.gemQuality}` };
  const p = (filters.props || []).find((x) => x.enabled && x.value);
  if (p) return { prop: p.key, label: p.label, mine: p.value, lower: false };
  const st = (filters.stats || []).find((x) => x.enabled && x.value !== null && x.ids && x.ids.length);
  if (st) return { ids: st.ids, label: st.text.replace(/[+-]?\d+(\.\d+)?/g, '#'), mine: Math.abs(st.value), lower: !!(st.negated || st.inverted) };
  return null;
}

// Listings priced far under the rest are often bait: the seller does not answer, or the price
// is a mistake that is gone by the time you whisper. Marked when there are enough to tell.
const BAIT_FROM = 5; // chaos: below this typical price, nothing is called bait
function markBait(listings) {
  const known = listings.filter((l) => l.chaos !== null && isFinite(l.chaos) && l.chaos > 0);
  if (known.length < 4) return listings;
  for (const l of known) {
    const rest = known.filter((x) => x !== l).map((x) => x.chaos).sort((a, b) => a - b);
    const median = rest[Math.floor((rest.length - 1) / 2)];
    // On a cheap item a low price is just a low price (a few alterations for a 1c item).
    l.bait = median >= BAIT_FROM && l.chaos < median * 0.4;
  }
  return listings;
}

module.exports = { wholeFor, gearKind, searchable, gemType, buildFilters, applyEdits, isNarrow, buildQuery, summarize, floorFor, ticks, compareSpec, markBait };
