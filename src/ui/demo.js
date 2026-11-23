'use strict';
// Preview data. Only used when index.html is opened in a normal browser (no Electron bridge),
// so the layout can be looked at without the game running.
(() => {
  if (window.api) return;
  const now = Date.now();
  const dot = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="${c}"/></svg>`)}`;
  const price = { 'Divine Orb': 212, 'Chaos Orb': 1, 'Exalted Orb': 14, 'Ambush Scarab of Containment': 9, 'The Nurse': 78, 'Vaal Orb': 0.6, 'Orb of Fusing': 0.3 };
  const loot = (id, name, qty, source) => ({ id, name, qty, source, batch: 'b1', ts: now, chaos: price[name] * qty });
  const run = (id, name, min, lootValue, costValue, deaths, live) => ({
    id, name, level: 83, startedAt: now - min * 60000, endedAt: live ? null : now, activeMs: min * 60000,
    segmentStart: live ? now : null, durationMs: min * 60000, deaths, lootValue, costValue, net: lootValue - costValue,
    items: [{ name: 'Chaos Orb', qty: 9, chaos: 9 }], loot: [], seen: [],
    costs: [{ id: 'c1', name: 'Ambush Scarab of Containment', qty: 2, each: 9, total: 18, chaos: null }],
  });
  const cur = run('r4', 'Strand', 3.2, 0, 22, 0, true);
  cur.loot = [loot('l1', 'Chaos Orb', 7, 'inventory'), loot('l2', 'Vaal Orb', 3, 'inventory'), loot('l3', 'The Nurse', 1, 'manual'), loot('l4', 'Divine Orb', 1, 'inventory'), loot('l5', 'Exalted Orb', 2, 'inventory')];
  cur.lootValue = cur.loot.reduce((a, l) => a + l.chaos, 0); cur.net = cur.lootValue - cur.costValue;
  const runs = [run('r1', 'Jungle Valley', 4.1, 96, 22, 0), run('r2', 'Strand', 3.6, 14, 22, 1), run('r3', 'Dunes', 5.0, 431, 22, 0), cur];
  const totals = { maps: 4, deaths: 1, lootValue: 0, costValue: 0, net: 0, mapMs: 0 };
  for (const r of runs) { totals.lootValue += r.lootValue; totals.costValue += r.costValue; totals.net += r.net; totals.mapMs += r.durationMs; }
  totals.avgMapMs = totals.mapMs / 4; totals.netPerHour = totals.net / 0.4; totals.elapsedMs = 24 * 60000;
  const rules = [['reflect-phys', 'Physical reflect', true], ['no-regen', 'No life or mana regeneration', true], ['no-leech', 'Cannot leech', false]]
    .map(([id, label, enabled]) => ({ id, label, enabled, pattern: '' }));
  const state = {
    config: {
      league: 'Demo', logPath: '', characterName: '', hotkeys: { clipboard: 'F8' },
      inventory: { displayId: null, key: 'Tab', onKey: true, timed: false, intervalMs: 1000 }, mapRules: rules,
      loadout: [{ name: 'Ambush Scarab of Containment', qty: 2, chaos: null }, { name: 'Map', qty: 1, chaos: 4 }],
    },
    status: {
      log: { ok: true, path: 'Client.txt' }, prices: { count: 5210, league: 'Demo', updatedAt: now, errors: [], loading: false },
      inventory: { keyHook: 'ok', open: true, lastReadAt: now, recognised: 23, error: null, art: { known: 1480, done: 0, total: 0, failed: 0 } }, hotkeys: { clipboard: true },
      shared: { count: 212, loadedAt: now, error: null, uploaded: 0, canUpload: false, waiting: 0 },
      update: { current: { sha: 'abc1234def', message: 'Read loot from the inventory' }, latest: { sha: 'fff9999', message: 'Fix poe.ninja item list parsing' }, available: true, checking: false, applying: false, step: '', error: null, checkedAt: now },
    },
    leagues: [{ id: 'Demo', name: 'Demo league' }], displays: [{ id: 1, label: 'Screen 1 (2560x1440)' }],
    learned: ['Chaos Orb'],
    notice: { text: 'Saved: Chaos Orb.', bad: false, at: now },
    unknown: [{ id: 1, qty: 3, guesses: [{ name: 'Vaal Orb', score: 78 }, { name: 'Orb of Fusing', score: 61 }, { name: 'Exalted Orb', score: 55 }], image: 'data:image/gif;base64,R0lGODlhAQABAIAAAGKv0AAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==' }],
    priceCheck: null,
    mapCheck: {
      at: now, name: 'Strand Map', tier: 16, quantity: 92, packSize: 33, corrupted: false, unidentified: false, dangerCount: 1,
      mods: [
        { mod: 'Monsters reflect 18% of Physical Damage', dangerous: true, labels: ['Physical reflect'] },
        { mod: 'Area contains many Totems', dangerous: false, labels: [] },
        { mod: 'Monsters have 30% increased Area of Effect', dangerous: false, labels: [] },
        { mod: '+40% Monster Fire Resistance', dangerous: false, labels: [] },
      ],
    },
    inventoryRev: 1,
    summary: { now, startedAt: now, currentId: 'r4', away: false, location: {}, divine: 212, runs, totals },
  };
  window.api = {
    getState: async () => state, onState: () => {}, setConfig: async () => true, action: async () => true,
    inventory: async () => {
      const img = state.unknown[0].image;
      const mk = (cell, status, name, qty, each, source, score) => ({ cell, status, name, qty, each, total: each * qty, source, score, guess: status === 'unknown' ? { name: 'Vaal Orb', score: 61 } : null, image: img });
      return { rev: 1, at: now, cols: 12, rows: 5, cells: [mk(0, 'item', 'Chaos Orb', 20, 1, 'art', 97), mk(1, 'item', 'Divine Orb', 2, 212, 'learned', 99), mk(2, 'unknown', null, 17, 0), mk(12, 'remembered', 'Vaal Orb', 9, 0.6), mk(13, 'skipped', null, 0, 0), mk(14, 'item', 'Abyss Thread', 6, 5.5, 'shared', 98)] };
    },
    priceCategories: async () => ({ chaosIcon: dot('#c9a227'), divineIcon: dot('#e8dcc0'), groups: [{ group: 'General', categories: [{ id: 'Currency', label: 'Currency', count: 108, icon: dot('#c9a227') }, { id: 'Fragment', label: 'Fragments', count: 66, icon: dot('#b5651d') }, { id: 'Thread', label: 'Threads', count: 10, icon: dot('#8e6bd1') }, { id: 'Essence', label: 'Essences', count: 105, icon: dot('#3aa6a6') }] }, { group: 'Equipment and gems', categories: [{ id: 'UniqueWeapon', label: 'Unique Weapons', count: 400, icon: dot('#a83232') }, { id: 'SkillGem', label: 'Skill Gems', count: 8123, icon: dot('#5b8dd9') }] }, { group: 'Atlas', categories: [{ id: 'Map', label: 'Maps', count: 300, icon: dot('#6aa84f') }] }] }),
    priceList: async () => ({ total: 108, rows: [['Mirror of Kalandra', 190000, 4, 12000], ['Divine Orb', 212, 41, 19388425], ['Exalted Orb', 14, -8, 420000], ['Legion Thread', 5.9, 305, 732000], ['Chaos Orb', 1, null, null]].map(([name, chaos, change, volume], i) => ({ name, chaos, change, volume, icon: dot(['#d7d7e0', '#e8dcc0', '#d4a017', '#8e6bd1', '#c9a227'][i]), listings: null, category: 'Currency', spark: change == null ? null : [0, change * 0.2, change * (i % 2 ? 0.9 : 0.4), change * 0.6, change * 0.8, change] })) }),
    search: async (q) => Object.keys(price).filter((n) => n.toLowerCase().includes(q.toLowerCase())).map((name) => ({ name, chaos: price[name] })),
  };
})();
