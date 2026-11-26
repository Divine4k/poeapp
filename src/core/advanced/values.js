'use strict';
// The value table of the advanced price check: what makes a rare item worth money, for each kind
// of item and each kind of build that would buy it. Written by hand and tuned by hand (from the
// "Too low" / "Too high" marks and from looking at the live market), because the app has two
// users: nothing here waits for data of our own.
//
// One point is about one point of maximum Life on a rare. A profile is one kind of buyer; its
// stats say how many points one of each is worth to that buyer:
//   t: '+# total maximum Life'   a total the trade site adds up itself, by its name in the stat list
//   m: '+1% chance to Suppress Spell Damage'
//                                 one modifier, written as on an item with 1 for every number
//   w: points for 1 of it
//   as: what the window calls it ("life"); stats with the same name are shown as one
//   from: from this much it is a reason to buy the item, so the search asks for it outright
//   on: only on these kinds of item (the others cannot have it, or it means little there)
// Changing a number here changes prices: run `npm run test:advanced` afterwards.

const ARMOUR = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield'];
const JEWELLERY = ['Amulet', 'Ring', 'Belt'];
const ONE_HAND = ['Claw', 'Dagger', 'Rune Dagger', 'Wand', 'Sceptre', 'One-Handed Sword', 'One-Handed Axe', 'One-Handed Mace'];
const TWO_HAND = ['Bow', 'Staff', 'Warstaff', 'Two-Handed Sword', 'Two-Handed Axe', 'Two-Handed Mace'];

const life = (w = 1) => ({ t: '+# total maximum Life', w, as: 'life' });
const res = (w = 1) => ({ t: '+#% total Elemental Resistance', w, as: 'resistances' });
const chaos = (w = 1.5) => ({ t: '+#% total to Chaos Resistance', w, as: 'chaos resistance' });
// Strength is half counted as life already (ten Strength is five Life).
const attributes = (str, dex, int) => [
  { t: '+# total to Strength', w: str, as: 'attributes' },
  { t: '+# total to Dexterity', w: dex, as: 'attributes' },
  { t: '+# total to Intelligence', w: int, as: 'attributes' },
];
const suppress = { m: '+1% chance to Suppress Spell Damage', w: 5, as: 'spell suppression', from: 10 };
const critMulti = (w, from) => ({ t: '+#% Global Critical Strike Multiplier', w, as: 'crit multiplier', from });
const socketed = (w) => ({ t: '+# total to Level of Socketed Gems', w, as: '+ socketed gems', from: 1 });
const addedToAttacks = [
  { t: 'Adds # to # Physical Damage to Attacks', w: 6, as: 'added attack damage', from: 8 },
  { t: 'Adds # to # Fire Damage to Attacks', w: 1.5, as: 'added attack damage' },
  { t: 'Adds # to # Cold Damage to Attacks', w: 1.5, as: 'added attack damage' },
  { t: 'Adds # to # Lightning Damage to Attacks', w: 1.5, as: 'added attack damage' },
  { t: 'Adds # to # Chaos Damage to Attacks', w: 2.5, as: 'added attack damage' },
];
const addedToSpells = [
  { t: 'Adds # to # Fire Damage to Spells', w: 1, as: 'added spell damage' },
  { t: 'Adds # to # Cold Damage to Spells', w: 1, as: 'added spell damage' },
  { t: 'Adds # to # Lightning Damage to Spells', w: 1, as: 'added spell damage' },
  { t: 'Adds # to # Chaos Damage to Spells', w: 1.3, as: 'added spell damage' },
  { t: 'Adds # to # Physical Damage to Spells', w: 1.5, as: 'added spell damage' },
];
const dotMulti = (w, from, on) => [
  { m: '+1% to Damage over Time Multiplier', w, as: 'damage over time', from, on },
  { m: '+1% to Chaos Damage over Time Multiplier', w, as: 'damage over time', from, on },
  { m: '+1% to Fire Damage over Time Multiplier', w, as: 'damage over time', from, on },
  { m: '+1% to Cold Damage over Time Multiplier', w, as: 'damage over time', from, on },
  { m: '+1% to Physical Damage over Time Multiplier', w, as: 'damage over time', from, on },
];

