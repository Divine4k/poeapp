'use strict';
// A player's build for the Jewels page: which passives they took, their class, and any timeless
// jewel they already use. From a Path of Building code (or a pobb.in / pastebin link to one) or
// from a character on pathofexile.com. Pure: the main process does the fetching.
const zlib = require('zlib');
const { readJewelText } = require('./timeless');

const entities = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');
const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w-]*)="([^"]*)"/g)) out[m[1]] = entities(m[2]);
  return out;
};

// Where a pasted text points: a link to fetch first, or the code itself.
function buildSource(text) {
  const t = String(text || '').trim();
  let m = /^(?:https?:\/\/)?(?:www\.)?pobb\.in\/(?:u\/[^/]+\/)?([\w-]+)\/?$/i.exec(t);
  if (m) return { url: `https://pobb.in/${m[1]}/raw` };
  m = /^(?:https?:\/\/)?(?:www\.)?pastebin\.com\/(?:raw\/)?(\w+)\/?$/i.exec(t);
  if (m) return { url: `https://pastebin.com/raw/${m[1]}` };
  if (/^https?:\/\//i.test(t)) return { error: 'Only pobb.in and pastebin links can be read. Copy the build code itself from Path of Building (Import/Export Build, Generate, Copy).' };
  if (/^[A-Za-z0-9_\-+/=\s]{40,}$/.test(t)) return { code: t.replace(/\s+/g, '') };
  return { error: 'That is not a Path of Building code. In Path of Building: Import/Export Build, then Generate and Copy.' };
}

// A Path of Building code is the build's XML, packed with zlib and written as URL-safe base64.
function decodePob(code) {
  const b64 = String(code).trim().replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(b64, 'base64');
  try { return zlib.inflateSync(buf).toString('utf8'); } catch (_) { /* try raw */ }
  try { return zlib.inflateRawSync(buf).toString('utf8'); } catch (_) { throw new Error('That Path of Building code could not be read. Copy it again.'); }
}

// The build from Path of Building's XML.
function readPob(xml, data) {
  if (!/<PathOfBuilding/.test(xml)) throw new Error('That Path of Building code could not be read. Copy it again.');
  const build = attrs((/<Build\b[^>]*>/.exec(xml) || [''])[0]);
  const stats = {};
  for (const m of xml.matchAll(/<PlayerStat\b[^>]*>/g)) { const a = attrs(m[0]); stats[a.stat] = Number(a.value); }
  // The tree in use: Path of Building keeps several; activeSpec says which (counted from 1).
  const treeTag = attrs((/<Tree\b[^>]*>/.exec(xml) || [''])[0]);
  const specs = [...xml.matchAll(/<Spec\b[^>]*>([\s\S]*?)<\/Spec>|<Spec\b[^>]*\/>/g)];
  const spec = specs[(Number(treeTag.activeSpec) || 1) - 1] || specs[0];
  if (!spec) throw new Error('That build has no passive tree.');
  const specAttrs = attrs(/<Spec\b[^>]*>/.exec(spec[0])[0]);
  const nodes = (specAttrs.nodes || '').split(',').map(Number).filter(Boolean);
  const socketItems = {};
  for (const m of (spec[1] || '').matchAll(/<Socket\b[^>]*>/g)) { const a = attrs(m[0]); if (Number(a.itemId)) socketItems[a.nodeId] = a.itemId; }
  const items = {};
  for (const m of xml.matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/g)) items[attrs(m[1]).id] = entities(m[2]);
  // The main skill, only to show which build this is.
  let skill = '';
  const skills = [...xml.matchAll(/<Skill\b([^>]*)>([\s\S]*?)<\/Skill>/g)];
  const main = skills[(Number(build.mainSocketGroup) || 1) - 1];
  if (main) { const gem = /<Gem\b[^>]*nameSpec="([^"]*)"/.exec(main[2]); if (gem) skill = entities(gem[1]); }
  const jewels = [];
  for (const [socket, itemId] of Object.entries(socketItems)) {
    const text = (items[itemId] || '').replace(/\{[^}]*\}/g, '');
    const j = readJewelText(text);
    if (j) jewels.push({ ...j, socket: Number(socket) });
  }
  return summarize(data, {
    source: 'pob', className: build.ascendClassName && build.ascendClassName !== 'None' ? build.ascendClassName : build.className || '',
    level: Number(build.level) || null, skill, nodes, jewels,
    life: stats.Life || null, energyShield: stats.EnergyShield || null, ci: (stats.ChaosInoculation || 0) > 0,
  });
}

// A character from pathofexile.com: get-passive-skills (hashes, items) and its line in get-characters.
function readCharacter(passives, character, data) {
  const nodes = (passives.hashes || []).map(Number).filter(Boolean);
  if (!nodes.length) throw new Error('That character has no passives to read.');
  const slots = data.raw.tree.jewelSlots || [];
  const jewels = [];
  for (const it of passives.items || []) {
    const j = readJewelText([...(it.explicitMods || []), it.name || ''].join('\n'));
    const socket = slots[it.x];
    if (j && socket) jewels.push({ ...j, socket });
  }
  return summarize(data, {
    source: 'character', name: character && character.name, className: (character && (character.class || character.ascendancyClass)) || '',
    level: (character && character.level) || null, league: (character && character.league) || '', skill: '', nodes, jewels,
  });
}

// What the page needs to know about a build: its passives (only those on the main tree), the
// sockets it took, and short facts for its card.
function summarize(data, b) {
  const nodes = b.nodes.filter((id) => data.byId.has(id));
  const taken = new Set(nodes);
  const sockets = data.sockets.filter((s) => taken.has(s.id)).map((s) => s.id);
  const keystones = nodes.filter((id) => data.byId.get(id).kind === 'keystone');
  const ci = b.ci || keystones.some((id) => data.byId.get(id).name === 'Chaos Inoculation');
  return {
    source: b.source, name: b.name || '', className: b.className, level: b.level, league: b.league || '', skill: b.skill || '',
    nodes, sockets, jewels: b.jewels, keystones,
    life: b.life || null, energyShield: b.energyShield || null, ci,
  };
}

module.exports = { buildSource, decodePob, readPob, readCharacter };
