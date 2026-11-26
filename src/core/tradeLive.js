'use strict';
// Live search, as on the trade website ("Activate Live Search"): once a search is made, the site
// keeps a connection open and names each new listing that matches it, the moment it is listed.
// The site only allows it for a signed-in account. This file is the plain part: the address,
// reading what the site sends, and the feed of new listings. Nothing here asks the web.

const MAX_LIVE = 10;    // live searches at once (the site allows 20 per account; half leaves room for its own page)
const MAX_FEED = 200;   // new listings kept, newest first
const LIVE_HOST = 'wss://www.pathofexile.com/api/trade/live';

const liveUrl = (league, queryId) => `${LIVE_HOST}/${encodeURIComponent(league)}/${encodeURIComponent(queryId)}`;

// One message of the site -> what it says. The site has sent new listings as { new: [ids] } and,
// in later versions, as { result: token } (each a signed name of one listing, fetched like an
// id); both are read. { auth: true } says the sign-in was accepted; { auth: false } that it was not.
function readMessage(data) {
  let j;
  try { j = typeof data === 'string' ? JSON.parse(data) : data; } catch (_) { return { ids: [], bad: true }; }
  if (!j || typeof j !== 'object') return { ids: [], bad: true };
  const raw = Array.isArray(j.new) ? j.new : typeof j.result === 'string' ? [j.result] : Array.isArray(j.result) ? j.result : [];
  const ids = raw.filter((x) => typeof x === 'string' && x.length <= 2000 && /^[\w.-]+$/.test(x));
  const out = { ids };
  if (typeof j.auth === 'boolean') out.auth = j.auth;
  if (j.error) out.error = String((j.error && j.error.message) || j.error).slice(0, 200);
  if (!ids.length && !('auth' in out) && !out.error) out.other = true;
  return out;
}

// New listings into the feed: newest first, each listing once (the site may name one twice),
// at most MAX_FEED. rows: [{ id, ... }] for one live search `key`.
function addToFeed(feed, key, rows, now = Date.now()) {
  const seen = new Set(feed.map((x) => x.id));
  const fresh = rows.filter((r) => r && r.id && !seen.has(r.id)).map((r) => ({ ...r, live: key, at: now }));
  return { feed: fresh.concat(feed).slice(0, MAX_FEED), added: fresh.length };
}

// Why a connection closed, in plain words (the site's own reason when it gave one).
function closeWords(code, reason) {
  if (reason) return reason;
  if (code === 1000) return 'closed';
  if (code === 1006) return 'the connection dropped';
  if (code === 1008 || code === 4001 || code === 4003) return 'the trade site refused it (signed out?)';
  return `closed (${code || 'no code'})`;
}

module.exports = { MAX_LIVE, MAX_FEED, liveUrl, readMessage, addToFeed, closeWords };
