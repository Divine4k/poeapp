'use strict';
// Goals for timeless jewels in plain words ("More life", "Minions"), so nobody has to know the
// exact stat lines. A goal is every line of a jewel that matches it, weighed by how big one
// passive's roll of that line can be, so that "12% life" and "1% regeneration" count alike:
// a score of 3 means about three passives' worth of what you want.
// Also: which goals a build cares about, read from the passives it took.

const GOALS = [
  // defence
  { key: 'life', name: 'Life', group: 'defence', re: /maximum Life|Life Regeneration|of Life per second|Leeched as Life|Life Recovery|Life Recoup|Life Flask/i },
  { key: 'es', name: 'Energy shield', group: 'defence', re: /Energy Shield/i },
  { key: 'mana', name: 'Mana', group: 'defence', re: /maximum Mana|Mana Regeneration|Leeched as Mana|Mana Recovery|Mana Cost/i },
  { key: 'armour', name: 'Armour', group: 'defence', re: /Armour|Physical Damage Reduction/i },
  { key: 'evasion', name: 'Evasion', group: 'defence', re: /Evasion|Suppress Spell/i },
  { key: 'block', name: 'Block', group: 'defence', re: /Chance to Block/i },
  { key: 'res', name: 'Resistances', group: 'defence', re: /Resistances?\b/i },
  { key: 'ward', name: 'Ward', group: 'defence', re: /\bWard\b/i },
  // offence
  { key: 'attack', name: 'Attacks', group: 'offence', re: /Attack(?!.*Minion)|Accuracy|Melee|Weapon/i, not: /Minion|Spell/i },
  { key: 'spell', name: 'Spells', group: 'offence', re: /Spell|Cast Speed/i, not: /Suppress|Block Spell|Minion/i },
  { key: 'minion', name: 'Minions', group: 'offence', re: /Minion/i },
  { key: 'totem', name: 'Totems', group: 'offence', re: /Totem/i },
  { key: 'trap', name: 'Traps and mines', group: 'offence', re: /\bTraps?\b|\bMines?\b/i },
  { key: 'dot', name: 'Damage over time', group: 'offence', re: /Damage over Time|Bleed|Poison|Ignite|Burning|Ailment/i },
  { key: 'crit', name: 'Critical strikes', group: 'offence', re: /Critical Strike/i },
  { key: 'fire', name: 'Fire', group: 'offence', re: /Fire(?! Resistance)/i },
  { key: 'cold', name: 'Cold', group: 'offence', re: /Cold(?! Resistance)|Freeze|Chill/i },
  { key: 'lightning', name: 'Lightning', group: 'offence', re: /Lightning(?! Resistance)|Shock/i },
  { key: 'physical', name: 'Physical', group: 'offence', re: /Physical Damage|Impale/i, not: /Reduction|taken/i },
  { key: 'chaos', name: 'Chaos', group: 'offence', re: /Chaos(?! Resistance)|Poison|Wither/i },
  { key: 'projectile', name: 'Projectiles and bows', group: 'offence', re: /Projectile|\bBows?\b|Arrow/i },
  { key: 'area', name: 'Area of effect', group: 'offence', re: /Area of Effect|Area Damage/i },
  { key: 'speed', name: 'Attack and cast speed', group: 'offence', re: /Attack Speed|Cast Speed/i },
  // support
  { key: 'aura', name: 'Auras and reservation', group: 'support', re: /Aura|Reservation/i },
  { key: 'curse', name: 'Curses', group: 'support', re: /Curse|Hex/i },
  { key: 'charges', name: 'Charges', group: 'support', re: /Charges?\b/i },
  { key: 'devotion', name: 'Devotion', group: 'support', re: /Devotion/i },
  { key: 'attributes', name: 'Attributes', group: 'support', re: /to (Strength|Dexterity|Intelligence|all Attributes)|increased (Strength|Dexterity|Intelligence|Attributes)/i },
  { key: 'flask', name: 'Flasks', group: 'support', re: /Flask/i },
  { key: 'move', name: 'Movement speed', group: 'support', re: /Movement Speed/i },
];
const goalByKey = (key) => GOALS.find((g) => g.key === key);
const matches = (g, line) => g.re.test(line) && !(g.not && g.not.test(line));

// The goals a jewel can give (with how many lines each covers), from searchable() of that jewel.
function goalsFor(searchable) {
  return GOALS.map((g) => ({ key: g.key, name: g.name, group: g.group, lines: searchable.filter((s) => matches(g, s.tpl)).length }))
    .filter((g) => g.lines > 0);
}

// What to search for a goal: every matching line, weighed so one full roll counts as 1.
function goalWant(searchable, key) {
  const g = goalByKey(key);
  if (!g) return [];
  return searchable.filter((s) => matches(g, s.tpl)).map((s) => ({ tpl: s.tpl, weight: Math.round((1 / (s.max || 1)) * 10000) / 10000, goal: key }));
}

// What a build cares about, read from the passives it took: for each goal, how many of its
// notables and keystones speak of it (small passives count a third). Defence first: life or
// energy shield (chaos inoculation builds take energy shield). Returns goal keys, most first.
function interests(data, build) {
  const score = new Map();
  for (const id of build.nodes) {
    const n = data.byId.get(id);
    if (!n || !n.stats) continue;
    const w = n.kind === 'small' ? 1 / 3 : 1;
    for (const g of GOALS) if (n.stats.some((l) => matches(g, l))) score.set(g.key, (score.get(g.key) || 0) + w);
  }
  const sorted = [...score].filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]);
  const ranked = sorted.map(([k]) => k);
  // Path of Building knows the real numbers; otherwise the passives decide.
  let defence = (score.get('es') || 0) > (score.get('life') || 0) ? 'es' : 'life';
  if (build.ci) defence = 'es';
  else if (build.life && build.energyShield) defence = build.energyShield > build.life ? 'es' : 'life';
  // Only the clearly strongest offence goals are picked for you (more would water the search down);
  // the rest are starred as suggestions.
  const off = sorted.filter(([k]) => goalByKey(k).group === 'offence');
  const offence = off.filter(([, v], i) => i < 2 && v >= off[0][1] * 0.6).map(([k]) => k);
  const rest = ranked.filter((k) => !offence.includes(k) && k !== 'life' && k !== 'es').slice(0, 4);
  return { defence, offence, more: rest, top: [defence, ...offence] };
}

module.exports = { GOALS, goalByKey, goalsFor, goalWant, interests };
