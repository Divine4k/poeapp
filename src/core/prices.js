'use strict';
// Prices from poe.ninja's documented PoE 1 economy API (https://poe.ninja/docs/api).
const { normalize } = require('./fuzzy');

const BASE = 'https://poe.ninja/poe1/api/economy';

// Every category poe.ninja publishes for PoE 1 (from its API documentation plus the 3.30 additions).
// Currency-exchange based categories (stackables):
const EXCHANGE_TYPES = [
  'Currency', 'Fragment', 'Thread', 'Runegraft', 'AllflameEmber', 'Tattoo', 'Omen', 'DjinnCoin', 'Ducat',
  'EnshroudingCrystal', 'DivinationCard', 'Artifact', 'Oil', 'DeliriumOrb', 'Scarab', 'Astrolabe', 'Fossil',
  'Resonator', 'Essence',
];
// Stash-listing based categories:
const ITEM_TYPES = [
  'Wombgift', 'Incubator', 'Corpse', 'Viscera', 'Vial', 'Invitation', 'Memory', 'IncursionTemple', 'Beast',
  'UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel', 'ForbiddenJewel', 'ShrineBelt',
  'UniqueTincture', 'UniqueRelic', 'SkillGem', 'ImbuedGem', 'ClusterJewel',
  'Map', 'BlightedMap', 'BlightRavagedMap', 'UniqueMap', 'ValdoMap', 'BaseType',
];
// Categories whose items are one inventory cell, stack, and each have their own picture, so the
// inventory reader can recognise them. Divination cards are left out: they all share one picture.
const ON_SCREEN = new Set([...EXCHANGE_TYPES.filter((t) => t !== 'DivinationCard'), 'Wombgift', 'Incubator', 'Vial', 'Viscera']);

