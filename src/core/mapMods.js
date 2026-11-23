'use strict';
// Map mod warnings. Each rule is a case-insensitive regular expression tested against every mod line.
// All rules start switched off; turn on the ones your build cannot run. Wording changes between
// patches, so rules are editable in Settings.

const DEFAULT_RULES = [
  { id: 'reflect-phys', label: 'Physical reflect', pattern: 'reflect \\d+% of Physical', enabled: false },
  { id: 'reflect-ele', label: 'Elemental reflect', pattern: 'reflect \\d+% of Elemental', enabled: false },
  { id: 'no-regen', label: 'No life or mana regeneration', pattern: 'cannot Regenerate', enabled: false },
  { id: 'no-leech', label: 'Cannot leech', pattern: 'Cannot Leech', enabled: false },
  { id: 'less-recovery', label: 'Less recovery rate', pattern: 'less Recovery Rate', enabled: false },
  { id: 'max-res', label: 'Reduced maximum resistances', pattern: 'to all maximum Resistances', enabled: false },
  { id: 'curses', label: 'Players are cursed', pattern: 'Players are Cursed with', enabled: false },
  { id: 'avoid-ailments', label: 'Monsters avoid ailments', pattern: 'chance to Avoid Elemental Ailments', enabled: false },
  { id: 'avoid-poison-bleed', label: 'Monsters avoid poison and bleeding', pattern: 'avoid (Poison|.*Bleeding)', enabled: false },
  { id: 'less-defence', label: 'Less armour or block', pattern: 'less Armour|reduced Chance to Block', enabled: false },
  { id: 'less-accuracy', label: 'Less accuracy', pattern: 'less Accuracy Rating', enabled: false },
  { id: 'less-aoe', label: 'Less area of effect', pattern: 'less Area of Effect', enabled: false },
  { id: 'aura-effect', label: 'Reduced aura effect', pattern: 'reduced effect of Non-Curse Auras', enabled: false },
  { id: 'flask-charges', label: 'Reduced flask charges', pattern: 'reduced Flask Charges', enabled: false },
  { id: 'steal-charges', label: 'Monsters steal charges', pattern: 'steal Power, Frenzy and Endurance charges', enabled: false },
  { id: 'no-slow', label: 'Monsters cannot be slowed or stunned', pattern: 'cannot be Stunned|Action Speed cannot be modified', enabled: false },
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

module.exports = { DEFAULT_RULES, checkMods };
