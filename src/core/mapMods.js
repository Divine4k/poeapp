'use strict';
// Map mod warnings. Each rule is a case-insensitive regular expression tested against every mod line.
// All rules start switched off; the ones your build cannot run are ticked on the Map check page.

const DEFAULT_RULES = [
  // 3.30: maps no longer reflect a share of damage; rare monsters have Thorns instead.
  { id: 'thorns-phys', label: 'Physical thorns (was reflect)', pattern: 'Physical Thorns', enabled: false },
  { id: 'thorns-ele', label: 'Elemental thorns (was reflect)', pattern: 'Elemental Thorns', enabled: false },
  { id: 'no-regen', label: 'No life or mana regeneration', pattern: 'cannot Regenerate', enabled: false },
  { id: 'no-leech', label: 'Cannot leech', pattern: 'Cannot Leech|cannot be Leeched', enabled: false },
  { id: 'less-recovery', label: 'Less recovery rate', pattern: 'less Recovery Rate', enabled: false },
  { id: 'max-res', label: 'Reduced maximum resistances', pattern: 'to all maximum Resistances', enabled: false },
  { id: 'curses', label: 'Players are cursed', pattern: 'Players are Cursed with', enabled: false },
  { id: 'avoid-ailments', label: 'Monsters avoid ailments', pattern: 'chance to Avoid Elemental Ailments', enabled: false },
  { id: 'avoid-poison-bleed', label: 'Monsters avoid poison and bleeding', pattern: 'avoid (Poison|.*Bleeding)', enabled: false },
  { id: 'less-defence', label: 'Less armour or block', pattern: 'less Armour|reduced Chance to Block|less Defences', enabled: false },
  { id: 'less-accuracy', label: 'Less accuracy', pattern: 'less Accuracy Rating', enabled: false },
  { id: 'less-aoe', label: 'Less area of effect', pattern: 'less Area of Effect', enabled: false },
  { id: 'aura-effect', label: 'Reduced aura effect', pattern: 'reduced effect of Non-Curse Auras', enabled: false },
  { id: 'flask-charges', label: 'Reduced flask charges', pattern: 'reduced Flask Charges', enabled: false },
  { id: 'steal-charges', label: 'Monsters steal charges', pattern: 'steal Power, Frenzy and Endurance charges', enabled: false },
  { id: 'no-slow', label: 'Monsters cannot be slowed or stunned', pattern: 'cannot be Stunned|Speed cannot be modified', enabled: false },
];

function compile(rule) {
  try { return new RegExp(rule.pattern, 'i'); } catch (_) { return null; }
}

// Returns [{ mod, dangerous: bool, labels: [rule labels] }] for every mod on the map.
function checkMods(mods, rules) {
  const active = (rules || []).filter((r) => r.enabled).map((r) => ({ r, re: compile(r) })).filter((x) => x.re);
  return (mods || []).map((mod) => {
    const labels = active.filter((x) => x.re.test(mod)).map((x) => x.r.label);
    return { mod, dangerous: labels.length > 0, labels };
  });
}

// Rules of earlier versions whose mod left the game, and the rule that took its place: a tick on
// the old one moves to the new one.
const RETIRED = { 'reflect-phys': 'thorns-phys', 'reflect-ele': 'thorns-ele' };
// The saved ticks on today's rules. Label and pattern always come from this file (they cannot be
// changed in the app), so a rule reworded for a new league reaches everyone.
function mergeRules(saved) {
  saved = Array.isArray(saved) ? saved.filter((r) => r && r.id) : [];
  const on = new Map(saved.map((r) => [RETIRED[r.id] || r.id, false]));
  for (const r of saved) if (r.enabled) on.set(RETIRED[r.id] || r.id, true);
  return [
    ...DEFAULT_RULES.map((r) => ({ ...r, enabled: on.get(r.id) === true })),
    ...saved.filter((r) => !RETIRED[r.id] && !DEFAULT_RULES.some((d) => d.id === r.id)),
  ];
}

module.exports = { DEFAULT_RULES, RETIRED, checkMods, mergeRules };
