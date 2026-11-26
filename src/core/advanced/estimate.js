'use strict';
// What a handful of comparable listings says an item is worth: a range rather than one number,
// how sure that is, and whether items like it sell fast. Everything comes from the listings of
// one search (their prices, how long each has been listed, how many there are), so it works the
// same with one user as with a thousand. Plain logic, no Electron.
//
// Listings are asking prices. One listed today is the live market; one that has sat for a week
// has not sold at its price, so it counts for less.

const DAY = 24 * 60 * 60 * 1000;
// How much a listing counts by its age (null: the site did not say).
const freshness = (age) => (age === null ? 0.5 : age <= DAY ? 1 : age <= 3 * DAY ? 0.7 : age <= 7 * DAY ? 0.45 : 0.25);

// The price below which the share `q` of the listings' weight lies. list: cheapest first, each { chaos, w }.
function weighted(list, q) {
  const all = list.reduce((n, l) => n + l.w, 0);
  let sum = 0;
  for (const l of list) { sum += l.w; if (sum >= all * q - 1e-9) return l.chaos; }
  return list[list.length - 1].chaos;
}

// listings: [{ chaos, listedAt, bait }] as readListing and markBait give them. total: how many
// like it are listed in all (about: worked out, not counted). step: how far the search had to
// be widened (0: not at all).
// Returns null when no listing has a price, else
// { low, typical, high, sure: 'sure' | 'fair' | 'guess', why: [..], speed: 'fast' | 'steady' | 'slow' | null, seen, fresh, total }.
function estimate({ listings, total = 0, about = false, step = 0, now = Date.now() }) {
  const seen = (listings || [])
    .filter((l) => l && !l.bait && l.chaos !== null && l.chaos !== undefined && isFinite(l.chaos) && l.chaos > 0)
    .map((l) => ({ chaos: l.chaos, age: l.listedAt ? Math.max(0, now - l.listedAt) : null }))
    .sort((a, b) => a.chaos - b.chaos);
  if (!seen.length) return null;
  for (const l of seen) l.w = freshness(l.age);
  const low = weighted(seen, 0.25), typical = weighted(seen, 0.5);
  let high = weighted(seen, 0.75);
  // How fast: the cheapest are bought first, so where items like it sell, the cheapest listings
  // are young; where the cheapest have sat for days, nobody is buying.
  const ages = seen.slice(0, 5).map((l) => l.age).filter((a) => a !== null).sort((a, b) => a - b);
  const mid = ages.length >= 3 ? ages[Math.floor((ages.length - 1) / 2)] : null;
  const speed = mid === null ? null : mid <= DAY ? 'fast' : mid <= 4 * DAY ? 'steady' : 'slow';
  if (speed === 'slow') high = typical; // the upper end is not being paid
  const fresh = seen.filter((l) => l.age !== null && l.age <= DAY).length;
  const count = Math.max(total, seen.length);

  const doubts = [];
  if (step >= 2) doubts.push([2, 'nothing close is listed, so weaker items were compared']);
  else if (step === 1) doubts.push([1, 'few close matches, so the search was widened']);
  if (seen.length < 3 || count < 4) doubts.push([2, `only ${count} listed`]);
  else if (seen.length < 6 || count < 12) doubts.push([1, `only ${count} listed`]);
  if (low > 0 && high / low > 3) doubts.push([1, 'their prices are far apart']);
  if (mid !== null && mid > 7 * DAY) doubts.push([1, 'the cheapest have been listed for over a week']);
  const worst = doubts.reduce((n, d) => Math.max(n, d[0]), 0);
  const why = [];
  if (!doubts.some((d) => /^only /.test(d[1]))) why.push(`${about ? 'about ' : ''}${count.toLocaleString('en-US')} like it listed`);
  if (ages.length) why.push(`${fresh} of the ${seen.length} seen listed within a day`);
  for (const d of doubts) why.push(d[1]);
  return { low, typical, high, sure: worst >= 2 ? 'guess' : worst === 1 ? 'fair' : 'sure', why, speed, seen: seen.length, fresh, total: count };
}

module.exports = { estimate, weighted, freshness, DAY };
