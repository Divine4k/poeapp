'use strict';
// The Regex page's plain logic: the map and vendor search builders, numbers written as
// "at least N" patterns, and a tester that reads a search the way the game's stash search box
// does. Used by the page (loaded by index.html as window.PoeRegex) and by main.js and the tests,
// so this file loads both ways. No Electron here.
(function () {

// The game's stash search box takes at most this many characters (Path of Exile 1).
const GAME_LIMIT = 250;

// ---- numbers ---------------------------------------------------------------------------
// A pattern for a whole number of at least n (0 to 999), to sit right after a sign or space and
// before a %, so "+185%" is read as 185 and never as 85. n of 0 or less: any number.
const digitRange = (a, b) => (a === b ? String(a) : a === 0 && b === 9 ? '\\d' : `[${a}-${b}]`);
function sameLength(s) {
  // Numbers with exactly as many digits as s that are at least s.
  if (!s.length) return [''];
  const f = Number(s[0]), rest = s.slice(1);
  if (/^0*$/.test(rest)) return [digitRange(f, 9) + '\\d'.repeat(rest.length)];
  const out = sameLength(rest).map((p) => f + p);
  if (f < 9) out.push(digitRange(f + 1, 9) + '\\d'.repeat(rest.length));
  return out;
}
function atLeast(n) {
  n = Math.floor(Number(n));
  if (!(n > 0)) return '\\d+';
  if (n > 999) n = 999;
  const s = String(n), alts = sameLength(s);
  if (s.length < 3) alts.push(s.length === 2 ? '\\d{3}' : '\\d{2,3}'); // longer numbers, up to three digits
  return alts.length === 1 ? alts[0] : `(${alts.join('|')})`;
}

// ---- maps ------------------------------------------------------------------------------
// Map mods, each with a short piece of its text (tok) that no other map mod or map line has, so
// a search made of them stays short. text: the mod as the game writes it on the map, used by the
// tests to prove each piece finds its mod and nothing else (also: the same mod as it is worded
// elsewhere, found by the same piece). Tokens are written lower case: the game's search ignores
// case. The list is the game's own for 3.30 (Covens of Umbra), read 26 Nov 2026 from poe.re's map
// data and checked against Awakened PoE Trade's stat list: percentage reflect is gone (rare
// monsters have Thorns), and nine mods roll on rare maps only. "(tier 17)" in a label: the mod of
// Nightmare and Originator maps. A changed list: scripts are not needed, `npm run test:regex`
// names every piece that clashes.
const MAP_MODS = [
  { id: 'no-regen', group: 'Players', label: 'No regeneration', tok: 'regen', text: 'Players cannot Regenerate Life, Mana or Energy Shield' },
  { id: 'no-leech', group: 'Players', label: 'Cannot leech', tok: 'eche', text: 'Monsters cannot be Leeched from' },
  { id: 'leech-rate', group: 'Players', label: 'Less leech per second', tok: 'm total', text: 'Players have 60% reduced Maximum total Life, Mana and Energy Shield Recovery per second from Leech' },
  { id: 'less-recovery', group: 'Players', label: 'Less recovery rate', tok: 'ss rec', text: 'Players have 60% less Recovery Rate of Life and Energy Shield' },
  { id: 'cooldown', group: 'Players', label: 'Less cooldown recovery', tok: 'cool', text: 'Players have 40% less Cooldown Recovery Rate' },
  { id: 'max-res', group: 'Players', label: 'Lower maximum resistances', tok: 'm res', text: 'Players have -12% to all maximum Resistances' },
  { id: 'curse-vuln', group: 'Players', label: 'Cursed: Vulnerability', tok: 'vuln', text: 'Players are Cursed with Vulnerability' },
  { id: 'curse-tc', group: 'Players', label: 'Cursed: Temporal Chains', tok: 'poral', text: 'Players are Cursed with Temporal Chains' },
  { id: 'curse-ew', group: 'Players', label: 'Cursed: Elemental Weakness', tok: 'weak', text: 'Players are Cursed with Elemental Weakness' },
  { id: 'curse-enf', group: 'Players', label: 'Cursed: Enfeeble', tok: 'enfe', text: 'Players are Cursed with Enfeeble' },
  { id: 'less-armour', group: 'Players', label: 'Less armour', tok: 'ss arm', text: 'Players have 30% less Armour' },
  { id: 'less-block', group: 'Players', label: 'Less block chance', tok: 'd cha', text: 'Players have 40% reduced Chance to Block' },
  { id: 'less-defences', group: 'Players', label: 'Less defences (tier 17)', tok: 'efe', text: 'Players have 30% less Defences' },
  { id: 'less-suppress', group: 'Players', label: 'Suppression prevents less', tok: 'amo', text: 'Players have -20% to amount of Suppressed Spell Damage Prevented' },
  { id: 'less-accuracy', group: 'Players', label: 'Less accuracy', tok: 'ss acc', text: 'Players have 25% less Accuracy Rating' },
  { id: 'less-aoe', group: 'Players', label: 'Less area of effect', tok: 'ss area', text: 'Players have 25% less Area of Effect' },
  { id: 'auras', group: 'Players', label: 'Weaker auras', tok: 'non-c', text: 'Players have 60% reduced effect of Non-Curse Auras from Skills' },
  { id: 'auras-enemies', group: 'Players', label: 'Auras also affect enemies (tier 17)', tok: 'nem', text: 'Auras from Player Skills which affect Allies also affect Enemies' },
  { id: 'flask', group: 'Players', label: 'Fewer flask charges', tok: 'sk ch', text: 'Players gain 50% reduced Flask Charges' },
  { id: 'flask-effect', group: 'Players', label: 'Weaker flasks (tier 17)', tok: 'sks', text: 'Players have 40% less effect of Flasks applied to them' },
  { id: 'flask-meteor', group: 'Players', label: 'Meteor on flask use (tier 17)', tok: 'tar', text: 'Players are targeted by a Meteor when they use a Flask' },
  { id: 'buffs', group: 'Players', label: 'Buffs expire faster', tok: 'on p', text: 'Buffs on Players expire 100% faster' },
  { id: 'no-exposure', group: 'Players', label: 'Cannot inflict exposure', tok: 'xpo', text: 'Players cannot inflict Exposure' },
  { id: 'sawblades', group: 'Players', label: 'Sawblades (tier 17)', tok: 'sau', text: 'Players are assaulted by Bloodstained Sawblades' },
  { id: 'maven', group: 'Players', label: 'The Maven interferes (tier 17)', tok: 'mav', text: 'The Maven interferes with Players' },
  { id: 'thorns-phys', group: 'Monsters', label: 'Physical thorns', tok: 've p', text: 'Rare Monsters have Physical Thorns reflecting 800 Physical Damage' },
  { id: 'thorns-ele', group: 'Monsters', label: 'Elemental thorns', tok: 've e', text: 'Rare Monsters have Elemental Thorns reflecting 1500 Elemental Damage' },
  { id: 'steal-charges', group: 'Monsters', label: 'Steal charges', tok: 'steal', text: 'Monsters steal Power, Frenzy and Endurance charges on Hit' },
  { id: 'avoid-ailments', group: 'Monsters', label: 'Avoid elemental ailments', tok: 'oid ele', text: 'Monsters have 70% chance to Avoid Elemental Ailments' },
  { id: 'avoid-poison', group: 'Monsters', label: 'Avoid poison, impale, bleeding', tok: 'oid poi', text: 'Monsters have a 50% chance to avoid Poison, Impale, and Bleeding' },
  { id: 'no-stun', group: 'Monsters', label: 'Cannot be stunned', tok: 'stunn', text: 'Monsters cannot be Stunned' },
  { id: 'no-taunt', group: 'Monsters', label: 'Cannot be taunted', tok: 'tau', text: 'Monsters cannot be Taunted' },
  { id: 'action-speed', group: 'Monsters', label: 'Cannot be slowed', tok: 'ction sp', text: "Monsters' Action Speed cannot be modified to below Base Value" },
  { id: 'move-floor', group: 'Monsters', label: 'Movement cannot be slowed', tok: 'nt speed can', text: "Monsters' Movement Speed cannot be modified to below Base Value" },
  { id: 'hexproof', group: 'Monsters', label: 'Hexproof', tok: 'hexp', text: 'Monsters are Hexproof' },
  { id: 'curse-effect', group: 'Monsters', label: 'Curses work less on monsters', tok: 'rses', text: '60% less effect of Curses on Monsters' },
  { id: 'debuffs', group: 'Monsters', label: 'Debuffs on monsters expire faster (tier 17)', tok: 'deb', text: 'Debuffs on Monsters expire 100% faster' },
  { id: 'crit-chance', group: 'Monsters', label: 'More critical strikes', tok: 'ike ch', text: 'Monsters have 400% increased Critical Strike Chance' },
  { id: 'crit-multi', group: 'Monsters', label: 'Critical multiplier', tok: 'multi', text: '+45% to Monster Critical Strike Multiplier' },
  { id: 'crit-taken', group: 'Monsters', label: 'Take less from critical strikes', tok: 'a damage f', text: 'Monsters take 45% reduced Extra Damage from Critical Strikes' },
  { id: 'extra-fire', group: 'Monsters', label: 'Extra fire damage', tok: 'e as f', text: 'Monsters deal 110% extra Physical Damage as Fire' },
  { id: 'extra-cold', group: 'Monsters', label: 'Extra cold damage', tok: 'e as c', text: 'Monsters deal 110% extra Physical Damage as Cold' },
  { id: 'extra-light', group: 'Monsters', label: 'Extra lightning damage', tok: 'e as l', text: 'Monsters deal 110% extra Physical Damage as Lightning' },
  { id: 'extra-chaos', group: 'Monsters', label: 'Extra chaos damage', tok: 'ra chaos', text: 'Monsters gain 35% of their Physical Damage as Extra Chaos Damage' },
  { id: 'extra-random', group: 'Monsters', label: 'Extra damage of a random element (tier 17)', tok: 'f a', text: 'Monsters gain 200% of their Physical Damage as Extra Damage of a random Element' },
  { id: 'penetrate', group: 'Monsters', label: 'Penetrate elemental resistances (tier 17)', tok: 'net', text: 'Monster Damage Penetrates 15% Elemental Resistances' },
  { id: 'more-damage', group: 'Monsters', label: 'More damage', tok: 'd monster d', text: '40% increased Monster Damage' },
  { id: 'attack-speed', group: 'Monsters', label: 'Faster attacks', tok: 'r a', text: '45% increased Monster Attack Speed' },
  { id: 'cast-speed', group: 'Monsters', label: 'Faster casting', tok: 'r ca', text: '45% increased Monster Cast Speed' },
  { id: 'move-speed', group: 'Monsters', label: 'Faster monsters', tok: 'r mo', text: '30% increased Monster Movement Speed' },
  { id: 'monster-accuracy', group: 'Monsters', label: 'More accurate monsters', tok: 'd ac', text: 'Monsters have 50% increased Accuracy Rating' },
  { id: 'projectiles', group: 'Monsters', label: 'Extra projectiles', tok: 'rs f', text: 'Monsters fire 2 additional Projectiles' },
  { id: 'chain', group: 'Monsters', label: 'Skills chain', tok: 's chain', text: "Monsters' skills Chain 2 additional times" },
  { id: 'chain-terrain', group: 'Monsters', label: 'Projectiles chain off terrain (tier 17)', tok: 'lid', text: "Monsters' Projectiles can Chain when colliding with Terrain" },
  { id: 'monster-aoe', group: 'Monsters', label: 'Bigger area of effect', tok: 'e \\d+% increased ar', text: 'Monsters have 100% increased Area of Effect' },
  { id: 'monster-life', group: 'Monsters', label: 'More life', tok: 'r li', text: '100% more Monster Life' },
  { id: 'monster-es', group: 'Monsters', label: 'Extra energy shield', tok: 'extra max', text: 'Monsters gain 80% of Maximum Life as Extra Maximum Energy Shield' },
  { id: 'monster-block', group: 'Monsters', label: 'Block attacks (tier 17)', tok: 'ck att', text: 'Monsters have +50% Chance to Block Attack Damage' },
  { id: 'suppress', group: 'Monsters', label: 'Suppress spells', tok: 'o s', text: 'Monsters have +100% chance to Suppress Spell Damage' },
  { id: 'phys-reduction', group: 'Monsters', label: 'Physical damage reduction', tok: 'uction', text: '+40% Monster Physical Damage Reduction' },
  { id: 'ele-res', group: 'Monsters', label: 'Elemental resistances', tok: 'ster ele', text: '+40% Monster Elemental Resistances' },
  { id: 'chaos-res', group: 'Monsters', label: 'Chaos resistance', tok: 'ster cha', text: '+25% Monster Chaos Resistance' },
  { id: 'frenzy', group: 'Monsters', label: 'Gain frenzy charges', tok: 'a fren', text: 'Monsters gain a Frenzy Charge on Hit' },
  { id: 'frenzy-max', group: 'Monsters', label: 'Extra frenzy charge (tier 17)', tok: 'm f', text: 'Monsters have +1 to Maximum Frenzy Charges' },
  { id: 'power', group: 'Monsters', label: 'Gain power charges', tok: 'a pow', text: 'Monsters gain a Power Charge on Hit' },
  { id: 'power-max', group: 'Monsters', label: 'Extra power charge (tier 17)', tok: 'um p', text: 'Monsters have +1 to Maximum Power Charges' },
  { id: 'endurance', group: 'Monsters', label: 'Gain endurance charges', tok: 'an end', text: 'Monsters gain an Endurance Charge on Hit', also: ['Monsters gain an Endurance Charge when hit'] },
  { id: 'endurance-max', group: 'Monsters', label: 'Extra endurance charge (tier 17)', tok: 'm end', text: 'Monsters have +1 to Maximum Endurance Charges' },
  { id: 'impale', group: 'Monsters', label: 'Impale', tok: 'ks h', text: "Monsters' Attacks have 60% chance to Impale on Hit" },
  { id: 'blind', group: 'Monsters', label: 'Blind', tok: 'blind', text: 'Monsters Blind on Hit' },
  { id: 'maim', group: 'Monsters', label: 'Maim', tok: 'maim', text: 'Monsters Maim on Hit with Attacks' },
  { id: 'hinder', group: 'Monsters', label: 'Hinder', tok: 'hin', text: 'Monsters Hinder on Hit with Spells' },
  { id: 'wither', group: 'Monsters', label: 'Wither', tok: 'wither', text: 'Monsters Inflict Withered for 2 seconds on Hit' },
  { id: 'vines', group: 'Monsters', label: 'Grasping vines (tier 17)', tok: 'asp', text: 'Monsters inflict 2 Grasping Vines on Hit' },
  { id: 'poison', group: 'Monsters', label: 'Poison', tok: 'ison on', text: 'Monsters Poison on Hit' },
  { id: 'poison-duration', group: 'Monsters', label: 'Longer poison (tier 17)', tok: 'urat', text: 'Monsters have 100% increased Poison Duration' },
  { id: 'poison-all', group: 'Monsters', label: 'All damage can poison (tier 17)', tok: 'm mo', text: "All Damage from Monsters' Hits can Poison" },
  { id: 'always-ignite', group: 'Monsters', label: 'Always ignite', tok: 'alw', text: 'All Monster Damage from Hits always Ignites' },
  { id: 'ailments', group: 'Monsters', label: 'Ignite, freeze and shock', tok: 'k o', text: 'Monsters have a 20% chance to Ignite, Freeze and Shock on Hit', also: ['Monsters Ignite, Freeze and Shock on Hit'] },
  { id: 'ailments-all', group: 'Monsters', label: 'All damage can ignite, freeze and shock (tier 17)', tok: 'ge c', text: 'All Monster Damage can Ignite, Freeze and Shock' },
  { id: 'more-mods', group: 'Monsters', label: 'Rares with an extra mod (tier 17)', tok: 'l modi', text: 'Rare Monsters each have 1 additional Modifier' },
  { id: 'more-rares', group: 'Monsters', label: 'More rare monsters', tok: 'num', text: '30% increased number of Rare Monsters' },
  { id: 'more-magic', group: 'Monsters', label: 'More magic monsters', tok: 'c m', text: '30% increased Magic Monsters' },
  { id: 'fracture', group: 'Monsters', label: 'Rares fracture on death (tier 17)', tok: 'fra', text: '25% chance for Rare Monsters to Fracture on death' },
  { id: 'revive', group: 'Monsters', label: 'Rares revive (tier 17)', tok: 'ril', text: 'Rare monsters in area Temporarily Revive on death' },
  { id: 'shaper-touched', group: 'Monsters', label: 'Shaper-touched rares (tier 17)', tok: 'r-t', text: 'Rare monsters in area are Shaper-Touched' },
  { id: 'volatile', group: 'Monsters', label: 'Volatile cores (tier 17)', tok: 'vola', text: 'Rare Monsters have Volatile Cores' },
  { id: 'shrine-buff', group: 'Monsters', label: 'Uniques with a shrine buff (tier 17)', tok: 'ue m', text: 'Unique Monsters have a random Shrine Buff' },
  { id: 'boss', group: 'Monsters', label: 'Boss deals more damage', tok: 'd d', text: 'Unique Boss deals 25% increased Damage' },
  { id: 'boss-speed', group: 'Monsters', label: 'Faster boss', tok: 'd at', text: 'Unique Boss has 30% increased Attack and Cast Speed' },
  { id: 'boss-life', group: 'Monsters', label: 'Boss with more life', tok: 'ed l', text: 'Unique Boss has 35% increased Life' },
  { id: 'boss-aoe', group: 'Monsters', label: 'Boss with bigger area of effect', tok: 's \\d+% increased ar', text: 'Unique Boss has 70% increased Area of Effect' },
  { id: 'two-bosses', group: 'Monsters', label: 'Two bosses', tok: 'two', text: 'Area contains two Unique Bosses' },
  { id: 'possessed', group: 'Monsters', label: 'Possessed bosses', tok: 'poss', text: 'Unique Bosses are Possessed' },
  { id: 'synth-boss', group: 'Monsters', label: 'Synthesis boss (tier 17)', tok: 'cco', text: 'Map Boss is accompanied by a Synthesis Boss' },
  { id: 'burning', group: 'Area', label: 'Burning ground', tok: 'burn', text: 'Area has patches of Burning Ground' },
  { id: 'chilled', group: 'Area', label: 'Chilled ground', tok: 'chil', text: 'Area has patches of Chilled Ground' },
  { id: 'shocked', group: 'Area', label: 'Shocked ground', tok: 'shocked g', text: 'Area has patches of Shocked Ground which increase Damage taken by 50%' },
  { id: 'desecrated', group: 'Area', label: 'Desecrated ground', tok: 'desec', text: 'Area has patches of desecrated ground' },
  { id: 'consecrated', group: 'Area', label: 'Consecrated ground', tok: 'consec', text: 'Area has patches of Consecrated Ground' },
  { id: 'marked', group: 'Area', label: 'Marked ground (tier 17)', tok: 'ovi', text: 'Area contains patches of moving Marked Ground, inflicting random Marks' },
  { id: 'totems', group: 'Area', label: 'Many totems', tok: 'many', text: 'Area contains many Totems' },
  { id: 'orbs', group: 'Area', label: 'Drowning orbs (tier 17)', tok: 'wni', text: 'Area contains Drowning Orbs' },
  { id: 'hazards', group: 'Area', label: 'Labyrinth hazards (tier 17)', tok: 'byr', text: 'Area contains Labyrinth Hazards' },
  { id: 'runes', group: 'Area', label: 'Searing Exarch runes (tier 17)', tok: 'run', text: 'Area contains Runes of the Searing Exarch' },
  { id: 'fiends', group: 'Area', label: 'Tentacle fiends (tier 17)', tok: 'uns', text: 'Area contains Unstable Tentacle Fiends' },
  { id: 'variety', group: 'Area', label: 'More monster variety', tok: 'var', text: 'Area has increased monster variety' },
  { id: 'in-abominations', group: 'Area', label: 'Inhabited by abominations', tok: 'bom', text: 'Area is inhabited by Abominations' },
  { id: 'in-animals', group: 'Area', label: 'Inhabited by animals', tok: 'nim', text: 'Area is inhabited by Animals' },
  { id: 'in-cultists', group: 'Area', label: 'Inhabited by cultists of Kitava', tok: 'cul', text: 'Area is inhabited by Cultists of Kitava' },
  { id: 'in-demons', group: 'Area', label: 'Inhabited by demons', tok: 'y d', text: 'Area is inhabited by Demons' },
  { id: 'in-ghosts', group: 'Area', label: 'Inhabited by ghosts', tok: 'hos', text: 'Area is inhabited by Ghosts' },
  { id: 'in-goatmen', group: 'Area', label: 'Inhabited by goatmen', tok: 'goa', text: 'Area is inhabited by Goatmen' },
  { id: 'in-humanoids', group: 'Area', label: 'Inhabited by humanoids', tok: 'hum', text: 'Area is inhabited by Humanoids' },
  { id: 'in-lunaris', group: 'Area', label: 'Inhabited by lunaris fanatics', tok: 'lun', text: 'Area is inhabited by Lunaris fanatics' },
  { id: 'in-sea-witches', group: 'Area', label: 'Inhabited by sea Witches and their Spawn', tok: 'spa', text: 'Area is inhabited by Sea Witches and their Spawn' },
  { id: 'in-skeletons', group: 'Area', label: 'Inhabited by skeletons', tok: 'ske', text: 'Area is inhabited by Skeletons' },
  { id: 'in-solaris', group: 'Area', label: 'Inhabited by solaris fanatics', tok: 'sola', text: 'Area is inhabited by Solaris fanatics' },
  { id: 'in-undead', group: 'Area', label: 'Inhabited by undead', tok: 'ndea', text: 'Area is inhabited by Undead' },
  { id: 'in-ranged', group: 'Area', label: 'Inhabited by ranged monsters', tok: 'ang', text: 'Area is inhabited by ranged monsters' },
  { id: 'sentinel-pandemonium', group: 'Area', label: 'Pandemonium Sentinel (rare maps)', tok: 'oni', text: 'Area contains a buried Pandemonium Sentinel' },
  { id: 'sentinel-apex', group: 'Area', label: 'Apex Sentinel (rare maps)', tok: 'pex', text: 'Area contains a buried Apex Sentinel' },
  { id: 'sentinel-stalker', group: 'Area', label: 'Stalker Sentinel (rare maps)', tok: 'alk', text: 'Area contains a buried Stalker Sentinel' },
  { id: 'mirage', group: 'Area', label: 'Mirage (rare maps)', tok: 'ira', text: 'Area contains a Mirage' },
  { id: 'wildwood', group: 'Area', label: 'Viridian Wildwood (rare maps)', tok: 'vir', text: 'Area contains the Viridian Wildwood' },
  { id: 'evocator-beidat', group: 'Area', label: 'Evocator of Beidat (rare maps)', tok: 'bei', text: 'Area contains an Evocator of Beidat' },
  { id: 'evocator-ghorr', group: 'Area', label: 'Evocator of Ghorr (rare maps)', tok: 'f g', text: 'Area contains an Evocator of Ghorr' },
  { id: 'evocator-ktash', group: 'Area', label: "Evocator of K'Tash (rare maps)", tok: 'tash', text: "Area contains an Evocator of K'Tash" },
  { id: 'delirium-mirror', group: 'Area', label: 'Mirror of Delirium (rare maps)', tok: 'irr', text: 'Area contains a Mirror of Delirium' },
];
const MOD_BY_ID = new Map(MAP_MODS.map((m) => [m.id, m]));

// Lines every map shows besides its mods; no mod's piece may find them. Used by the tests.
const MAP_LINES = [
  'Item Class: Maps', 'Rarity: Rare', 'Rarity: Magic', 'Rarity: Normal', 'Map Tier: 16', 'Item Level: 83', 'Area Level: 83',
  'Unidentified', 'Corrupted', 'Travel to this Map by using it in a personal Map Device. Maps can only be used once.',
  'Strand Map', 'Burial Chambers Map', 'Crimson Temple Map', 'Defiled Cathedral Map', 'Cemetery Map', 'Tower Map', 'Dunes Map',
  'Toxic Sewer Map', 'Waste Pool Map', 'City Square Map', 'Jungle Valley Map', 'Mesa Map', 'Glacier Map', 'Promenade Map',
  'Twice Corrupted', 'Area is influenced by The Elder', 'Area is influenced by The Shaper', "Map contains Baran's Citadel", "Area is influenced by the Originator's Memories",
  'Area is infested with Fungal Growths', "Map's Item Quantity Modifiers also affect Blight Chest count at 25% value", 'Natural inhabitants of this area have been removed',
  'Players in Area are 100% Delirious', "This Map's Modifiers to Atlas Drops also apply to Item Rarity", 'Monster Level: 83',
];

// The numbers a map shows at the top. tok: the piece of the line that poe.re's map page uses for
// it (read from its searches, 26 Nov 2026), so ours find the same lines; line: such a line, for the
// tests. The search is the piece, anything, then the number: "r pa.*(8[5-9]|9\d|\d{3})%".
const YIELDS = [
  { id: 'atlas', label: 'Atlas drops', tok: 'as d', line: 'Atlas Drops: +40% (augmented)' },
  { id: 'pack', label: 'Pack size', tok: 'r pa', line: 'Monster Pack Size: +25% (augmented)' },
  { id: 'maps', label: 'Maps', tok: 're maps', line: 'More Maps: +30% (augmented)' },
  { id: 'rarity', label: 'Rarity', tok: 'm rar', line: 'Item Rarity: +60% (augmented)' },
  { id: 'currency', label: 'Currency', tok: 'cy:', line: 'More Currency: +70% (augmented)' },
  { id: 'threads', label: 'Threads', tok: 'e thr', line: 'More Threads: +30% (augmented)' },
  { id: 'divination', label: 'Divination', tok: 'e div', line: 'More Divination Cards: +30% (augmented)' },
];
// Quality of a map, by kind (Maven chisels). "any" is plain quality.
const QUALITY = [
  { id: 'any', label: 'Quality of any kind', tok: 'ty \\(Quantity\\):', line: 'Quality (Quantity): +20% (augmented)' },
  { id: 'pack', label: 'Pack size', tok: 'ze\\)', line: 'Quality (Pack Size): +20% (augmented)' },
  { id: 'rarity', label: 'Rarity', tok: '\\(rar', line: 'Quality (Rarity): +20% (augmented)' },
  { id: 'currency', label: 'Currency', tok: '\\(Curr', line: 'Quality (Currency): +20% (augmented)' },
  { id: 'divination', label: 'Divination', tok: '\\(div', line: 'Quality (Divination Cards): +20% (augmented)' },
  { id: 'threads', label: 'Threads', tok: '\\(th', line: 'Quality (Threads): +20% (augmented)' },
];
// Kinds of map, found by a piece of their text (as poe.re does).
const MAP_TYPES = [
  { id: 'shaper', label: 'Shaper', tok: 'the shaper' },
  { id: 'elder', label: 'Elder', tok: 'the elder' },
  { id: 'conqueror', label: 'Conqueror', tok: 'citadel' },
  { id: 'originator', label: 'Originator', tok: 'originator' },
  { id: 'blighted', label: 'Blighted', tok: '25% value' },
  { id: 'ravaged', label: 'Blight-ravaged', tok: '50% value' },
];
const RARITIES = [{ id: 'normal', label: 'Normal', l: 'n' }, { id: 'magic', label: 'Magic', l: 'm' }, { id: 'rare', label: 'Rare', l: 'r' }];

// The Map check page's ticks, as map mods: "use my Map check ticks".
const RULE_MODS = {
  'thorns-phys': ['thorns-phys'], 'thorns-ele': ['thorns-ele'], 'no-regen': ['no-regen'], 'no-leech': ['no-leech'],
  'less-recovery': ['less-recovery'], 'max-res': ['max-res'], curses: ['curse-vuln', 'curse-tc', 'curse-ew', 'curse-enf'],
  'avoid-ailments': ['avoid-ailments'], 'avoid-poison-bleed': ['avoid-poison'], 'less-defence': ['less-armour', 'less-block', 'less-defences'],
  'less-accuracy': ['less-accuracy'], 'less-aoe': ['less-aoe'], 'aura-effect': ['auras'], 'flask-charges': ['flask'],
  'steal-charges': ['steal-charges'], 'no-slow': ['no-stun', 'action-speed', 'move-floor'],
};
function modsFromRules(rules) {
  const out = new Set();
  for (const r of rules || []) if (r && r.enabled) for (const id of RULE_MODS[r.id] || []) out.add(id);
  return [...out];
}

// Extra words typed by hand: split on commas, kept as typed (they may be regex).
const extraParts = (s) => String(s || '').split(',').map((x) => x.trim().replace(/"/g, '')).filter(Boolean);

const MAP_DEFAULT = {
  avoid: [], wantMods: [], wantAll: true,
  yields: {}, yieldAny: false, yieldShort: false,
  quality: {}, qualAny: true, qualShort: false,
  rarity: { normal: true, magic: true, rare: true }, rarityMode: 'include',
  corruptedOn: false, corruptedMode: 'include', unidOn: false, unidMode: 'exclude',
  typeOn: {}, typeMode: {}, // a ticked map type is used, with its Include or Exclude
  kept: [], // parts of a pasted search the builder does not know, kept as they were written
};
// "Shorter": rounded down to tens, which makes a shorter pattern (as poe.re's Optimized).
const numPat = (n, short) => atLeast(short && n >= 10 ? Math.floor(n / 10) * 10 : n);

// The search for maps: lights up the maps to run. Returns { text, parts: [{ what, text }] } so the
// page can say what each part does. Every part must be found (the game's rule for words).
function mapSearch(o) {
  o = { ...MAP_DEFAULT, ...(o || {}) };
  const parts = [];
  const avoid = (o.avoid || []).map((id) => MOD_BY_ID.get(id)).filter(Boolean);
  if (avoid.length) parts.push({ what: 'none of the mods you don\'t want', text: `"!${avoid.map((m) => m.tok).join('|')}"` });
  const want = (o.wantMods || []).map((id) => MOD_BY_ID.get(id)).filter(Boolean);
  if (want.length) {
    if (o.wantAll || want.length === 1) for (const m of want) parts.push({ what: `has: ${m.label.toLowerCase()}`, text: `"${m.tok}"` });
    else parts.push({ what: 'at least one of the mods you want', text: `"${want.map((m) => m.tok).join('|')}"` });
  }
  const numbers = (list, vals, any, short, kind) => {
    const on = list.filter((x) => Number(vals && vals[x.id]) > 0).map((x) => ({ x, p: `${x.tok}.*${numPat(Number(vals[x.id]), short)}%` }));
    if (on.length > 1 && any) parts.push({ what: `${kind}: at least one of ${on.map((y) => `${y.x.label.toLowerCase()} ${vals[y.x.id]}%+`).join(', ')}`, text: `"${on.map((y) => y.p).join('|')}"` });
    else for (const y of on) parts.push({ what: `${kind}: ${y.x.label.toLowerCase()} ${vals[y.x.id]}% or more`, text: `"${y.p}"` });
  };
  numbers(YIELDS, o.yields, o.yieldAny, o.yieldShort, 'yield');
  numbers(QUALITY, o.quality, o.qualAny, o.qualShort, 'quality');
  const rar = RARITIES.filter((r) => o.rarity && o.rarity[r.id] !== false);
  if (rar.length && (rar.length < 3 || o.rarityMode === 'exclude')) {
    const body = `y: ${rar.length === 1 ? rar[0].l : `(${rar.map((r) => r.l).join('|')})`}`;
    const names = rar.map((r) => r.label.toLowerCase()).join(' or ');
    parts.push(o.rarityMode === 'exclude' ? { what: `not ${names}`, text: `"!${body}"` } : { what: `${names} maps only`, text: `"${body}"` });
  }
  if (o.corruptedOn) parts.push(o.corruptedMode === 'exclude' ? { what: 'not corrupted', text: '!pte' } : { what: 'corrupted', text: 'pte' });
  if (o.unidOn) parts.push(o.unidMode === 'exclude' ? { what: 'identified (mods can be read)', text: '!tified' } : { what: 'unidentified', text: 'tified' });
  {
    const on = MAP_TYPES.filter((t) => o.typeOn && o.typeOn[t.id] === true);
    const out = on.filter((t) => (o.typeMode && o.typeMode[t.id]) !== 'include'), inn = on.filter((t) => (o.typeMode && o.typeMode[t.id]) === 'include');
    if (out.length) parts.push({ what: `not ${out.map((t) => t.label).join(', ')}`, text: `"!${out.map((t) => t.tok).join('|')}"` });
    if (inn.length) parts.push({ what: `${inn.map((t) => t.label).join(' or ')} only`, text: `"${inn.map((t) => t.tok).join('|')}"` });
  }
  for (const k of o.kept || []) parts.push({ what: 'kept as you wrote it', text: k });
  return { text: parts.map((p) => p.text).join(' '), parts };
}
// A search written elsewhere (pasted, or typed in the bar) read back into the builder's choices.
// What it does not know stays in the search as it was written (kept). Returns the map choices.
const quoted = (t) => (/[\s"]/.test(t) ? `"${t.replace(/"/g, '')}"` : t);
function splitTop(body) { // "a|(b|c)|d" -> a, (b|c), d
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') { cur += ch + (body[i + 1] || ''); i++; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth) depth--;
    if (ch === '|' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
// The smallest number a number pattern finds (as "at least" means), or 0 when none up to 999.
function leastOf(pat) {
  let re;
  try { re = new RegExp(`^(?:${pat})$`); } catch (_) { return 0; }
  for (let x = 1; x <= 999; x++) if (re.test(String(x))) return x;
  return 0;
}
function readMapSearch(text) {
  const m = { ...MAP_DEFAULT, avoid: [], wantMods: [], yields: {}, quality: {}, kept: [], rarity: { normal: true, magic: true, rare: true }, typeOn: {}, typeMode: {} };
  const lower = (x) => x.toLowerCase();
  const modOf = (a) => MAP_MODS.find((x) => lower(x.tok) === lower(a));
  const typeOf = (a) => MAP_TYPES.find((x) => lower(x.tok) === lower(a));
  const numOf = (a) => {
    const g = /^(.*?)\.\*(.+)%$/.exec(a);
    if (!g) return null;
    for (const [list, kind] of [[YIELDS, 'yields'], [QUALITY, 'quality']]) {
      const x = list.find((y) => y.tok === g[1] || lower(y.tok) === lower(g[1]));
      const n = x && leastOf(g[2]);
      if (n) return { kind, id: x.id, n };
    }
    return null;
  };
  const seen = { yields: 0, quality: 0, want: 0 };
  for (const t of parseSearch(text)) {
    const alts = splitTop(t.body), b = lower(t.body);
    const mods = alts.map(modOf), types = alts.map(typeOf), nums = alts.map(numOf);
    // "none of these": the known mods go to Don't want, the rest stays as its own "none of" part.
    if (t.neg && mods.some(Boolean) && !m.avoid.length) {
      m.avoid = mods.filter(Boolean).map((x) => x.id);
      const other = alts.filter((x, i) => !mods[i]);
      if (other.length) m.kept.push(quoted(`!${other.join('|')}`));
    }
    else if (mods.every(Boolean) && !t.neg && (alts.length === 1 ? seen.want !== 'any' : !seen.want)) {
      m.wantMods.push(...mods.map((x) => x.id));
      seen.want = alts.length > 1 ? 'any' : 'all';
      m.wantMatch = seen.want === 'any' ? 'any' : 'all';
    } else if (!t.neg && nums.every(Boolean) && nums.every((x) => x.kind === nums[0].kind) && !seen[nums[0].kind]) {
      const k = nums[0].kind;
      for (const x of nums) m[k][x.id] = x.n;
      seen[k] = alts.length > 1 ? 'any' : 'one';
      if (k === 'yields') m.yieldAny = alts.length > 1; else m.qualAny = alts.length > 1 || m.qualAny;
    } else if (!t.neg && nums.every(Boolean) && seen[nums[0].kind] === 'one' && alts.length === 1) {
      m[nums[0].kind][nums[0].id] = nums[0].n; // one more number, every one needed
      if (nums[0].kind === 'quality') m.qualAny = false;
    } else if (/^y: (\(([nmr]\|?)+\)|[nmr])$/.test(b)) {
      const letters = b.slice(3).replace(/[^nmr]/g, '');
      for (const r of RARITIES) m.rarity[r.id] = letters.includes(r.l);
      m.rarityMode = t.neg ? 'exclude' : 'include';
    } else if (b === 'pte' || b === 'corrupted') { m.corruptedOn = true; m.corruptedMode = t.neg ? 'exclude' : 'include'; }
    else if (b === 'tified' || b === 'unidentified') { m.unidOn = true; m.unidMode = t.neg ? 'exclude' : 'include'; }
    else if (types.every(Boolean)) {
      for (const x of types) { m.typeOn[x.id] = true; m.typeMode[x.id] = t.neg ? 'exclude' : 'include'; }
      for (const x of MAP_TYPES) if (!(x.id in m.typeOn)) m.typeOn[x.id] = false;
    } else m.kept.push(t.neg ? quoted(`!${t.body}`) : quoted(t.body));
  }
  return cleanBuilders({ map: m }).map;
}

// How many characters a mod adds to the search (or takes away, when it is picked), in one list.
function modCost(o, id, list) {
  o = cleanBuilders({ map: o }).map;
  const has = o[list].includes(id);
  const other = list === 'avoid' ? 'wantMods' : 'avoid';
  const without = { ...o, [list]: o[list].filter((x) => x !== id) };
  const withIt = { ...o, [list]: has ? o[list] : [...o[list], id], [other]: o[other].filter((x) => x !== id) };
  return mapSearch(withIt).text.length - mapSearch(without).text.length;
}

// ---- vendors ---------------------------------------------------------------------------
// What to light up in a vendor's window while levelling. Any one of the ticked things lights an
// item up. Sockets read from the line "Sockets: R-G-B B": letters are socket colours, a dash a link.
const LINKS = { 3: '-\\w-', 4: '-\\w-\\w-', 5: '(-\\w){4}', 6: '(-\\w){5}' };
const VENDOR_DEFAULT = { rgb: false, links: 0, sockets: 0, white: false, moveMin: 0, gemLevel: false, extra: '' };
function vendorSearch(o) {
  o = { ...VENDOR_DEFAULT, ...(o || {}) };
  const parts = [];
  if (o.rgb) parts.push({ what: 'red, green and blue linked side by side (chromatic orbs)', text: 'r-g-b|r-b-g|b-r-g|b-g-r|g-r-b|g-b-r' });
  if (LINKS[o.links]) parts.push({ what: `${o.links} or more linked sockets`, text: LINKS[o.links] });
  if (o.sockets >= 2 && o.sockets <= 6) parts.push({ what: `${o.sockets} or more sockets`, text: `ts: (\\w[- ]){${o.sockets - 1}}` });
  if (o.white) parts.push({ what: 'a white socket', text: 'ts:[ rgbad-]*w' });
  if (Number(o.moveMin) > 0) parts.push({ what: `${o.moveMin}% or more movement speed`, text: `${atLeast(o.moveMin)}% increased mov` });
  else if (o.moveMin === -1) parts.push({ what: 'any movement speed', text: 'nt speed' });
  if (o.gemLevel) parts.push({ what: '+ levels to gems', text: 'level of' });
  for (const x of extraParts(o.extra)) parts.push({ what: `your own: ${x}`, text: x });
  return { text: parts.length ? `"${parts.map((p) => p.text).join('|')}"` : '', parts };
}

// ---- the tester ------------------------------------------------------------------------
// Reads a search as the stash search box does: words split on spaces outside quotes, every word
// must be found (a leading ! turns it round), "a|b" is one word that finds a or b, case is ignored.
// Returns [{ text, neg, body }].
function parseSearch(s) {
  const terms = [];
  let cur = '', quoted = false, any = false;
  const end = () => { if (any) { const neg = cur.startsWith('!'); terms.push({ text: cur, neg, body: neg ? cur.slice(1) : cur }); } cur = ''; any = false; };
  for (const ch of String(s || '')) {
    if (ch === '"') { quoted = !quoted; any = true; continue; }
    if (!quoted && /\s/.test(ch)) { end(); continue; }
    cur += ch; any = true;
  }
  end();
  return terms.filter((t) => t.body);
}
// { ok, error?, terms: [{ text, neg, hit (the word was found), pass, match, error? }] }.
// ok: the item would light up. An empty search lights nothing.
function testSearch(search, itemText) {
  const terms = parseSearch(search), item = String(itemText || '');
  if (!terms.length) return { ok: false, terms: [] };
  let bad = '';
  const out = terms.map((t) => {
    let re;
    try { re = new RegExp(t.body, 'i'); } catch (e) { bad = bad || `"${t.text}" is not a valid pattern`; return { ...t, hit: false, pass: false, error: 'not a valid pattern' }; }
    const m = re.exec(item);
    return { ...t, hit: !!m, pass: t.neg ? !m : !!m, match: m ? m[0] : '' };
  });
  return { ok: !bad && out.every((t) => t.pass), error: bad || undefined, terms: out };
}
// A search's problems before it goes to the game: too long, a bad pattern, an odd quote.
function problems(search) {
  const s = String(search || ''), out = [];
  if (s.length > GAME_LIMIT) out.push(`${s.length} characters: the game keeps only the first ${GAME_LIMIT}.`);
  if ((s.match(/"/g) || []).length % 2) out.push('A quote is not closed.');
  for (const t of parseSearch(s)) { try { new RegExp(t.body, 'i'); } catch (_) { out.push(`"${t.text}" is not a valid pattern.`); } }
  return out;
}

// The builders' choices as kept in config.json (config.regex), tidied.
function cleanBuilders(r) {
  r = r && typeof r === 'object' ? r : {};
  const m = { ...MAP_DEFAULT, ...(r.map || {}) }, v = { ...VENDOR_DEFAULT, ...(r.vendor || {}) };
  const num = (x, max) => Math.max(0, Math.min(max, Math.floor(Number(x)) || 0));
  const nums = (list, src) => { const out = {}; for (const x of list) { const n = num(src && src[x.id], 999); if (n) out[x.id] = n; } return out; };
  // Before 0.54 the numbers were "want": { quantity, rarity, pack, currency, scarabs, maps, quality }.
  const oldWant = m.want && typeof m.want === 'object' && !Array.isArray(m.want) ? m.want : {};
  const yields = nums(YIELDS, { pack: oldWant.pack, rarity: oldWant.rarity, currency: oldWant.currency, maps: oldWant.maps, ...(m.yields || {}) });
  const ids = (x) => (Array.isArray(x) ? x : []).filter((id, i, a) => MOD_BY_ID.has(id) && a.indexOf(id) === i);
  const avoid = ids(m.avoid);
  const inOut = (x, dflt) => (x === 'include' || x === 'exclude' ? x : dflt);
  const typeOn = {}, typeMode = {};
  // Before 0.54.2 the types counted only with "Use these" (typesOn) ticked, and every type started ticked.
  const oldOn = (id) => (m.typesOn === undefined ? m.typeOn && m.typeOn[id] === true : !!m.typesOn && !(m.typeOn && m.typeOn[id] === false));
  for (const t of MAP_TYPES) { typeOn[t.id] = oldOn(t.id); typeMode[t.id] = inOut(m.typeMode && m.typeMode[t.id], 'exclude'); }
  return {
    map: {
      avoid, wantMods: ids(m.wantMods).filter((id) => !avoid.includes(id)), // 0.54.0 saved wantAll: false for everyone; the choice is kept as wantMatch from 0.54.2, All by default.
      wantMatch: m.wantMatch === 'any' ? 'any' : 'all', wantAll: m.wantMatch !== 'any',
      yields, yieldAny: !!(m.yieldAny || m.wantAny), yieldShort: !!m.yieldShort,
      quality: nums(QUALITY, m.quality), qualAny: m.qualAny !== false, qualShort: !!m.qualShort,
      rarity: { normal: !(m.rarity && m.rarity.normal === false), magic: !(m.rarity && m.rarity.magic === false), rare: !(m.rarity && m.rarity.rare === false) },
      rarityMode: inOut(m.rarityMode, 'include'),
      corruptedOn: !!m.corruptedOn || m.corrupted === 'only' || m.corrupted === 'not', corruptedMode: m.corrupted === 'not' ? 'exclude' : inOut(m.corruptedMode, 'include'),
      unidOn: !!m.unidOn || m.unidentified === 'not', unidMode: inOut(m.unidMode, 'exclude'),
      typeOn, typeMode,
      kept: (Array.isArray(m.kept) ? m.kept : []).map((x) => String(x).slice(0, 250)).filter(Boolean).slice(0, 20),
    },
    vendor: {
      rgb: !!v.rgb, links: LINKS[v.links] ? Number(v.links) : 0, sockets: [5, 6].includes(Number(v.sockets)) ? Number(v.sockets) : 0,
      white: !!v.white, moveMin: v.moveMin === -1 ? -1 : num(v.moveMin, 50), gemLevel: !!v.gemLevel, extra: String(v.extra || '').slice(0, 200),
    },
  };
}

const api = { GAME_LIMIT, atLeast, MAP_MODS, MAP_LINES, YIELDS, QUALITY, MAP_TYPES, RARITIES, RULE_MODS, modsFromRules, mapSearch, modCost, readMapSearch, vendorSearch, parseSearch, testSearch, problems, cleanBuilders, MAP_DEFAULT, VENDOR_DEFAULT };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PoeRegex = api;
})();
