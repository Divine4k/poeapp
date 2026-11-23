'use strict';
// Fuzzy matching of OCR text against known item names.

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

// Levenshtein distance with an upper bound; returns max+1 when exceeded.
function distance(a, b, max) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[lb];
}

class NameMatcher {
  // names: iterable of display names
  constructor(names) {
    this.exact = new Map();     // normalized -> display name
    this.byLength = new Map();  // length -> [normalized]
    for (const name of names) {
      const n = normalize(name);
      if (n.length < 3 || this.exact.has(n)) continue;
      this.exact.set(n, name);
      if (!this.byLength.has(n.length)) this.byLength.set(n.length, []);
      this.byLength.get(n.length).push(n);
    }
  }

  // Returns the display name or null.
  match(text) {
    const n = normalize(text);
    if (n.length < 4) return null;
    const hit = this.exact.get(n);
    if (hit) return hit;
    // Allow roughly one OCR mistake per 8 characters, at most 3.
    const max = Math.min(3, Math.floor(n.length / 8));
    if (max === 0) return null;
    let best = null, bestD = max + 1;
    for (let len = n.length - max; len <= n.length + max; len++) {
      const bucket = this.byLength.get(len);
      if (!bucket) continue;
      for (const cand of bucket) {
        const d = distance(n, cand, bestD - 1);
        if (d < bestD) { bestD = d; best = cand; if (d === 1) break; }
      }
    }
    return best ? this.exact.get(best) : null;
  }
}

// Splits "3x Chaos Orb" into { qty: 3, text: "Chaos Orb" }.
function splitStack(text) {
  const m = /^\s*(\d{1,5})\s*[xX×]\s+(.+)$/.exec(text);
  if (m) return { qty: parseInt(m[1], 10), text: m[2].trim() };
  return { qty: 1, text: String(text).trim() };
}

module.exports = { normalize, distance, NameMatcher, splitStack };
