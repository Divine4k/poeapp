'use strict';
// The Trade page's Search part: a search of the trade site started from nothing (no item in
// hand). The site's own list of items is read into names to pick from, the stat list is
// searched by words, and what is filled in becomes the search the site takes.
// Plain logic: nothing here asks the web.

// Kinds of item the site can be asked for, in the order they are offered.
const CATEGORIES = [
  ['', 'Any kind'],
  ['weapon', 'Any weapon'], ['weapon.one', 'One-handed weapon'], ['weapon.onemelee', 'One-handed melee weapon'], ['weapon.twomelee', 'Two-handed melee weapon'],
  ['weapon.bow', 'Bow'], ['weapon.claw', 'Claw'], ['weapon.dagger', 'Any dagger'], ['weapon.runedagger', 'Rune dagger'],
  ['weapon.oneaxe', 'One-handed axe'], ['weapon.onemace', 'One-handed mace'], ['weapon.onesword', 'One-handed sword'], ['weapon.sceptre', 'Sceptre'],
  ['weapon.staff', 'Any staff'], ['weapon.warstaff', 'Warstaff'], ['weapon.twoaxe', 'Two-handed axe'], ['weapon.twomace', 'Two-handed mace'],
  ['weapon.twosword', 'Two-handed sword'], ['weapon.wand', 'Wand'], ['weapon.rod', 'Fishing rod'],
  ['armour', 'Any armour'], ['armour.chest', 'Body armour'], ['armour.boots', 'Boots'], ['armour.gloves', 'Gloves'], ['armour.helmet', 'Helmet'],
  ['armour.shield', 'Shield'], ['armour.quiver', 'Quiver'],
  ['accessory', 'Any accessory'], ['accessory.amulet', 'Amulet'], ['accessory.belt', 'Belt'], ['accessory.ring', 'Ring'], ['accessory.trinket', 'Trinket'],
  ['gem', 'Any gem'], ['gem.activegem', 'Skill gem'], ['gem.supportgem', 'Support gem'], ['gem.supportgemplus', 'Awakened support gem'],
  ['jewel', 'Any jewel'], ['jewel.base', 'Base jewel'], ['jewel.abyss', 'Abyss jewel'], ['jewel.cluster', 'Cluster jewel'],
  ['flask', 'Flask'], ['map', 'Map'], ['map.fragment', 'Map fragment'], ['map.invitation', "Maven's invitation"], ['map.scarab', 'Scarab'],
  ['watchstone', 'Watchstone'], ['leaguestone', 'Leaguestone'], ['memoryline', 'Memory'], ['card', 'Divination card'],
  ['heistequipment', 'Heist equipment'], ['heistmission.contract', 'Contract'], ['heistmission.blueprint', 'Blueprint'],
  ['expedition.logbook', 'Logbook'], ['sanctum.relic', 'Sanctum relic'], ['tincture', 'Tincture'], ['azmeri.charm', 'Charm'],
  ['currency', 'Any currency'], ['currency.resonator', 'Resonator'], ['currency.fossil', 'Fossil'], ['currency.incubator', 'Incubator'],
  ['currency.heistobjective', 'Heist target'], ['currency.omen', 'Omen'], ['currency.tattoo', 'Tattoo'],
];
const RARITIES = [['', 'Any rarity'], ['normal', 'Normal'], ['magic', 'Magic'], ['rare', 'Rare'], ['unique', 'Unique'], ['nonunique', 'Not unique']];
// Who sells: what the site calls each choice. "available" is the site's own default.
const SELLERS = [['available', 'Instant buyout and in person'], ['securable', 'Instant buyout only'], ['online', 'In person, online'], ['any', 'Anyone, offline too']];
const KIND_WORDS = { explicit: 'Explicit', implicit: 'Implicit', fractured: 'Fractured', crafted: 'Crafted', enchant: 'Enchant', pseudo: 'Total', veiled: 'Veiled', imbued: 'Imbued' };
const CURRENCY = ['', 'chaos', 'divine'];

