'use strict';
// Prices from poe.ninja's documented PoE 1 economy API (https://poe.ninja/docs/api).
const { normalize } = require('./fuzzy');

const BASE = 'https://poe.ninja/poe1/api/economy';

// Currency-exchange based categories (stackables).
const EXCHANGE_TYPES = [
  'Currency', 'Fragment', 'Scarab', 'DivinationCard', 'Oil', 'Fossil', 'Resonator', 'Essence',
  'DeliriumOrb', 'Omen', 'Tattoo', 'Artifact', 'AllflameEmber', 'Runegraft', 'Astrolabe', 'DjinnCoin',
];
// Stash-listing based categories.
const ITEM_TYPES = [
  'Incubator', 'Vial', 'Invitation', 'Memory', 'Wombgift', 'UniqueMap',
  'UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel',
];
// Unidentified uniques only show their base type on the ground, so the screen scan ignores them.
const NOT_ON_SCREEN = new Set(['UniqueMap', 'UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel']);

function parseExchange(json, category) {
  const out = [];
  if (!json || !Array.isArray(json.lines) || !json.core) return out;
  const names = new Map();
  for (const it of json.core.items || []) names.set(it.id, it.name);
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
    out.push({ name, chaos: v * factor, category });
  }
  return out;
}

function parseItemOverview(json, category) {
  const best = new Map();
  if (!json || !Array.isArray(json.lines)) return [];
  for (const line of json.lines) {
    const v = Number(line.chaosValue);
    if (!line.name || !isFinite(v) || v <= 0) continue;
    if (line.links && line.links >= 5) continue; // 5/6-link prices would overstate a normal drop
    const prev = best.get(line.name);
    if (!prev || v < prev.chaos) best.set(line.name, { name: line.name, chaos: v, category });
  }
  return [...best.values()];
}

class PriceTable {
  constructor() {
    this.byNorm = new Map();
    this.updatedAt = 0;
    this.league = null;
  }

  load(entries) {
    this.byNorm = new Map();
    this.byNorm.set('chaos orb', { name: 'Chaos Orb', chaos: 1, category: 'Currency' });
    for (const e of entries) {
      const k = normalize(e.name);
      if (!this.byNorm.has(k)) this.byNorm.set(k, e);
    }
  }

  get size() { return this.byNorm.size; }
  get(name) { return this.byNorm.get(normalize(name)) || null; }
  chaosOf(name) { const e = this.get(name); return e ? e.chaos : 0; }
  get divine() { return this.chaosOf('Divine Orb'); }

  screenNames() {
    const out = [];
    for (const e of this.byNorm.values()) if (!NOT_ON_SCREEN.has(e.category)) out.push(e.name);
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

module.exports = { PriceTable, PriceService, parseExchange, parseItemOverview, EXCHANGE_TYPES, ITEM_TYPES };
