'use strict';
// Plain words for timeless jewels: what each one does, and the one-line verdict on a seed.
// Pure. Keystone effects are not written here; they come from the data (keystone lines).

const BASICS = [
  'A timeless jewel changes the passives around the socket you put it in (a large circle). Only passives you take count.',
  'The number on the jewel decides what the passives turn into. Two jewels with the same number change the passives in the same way.',
  'The name on the jewel (the conqueror) only decides which keystone a keystone in the circle turns into. It does not change anything else.',
  'You can have one timeless jewel. Where you put it matters as much as its number: the same jewel gives different things in every socket.',
];

const GUIDE = {
  vanity: {
    short: 'Rewrites every passive in the circle with random Vaal stats. The most random jewel, and the one with the biggest wins.',
    smalls: 'Become a random small stat (life, damage, resistances…) with a rolled number.',
    notables: 'Become a random Vaal notable, or "Might of the Vaal" / "Legacy of the Vaal" with three or four stats added up.',
    goodFor: 'Builds that want one strong thing near their tree (life, energy shield, a damage type), or the keystone alone.',
  },
  pride: {
    short: 'Keeps your passives and adds a stat to every notable; small passives give Strength.',
    smalls: '+4 Strength each (+2 on Strength, Dexterity and Intelligence passives).',
    notables: 'Keep their stats and get one more, like a chance to deal double damage, life regeneration or armour.',
    goodFor: 'Strength and melee builds. Safe: you never lose what the passives already gave.',
  },
  restraint: {
    short: 'Keeps your passives and adds a stat to every notable; small passives give Dexterity.',
    smalls: '+4 Dexterity each (+2 on Strength, Dexterity and Intelligence passives).',
    notables: 'Keep their stats and get one more, like projectile damage, flask charges or evasion.',
    goodFor: 'Dexterity, bow and projectile builds. Safe: you never lose what the passives already gave.',
  },
  faith: {
    short: 'Gives Devotion everywhere and turns some notables into Templar notables.',
    smalls: '+5 Devotion each; Strength, Dexterity and Intelligence passives become +10 Devotion.',
    notables: 'Either keep their stats and get +5 Devotion, or turn into a Templar notable (maximum resistances, damage conversion, minimum charges and the like). Most of those only work with at least 150 Devotion.',
    goodFor: 'Builds that like Devotion (the jewel itself has a second line that grows with Devotion) and its keystones.',
  },
  hubris: {
    short: 'Small passives give nothing; notables become big Eternal Empire notables.',
    smalls: 'Give nothing at all. You lose what they gave.',
    notables: 'Become one strong notable each (for example 80% increased physical damage).',
    goodFor: 'Builds that take few small passives in the circle and many notables. Check what you lose first.',
  },
  tragedy: {
    short: 'Keeps your passives and adds a stat to every notable; small passives give Ward.',
    smalls: '2% increased Ward each (1% on Strength, Dexterity and Intelligence passives).',
    notables: 'Keep their stats and get one more, mostly about Ward.',
    goodFor: 'Ward builds, and its keystones.',
  },
};

const fill = (tpl, vals) => { let k = 0; return tpl.replace(/#/g, () => { const v = vals[k++]; return v == null ? '?' : String(v); }); };

// The verdict on one seed for what someone wants. r: rank() result; result: describe() result;
// build: the imported build (or null); goals: names of what is wanted; keystoneOf(name): the
// conqueror keystone's lines; wantLines: { tpl -> wanted } to show the gains.
function verdict({ r, result, build, goals, jewelKey }) {
  const notes = [];
  let level = 'none', title = 'Pick what you want to get a verdict';
  if (r) {
    const share = r.count ? r.better / r.count : 1;
    const top = Math.max(1, Math.ceil(share * 100));
    if (r.score <= 0) { level = 'poor'; title = 'Gives nothing you asked for here'; }
    else if (share <= 0.01) { level = 'great'; title = `One of the best: better than ${100 - top}% of seeds here`; }
    else if (share <= 0.1) { level = 'good'; title = `Good: in the top ${top}% of seeds here`; }
    else if (share <= 0.5) { level = 'ok'; title = `About average: in the top ${top}% of seeds here`; }
    else { level = 'poor'; title = `Weak for this: most seeds give more here (top ${top}%)`; }
    const gains = Object.entries(r.totals).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([tpl, v]) => fill(tpl, [v]));
    if (gains.length) notes.push(`Gives ${gains.join(', ')}${goals && goals.length ? ` for ${goals.join(', ').toLowerCase()}` : ''}.`);
    if (r.best && r.best.score > r.score) notes.push(`The best seed here for this is ${r.best.seed}.`);
  }
  if (result && build) {
    const taken = new Set(build.nodes);
    const ks = result.nodes.filter((n) => n.kind === 'keystone' && taken.has(n.id));
    for (const k of ks) notes.push(`Your keystone ${k.was} turns into ${k.name}.`);
    if (jewelKey === 'hubris') {
      const lost = result.nodes.filter((n) => n.kind === 'small' && taken.has(n.id));
      if (lost.length) notes.push(`You lose the stats of ${lost.length} small passive${lost.length === 1 ? '' : 's'} you took: they give nothing under Elegant Hubris.`);
    }
    const inReach = result.nodes.filter((n) => taken.has(n.id)).length;
    if (!inReach) notes.push('You take none of the passives in this circle, so this socket does nothing for you yet.');
  }
  return { level, title, notes };
}

module.exports = { BASICS, GUIDE, verdict };
