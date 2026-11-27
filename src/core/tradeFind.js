'use strict';
// The Trade page's Search part: a search of the trade site started from nothing (no item in
// hand), with everything the site's own search page has. Two kinds, as on the site:
// - listed items: an item by name, every filter of the site (core/tradeFilters.js), stat groups
//   of every kind (and, not, if, count, weighted sums), who sells and how the results are sorted;
// - bulk exchange: what you want and what you pay with, from the site's list of stackables.
// Plain logic: nothing here asks the web.

const F = require('./tradeFilters');

const KIND_WORDS = { explicit: 'Explicit', implicit: 'Implicit', fractured: 'Fractured', crafted: 'Crafted', enchant: 'Enchant', pseudo: 'Pseudo', veiled: 'Veiled', imbued: 'Imbued', crucible: 'Crucible', scourge: 'Scourge', sanctum: 'Sanctum', ultimatum: 'Ultimatum', necropolis: 'Necropolis', delve: 'Delve' };
const MAX_GROUPS = 8, MAX_STATS = 40;

const low = (s) => String(s || '').toLowerCase();
const words = (s) => low(s).split(/[^a-z0-9%#+'-]+/).filter(Boolean);
const text = (s, n = 120) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
const num = (v) => { if (v === '' || v === null || v === undefined) return ''; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : ''; };
const span = (a, b) => { const o = {}; if (a !== '') o.min = a; if (b !== '') o.max = b; return o; };
const has = (o) => Object.keys(o).length > 0;

// ---- names to pick from -----------------------------------------------------------------------

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

// The site's list of stackables (/api/trade/data/static: currency, fragments, scarabs...), what
// the bulk exchange is asked with. Each: { id, label, group, image, find }.
function readStatic(json) {
  const out = [], seen = new Set();
  for (const g of (json && json.result) || []) {
    if (!g || !Array.isArray(g.entries)) continue;
    for (const e of g.entries) {
      if (!e || typeof e.id !== 'string' || !e.id || typeof e.text !== 'string' || seen.has(e.id)) continue;
      seen.add(e.id);
      const image = typeof e.image === 'string' ? (e.image.startsWith('/') ? `https://www.pathofexile.com${e.image}` : e.image) : '';
      out.push({ label: e.text, id: e.id, group: String(g.label || g.id || ''), image: /^https:\/\//.test(image) ? image : '', find: low(`${e.text} ${e.id}`) });
    }
  }
  return out;
}

// The entries whose name holds every word typed. A name that starts with what was typed comes
// first, then the shorter name: "tab" gives Tabula Rasa before Stable Something.
function findIn(list, typed, max = 12) {
  const w = words(typed);
  if (!w.length || !Array.isArray(list)) return [];
  const whole = low(typed).trim(), hits = [];
  for (const it of list) {
    if (!w.every((x) => it.find.includes(x))) continue;
    hits.push([it.find.startsWith(whole) ? 0 : it.find.includes(` ${w[0]}`) || it.find.startsWith(w[0]) ? 1 : 2, it]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1].label.length - b[1].label.length || (a[1].label < b[1].label ? -1 : 1));
  return hits.slice(0, max).map(([, it]) => { const { find, ...rest } = it; return rest; });
}
const findItems = findIn;
const findStatic = findIn;

// Every stat of the stat list, once per wording: [{ ref, kinds: { explicit: [ids], ... }, find }].
// Built once (about 10,000 lines) and kept by whoever asks.
function statList(index) {
  const out = [];
  for (const [ref, stat] of index.byRef) {
    const kinds = {};
    for (const [k, ids] of Object.entries(stat.ids || {})) if (Array.isArray(ids) && ids.length) kinds[k] = ids.slice();
    if (Object.keys(kinds).length) out.push({ ref, kinds, find: low(ref) });
  }
  return out;
}

// The stats whose wording holds every word typed, shortest wording first ("maximum life"
// gives "+# to maximum Life" before the long conditional lines).
function findStats(list, typed, max = 14) {
  const w = words(typed).filter((x) => x !== '#' && x !== '+');
  if (!w.length || !Array.isArray(list)) return [];
  const hits = list.filter((s) => w.every((x) => s.find.includes(x)));
  hits.sort((a, b) => a.ref.length - b.ref.length || (a.ref < b.ref ? -1 : 1));
  return hits.slice(0, max).map((s) => ({ ref: s.ref, kinds: Object.keys(s.kinds) }));
}

// ---- the form ---------------------------------------------------------------------------------

const kindOk = (k) => /^[a-z]+$/.test(String(k || ''));
function cleanStat(s) {
  s = s && typeof s === 'object' ? s : {};
  return { ref: text(s.ref, 300), kind: kindOk(s.kind) ? s.kind : 'any', kinds: (Array.isArray(s.kinds) ? s.kinds : []).filter(kindOk).slice(0, 12),
    min: num(s.min), max: num(s.max), weight: num(s.weight), off: !!s.off };
}
function cleanGroup(g) {
  g = g && typeof g === 'object' ? g : {};
  const type = F.STAT_GROUPS.some((x) => x.id === g.type) ? g.type : 'and';
  return { type, min: num(g.min), max: num(g.max), off: !!g.off, stats: (Array.isArray(g.stats) ? g.stats : []).map(cleanStat).filter((s) => s.ref).slice(0, MAX_STATS) };
}
const cleanPick = (x) => (x && typeof x === 'object' && /^[a-z0-9_-]{1,60}$/i.test(String(x.id || '')) ? { id: String(x.id), label: text(x.label || x.id, 80), image: /^https:\/\//.test(String(x.image || '')) ? String(x.image).slice(0, 300) : '' } : null);

// The filters the form had before 0.67 (saved searches, the page's own copy) -> the site's ids.
function oldFilters(f) {
  const v = {};
  const put = (g, id, val) => { if (val !== null && val !== undefined && val !== '' && !(typeof val === 'object' && !has(val))) (v[g] = v[g] || {})[id] = val; };
  put('type_filters', 'category', f.category ? { option: f.category } : null);
  put('type_filters', 'rarity', f.rarity ? { option: f.rarity } : null);
  put('socket_filters', 'links', num(f.links) !== '' ? { min: num(f.links) } : null);
  put('socket_filters', 'sockets', num(f.sockets) !== '' ? { min: num(f.sockets) } : null);
  put('misc_filters', 'ilvl', span(num(f.ilvlMin), num(f.ilvlMax)));
  put('misc_filters', 'quality', num(f.quality) !== '' ? { min: num(f.quality) } : null);
  put('misc_filters', 'gem_level', num(f.gemLevel) !== '' ? { min: num(f.gemLevel) } : null);
  put('misc_filters', 'corrupted', f.corrupted === 'yes' || f.corrupted === 'no' ? { option: String(f.corrupted === 'yes') } : null);
  const price = span(num(f.priceMin), num(f.priceMax));
  if (has(price) && f.currency) price.option = f.currency;
  put('trade_filters', 'price', price);
  return v;
}

// What was filled in, made safe: only known choices, numbers as numbers, text cut short.
// Whatever the window sends, the search is built from this. catalogue: the filter list in use
// (the site's or the built-in one); without it, filters are cleaned loosely.
function cleanForm(f, catalogue) {
  f = f && typeof f === 'object' ? f : {};
  const item = f.item && typeof f.item === 'object' && text(f.item.type) ? { label: text(f.item.label), name: text(f.item.name), type: text(f.item.type), disc: text(f.item.disc, 40) } : null;
  const raw = f.filters && typeof f.filters === 'object' ? f.filters : oldFilters(f);
  let groups = Array.isArray(f.groups) ? f.groups.slice(0, MAX_GROUPS).map(cleanGroup) : [];
  if (!Array.isArray(f.groups) && Array.isArray(f.stats) && f.stats.length) groups = [cleanGroup({ type: 'and', stats: f.stats })];
  const sort = f.sort && typeof f.sort === 'object' ? f.sort : {};
  const b = f.bulk && typeof f.bulk === 'object' ? f.bulk : {};
  return {
    mode: f.mode === 'bulk' ? 'bulk' : 'items',
    item, text: item ? '' : text(f.text),
    seller: F.SELLERS.some(([id]) => id === f.seller) ? f.seller : 'available',
    filters: F.cleanFilters(raw, catalogue), groups,
    sort: sort.by === 'stat' && text(sort.ref, 300) ? { by: 'stat', ref: text(sort.ref, 300), kind: kindOk(sort.kind) ? sort.kind : 'any' }
      : sort.by === 'group' && Number.isInteger(sort.i) && sort.i >= 0 && sort.i < MAX_GROUPS ? { by: 'group', i: sort.i }
        : { by: 'price', dir: sort.dir === 'desc' ? 'desc' : 'asc' },
    bulk: {
      want: (Array.isArray(b.want) ? b.want : []).map(cleanPick).filter(Boolean).slice(0, 10),
      have: (Array.isArray(b.have) ? b.have : []).map(cleanPick).filter(Boolean).slice(0, 10),
      minimum: num(b.minimum), seller: F.BULK_SELLERS.some(([id]) => id === b.seller) ? b.seller : 'online',
    },
  };
}

const statsIn = (f) => f.groups.reduce((n, g) => n + g.stats.length, 0);
// Is there anything to search for? A search with nothing in it would list the whole market.
function isEmpty(form, catalogue) {
  const f = cleanForm(form, catalogue);
  if (f.mode === 'bulk') return !f.bulk.want.length;
  return !f.item && !f.text && !has(f.filters) && !statsIn(f);
}
// Does the search need the trade site's sign-in (a weighted sum)?
const needsSignIn = (form) => cleanForm(form).mode === 'items' && cleanForm(form).groups.some((g) => !g.off && g.stats.length && (F.STAT_GROUPS.find((x) => x.id === g.type) || {}).signedIn);

// The ids of one stat for the kind picked; "any": every kind it has.
function idsOf(s, index) {
  const stat = index && index.byRef.get(s.ref);
  const kinds = stat ? stat.ids || {} : {};
  return s.kind === 'any' ? Object.values(kinds).flat() : (kinds[s.kind] || []);
}

// The form -> the search the trade site takes. index: the StatIndex (each stat's ids).
// Returns { body, unknown }: unknown lists stats the list no longer has (a saved search from an
// older league); they are left out and named to the user.
function buildFind(form, index, catalogue) {
  const f = cleanForm(form, catalogue);
  const query = { status: { option: f.seller }, stats: [], filters: F.queryFilters(f.filters) };
  if (f.item) {
    if (f.item.name) query.name = f.item.name;
    query.type = f.item.disc ? { option: f.item.type, discriminator: f.item.disc } : f.item.type;
  } else if (f.text) query.term = f.text;
  const unknown = [], where = []; // where[i]: the place of the form's group i in query.stats
  let sortId = '';
  f.groups.forEach((g, gi) => {
    const def = F.STAT_GROUPS.find((x) => x.id === g.type);
    const out = { type: g.type, filters: [] };
    if (def.minMax) { const v = span(g.min, g.max); if (has(v)) out.value = v; }
    if (g.off) out.disabled = true;
    const extra = [];
    for (const s of g.stats) {
      const ids = idsOf(s, index);
      if (!ids.length) { unknown.push(s.ref); continue; }
      const value = span(s.min, s.max);
      if (def.weights && s.weight !== '') value.weight = s.weight;
      const one = (id) => { const x = { id }; if (has(value)) x.value = value; if (s.off) x.disabled = true; return x; };
      if (f.sort.by === 'stat' && f.sort.ref === s.ref && !sortId) sortId = ids[0];
      // In an And group a stat of any kind must be one of its kinds, not all of them: its own
      // Count group, as the site's page does it ("Count, at least 1").
      if (g.type === 'and' && ids.length > 1) extra.push({ type: 'count', value: { min: 1 }, filters: ids.map(one), ...(g.off || s.off ? { disabled: true } : {}) });
      else for (const id of ids) out.filters.push(one(id));
    }
    where[gi] = query.stats.length;
    query.stats.push(out, ...extra);
  });
  if (!query.stats.length) query.stats.push({ type: 'and', filters: [] });
  let sort = { price: f.sort.by === 'price' ? f.sort.dir : 'asc' };
  if (f.sort.by === 'stat' && sortId) sort = { [`stat.${sortId}`]: 'desc' };
  if (f.sort.by === 'group' && where[f.sort.i] !== undefined && (F.STAT_GROUPS.find((x) => x.id === f.groups[f.sort.i].type) || {}).weights) sort = { [`statgroup.${where[f.sort.i]}`]: 'desc' };
  return { body: { query, sort }, unknown };
}

// The form -> the bulk exchange's search.
function buildBulk(form) {
  const b = cleanForm(form).bulk;
  const query = { status: { option: b.seller }, want: b.want.map((x) => x.id), have: b.have.map((x) => x.id) };
  if (b.minimum !== '' && b.minimum > 0) query.minimum = b.minimum;
  return { engine: 'new', query, sort: { have: 'asc' } };
}

// A short name for a search, for the saved list and the buying list.
function nameOf(form) {
  const f = cleanForm(form);
  if (f.mode === 'bulk') return `${f.bulk.want.map((x) => x.label).join(', ') || 'Bulk'}${f.bulk.have.length ? ` for ${f.bulk.have.map((x) => x.label).join(', ')}` : ''}`.slice(0, 80);
  const pick = (g, id) => { const v = (f.filters[g] || {})[id]; if (!v || !v.option) return ''; const def = F.BUILT_IN.find((x) => x.id === g); const o = def && def.filters.find((x) => x.id === id); const t = o && o.options.find((x) => x.id === v.option); return t ? t.text : ''; };
  const rarity = (f.filters.type_filters || {}).rarity && !/nonunique/.test(f.filters.type_filters.rarity.option) ? pick('type_filters', 'rarity') : '';
  const cat = pick('type_filters', 'category');
  const head = f.item ? f.item.label : f.text || [rarity, cat].filter(Boolean).join(' ') || 'Search';
  const all = f.groups.flatMap((g) => g.stats);
  const st = all[0] ? all[0].ref.replace(/#/g, all[0].min === '' ? '#' : String(all[0].min)) : '';
  return `${head}${st ? `, ${st}${all.length > 1 ? ` +${all.length - 1}` : ''}` : ''}`.slice(0, 80);
}

// The saved searches as they are kept in the settings: at most 40, each a name and a clean form.
function cleanSaved(list) {
  return (Array.isArray(list) ? list : []).filter((s) => s && typeof s === 'object').slice(0, 40)
    .map((s) => ({ name: String(s.name || '').trim().slice(0, 80) || nameOf(s.form), form: cleanForm(s.form) }));
}


// The stat ids of the stat list, read the other way: id -> { ref, kind, kinds }. Built once per index.
const byId = new WeakMap();
function idIndex(index) {
  if (!index) return new Map();
  if (byId.has(index)) return byId.get(index);
  const out = new Map();
  for (const [ref, stat] of index.byRef) {
    const kinds = Object.keys(stat.ids || {});
    for (const k of kinds) for (const id of stat.ids[k]) if (!out.has(id)) out.set(id, { ref, kind: k, kinds });
  }
  byId.set(index, out);
  return out;
}

// A search as the trade site takes it (the price check's own, `buildQuery`) -> the Search form,
// so a checked item opens on the Trade page with every filter filled in (tracker #98).
// Returns { form, unknown }: unknown counts stat ids the list does not know (left out).
function formFromQuery(body, index) {
  const q = (body && body.query) || {};
  const form = { mode: 'items', item: null, text: '', seller: 'available', filters: {}, groups: [], sort: { by: 'price', dir: 'asc' }, bulk: { want: [], have: [], minimum: '', seller: 'online' } };
  const status = q.status && q.status.option;
  if (status && require('./tradeFilters').SELLERS.some(([id]) => id === status)) form.seller = status;
  const type = typeof q.type === 'string' ? q.type : q.type && typeof q.type === 'object' ? String(q.type.option || '') : '';
  const disc = q.type && typeof q.type === 'object' ? String(q.type.discriminator || '') : '';
  if (type) form.item = { label: [q.name, type].filter(Boolean).join(' '), name: typeof q.name === 'string' ? q.name : '', type, disc };
  else if (typeof q.term === 'string') form.text = q.term;
  else if (typeof q.name === 'string') form.text = q.name;
  for (const [g, grp] of Object.entries(q.filters || {})) {
    if (!grp || grp.disabled || !grp.filters || typeof grp.filters !== 'object') continue;
    for (const [id, v] of Object.entries(grp.filters)) {
      if (!v || typeof v !== 'object') continue;
      let val;
      if ('input' in v) val = String(v.input || '');
      else { val = {}; for (const k of ['min', 'max', 'option', 'r', 'g', 'b', 'w']) if (v[k] !== undefined && v[k] !== null && v[k] !== '') val[k] = typeof v[k] === 'boolean' ? String(v[k]) : v[k]; }
      if (typeof val === 'string' ? val : Object.keys(val).length) (form.filters[g] = form.filters[g] || {})[id] = val;
    }
  }
  const ids = idIndex(index);
  let unknown = 0;
  for (const sg of Array.isArray(q.stats) ? q.stats : []) {
    if (!sg || !Array.isArray(sg.filters) || !sg.filters.length) continue;
    const g = { type: sg.type || 'and', min: sg.value && sg.value.min !== undefined ? sg.value.min : '', max: sg.value && sg.value.max !== undefined ? sg.value.max : '', off: !!sg.disabled, stats: [] };
    for (const f of sg.filters) {
      const hit = f && ids.get(f.id);
      if (!hit) { unknown += 1; continue; }
      const v = f.value || {};
      g.stats.push({ ref: hit.ref, kind: hit.kind, kinds: hit.kinds, min: v.min ?? '', max: v.max ?? '', weight: v.weight ?? '', off: !!f.disabled });
    }
    if (g.stats.length) form.groups.push(g);
  }
  return { form: cleanForm(form), unknown };
}

module.exports = { formFromQuery, KIND_WORDS, readItems, readStatic, findItems, findStatic, statList, findStats, cleanForm, isEmpty, needsSignIn, buildFind, buildBulk, nameOf, cleanSaved };
