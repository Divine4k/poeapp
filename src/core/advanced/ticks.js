'use strict';
// Which lines of an item the advanced check ticks, so the market says what the item is worth.
//
// The owner showed it on a pair of gloves (2026-11-26): with the usual ticks (total resistance
// and its fractured modifier) 759 were listed from 5 chaos; with every real modifier ticked, 9
// were listed from 25 divine. What made them dear was a combination no table of ours had. So
// the advanced check starts from the other end: everything on the item that could matter is
// ticked ("nearly the same item"), and only when fewer than NEAR_ENOUGH are listed does it let
// go of lines, weakest first. The lines it used are the ticks in the window.
//
// It needs to know only what nobody pays for, which is a short list that does not change with
// the builds in fashion. Plain logic, no Electron.

// As few listed as still make a price: fewer, and the next looser set of lines is tried.
const NEAR_ENOUGH = 3;

// Lines nobody pays for: never ticked.
const NOBODY_PAYS = [
  /Stun and Block Recovery/,
  /Reflects \d+ Physical Damage to Melee Attackers/,
  /Light Radius/,
  /Life (gained|per Enemy Killed)|Gain \d+ (Life|Mana) per Enemy Killed|Mana gained on Kill/i,
  /reduced Attribute Requirements/,
  /Stun Duration on Enemies/,
  /Stun Threshold/,
];
// On a piece of armour these change its own armour, evasion or energy shield, which the window
// has as lines of their own (the numbers under "Stats"). Ticked as modifiers they would only
// ask for the same roll twice.
const OWN_DEFENCE = /^(\+\d+ to (Armour|Evasion Rating|maximum Energy Shield|Ward)|\d+% increased (Armour|Evasion Rating|Energy Shield|Ward|Armour and Evasion|Armour and Energy Shield|Evasion and Energy Shield|Armour, Evasion and Energy Shield))$/;
const ARMOUR = new Set(['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield']);

// One line of the window: 'junk' (never ticked), 'strong' (kept until the usual search) or
// 'weak' (ticked only for "nearly the same").
// Strong: what the standard check ticks by itself, a fractured modifier, an influence, a
// corruption's implicit, and a rolled modifier of tier 1 or 2. Weak: the rest, among them what
// a buyer can put on an item himself (a crafted modifier, the implicits currency gives).
function classOf(stat, armour) {
  const text = String(stat.text || '');
  if (NOBODY_PAYS.some((r) => r.test(text))) return 'junk';
  if (armour && OWN_DEFENCE.test(text)) return 'junk';
  if (stat.enabled || stat.kind === 'fractured' || stat.kind === 'corruption' || String(stat.key).startsWith('influence:')) return 'strong';
  if (stat.kind === 'explicit' && stat.tiers && stat.tiers.length && stat.tiers[0] <= 2) return 'strong';
  return 'weak';
}

// filters: from buildFilters, as the standard check ticked them. Returns the sets of ticks to
// try, strictest first, each { id, ticks: { <stat key>: bool }, lines }:
//   'all'     every line that is not junk: items that are nearly the same
//   ('most'   without the lines that add little, put in by dropRung once each line was tried)
//   'strong'  the strong lines only
//   'usual'   the standard check's own ticks (always the last one)
// Sets that tick the same lines are given once (as the later one). [] for what this is not
// for: a unique (its ticks follow its rolls), a gem, a cluster jewel, an item with no lines.
function rungs(filters) {
  if (!filters || !filters.ok || filters.gem || !['Rare', 'Magic'].includes(filters.rarity)) return [];
  const label = filters.category ? filters.category.label : '';
  if (label === 'Cluster Jewel' || !filters.stats.length) return [];
  const armour = ARMOUR.has(label);
  const kinds = filters.stats.map((s) => classOf(s, armour));
  const set = (id, on) => {
    const ticks = {};
    filters.stats.forEach((s, i) => { ticks[s.key] = !!on(s, kinds[i]); });
    return { id, ticks, lines: Object.values(ticks).filter(Boolean).length };
  };
  const all = [
    set('all', (s, k) => k !== 'junk'),
    set('strong', (s, k) => k === 'strong'),
    set('usual', (s) => s.enabled),
  ];
  const same = (a, b) => filters.stats.every((s) => a.ticks[s.key] === b.ticks[s.key]);
  const out = all.filter((r, i) => !all.slice(i + 1).some((later) => same(r, later)));
  // only the usual ticks: nothing for the advanced check to add
  return out.length > 1 ? out : [];
}

// The filters with one set's lines ticked. Everything else (numbers, flags, the kind of item)
// stays as it was.
function applyRung(filters, rung) {
  return { ...filters, stats: filters.stats.map((s) => (rung.ticks[s.key] === undefined || rung.ticks[s.key] === s.enabled ? s : { ...s, enabled: rung.ticks[s.key] })) };
}

