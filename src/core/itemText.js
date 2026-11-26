'use strict';
// Parses the text Path of Exile puts on the clipboard when you press Ctrl+C over an item.

function parseItemText(text) {
  if (typeof text !== 'string' || !/^Item Class: /m.test(text)) return null;
  const sections = text.replace(/\r/g, '').trim().split(/\n-{4,}\n/).map((s) => s.split('\n').map((l) => l.trim()).filter(Boolean));
  const head = sections[0] || [];
  const item = { itemClass: '', rarity: '', name: '', baseType: '', stackSize: 1, isMap: false, mods: [] };
  const titles = [];
  for (const line of head) {
    let m;
    if ((m = /^Item Class: (.+)$/.exec(line))) item.itemClass = m[1];
    else if ((m = /^Rarity: (.+)$/.exec(line))) item.rarity = m[1];
    else titles.push(line);
  }
  if (titles.length >= 2) { item.name = titles[0]; item.baseType = titles[1]; }
  else { item.name = titles[0] || ''; item.baseType = titles[0] || ''; }

  const num = (re) => { const m = re.exec(text); return m ? parseInt(m[1].replace(/[,.]/g, ''), 10) : null; };
  const stack = /^Stack Size: ([\d,.]+)\//m.exec(text);
  if (stack) item.stackSize = parseInt(stack[1].replace(/[,.]/g, ''), 10) || 1;
  item.stackable = !!stack;

  item.isMap = /^Map Tier: /m.test(text) || /Maps?$/.test(item.itemClass);
  if (item.isMap) {
    item.mapTier = num(/^Map Tier: (\d+)/m);
    item.quantity = num(/^Item Quantity: \+(\d+)%/m);
    item.rarityBonus = num(/^Item Rarity: \+(\d+)%/m);
    item.packSize = num(/^Monster Pack Size: \+(\d+)%/m);
    // Mods sit in the sections after "Item Level", before the usage hint.
    const start = sections.findIndex((s) => s.some((l) => /^Item Level: /.test(l)));
    for (let i = start + 1; i < sections.length && start >= 0; i++) {
      const s = sections[i];
      if (s.some((l) => /^Travel to this Map/i.test(l))) break;
      for (const l of s) {
        if (/^(Corrupted|Unidentified|Mirrored|Split|Note: )/.test(l) || MOD_HEADER.test(l) || /^\(.*\)$/.test(l)) continue;
        item.mods.push(plainStat(l).replace(/ \((implicit|enchant|fractured|crafted)\)$/, ''));
      }
    }
  }
  item.corrupted = /^Corrupted$/m.test(text);
  item.unidentified = /^Unidentified$/m.test(text);
  if (!item.isMap) readGear(item, text, sections);
  item.isGem = /Gems$/.test(item.itemClass);
  if (item.isGem) readGem(item, text, sections);
  return item;
}

