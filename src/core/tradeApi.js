'use strict';
// Talks to the official trade site: one search, then the ten cheapest listings it found.
// The site says in every answer how many requests it allows; this keeps to that and refuses
// to send rather than queue, so a burst of key presses can never get the PC locked out.
// Plain logic: the fetch function and the clock are passed in.

const SITE = 'https://www.pathofexile.com';
const CACHE_MS = 60 * 1000;
const GAP_MS = 2000; // the least time between two requests of one kind, whatever the site allows

class TradeError extends Error {
  constructor(message, waitMs = 0) { super(message); this.waitMs = waitMs; }
}

// "8:10:60,15:60:120" and "1:10:0,3:60:0" -> [{ max, windowMs, hits, lockedMs }]
function parseLimits(limit, state) {
  const a = String(limit || '').split(',').filter(Boolean);
  const b = String(state || '').split(',');
  return a.map((rule, i) => {
    const [max, window] = rule.split(':').map(Number);
    const [hits, , locked] = String(b[i] || '').split(':').map(Number);
    return { max, windowMs: window * 1000, hits: hits || 0, lockedMs: (locked || 0) * 1000 };
  }).filter((r) => r.max > 0 && r.windowMs > 0);
}

const seconds = (ms) => Math.max(1, Math.ceil(ms / 1000));

class TradeClient {
  constructor({ fetchImpl, now = Date.now } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.limits = { search: null, fetch: null }; // kind -> { at, rules, until, last }
    this.cache = new Map();
    this.busy = false;
  }

  // How long until a request of this kind may be sent. 0: now.
  waitMs(kind) {
    const l = this.limits[kind];
    if (!l) return 0;
    const now = this.now();
    let wait = Math.max(0, (l.until || 0) - now, l.last + GAP_MS - now);
    for (const r of l.rules) {
      if (r.lockedMs) wait = Math.max(wait, l.at + r.lockedMs - now);
      // Every request the site had counted when it last answered is taken to be still counted
      // until a full window has passed since then. That is stricter than the site itself.
      const hits = r.hits + l.sent;
      if (hits >= r.max) wait = Math.max(wait, l.at + r.windowMs - now);
    }
    return Math.max(0, wait);
  }