// ---- which lines carry the price ----
// Each line is left out by itself and searched (the owner, 2026-11-26: "it doesn't really
// matter how long it takes to accurately price check it as long as it's accurate", and "the
// important thing is that the price checker marks the right mods"). What the items without a
// line ask, against what the items with every line ask, says what that line is worth:
//   'carries'  without it they ask half or less: this line is what the price stands on
//   'little'   without it they ask about the same: it adds little, and is unticked so there
//              are more items to compare with
//   'some'     in between
// Which line matters cannot be known beforehand, and guesses were wrong both times: on the
// owner's gloves and on his boots it was Chaos Resistance that the price stood on (measured on
// the live site), not the lines that looked rare. Each try is a search, and the trade site allows
// about fifteen a minute and thirty in five minutes.
const MAX_PROBES = 8;
const LITTLE = 0.9, CARRIES = 0.5;
const WIDE_ENOUGH = 10; // with this many nearly the same listed, nothing needs unticking

// The lines to try: every ticked one but the fractured modifier and an influence (they are
// what the item is). What a buyer can add himself comes first, then the weaker tiers, the
// standard check's own ticks last; at most MAX_PROBES. Each { key, text }.
function probeLines(filters, rung, usual) {
  const rank = (s) => (usual && usual.ticks[s.key] ? 40 : s.kind === 'crafted' || s.kind === 'implicit' ? 0 : 20 - Math.min(19, (s.tiers && s.tiers[0]) || 9));
  return filters.stats
    .filter((s) => rung.ticks[s.key] && s.kind !== 'fractured' && !String(s.key).startsWith('influence:'))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_PROBES)
    .map((s) => ({ key: s.key, text: s.text }));
}

// The filters with one line unticked.
const withoutLine = (filters, key) => ({ ...filters, stats: filters.stats.map((s) => (s.key === key && s.enabled ? { ...s, enabled: false } : s)) });

// tried: what each search without one line found, [{ key, text, total, price }] (price: what
// they ask, in chaos: where the cheap end of them lies; null when none has a price). Returns the one to leave out when too few have
// every line, or null when no try found enough: the one whose items are dearest (leaving it out
// costs the least), unless another is nearly as dear (three quarters) with at least twice as
// many listed, which is the better evidence.
function judgeLines(tried) {
  const ok = (tried || []).filter((t) => t.total >= NEAR_ENOUGH && t.price > 0).sort((a, b) => b.price - a.price || b.total - a.total);
  if (!ok.length) return null;
  const best = ok[0];
  const wider = ok.filter((t) => t !== best && t.price >= best.price * 0.75 && t.total >= best.total * 2).sort((a, b) => b.total - a.total)[0];
  return wider || best;
}

// base: what the search with every line found, { total, price }. tried: as for judgeLines.
// Returns { ref, marks, drop }:
//   ref    what items with every line ask (chaos); with none listed, what the dearest try asks
//   marks  { <stat key>: { verdict: 'carries' | 'some' | 'little', total, price, ref } }
//   drop   the lines to untick, [{ key, text }]: those that add little when there are too few
//          nearly the same to price by; with nothing listed at all, the one judgeLines picks
//          (and whatever adds little beside it)
function weighLines(base, tried) {
  const pick = judgeLines(tried);
  const have = base && base.total >= 1 && base.price > 0;
  const ref = have ? base.price : pick ? pick.price : null;
  const marks = {};
  if (ref) for (const t of tried) {
    if (!(t.total >= 1) || !(t.price > 0)) continue;
    marks[t.key] = { verdict: t.price >= ref * LITTLE ? 'little' : t.price <= ref * CARRIES ? 'carries' : 'some', total: t.total, price: t.price, ref };
  }
  let drop = [];
  if (!have || base.total < WIDE_ENOUGH) {
    // one or two listings are no evidence that a line can go
    drop = tried.filter((t) => marks[t.key] && marks[t.key].verdict === 'little' && t.total >= NEAR_ENOUGH && t.total > (base ? base.total : 0));
    if (!drop.length && pick && (!have || base.total < NEAR_ENOUGH)) drop = [pick];
  }
  return { ref, marks, drop: drop.map((t) => ({ key: t.key, text: t.text })), pick };
}

// The filters with what was found written on each line (the window shows it beside the line).
const markLines = (filters, marks) => ({ ...filters, stats: filters.stats.map((s) => (marks[s.key] ? { ...s, mark: marks[s.key] } : s)) });

// The set of ticks after leaving lines out of a set. floor: what its items must still ask
// (chaos) for it to stand; below that, leaving them all out together cost too much.
function dropRung(rung, lines, floor = null) {
  const list = Array.isArray(lines) ? lines : [lines];
  const ticks = { ...rung.ticks };
  for (const l of list) ticks[l.key] = false;
  return { id: 'most', ticks, lines: Object.values(ticks).filter(Boolean).length, dropped: list.map((l) => l.text).join('; '), floor };
}

module.exports = { rungs, applyRung, classOf, probeLines, withoutLine, judgeLines, weighLines, markLines, dropRung, NEAR_ENOUGH, WIDE_ENOUGH, NOBODY_PAYS, MAX_PROBES };
