'use strict';
// Inscribed Ultimatums in a public stash tab, read from the trade site by account name (no
// login): what each one asks for and gives, what running it is worth, and where it lies in
// the tab. Plain logic: the trade client and the prices are passed in.

const TYPE = 'Inscribed Ultimatum';
const MAX = 100; // the trade site hands out at most 100 results for one search

// Everything of this kind on one account, priced or not, whether the player is online or not.
function accountQuery(account) {
  return {
    query: {
      status: { option: 'any' }, type: TYPE,
      filters: { trade_filters: { filters: { account: { input: String(account || '').trim() }, sale_type: { option: 'any' } } } },
    },
    sort: { price: 'asc' },
  };
}

// The site writes some words as links: "[Life|maximum Life]". Only the words shown.
const plain = (t) => String(t == null ? '' : t).replace(/\[(?:[^\]|]*\|)?([^\]]*)\]/g, '$1');

// A property as the site sends it -> the line the game shows. The name can hold places for
// its values ("Requires Sacrifice: {0} {1}") or just be a label with the values after it.
function propLine(p) {
  const name = plain(p && p.name);
  const values = ((p && p.values) || []).map((v) => plain(Array.isArray(v) ? v[0] : v));
  if (/\{\d+\}/.test(name)) return name.replace(/\{(\d+)\}/g, (_m, i) => values[Number(i)] || '').replace(/\s+/g, ' ').trim();
  return values.length ? `${name}: ${values.join(', ')}` : name;
}

// One result of the trade site -> what the app keeps of an Inscribed Ultimatum.
function readUltimatum(raw) {
  const it = (raw && raw.item) || {}, l = (raw && raw.listing) || {};
  const out = {
    id: String((raw && raw.id) || ''), challenge: '', areaLevel: null,
    sacrifice: null, reward: '', mods: [],
    tab: '', x: null, y: null, listed: null, note: plain(it.note || ''),
  };
  for (const p of it.properties || []) {
    const line = propLine(p);
    let m;
    if ((m = /^Challenge:\s*(.+)$/i.exec(line))) out.challenge = m[1].trim();
    else if ((m = /^Area Level:\s*(\d+)/i.exec(line))) out.areaLevel = Number(m[1]);
    else if ((m = /^Requires Sacrifice:\s*(.+)$/i.exec(line))) {
      const c = /^(.*?)\s*x\s*(\d+)$/i.exec(m[1].trim());
      out.sacrifice = c ? { name: c[1].trim(), count: Number(c[2]) } : { name: m[1].trim(), count: 1 };
    } else if ((m = /^Reward:\s*(.+)$/i.exec(line))) out.reward = m[1].trim();
  }
  // The modifiers of the encounter: the site names them with a tier ("Choking Miasma", 3).
  const roman = ['', '', ' II', ' III', ' IV', ' V'];
  for (const m of it.ultimatumMods || []) {
    const name = plain(typeof m === 'string' ? m : m && (m.type || m.name || m.text));
    if (name) out.mods.push(name + (m && m.tier > 1 ? roman[m.tier] || ` ${m.tier}` : ''));
  }
  const s = l.stash || {};
  out.tab = plain(s.name || '');
  if (Number.isInteger(s.x) && Number.isInteger(s.y)) { out.x = s.x; out.y = s.y; }
  if (l.price && isFinite(Number(l.price.amount))) out.listed = { amount: Number(l.price.amount), currency: String(l.price.currency || '') };
  return out;
}

// What running it is worth, in chaos, by poe.ninja's prices (chaosOf: name -> chaos, 0 when
// it has no price). kind: 'double' (the sacrifice comes back twice: what you gain is what you
// put in), 'item' (a named reward for a named sacrifice: reward less sacrifice), 'unknown'.
function valueOf(u, chaosOf) {
  const sac = u.sacrifice, each = sac ? chaosOf(sac.name) : 0, cost = sac && each > 0 ? each * sac.count : null;
  if (/^Doubles sacrificed/i.test(u.reward)) {
    if (cost === null) return { kind: 'double', chaos: null, cost: null, why: sac ? `No price for ${sac.name}.` : 'It does not say what it asks for.' };
    return { kind: 'double', chaos: cost, cost, why: `You put in ${sac.count} × ${sac.name} and get twice that back.` };
  }
  const prize = u.reward ? chaosOf(u.reward) : 0;
  if (prize > 0) {
    if (sac && cost === null) return { kind: 'item', chaos: null, prize, cost: null, why: `${u.reward} is worth this much, but there is no price for ${sac.name}.` };
    return { kind: 'item', chaos: prize - (cost || 0), prize, cost: cost || 0, why: `${u.reward} less what you put in.` };
  }
  return { kind: 'unknown', chaos: null, cost, why: u.reward ? `No price for "${u.reward}".` : 'It does not say what it gives.' };
}

