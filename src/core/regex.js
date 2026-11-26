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
  'Item Class: Maps', 'Rarity: Rare', 'Rarity: Magic', 'Rarity: Normal', 'Map Tier: 16', 'Item Quantity: +85% (augmented)', 'Item Rarity: +40% (augmented)',
  'Monster Pack Size: +25% (augmented)', 'More Currency: +30% (augmented)', 'More Scarabs: +30% (augmented)', 'More Maps: +30% (augmented)',
  'Quality: +20% (augmented)', 'Item Level: 83', 'Unidentified', 'Corrupted', 'Area Level: 83',
  'Travel to this Map by using it in a personal Map Device. Maps can only be used once.',
  'Strand Map', 'Burial Chambers Map', 'Crimson Temple Map', 'Defiled Cathedral Map', 'Cemetery Map', 'Tower Map', 'Dunes Map',
  'Toxic Sewer Map', 'Waste Pool Map', 'City Square Map', 'Jungle Valley Map', 'Mesa Map', 'Glacier Map', 'Promenade Map',
];

// What the map should have: each a line of the map with its number, found by the end of its
// name, the sign (any one character) and the number.
const MAP_WANTS = [
  { id: 'quantity', label: 'Item quantity', tok: 'tity: .' },
  { id: 'rarity', label: 'Item rarity', tok: 'rity: .' },
  { id: 'pack', label: 'Pack size', tok: 'ze: .' },
  { id: 'currency', label: 'More currency', tok: 'ncy: .' },
  { id: 'scarabs', label: 'More scarabs', tok: 'abs: .' },
  { id: 'maps', label: 'More maps', tok: 'aps: .' },
  { id: 'quality', label: 'Quality', tok: 'lity: .' },
];

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

const MAP_DEFAULT = { avoid: [], extra: '', want: {}, wantAny: false, tierMin: 0, tierMax: 0, corrupted: 'any', unidentified: 'any', mode: 'run' };

// The search for maps. mode 'run': lights up the maps to run (none of the avoided mods, the
// wanted numbers); 'skip': lights up the maps with an avoided mod, to sell or reroll them.
// Returns { text, parts: [{ what, text }] } so the page can say what each part does.
function mapSearch(o) {
  o = { ...MAP_DEFAULT, ...(o || {}) };
  const toks = (o.avoid || []).map((id) => MOD_BY_ID.get(id)).filter(Boolean).map((m) => m.tok).concat(extraParts(o.extra));
  const parts = [];
  if (o.mode === 'skip') {
    if (toks.length) parts.push({ what: 'has a mod you avoid', text: `"${toks.join('|')}"` });
    return { text: parts.map((p) => p.text).join(' '), parts };
  }
  if (toks.length) parts.push({ what: 'none of the mods you avoid', text: `"!${toks.join('|')}"` });
  const wants = MAP_WANTS.filter((w) => Number(o.want && o.want[w.id]) > 0).map((w) => ({ w, p: `${w.tok}${atLeast(o.want[w.id])}%` }));
  if (wants.length) {
    if (o.wantAny && wants.length > 1) parts.push({ what: `at least one of: ${wants.map((x) => `${x.w.label.toLowerCase()} ${o.want[x.w.id]}%+`).join(', ')}`, text: `"${wants.map((x) => x.p).join('|')}"` });
    else for (const x of wants) parts.push({ what: `${x.w.label.toLowerCase()} ${o.want[x.w.id]}% or more`, text: `"${x.p}"` });
  }
  const lo = Math.max(1, Math.min(17, Math.floor(o.tierMin) || 1)), hi = Math.max(1, Math.min(17, Math.floor(o.tierMax) || 17));
  if ((o.tierMin || o.tierMax) && (lo > 1 || hi < 17) && lo <= hi) parts.push({ what: lo === hi ? `tier ${lo}` : `tier ${lo} to ${hi}`, text: `"tier: ${tierPattern(lo, hi)}"` });
  if (o.corrupted === 'only') parts.push({ what: 'corrupted', text: 'corrupted' });
  else if (o.corrupted === 'not') parts.push({ what: 'not corrupted', text: '"!corrupted"' });
  if (o.unidentified === 'not') parts.push({ what: 'identified (mods can be read)', text: '"!unidentified"' });
  return { text: parts.map((p) => p.text).join(' '), parts };
}
// Tiers lo..hi (1 to 17) as one pattern. A one-digit tier is followed by something other than a
// digit (the line's end), so tier 1 never finds 16.
function tierPattern(lo, hi) {
  const nums = [];
  for (let t = lo; t <= hi; t++) nums.push(t);
  const one = nums.filter((t) => t < 10), two = nums.filter((t) => t >= 10).map((t) => t - 10);
  const cls = (ds) => (ds.length === 1 ? String(ds[0]) : ds.every((d, i) => !i || d === ds[i - 1] + 1) ? `[${ds[0]}-${ds[ds.length - 1]}]` : `[${ds.join('')}]`);
  const alts = [];
  if (one.length) alts.push(`${cls(one)}\\D`);
  if (two.length) alts.push(`1${cls(two)}`);
  return alts.length === 1 ? alts[0] : `(${alts.join('|')})`;
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
  const want = {};
  for (const w of MAP_WANTS) { const n = num(m.want && m.want[w.id], 999); if (n) want[w.id] = n; }
  return {
    map: {
      avoid: (Array.isArray(m.avoid) ? m.avoid : []).filter((id) => MOD_BY_ID.has(id)),
      extra: String(m.extra || '').slice(0, 200), want, wantAny: !!m.wantAny,
      tierMin: num(m.tierMin, 17), tierMax: num(m.tierMax, 17),
      corrupted: ['any', 'only', 'not'].includes(m.corrupted) ? m.corrupted : 'any',
      unidentified: m.unidentified === 'not' ? 'not' : 'any', mode: m.mode === 'skip' ? 'skip' : 'run',
    },
    vendor: {
      rgb: !!v.rgb, links: LINKS[v.links] ? Number(v.links) : 0, sockets: [5, 6].includes(Number(v.sockets)) ? Number(v.sockets) : 0,
      white: !!v.white, moveMin: v.moveMin === -1 ? -1 : num(v.moveMin, 50), gemLevel: !!v.gemLevel, extra: String(v.extra || '').slice(0, 200),
    },
  };
}

const api = { GAME_LIMIT, atLeast, MAP_MODS, MAP_LINES, MAP_WANTS, RULE_MODS, modsFromRules, mapSearch, tierPattern, vendorSearch, parseSearch, testSearch, problems, cleanBuilders, MAP_DEFAULT, VENDOR_DEFAULT };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PoeRegex = api;
})();