  note(kind, res) {
    const now = this.now();
    const l = this.limits[kind] || { at: now, rules: [], until: 0, last: now, sent: 0 };
    l.last = now;
    const h = (name) => (res.headers && res.headers.get ? res.headers.get(name) : null);
    const names = String(h('x-rate-limit-rules') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (names.length) {
      l.rules = names.flatMap((n) => parseLimits(h(`x-rate-limit-${n}`), h(`x-rate-limit-${n}-state`)));
      l.at = now; l.sent = 0;
    } else {
      l.sent += 1;
    }
    const retry = Number(h('retry-after'));
    if (res.status === 429) l.until = now + (retry > 0 ? retry * 1000 : 60 * 1000);
    this.limits[kind] = l;
  }

  async call(kind, url, init) {
    const wait = this.waitMs(kind);
    if (wait > 0) throw new TradeError(`The trade site allows another search in ${seconds(wait)} s.`, wait);
    const res = await this.fetchImpl(url, { ...init, headers: { Accept: 'application/json', ...(init && init.headers) } });
    this.note(kind, res);
    let json = null;
    try { json = await res.json(); } catch (_) { /* not JSON: a block page or an outage */ }
    if (res.status === 429) throw new TradeError(`Too many searches. The trade site allows another in ${seconds(this.waitMs(kind))} s.`, this.waitMs(kind));
    if (json && json.error) throw new TradeError(`The trade site said: ${json.error.message || 'the search was not accepted'}`);
    if (!res.ok || !json) throw new TradeError(`The trade site did not answer the search (${res.status}).`);
    return json;
  }

  // body: from buildQuery. Returns { queryId, total, listings: [...] } with the cheapest
  // `count` listings as the site sent them. The same search within a minute is not sent again.
  async check(league, body, count = 10) {
    if (!league) throw new TradeError('Choose a league in Settings first.');
    const key = `${league}\n${JSON.stringify(body)}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.value;
    if (this.busy) throw new TradeError('A search is already running.');
    this.busy = true;
    try {
      // Both steps must be allowed before the first is sent, or a search would be spent for nothing.
      const wait = Math.max(this.waitMs('search'), this.waitMs('fetch'));
      if (wait > 0) throw new TradeError(`The trade site allows another search in ${seconds(wait)} s.`, wait);
      const found = await this.call('search', `${SITE}/api/trade/search/${encodeURIComponent(league)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const ids = Array.isArray(found.result) ? found.result.slice(0, Math.min(10, count)) : [];
      const value = { queryId: found.id || '', total: Number(found.total) || 0, listings: [] };
      if (ids.length) {
        const got = await this.call('fetch', `${SITE}/api/trade/fetch/${ids.join(',')}?query=${encodeURIComponent(value.queryId)}`, {});
        value.listings = (got.result || []).filter(Boolean);
      }
      for (const [k, v] of this.cache) if (this.now() - v.at >= CACHE_MS) this.cache.delete(k);
      this.cache.set(key, { at: this.now(), value });
      return value;
    } finally {
      this.busy = false;
    }
  }

  // The two steps of a search on their own, for reading many results (the Ultimatum page):
  // every result id of a search (the site gives at most 100), and the items of up to ten ids.
  // Each holds the client only while its one request is out. Nothing is kept.
  async search(league, body) {
    if (this.busy) throw new TradeError('A search is already running.');
    this.busy = true;
    try {
      const found = await this.call('search', `${SITE}/api/trade/search/${encodeURIComponent(league)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { queryId: found.id || '', total: Number(found.total) || 0, ids: Array.isArray(found.result) ? found.result : [] };
    } finally { this.busy = false; }
  }
  async fetchItems(ids, queryId) {
    if (!ids.length) return [];
    if (this.busy) throw new TradeError('A search is already running.');
    this.busy = true;
    try {
      const got = await this.call('fetch', `${SITE}/api/trade/fetch/${ids.slice(0, 10).join(',')}?query=${encodeURIComponent(queryId)}`, {});
      return (got.result || []).filter(Boolean);
    } finally { this.busy = false; }
  }

  // The bulk exchange (currency and other stackables): offers selling `want` for `have`, as the
  // site sends them in one request. Returns { queryId, total, offers: [...] }.
  async exchange(league, want, have) {
    if (!league) throw new TradeError('Choose a league in Settings first.');
    const body = { engine: 'new', query: { status: { option: 'online' }, have: [have], want: [want] }, sort: { have: 'asc' } };
    const key = `exchange\n${league}\n${JSON.stringify(body)}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.value;
    if (this.busy) throw new TradeError('A search is already running.');
    this.busy = true;
    try {
      const found = await this.call('exchange', `${SITE}/api/trade/exchange/${encodeURIComponent(league)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const offers = Object.values(found.result || {}).filter((r) => r && r.listing && Array.isArray(r.listing.offers) && r.listing.offers.length === 1);
      const value = { queryId: found.id || '', total: Number(found.total) || offers.length, offers };
      this.cache.set(key, { at: this.now(), value });
      return value;
    } finally {
      this.busy = false;
    }
  }
}

// A socket's colour as the site gives it, or worked out from its attribute when that is missing
// (Strength red, Dexterity green, Intelligence blue, General white, Abyss, Delve).
const SOCKET_COLOUR = { R: 'R', G: 'G', B: 'B', W: 'W', A: 'A', DV: 'D' };
const ATTR_COLOUR = { S: 'R', D: 'G', I: 'B', G: 'W', A: 'A', DV: 'D' };
// The sockets of a listed item, written as the game writes them: "R-R-G B".
function socketText(sockets) {
  if (!Array.isArray(sockets) || !sockets.length) return '';
  let out = '';
  sockets.forEach((x, i) => {
    if (i) out += sockets[i - 1].group === x.group ? '-' : ' ';
    out += SOCKET_COLOUR[String(x.sColour || '').toUpperCase()] || ATTR_COLOUR[String(x.attr || '').toUpperCase()] || 'W';
  });
  return out;
}

// The number a listing has for one stat: the stat's line found through the site's list of which
// line carries which stat, then the average of the numbers in it ("Adds 2 to 10": 6).
function statValue(item, ids) {
  const hashes = (item.extended && item.extended.hashes) || {};
  for (const [type, list] of Object.entries(hashes)) {
    for (const [id, where] of list || []) {
      if (!ids.includes(id)) continue;
      const line = plainText(modText(((item[`${type}Mods`] || [])[(where || [])[0]]) || ''));
      const nums = (line.match(/\d+(\.\d+)?/g) || []).map(Number);
      if (nums.length) return nums.reduce((a, b) => a + b, 0) / nums.length;
    }
  }
  return null;
}

// One listing as the site sends it -> what the app shows.
// chaosOf: (amount, currency) -> value in chaos, or null when the currency's rate is unknown.
// compare: what each listing is compared on (compareSpec in tradeQuery), or null.
function readListing(raw, chaosOf = () => null, compare = null) {
  const l = raw.listing || {}, it = raw.item || {}, acc = l.account || {};
  const price = l.price && isFinite(Number(l.price.amount)) ? { amount: Number(l.price.amount), currency: String(l.price.currency || '') } : null;
  let cmp = null;
  if (compare && compare.prop) { const v = Number((it.extended || {})[compare.prop]); cmp = isFinite(v) && v > 0 ? v : null; }
  else if (compare && compare.ids) cmp = statValue(it, compare.ids);
  return {
    id: raw.id, price, chaos: price ? chaosOf(price.amount, price.currency) : null,
    seller: acc.lastCharacterName || acc.name || '',
    // A listing with a fee is in a merchant's tab: bought at once in the seller's hideout, no whisper.
    status: l.fee != null ? 'instant' : (acc.online ? (acc.online.status === 'afk' ? 'afk' : 'online') : 'offline'),
    listedAt: l.indexed ? Date.parse(l.indexed) || 0 : 0, itemLevel: it.ilvl || null, corrupted: !!it.corrupted,
    name: [it.name, it.typeLine].filter(Boolean).join(', '),
    // Its picture (only from the game's own picture site) with its sockets, and its size in cells.
    icon: /^https:\/\/web\.poecdn\.com\//.test(it.icon || '') ? it.icon : null,
    base: it.baseType || it.typeLine || '', w: it.w || 1, h: it.h || 1, sockets: socketText(it.sockets),
    cmp: cmp === null ? null : Math.round(cmp * 10) / 10,
    // The line the site would have you send the seller (the Trade page's buying list types it on a click).
    whisper: typeof l.whisper === 'string' ? l.whisper : '',
    detail: itemDetail(it),
  };
}

// A modifier as the site sends it: usually a line of text, but some answers carry an object
// with the line in one of its fields. Whatever the shape, the line of text in it.
function modText(t) {
  if (typeof t === 'string') return t;
  if (!t || typeof t !== 'object') return '';
  for (const k of ['text', 'description', 'mod', 'line', 'value', 'name']) if (typeof t[k] === 'string' && t[k]) return t[k];
  for (const v of Object.values(t)) if (typeof v === 'string' && /\s/.test(v)) return v;
  return '';
}
// The site writes some words as links: "[Life|maximum Life]" or "[Armour]". Only the words shown.
const plainText = (t) => String(t || '').replace(/\[(?:[^\]|]*\|)?([^\]]*)\]/g, '$1');
const RARITY = ['normal', 'magic', 'rare', 'unique'];
// What a listed item is, as the game shows it when you hover it: its name, base, item level,
// properties (quality, armour, damage...) and every modifier with its kind, in the game's order.
function itemDetail(it) {
  const props = [];
  for (const p of it.properties || []) {
    const name = plainText(p.name);
    const v = (p.values || []).map((x) => x && x[0]).filter((x) => x !== undefined && x !== null).join(', ');
    if (!name || /\{\d\}/.test(name) || !v) continue; // the shape of a weapon's class line, not a number
    props.push([name, plainText(v)]);
  }
  const mods = [];
  const add = (list, kind) => {
    for (const t of Array.isArray(list) ? list : []) {
      const text = plainText(modText(t));
      // nothing readable: the raw shape is kept for the line's hover text, so it can be reported
      if (!text) { mods.push({ text: '(a modifier the app could not read)', kind, raw: JSON.stringify(t).slice(0, 300) }); continue; }
      for (const line of text.split('\n')) if (line.trim()) mods.push({ text: line, kind });
    }
  };
  add(it.enchantMods, 'enchant'); add(it.implicitMods, 'implicit'); add(it.fracturedMods, 'fractured');
  add(it.explicitMods, 'explicit'); add(it.craftedMods, 'crafted');
  return {
    name: plainText(it.name), base: plainText(it.typeLine), rarity: RARITY[it.frameType] || (it.frameType === 9 ? 'relic' : 'rare'),
    ilvl: it.ilvl || null, props, mods, corrupted: !!it.corrupted, mirrored: !!it.duplicated, split: !!it.split,
  };
}

// One bulk exchange offer -> a listing as the window shows it: the price of one, what the
// seller has, who and when. null when it makes no sense (nothing offered).
function readOffer(raw, chaosOf = () => null) {
  const l = raw.listing || {}, acc = l.account || {};
  const o = (l.offers || [])[0] || {}, pay = o.exchange || {}, get = o.item || {};
  const payAmount = Number(pay.amount), getAmount = Number(get.amount);
  if (!(payAmount > 0) || !(getAmount > 0)) return null;
  const each = payAmount / getAmount;
  const currency = String(pay.currency || '');
  return {
    id: raw.id, price: { amount: each, currency }, chaos: chaosOf(each, currency),
    deal: { pay: payAmount, get: getAmount }, stock: Number(get.stock) || null,
    seller: acc.lastCharacterName || acc.name || '',
    status: acc.online ? (acc.online.status === 'afk' ? 'afk' : 'online') : 'offline',
    listedAt: l.indexed ? Date.parse(l.indexed) || 0 : 0, icon: null, w: 1, h: 1, sockets: '',
  };
}

// The trade site's short names for currencies -> the names prices are kept under.
const CURRENCIES = {
  chaos: 'Chaos Orb', divine: 'Divine Orb', exalted: 'Exalted Orb', mirror: 'Mirror of Kalandra', alch: 'Orb of Alchemy',
  vaal: 'Vaal Orb', fusing: 'Orb of Fusing', chisel: "Cartographer's Chisel", alt: 'Orb of Alteration', chrome: 'Chromatic Orb',
  jewellers: "Jeweller's Orb", regal: 'Regal Orb', gcp: "Gemcutter's Prism", scour: 'Orb of Scouring', regret: 'Orb of Regret',
  blessed: 'Blessed Orb', annul: 'Orb of Annulment', chance: 'Orb of Chance', awakened_sextant: 'Awakened Sextant',
};
const currencyName = (id) => CURRENCIES[id] || '';

const exchangeUrl = (league, queryId) => `${SITE}/trade/exchange/${encodeURIComponent(league)}/${encodeURIComponent(queryId)}`;
const searchUrl = (league, queryId) => `${SITE}/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(queryId)}`;

module.exports = { TradeClient, TradeError, parseLimits, readListing, readOffer, itemDetail, socketText, searchUrl, exchangeUrl, currencyName };
