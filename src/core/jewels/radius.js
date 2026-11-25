'use strict';
// Unique jewels that work on the passives in their reach, and cluster jewels. Pure.
const { inRadius, RADIUS, RINGS } = require('./data');
const { compileLine } = require('./timeless');

const RADIUS_JEWELS = [
  { key: 'thread', name: 'Thread of Hope', pick: 'ring', text: 'Passives in the ring can be allocated without being connected to your tree.' },
  { key: 'escape', name: 'Impossible Escape', pick: 'keystone', radius: 'small', text: 'Passives near the chosen keystone can be allocated without being connected to your tree.' },
  { key: 'leap', name: 'Intuitive Leap', radius: 'small', text: 'Passives in reach can be allocated without being connected to your tree.' },
  { key: 'instinct', name: 'Unnatural Instinct', radius: 'small', text: 'Small passives you have not taken give their stats; small passives you take give nothing.' },
  { key: 'meek', name: 'Might of the Meek', radius: 'large', text: 'Small passives you take are 50% stronger; notables give nothing.' },
];
const RING_NAMES = { small: 'Small ring', medium: 'Medium ring', large: 'Large ring', veryLarge: 'Very large ring', massive: 'Massive ring' };

// Which passives a radius jewel reaches. pick: { socket, ring, keystone }.
function reach(data, { jewel: key, socket, ring, keystone }) {
  const jewel = RADIUS_JEWELS.find((j) => j.key === key);
  if (!jewel) throw new Error('Unknown jewel');
  let center, outer, inner = 0;
  if (jewel.pick === 'keystone') {
    center = data.byId.get(keystone);
    if (!center || center.kind !== 'keystone') throw new Error('Pick a keystone.');
    outer = RADIUS[jewel.radius];
  } else {
    center = data.byId.get(socket);
    if (!center || center.kind !== 'socket') throw new Error('Pick a jewel socket.');
    if (jewel.pick === 'ring') {
      const r = RINGS[ring];
      if (!r) throw new Error('Pick a ring size.');
      [inner, outer] = r;
    } else outer = RADIUS[jewel.radius];
  }
  const nodes = inRadius(data, center, outer, inner).map((n) => ({ id: n.id, kind: n.kind, name: n.name, x: n.x, y: n.y, stats: n.stats || [] }));
  return { jewel: key, center: { id: center.id, x: center.x, y: center.y }, inner, outer, nodes };
}

const parts = (lines, factor = 1) => lines.map((l) => compileLine(l, [])).map((c) => ({
  tpl: c.tpl,
  vals: c.slots.map((s) => (s.fixed === undefined ? null : Math.round(s.fixed * factor * 100) / 100)),
}));

// What the jewel gives with the passives you have taken (ids), as parts to add up
// (timeless.totals). Only Unnatural Instinct and Might of the Meek change numbers.
function radiusGain(result, taken) {
  const has = new Set(taken || []);
  const smalls = result.nodes.filter((n) => n.kind === 'small');
  if (result.jewel === 'instinct') return smalls.filter((n) => !has.has(n.id)).map((n) => ({ id: n.id, parts: parts(n.stats) }));
  if (result.jewel === 'meek') return smalls.filter((n) => has.has(n.id)).map((n) => ({ id: n.id, parts: parts(n.stats, 1.5) }));
  return [];
}

// ---- cluster jewels ----
function clusterBases(data) {
  return data.cluster.jewels.map((j) => ({ base: j.base, size: j.size, skills: j.skills.map((s) => ({ key: s.key, name: s.name, enchant: s.enchant })) }));
}

// The notables a cluster jewel with this enchant can roll, with the chance of each among them.
// Prefix and suffix notables roll separately, so chances are worked out within each group.
function clusterNotables(data, base, skillKey) {
  const jewel = data.cluster.jewels.find((j) => j.base === base);
  const skill = jewel && jewel.skills.find((s) => s.key === skillKey);
  if (!skill) throw new Error('Pick a cluster jewel and its enchant.');
  const size = jewel.size.toLowerCase();
  const list = data.cluster.notables
    .filter((n) => n.sizes.includes(size) && n.weights[skill.tag] > 0)
    .map((n) => ({ name: n.name, prefix: n.prefix, level: n.level, weight: n.weights[skill.tag], stats: n.stats }));
  for (const side of [true, false]) {
    const group = list.filter((n) => n.prefix === side);
    const sum = group.reduce((s, n) => s + n.weight, 0);
    for (const n of group) n.chance = sum ? Math.round((n.weight / sum) * 1000) / 10 : 0;
  }
  return { base, size: jewel.size, enchant: skill.enchant, smalls: skill.stats, notables: list.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)) };
}

module.exports = { RADIUS_JEWELS, RING_NAMES, reach, radiusGain, clusterBases, clusterNotables };