const PROFILES = [
  {
    id: 'life', name: 'life builds', slots: ARMOUR,
    stats: [
      life(1), res(1), chaos(1.5), suppress,
      { t: '#% increased Movement Speed', w: 3.5, as: 'movement speed', from: 25, on: ['Boots'] },
      { t: '+#% total Attack Speed', w: 6, as: 'attack speed', from: 10, on: ['Gloves'] },
      socketed(40),
      { m: '1% increased maximum Life', w: 12, as: 'life', from: 6, on: ['Body Armour', 'Shield'] },
      { m: '1% Chance to Block Spell Damage', w: 6, as: 'spell block', from: 8, on: ['Shield'] },
      { m: '+1% to all maximum Resistances', w: 90, as: 'maximum resistances', from: 1, on: ['Body Armour', 'Shield'] },
      { m: '1% additional Physical Damage Reduction', w: 20, as: 'physical damage reduction', from: 3, on: ['Body Armour', 'Helmet', 'Shield'] },
      { m: 'Attacks have +1% to Critical Strike Chance', w: 60, as: 'attack crit chance', from: 1, on: ['Body Armour'] },
      { m: '1% increased Mana Reservation Efficiency of Skills', w: 6, as: 'reservation efficiency', from: 8, on: ['Helmet'] },
      { m: '+1 to Level of all Minion Skill Gems', w: 150, as: '+ minion gems', from: 1, on: ['Helmet'] },
      { m: '1% increased Cooldown Recovery Rate', w: 5, as: 'cooldown recovery', from: 10, on: ['Boots'] },
      { m: '+1 to Accuracy Rating', w: 0.06, as: 'accuracy', on: ['Gloves', 'Helmet'] },
      ...attributes(0.15, 0.3, 0.3),
    ],
  },
  {
    id: 'es', name: 'energy shield builds', slots: ARMOUR,
    // its energy shield is what it is bought for: counted, and asked for outright
    prop: { key: 'es', of: 'energyShield', group: 'armour_filters', points: 220, least: 0.35, floor: [0.85, 0.75, 0.65], as: 'energy shield' },
    stats: [
      res(1), chaos(1.5), suppress, life(0.5),
      { t: '#% increased Movement Speed', w: 3.5, as: 'movement speed', from: 25, on: ['Boots'] },
      socketed(40),
      { m: '1% faster start of Energy Shield Recharge', w: 2.5, as: 'faster recharge', from: 25 },
      { t: '#% increased Spell Damage', w: 1.5, as: 'spell damage', from: 40, on: ['Shield'] },
      { t: '+#% total Critical Strike Chance for Spells', w: 0.8, as: 'crit chance', on: ['Shield'] },
      { m: '1% Chance to Block Spell Damage', w: 6, as: 'spell block', from: 8, on: ['Shield'] },
      { m: '1% increased Mana Reservation Efficiency of Skills', w: 6, as: 'reservation efficiency', from: 8, on: ['Helmet'] },
      { m: '+1 to Level of all Minion Skill Gems', w: 150, as: '+ minion gems', from: 1, on: ['Helmet'] },
      { m: '+1 to maximum Mana', w: 0.25, as: 'mana' },
      ...attributes(0.1, 0.2, 0.4),
    ],
  },
  {
    id: 'general', name: 'most life builds', slots: JEWELLERY,
    stats: [
      life(1), res(1), chaos(1.5),
      { t: '+# total maximum Energy Shield', w: 0.6, as: 'energy shield' },
      { m: '1% increased maximum Life', w: 12, as: 'life', from: 5 },
      { m: '1% increased Cooldown Recovery Rate', w: 5, as: 'cooldown recovery', from: 10, on: ['Belt'] },
      { m: '1% increased Flask Charges gained', w: 1, as: 'flasks', on: ['Belt'] },
      { m: '1% increased Flask Effect Duration', w: 1.2, as: 'flasks', on: ['Belt'] },
      { t: '#% increased Rarity of Items found', w: 1, as: 'item rarity' },
      { m: '+1 to maximum Mana', w: 0.2, as: 'mana' },
      ...attributes(0.15, 0.3, 0.3),
    ],
  },
  {
    id: 'attack', name: 'attack builds', slots: [...JEWELLERY, 'Quiver'],
    stats: [
      life(1), res(0.8), chaos(1.2), critMulti(3, 25),
      { t: '+#% Global Critical Strike Chance', w: 1.2, as: 'crit chance' },
      { t: '+#% total Attack Speed', w: 7, as: 'attack speed', from: 6 },
      { t: '#% increased Elemental Damage with Attack Skills', w: 2, as: 'elemental attack damage', from: 30 },
      ...addedToAttacks,
      { m: '+1 to Level of all Skill Gems', w: 250, as: '+ skill gems', from: 1, on: ['Amulet'] },
      { m: 'Bow Attacks fire 1 additional Arrows', w: 200, as: 'additional arrow', from: 1, on: ['Quiver'] },
      { m: '1% increased Global Physical Damage', w: 2, as: 'physical damage', from: 20 },
      ...dotMulti(4, 15, ['Amulet', 'Quiver']),
      { m: '+1 to Accuracy Rating', w: 0.06, as: 'accuracy' },
      ...attributes(0.15, 0.3, 0.2),
    ],
  },
  {
    id: 'spell', name: 'spell builds', slots: JEWELLERY,
    stats: [
      life(1), res(0.8), chaos(1.2), critMulti(3, 25),
      { t: '+# total maximum Energy Shield', w: 1.2, as: 'energy shield' },
      { t: '#% total increased maximum Energy Shield', w: 4, as: 'energy shield', on: ['Amulet'] },
      { t: '+#% total Critical Strike Chance for Spells', w: 1, as: 'crit chance' },
      { t: '+#% total Cast Speed', w: 5, as: 'cast speed', from: 8 },
      { t: '#% increased Spell Damage', w: 2.5, as: 'spell damage', from: 20, on: ['Amulet'] },
      { m: '+1 to Level of all Skill Gems', w: 250, as: '+ skill gems', from: 1, on: ['Amulet'] },
      { m: '+1 to Level of all Fire Skill Gems', w: 160, as: '+ skill gems', from: 1, on: ['Amulet'] },
      { m: '+1 to Level of all Cold Skill Gems', w: 160, as: '+ skill gems', from: 1, on: ['Amulet'] },
      { m: '+1 to Level of all Lightning Skill Gems', w: 160, as: '+ skill gems', from: 1, on: ['Amulet'] },
      { m: '+1 to Level of all Chaos Skill Gems', w: 160, as: '+ skill gems', from: 1, on: ['Amulet'] },
      { m: '+1 to Level of all Physical Skill Gems', w: 160, as: '+ skill gems', from: 1, on: ['Amulet'] },
      ...dotMulti(4, 15, ['Amulet']),
      { t: '#% increased Fire Damage', w: 1.5, as: 'elemental damage' },
      { t: '#% increased Cold Damage', w: 1.5, as: 'elemental damage' },
      { t: '#% increased Lightning Damage', w: 1.5, as: 'elemental damage' },
      { m: '+1 to maximum Mana', w: 0.25, as: 'mana' },
      ...attributes(0.15, 0.15, 0.35),
    ],
  },
  {
    id: 'attributes', name: 'attribute stackers', slots: JEWELLERY,
    // only when the item carries a lot of them: 90 or more over the three
    need: { as: 'attributes', points: 105 },
    stats: [...attributes(1.2, 1.2, 1.2), life(0.6), res(0.6), chaos(1), { t: '+# total maximum Energy Shield', w: 0.8, as: 'energy shield' }],
  },
  {
    id: 'find', name: 'magic find', slots: ['Amulet', 'Ring', 'Gloves', 'Boots', 'Helmet'],
    need: { as: 'item rarity', points: 80 },
    stats: [{ t: '#% increased Rarity of Items found', w: 4, as: 'item rarity', from: 20 }, life(0.5), res(0.5)],
  },
  {
    id: 'jewel', name: 'most builds', slots: ['Jewel'],
    stats: [
      { m: '1% increased maximum Life', w: 14, as: 'life', from: 5 },
      { m: '1% increased maximum Energy Shield', w: 9, as: 'energy shield', from: 6 },
      critMulti(3, 12),
      { m: '+1% to Critical Strike Multiplier for Spell Damage', w: 2.2, as: 'crit multiplier' },
      { m: '+1% to Critical Strike Multiplier with Elemental Skills', w: 2.2, as: 'crit multiplier' },
      { m: '+1% to Critical Strike Multiplier with Fire Skills', w: 2.2, as: 'crit multiplier' },
      { m: '+1% to Critical Strike Multiplier with Cold Skills', w: 2.2, as: 'crit multiplier' },
      { m: '+1% to Critical Strike Multiplier with Lightning Skills', w: 2.2, as: 'crit multiplier' },
      { t: '+#% total Attack Speed', w: 6, as: 'attack speed', from: 4 },
      { t: '+#% total Cast Speed', w: 4.5, as: 'cast speed', from: 4 },
      ...dotMulti(5),
      { m: '1% increased Damage', w: 1.5, as: 'damage' },
      { t: '#% increased Spell Damage', w: 1.2, as: 'damage' },
      { m: '1% increased Global Physical Damage', w: 1.2, as: 'damage' },
      { t: '#% increased Fire Damage', w: 1.2, as: 'damage' },
      { t: '#% increased Cold Damage', w: 1.2, as: 'damage' },
      { t: '#% increased Lightning Damage', w: 1.2, as: 'damage' },
      { m: '1% increased Chaos Damage', w: 1.2, as: 'damage' },
      { m: '1% increased Damage over Time', w: 1.3, as: 'damage' },
      { m: 'Minions deal 1% increased Damage', w: 1.3, as: 'damage' },
      { m: '1% increased Area Damage', w: 1.1, as: 'damage' },
      { m: '1% increased Projectile Damage', w: 1.1, as: 'damage' },
      res(1), chaos(1.5), ...attributes(0.5, 0.5, 0.5),
    ],
  },
  {
    id: 'abyss', name: 'most builds', slots: ['Abyss Jewel'],
    stats: [
      life(1.6), { t: '+# total maximum Energy Shield', w: 1.2, as: 'energy shield' }, critMulti(3, 10),
      ...addedToAttacks.map((s) => ({ ...s, from: undefined })), ...addedToSpells,
      res(1), chaos(1.5), ...attributes(0.4, 0.4, 0.4),
    ],
  },
  {
    id: 'weapon', name: 'attack builds', slots: [...ONE_HAND, ...TWO_HAND],
    // a weapon for attacks is bought for its damage: the larger of physical and elemental
    prop: { key: 'dps', group: 'weapon_filters', points: 300, least: 0.35, floor: [0.9, 0.8, 0.7], as: 'damage per second' },
    stats: [
      { m: '1% increased Critical Strike Chance', w: 1.2, as: 'crit chance' },
      critMulti(2.5, 25), socketed(40),
      { m: '1% chance to deal Double Damage', w: 12, as: 'double damage' },
      { m: 'Bow Attacks fire 1 additional Arrows', w: 150, as: 'additional arrow', from: 1, on: ['Bow'] },
      ...dotMulti(3, 20),
      { m: '+1 to Accuracy Rating', w: 0.04, as: 'accuracy' },
    ],
  },
  {
    id: 'caster', name: 'spell builds', slots: ['Wand', 'Sceptre', 'Rune Dagger', 'Dagger', 'Staff'],
    stats: [
      { t: '#% increased Spell Damage', w: 0.9, as: 'spell damage', from: 60 },
      { m: '+1 to Level of all Spell Skill Gems', w: 160, as: '+ spell gems', from: 1 },
      { m: '+1 to Level of all Fire Spell Skill Gems', w: 130, as: '+ spell gems', from: 1 },
      { m: '+1 to Level of all Cold Spell Skill Gems', w: 130, as: '+ spell gems', from: 1 },
      { m: '+1 to Level of all Lightning Spell Skill Gems', w: 130, as: '+ spell gems', from: 1 },
      { m: '+1 to Level of all Chaos Spell Skill Gems', w: 130, as: '+ spell gems', from: 1 },
      { m: '+1 to Level of all Physical Spell Skill Gems', w: 130, as: '+ spell gems', from: 1 },
      { m: '+1 to Level of all Minion Skill Gems', w: 160, as: '+ minion gems', from: 1 },
      { t: '+#% total Cast Speed', w: 3, as: 'cast speed', from: 15 },
      { t: '+#% total Critical Strike Chance for Spells', w: 0.6, as: 'crit chance', from: 80 },
      critMulti(2.5, 25),
      ...dotMulti(4, 15),
      { t: '#% increased Fire Damage', w: 0.8, as: 'elemental damage', from: 60 },
      { t: '#% increased Cold Damage', w: 0.8, as: 'elemental damage', from: 60 },
      { t: '#% increased Lightning Damage', w: 0.8, as: 'elemental damage', from: 60 },
      { m: '1% increased Chaos Damage', w: 0.8, as: 'chaos damage', from: 60 },
      ...addedToSpells,
      { m: 'Minions deal 1% increased Damage', w: 0.9, as: 'minion damage', from: 50 },
      { m: '+1 to maximum Mana', w: 0.1, as: 'mana' },
    ],
  },
  {
    id: 'skillbow', name: 'bows for skills that need gem levels', slots: ['Bow'],
    need: { as: '+ socketed gems', points: 90 },
    stats: [
      { t: '+# total to Level of Socketed Gems', w: 100, as: '+ socketed gems', from: 1 },
      { t: '+# total to Level of Socketed Bow Gems', w: 90, as: '+ socketed gems', from: 1 },
      ...dotMulti(3, 20),
      { m: '1% increased Attack Speed', w: 4, as: 'attack speed' },
    ],
  },
];

