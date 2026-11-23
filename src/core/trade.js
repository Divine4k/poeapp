'use strict';
// Trade offers read from whispers in the game log, and what to do next with each one.
// Plain logic, no Electron: the log reader feeds events in, the windows show summary().

// The messages the official trade site writes (English):
//   Hi, I would like to buy your Tabula Rasa Simple Robe listed for 10 chaos in Standard (stash tab "Sell"; position: left 3, top 5)
//   Hi, I would like to buy your Tabula Rasa Simple Robe in Standard (stash tab "Sell"; position: left 3, top 5)
//   Hi, I'd like to buy your 10 Chaos Orb for my 1 Divine Orb in Standard
const RE_PRICED = /^Hi, I would like to buy your (.+?) listed for ([\d.,]+) (.+?) in ([^(]+?) \(stash tab "(.*?)"; position: left (\d+), top (\d+)\)\s*(.*)$/;
const RE_UNPRICED = /^Hi, I would like to buy your (.+) in ([^(]+?) \(stash tab "(.*?)"; position: left (\d+), top (\d+)\)\s*(.*)$/;
// The league ends the message. Older versions of the site put a full stop after it.
const RE_BULK = /^Hi, I'd like to buy your ([\d.,]+) (.+?) for my ([\d.,]+) (.+?) in ([^.]+?)(?:\.\s*(.*))?$/;

const num = (s) => {
  const v = parseFloat(String(s).replace(/,(\d{3})(?!\d)/g, '$1').replace(',', '.'));
  return isFinite(v) ? v : 0;
};

// Returns { item, qty, price: { amount, currency } | null, league, tab, left, top, note } or null.
function parseTradeMessage(text) {
  const t = String(text || '').trim();
  let m = RE_PRICED.exec(t);
  if (m) {
    return { item: m[1], qty: 1, price: { amount: num(m[2]), currency: m[3] }, league: m[4], tab: m[5], left: +m[6], top: +m[7], note: m[8] || '' };
  }
  m = RE_UNPRICED.exec(t);
  if (m) return { item: m[1], qty: 1, price: null, league: m[2], tab: m[3], left: +m[4], top: +m[5], note: m[6] || '' };
  m = RE_BULK.exec(t);
  if (m) return { item: m[2], qty: num(m[1]), price: { amount: num(m[3]), currency: m[4] }, league: m[5], tab: '', left: 0, top: 0, note: m[6] || '' };
  return null;
}

// The short currency words the trade site uses, as the names prices are listed under.
const CURRENCY = {
  chaos: 'Chaos Orb', divine: 'Divine Orb', div: 'Divine Orb', exalted: 'Exalted Orb', exa: 'Exalted Orb', ex: 'Exalted Orb',
  mirror: 'Mirror of Kalandra', alch: 'Orb of Alchemy', alt: 'Orb of Alteration', fusing: 'Orb of Fusing', fuse: 'Orb of Fusing',
  chance: 'Orb of Chance', chisel: "Cartographer's Chisel", vaal: 'Vaal Orb', regal: 'Regal Orb', gcp: "Gemcutter's Prism",
  jewellers: "Jeweller's Orb", chrom: 'Chromatic Orb', scour: 'Orb of Scouring', regret: 'Orb of Regret', blessed: 'Blessed Orb',
  annul: 'Orb of Annulment', aug: 'Orb of Augmentation', transmute: 'Orb of Transmutation',
};
const currencyName = (c) => CURRENCY[String(c || '').toLowerCase()] || String(c || '');

// What a price is worth in chaos, or null when the currency has no known price.
function priceChaos(price, prices) {
  if (!price || !prices) return null;
  const e = prices.get(currencyName(price.currency));
  return e ? e.chaos * price.amount : null;
}

const priceText = (p) => (p ? `${p.amount} ${p.currency}` : 'no price');

const DEFAULT_MESSAGES = {
  thanks: 'Thank you, good luck!',
  busy: 'I am busy right now. I will invite you in a few minutes if you can wait.',
  sold: 'Sorry, {item} is already sold.',
  still: 'Hi, are you still interested in {item} for {price}?',
};

// The one chat line an action sends to the game, or null when it cannot be built.
// Whispers and item names come from other players, so anything that could break out of a
// single chat line is removed.
function chatCommand(action, offer, { messages = {}, characterName = '' } = {}) {
  const who = String(offer.player || '');
  if (!/^[^\s:@/]+$/.test(who)) return null;
  const clean = (s) => String(s || '').replace(/[\r\n\t]+/g, ' ').trim();
  const say = (key) => {
    const tpl = clean(messages[key] || DEFAULT_MESSAGES[key]);
    const body = tpl.replace(/\{item\}/g, clean(offer.qty > 1 ? `${offer.qty} ${offer.item}` : offer.item))
      .replace(/\{price\}/g, priceText(offer.price)).replace(/\{player\}/g, who).slice(0, 300);
    return body ? `@${who} ${body}` : null;
  };
  switch (action) {
    case 'invite': return `/invite ${who}`;
    case 'trade': return `/tradewith ${who}`;
    case 'kick': return `/kick ${who}`;
    case 'hideout': return `/hideout ${who}`;
    case 'whois': return `/whois ${who}`;
    case 'leave': { const me = clean(characterName); return /^[^\s:@/]+$/.test(me) ? `/kick ${me}` : '/leave'; }
    case 'thanks': case 'busy': case 'sold': case 'still': return say(action);
    default: return null;
  }
}

const LABELS = {
  invite: 'Invite', trade: 'Trade', thanks: 'Say thanks', kick: 'Kick', hideout: 'Go to hideout', leave: 'Leave party',
  busy: 'Busy', sold: 'Tell them it is sold', still: 'Still interested?', whois: 'Who is',
};

// The step that moves this offer forward, or null while waiting for the other player.
function nextAction(o) {
  if (o.dir === 'in') {
    if (o.state === 'done') return o.thanked ? 'kick' : 'thanks';
    if (o.soldAlready && o.state === 'new') return 'sold';
    if (o.state === 'new') return 'invite';
    if (o.state === 'here' || o.state === 'trading') return 'trade';
    return null; // invited, not here yet
  }
  if (o.state === 'done') return o.thanked ? 'leave' : 'thanks';
  if (o.state === 'new') return 'hideout';
  return null; // in their hideout: the seller opens the trade
}

function waitingText(o) {
  if (o.dir === 'in' && o.state === 'invited') return 'Invited. Waiting for them to arrive';
  if (o.dir === 'in' && o.state === 'here') return 'In your hideout';
  if (o.state === 'trading') return 'Trade window open';
  if (o.dir === 'out' && o.state === 'there') return 'Waiting for the seller to trade';
  if (o.state === 'done') return 'Trade done';
  return '';
}

const listingKey = (o) => (o.tab ? `${o.item}|${o.tab}|${o.left}|${o.top}` : '');
const SOLD_MEMORY_MS = 60 * 60 * 1000;
const MAX_OFFERS = 30;
const MAX_HISTORY = 500;

class TradeBook {
  constructor() {
    this.offers = [];
    this.history = []; // finished trades, newest first
    this.sold = new Map(); // listing key -> when it was sold, to answer late whispers
    this.quadTabs = new Set(); // stash tabs seen with a position past 12, so 24 slots wide
    this.afk = false;
    this.seq = 1;
    this.lastTs = 0; // time of the newest log line taken in, so a restart does not count one twice
    this.seen = { whispers: 0, offers: 0, lastWhisperAt: 0 }; // since the app started, to show the log is being read
  }

  get(id) { return this.offers.find((o) => String(o.id) === String(id)) || null; }

  // ev: an event from the log reader. Returns the new offer for a new incoming whisper,
  // true for any other change, false when nothing changed.
  onLog(ev, now = Date.now()) {
    if (!ev) return false;
    if (ev.ts && ev.ts > this.lastTs && !ev.test) this.lastTs = ev.ts;
    if (ev.type === 'whisper') {
      if (!ev.test) { this.seen.whispers++; this.seen.lastWhisperAt = ev.ts || now; }
      const r = this.onWhisper(ev, now);
      if (r && !ev.test) this.seen.offers++;
      return r;
    }
    if (ev.type === 'joined' || ev.type === 'left') {
      let hit = false;
      for (const o of this.offers.filter((x) => x.dir === 'in' && x.player === ev.name)) {
        hit = true;
        o.here = ev.type === 'joined';
        if (o.here && (o.state === 'new' || o.state === 'invited')) o.state = 'here';
        else if (!o.here && (o.state === 'here' || o.state === 'trading')) o.state = 'invited';
        else if (!o.here && o.state === 'done') this.remove(o.id); // traded and gone
      }
      return hit;
    }
    if (ev.type === 'trade') {
      if (ev.result === 'accepted') return this.onAccepted(ev.ts || now);
      let hit = false;
      for (const o of this.offers) if (o.state === 'trading') { o.state = o.dir === 'in' ? 'here' : 'there'; hit = true; }
      return hit;
    }
    if (ev.type === 'afk') { this.afk = !!ev.on; return true; }
    return false;
  }

  onWhisper(ev, now) {
    const t = parseTradeMessage(ev.text);
    if (!t) return false;
    const dir = ev.dir === 'out' ? 'out' : 'in';
    const at = ev.ts || now;
    if (t.left > 12 || t.top > 12) this.quadTabs.add(t.tab);
    const same = this.offers.find((o) => o.dir === dir && o.player === ev.player && o.item === t.item && o.tab === t.tab && o.left === t.left && o.top === t.top);
    if (same) { same.asks++; same.lastAt = at; return true; }
    const offer = {
      id: this.seq++, dir, player: ev.player, ...t, at, lastAt: at, asks: 1,
      state: 'new', here: false, thanked: false, soldAlready: false, test: !!ev.test,
    };
    const soldAt = this.sold.get(listingKey(offer));
    if (dir === 'in' && soldAt && at - soldAt < SOLD_MEMORY_MS) offer.soldAlready = true;
    this.offers.push(offer);
    if (this.offers.length > MAX_OFFERS) this.offers.splice(0, this.offers.length - MAX_OFFERS);
    return offer;
  }

  // "Trade accepted." does not say with whom. It belongs to the offer a trade was opened for,
  // otherwise to the only buyer standing in the hideout, otherwise to the seller being visited.
  onAccepted(at) {
    const trading = this.offers.filter((o) => o.state === 'trading').sort((a, b) => (b.tradeAt || 0) - (a.tradeAt || 0));
    const here = this.offers.filter((o) => o.dir === 'in' && o.state === 'here');
    const there = this.offers.filter((o) => o.dir === 'out' && o.state === 'there');
    const o = trading[0] || (here.length === 1 ? here[0] : null) || (!here.length && there.length === 1 ? there[0] : null);
    if (!o) return false;
    o.state = 'done';
    o.doneAt = at;
    if (o.test) return true;
    this.history.unshift({ id: `${at.toString(36)}-${o.id}`, dir: o.dir, player: o.player, item: o.item, qty: o.qty, price: o.price, league: o.league, at });
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    if (o.dir === 'in' && listingKey(o)) {
      this.sold.set(listingKey(o), at);
      for (const other of this.offers) if (other !== o && other.dir === 'in' && other.state !== 'done' && listingKey(other) === listingKey(o)) other.soldAlready = true;
    }
    return true;
  }

  // Called after an action's chat line went out.
  applied(id, action, now = Date.now()) {
    const o = this.get(id);
    if (!o) return;
    o.touchedAt = now;
    if (action === 'invite') { if (o.state === 'new') o.state = 'invited'; }
    else if (action === 'trade') { o.state = 'trading'; o.tradeAt = now; }
    else if (action === 'hideout') { if (o.state === 'new') o.state = 'there'; }
    else if (action === 'thanks') o.thanked = true;
    else if (action === 'busy') o.toldBusy = true;
    else if (action === 'still') o.asked = true;
    else if (action === 'sold' || action === 'kick' || action === 'leave') this.remove(id);
  }

  remove(id) { this.offers = this.offers.filter((o) => String(o.id) !== String(id)); }
  removeHistory(id) { this.history = this.history.filter((h) => h.id !== id); }
  clearTests() { this.offers = this.offers.filter((o) => !o.test); }

  // The offer the "next step" key acts on: the oldest one that has a step to take.
  firstActionable() { return this.offers.find((o) => nextAction(o)) || null; }

  // prices: object with get(name) -> { chaos } | null, or null.
  summary(prices, now = Date.now()) {
    const value = (x) => priceChaos(x.price, prices);
    const offers = this.offers.map((o) => {
      const entry = prices ? prices.get(currencyName(o.item)) : null;
      const v = value(o);
      const market = entry ? entry.chaos * (o.qty || 1) : null;
      const next = nextAction(o);
      return {
        ...o, value: v, market, low: o.dir === 'in' && v != null && market != null && market > 0 && v < market * 0.8,
        next, nextLabel: next ? LABELS[next] : '', waiting: waitingText(o),
        grid: o.tab ? (this.quadTabs.has(o.tab) ? 24 : 12) : 0,
      };
    });
    const day = new Date(now); day.setHours(0, 0, 0, 0);
    const start = day.getTime();
    const sum = (dir, since) => {
      const rows = this.history.filter((h) => h.dir === dir && h.at >= since);
      return { count: rows.length, chaos: rows.reduce((a, h) => a + (value(h) || 0), 0), unpriced: rows.filter((h) => value(h) == null).length };
    };
    return {
      afk: this.afk, offers, seen: { ...this.seen },
      history: this.history.slice(0, 100).map((h) => ({ ...h, value: value(h) })),
      totals: { soldToday: sum('in', start), boughtToday: sum('out', start), soldAll: sum('in', 0), boughtAll: sum('out', 0) },
    };
  }

  toJSON() {
    return { seq: this.seq, lastTs: this.lastTs, history: this.history, quadTabs: [...this.quadTabs], sold: [...this.sold], offers: this.offers.filter((o) => !o.test) };
  }

  // Offers older than maxAgeMs are not brought back: the buyer has long moved on.
  // Takes in log lines written while the app was closed or restarting (an update, for one),
  // so an offer that arrived a minute before the app came up is not lost. events: parsed log
  // events, oldest first. Returns how many were used.
  catchUp(events, now = Date.now(), maxAgeMs = 15 * 60 * 1000) {
    let used = 0;
    const from = Math.max(this.lastTs, now - maxAgeMs);
    for (const ev of events || []) {
      if (!ev || !ev.ts || ev.ts <= from || !['whisper', 'joined', 'left', 'trade', 'afk'].includes(ev.type)) continue;
      this.onLog(ev, now);
      used++;
    }
    return used;
  }

  restore(data, now = Date.now(), maxAgeMs = 30 * 60 * 1000) {
    if (!data || typeof data !== 'object') return;
    this.seq = Number(data.seq) || 1;
    this.lastTs = Number(data.lastTs) || 0;
    this.history = Array.isArray(data.history) ? data.history.filter((h) => h && h.item && h.at) : [];
    this.quadTabs = new Set(Array.isArray(data.quadTabs) ? data.quadTabs : []);
    this.sold = new Map((Array.isArray(data.sold) ? data.sold : []).filter((e) => Array.isArray(e) && now - e[1] < SOLD_MEMORY_MS));
    this.offers = (Array.isArray(data.offers) ? data.offers : []).filter((o) => o && o.player && o.item && now - (o.lastAt || 0) < maxAgeMs)
      .map((o) => ({ ...o, here: false, state: o.state === 'here' || o.state === 'trading' ? 'invited' : o.state }));
  }
}

const OVERLAY_WIDTH = 460;

// Where the window goes on the game's screen. position: 'top' | 'bottom' | 'left' | 'right'.
// offsetX / offsetY nudge it, in percent of the screen. All numbers are screen points.
function overlayBounds(display, height, { position = 'top', offsetX = 0, offsetY = 0 } = {}) {
  const b = display.bounds;
  const w = Math.min(OVERLAY_WIDTH, b.width);
  const h = Math.max(1, Math.min(Math.round(height), Math.round(b.height * 0.7)));
  let x = b.x + (b.width - w) / 2, y = b.y + b.height * 0.06;
  if (position === 'bottom') y = b.y + b.height * 0.76 - h; // grows upward from above the skill bar
  else if (position === 'left') { x = b.x + b.width * 0.01; y = b.y + b.height * 0.28; }
  else if (position === 'right') { x = b.x + b.width * 0.99 - w; y = b.y + b.height * 0.28; }
  x += (b.width * (Number(offsetX) || 0)) / 100;
  y += (b.height * (Number(offsetY) || 0)) / 100;
  x = Math.max(b.x, Math.min(x, b.x + b.width - w));
  y = Math.max(b.y, Math.min(y, b.y + b.height - h));
  return { x: Math.round(x), y: Math.round(y), width: w, height: h };
}

module.exports = {
  overlayBounds, OVERLAY_WIDTH, parseTradeMessage, priceChaos, priceText, currencyName, chatCommand, nextAction, TradeBook, DEFAULT_MESSAGES, LABELS };