// A skill or support gem: its level and, for a Vaal gem, its real name. The game heads a Vaal
// gem with the plain skill's name ("Grace") and names the Vaal one on a line of its own further
// down ("Vaal Grace"); the trade site and poe.ninja know it by that second name. The level is
// the first "Level:" line: the one under "Requirements:" comes later.
function readGem(item, text, sections) {
  const level = /^Level: (\d+)( \(Max\))?/m.exec(text);
  item.gemLevel = level ? parseInt(level[1], 10) : 1;
  item.gemMax = !!(level && level[2]);
  const vaal = sections.slice(1).find((s) => s.length === 1 && /^Vaal [A-Z][A-Za-z' -]+$/.test(s[0]));
  if (vaal) { item.name = vaal[0]; item.baseType = vaal[0]; }
}

// What a line after a modifier says about where it came from: "(implicit)", "(crafted)"...
const MOD_KIND = / \((implicit|enchant|fractured|crafted|scourge|crucible)\)$/;
const INFLUENCE = /^(Shaper|Elder|Crusader|Redeemer|Hunter|Warlord) Item$/;
const NOT_A_MOD = /^(Corrupted|Unidentified|Mirrored|Split|Synthesised Item|Fractured Item|Searing Exarch Item|Eater of Worlds Item|Unmodifiable|Note: .*)$/;
// The game's own hints at the end of an item's text.
const HINT = /^(Right click |Place into |Shift click |Can be |Travel to |Use Intelligence |This is a Support Gem|Take this item |Give this |Relics can )/;

// The game has a fuller item text (Ctrl+Alt+C, or always with some settings). It puts a line
// in curly brackets above each modifier, saying what kind it is, and writes each number with
// the range it could have rolled: "+62(50-75)% to Fire Resistance". Both texts are read.
const MOD_HEADER = /^\{.*\}$/;
const ROLL_RANGE = /((?<![\d)])[+-]?\d+(?:\.\d+)?)\(([^()]*)\)/g;
// How far a line's numbers could have rolled apart: 10 for "+17(10-20) to Strength", 0 when
// the modifier always has the same value. Several numbers on a line count by their average.
function spanOf(line) {
  let total = 0, n = 0;
  for (const m of line.matchAll(ROLL_RANGE)) {
    const r = /^(-?[\d.]+)-(-?[\d.]+)$/.exec(m[2]);
    if (r) { total += Math.abs(Number(r[2]) - Number(r[1])); n += 1; }
  }
  return n ? total / n : 0;
}
// A modifier line as the short text would have it: without ranges and remarks.
const plainStat = (line) => line.replace(/ — Unscalable Value$/, '').replace(ROLL_RANGE, '$1');
// What a line in curly brackets says about the modifiers under it:
// { Prefix Modifier "Rotund" (Tier: 3) — Life }
function headerKind(line) {
  const tier = /\(Tier: (\d+)\)/.exec(line);
  const name = /^\{ ([^"(—]*?)\s*(?:"([^"]*)")?\s*(?:\(|—|\})/.exec(line);
  const what = name ? name[1] : '';
  const h = { type: 'explicit', tier: tier ? Number(tier[1]) : null, name: name && name[2] ? name[2] : '', affix: /Prefix/.test(what) ? 'prefix' : (/Suffix/.test(what) ? 'suffix' : '') };
  if (/Implicit Modifier/.test(what)) { h.type = 'implicit'; h.corruption = /Corruption/.test(what); }
  else if (/Fractured/.test(what)) h.type = 'fractured';
  else if (/Crafted/.test(what)) h.type = 'crafted';
  return h;
}

// Everything a trade search needs from an item that is not a map: its level, sockets,
// influences and every modifier line with its kind. Lines the game adds as explanation, in
// brackets, and its usage hints are left out. Flavour text is kept: it matches no stat later.
function readGear(item, text, sections) {
  const num = (re) => { const m = re.exec(text); return m ? parseInt(m[1], 10) : null; };
  item.itemLevel = num(/^Item Level: (\d+)/m);
  item.quality = num(/^Quality: \+(\d+)%/m);
  // Catalysts on jewellery: "Quality (Attribute Modifiers): +20% (augmented)"
  const cat = /^Quality \(([^)]+)\): \+(\d+)%/m.exec(text);
  item.catalyst = cat ? { kind: cat[1].replace(/ Modifiers$/, ''), value: parseInt(cat[2], 10) } : null;
  item.mirrored = /^Mirrored$/m.test(text);
  item.influences = [];
  const sockets = /^Sockets: (.+)$/m.exec(text);
  item.links = sockets ? Math.max(...sockets[1].trim().split(' ').map((g) => g.split('-').length)) : 0;
  item.sockets = sockets ? sockets[1].trim() : ''; // "R-R-G B": colours, linked by -, groups apart by a space
  // What the game works out for a weapon or a piece of armour, as shown at the top of its text.
  const dec = (re) => { const m = re.exec(text); return m ? parseFloat(m[1]) : null; };
  const avg = (re) => { // "Elemental Damage: 12-210 (augmented), 5-9": the average hit, all parts together
    const m = re.exec(text);
    if (!m) return 0;
    return [...m[1].matchAll(/(\d+)-(\d+)/g)].reduce((sum, r) => sum + (Number(r[1]) + Number(r[2])) / 2, 0);
  };
  const aps = dec(/^Attacks per Second: ([\d.]+)/m);
  item.props = {
    pdps: aps ? avg(/^Physical Damage: (.+)$/m) * aps : 0,
    edps: aps ? avg(/^Elemental Damage: (.+)$/m) * aps : 0,
    armour: num(/^Armour: (\d+)/m) || 0,
    evasion: num(/^Evasion Rating: (\d+)/m) || 0,
    energyShield: num(/^Energy Shield: (\d+)/m) || 0,
    ward: num(/^Ward: (\d+)/m) || 0,
  };
  item.modLines = [];
  item.affixes = []; // the names of its prefixes and suffixes, when the fuller text gives them
  // How many prefixes and suffixes it has, and whether one is from the crafting bench. Only known
  // from the fuller text (known: false otherwise).
  item.slots = { prefix: 0, suffix: 0, crafted: false, known: false };
  const start = sections.findIndex((s) => s.some((l) => /^Item Level: /.test(l)));
  for (let i = start + 1; i < sections.length && start >= 0; i++) {
    let explaining = false;
    let header = null, group = 0;
    for (const raw of sections[i]) {
      if (!explaining && raw.startsWith('(')) explaining = true;
      if (explaining) { if (raw.endsWith(')')) explaining = false; continue; }
      if (MOD_HEADER.test(raw)) {
        header = headerKind(raw); group += 1;
        item.slots.known = true;
        if (header.affix) item.slots[header.affix] += 1;
        if (header.type === 'crafted') item.slots.crafted = true;
        if (header.affix && header.name) item.affixes.push({ affix: header.affix, name: header.name });
        continue;
      }
      const inf = INFLUENCE.exec(raw);
      if (inf) { item.influences.push(inf[1]); continue; }
      if (NOT_A_MOD.test(raw) || HINT.test(raw)) continue;
      const l = plainStat(raw);
      const kind = MOD_KIND.exec(l);
      const line = { text: l.replace(MOD_KIND, ''), type: kind ? kind[1] : (header ? header.type : 'explicit'), section: i };
      // Lines under one header belong to one modifier and are never joined with the next one's.
      if (header) {
        line.group = group; line.span = spanOf(raw);
        if (header.corruption) line.corruption = true;
        if (header.tier) line.tier = header.tier;
        if (/ — Unscalable Value$/.test(raw)) line.unscalable = true;
      }
      item.modLines.push(line);
    }
  }
  // Implicits a corruption added (the fuller item text names them): each adds to its dust.
  item.corruptionImplicits = new Set(item.modLines.filter((l) => l.corruption).map((l) => l.group)).size;
  // A magic item's name is its base type between its affixes' names ("Chemist's Quicksilver
  // Flask of the Cheetah"). With those names known, the base type is what is left.
  if (item.rarity === 'Magic' && item.modLines.some((l) => l.group)) {
    let base = item.name;
    for (const a of item.affixes) {
      if (a.affix === 'prefix' && base.startsWith(`${a.name} `)) base = base.slice(a.name.length + 1);
      if (a.affix === 'suffix' && base.endsWith(` ${a.name}`)) base = base.slice(0, -a.name.length - 1);
    }
    item.magicBase = base;
  }
}

// The name to price an item by: unique name for uniques, otherwise the base type.
function priceName(item) {
  if (!item) return '';
  return item.rarity === 'Unique' ? item.name : (item.baseType || item.name);
}

module.exports = { parseItemText, priceName };
