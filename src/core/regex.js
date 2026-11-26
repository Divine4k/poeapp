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
// tests to prove each piece finds its mod and nothing else. Tokens are written lower case: the
// game's search ignores case.
const MAP_MODS = [
  // What makes a build unable to run the map
  { id: 'reflect-phys', group: 'Players', label: 'Physical reflect', tok: 'f phys', text: 'Monsters reflect 18% of Physical Damage' },
  { id: 'reflect-ele', group: 'Players', label: 'Elemental reflect', tok: 'f elem', text: 'Monsters reflect 18% of Elemental Damage' },
  { id: 'no-regen', group: 'Players', label: 'No regeneration', tok: 'regen', text: 'Players cannot Regenerate Life, Mana or Energy Shield' },
  { id: 'no-leech', group: 'Players', label: 'Cannot leech', tok: 'ot lee', text: 'Cannot Leech Life from Monsters' },
  { id: 'leech-rate', group: 'Players', label: 'Less leech per second', tok: 'm total', text: 'Players have 60% reduced Maximum total Life, Mana and Energy Shield Recovery per second from Leech' },
  { id: 'less-recovery', group: 'Players', label: 'Less recovery rate', tok: 'ss rec', text: 'Players have 60% less Recovery Rate of Life and Energy Shield' },
  { id: 'cooldown', group: 'Players', label: 'Less cooldown recovery', tok: 'cool', text: 'Players have 40% less Cooldown Recovery Rate' },
  { id: 'max-res', group: 'Players', label: 'Lower maximum resistances', tok: 'm res', text: 'Players have -12% to all maximum Resistances' },
  { id: 'curse-vuln', group: 'Players', label: 'Cursed: Vulnerability', tok: 'vuln', text: 'Players are Cursed with Vulnerability' },
  { id: 'curse-tc', group: 'Players', label: 'Cursed: Temporal Chains', tok: 'poral', text: 'Players are Cursed with Temporal Chains' },
  { id: 'curse-ew', group: 'Players', label: 'Cursed: Elemental Weakness', tok: 'weak', text: 'Players are Cursed with Elemental Weakness' },
  { id: 'curse-enf', group: 'Players', label: 'Cursed: Enfeeble', tok: 'enfe', text: 'Players are Cursed with Enfeeble' },
  { id: 'less-armour', group: 'Players', label: 'Less armour', tok: 'ss arm', text: 'Players have 40% less Armour' },
  { id: 'less-block', group: 'Players', label: 'Less block chance', tok: 'd cha', text: 'Players have 40% reduced Chance to Block' },
  { id: 'less-accuracy', group: 'Players', label: 'Less accuracy', tok: 'ss acc', text: 'Players have 25% less Accuracy Rating' },
  { id: 'less-aoe', group: 'Players', label: 'Less area of effect', tok: 'ss area', text: 'Players have 25% less Area of Effect' },
  { id: 'auras', group: 'Players', label: 'Weaker auras', tok: 'non-c', text: 'Players have 60% reduced effect of Non-Curse Auras from Skills' },
  { id: 'flask', group: 'Players', label: 'Fewer flask charges', tok: 'sk ch', text: 'Players gain 50% reduced Flask Charges' },
  { id: 'buffs', group: 'Players', label: 'Buffs expire faster', tok: 'expi', text: 'Buffs on Players expire 100% faster' },
  // Monsters
  { id: 'steal-charges', group: 'Monsters', label: 'Steal charges', tok: 'steal', text: 'Monsters steal Power, Frenzy and Endurance charges on Hit' },
  { id: 'avoid-ailments', group: 'Monsters', label: 'Avoid elemental ailments', tok: 'oid ele', text: 'Monsters have 70% chance to Avoid Elemental Ailments' },
  { id: 'avoid-poison', group: 'Monsters', label: 'Avoid poison, impale, bleeding', tok: 'oid poi', text: 'Monsters have 50% chance to avoid Poison, Impale, and Bleeding' },
  { id: 'no-stun', group: 'Monsters', label: 'Cannot be stunned', tok: 'stunn', text: 'Monsters cannot be Stunned' },
  { id: 'action-speed', group: 'Monsters', label: 'Cannot be slowed', tok: 'ction sp', text: "Monsters' Action Speed cannot be modified to below Base Value" },
  { id: 'move-floor', group: 'Monsters', label: 'Movement cannot be slowed', tok: 'nt speed can', text: "Monsters' Movement Speed cannot be modified to below Base Value" },
  { id: 'hexproof', group: 'Monsters', label: 'Hexproof', tok: 'hexp', text: 'Monsters are Hexproof' },
  { id: 'crit-chance', group: 'Monsters', label: 'More critical strikes', tok: 'ike ch', text: 'Monsters have 300% increased Critical Strike Chance' },
  { id: 'crit-multi', group: 'Monsters', label: 'Critical multiplier', tok: 'multi', text: '+40% to Monster Critical Strike Multiplier' },
  { id: 'crit-taken', group: 'Monsters', label: 'Take less from critical strikes', tok: 'a damage f', text: 'Monsters take 35% reduced Extra Damage from Critical Strikes' },
  { id: 'extra-fire', group: 'Monsters', label: 'Extra fire damage', tok: 'e as f', text: 'Monsters deal 90% extra Physical Damage as Fire' },
  { id: 'extra-cold', group: 'Monsters', label: 'Extra cold damage', tok: 'e as c', text: 'Monsters deal 90% extra Physical Damage as Cold' },
  { id: 'extra-light', group: 'Monsters', label: 'Extra lightning damage', tok: 'e as l', text: 'Monsters deal 90% extra Physical Damage as Lightning' },
  { id: 'extra-chaos', group: 'Monsters', label: 'Extra chaos damage', tok: 'ra chaos', text: 'Monsters gain 25% of their Physical Damage as Extra Chaos Damage' },
  { id: 'more-damage', group: 'Monsters', label: 'More damage', tok: 'deal \\d+% inc', text: 'Monsters deal 40% increased Damage' },
  { id: 'projectiles', group: 'Monsters', label: 'Extra projectiles', tok: 'proj', text: 'Monsters fire 2 additional Projectiles' },
  { id: 'chain', group: 'Monsters', label: 'Skills chain', tok: 's chain', text: "Monsters' skills Chain 2 additional times" },
  { id: 'monster-aoe', group: 'Monsters', label: 'Bigger area of effect', tok: 'd area', text: 'Monsters have 100% increased Area of Effect' },
  { id: 'monster-life', group: 'Monsters', label: 'More life', tok: 're life', text: 'Monsters have 30% more Life' },
  { id: 'monster-es', group: 'Monsters', label: 'Extra energy shield', tok: 'extra max', text: 'Monsters gain 40% of Maximum Life as Extra Maximum Energy Shield' },
  { id: 'monster-block', group: 'Monsters', label: 'Block attacks', tok: 'ck att', text: 'Monsters have +40% Chance to Block Attack Damage' },
  { id: 'suppress', group: 'Monsters', label: 'Suppress spells', tok: 'suppr', text: 'Monsters have +50% chance to Suppress Spell Damage' },
  { id: 'phys-reduction', group: 'Monsters', label: 'Physical damage reduction', tok: 'uction', text: '+40% Monster Physical Damage Reduction' },
  { id: 'ele-res', group: 'Monsters', label: 'Elemental resistances', tok: 'ster ele', text: '+40% Monster Elemental Resistances' },
  { id: 'chaos-res', group: 'Monsters', label: 'Chaos resistance', tok: 'ster cha', text: '+25% Monster Chaos Resistance' },
  { id: 'frenzy', group: 'Monsters', label: 'Gain frenzy charges', tok: 'a fren', text: 'Monsters have 20% chance to gain a Frenzy Charge on Hit' },
  { id: 'power', group: 'Monsters', label: 'Gain power charges', tok: 'a pow', text: 'Monsters have 20% chance to gain a Power Charge on Hit' },
  { id: 'endurance', group: 'Monsters', label: 'Gain endurance charges', tok: 'an end', text: 'Monsters have 20% chance to gain an Endurance Charge on Hit' },
  { id: 'impale', group: 'Monsters', label: 'Impale', tok: 'ale w', text: 'Monsters have 60% chance to Impale with Attacks' },
  { id: 'blind', group: 'Monsters', label: 'Blind', tok: 'blind', text: 'Monsters Blind on Hit' },
  { id: 'maim', group: 'Monsters', label: 'Maim', tok: 'maim', text: 'Monsters Maim on Hit with Attacks' },
  { id: 'wither', group: 'Monsters', label: 'Wither', tok: 'wither', text: 'Monsters inflict Withered for 2 seconds on Hit' },
  { id: 'poison', group: 'Monsters', label: 'Poison', tok: 'ison on', text: 'Monsters Poison on Hit' },
  { id: 'move-speed', group: 'Monsters', label: 'Faster monsters', tok: 'd move', text: 'Monsters have 30% increased Movement Speed' },
  { id: 'more-mods', group: 'Monsters', label: 'Rares with extra mods', tok: 'l modi', text: 'Rare Monsters each have 2 additional Modifiers' },
  { id: 'boss', group: 'Monsters', label: 'Stronger map boss', tok: 'boss', text: 'Unique Boss deals 25% increased Damage' },
  // The area
  { id: 'burning', group: 'Area', label: 'Burning ground', tok: 'burn', text: 'Area has patches of Burning Ground' },
  { id: 'chilled', group: 'Area', label: 'Chilled ground', tok: 'chil', text: 'Area has patches of Chilled Ground' },
  { id: 'shocked', group: 'Area', label: 'Shocked ground', tok: 'shocked g', text: 'Area has patches of Shocked Ground' },
  { id: 'desecrated', group: 'Area', label: 'Desecrated ground', tok: 'desec', text: 'Area has patches of desecrated ground' },
  { id: 'consecrated', group: 'Area', label: 'Consecrated ground', tok: 'consec', text: 'Area has patches of Consecrated Ground' },
  { id: 'totems', group: 'Area', label: 'Many totems', tok: 'totem', text: 'Area contains many Totems' },
  { id: 'rogues', group: 'Area', label: 'Rogue exiles', tok: 'rogue', text: 'Area is inhabited by 2 additional Rogue Exiles' },
];
const MOD_BY_ID = new Map(MAP_MODS.map((m) => [m.id, m]));

