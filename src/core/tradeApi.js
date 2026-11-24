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
}

// One listing as the site sends it -> what the app shows.
// chaosOf: (amount, currency) -> value in chaos, or null when the currency's rate is unknown.
function readListing(raw, chaosOf = () => null) {
  const l = raw.listing || {}, it = raw.item || {}, acc = l.account || {};
  const price = l.price && isFinite(Number(l.price.amount)) ? { amount: Number(l.price.amount), currency: String(l.price.currency || '') } : null;
  return {
    id: raw.id, price, chaos: price ? chaosOf(price.amount, price.currency) : null,
    seller: acc.lastCharacterName || acc.name || '',
    // A listing with a fee is in a merchant's tab: bought at once in the seller's hideout, no whisper.
    status: l.fee != null ? 'instant' : (acc.online ? (acc.online.status === 'afk' ? 'afk' : 'online') : 'offline'),
    listedAt: l.indexed ? Date.parse(l.indexed) || 0 : 0, itemLevel: it.ilvl || null, corrupted: !!it.corrupted,
    name: [it.name, it.typeLine].filter(Boolean).join(', '),
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

const searchUrl = (league, queryId) => `${SITE}/trade/search/${encodeURIComponent(league)}/${encodeURIComponent(queryId)}`;

module.exports = { TradeClient, TradeError, parseLimits, readListing, searchUrl, currencyName };
