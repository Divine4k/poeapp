'use strict';
// The advanced price check (Settings, Price check; off by default). The standard check is left
// as it is and runs first; this adds, for the same item:
//   - for a rare, a search of its own by score (score.js, with the value table in values.js);
//   - for anything searched, a range with how sure it is and how fast it sells (estimate.js);
//   - what the base alone is worth (poe.ninja's base type prices).
// Everything here is plain logic (run.js sends the searches through the client it is handed);
// main.js ("the advanced price check") joins it to the app.

const { plan, describe, STEPS } = require('./score');
const { estimate, pickRanks } = require('./estimate');
const { run, ENOUGH } = require('./run');
const { PROFILES, WORTH_FROM } = require('./values');

// What the base alone is worth: poe.ninja prices base types by item level (82 to 86) and
// influence. get: (name) -> a price entry or null (PriceTable.get). Returns { chaos, what } or
// null. A fractured item is left out: its worth as a base is its fractured modifier, which the
// standard check's "Base item" search prices.
function baseValue(item, get) {
  if (!item || !item.baseType || !item.itemLevel || item.itemLevel < 82 || item.corrupted) return null;
  if (!['Normal', 'Magic', 'Rare'].includes(item.rarity) || (item.modLines || []).some((l) => l.type === 'fractured')) return null;
  const base = String(item.baseType).replace(/^Synthesised /, '');
  const inf = item.influences || [];
  if (inf.length > 2) return null;
  const marks = inf.length === 2 ? [`${inf[0]}/${inf[1]}`, `${inf[1]}/${inf[0]}`] : inf.length ? [inf[0]] : [''];
  // the price of the highest item level it reaches
  for (let lvl = Math.min(86, item.itemLevel); lvl >= 82; lvl--) {
    for (const mark of marks) {
      const e = get(`${base} (ilvl ${lvl}${mark ? `, ${mark}` : ''})`);
      if (e && e.chaos > 0) return { chaos: e.chaos, what: `${base}, item level ${lvl}${mark ? `, ${mark.replace('/', ' and ')}` : ''}` };
    }
  }
  return null;
}

// The outcome of an advanced check in a few words, for Under the hood.
function outcome(adv) {
  if (!adv) return 'nothing';
  if (adv.state !== 'done') return `${adv.state}${adv.why ? `: ${adv.why}` : ''}`;
  const r = (c) => (c >= 100 ? Math.round(c) : Math.round(c * 10) / 10);
  return `${r(adv.low)} to ${r(adv.high)} chaos, ${adv.sure}${adv.speed ? `, sells ${adv.speed}` : ''}, from ${adv.source === 'score' ? `its own search (step ${adv.step + 1} of ${STEPS.length}, ${adv.total} found)` : adv.source === 'exact' ? `the exact search (${adv.total} found)` : `the standard search (${adv.total} found)`}`;
}

module.exports = { plan, describe, run, estimate, pickRanks, baseValue, outcome, ENOUGH, STEPS, PROFILES, WORTH_FROM };