// Lines every map shows besides its mods; no mod's piece may find them. Used by the tests.
const MAP_LINES = [
  'Item Class: Maps', 'Rarity: Rare', 'Rarity: Magic', 'Rarity: Normal', 'Map Tier: 16', 'Item Level: 83', 'Area Level: 83',
  'Unidentified', 'Corrupted', 'Travel to this Map by using it in a personal Map Device. Maps can only be used once.',
  'Strand Map', 'Burial Chambers Map', 'Crimson Temple Map', 'Defiled Cathedral Map', 'Cemetery Map', 'Tower Map', 'Dunes Map',
  'Toxic Sewer Map', 'Waste Pool Map', 'City Square Map', 'Jungle Valley Map', 'Mesa Map', 'Glacier Map', 'Promenade Map',
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
  'reflect-phys': ['reflect-phys'], 'reflect-ele': ['reflect-ele'], 'no-regen': ['no-regen'], 'no-leech': ['no-leech'],
  'less-recovery': ['less-recovery'], 'max-res': ['max-res'], curses: ['curse-vuln', 'curse-tc', 'curse-ew', 'curse-enf'],
  'avoid-ailments': ['avoid-ailments'], 'avoid-poison-bleed': ['avoid-poison'], 'less-defence': ['less-armour', 'less-block'],
  'less-accuracy': ['less-accuracy'], 'less-aoe': ['less-aoe'], 'aura-effect': ['auras'], 'flask-charges': ['flask'],
  'steal-charges': ['steal-charges'], 'no-slow': ['no-stun', 'action-speed'],
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
