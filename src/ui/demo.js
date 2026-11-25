'use strict';
// Preview data. Only used when index.html is opened in a normal browser (no Electron bridge),
// so the layout can be looked at without the game running.
(() => {
  if (window.api) return;
  const now = Date.now();
  // A drawn stand-in for a pair of boots (2 by 2 cells), as the price check shows a picture.
  const boots = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 94 94"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa4ae"/><stop offset=".6" stop-color="#4c5560"/><stop offset="1" stop-color="#2a2f36"/></linearGradient></defs><path d="M30 8h22l2 46 26 14 4 14H26l-2-30z" fill="url(#g)" stroke="#1b1e22" stroke-width="2"/><path d="M28 30h26M27 44h28" stroke="#c9a46a" stroke-width="3"/></svg>')}`;
  const dot = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="${c}"/></svg>`)}`;
  const price = { 'Divine Orb': 212, 'Chaos Orb': 1, 'Exalted Orb': 14, 'Ambush Scarab of Containment': 9, 'The Nurse': 78, 'Vaal Orb': 0.6, 'Orb of Fusing': 0.3 };
  const loot = (id, name, qty, source) => ({ id, name, qty, source, batch: 'b1', ts: now, chaos: price[name] * qty });
  const run = (id, name, min, lootValue, costValue, deaths, live) => ({
    id, name, level: 83, startedAt: now - min * 60000, endedAt: live ? null : now, activeMs: min * 60000,
    segmentStart: live ? now : null, durationMs: min * 60000, deaths, lootValue, costValue, net: lootValue - costValue,
    items: [{ name: 'Chaos Orb', qty: 9, chaos: 9 }], loot: [], seen: [], snapAt: now,
    costs: [{ id: 'c1', name: 'Ambush Scarab of Containment', qty: 2, each: 9, total: 18, chaos: null }],
  });
  const cur = run('r4', new URLSearchParams(location.search).get('map') || 'Strand', 3.2, 0, 22, 0, true);
  cur.loot = [loot('l1', 'Chaos Orb', 7, 'inventory'), loot('l2', 'Vaal Orb', 3, 'inventory'), loot('l3', 'The Nurse', 1, 'manual'), loot('l4', 'Divine Orb', 1, 'inventory'), loot('l5', 'Exalted Orb', 2, 'inventory')];
  cur.lootValue = cur.loot.reduce((a, l) => a + l.chaos, 0); cur.net = cur.lootValue - cur.costValue;
  cur.uncounted = { stacks: 1, singles: 3 };
  cur.items = [['Divine Orb', 1, 212], ['The Nurse', 1, 78, 1], ['Exalted Orb', 2, 28], ['Foulborn Exalted Orb', 1, 22.1], ["Gemcutter's Prism", 9, 21.9], ['Chaos Orb', 28, 28], ['Orb of Alteration', 48, 8.9], ['Timeless Vaal Splinter', 32, 7.1], ['Bestiary Thread', 2, 5.3], ['Exalted Shard', 4, 3.5], ['Timeless Templar Splinter', 21, 3.2], ['Vaal Orb', 3, 1.8], ['Chromatic Orb', 1, 1.7], ['Breach Thread', 2, 0.9], ['Orb of Fusing', 6, 0.8], ['Blight Thread', 2, 0.7], ['Mystery Shard', 3, 0]].map(([name, qty, chaos, byHand], i) => ({ name, qty, chaos, byHand: byHand || 0, icon: i === 16 ? null : dot(['#e8dcc0', '#8e6bd1', '#d4a017', '#3aa6a6', '#5b8dd9', '#c9a227'][i % 6]) }));
  const runs = [run('r1', 'Jungle Valley', 4.1, 96, 22, 0), run('r2', 'Strand', 3.6, 14, 22, 1), run('r3', 'Dunes', 5.0, 431, 22, 0), cur];
  // One map after the other, with a minute in the hideout between them.
  let at = now - 19 * 60000;
  for (const r of runs) { r.startedAt = at; at += r.durationMs; r.endedAt = r === cur ? null : at; at += 60000; }
  cur.startedAt = now - cur.durationMs;
  const totals = { maps: 4, deaths: 1, lootValue: 0, costValue: 0, net: 0, mapMs: 0 };
  for (const r of runs) { totals.lootValue += r.lootValue; totals.costValue += r.costValue; totals.net += r.net; totals.mapMs += r.durationMs; }
  totals.avgMapMs = totals.mapMs / 4; totals.netPerHour = totals.net / 0.4; totals.elapsedMs = 24 * 60000;
  const rules = [['reflect-phys', 'Physical reflect', true], ['reflect-ele', 'Elemental reflect'], ['no-regen', 'No life or mana regeneration', true], ['no-leech', 'Cannot leech'], ['less-recovery', 'Less recovery rate'],
    ['max-res', 'Reduced maximum resistances'], ['curses', 'Players are cursed'], ['avoid-ailments', 'Monsters avoid ailments'], ['avoid-poison-bleed', 'Monsters avoid poison and bleeding'], ['less-defence', 'Less armour or block'],
    ['less-accuracy', 'Less accuracy'], ['less-aoe', 'Less area of effect'], ['aura-effect', 'Reduced aura effect'], ['flask-charges', 'Reduced flask charges'], ['steal-charges', 'Monsters steal charges'], ['no-slow', 'Monsters cannot be slowed or stunned']]
    .map(([id, label, enabled]) => ({ id, label, enabled: !!enabled, pattern: '' }));
  const state = {
    config: {
      league: 'Demo', logPath: '', characterName: '', hotkeys: { clipboard: 'F8', snapshot: 'F9', priceCheck: 'Ctrl+D', record: 'Shift+F9' }, priceSearch: { auto: true, overlay: true }, checkToast: true,
      inventory: { displayId: null, key: 'Tab', onKey: true, onClick: true, timed: true, intervalMs: 1000, autoCopy: true }, mapRules: rules, activeStrategy: 'st1', strategies: [{ id: 'st1', name: 'Legion', atlasUrl: 'https://example.com/tree' }, { id: 'st2', name: 'Harvest', atlasUrl: '' }, { id: 'st3', name: 'Boss rushing', atlasUrl: '' }],
      loadout: [{ name: 'Ambush Scarab of Containment', qty: 2, chaos: null }, { name: 'Map', qty: 1, chaos: 4 }],
    },
    status: {
      log: { ok: true, path: 'Client.txt' }, prices: { count: 5210, league: 'Demo', updatedAt: now, errors: [], loading: false },
      inventory: { keyHook: 'ok', open: true, lastReadAt: now, recognised: 23, error: null, art: { known: 1480, done: 0, total: 0, failed: 0 } }, hotkeys: { clipboard: true, snapshot: true, record: true, priceCheck: false, priceCheckHeld: false, tradeTaken: [] },
      shared: { count: 212, loadedAt: now, error: null, uploaded: 0, canUpload: false, waiting: 0 },
      cloud: (() => { const q = new URLSearchParams(location.search); return { enabled: q.has('account'), signedIn: q.get('account') === 'in', name: q.get('account') === 'in' ? 'Divine4k' : '', waiting: 0, busy: false, error: null, sentAt: now - 4 * 60000 }; })(),
      game: { known: true, front: false },
      update: { current: { sha: 'abc1234def', message: 'Read loot from the inventory' }, latest: { sha: 'fff9999', message: 'Fix poe.ninja item list parsing' }, available: true, checking: false, applying: false, step: '', error: null, checkedAt: now },
    },
    // Open index.html?account=in&role=admin (or moderator) to see the Troubleshooting page and Developer tools.
    trouble: (() => { const q = new URLSearchParams(location.search); const role = q.get('account') === 'in' ? q.get('role') || '' : ''; return { recording: false, busy: '', startedAt: 0, video: false, maxMs: 480000, sending: null, can: !!role, admin: role === 'admin', rev: 1 }; })(),
    leagues: [{ id: 'Demo', name: 'Demo league' }], displays: [{ id: 1, label: 'Screen 1 (2560x1440)' }, { id: 2, label: 'Screen 2 (1920x1080)' }],
    packaged: false,
    learned: ['Alchemy Shard', 'Chaos Orb', 'Legion Thread', '(ignored items)'], itemsRev: '1', doubts: [{ id: 'inv:3', name: 'Chaos Orb', qty: 8, image: 'data:image/gif;base64,R0lGODlhAQABAIAAAGKv0AAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', options: ['Eldritch Chaos Orb'] }],
    notice: { text: 'Saved: Chaos Orb.', bad: false, at: now },
    unknown: [{ id: 1, qty: 3, at: now, here: true, guesses: [{ name: 'Vaal Orb', score: 78 }, { name: 'Orb of Fusing', score: 61 }, { name: 'Exalted Orb', score: 55 }], image: 'data:image/gif;base64,R0lGODlhAQABAIAAAGKv0AAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==' }],
    priceCheck: null,
    tradeCheck: {
      at: now, rev: 2, filtersRev: 0, inGame: false, ninja: null, state: 'done', error: '', total: 37, searchedAt: now - 4000, url: 'https://www.pathofexile.com/trade/search/Demo/abc123',
      icon: boots, iconW: 2, iconH: 2, compare: { label: '+# total maximum Life', mine: 88, lower: false },
      summary: { total: 37, low: 45, median: 80 },
      filters: {
        ok: true, rarity: 'Rare', title: 'Kraken Spark, Two-Toned Boots', name: '', offline: false, sockets: 'R-G-B B', itemLevel: 86,
        type: { value: 'Two-Toned Boots', enabled: false }, category: { id: 'armour.boots', label: 'Boots', enabled: true },
        flags: [{ key: 'corrupted', label: 'Not corrupted', value: false, enabled: true }, { key: 'ilvl', label: 'Item level 86 or higher', value: 86, enabled: false }],
        props: [{ key: 'ar', label: 'Armour', group: 'armour_filters', value: 251, min: 226, enabled: false }, { key: 'ev', label: 'Evasion Rating', group: 'armour_filters', value: 251, min: 226, enabled: false }],
        stats: [
          { key: 'pseudo:life', text: '+88 total maximum Life', kind: 'pseudo', ids: ['x'], value: 88, min: 79, max: null, enabled: true, tiers: [2] },
          { key: 'pseudo:res', text: '+70% total Elemental Resistance', kind: 'pseudo', ids: ['x'], value: 70, min: 63, max: null, enabled: true, tiers: [1, 4] },
          { key: 'stat:0', text: '30% increased Movement Speed', kind: 'explicit', ids: ['x'], value: 30, min: 27, max: null, enabled: true, tiers: [2] },
          { key: 'stat:1', text: '35% increased Armour and Evasion', kind: 'fractured', ids: ['x'], value: 35, min: 32, max: null, enabled: false, tiers: [3] },
          { key: 'stat:3', text: '+1 to Level of Socketed Gems', kind: 'corruption', ids: ['x'], value: 1, min: 1, max: null, enabled: false },
          { key: 'stat:2', text: '8% reduced Mana Cost of Skills', kind: 'crafted', ids: ['x'], value: -8, min: null, max: -7, negated: true, enabled: false },
        ],
        unknown: [],
        presets: {
          stats: { category: true, type: false, 'flag:corrupted': true, 'flag:ilvl': false, 'prop:ar': false, 'prop:ev': false, 'stat:pseudo:life': true, 'stat:pseudo:res': true, 'stat:stat:0': true, 'stat:stat:1': false, 'stat:stat:2': false },
          base: { category: false, type: true, 'flag:corrupted': true, 'flag:ilvl': true, 'prop:ar': false, 'prop:ev': false, 'stat:pseudo:life': false, 'stat:pseudo:res': false, 'stat:stat:0': false, 'stat:stat:1': false, 'stat:stat:2': false },
        },
      },
      listings: [
        { id: 'z', price: { amount: 8, currency: 'chaos' }, chaos: 8, seller: 'Cheap_Charlie', status: 'online', listedAt: now - 9 * 86400000, itemLevel: 84, corrupted: false, name: 'Dusk Trail, Two-Toned Boots', icon: boots, w: 2, h: 2, sockets: 'R-G B', cmp: 81, bait: true },
        { id: 'a', price: { amount: 45, currency: 'chaos' }, chaos: 45, seller: 'Zana_Mapper', status: 'instant', listedAt: now - 40 * 60000, itemLevel: 85, corrupted: false, name: 'Dusk Trail, Two-Toned Boots', icon: boots, w: 2, h: 2, sockets: 'R-G-B-B', cmp: 92,
          detail: { name: 'Dusk Trail', base: 'Two-Toned Boots', rarity: 'rare', ilvl: 85, corrupted: false, props: [['Quality', '+20%'], ['Armour', '226'], ['Energy Shield', '48']],
            mods: [{ text: '+12% to Fire and Lightning Resistances', kind: 'implicit' }, { text: '30% increased Movement Speed', kind: 'explicit' }, { text: '+92 to maximum Life', kind: 'explicit' }, { text: '+41% to Cold Resistance', kind: 'explicit' }, { text: '+38% to Lightning Resistance', kind: 'fractured' }, { text: '+28% to Fire Resistance', kind: 'crafted' }] } },
        { id: 'b', price: { amount: 80, currency: 'chaos' }, chaos: 80, seller: 'KiracsApprentice', status: 'online', listedAt: now - 5 * 3600000, itemLevel: 86, corrupted: false, name: 'Storm Spur, Two-Toned Boots', icon: boots, w: 2, h: 2, sockets: 'G-G B', cmp: 86 },
        { id: 'd', price: { amount: 95, currency: 'chaos' }, chaos: 95, seller: 'Helena_Lux', status: 'instant', listedAt: now - 19 * 3600000, itemLevel: 86, corrupted: false, name: 'Storm Spur, Two-Toned Boots', icon: boots, w: 2, h: 2, sockets: 'B-B-R-G', cmp: 100 },
        { id: 'c', price: { amount: 1, currency: 'divine' }, chaos: 212, seller: 'NikoTheMad', status: 'afk', listedAt: now - 3 * 86400000, itemLevel: 84, corrupted: false, name: 'Gale Stride, Two-Toned Boots', icon: boots, w: 2, h: 2, sockets: 'R R', cmp: 79 },
      ],
    },
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
    summary: { now, startedAt: runs[0].startedAt, currentId: 'r4', away: false, location: {}, divine: 212, runs, totals },
    sessions: [
      { id: 's2', strategyId: 'st1', startedAt: now - 26 * 3600000, endedAt: now - 24 * 3600000, divine: 205, totals: { ...totals, maps: 3, net: 1890, netPerHour: 945, elapsedMs: 2 * 3600000 } },
      { id: 's1', strategyId: 'st2', startedAt: now - 51 * 3600000, endedAt: now - 50 * 3600000, divine: 198, totals: { ...totals, maps: 3, net: -40, netPerHour: -40, elapsedMs: 3600000 } },
    ],
  };
  // A stand-in inventory picture: coloured dots on the slot background.
  const gridImage = () => {
    const cols = ['#c9a227', '#8e6bd1', '#3aa6a6', '#a83232', '#5b8dd9', '#6aa84f'];
    let dots = '';
    for (let k = 0; k < 47; k++) dots += `<circle cx="${(k % 12) * 52 + 26}" cy="${Math.floor(k / 12) * 52 + 26}" r="17" fill="${cols[k % 6]}"/>`;
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 624 260"><rect width="624" height="260" fill="#04041d"/>${dots}</svg>`)}`;
  };
  const snapCells = () => Array.from({ length: 47 }, (_, k) => ({ cell: k, status: k % 11 === 4 ? 'skipped' : k === 17 ? 'unknown' : k % 9 === 3 ? 'remembered' : 'item', name: k % 11 === 4 || k === 17 ? null : 'Chaos Orb', qty: (k % 20) + 1, each: 1, total: (k % 20) + 1, carried: k < 3 || k === 4, carriedQty: k < 3 || k === 4 ? (k % 20) + 1 : (k === 5 ? 2 : 0) }));
  const offer = (id, dir, player, item, qty, price, tab, left, top, more) => ({
    id, dir, player, item, qty, price, league: 'Demo', tab, left, top, note: '', at: now - id * 47000, lastAt: now, asks: 1,
    state: 'new', here: false, thanked: false, soldAlready: false, value: null, market: null, low: false, next: dir === 'in' ? 'invite' : 'hideout', nextLabel: '', waiting: '', grid: tab ? 12 : 0, ...more,
  });
  const KEYS = { hotkeys: { clipboard: 'F8', snapshot: 'F9', priceCheck: 'Ctrl+D', record: 'Shift+F9' }, trade: { next: 'F2', dismiss: 'F3', layout: 'Shift+F2', invite: '', trade: '', busy: '', still: '', whisper: '', hideout: 'F5', remaining: '' } };
  state.config.trade = { enabled: true, overlay: true, position: 'bottom', offsetX: 0, offsetY: 0, sound: false, hotkeys: { ...KEYS.trade }, auto: { thankSold: true, kickSold: true, thankBought: false, leaveBought: false, homeBought: false, joinHideout: false, ignoreSold: false, closeBoughtSec: 0 }, messages: { thanks: 'Thank you, good luck!', busy: 'I am busy right now.', sold: 'Sorry, {item} is already sold.', still: 'Hi, are you still interested in {item} for {price}?' } };
  state.status.hotkeys.layout = true; state.status.hotkeys.tradeNext = true; state.status.hotkeys.tradeDismiss = true;
  state.trade = {
    afk: false, divine: 212, canSend: true, seen: { whispers: 5, offers: 3, lastWhisperAt: now }, enabled: true, hotkeys: state.config.trade.hotkeys,
    overlayInfo: { on: true, helper: true, front: 'PathOfExile', allowed: true, layoutOpen: false },
    defaultMessages: { thanks: 'Thank you, good luck!', busy: 'I am busy right now. I will invite you in a few minutes if you can wait.', sold: 'Sorry, {item} is already sold.', still: 'Hi, are you still interested in {item} for {price}?' },
    labels: { invite: 'Invite', trade: 'Trade', thanks: 'Say thanks', kick: 'Kick', hideout: 'Go to hideout', leave: 'Leave party', busy: 'Busy', sold: 'Tell them it is sold', still: 'Still interested?' },
    offers: [
      offer(3, 'in', 'Zana_Mapper', 'Mageblood Heavy Belt', 1, { amount: 180, currency: 'divine' }, 'Big sales', 14, 2, { value: 38160, state: 'here', here: true, next: 'trade', waiting: 'In your hideout', grid: 24 }),
      offer(2, 'in', 'xXCurrencyFlipXx', 'Chaos Orb', 400, { amount: 1.5, currency: 'Divine Orb' }, '', 0, 0, { value: 318, market: 400, low: true, asks: 2 }),
      offer(1, 'out', 'KiracsApprentice', 'The Nurse', 1, { amount: 75, currency: 'chaos' }, 'cards', 4, 9, { value: 75, market: 78, state: 'there', next: null, waiting: 'Waiting for the seller to trade' }),
    ],
    days: [0, 120, 40, 0, 310, 95, 0, 0, 660, 212, 80, 1450, 430, 1320].map((sold, i) => ({ day: new Date(now - (13 - i) * 86400000).setHours(0, 0, 0, 0), sold, soldCount: sold ? 1 + (i % 4) : 0, bought: i === 13 ? 212 : 0, boughtCount: i === 13 ? 1 : 0 })),
    history: [
      { id: 'h2', dir: 'in', player: 'Einhar_Fan', item: 'Tabula Rasa Simple Robe', qty: 1, price: { amount: 12, currency: 'chaos' }, at: now - 9 * 60000, value: 12 },
      { id: 'h1', dir: 'out', player: 'NikoTheMad', item: 'Ambush Scarab of Containment', qty: 20, price: { amount: 1, currency: 'divine' }, at: now - 55 * 60000, value: 212 },
    ],
    totals: { soldToday: { count: 4, chaos: 1320, unpriced: 0 }, boughtToday: { count: 1, chaos: 212, unpriced: 0 }, soldAll: { count: 31, chaos: 20400, unpriced: 2 }, boughtAll: { count: 9, chaos: 3150, unpriced: 0 } },
  };
  let listener = () => {};
  const merge = (base, patch) => {
    for (const [k, v] of Object.entries(patch)) base[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge({ ...base[k] }, v) : v;
    return base;
  };
  window.api = {
    onTrade: (cb) => setTimeout(() => cb(state.trade), 0), overlaySize: () => {},
    onCheck: (cb) => setTimeout(() => cb({ ...state.tradeCheck, divine: 212, auto: true, sockets: true, league: 'Keepers', coins: { chaos: dot('#c9a227'), divine: dot('#e8e4dc') } }), 0), checkSize: () => {}, checkKeys: () => {}, onCheckPress: (cb) => { window.demoPress = cb; },
    // Settings changed in the preview are kept for as long as the page is open, as the app would keep them.
    getState: async () => state, onState: (cb) => { listener = cb; },
    // The Jewels page needs the real tree and tables: scripts/demo-server.js answers these when
    // it serves the page; opened as a plain file, the page says it needs the app.
    jewels: async (a) => {
      const res = await fetch('/__jewels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }).catch(() => null);
      if (!res) throw new Error('The Jewels page needs the app (or scripts/demo-server.js) to work.');
      const body = await res.json();
      if (body.error) throw new Error(body.error);
      return body.result;
    },
    onJewelProgress: () => {},
    setConfig: async (patch) => { merge(state.config, patch); listener(state); return true; },
    action: async (a) => {
      if (a && a.type === 'troubleToggle') {
        const t = state.trouble;
        if (t.recording) { t.recording = false; t.rev++; } else Object.assign(t, { recording: true, startedAt: Date.now(), video: true });
        listener(state);
      }
      if (a && a.type === 'resetKeys') { merge(state.config, { hotkeys: { ...KEYS.hotkeys }, trade: { hotkeys: { ...KEYS.trade } }, inventory: { key: 'Tab' } }); listener(state); }
      return true;
    },
    // Open index.html?account to look at the registration window, ?account=in for a logged-in one.
    account: async (q) => {
      const c = state.status.cloud;
      if (q.type === 'register' && q.name.toLowerCase() === 'taken') return { error: 'That name is taken. Pick another one.' };
      if (q.type === 'register' || q.type === 'login') Object.assign(c, { signedIn: true, name: q.name, waiting: 0, sentAt: Date.now() });
      if (q.type === 'logout' || q.type === 'delete') Object.assign(c, { signedIn: false, name: '' });
      return { error: '' };
    },
    itemsList: async () => {
      const seen = state.unknown[0].image;
      const pic = (id, extra = {}) => ({ id, seen, sharp: true, by: 'Divine', auto: false, onlyHere: false, over: null, doubt: null, ...extra });
      const row = (name, category, ninja, pictures = [], extra = {}) => ({ name, method: 'picture', icon: null, category, ninja, own: null, chaos: ninja, official: true, counted: true, seen: null, pictures, ...extra });
      const read = (min, source, score) => ({ at: now - min * 60000, source, score });
      const rows = [
        row('Chaos Orb', 'Currency', 1, [pic('mine:0', { auto: true })], { seen: read(2, 'learned', 99) }),
        row('Eldritch Chaos Orb', 'Currency', 27, [pic('mine:1', { doubt: { name: 'Chaos Orb', icon: null } })], { seen: read(40, 'learned', 97) }),
        row('Divine Orb', 'Currency', 212, [], { seen: read(2, 'art', 91) }),
        row('Exalted Orb', 'Currency', 14, [pic('shared:2', { by: 'Marek', sharp: false })], { seen: read(1500, 'shared', 98) }),
        row('Orb of Fusing', 'Currency', 0.3, [], { seen: read(2, 'art', 88) }),
        row('Portal Scroll', 'Currency', 0.01, [pic('mine:4', { auto: true, onlyHere: true, by: '' })], { counted: false, seen: read(2, 'learned', 99) }),
        row('Stacked Deck', 'Currency', 2.1, [], { own: 3, chaos: 3 }),
        row('Vaal Orb', 'Currency', 1.4, [], { official: false }),
        row('Ritual Thread', 'Thread', 3.2, [pic('mine:2', { auto: true })], { seen: read(9, 'learned', 99) }),
        row('Legion Thread', 'Thread', 6.5),
        row('Immortal Astrolabe', 'Astrolabe', 12, [pic('shared:0', { by: 'Marek', sharp: false }), pic('shared:1', { by: 'Anna', sharp: false, over: 'Royal Astrolabe' })]),
        row('Map (Tier 16)', 'Map', 4, [], { method: 'tier', official: false, seen: read(12, 'map', 93) }),
        row('My League Thing', 'Other', null, [pic('mine:6', { onlyHere: true, by: '' })], { official: false }),
      ];
      const labels = { Currency: 'Currency', Thread: 'Threads', Astrolabe: 'Astrolabes', Map: 'Maps', Other: 'Other names' };
      const categories = Object.keys(labels).map((id) => ({ id, label: labels[id], count: rows.filter((r) => r.category === id).length, icon: null }));
      return { me: 'Divine', canUpload: true, named: 3, rows, categories };
    },
    troubleList: async () => [
      { id: '20261124-201500-Divine4k', kind: 'note', images: 0, startedAt: now - 120000, endedAt: now - 120000, by: 'Divine4k', note: 'The Items page shows last league.', sent: null, events: 0, videoBytes: 0 },
      { id: '20261124-170509-Divine4k', startedAt: now - 3600000, endedAt: now - 3600000 + 95000, by: 'Divine4k', note: 'Timer kept running after I went to the hideout.\nIt only stopped when I entered the next map.', sent: { at: now - 3000000, url: 'https://github.com/Divine4k/poeapp-reports/tree/main/recordings/20261124-170509-Divine4k' }, events: 412, videoBytes: 9123456, state: 'fixed', statusBy: 'Divine4k', statusAt: now - 1000000 },
      { id: '20261124-190000-Marek', startedAt: now - 300000, endedAt: now - 300000 + 63000, by: 'Marek', note: 'Overlay covers my flasks after I resize the game.', sent: { at: now - 240000, url: 'https://github.com/Divine4k/poeapp-reports/tree/main/recordings/20261124-190000-Marek' }, events: 230, videoBytes: 6400000, remote: true, seen: false, type: 'suggestion', state: 'in progress', statusBy: 'Divine4k', statusAt: now - 50000 },
      { id: '20261124-181200-Divine4k', startedAt: now - 600000, endedAt: now - 600000 + 41000, by: 'Divine4k', note: '', sent: null, events: 96, videoBytes: 0, videoProblem: 'The screen could not be recorded.' },
    ],
    troubleDetails: async (id) => {
      const list = await window.api.troubleList();
      const m = list.find((r) => r.id === id);
      const ev = [
        { t: 0, kind: 'start', version: 'abc1234', by: 'Divine4k' }, { t: 310.4, kind: 'key', dir: 'down', key: 'Tab' }, { t: 420.9, kind: 'key', dir: 'up', key: 'Tab' },
        { t: 610.2, kind: 'key', dir: 'down', key: 'W' }, { t: 655.7, kind: 'key', dir: 'up', key: 'W' }, { t: 702.1, kind: 'key', dir: 'down', key: 'W' }, { t: 741.3, kind: 'key', dir: 'up', key: 'W' },
        { t: 980.6, kind: 'mouse', dir: 'down', button: 'left', x: 1650, y: 820 }, { t: 1060.0, kind: 'mouse', dir: 'up', button: 'left', x: 1650, y: 820 },
        { t: 1500, kind: 'log', line: '2026/11/24 17:05:11 123456 abc [DEBUG Client 1234] Got Instance Details from login server' },
        { t: 1800, kind: 'log', line: '2026/11/24 17:05:11 123456 abc [INFO Client 1234] : You have entered Celestial Hideout.' },
        { t: 1820, kind: 'state', map: { id: 'r4', name: 'Strand', running: true, deaths: 0, loot: 5, lootValue: 260 } },
        { t: 2400, kind: 'mouse', dir: 'down', button: 'left', x: 1650, y: 820 }, { t: 2900, kind: 'hotkey', job: 'clipboard', key: 'F8' },
        { t: 3100, kind: 'notice', text: 'Counted 3 Chaos Orb as loot from this map.', bad: false }, { t: 5200, kind: 'notice', text: 'The inventory was not open.', bad: true },
        { t: 9000, kind: 'stop' },
      ];
      return { ...m, video: m.videoBytes ? { bytes: m.videoBytes, width: 1600, height: 900, mime: 'video/webm' } : null, events: ev };
    },
    troubleVideo: async () => null,
    troubleNew: async () => '20261124-201500-Divine4k',
    troubleAddImage: async () => '',
    troubleImage: async () => null,
    dev: async (q) => {
      if (q.type === 'github') return { repo: 'Divine4k/poeapp-reports', hasToken: true, tokenEnd: 'x9Qa', by: 'Divine4k', at: now - 86400000 };
      if (q.type === 'users') return { users: [['Divine4k', 'admin', 31], ['Marek', 'moderator', 12], ['Anna', '', 4], ['newplayer', '', 0]].map(([name, role, sessions], i) => ({ name, role, sessions, last: sessions ? now - i * 86400000 : 0, created: now - (40 - i) * 86400000 })) };
      return { ok: true };
    },
    // The Tracker page (open index.html?account=in&role=admin to see it). Kept while the page is open.
    tracker: async (q) => {
      const day = 86400000;
      const mk = (number, title, status, priority, body, age, extra = {}) => ({ number, parent: null, title, body, status, priority, dropped: false, labels: [], progress: window.Steps.progress(body), url: `https://github.com/Divine4k/poeapp/issues/${number}`, by: 'Divine4k', created: now - age * day, updated: now - age * day / 2, closed: status === 'done' || status === 'dropped' ? now - day : 0, ...extra });
      const list = (window.demoTracker = window.demoTracker || [
        mk(14, 'Pick a new name for the app', 'idea', 'normal', 'Map Companion is too narrow now that it does trade and price checks.', 6),
        mk(18, 'Read the items', 'todo', 'normal', '', 2, { parent: 12 }),
        mk(19, 'Show the total', 'blocked', 'normal', '', 2, { parent: 12 }),
        mk(20, 'Board view', 'testing', 'normal', '', 1, { parent: 11 }),
        mk(21, 'Map view with lines', 'doing', 'high', '', 1, { parent: 11 }),
        mk(15, 'Heist contract value in the price check', 'considering', 'low', '', 3),
        mk(12, 'Price checker', 'todo', 'high', 'Read a whole stash tab and price it.\n\n- [x] Find the tab grid\n- [ ] Read the items\n- [ ] Show the total', 9),
        mk(16, 'More map pictures (Crimson Temple, Cemetery)', 'hold', 'normal', '', 2, { labels: ['look'] }),
        mk(11, 'Tracker page', 'doing', 'high', '- [x] Issues on GitHub\n- [x] The board\n- [ ] Claude works from it', 1),
        mk(9, 'Bundle Inter font', 'done', 'normal', '', 20),
        mk(8, 'Separate launcher window', 'dropped', 'normal', '', 25, { dropped: true }),
      ]);
      if (q.type === 'list') return { repo: state.config.trackerRepo || 'Divine4k/poeapp', items: list.map((i) => ({ ...i })) };
      if (q.type === 'add') { const it = mk(Math.max(...list.map((i) => i.number)) + 1, q.title, q.status || 'idea', 'normal', '', 0, { parent: q.parent ?? null }); list.push(it); return { item: { ...it } }; }
      if (q.type === 'delete') { const at = list.findIndex((i) => i.number === q.number); for (const c of list) if (c.parent === q.number) c.parent = null; list.splice(at, 1); return { number: q.number }; }
      if (q.type === 'parent') { const it = list.find((i) => i.number === q.number); it.parent = q.parent; return { item: { ...it } }; }
      if (q.type === 'update') {
        const it = list.find((i) => i.number === q.number);
        Object.assign(it, q.patch, { updated: Date.now() });
        it.progress = window.Steps.progress(it.body); it.dropped = it.status === 'dropped'; it.closed = it.status === 'done' || it.status === 'dropped' ? it.closed || Date.now() : 0;
        return { item: { ...it } };
      }
      return { error: 'Unknown request.' };
    },
    runSnapshot: async (id) => ({ cols: 12, rows: 5, trips: (id === 'r3' || id === 'r4' ? [1, 2] : [1]).map((trip) => ({ trip, at: now, image: gridImage(), cells: snapCells() })) }),
    savedSession: async (id) => { const x = state.sessions.find((q) => q.id === id); return { ...x, runs: runs.slice(0, 3) }; },
    inventory: async () => {
      const img = state.unknown[0].image;
      const mk = (cell, status, name, qty, each, source, score) => ({ cell, status, name, qty, each, total: each * qty, source, score, guess: status === 'unknown' ? { name: 'Vaal Orb', score: 61 } : null, image: img });
      return { rev: 1, at: now, cols: 12, rows: 5, cells: [mk(0, 'item', 'Chaos Orb', 20, 1, 'art', 97), mk(1, 'item', 'Divine Orb', 2, 212, 'learned', 99), mk(2, 'unknown', null, 17, 0), mk(12, 'remembered', 'Vaal Orb', 9, 0.6), mk(13, 'skipped', null, 0, 0), mk(14, 'item', 'Abyss Thread', 6, 5.5, 'shared', 98)] };
    },
    priceCategories: async () => ({ chaosIcon: dot('#c9a227'), divineIcon: dot('#e8dcc0'), groups: [{ group: 'General', categories: [{ id: 'Currency', label: 'Currency', count: 108, icon: dot('#c9a227') }, { id: 'Fragment', label: 'Fragments', count: 66, icon: dot('#b5651d') }, { id: 'Thread', label: 'Threads', count: 10, icon: dot('#8e6bd1') }, { id: 'Essence', label: 'Essences', count: 105, icon: dot('#3aa6a6') }] }, { group: 'Equipment and gems', categories: [{ id: 'UniqueWeapon', label: 'Unique Weapons', count: 400, icon: dot('#a83232') }, { id: 'SkillGem', label: 'Skill Gems', count: 8123, icon: dot('#5b8dd9') }] }, { group: 'Atlas', categories: [{ id: 'Map', label: 'Maps', count: 300, icon: dot('#6aa84f') }] }] }),
    priceList: async () => ({ total: 108, rows: [['Mirror of Kalandra', 190000, 4, 12000], ['Divine Orb', 212, 41, 19388425], ['Exalted Orb', 14, -8, 420000], ['Legion Thread', 5.9, 305, 732000], ['Chaos Orb', 1, null, null]].map(([name, chaos, change, volume], i) => ({ name, chaos, change, volume, icon: dot(['#d7d7e0', '#e8dcc0', '#d4a017', '#8e6bd1', '#c9a227'][i]), listings: null, category: 'Currency', spark: change == null ? null : [0, change * 0.2, change * (i % 2 ? 0.9 : 0.4), change * 0.6, change * 0.8, change] })) }),
    logCheck: async () => ({ path: 'D:\\SteamLibrary\\steamapps\\common\\Path of Exile\\logs\\Client.txt', ok: true, error: null, now, stats: { size: 48234567, modifiedAt: now - 4000, bytes: 9000, lines: 212, lastGrowthAt: now - 4000 }, inMap: false, mapName: null, location: { kind: 'other', code: 'JungleValley_Atlas', name: 'Jungle Valley' },
      trace: [{ at: now - 4000, raw: '[DEBUG Client 1234] Generating level 83 area "JungleValley_Atlas" with seed 123456', type: 'area', kind: 'other', code: 'JungleValley_Atlas', did: 'Nothing: the area name "JungleValley_Atlas" does not begin with "Map", so it is not treated as a map' }, { at: now - 3000, raw: '[INFO Client 1234] : You have entered Jungle Valley.', type: 'entered', did: '' }, { at: now - 90000, raw: '[DEBUG Client 1234] Generating level 60 area "HideoutCrucible" with seed 1', type: 'area', kind: 'hideout', code: 'HideoutCrucible', did: 'Nothing: hideout or town, no map running' }] }),
    search: async (q) => Object.keys(price).filter((n) => n.toLowerCase().includes(q.toLowerCase())).map((name) => ({ name, chaos: price[name] })),
  };
})();