// What to type in the stash's search box so the game lights this one up (and any twin of it:
// same sacrifice, level and challenge, so worth the same). Words in quotes must all be there.
function searchFor(u) {
  const q = (t) => `"${String(t).replace(/"/g, '').trim()}"`;
  const parts = [];
  if (u.sacrifice && u.sacrifice.name) parts.push(q(u.sacrifice.count > 1 ? `${u.sacrifice.name} x${u.sacrifice.count}` : u.sacrifice.name));
  if (u.reward && !/^Doubles sacrificed/i.test(u.reward)) parts.push(q(u.reward));
  if (u.areaLevel) parts.push(q(`Level: ${u.areaLevel}`));
  if (u.challenge) parts.push(q(u.challenge));
  return parts.join(' ');
}

// Dearest first; those without a value last, in the order they lie in the tab.
function sortByWorth(list) {
  const v = (u) => (u.value && u.value.chaos !== null ? u.value.chaos : -Infinity);
  return list.slice().sort((a, b) => v(b) - v(a) || a.tab.localeCompare(b.tab) || (a.x - b.x) || (a.y - b.y));
}

// The tabs they lie in, each as the grid it is in game. kind 'grid': a normal tab, 12 cells a
// side, or 24 for a quad tab (known only from an item lying beyond the twelfth cell). kind
// 'slots': a tab made for one thing (the Ultimatum tab), where the site numbers the slots in
// one line (every y is 0); they are drawn twelve to a row, as the game shows them, at least
// five rows. cells: "column,row" -> the item there. shape: the positions as the site gave
// them, for finding out why a tab is drawn wrong.
function tabsOf(list) {
  const tabs = new Map();
  for (const u of list) {
    if (u.x === null) continue;
    let t = tabs.get(u.tab);
    if (!t) tabs.set(u.tab, t = { name: u.tab, at: [], count: 0 });
    t.at.push(u);
    t.count += 1;
  }
  const out = [];
  for (const t of tabs.values()) {
    const xs = t.at.map((u) => u.x), ys = t.at.map((u) => u.y);
    const maxX = Math.max(...xs), maxY = Math.max(...ys);
    const slots = maxY === 0 && maxX >= 12;
    const side = maxX >= 12 || maxY >= 12 ? 24 : 12;
    const tab = { name: t.name, kind: slots ? 'slots' : 'grid', cols: slots ? 12 : side, rows: slots ? Math.max(5, Math.ceil((maxX + 1) / 12)) : side, cells: {}, count: t.count, shape: `x ${Math.min(...xs)}-${maxX}, y ${Math.min(...ys)}-${maxY}` };
    for (const u of t.at) tab.cells[slots ? `${u.x % 12},${Math.floor(u.x / 12)}` : `${u.x},${u.y}`] = u.id;
    out.push(tab);
  }
  return out.sort((a, b) => b.count - a.count);
}

// Reads every Inscribed Ultimatum of an account: one search, then ten results at a time,
// waiting as long as the site asks between them. onPart(done, total) after each part.
// Other searches (a price check) can go in between: the client is only held per request.
async function scan({ client, league, account, sleep, onPart = () => {}, max = MAX }) {
  const name = String(account || '').trim();
  if (!name) throw new Error('Type your account name first, as the trade site shows it (Name#1234).');
  if (!league) throw new Error('Choose a league in Settings first.');
  const free = async (kind) => {
    for (let i = 0; i < 600; i++) {
      const wait = client.busy ? 100 : client.waitMs(kind);
      if (!wait) return;
      await sleep(Math.min(wait, 5000) + 20);
    }
    throw new Error('The trade site kept the app waiting too long. Try again in a minute.');
  };
  await free('search');
  const found = await client.search(league, accountQuery(name));
  const ids = found.ids.slice(0, max), items = [];
  onPart(0, ids.length);
  for (let i = 0; i < ids.length; i += 10) {
    await free('fetch');
    const part = await client.fetchItems(ids.slice(i, i + 10), found.queryId);
    for (const raw of part) items.push(readUltimatum(raw));
    onPart(items.length, ids.length);
  }
  return { account: name, league, total: found.total, items };
}

module.exports = { TYPE, MAX, accountQuery, propLine, readUltimatum, valueOf, searchFor, sortByWorth, tabsOf, scan };