// poe.ninja gives item art either as a full URL or as a path on GGG's image CDN.
function iconUrl(v) {
  if (!v || typeof v !== 'string') return null;
  if (/^https?:\/\//.test(v)) return v;
  return v.startsWith('/') ? `https://web.poecdn.com${v}` : null;
}

// Categories whose items all look the same in game, so poe.ninja sends no picture per item.
// They all get this one picture instead. Divination cards: the card every one of them shows as.
const SHARED_ICONS = {
  DivinationCard: 'https://web.poecdn.com/image/Art/2DItems/Divination/InventoryIcon.png',
};

// The week's price movement as a short list of numbers, for drawing a small trend line.
function sparkOf(s) {
  if (!s || !Array.isArray(s.data)) return null;
  const pts = s.data.filter((v) => typeof v === 'number' && isFinite(v)).map((v) => Math.round(v * 10) / 10);
  return pts.length >= 2 ? pts.slice(-8) : null;
}

function parseExchange(json, category) {
  const out = [];
  if (!json || !Array.isArray(json.lines) || !json.core) return out;
  const names = new Map();
  const icons = new Map();
  // The full item list is the top-level `items`; `core.items` only holds the reference currencies.
  for (const it of [...(json.core.items || []), ...(json.items || [])]) {
    if (!it || !it.id) continue;
    names.set(it.id, it.name);
    icons.set(it.id, iconUrl(it.image || it.icon));
  }
  const primary = json.core.primary;
  let factor = 1;
  if (primary && primary !== 'chaos') {
    factor = json.core.rates && Number(json.core.rates.chaos);
    if (!factor) return out;
  }
  for (const line of json.lines) {
    const name = names.get(line.id);
    const v = Number(line.primaryValue);
    if (!name || !isFinite(v) || v <= 0) continue;
    out.push({
      name, chaos: v * factor, category, icon: icons.get(line.id) || SHARED_ICONS[category] || null,
      tradeId: line.id, // poe.ninja uses the trade site's names: what the bulk exchange is searched with
      change: line.sparkline && isFinite(Number(line.sparkline.totalChange)) ? Number(line.sparkline.totalChange) : null,
      volume: isFinite(Number(line.volumePrimaryValue)) ? Number(line.volumePrimaryValue) * factor : null,
      spark: sparkOf(line.sparkline),
    });
  }
  return out;
}

// What sets one listing of an item apart from another with the same name.
function variantLabel(line, category) {
  const parts = [];
  if (line.mapTier) parts.push(`T${line.mapTier}`);
  if (category === 'BaseType' && line.levelRequired) parts.push(`ilvl ${line.levelRequired}`);
  if (line.links) parts.push(`${line.links}L`);
  if (line.variant) parts.push(String(line.variant));
  return parts.join(', ');
}

// Every item gets one entry under its plain name (its cheapest ordinary version, so a quick
// price check never overstates), plus one entry per variant, e.g. "Enlighten Support (3/0c)".
function parseItemOverview(json, category) {
  if (!json || !Array.isArray(json.lines)) return [];
  const trend = (line) => {
    const s = line.sparkLine || line.sparkline || line.lowConfidenceSparkLine;
    return s && isFinite(Number(s.totalChange)) ? Number(s.totalChange) : null;
  };
  const extra = (line) => ({
    ...(/^Unique/.test(category) && line.baseType ? { base: line.baseType } : {}), // for unidentified uniques
    icon: iconUrl(line.icon), change: trend(line), listings: isFinite(Number(line.listingCount)) ? Number(line.listingCount) : null,
    spark: sparkOf(line.sparkLine || line.sparkline || line.lowConfidenceSparkLine),
  });
  const byName = new Map();
  for (const line of json.lines) {
    const v = Number(line.chaosValue);
    if (!line.name || !isFinite(v) || v <= 0) continue;
    if (!byName.has(line.name)) byName.set(line.name, []);
    byName.get(line.name).push({ line, v });
  }
  const out = [];
  for (const [name, list] of byName) {
    const plain = list.filter((x) => !(x.line.links >= 5)); // 5/6-link prices would overstate a normal drop
    const pool = plain.length ? plain : list;
    const cheapest = pool.reduce((m, x) => (x.v < m.v ? x : m));
    const plainEntry = { name, chaos: cheapest.v, category, ...extra(cheapest.line) };
    // Some uniques are listed per variant with very different prices (Mageblood by how many
    // flasks it holds: 2 cheap, 4 dear). The plain price is the cheapest; `high` is the dearest
    // variant that is commonly listed (5 or more), so a price can be shown as the range it is.
    const common = pool.filter((x) => Number(x.line.listingCount) >= 5);
    const high = common.length ? Math.max(...common.map((x) => x.v)) : cheapest.v;
    if (high > cheapest.v * 1.15) plainEntry.high = high;
    out.push(plainEntry);
    if (list.length < 2) continue;
    const seen = new Set();
    for (const x of list) {
      const label = variantLabel(x.line, category);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push({ name: `${name} (${label})`, chaos: x.v, category, ...extra(x.line), variant: true });
      plainEntry.hasVariants = true; // the price browser lists the variants instead of this summary line
    }
  }
  return out;
}

class PriceTable {
  constructor() {
    this.byNorm = new Map();
    this.updatedAt = 0;
    this.league = null;
  }

  load(entries) {
    this.byNorm = new Map();
    for (const e of entries) {
      const k = normalize(e.name);
      if (!this.byNorm.has(k)) this.byNorm.set(k, e);
    }
    // Chaos is the unit everything is priced in. Keep its picture if the data brought one.
    const chaos = this.byNorm.get('chaos orb');
    this.byNorm.set('chaos orb', { name: 'Chaos Orb', category: 'Currency', icon: chaos ? chaos.icon || null : null, chaos: 1 });
  }

  get size() { return this.byNorm.size; }

  // Prices you set yourself, for items poe.ninja does not list. They win over downloaded prices.
  setCustom(prices) {
    this.custom = new Map();
    for (const [name, chaos] of Object.entries(prices || {})) {
      const v = Number(chaos);
      if (name && isFinite(v) && v >= 0) this.custom.set(normalize(name), { name, chaos: v, category: 'Custom', icon: null });
    }
  }

  get(name) {
    const k = normalize(name);
    return (this.custom && this.custom.get(k)) || this.byNorm.get(k) || null;
  }
  // The downloaded entry for a name, whatever price of your own you may have set for it.
  listed(name) { return this.byNorm.get(normalize(name)) || null; }
  // Your own price for a name, or null.
  ownPrice(name) { const e = this.custom && this.custom.get(normalize(name)); return e ? e.chaos : null; }
  chaosOf(name) { const e = this.get(name); return e ? e.chaos : 0; }
  // The uniques that come on a base type, dearest first: what an unidentified unique can be.
  uniquesOfBase(base) {
    const out = [];
    for (const e of this.byNorm.values()) if (e.base === base && !e.variant && /^Unique/.test(e.category)) out.push({ name: e.name, chaos: e.chaos, high: e.high || null, icon: e.icon || null });
    return out.sort((a, b) => (b.high || b.chaos) - (a.high || a.chaos));
  }
  get divine() { return this.chaosOf('Divine Orb'); }

  // Items that can be recognised by their inventory picture.
  iconEntries() {
    const out = [];
    for (const e of this.byNorm.values()) if (e.icon && !e.variant && ON_SCREEN.has(e.category)) out.push({ name: e.name, icon: e.icon });
    return out;
  }

  search(query, limit = 30) {
    const q = normalize(query);
    if (!q) return [];
    const starts = [], contains = [];
    for (const [k, e] of this.byNorm) {
      if (k.startsWith(q)) starts.push(e);
      else if (k.includes(q)) contains.push(e);
    }
    const byValue = (a, b) => b.chaos - a.chaos;
    return starts.sort(byValue).concat(contains.sort(byValue)).slice(0, limit);
  }

  // Number of browsable rows per category: { Currency: 108, ... }
  categoryCounts() {
    const out = { Custom: this.custom ? this.custom.size : 0 };
    for (const e of this.byNorm.values()) if (!e.hasVariants) out[e.category] = (out[e.category] || 0) + 1;
    return out;
  }

  // A picture to stand for each category: its most valuable item's.
  categoryIcons() {
    const best = {};
    for (const e of this.byNorm.values()) {
      if (!e.icon) continue;
      if (!best[e.category] || e.chaos > best[e.category].chaos) best[e.category] = e;
    }
    const out = {};
    for (const k of Object.keys(best)) out[k] = best[k].icon;
    return out;
  }

  // Rows for the price browser, most valuable first. category '' means every category.
  list(category, query = '', limit = 400) {
    const q = normalize(query);
    const rows = [];
    if (this.custom && (!category || category === 'Custom')) for (const [k, e] of this.custom) if (!q || k.includes(q)) rows.push(e);
    for (const [k, e] of this.byNorm) {
      if (e.hasVariants) continue;
      if (category && e.category !== category) continue;
      if (q && !k.includes(q)) continue;
      rows.push(e);
    }
    rows.sort((a, b) => b.chaos - a.chaos);
    return { total: rows.length, rows: rows.slice(0, limit) };
  }

  toJSON() { return { league: this.league, updatedAt: this.updatedAt, entries: [...this.byNorm.values()] }; }
  static fromJSON(o) {
    const t = new PriceTable();
    if (o && Array.isArray(o.entries)) { t.load(o.entries); t.league = o.league; t.updatedAt = o.updatedAt || 0; }
    return t;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class PriceService {
  constructor({ fetchImpl = globalThis.fetch, userAgent = 'poe-map-companion/0.1 (personal use)' } = {}) {
    this.fetch = fetchImpl;
    this.userAgent = userAgent.replace(/[^\x20-\x7e]/g, '');
    this.cache = new Map(); // url -> { etag, entries }
  }

  async getJson(url) {
    const cached = this.cache.get(url);
    const headers = { 'User-Agent': this.userAgent, Accept: 'application/json' };
    if (cached && cached.etag) headers['If-None-Match'] = cached.etag;
    const res = await this.fetch(url, { headers });
    if (res.status === 304 && cached) return { notModified: true };
    if (!res.ok) throw new Error(`poe.ninja answered ${res.status} for ${url}`);
    return { json: await res.json(), etag: res.headers.get('etag') };
  }

  async leagues() {
    const { json } = await this.getJson(`${BASE}/leagues`);
    return Array.isArray(json) ? json.map((l) => ({ id: l.id, name: l.name || l.id })) : [];
  }

  // Returns { table, errors }. Categories that fail are skipped, not fatal.
  async refresh(league) {
    const jobs = [
      ...EXCHANGE_TYPES.map((t) => ({ t, url: `${BASE}/exchange/current/overview?league=${encodeURIComponent(league)}&type=${t}`, parse: parseExchange })),
      ...ITEM_TYPES.map((t) => ({ t, url: `${BASE}/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${t}`, parse: parseItemOverview })),
    ];
    const all = [];
    const errors = [];
    for (const job of jobs) {
      try {
        const r = await this.getJson(job.url);
        if (r.notModified) {
          all.push(...this.cache.get(job.url).entries);
        } else {
          const entries = job.parse(r.json, job.t);
          this.cache.set(job.url, { etag: r.etag, entries });
          all.push(...entries);
        }
      } catch (e) {
        errors.push(`${job.t}: ${e.message}`);
        const cached = this.cache.get(job.url);
        if (cached) all.push(...cached.entries);
      }
      await sleep(250); // keep request volume gentle
    }
    const table = new PriceTable();
    table.load(all);
    table.league = league;
    table.updatedAt = Date.now();
    return { table, errors };
  }
}

// How categories are named and grouped in the price browser, in display order.
const CATEGORY_LABELS = [
  ['Yours', [['Custom', 'Your own prices']]],
  ['General', [['Currency', 'Currency'], ['Fragment', 'Fragments'], ['Thread', 'Threads'], ['Wombgift', 'Wombgifts'], ['Runegraft', 'Runegrafts'],
    ['AllflameEmber', 'Allflame Embers'], ['Corpse', 'Corpses'], ['Viscera', 'Viscera'], ['Tattoo', 'Tattoos'], ['Omen', 'Omens'], ['DjinnCoin', 'Djinn Coins'],
    ['Ducat', 'Ducats'], ['EnshroudingCrystal', 'Enshrouding Crystals'], ['DivinationCard', 'Divination Cards'], ['Artifact', 'Artifacts'], ['Oil', 'Oils'],
    ['Incubator', 'Incubators'], ['DeliriumOrb', 'Delirium Orbs'], ['Astrolabe', 'Astrolabes'], ['Fossil', 'Fossils'], ['Resonator', 'Resonators'],
    ['Essence', 'Essences'], ['Vial', 'Vials'], ['Scarab', 'Scarabs'], ['Beast', 'Beasts']]],
  ['Equipment and gems', [['UniqueWeapon', 'Unique Weapons'], ['UniqueArmour', 'Unique Armours'], ['UniqueAccessory', 'Unique Accessories'],
    ['UniqueFlask', 'Unique Flasks'], ['UniqueJewel', 'Unique Jewels'], ['ForbiddenJewel', 'Forbidden Jewels'], ['ShrineBelt', 'Shrine Belts'],
    ['UniqueTincture', 'Unique Tinctures'], ['UniqueRelic', 'Unique Relics'], ['SkillGem', 'Skill Gems'], ['ImbuedGem', 'Imbued Gems'],
    ['ClusterJewel', 'Cluster Jewels'], ['BaseType', 'Base Types']]],
  ['Atlas', [['Map', 'Maps'], ['BlightedMap', 'Blighted Maps'], ['BlightRavagedMap', 'Blight-ravaged Maps'], ['UniqueMap', 'Unique Maps'],
    ['ValdoMap', 'Valdo Maps'], ['Invitation', 'Invitations'], ['Memory', 'Memories'], ['IncursionTemple', 'Incursion Temples']]],
];

module.exports = { CATEGORY_LABELS, PriceTable, PriceService, parseExchange, parseItemOverview, iconUrl, SHARED_ICONS, EXCHANGE_TYPES, ITEM_TYPES, ON_SCREEN };
