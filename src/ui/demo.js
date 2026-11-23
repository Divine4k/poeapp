'use strict';
// Preview data. Only used when index.html is opened in a normal browser (no Electron bridge),
// so the layout can be looked at without the game running.
(() => {
  if (window.api) return;
  const now = Date.now();
  const price = { 'Divine Orb': 212, 'Chaos Orb': 1, 'Exalted Orb': 14, 'Ambush Scarab of Containment': 9, 'The Nurse': 78, 'Vaal Orb': 0.6, 'Orb of Fusing': 0.3 };
  const loot = (id, name, qty, source) => ({ id, name, qty, source, batch: 'b1', ts: now, chaos: price[name] * qty });
  const run = (id, name, min, lootValue, costValue, deaths, live) => ({
    id, name, level: 83, startedAt: now - min * 60000, endedAt: live ? null : now, activeMs: min * 60000,
    segmentStart: live ? now : null, durationMs: min * 60000, deaths, lootValue, costValue, net: lootValue - costValue,
    items: [{ name: 'Chaos Orb', qty: 9, chaos: 9 }], loot: [], seen: [],
    costs: [{ id: 'c1', name: 'Ambush Scarab of Containment', qty: 2, each: 9, total: 18, chaos: null }],
  });
  const cur = run('r4', 'Strand', 3.2, 0, 22, 0, true);
  cur.loot = [loot('l1', 'Chaos Orb', 7, 'scan'), loot('l2', 'Vaal Orb', 3, 'scan'), loot('l3', 'The Nurse', 1, 'pickup'), loot('l4', 'Divine Orb', 1, 'pickup'), loot('l5', 'Exalted Orb', 2, 'manual')];
  cur.lootValue = cur.loot.reduce((a, l) => a + l.chaos, 0); cur.net = cur.lootValue - cur.costValue;
  cur.seen = [{ name: 'Orb of Fusing', qty: 4, chaos: 1.2 }, { name: 'Chaos Orb', qty: 2, chaos: 2 }];
  const runs = [run('r1', 'Jungle Valley', 4.1, 96, 22, 0), run('r2', 'Strand', 3.6, 14, 22, 1), run('r3', 'Dunes', 5.0, 431, 22, 0), cur];
  const totals = { maps: 4, deaths: 1, lootValue: 0, costValue: 0, net: 0, mapMs: 0 };
  for (const r of runs) { totals.lootValue += r.lootValue; totals.costValue += r.costValue; totals.net += r.net; totals.mapMs += r.durationMs; }
  totals.avgMapMs = totals.mapMs / 4; totals.netPerHour = totals.net / 0.4; totals.elapsedMs = 24 * 60000;
  const rules = [['reflect-phys', 'Physical reflect', true], ['no-regen', 'No life or mana regeneration', true], ['no-leech', 'Cannot leech', false]]
    .map(([id, label, enabled]) => ({ id, label, enabled, pattern: '' }));
  const state = {
    config: {
      league: 'Demo', logPath: '', characterName: '', hotkeys: { scan: 'F7', clipboard: 'F8' },
      screen: { displayId: null, cropBottom: 0.82, timed: true, intervalMs: 1000 }, mapRules: rules,
      loadout: [{ name: 'Ambush Scarab of Containment', qty: 2, chaos: null }, { name: 'Map', qty: 1, chaos: 4 }],
    },
    status: {
      log: { ok: true, path: 'Client.txt' }, prices: { count: 5210, league: 'Demo', updatedAt: now, errors: [], loading: false },
      screen: { ready: true, error: null, lastScanAt: now, lastMs: 840, lastFound: 6, loading: false }, hotkeys: { scan: true, clipboard: true },
    },
    leagues: [{ id: 'Demo', name: 'Demo league' }], displays: [{ id: 1, label: 'Screen 1 (2560x1440)' }],
    lastBatch: { runId: 'r4', batch: 'b1', count: 2, at: now },
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
    summary: { now, startedAt: now, currentId: 'r4', away: false, location: {}, divine: 212, runs, totals },
  };
  window.api = {
    getState: async () => state, onState: () => {}, setConfig: async () => true, action: async () => true,
    search: async (q) => Object.keys(price).filter((n) => n.toLowerCase().includes(q.toLowerCase())).map((name) => ({ name, chaos: price[name] })),
  };
})();
