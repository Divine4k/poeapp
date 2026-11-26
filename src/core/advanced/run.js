'use strict';
// Sends an advanced check's searches: one step after another until enough is listed, then its
// results ten at a time, cheapest first, until enough of them score about as much as the item
// (the site cannot be asked for that without a login, see score.js; `score` does it here). Each
// request waits its turn with the trade site (the standard check and the bench crafts use the
// same client). Plain logic: the client, the waiting and the clock are handed in, so all of it
// is tested against a stand-in for the site.

const { estimate } = require('./estimate');
const { STEPS } = require('./score');

const ENOUGH = 8;             // as many results as make a search worth reading; fewer, and the next wider step is tried
const CLOSE_ENOUGH = 6;       // as many results scoring like the item as make a price; reading stops there
const LEAST_CLOSE = 3;        // fewer than this at a step's score, and weaker ones are counted too
const PAGES = 3;              // at most this many times ten results are read
const KEPT_MS = 60 * 1000;    // an answer is kept this long, as the trade client keeps the standard search's
const LONG_PAUSE_MS = 20000;  // a pause the site asks for beyond this is not waited out

const later = (message) => Object.assign(new Error(message), { later: true });

// Waits until the site takes another request of this kind, then sends it. undefined: the item
// was left meanwhile. A pause too long to wait out, or a site that stays busy, is thrown as
// "later" (the window says so; nothing is wrong).
async function ask(kind, send, { client, sleep, stale, count, waited }) {
  for (let tries = 0; tries < 4; tries++) {
    for (let i = 0; i < 80 && client.busy; i++) await sleep(100);
    const wait = client.waitMs(kind);
    if (wait > LONG_PAUSE_MS) throw later(`The trade site asked for a pause of ${Math.ceil(wait / 1000)} s. Press Search again after it.`);
    if (wait > 0) { waited(wait); await sleep(wait + 150); }
    if (stale()) return undefined;
    try { return await send(); } catch (e) {
      // another search got in between (a bench craft's), or the pause grew: wait again. Anything else is the answer.
      if (!/already running/.test((e && e.message) || '') && !(e && e.waitMs > 0 && e.waitMs <= LONG_PAUSE_MS)) throw e;
      count('waited again (another search got in between)');
    }
  }
  throw later('The trade site was busy with other searches. Press Search again.');
}

// plan: from score.js (ok, steps, body). client: a TradeClient. read: the site's listings ->
// listings as the app shows them, bait marked. score: one of the site's results -> its points
// for the buyer the item was scored for (left out: every result counts, as for a cluster jewel).
// kept: a Map the answers are kept in.
// Returns { left: true } when the item was left meanwhile, else
//   { state: 'none', why, step, total, queryId, sent, looked }   nothing like it is listed
//   { state: 'done', est, step, total, queryId, sent, looked }   est: from estimate()
// step: how far it was widened (the search, or which scores still count). total: how many of
// the site's results are like it (worked out from the share of those looked at when not all
// were). looked: how many results were read. sent: how many requests went to the site.
// Throws what the site said when a request fails.
async function run({ plan, league, offline = false, client, read, score = null, kept = new Map(), sleep, now = Date.now, stale = () => false, count = () => {}, waited = () => {} }) {
  const how = { client, sleep, stale, count, waited };
  let best = null, lean = false, sent = 0;
  for (let i = 0; i < plan.steps; i++) {
    const body = plan.body(i, { offline, lean });
    const key = `${league}\n${JSON.stringify(body)}`;
    const hit = kept.get(key);
    let found = hit && now() - hit.at < KEPT_MS ? hit.found : null;
    if (!found) {
      try { found = await ask('search', () => client.search(league, body), how); } catch (e) {
        // the site found the search too large: once more in its smaller form
        if (!lean && /complex/i.test((e && e.message) || '')) { lean = true; i -= 1; count('search sent again in its smaller form (the site found it too large)'); continue; }
        throw e;
      }
      if (found === undefined) return { left: true, sent };
      sent += 1;
      for (const [k, v] of kept) if (now() - v.at >= KEPT_MS) kept.delete(k);
      kept.set(key, { at: now(), found });
    }
    if (!best || found.total > best.found.total) best = { found, step: i };
    if (found.total >= ENOUGH) break;
  }
  if (!best || !best.found.total) return { state: 'none', why: 'Nothing like it is listed, even with the search widened.', step: plan.steps - 1, total: 0, queryId: '', sent, looked: 0 };
  const f = best.found;
  f.raw = f.raw || [];
  const most = Math.min(f.ids.length, (score ? PAGES : 1) * 10);
  const closeAt = (share) => (score ? f.raw.filter((l) => l.points >= plan.score * share) : f.raw);
  // its results, cheapest first, until enough of them are worth about as much as the item
  while (f.raw.length < most && closeAt(STEPS[best.step].score).length < CLOSE_ENOUGH) {
    const ids = f.ids.slice(f.raw.length, f.raw.length + 10);
    const raw = await ask('fetch', () => client.fetchItems(ids, f.queryId), how);
    if (raw === undefined) return { left: true, sent };
    sent += 1;
    for (const l of raw) l.points = score ? score(l) : 0;
    f.raw.push(...raw);
    if (raw.length < ids.length) break; // the site gave fewer than asked for: no more to come
  }
  // those scoring about as much; when there are too few, weaker ones count too, and that is said
  let step = best.step, close = closeAt(STEPS[step].score);
  while (score && close.length < LEAST_CLOSE && step < STEPS.length - 1) { step += 1; close = closeAt(STEPS[step].score); }
  const looked = f.raw.length;
  if (!close.length) return { state: 'none', why: `None of the ${looked} cheapest with stats like it is worth as much.`, step, total: 0, queryId: f.queryId, sent, looked };
  // how many like it there are in all: counted when every result was read, else by their share
  const all = looked >= f.total || !score;
  const total = !score ? f.total : all ? close.length : Math.max(close.length, Math.round((f.total * close.length) / looked));
  const est = estimate({ listings: read(close), total, about: !all, step, now: now() });
  if (!est) return { state: 'none', why: 'None of the listings has a price the app can read.', step, total, queryId: f.queryId, sent, looked };
  return { state: 'done', est, step, total, queryId: f.queryId, sent, looked };
}

module.exports = { run, ask, ENOUGH, CLOSE_ENOUGH, LEAST_CLOSE, PAGES, KEPT_MS, LONG_PAUSE_MS };
