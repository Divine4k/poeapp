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

module.exports = { rungs, applyRung, classOf, NEAR_ENOUGH, NOBODY_PAYS };
