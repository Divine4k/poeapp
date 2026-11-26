'use strict';
// The advanced price check (its own key). The standard check is left as it is; with the
// advanced key the same window starts from every line of the item that could matter and lets
// go of lines only when too few are listed (ticks.js). When it comes down to the usual ticks,
// this adds, for the same item:
//   - for a rare, a comparison by score: a search for items with most of what carries its score,
//     whose results are scored here (score.js, with the value table in values.js);
//   - for anything searched, a range with how sure it is and how fast it sells (estimate.js);
//   - what the base alone is worth (poe.ninja's base type prices).
// Everything here is plain logic (run.js sends the searches through the client it is handed);
// main.js ("the advanced price check") joins it to the app.

const { plan, describe, scoreListing, STEPS } = require('./score');
const { estimate } = require('./estimate');
const { run, ENOUGH } = require('./run');
const { rungs, applyRung, probeLines, withoutLine, judgeLines, weighLines, markLines, dropRung, NEAR_ENOUGH } = require('./ticks');
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
  const speed = !adv.speed ? '' : adv.speed === 'crowded' ? ', many listed' : `, sells ${adv.speed}`;
  const set = !adv.near ? '' : adv.near.id === 'all' ? `all ${adv.near.lines}` : adv.near.id === 'most' ? `${adv.near.lines} (without "${adv.near.dropped}")` : `the strongest ${adv.near.lines}`;
  const from = adv.source === 'near' ? `the ${adv.total} listed with ${set} of its lines`
    : adv.source === 'score' ? `its own search (step ${adv.step + 1} of ${STEPS.length}, ${adv.seen} of the ${adv.looked} looked at count, ${adv.total} like it)`
      : adv.source === 'exact' ? `the exact search (${adv.total} found)` : `the usual search (${adv.total} found)`;
  return `${r(adv.low)} to ${r(adv.high)} chaos, ${adv.sure}${speed}, from ${from}`;
}

module.exports = { plan, describe, scoreListing, run, estimate, rungs, applyRung, probeLines, withoutLine, judgeLines, weighLines, markLines, dropRung, NEAR_ENOUGH, baseValue, outcome, ENOUGH, STEPS, PROFILES, WORTH_FROM };
