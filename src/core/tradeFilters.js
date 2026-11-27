'use strict';
// Every filter of the trade site's search, as the site lists them (/api/trade/data/filters),
// for the Trade page's Search. The app asks the site for its list once per run and draws the
// form from it, so the form always has what the site has. BUILT_IN is the same list as known
// when this was written (league 3.30), used only when the site does not give its own.
// Plain logic: nothing here asks the web. Also loaded by the demo page (demo.js) as window.TradeFilters.
(function () {
const YES_NO = [['', 'Any'], ['true', 'Yes'], ['false', 'No']];
const range = (id, text) => ({ id, text, kind: 'range' });
const yesNo = (id, text) => ({ id, text, kind: 'option', options: YES_NO });

// The kinds a filter can be: range (min and max), option (one choice), text (typed),
// sockets (colours and min/max, the site's sockets and links), price (min, max and currency).
const BUILT_IN = [
  { id: 'type_filters', title: 'Type Filters', open: true, filters: [
    { id: 'category', text: 'Item Category', kind: 'option', options: [
      ['', 'Any'], ['weapon', 'Any Weapon'], ['weapon.one', 'One-Handed Weapon'], ['weapon.onemelee', 'One-Handed Melee Weapon'], ['weapon.twomelee', 'Two-Handed Melee Weapon'],
      ['weapon.bow', 'Bow'], ['weapon.claw', 'Claw'], ['weapon.dagger', 'Any Dagger'], ['weapon.basedagger', 'Base Dagger'], ['weapon.runedagger', 'Rune Dagger'],
      ['weapon.oneaxe', 'One-Handed Axe'], ['weapon.onemace', 'One-Handed Mace'], ['weapon.onesword', 'One-Handed Sword'], ['weapon.sceptre', 'Sceptre'],
      ['weapon.staff', 'Any Staff'], ['weapon.basestaff', 'Base Staff'], ['weapon.warstaff', 'Warstaff'], ['weapon.twoaxe', 'Two-Handed Axe'], ['weapon.twomace', 'Two-Handed Mace'],
      ['weapon.twosword', 'Two-Handed Sword'], ['weapon.wand', 'Wand'], ['weapon.rod', 'Fishing Rod'],
      ['armour', 'Any Armour'], ['armour.chest', 'Body Armour'], ['armour.boots', 'Boots'], ['armour.gloves', 'Gloves'], ['armour.helmet', 'Helmet'], ['armour.shield', 'Shield'], ['armour.quiver', 'Quiver'],
      ['accessory', 'Any Accessory'], ['accessory.amulet', 'Amulet'], ['accessory.belt', 'Belt'], ['accessory.ring', 'Ring'], ['accessory.trinket', 'Trinket'],
      ['gem', 'Any Gem'], ['gem.activegem', 'Skill Gem'], ['gem.supportgem', 'Support Gem'], ['gem.supportgemplus', 'Awakened Support Gem'],
      ['jewel', 'Any Jewel'], ['jewel.base', 'Base Jewel'], ['jewel.abyss', 'Abyss Jewel'], ['jewel.cluster', 'Cluster Jewel'],
      ['flask', 'Flask'], ['tincture', 'Tincture'], ['azmeri.charm', 'Charm'], ['map', 'Map'], ['map.fragment', 'Map Fragment'], ['map.invitation', "Maven's Invitation"], ['map.scarab', 'Scarab'],
      ['watchstone', 'Watchstone'], ['leaguestone', 'Leaguestone'], ['memoryline', 'Memory'], ['logbook', 'Logbook'], ['sanctum.relic', 'Sanctum Relic'],
      ['heistequipment', 'Any Heist Equipment'], ['heistequipment.heistweapon', 'Heist Brooch'], ['heistequipment.heisttool', 'Heist Tool'], ['heistequipment.heistutility', 'Heist Cloak'], ['heistequipment.heistreward', 'Heist Gear'],
      ['heistmission', 'Any Heist Mission'], ['heistmission.contract', 'Contract'], ['heistmission.blueprint', 'Blueprint'],
      ['card', 'Divination Card'], ['monster.beast', 'Captured Beast'], ['monster.sample', 'Metamorph Sample'],
      ['currency', 'Any Currency'], ['currency.piece', 'Unique Fragment'], ['currency.resonator', 'Resonator'], ['currency.fossil', 'Fossil'], ['currency.incubator', 'Incubator'],
      ['currency.heistobjective', 'Heist Target'], ['currency.omen', 'Omen'], ['currency.tattoo', 'Tattoo'], ['currency.runegraft', 'Runegraft'],
    ] },
    { id: 'rarity', text: 'Item Rarity', kind: 'option', options: [['', 'Any'], ['normal', 'Normal'], ['magic', 'Magic'], ['rare', 'Rare'], ['unique', 'Unique'], ['uniquefoil', 'Unique (Relic)'], ['nonunique', 'Any Non-Unique']] },
  ] },
  { id: 'weapon_filters', title: 'Weapon Filters', filters: [range('damage', 'Damage'), range('crit', 'Critical Chance'), range('pdps', 'Physical DPS'), range('aps', 'Attacks per Second'), range('dps', 'Damage per Second'), range('edps', 'Elemental DPS')] },
  { id: 'armour_filters', title: 'Armour Filters', filters: [range('ar', 'Armour'), range('ev', 'Evasion'), range('es', 'Energy Shield'), range('ward', 'Ward'), range('block', 'Block'), range('base_defence_percentile', 'Base Percentile')] },
  { id: 'socket_filters', title: 'Socket Filters', filters: [{ id: 'sockets', text: 'Sockets', kind: 'sockets' }, { id: 'links', text: 'Links', kind: 'sockets' }] },
  { id: 'req_filters', title: 'Requirements', filters: [range('lvl', 'Level'), range('str', 'Strength'), range('dex', 'Dexterity'), range('int', 'Intelligence'),
    { id: 'class', text: 'Character Class', kind: 'option', options: [['', 'Any'], ['Scion', 'Scion'], ['Marauder', 'Marauder'], ['Ranger', 'Ranger'], ['Witch', 'Witch'], ['Duelist', 'Duelist'], ['Templar', 'Templar'], ['Shadow', 'Shadow']] }] },
  { id: 'map_filters', title: 'Map Filters', filters: [range('map_tier', 'Map Tier'), range('map_packsize', 'Map Packsize'), range('map_iiq', 'Map IIQ'), range('map_iir', 'Map IIR'), range('area_level', 'Area Level'),
    yesNo('map_blighted', 'Blighted Map'), yesNo('map_uberblighted', 'Blight-ravaged Map')] },
  { id: 'heist_filters', title: 'Heist Filters', filters: [range('heist_wings', 'Wings Revealed'), range('heist_max_wings', 'Max Wings'), range('heist_escape_routes', 'Escape Routes Revealed'), range('heist_max_escape_routes', 'Max Escape Routes'),
    range('heist_reward_rooms', 'Reward Rooms Revealed'), range('heist_max_reward_rooms', 'Max Reward Rooms'),
    { id: 'heist_objective_value', text: 'Objective Value', kind: 'option', options: [['', 'Any'], ['moderate', 'Moderately Valuable'], ['high', 'Valuable'], ['precious', 'Precious'], ['priceless', 'Priceless']] },
    range('heist_lockpicking', 'Lockpicking'), range('heist_brute_force', 'Brute Force'), range('heist_perception', 'Perception'), range('heist_demolition', 'Demolition'), range('heist_counter_thaumaturgy', 'Counter-Thaumaturgy'),
    range('heist_trap_disarmament', 'Trap Disarmament'), range('heist_agility', 'Agility'), range('heist_deception', 'Deception'), range('heist_engineering', 'Engineering')] },
  { id: 'sanctum_filters', title: 'Sanctum Filters', filters: [range('sanctum_resolve', 'Resolve'), range('sanctum_max_resolve', 'Maximum Resolve'), range('sanctum_inspiration', 'Inspiration'), range('sanctum_gold', 'Aureus')] },
  // The Ultimatum's own choices (challenge, reward) have ids not known here: the site's list brings them.
  { id: 'ultimatum_filters', title: 'Ultimatum Filters', filters: [] },
  { id: 'misc_filters', title: 'Miscellaneous', filters: [range('quality', 'Quality'), range('ilvl', 'Item Level'), range('gem_level', 'Gem Level'), range('gem_level_progress', 'Gem Experience %'),
    yesNo('gem_transfigured', 'Transfigured Gem'), range('talisman_tier', 'Talisman Tier'), range('stored_experience', 'Stored Experience'), range('stack_size', 'Stack Size'),
    yesNo('fractured_item', 'Fractured Item'), yesNo('synthesised_item', 'Synthesised Item'), yesNo('searing_item', 'Searing Exarch Item'), yesNo('tangled_item', 'Eater of Worlds Item'),
    yesNo('shaper_item', 'Shaper Item'), yesNo('elder_item', 'Elder Item'), yesNo('crusader_item', 'Crusader Item'), yesNo('redeemer_item', 'Redeemer Item'), yesNo('hunter_item', 'Hunter Item'), yesNo('warlord_item', 'Warlord Item'),
    yesNo('alternate_art', 'Alternate Art'), yesNo('identified', 'Identified'), yesNo('corrupted', 'Corrupted'), yesNo('twice_corrupted', 'Twice Corrupted'), yesNo('mirrored', 'Mirrored'), yesNo('split', 'Split'), yesNo('crafted', 'Crafted'),
    yesNo('veiled', 'Veiled'), yesNo('enchanted', 'Enchanted')] },
  { id: 'trade_filters', title: 'Trade Filters', filters: [{ id: 'account', text: 'Seller Account', kind: 'text' },
    { id: 'collapse', text: 'Collapse Listings by Account', kind: 'option', options: [['', 'No'], ['true', 'Yes']] },
    { id: 'indexed', text: 'Listed', kind: 'option', options: [['', 'Any Time'], ['1hour', 'Up to an Hour Ago'], ['3hours', 'Up to 3 Hours Ago'], ['12hours', 'Up to 12 Hours Ago'], ['1day', 'Up to a Day Ago'], ['3days', 'Up to 3 Days Ago'], ['1week', 'Up to a Week Ago'], ['2weeks', 'Up to 2 Weeks Ago'], ['1month', 'Up to 1 Month Ago'], ['2months', 'Up to 2 Months Ago']] },
    { id: 'sale_type', text: 'Sale Type', kind: 'option', options: [['', 'Any'], ['priced', 'Buyout or Fixed Price'], ['unpriced', 'No Listed Price']] },
    { id: 'price', text: 'Buyout Price', kind: 'price', options: [['', 'Chaos Orb Equivalent'], ['chaos_divine', 'Chaos Orb or Divine Orb'], ['chaos', 'Chaos Orb'], ['divine', 'Divine Orb']] }] },
].map((g) => ({ ...g, filters: g.filters.map((f) => ({ ...f, options: f.options ? f.options.map(([id, text]) => ({ id, text })) : undefined })) }));

// The kinds of stat group, as the site names them. The weighted ones are refused by the site
// for a searcher who is not signed in ("Query is too complex", seen on the live site in 0.65.1).
const STAT_GROUPS = [
  { id: 'and', text: 'And' }, { id: 'not', text: 'Not' }, { id: 'if', text: 'If' }, { id: 'count', text: 'Count', minMax: true },
  { id: 'weight', text: 'Weighted Sum', minMax: true, weights: true, signedIn: true }, { id: 'weight2', text: 'Weighted Sum v2', minMax: true, weights: true, signedIn: true },
];
// Who sells (the site's "status"). "available" is the site's own default.
const SELLERS = [['available', 'Instant Buyout and In Person'], ['securable', 'Instant Buyout'], ['online', 'In Person (Online)'], ['any', 'Any']];
const BULK_SELLERS = [['online', 'In Person (Online)'], ['any', 'Any']];

const text = (s, n = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const SOCKET_IDS = new Set(['sockets', 'links']);

// The site's answer -> groups in the shape above. One filter the site sends in a way not
// understood here is left out, not the whole list; a list with no group at all gives null.
function readFilters(json) {
  const groups = [];
  for (const g of (json && Array.isArray(json.result) ? json.result : [])) {
    if (!g || typeof g.id !== 'string' || !/^[a-z_]+$/.test(g.id) || !Array.isArray(g.filters)) continue;
    // Who sells is the choice beside the item name (the query's own `status`), not a group.
    if (g.id === 'status_filters') continue;
    const filters = [];
    for (const f of g.filters) {
      if (!f || typeof f.id !== 'string' || !/^[a-z0-9_.]+$/i.test(f.id)) continue;
      const opts = f.option && Array.isArray(f.option.options)
        ? f.option.options.filter((o) => o && typeof o.text === 'string').map((o) => ({ id: o.id === null || o.id === undefined ? '' : String(o.id), text: text(o.text) })) : null;
      const base = { id: f.id, text: text(f.text || f.id), tip: f.tip ? text(f.tip, 200) : undefined };
      if (SOCKET_IDS.has(f.id) && g.id === 'socket_filters') filters.push({ ...base, kind: 'sockets' });
      else if (opts && opts.length && f.minMax) filters.push({ ...base, kind: 'price', options: opts });
      else if (opts && opts.length) filters.push({ ...base, kind: 'option', options: opts[0].id === '' ? opts : [{ id: '', text: 'Any' }].concat(opts) });
      else if (f.minMax) filters.push({ ...base, kind: 'range' });
      else filters.push({ ...base, kind: 'text' });
    }
    // A group the site sends without a title gets one from its id: misc_filters -> Misc Filters.
    const title = text(g.title) || g.id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    groups.push({ id: g.id, title, filters, open: g.id === 'type_filters' });
  }
  return groups.length ? groups : null;
}

// Every filter by "group.filter" -> the filter, for checking what the window sends.
function indexOf(groups) {
  const out = new Map();
  for (const g of groups || []) for (const f of g.filters) out.set(`${g.id}.${f.id}`, f);
  return out;
}

const num = (v) => { if (v === '' || v === null || v === undefined) return ''; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : ''; };

// One filter's value as the window sent it -> its clean value, or null when nothing is set.
// Only known choices are kept; a filter the list does not have is kept as it was typed, so
// a saved search survives a site list that changed (the site says if it no longer takes it).
function cleanValue(f, v) {
  if (v === null || v === undefined) return null;
  // Without the list (a saved search read loosely), the kind is told by the value's own parts.
  const o0 = Object(v), mm = 'min' in o0 || 'max' in o0;
  const kind = f ? f.kind : typeof v === 'string' ? 'text' : ['r', 'g', 'b', 'w'].some((c) => c in o0) ? 'sockets' : 'option' in o0 ? (mm ? 'price' : 'option') : mm ? 'range' : 'option';
  if (kind === 'text') { const t = text(typeof v === 'object' ? v.input : v, 60); return t ? t : null; }
  if (typeof v !== 'object') v = kind === 'option' ? { option: v } : {};
  const out = {};
  if (kind === 'option' || kind === 'price') {
    const o = v.option === null || v.option === undefined ? '' : String(v.option);
    if (o && (!f || f.options.some((x) => x.id === o))) out.option = o;
  }
  if (kind === 'range' || kind === 'price' || kind === 'sockets') { const a = num(v.min), b = num(v.max); if (a !== '') out.min = a; if (b !== '') out.max = b; }
  if (kind === 'sockets') for (const c of ['r', 'g', 'b', 'w']) { const n = num(v[c]); if (n !== '' && n >= 0) out[c] = n; }
  if (kind === 'price' && !('min' in out) && !('max' in out)) delete out.option; // a currency alone is no filter
  return Object.keys(out).length ? out : null;
}

// All filled filters, { group: { filter: value } }, cleaned against the list (or loosely without one).
function cleanFilters(values, groups) {
  const idx = groups ? indexOf(groups) : null, out = {};
  if (!values || typeof values !== 'object') return out;
  for (const [g, fs] of Object.entries(values)) {
    if (!/^[a-z_]+$/.test(g) || !fs || typeof fs !== 'object') continue;
    for (const [id, v] of Object.entries(fs)) {
      if (!/^[a-z0-9_.]+$/i.test(id)) continue;
      const c = cleanValue(idx ? idx.get(`${g}.${id}`) : null, v);
      if (c !== null) (out[g] = out[g] || {})[id] = c;
    }
  }
  return out;
}

// The filled filters -> the "filters" part of the site's query.
function queryFilters(values) {
  const out = {};
  for (const [g, fs] of Object.entries(values || {})) {
    const filters = {};
    for (const [id, v] of Object.entries(fs)) filters[id] = typeof v === 'string' ? { input: v } : v;
    if (Object.keys(filters).length) out[g] = { filters };
  }
  return out;
}

// How many filters are filled in a group (shown beside its title).
const countIn = (values, group) => Object.keys((values || {})[group] || {}).length;

const api = { BUILT_IN, STAT_GROUPS, SELLERS, BULK_SELLERS, readFilters, indexOf, cleanValue, cleanFilters, queryFilters, countIn };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.TradeFilters = api;
})();