// What a total is made of on the item itself, by each modifier's name in the stat list and how
// much of it counts. A total not listed here is made of the modifier of the same name alone.
const ELEMENTAL = {
  '+#% to Fire Resistance': 1, '+#% to Cold Resistance': 1, '+#% to Lightning Resistance': 1,
  '+#% to Fire and Cold Resistances': 2, '+#% to Fire and Lightning Resistances': 2, '+#% to Cold and Lightning Resistances': 2,
  '+#% to all Elemental Resistances': 3,
  '+#% to Fire and Chaos Resistances': 1, '+#% to Cold and Chaos Resistances': 1, '+#% to Lightning and Chaos Resistances': 1,
  '+#% to All Resistances': 3,
};
const both = (a, b) => ({ [`+# to ${a} and ${b}`]: 1 });
const TOTALS = {
  '+# total maximum Life': { '+# to maximum Life': 1, '+# to Strength': 0.5, '+# to all Attributes': 0.5, '+# to Strength and Intelligence': 0.5, '+# to Strength and Dexterity': 0.5 },
  '+#% total Elemental Resistance': ELEMENTAL,
  '+#% total to Chaos Resistance': { '+#% to Chaos Resistance': 1, '+#% to Fire and Chaos Resistances': 1, '+#% to Cold and Chaos Resistances': 1, '+#% to Lightning and Chaos Resistances': 1, '+#% to All Resistances': 1 },
  '+# total to Strength': { '+# to Strength': 1, '+# to all Attributes': 1, ...both('Strength', 'Dexterity'), ...both('Strength', 'Intelligence') },
  '+# total to Dexterity': { '+# to Dexterity': 1, '+# to all Attributes': 1, ...both('Strength', 'Dexterity'), ...both('Dexterity', 'Intelligence') },
  '+# total to Intelligence': { '+# to Intelligence': 1, '+# to all Attributes': 1, ...both('Strength', 'Intelligence'), ...both('Dexterity', 'Intelligence') },
  '+#% Global Critical Strike Multiplier': { '+#% to Global Critical Strike Multiplier': 1 },
  '+#% Global Critical Strike Chance': { '#% increased Global Critical Strike Chance': 1 },
  '+#% total Critical Strike Chance for Spells': { '#% increased Spell Critical Strike Chance': 1, '#% increased Global Critical Strike Chance': 1 },
  '+#% total Attack Speed': { '#% increased Attack Speed': 1, '#% increased Attack and Cast Speed': 1 },
  '+#% total Cast Speed': { '#% increased Cast Speed': 1, '#% increased Attack and Cast Speed': 1 },
  '+# total maximum Energy Shield': { '+# to maximum Energy Shield': 1 },
  '#% total increased maximum Energy Shield': { '#% increased maximum Energy Shield': 1 },
  '+# total to Level of Socketed Gems': { '+# to Level of Socketed Gems': 1 },
  '+# total to Level of Socketed Bow Gems': { '+# to Level of Socketed Bow Gems': 1 },
};

// A strong but ordinary value of what an item is bought for, per kind of item: a profile's
// `prop.points` are given for this much (more for more).
const BENCH = {
  es: { 'Body Armour': 550, Helmet: 280, Gloves: 200, Boots: 200, Shield: 380 },
  dps: { ...Object.fromEntries(ONE_HAND.map((k) => [k, 380])), ...Object.fromEntries(TWO_HAND.map((k) => [k, 560])) },
};

// Below this many points nothing on the item is what buyers search for: no search of its own.
const WORTH_FROM = 110;

module.exports = { PROFILES, TOTALS, BENCH, WORTH_FROM, ARMOUR, JEWELLERY, ONE_HAND, TWO_HAND };