const low = (s) => String(s || '').toLowerCase();
const words = (s) => low(s).split(/[^a-z0-9%#+'-]+/).filter(Boolean);

// The site's list of items (/api/trade/data/items) -> one flat list to pick from.
// Each: { label, name, type, disc, group, unique }. name is set for a unique only.
function readItems(json) {
  const out = [], seen = new Set();
  for (const g of (json && json.result) || []) {
    if (!g || !Array.isArray(g.entries)) continue;
    for (const e of g.entries) {
      if (!e || typeof e.type !== 'string' || !e.type) continue;
      const name = typeof e.name === 'string' ? e.name : '';
      const unique = !!(e.flags && e.flags.unique);
      const label = typeof e.text === 'string' && e.text ? e.text : [name, e.type].filter(Boolean).join(' ');
      const key = `${name}|${e.type}|${e.disc || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label, name, type: e.type, disc: typeof e.disc === 'string' ? e.disc : '', group: String(g.label || g.id || ''), unique, find: low(label) });
    }
  }
  return out;
}

// The items whose name holds every word typed. A name that starts with what was typed comes
// first, then the shorter name: "tab" gives Tabula Rasa before Stable Something.
function findItems(list, text, max = 12) {
  const w = words(text);
  if (!w.length || !Array.isArray(list)) return [];
  const whole = low(text).trim(), hits = [];
  for (const it of list) {
    if (!w.every((x) => it.find.includes(x))) continue;
    hits.push([it.find.startsWith(whole) ? 0 : it.find.includes(` ${w[0]}`) || it.find.startsWith(w[0]) ? 1 : 2, it]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1].label.length - b[1].label.length || (a[1].label < b[1].label ? -1 : 1));
  return hits.slice(0, max).map(([, it]) => ({ label: it.label, name: it.name, type: it.type, disc: it.disc, group: it.group, unique: it.unique }));
}

// Every stat of the stat list, once per wording: [{ ref, kinds: { explicit: [ids], ... }, find }].
// Built once (about 10,000 lines) and kept by whoever asks.
function statList(index) {
  const out = [];
  for (const [ref, stat] of index.byRef) {
    const kinds = {};
    for (const [k, ids] of Object.entries(stat.ids || {})) if (KIND_WORDS[k] && Array.isArray(ids) && ids.length) kinds[k] = ids.slice();
    if (Object.keys(kinds).length) out.push({ ref, kinds, find: low(ref) });
  }
  return out;
}

// The stats whose wording holds every word typed, shortest wording first ("maximum life"
// gives "+# to maximum Life" before the long conditional lines).
function findStats(list, text, max = 14) {
  const w = words(text).filter((x) => x !== '#' && x !== '+');
  if (!w.length || !Array.isArray(list)) return [];
  const hits = list.filter((s) => w.every((x) => s.find.includes(x)));
  hits.sort((a, b) => a.ref.length - b.ref.length || (a.ref < b.ref ? -1 : 1));
  return hits.slice(0, max).map((s) => ({ ref: s.ref, kinds: Object.keys(s.kinds) }));
}

const num = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const span = (a, b) => { const o = {}; const min = num(a), max = num(b); if (min !== null) o.min = min; if (max !== null) o.max = max; return o; };
const has = (o) => Object.keys(o).length > 0;
const pick = (list, v, d) => (list.some(([id]) => id === v) ? v : d);

// What was filled in, made safe: only known choices, numbers as numbers, text cut short.
// Whatever the window sends, the search is built from this.
function cleanForm(f) {
  f = f && typeof f === 'object' ? f : {};
  const text = (s, n = 120) => String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
  const item = f.item && typeof f.item === 'object' && text(f.item.type) ? { label: text(f.item.label), name: text(f.item.name), type: text(f.item.type), disc: text(f.item.disc, 40) } : null;
  const n = (v) => { const x = num(v); return x === null ? '' : x; };
  const stats = (Array.isArray(f.stats) ? f.stats : []).slice(0, 20).map((s) => ({ ref: text(s && s.ref, 300), kind: KIND_WORDS[s && s.kind] ? s.kind : 'any', min: n(s && s.min), max: n(s && s.max), kinds: (Array.isArray(s && s.kinds) ? s.kinds : []).filter((k) => KIND_WORDS[k]) })).filter((s) => s.ref);
  return {
    item, text: item ? '' : text(f.text),
    category: pick(CATEGORIES, f.category, ''), rarity: pick(RARITIES, f.rarity, ''), seller: pick(SELLERS, f.seller, 'available'),
    priceMin: n(f.priceMin), priceMax: n(f.priceMax), currency: CURRENCY.includes(f.currency) ? f.currency : '',
    links: n(f.links), sockets: n(f.sockets), ilvlMin: n(f.ilvlMin), ilvlMax: n(f.ilvlMax), quality: n(f.quality), gemLevel: n(f.gemLevel),
    corrupted: ['yes', 'no'].includes(f.corrupted) ? f.corrupted : '', stats,
  };
}

// Is there anything to search for? A search with nothing in it would list the whole market.
function isEmpty(form) {
  const f = cleanForm(form);
  return !f.item && !f.text && !f.category && !f.stats.length;
}

// The form -> the search the trade site takes. index: the StatIndex (for each stat's ids).
// Returns { body, unknown }: unknown lists stats the list no longer has (a saved search
// from an older league); they are left out and named to the user.
function buildFind(form, index) {
  const f = cleanForm(form);
  const and = { type: 'and', filters: [] };
  const query = { status: { option: f.seller }, stats: [and], filters: {} };
  if (f.item) {
    if (f.item.name) query.name = f.item.name;
    query.type = f.item.disc ? { option: f.item.type, discriminator: f.item.disc } : f.item.type;
  } else if (f.text) query.term = f.text;
  const type = {};
  if (f.category) type.category = { option: f.category };
  if (f.rarity) type.rarity = { option: f.rarity };
  if (has(type)) query.filters.type_filters = { filters: type };
  const sock = {};
  if (f.links !== '') sock.links = { min: f.links };
  if (f.sockets !== '') sock.sockets = { min: f.sockets };
  if (has(sock)) query.filters.socket_filters = { filters: sock };
  const misc = {};
  const ilvl = span(f.ilvlMin, f.ilvlMax);
  if (has(ilvl)) misc.ilvl = ilvl;
  if (f.quality !== '') misc.quality = { min: f.quality };
  if (f.gemLevel !== '') misc.gem_level = { min: f.gemLevel };
  if (f.corrupted) misc.corrupted = { option: String(f.corrupted === 'yes') };
  if (has(misc)) query.filters.misc_filters = { filters: misc };
  const price = span(f.priceMin, f.priceMax);
  if (has(price)) { if (f.currency) price.option = f.currency; query.filters.trade_filters = { filters: { price } }; }
  const unknown = [];
  for (const s of f.stats) {
    const stat = index && index.byRef.get(s.ref);
    const kinds = stat ? stat.ids || {} : {};
    // One kind picked: that kind's ids. "Any": every kind, and one of them is enough.
    const ids = s.kind === 'any' ? Object.entries(kinds).filter(([k]) => KIND_WORDS[k]).flatMap(([, v]) => v) : (kinds[s.kind] || []);
    if (!ids.length) { unknown.push(s.ref); continue; }
    const value = span(s.min, s.max);
    const one = (id) => (has(value) ? { id, value } : { id });
    if (ids.length === 1) and.filters.push(one(ids[0]));
    else query.stats.push({ type: 'count', value: { min: 1 }, filters: ids.map(one) });
  }
  return { body: { query, sort: { price: 'asc' } }, unknown };
}

// A short name for a search, for the saved list and the buying list.
function nameOf(form) {
  const f = cleanForm(form);
  const cat = (CATEGORIES.find(([id]) => id === f.category) || [])[1];
  const rarity = f.rarity && f.rarity !== 'nonunique' ? (RARITIES.find(([id]) => id === f.rarity) || [])[1] : '';
  const head = f.item ? f.item.label : f.text || [rarity, f.category ? cat : ''].filter(Boolean).join(' ') || 'Search';
  const stat = f.stats[0] ? f.stats[0].ref.replace(/#/g, f.stats[0].min === '' ? '#' : String(f.stats[0].min)) : '';
  const more = f.stats.length > 1 ? ` +${f.stats.length - 1}` : '';
  return `${head}${stat ? `, ${stat}${more}` : ''}`.slice(0, 80);
}

// The saved searches as they are kept in the settings: at most 40, each a name and a clean form.
function cleanSaved(list) {
  return (Array.isArray(list) ? list : []).filter((s) => s && typeof s === 'object').slice(0, 40)
    .map((s) => ({ name: String(s.name || '').trim().slice(0, 80) || nameOf(s.form), form: cleanForm(s.form) }));
}

module.exports = { CATEGORIES, RARITIES, SELLERS, KIND_WORDS, readItems, findItems, statList, findStats, cleanForm, isEmpty, buildFind, nameOf, cleanSaved };
