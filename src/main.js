'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, dialog, screen, shell, safeStorage } = require('electron');

// Settings and saved sessions always live in the same folder, however the app was started
// (start.bat or the installed program), so nothing is lost when switching between them.
app.setPath('userData', path.join(app.getPath('appData'), 'poeapp'));
if (process.platform === 'win32') app.setAppUserModelId('com.divine4k.mapcompanion');

const { LogTail, findLogPath, readRecent } = require('./core/clientLog');
const { PriceTable, PriceService, CATEGORY_LABELS } = require('./core/prices');
const { parseItemText, priceName } = require('./core/itemText');
const { DEFAULT_RULES, checkMods } = require('./core/mapMods');
const { Session } = require('./core/session');
const { CANON, COLS, ROWS, gridRect, isInventoryOpen, extractCell, isEmptyCell } = require('./core/inventory/grid');
const { IconIndex, similarity, fingerprint, encodePrint, decodePrint, sharpPrint, sharpShifts, packPrint, unpackPrint } = require('./core/inventory/icons');
const { readStack } = require('./core/inventory/digits');
const { InventoryReader, SINGLE_ART_SCORE, learnable } = require('./core/inventory/reader');
const { LootLedger } = require('./core/inventory/ledger');
const { MAP_NAMES } = require('./core/inventory/maps');
const { captureFrame, cursorInFrame, cursorOnDisplay } = require('./capture');
const { ArtLoader } = require('./art');
const { Updater } = require('./updater');
const { webFetch } = require('./http');
const { SharedItems } = require('./shared');
const { Cloud } = require('./cloud');
const { SnapshotStore, SessionArchive, markCarried, recheckCells } = require('./core/store');
const { Backlog } = require('./core/inventory/backlog');
const { checkMessage, noteMessage, tradeMessage } = require('./core/checkMessage');
const { TradeBook, chatCommand, nextAction, autoSteps, overlayAllowed, overlayBounds, placementFromRect, DEFAULT_MESSAGES, LABELS } = require('./core/trade');
const { focusGame, typeChat, copyItem } = require('./chat');
const { Overlay, Toast, CheckPanel } = require('./overlay');
const { GameWatch } = require('./gamewin');
const { closeLeftovers, waitForExit, afterPid } = require('./leftovers');
const { checkPanelBounds } = require('./core/checkPanel');
const { StatIndex } = require('./core/tradeStats');
const { searchable, buildFilters, applyEdits, isNarrow, buildQuery, summarize, compareSpec, markBait } = require('./core/tradeQuery');
const { TradeClient, readListing, searchUrl, exchangeUrl, currencyName } = require('./core/tradeApi');
const { movedDefault } = require('./ui/keys');
const { DEFAULT_CONFIG, mergeTrade } = require('./config');
const { thumbnail, gridPicture, cellsOfPicture, pixelsOfThumb, printPicture } = require('./pictures');
const { ScreenRecorder } = require('./recorder');
const { Troubleshoot } = require('./troubleshoot');

const PRICE_REFRESH_MS = 30 * 60 * 1000;
const UPDATE_CHECK_MS = 2 * 60 * 1000;
const SHARED_REFRESH_MS = 10 * 60 * 1000;
const CLOUD_RETRY_MS = 10 * 60 * 1000; // uploads that could not be sent are tried again this often

let win = null;
let config = null;
let logTail = null;
let prices = new PriceTable();
let leagues = [];
let saveTimer = null;
let timedTimer = null;
let invBusy = false;
let artLoader = null;
let hook = null;
let updater = null;
let shared = null;
let cloud = null; // the account and the uploading of sessions and pictures
let trouble = null; // troubleshooting recordings (Troubleshooting page, admins and moderators)
let troubleRev = 0; // goes up when the list of recordings changes, so the page reads it again
let snapshots = null; // the inventory as read for each map
let archive = null;   // sessions closed with "Start new session"
let flushTimer = null;
let notice = null; // { text, bad, at }
let lastInventory = { rev: 0, at: 0, cells: [] };
const logTrace = []; // the last area lines from the game log and what the tracker did with each
let singlesBaseline = 0;  // single (unnumbered) items in the inventory when the map was entered
let carriedIn = null; // { runId, trip, cells, stale } the inventory as it was when this trip into the map began
let leftMapAt = 0;    // when the map was last left for the hideout, to tell if the inventory was seen since
let lastSingles = 0; // what the last clean read saw, for the Inventory tab
// Items the reader could not name, kept until named, ignored or dismissed: [{ id, qty, print, image, guesses, at, here }]
const backlog = new Backlog({ similar: (a, b) => similarity(a, b) > 0.95 });
const saveBacklog = () => writeJson('unrecognised.json', backlog.save(encodePrint));
let learned = []; // [{ name, print(base64), image? }] image: the slot as it looked, kept for items named from 0.16 on
let itemsRev = 0; // goes up whenever a named item changes, so the Items page reads its list again
const session = new Session();
const index = new IconIndex();
index.priceOf = (name) => prices.chaosOf(name); // settles look-alike pictures towards the cheaper item
const reader = new InventoryReader(index);
const ledger = new LootLedger();
const priceService = new PriceService({ fetchImpl: webFetch });
const book = new TradeBook();
let overlay = null;
let toast = null; // the short message shown in game after the check key
let checkPanel = null; // the price check window on top of the game
let layoutWin = null; // the full-screen window for dragging overlay parts into place
const watch = new GameWatch();
let sharedLoading = false; // the shared item list is being fetched because Refresh was pressed
let chatBusy = false;
let tradeSaveTimer = null;

const status = {
  log: { ok: false, path: '', error: 'Not started' },
  prices: { count: 0, updatedAt: 0, league: '', errors: [], loading: false },
  inventory: { keyHook: 'off', open: false, lastReadAt: 0, recognised: 0, error: null, art: { known: 0, done: 0, total: 0, failed: 0 } },
  hotkeys: { clipboard: false, snapshot: false, record: false, tradeNext: false, tradeDismiss: false, layout: false },
  shared: { count: 0, loadedAt: 0, error: null, uploaded: 0, canUpload: false },
  cloud: { enabled: false, signedIn: false, name: '', waiting: 0, busy: false, error: null, sentAt: 0 },
  update: { current: null, latest: null, available: false, checking: false, applying: false, step: '', error: null, checkedAt: 0 },
};
let mapCheck = null;
let priceCheck = null;
// The trade search for the item last checked: { at, rev, filters, state, error, total, listings, url, summary }.
let tradeCheck = null;
let tradeRev = 0;
let statIndex = null; // modifier wording -> trade site id, read from disk on first use
const tradeClient = new TradeClient({ fetchImpl: webFetch });

// ---- files ----------------------------------------------------------------
const dataFile = (name) => path.join(app.getPath('userData'), name);
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch (_) { return fallback; }
}
function writeJson(name, value) {
  try { fs.writeFileSync(dataFile(name), JSON.stringify(value)); } catch (e) { console.error('save failed', name, e.message); }
}

function loadConfig() {
  const saved = readJson('config.json', {});
  config = {
    ...DEFAULT_CONFIG, ...saved,
    hotkeys: { ...DEFAULT_CONFIG.hotkeys, ...(saved.hotkeys || {}) },
    inventory: { ...DEFAULT_CONFIG.inventory, ...(saved.inventory || {}) },
    priceSearch: { ...DEFAULT_CONFIG.priceSearch, ...(saved.priceSearch || {}) },
    trade: mergeTrade(DEFAULT_CONFIG.trade, saved.trade),
  };
  // The hideout key used to be unset. Settings saved back then hold an empty key, which would
  // hide the F5 default, so it is filled in once. Clearing the key afterwards sticks.
  if (!saved.hideoutKeyGiven) {
    const hk = config.trade.hotkeys;
    const used = [...Object.values(config.hotkeys), ...Object.values(hk)].some((k) => String(k || '').trim().toUpperCase() === 'F5');
    if (!hk.hideout && !used) config.trade = { ...config.trade, hotkeys: { ...hk, hideout: 'F5' } };
    config.hideoutKeyGiven = true;
  }
  // The price check key was Ctrl+F until 0.24, which took the game's own Ctrl+F (jump to the
  // stash search box) away from it. It is Ctrl+D now, as in Awakened PoE Trade. A key still
  // saved as the old default follows once; a key you chose yourself is kept, and so is
  // clearing the key afterwards.
  if (!saved.priceKeyMoved) {
    const others = [config.hotkeys.clipboard, config.hotkeys.snapshot, ...Object.values(config.trade.hotkeys)];
    const key = movedDefault(config.hotkeys.priceCheck, 'Ctrl+F', DEFAULT_CONFIG.hotkeys.priceCheck, others);
    if (key !== config.hotkeys.priceCheck) say(`The price check key is now ${key} instead of Ctrl+F. You can change it in Settings, under Keys.`);
    config.hotkeys = { ...config.hotkeys, priceCheck: key };
    config.priceKeyMoved = true;
  }
  // "Check item price" is meant to be on. A copy of the app that had it saved as off (often
  // without knowing: the check keys then read nothing) gets it on once; switching it off
  // afterwards sticks.
  if (!saved.autoCopyOn) {
    config.inventory = { ...config.inventory, autoCopy: true };
    config.autoCopyOn = true;
  }
  if (!Array.isArray(config.strategies) || !config.strategies.length) config.strategies = DEFAULT_CONFIG.strategies;
  if (!config.strategies.some((x) => x.id === config.activeStrategy)) config.activeStrategy = config.strategies[0].id;
  // Keep the user's rule choices but pick up rules added in newer versions.
  const byId = new Map((saved.mapRules || []).map((r) => [r.id, r]));
  config.mapRules = [
    ...DEFAULT_RULES.map((r) => ({ ...r, ...(byId.get(r.id) || {}) })),
    ...(saved.mapRules || []).filter((r) => !DEFAULT_RULES.some((d) => d.id === r.id)),
  ];
  // A key that was moved or filled in above is saved at once, so that it happens one time only.
  if (!saved.priceKeyMoved || !saved.hideoutKeyGiven || !saved.autoCopyOn) writeJson('config.json', config);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { writeJson('session.json', session.toJSON()); writeJson('ledger.json', ledger.toJSON()); }, 1500);
}

// ---- state to the window ---------------------------------------------------
function buildState() {
  status.inventory.art.known = index.art.length;
  status.inventory.awaitingArrival = ledger.pendingArrival && !!session.current;
  status.inventory.noBaseline = !ledger.baseline;
  if (shared) status.shared = { ...shared.status, canUpload: shared.canUpload, waiting: shared.pending.length, by: shareName(), loading: sharedLoading };
  if (cloud) status.cloud = cloud.status;
  status.game = { known: watch.running, front: watch.gameInFront() };
  return {
    trouble: trouble ? { ...trouble.status, can: canTrouble(), admin: isAdmin(), rev: troubleRev } : null,
    config: { ...config, shareToken: undefined }, status, leagues, mapCheck, priceCheck, tradeCheck, notice,
    packaged: app.isPackaged, // the installed program already has its shortcuts
    inventoryRev: lastInventory.rev,
    unknown: backlog.items.map((u) => ({ id: u.id, qty: u.qty, image: u.image, guesses: u.guesses, at: u.at, here: !!u.here })),
    // Slots of the latest reading where look-alikes could not be told apart, one per item.
    doubts: [...new Map(lastInventory.cells.filter((c) => c.how === 'doubt' && c.name).map((c) => [c.name, {
      id: `inv:${c.cell}`, name: c.name, qty: c.qty, image: c.image,
      options: [...new Set((c.near || []).map((n) => n.name).filter((n) => n !== c.name))].slice(0, 2),
    }])).values()],
    learned: [...new Set(learned.map((l) => l.name || '(ignored items)'))].sort(),
    itemsRev: `${itemsRev}:${learned.length}:${index.shared.length}:${index.art.length}`,
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `Screen ${i + 1} (${d.size.width}x${d.size.height})` })),
    summary: withIcons(session.summary(prices)),
    sessions: archive ? archive.list().map((x) => ({ ...x, strategyId: strategyOf(x) })) : [],
    trade: tradeState(),
  };
}
// Loot gets its item pictures: the current map's list and the session's best drops show them.
function withIcons(summary) {
  for (const r of summary.runs) for (const i of r.items) { const e = prices.get(i.name); i.icon = (e && e.icon) || null; }
  return summary;
}
// Sessions saved before strategies existed, or whose strategy is gone, belong to the first one.
function strategyOf(saved) {
  return config.strategies.some((x) => x.id === saved.strategyId) ? saved.strategyId : config.strategies[0].id;
}
// Saves the running session under the strategy it was run with, then starts an empty one.
// Returns false when saving failed, in which case the session is left open.
function closeSession() {
  session.endRun();
  try {
    const saved = archive && archive.save(session.summary(prices), Date.now(), { strategyId: config.activeStrategy });
    session.reset(); syncLedger();
    if (saved) syncCloud();
    return saved ? 'saved' : 'empty';
  } catch (e) {
    say(`The session could not be saved (${e.message || e}), so it is still open.`, true);
    return false;
  }
}
const cleanUrl = (u) => { const v = String(u || '').trim(); return /^https?:\/\/\S+$/i.test(v) ? v : ''; };
function push() {
  const s = (win && !win.isDestroyed()) || (trouble && trouble.recording) ? buildState() : null;
  if (win && !win.isDestroyed()) win.webContents.send('state', s);
  if (trouble && trouble.recording) trouble.state(s);
  syncOverlay();
  if (checkPanel && checkPanel.visible && tradeCheck) checkPanel.update(checkPanelData());
}
function changed() { scheduleSave(); push(); }

// ---- game log ----------------------------------------------------------------
function syncLedger() {
  const cur = session.current;
  if (cur && cur.segmentStart !== null) {
    if (!ledger.inMap) {
      singlesBaseline = lastSingles;
      session.nextTrip(cur.id);
      // Back into the same map without the inventory being seen since you left it: what the
      // app last saw is the full inventory of the trip before, stashed or not.
      const stale = cur.trip > 1 && leftMapAt > 0 && !(lastInventory.at > leftMapAt);
      // Whatever the last reading showed is what goes into the map with you.
      carriedIn = { runId: cur.id, trip: cur.trip, stale, cells: lastInventory.cells.map((c) => ({ cell: c.cell, name: c.name || null, qty: c.qty || 0, print: c.print || null })) };
      saveCarried();
      if (stale) {
        showToast({ title: 'Your inventory was not seen after you stashed', detail: 'Loot like last trip\'s may be taken as brought in. Click a dimmed slot on the Mapping page to count it.', bad: true }, true);
        say('Your inventory was not seen in the hideout after the last trip, so items like the ones you stashed may show as taken in with you. Click a dimmed slot in this map\'s picture to count it as loot. Opening your inventory once before going back in avoids this.', true);
      }
    }
    ledger.enterMap();
  } else {
    if (ledger.inMap) leftMapAt = Date.now();
    ledger.leaveMap();
  }
}
function saveCarried() {
  if (carriedIn) writeJson('carried.json', { ...carriedIn, cells: carriedIn.cells.map((c) => ({ ...c, print: c.print ? encodePrint(c.print) : null })) });
}

function startLog() {
  if (logTail) { logTail.stop(); logTail = null; }
  const p = config.logPath || findLogPath();
  if (!p) {
    status.log = { ok: false, path: '', error: 'Client.txt not found. Choose it in Settings, under General.' };
    return;
  }
  status.log = { ok: false, path: p, error: 'Waiting for the file' };
  if (config.trade.enabled && book.catchUp(readRecent(p))) saveTradesSoon();
  logTail = new LogTail(p);
  logTail.on('status', (s) => { status.log = { ok: s.ok, path: p, error: s.ok ? null : `Cannot read the log (${s.error})` }; push(); });
  logTail.on('raw', (line, ev) => {
    if (trouble) trouble.event('log', { line, ev: ev || undefined });
    // Shown in the game log check: what the game wrote. What the app did with it is added below.
    logTrace.push({ at: Date.now(), raw: line.replace(/^\S+ \S+ \d+ \S+ /, '').slice(0, 220), type: ev ? ev.type : null, kind: ev ? ev.kind || null : null, code: ev ? ev.code || null : null, did: ev ? '' : 'Nothing: not a line the tracker acts on' });
    if (logTrace.length > 40) logTrace.shift();
  });
  logTail.on('event', (ev) => {
    const before = session.currentId;
    const wasActive = !!(session.current && session.current.segmentStart !== null);
    session.handleLogEvent(ev, { characterName: config.characterName, loadout: config.loadout });
    if (ev.type === 'area') {
      const cur = session.current;
      const did = session.currentId !== before ? 'Started a new map'
        : ev.kind === 'hideout' || ev.kind === 'town' ? (wasActive ? 'Paused the map: hideout or town' : 'Nothing: hideout or town, no map running')
          : cur && cur.segmentStart !== null ? (wasActive ? 'Counted as part of the map already running (a side area, or the map was never left for a hideout the app recognises)' : 'Resumed the map: same instance as before')
            : ev.kind !== 'map' ? `Nothing: the area name "${ev.code}" does not begin with "Map", so it is not treated as a map` : 'Nothing';
      for (let i = logTrace.length - 1; i >= 0; i--) if (logTrace[i].type === 'area' && logTrace[i].code === ev.code && !logTrace[i].did) { logTrace[i].did = did; break; }
    }
    if (ev.type === 'area') syncLedger();
    if (config.trade.enabled && ev.type === 'party' && config.trade.auto.joinHideout) {
      const buy = book.pendingPurchase();
      if (buy) autoRun(buy, ['hideout']);
    }
    const doneBefore = book.lastDone;
    book.ignoreSold = !!config.trade.auto.ignoreSold;
    const tookIn = config.trade.enabled && book.onLog(ev);
    if (tookIn && ev.type === 'trade' && ev.result === 'accepted' && book.lastDone !== doneBefore) {
      const sold = book.get(book.lastDone);
      autoRun(sold, autoSteps(sold, config.trade.auto));
    }
    if (tookIn) saveTradesSoon();
    else if (ev.type === 'whisper' || ev.type === 'party') return; // nothing to redraw
    changed();
  });
  logTail.start();
}

// ---- prices and item art --------------------------------------------------------
function setPrices(table) {
  prices = table;
  prices.setCustom(config.customPrices);
  status.prices.count = prices.size;
  status.prices.updatedAt = prices.updatedAt;
  status.prices.league = prices.league || '';
}

function syncArt() {
  if (!artLoader) artLoader = new ArtLoader({ cacheFile: dataFile('art.json'), fetchImpl: webFetch });
  artLoader.sync(prices.iconEntries(), index, (p) => { status.inventory.art = { ...status.inventory.art, ...p }; push(); })
    .catch((e) => console.error('art sync failed', e.message));
}

async function refreshPrices() {
  if (status.prices.loading) return;
  status.prices.loading = true; push();
  try {
    if (!leagues.length) leagues = await priceService.leagues();
    if (!config.league && leagues.length) { config.league = leagues[0].id; writeJson('config.json', config); }
    if (!config.league) throw new Error('No league selected');
    const { table, errors } = await priceService.refresh(config.league);
    status.prices.errors = errors;
    if (table.size > 1) { setPrices(table); writeJson('prices.json', table.toJSON()); syncArt(); }
    else status.prices.errors = ['No prices came back for this league.', ...errors];
  } catch (e) {
    status.prices.errors = [e.message || String(e)];
  } finally {
    status.prices.loading = false; push();
  }
}

// ---- inventory reading -----------------------------------------------------------
// Looks at the kept pictures of every map in the open session again, with the item pictures
// and names known now, and corrects the loot that was counted under a wrong name or not at all.
function recheckMaps(quiet = false) {
  if (!snapshots) return { slots: 0, maps: 0 };
  let maps = 0, slots = 0;
  const moved = new Map(); // "from -> to" -> quantity
  for (const run of session.runs) {
    const data = snapshots.get(run.id);
    let touched = false;
    for (const trip of data.trips) {
      let cut = null;
      try { cut = cellsOfPicture(trip.image); } catch (_) { /* a picture that cannot be opened is skipped */ }
      if (!cut) continue;
      const changes = recheckCells(trip.cells, (c) => {
        // The exact fingerprint is kept with the slot since 0.17; older pictures are read back
        // from the saved image. The sharp look always uses the saved image.
        const rgb = cut(c.cell);
        let print = null;
        try { print = c.packed ? unpackPrint(c.packed) : null; } catch (_) { /* fall back to the picture */ }
        print = print || fingerprint(rgb);
        const hit = index.match(print, () => sharpShifts(rgb));
        c.near = nearList(index.nearest(print, 3));
        if (!hit || hit.ignored) return null;
        c.score = Math.round(hit.score * 100);
        if (hit.source === 'art' && c.qty <= 1 && hit.score < SINGLE_ART_SCORE) return null;
        return hit;
      }, (name) => index.knows(name));
      for (const ch of changes) {
        touched = true; slots++;
        const n = session.moveLoot(run.id, ch.from, ch.to, ch.qty);
        // The map being run: what was counted under the old name must not be counted again under the new.
        if (n && run.id === session.currentId && (ledger.inMap || ledger.pendingArrival)) ledger.rename(ch.from, ch.to, { gained: n, cell: ch.cell });
        if (n) { const key = `${ch.from || 'not recognised'} → ${ch.to}`; moved.set(key, (moved.get(key) || 0) + n); }
      }
    }
    try { snapshots.rewrite(run.id); } catch (e) { console.error('snapshot save failed', e.message); }
    if (touched) {
      maps++;
      session.markSnapshot(run.id);
    }
  }
  if (quiet) return { slots, maps };
  if (!slots) { say('Checked the maps of this session again: nothing to correct.'); return { slots, maps }; }
  const list = [...moved].map(([k, n]) => `${k} ×${n}`).join(', ');
  say(`Corrected ${slots} ${slots === 1 ? 'slot' : 'slots'} in ${maps} ${maps === 1 ? 'map' : 'maps'}${list ? `: ${list}` : ''}.`);
  return { slots, maps };
}

// "This picture is this item", said by you. The one place a correction goes through, wherever
// it was made: a picture saved under another name is renamed, a new one is added, the list of
// what you carried into the map follows, and the shared list is corrected or extended.
function teach(typed, print, image = null) {
  const entry = prices.get(typed);
  const name = entry ? entry.name : String(typed || '').trim();
  const same = (l) => { try { return similarity(decodePrint(l.print), print) > 0.95; } catch (_) { return false; } };
  const mine = learned.filter(same);
  const was = [...new Set(mine.filter((l) => l.name !== name).map((l) => l.name || 'ignored'))];
  for (const l of mine) { l.name = name; delete l.auto; if (image && !l.image) l.image = image; }
  if (!mine.length) learned.push(image ? { name, print: encodePrint(print), image } : { name, print: encodePrint(print) });
  relearn();
  if (backlog.resolve(print)) saveBacklog();
  // What went into the map with you under the old name (or without one) is not loot under the new.
  if (carriedIn) {
    for (const c of carriedIn.cells) {
      if (!c.print || c.name === name || similarity(c.print, print) <= 0.9) continue;
      ledger.rename(c.name, name, { carried: c.qty || 1 });
      c.name = name;
    }
  }
  if (shared) {
    const sync = async () => {
      if (shared.canUpload) await shared.correct(print, name);
      shared.queue(name, print);
      await shared.flush();
      index.setShared(shared.items); itemsRev++; push();
    };
    sync().then(() => {
      // The name is kept on this PC either way; say so when it could not be shared.
      if (shared.canUpload && shared.status.error) { say(`Saved on this PC, but the item database did not take it: ${shared.status.error}`, true); push(); }
    }).catch((e) => console.error('shared update failed', e.message));
  }
  return { name, entry, was };
}

// Gives one entry of the named-items list to the matcher, with its sharp print when the slot
// picture was kept.
function indexLearned(l) {
  try {
    const rgb = l.image ? pixelsOfThumb(l.image) : null;
    index.addLearned(l.name, decodePrint(l.print), { sharp: rgb ? sharpPrint(rgb) : null, auto: !!l.auto });
  } catch (_) { /* skip a broken entry */ }
}

// After the list of named items was edited: the matcher gets the list again and it is saved.
function relearn() {
  index.learned = [];
  for (const l of learned) indexLearned(l);
  itemsRev++;
  writeJson('learned.json', learned);
  reader.forgetCells();
}

// Does a named picture look clearly more like another item's official picture than like the
// one it is named after? Returns { name, icon } of that other item, or null.
function looksLikeAnother(name, print) {
  if (!name) return null;
  const a = IconIndex.best(index.art, print);
  if (!a.best || a.best.name === name || a.score < 0.8) return null;
  let own = null;
  for (const e of index.art) if (e.name === name) own = Math.max(own === null ? -1 : own, similarity(print, e.print));
  if (own === null || a.score - own < index.artMargin) return null;
  const other = prices.get(a.best.name);
  return { name: a.best.name, icon: (other && other.icon) || null };
}

// The name your additions to the item database are signed with: your account's. Empty when
// not logged in, as nothing is added then.
function shareName() { return shared ? shared.by : ''; }

// When and how each item was last read from the inventory: name -> { at, source, score }.
// This is what shows that the app reads an item, whether or not anyone ever named it.
let seenItems = {};
let seenTimer = null;
function noteSeen(cells) {
  const at = Date.now();
  let fresh = false, any = false;
  for (const c of cells) {
    if (c.status !== 'item' || !c.name) continue;
    if (!seenItems[c.name]) fresh = true;
    seenItems[c.name] = { at, source: c.source || null, score: c.score ? Math.round(c.score * 100) : null };
    any = true;
  }
  if (fresh) itemsRev++;
  if (any && !seenTimer) seenTimer = setTimeout(() => { seenTimer = null; writeJson('seen.json', seenItems); }, 20000);
}

// The item database as the Items page shows it: every item the app can read, with how it is
// recognised (official picture, pictures of it as seen in game and who named them, or the tier
// numeral for maps), when it was last read, its price and whether it is counted. Pictures kept
// on this PC and those in the shared database are one list; the same picture in both shows once.
function itemDatabase() {
  const pics = [];
  learned.forEach((l, i) => {
    try { pics.push({ id: `mine:${i}`, name: l.name, print: decodePrint(l.print), image: l.image || null, auto: !!l.auto, local: true, shared: false, by: '', over: null }); } catch (_) { /* skip a broken entry */ }
  });
  index.shared.forEach((e, i) => {
    const twin = pics.find((p) => p.local && similarity(p.print, e.print) > 0.95);
    if (twin && twin.name === e.name) { twin.shared = true; twin.by = e.by || ''; twin.auto = !!e.auto; return; }
    // Your own name for the same picture differs: yours is the one used on this PC.
    pics.push({ id: `shared:${i}`, name: e.name, print: e.print, image: null, auto: !!e.auto, local: false, shared: true, by: e.by || '', over: twin ? (twin.name || 'ignored') : null });
  });
  const downloaded = new Set(index.art.map((e) => e.name));
  const off = new Set(config.ignoredItems || []);
  const rows = new Map();
  const rowOf = (name, method = 'picture') => {
    if (!rows.has(name)) {
      const listed = name ? prices.listed(name) : null;
      const own = name ? prices.ownPrice(name) : null;
      rows.set(name, {
        name, method, icon: (listed && listed.icon) || null, category: (listed && listed.category) || (name ? 'Other' : 'Ignored'),
        ninja: listed ? listed.chaos : null, own, chaos: own !== null ? own : (listed ? listed.chaos : null),
        official: downloaded.has(name), counted: !off.has(name), seen: seenItems[name] || null, pictures: [],
      });
    }
    return rows.get(name);
  };
  for (const e of prices.iconEntries()) rowOf(e.name);
  for (const name of MAP_NAMES) rowOf(name, 'tier');
  for (const p of pics) {
    rowOf(p.name).pictures.push({
      id: p.id, seen: p.image || printPicture(p.print), sharp: !!p.image, by: p.by, auto: p.auto,
      onlyHere: p.local && !p.shared, over: p.over, doubt: looksLikeAnother(p.name, p.print),
    });
  }
  // Items read some other way (counted by you for one slot) still belong in the list.
  for (const name of Object.keys(seenItems)) if (!rows.has(name)) rowOf(name, 'slot');
  const list = [...rows.values()];
  const labels = new Map(CATEGORY_LABELS.flatMap(([, cats]) => cats));
  labels.set('Other', 'Other names'); labels.set('Ignored', 'Ignored pictures');
  const counts = new Map();
  for (const r of list) counts.set(r.category, (counts.get(r.category) || 0) + 1);
  const icons = prices.categoryIcons();
  const categories = [...labels].filter(([id]) => counts.has(id)).map(([id, label]) => ({ id, label, count: counts.get(id), icon: icons[id] || null }));
  for (const [id, n] of counts) if (!labels.has(id)) categories.push({ id, label: id, count: n, icon: icons[id] || null });
  return { me: shareName(), canUpload: !!(shared && shared.canUpload), named: learned.filter((l) => l.name && !l.auto).length, rows: list, categories };
}

// The closest names as kept with a slot: [{ name, score (percent), source }].
const nearList = (near) => (near && near.length ? near.map((n) => ({ name: n.name, score: Math.round(n.score * 100), source: n.source })) : null);

// Items recognised only through their downloaded picture are saved as they really look in
// game, so the next read matches them almost exactly instead of sitting near the limit. Only
// clear reads qualify: a stack number, a comfortable score, and either no look-alike near or a
// sharp verdict. They are kept on this PC and marked as learned by the app.
const AUTO_LEARN_SCORE = 0.84;
function autoLearn(cells) {
  let added = 0;
  for (const c of learnable(cells, AUTO_LEARN_SCORE)) {
    if (added >= 12) break;
    learned.push({ name: c.name, print: encodePrint(c.print), image: thumbnail(c.rgb), auto: true });
    index.addLearned(c.name, c.print, { sharp: sharpPrint(c.rgb), auto: true });
    // Offered to the shared list too, for items it has no picture of yet (needs the token).
    if (shared && shared.canUpload) shared.queue(c.name, c.print, { auto: true });
    added++;
  }
  if (added) {
    itemsRev++; writeJson('learned.json', learned);
    // Uploads are gathered for a minute, so a full inventory becomes one change to the list.
    if (shared && shared.canUpload && shared.pending.length && !autoFlush) {
      autoFlush = setTimeout(async () => { autoFlush = null; await shared.flush(); index.setShared(shared.items); itemsRev++; push(); }, 60000);
    }
  }
}
let autoFlush = null;

// Tells you in game, once per item, when a reading needs you: a stack that was not recognised,
// or look-alikes that could not be told apart.
const alerted = { unknown: new Set(), doubt: new Set() };
function alertReading(cells) {
  if (config.inventory.alerts === false) return;
  const fresh = backlog.items.filter((u) => u.here && !alerted.unknown.has(u.id));
  const doubts = cells.filter((c) => c.how === 'doubt' && c.name && !alerted.doubt.has(c.name));
  if (!fresh.length && !doubts.length) return;
  for (const u of fresh) alerted.unknown.add(u.id);
  for (const c of doubts) alerted.doubt.add(c.name);
  let title, detail;
  if (fresh.length) {
    const guess = fresh.length === 1 && fresh[0].guesses && fresh[0].guesses[0];
    title = fresh.length === 1 ? 'An item was not recognised' : `${fresh.length} items were not recognised`;
    detail = `${guess ? `It looks closest to ${guess.name}. ` : ''}Not counted until named: one click on the Mapping page of Map Companion.`;
  } else {
    const other = (doubts[0].near || []).find((n) => n.name !== doubts[0].name);
    title = `Not sure about ${doubts[0].name}`;
    detail = `${other ? `It could also be ${other.name}. ` : ''}Counted as ${doubts[0].name} for now. Confirm it on the Mapping page of Map Companion.`;
  }
  showToast({ title, detail, bad: true }, true);
}

// Keeps this reading as the picture of what the current map brought in.
function keepSnapshot(result) {
  const run = session.current;
  if (!snapshots || !run || !(ledger.inMap || ledger.pendingArrival)) return;
  const trip = run.trip || 1;
  const base = carriedIn && carriedIn.runId === run.id && carriedIn.trip === trip ? carriedIn.cells : [];
  const cells = markCarried(result.cells.filter((c) => c.status !== 'covered'), base, (a, b) => similarity(a, b) > 0.9)
    .map((c) => ({ ...c, score: c.score ? Math.round(c.score * 100) : null, near: nearList(c.near), packed: c.print ? packPrint(c.print) : null }));
  const growing = ledger.inMap;
  const stale = !!(carriedIn && carriedIn.stale && base === carriedIn.cells);
  if (!snapshots.wants(run.id, trip, cells, growing)) return;
  if (snapshots.record(run.id, trip, { at: Date.now(), cells, image: gridPicture(cells), growing, stale })) session.markSnapshot(run.id);
}

function updateUnknown(found) {
  const added = backlog.update(found, (u) => ({
    image: thumbnail(u.rgb),
    guesses: index.suggest(u.print, 3).filter((g) => g.score >= 0.4).map((g) => ({ name: g.name, score: Math.round(g.score * 100) })),
  }));
  if (added) saveBacklog();
}

// Which inventory slot the mouse is over, or null.
function cursorCell(cur, rect) {
  if (!cur) return null;
  const col = Math.floor((cur.x - rect.x0) / rect.cell), row = Math.floor((cur.y - rect.y0) / rect.cell);
  return col >= 0 && col < COLS && row >= 0 && row < ROWS ? { row, col } : null;
}

async function readInventory() {
  if (invBusy) return;
  invBusy = true;
  try {
    const frame = await captureFrame(config.inventory.displayId);
    const rect = gridRect(frame.width, frame.height);
    status.inventory.error = null;
    const wasOpen = status.inventory.open;
    status.inventory.open = isInventoryOpen(frame, rect);
    // The inventory was seen open and now closed some other way (Space, a click on its cross):
    // the window goes too. Only on that change, so a screen the reader cannot make out never
    // closes it.
    if (wasOpen && !status.inventory.open && checkPanel && checkPanel.visible) closeCheckPanel();
    if (!status.inventory.open) return;
    // With the mouse over the inventory a tooltip covers some slots; the reader keeps what it
    // knew about those and reads the rest.
    const result = reader.read(frame, { cursor: cursorCell(cursorInFrame(frame), rect) });
    if (!result) return;
    status.inventory.lastReadAt = Date.now();
    status.inventory.recognised = result.recognised;
    settlePendingNames();
    noteSeen(result.cells);
    if (config.inventory.autoLearn !== false) autoLearn(result.cells);
    updateUnknown(result.unknown);
    try { alertReading(result.cells); } catch (e) { console.error('alert failed', e.message); }
    const before = new Map(lastInventory.cells.map((c) => [c.cell, c]));
    lastInventory = {
      rev: lastInventory.rev + 1, at: Date.now(),
      cells: result.cells.map((c) => {
        const prev = before.get(c.cell);
        const same = prev && prev.print && c.print && similarity(prev.print, c.print) > 0.98;
        const guess = c.print && (c.status === 'unknown' || c.status === 'skipped') ? index.suggest(c.print, 1)[0] : null;
        return {
          cell: c.cell, print: c.print, status: c.status, name: c.name, qty: c.qty, source: c.source,
          score: c.score ? Math.round(c.score * 100) : null, how: c.how, near: nearList(c.near),
          guess: guess ? { name: guess.name, score: Math.round(guess.score * 100) } : null,
          image: same ? prev.image : thumbnail(c.rgb),
        };
      }),
    };
    const known = result.cells.filter((c) => c.name).map((c) => ({ cell: c.cell, name: c.name, qty: c.qty }));
    const gains = ledger.reading({ counts: result.counts, cells: known, empties: result.empties });
    if (gains.length && session.current) session.addLoot(gains, 'inventory');
    // What could not be counted, so each map can say how far its total can be trusted.
    lastSingles = result.cells.filter((c) => c.status === 'skipped').length;
    if (session.current && (ledger.inMap || ledger.pendingArrival)) {
      session.setUncounted(session.currentId, result.unknown.length, Math.max(0, lastSingles - singlesBaseline));
    }
    try { keepSnapshot(result); } catch (e) { console.error('snapshot failed', e.message); }
    scheduleSave();
  } catch (e) {
    status.inventory.error = e.message || String(e);
  } finally {
    invBusy = false;
    push();
  }
}

function syncTimedWatch() {
  clearInterval(timedTimer);
  timedTimer = null;
  if (config.inventory.timed) timedTimer = setInterval(readInventory, Math.max(500, Number(config.inventory.intervalMs) || 1000));
}

// The keyboard helper does two things, each only on your own key press:
// it notices your inventory key (without blocking it) so the inventory is read once per press,
// and it lets the check hotkey send a single Ctrl+C to the game.
let clickTimer = null;
const KEY_ALIASES = { tab: 'Tab', space: 'Space', escape: 'Escape', esc: 'Escape', enter: 'Enter', backquote: 'Backquote', '`': 'Backquote' };
// The helper is also what types chat lines: for trade offers, and for the /hideout and
// /remaining keys, which work with trade offers switched off too.
const hookWanted = () => !!((trouble && trouble.recording) || config.inventory.onKey || config.inventory.onClick || config.inventory.autoCopy || config.trade.enabled || config.trade.hotkeys.hideout || config.trade.hotkeys.remaining);
// What the helper is set up from. It is only started again when one of these changes.
const hookSetup = () => JSON.stringify([hookWanted(), !!config.inventory.onKey, config.inventory.key, !!config.inventory.onClick, !!(trouble && trouble.recording)]);
// The helper is started once and then left running: only what it listens for is swapped when
// a setting changes. Stopping and starting it again (as every change on the Settings page used
// to do) can leave it unable to start on Windows, and with it gone the app could neither copy
// the hovered item nor type in the game. Sending keys does not need it to be listening at all,
// so `hook` is set as soon as the helper is loaded, whether or not listening works.
let hookListening = false;
function syncKeyHook() {
  let lib = hook;
  if (!lib) { try { lib = require('uiohook-napi'); } catch (_) { status.inventory.keyHook = 'missing'; return; } }
  hook = lib;
  try { for (const ev of ['keydown', 'keyup', 'mousedown', 'mouseup', 'wheel']) lib.uIOhook.removeAllListeners(ev); } catch (_) { /* none were set */ }
  status.inventory.keyHook = 'off';
  if (!hookWanted()) return;
  if (config.inventory.onKey) {
    const raw = String(config.inventory.key || 'Tab').trim();
    const name = KEY_ALIASES[raw.toLowerCase()] || (raw.length === 1 ? raw.toUpperCase() : raw);
    const code = lib.UiohookKey[name];
    if (code === undefined) status.inventory.keyHook = 'badkey';
    else lib.uIOhook.on('keydown', (e) => { if (e.keycode === code) setTimeout(readInventory, 200); });
  }
  // The price check window over the game goes with the game's own panels: Escape, or the
  // inventory key (the item was checked in the open inventory, so the key closes it). The key
  // still reaches the game as well; the app only listens.
  const invRaw = String(config.inventory.key || 'Tab').trim();
  const invCode = lib.UiohookKey[KEY_ALIASES[invRaw.toLowerCase()] || (invRaw.length === 1 ? invRaw.toUpperCase() : invRaw)];
  lib.uIOhook.on('keydown', (e) => {
    if (!checkPanel || !checkPanel.visible || checkPanel.typing) return; // Escape then only ends the typing
    if (e.keycode !== lib.UiohookKey.Escape && (invCode === undefined || e.keycode !== invCode)) return;
    if (trouble) trouble.event('checkPanel', { closed: e.keycode === lib.UiohookKey.Escape ? 'Escape' : 'inventory key' });
    closeCheckPanel();
    push();
  });
  // Back from a map, each of your clicks (moving loot to the stash) is followed by one read, so
  // the app sees the inventory as you leave it. A quick run of clicks gets one read at its end.
  if (config.inventory.onClick) {
    lib.uIOhook.on('mouseup', () => {
      if (ledger.inMap || !ledger.pendingArrival || !watch.gameInFront()) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(readInventory, 300);
    });
  }
  // While a troubleshooting recording runs, every key and click is noted too.
  if (trouble && trouble.recording) trouble.attachHook(lib);
  try {
    if (!hookListening) { lib.uIOhook.start(); hookListening = true; }
    if (status.inventory.keyHook !== 'badkey') status.inventory.keyHook = 'ok';
  } catch (_) { status.inventory.keyHook = 'missing'; }
}

// ---- naming items ------------------------------------------------------------------
function say(text, bad = false) { notice = { text, bad, at: Date.now() }; if (trouble) trouble.event('notice', { text, bad }); }

// Remembers that this picture is the named item ('' = ignore it) and queues it for sharing.
function learnPrint(typed, print, image = null) {
  const entry = typed ? prices.get(typed) : null;
  const name = entry ? entry.name : String(typed || '').trim();
  learned.push(image ? { name, print: encodePrint(print), image } : { name, print: encodePrint(print) });
  indexLearned(learned[learned.length - 1]);
  itemsRev++;
  writeJson('learned.json', learned);
  if (backlog.resolve(print)) saveBacklog();
  if (!name) { say('That item is ignored from now on. Undo it on the Items page, under Items you named.'); return; }
  say(entry ? `Saved: ${name}.` : `Saved as "${name}", but no price is known under that name, so it counts as 0c. Check the spelling if that is wrong.`, !entry);
  if (shared) {
    shared.queue(name, print);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => { await shared.flush(); index.setShared(shared.items); push(); }, 3000);
  }
}

// The check hotkey on an inventory item: the slot under the mouse gets the copied item's name.
// No screen capture is needed: the picture comes from the last clear view of that slot, because
// the item's own tooltip covers part of the inventory while you hover it.
//
// Items that are always the same picture (currency, threads...) are learned for good.
// Items that share a picture or vary (divination cards, maps, uniques, gems) are only counted
// for the slot they are in now.
function nameUnderCursor(item, name, entry) {
  const cur = cursorOnDisplay(config.inventory.displayId);
  if (!cur) return;
  const rect = gridRect(cur.width, cur.height);
  const at = cursorCell(cur, rect);
  if (!at) return; // not over the inventory: a plain price check
  const k = at.row * COLS + at.col;
  const print = reader.prints[k];
  if (!print) {
    // The slot has only been seen with the mouse on it, and a hovered slot does not look like
    // the item at rest. The name is kept and put to the slot's picture at the next clear look.
    pendingNames.set(k, { item, name, entry, at: Date.now() });
    const how = config.inventory.timed ? 'Move the mouse off the inventory for a second' : `Move the mouse off the inventory and press ${config.inventory.key || 'Tab'} twice (close and open it)`;
    say(`Noted: ${name}. It is saved at the next clear look at that slot. ${how}; nothing else to press.`);
    return;
  }
  applyName(k, item, name, entry, print);
}

// Names waiting for a clear picture of their slot: cell -> { item, name, entry, at }.
const pendingNames = new Map();
const PENDING_NAME_MS = 3 * 60 * 1000;

// After an inventory read: every waiting name whose slot now has a clear picture is put to it.
function settlePendingNames() {
  for (const [k, p] of [...pendingNames]) {
    if (Date.now() - p.at > PENDING_NAME_MS) { pendingNames.delete(k); continue; }
    const print = reader.prints[k];
    if (!print) continue;
    pendingNames.delete(k);
    applyName(k, p.item, p.name, p.entry, print);
    showToast(noteMessage(notice));
  }
}

// print: the picture of slot k at rest.
function applyName(k, item, name, entry, print) {
  const sharedPicture = /Divination Card|Map/i.test(item.itemClass) || item.isMap;
  // Learned for good: anything that always looks the same. That is every stackable item, and
  // single items that are not gear or gems and have a price (emblems, invitations and the like).
  // Gear, gems and uniques vary in value under one picture, so they are counted per slot instead.
  const plainSingle = !item.stackable && /^(Normal|Currency)$/i.test(item.rarity) && !/Gem/i.test(item.itemClass) && !!entry;
  if ((item.stackable || plainSingle) && !sharedPicture) {
    const hit = index.match(print);
    if (hit && hit.name === name) { say(`${name} is already recognised.`); return; }
    // The game itself just said what this item is. A picture of it that carries another name
    // (named wrongly once, or learned by the app from a look-alike) is corrected instead of
    // getting a second, contradicting entry.
    const wrong = learned.filter((l) => l.name !== name && similarity(decodePrint(l.print), print) > 0.95);
    if (wrong.length) {
      const was = [...new Set(wrong.map((l) => l.name || 'ignored'))].join(', ');
      for (const l of wrong) { l.name = name; delete l.auto; }
      relearn();
      say(`Corrected: this picture was saved as ${was} and now counts as ${name}.`);
      if (shared && shared.canUpload) shared.correct(print, name).then((n) => { if (n) { index.setShared(shared.items); itemsRev++; push(); } });
      return;
    }
    if (hit && hit.source === 'shared' && shared && shared.canUpload) shared.correct(print, name).then((n) => { if (n) { index.setShared(shared.items); itemsRev++; push(); } });
    const seen = lastInventory.cells.find((c) => c.cell === k);
    learnPrint(name, print, seen && seen.print && similarity(seen.print, print) > 0.98 ? seen.image : null);
    return;
  }
  if (!entry) { say(`${name} has no known price, so it is not counted.`, true); return; }
  reader.pin(k, entry.name, item.stackSize || 1);
  say(`Counting ${entry.name}${item.stackSize > 1 ? ` ×${item.stackSize}` : ''} in that slot: ${Math.round(entry.chaos * (item.stackSize || 1) * 10) / 10}c. It shows up in the loot at the next inventory read.`);
}

// When logged in, the pictures kept on this PC that the shared database lacks are sent
// to it: one database for everyone. The database's own limits decide what is taken.
async function offerLocalItems({ announce = false, retry = false } = {}) {
  if (!shared) return;
  if (!shared.canUpload) { if (announce) say('You are not logged in, so nothing can be sent. Log in at the bottom of the sidebar.', true); return; }
  if (shared.status.error && !retry) return;
  if (retry) { shared.status.error = null; await shared.load(); }
  for (const l of learned) {
    if (!l.name) continue;
    try { shared.queue(l.name, decodePrint(l.print), { auto: !!l.auto }); } catch (_) { /* skip a broken entry */ }
  }
  // Only what the database does not hold yet is worth a request.
  shared.pending = shared.pending.filter((p) => !shared.items.some((e) => similarity(e.print, p.print) > 0.97));
  const before = shared.status.uploaded;
  if (shared.pending.length) await shared.flush();
  index.setShared(shared.items); itemsRev++;
  const sent = shared.status.uploaded - before;
  if (shared.status.error) say(`The item database did not take it: ${shared.status.error}`, true);
  else if (announce) say(sent ? `Sent ${sent} ${sent === 1 ? 'picture' : 'pictures'} to the item database. Everyone's app has ${sent === 1 ? 'it' : 'them'} at its next start.` : 'Everything on this PC is already in the item database.');
  push();
}

async function loadShared() {
  if (!shared) return;
  await shared.load();
  index.setShared(shared.items);
  itemsRev++;
  push();
  await offerLocalItems();
}

// What the app sees in the inventory right now and what it compared it against, for tuning.
// snapshot: without the item pictures (quicker; the F9 key and troubleshooting recordings).
async function makeDiagnostic(snapshot = false) {
  const frame = await captureFrame(config.inventory.displayId);
  const rect = gridRect(frame.width, frame.height);
  const open = isInventoryOpen(frame, rect);
  const mouse = cursorInFrame(frame);
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  const cells = [];
  const wanted = new Set();
  for (let r = 0; r < ROWS && open; r++) {
    for (let c = 0; c < COLS; c++) {
      const rgb = extractCell(frame, rect, r, c);
      if (isEmptyCell(rgb)) continue;
      const print = fingerprint(rgb);
      const hit = index.match(print);
      const top = index.suggest(print, 5);
      top.forEach((t) => wanted.add(t.name));
      cells.push({ row: r, col: c, qty: readStack(rgb), match: hit, top, rgb: b64(rgb) });
    }
  }
  const art = [];
  for (const name of (snapshot ? [] : wanted)) {
    const entry = prices.get(name);
    if (!entry || !entry.icon || !artLoader) continue;
    try { const a = await artLoader.fetchRgb(entry.icon); if (a) art.push({ name, url: entry.icon, size: a.size, rgb: b64(a.rgb) }); } catch (_) { /* skip */ }
  }
  const report = {
    version: updater && updater.current, when: new Date().toISOString(), open, snapshot,
    mouse, mouseCell: cursorCell(mouse, rect),
    logStats: logTail ? logTail.stats : null, logTrace,
    ledger: ledger.toJSON(), lastRead: lastInventory.cells.map((c) => ({ cell: c.cell, status: c.status, name: c.name, qty: c.qty, source: c.source })),
    location: session.location, inRun: !!session.current,
    frame: { width: frame.width, height: frame.height }, rect, display: { scaleFactor: frame.display.scaleFactor, size: frame.display.size },
    counts: { art: index.art.length, learned: index.learned.length, shared: index.shared.length, prices: prices.size },
    artProgress: status.inventory.art, categories: prices.toJSON().entries.reduce((m, e) => { m[e.category] = (m[e.category] || 0) + 1; return m; }, {}), cells, art,
  };
  return report;
}
// Keeps that report on this PC, and sends it to the server when logged in.
async function saveDiagnostic(snapshot = false) {
  try {
    const report = await makeDiagnostic(snapshot);
    const open = report.open;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const name = `${snapshot ? 'snapshot' : 'diagnostic'}-${stamp}.json.gz`;
    const data = zlib.gzipSync(JSON.stringify(report));
    // Kept on this PC in the app's own folder, and sent to the server when you are logged in.
    const dir = dataFile('reports');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, data);
    const closed = open ? '' : ' The inventory was not open in game, so it holds no items.';
    if (shared && shared.canUpload) {
      try {
        await shared.uploadFile(name, data);
        say(`Report sent: ${name}.${closed}`, !open);
      } catch (e) {
        say(`The report could not be sent (${e.message || e}). It is saved on this PC as ${file}.${closed}`, true);
      }
    } else {
      say(`Report saved on this PC as ${file}. To have reports sent by themselves, log in at the bottom of the sidebar.${closed}`, true);
    }
  } catch (e) {
    say(`Could not make the report: ${e.message || e}`, true);
  }
}

// ---- account and uploads ---------------------------------------------------------
// The login is kept encrypted, like the upload token. On a PC that cannot encrypt it is not
// kept at all, and the app asks again at the next start.
function loadCloud() {
  const saved = readJson('cloud.json', null) || {};
  let token = '';
  try { token = saved.token ? safeStorage.decryptString(Buffer.from(saved.token, 'base64')) : ''; } catch (_) { token = ''; }
  cloud = new Cloud({
    fetchImpl: webFetch, saved: { ...saved, token },
    save: (state) => writeJson('cloud.json', { ...state, token: state.token && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(state.token).toString('base64') : '' }),
  });
}
// What goes up: each saved session with the name of its strategy, and the pictures file of each of its maps.
const cloudSource = {
  ids: () => (archive ? archive.list().map((x) => x.id) : []),
  session: (id) => {
    const s = archive && archive.get(id);
    if (!s) return null;
    const st = config.strategies.find((x) => x.id === strategyOf(s));
    return { ...s, strategy: { name: st ? st.name : '', atlasUrl: st ? st.atlasUrl || '' : '' } };
  },
  pictures: (runId) => { try { return fs.readFileSync(snapshots.file(runId), 'utf8'); } catch (_) { return null; } },
};
function syncCloud() {
  if (!cloud || !cloud.signedIn || cloud.busy) return;
  cloud.sync(cloudSource).then(push, (e) => console.error('upload failed', e.message));
  push();
}
// A session deleted here comes off the server too.
function dropSession(id) {
  const runIds = archive.remove(id);
  for (const runId of runIds) if (snapshots) snapshots.remove(runId);
  if (cloud) { cloud.forget(id, runIds); syncCloud(); }
}
// What the account window asks for. Answers { error } with '' when it worked.
async function accountAction(a) {
  if (!cloud || !a) return { error: 'Accounts are not switched on in this version.' };
  let error = '';
  if (a.type === 'register') error = await cloud.register(a.name, a.password, a.again);
  else if (a.type === 'login') error = await cloud.login(a.name, a.password);
  else if (a.type === 'logout') await cloud.logout();
  else if (a.type === 'delete') error = await cloud.deleteAccount(a.password);
  else if (a.type === 'sync') syncCloud();
  if (!error && (a.type === 'register' || a.type === 'login')) { syncCloud(); offerLocalItems().catch((e) => console.error('offer failed', e.message)); }
  if (a.type !== 'sync') { if (trouble) trouble.event('account', { type: a.type, error: error || undefined }); registerHotkeys(); }
  push();
  return { error };
}

// ---- troubleshooting and developer tools ------------------------------------------------
// The Troubleshooting page and its record key are there for admins and moderators; the
// Developer tools in Settings for admins. The server decides who is which.
const canTrouble = () => !!(cloud && cloud.signedIn && cloud.role);
const isAdmin = () => !!(cloud && cloud.signedIn && cloud.role === 'admin');
function setupTrouble() {
  trouble = new Troubleshoot({
    dir: dataFile('recordings'),
    recorder: new ScreenRecorder({ page: path.join(__dirname, 'ui', 'recorder.html'), preload: path.join(__dirname, 'recorder-preload.js') }),
    displayId: () => config.inventory.displayId,
    snapshot: async () => {
      let inventory = null;
      try { inventory = await makeDiagnostic(true); } catch (e) { inventory = { problem: e.message || String(e) }; }
      return { state: { ...buildState(), logTrace, logStats: logTail ? logTail.stats : null }, inventory };
    },
    who: () => ({ name: cloud && cloud.signedIn ? cloud.name : '', role: cloud ? cloud.role : '' }),
    version: require('../package.json').version, // the exact commit is filled in once the updater knows it
    cloud, fetchImpl: webFetch, say,
    changed: () => { troubleRev++; push(); },
  });
  // Admins and moderators see everyone's recordings: the reports repository is looked at once a minute.
  const look = () => { if (trouble && canTrouble() && !trouble.current) trouble.syncRemote().catch(() => {}); };
  setTimeout(look, 8000);
  setInterval(look, 60 * 1000);
  // What the app writes to its console goes into a recording too.
  for (const level of ['log', 'warn', 'error']) {
    const was = console[level].bind(console);
    console[level] = (...args) => { was(...args); if (trouble) trouble.event('console', { level, text: args.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ') }); };
  }
}
// The record key and the Record button: starts a recording, or stops the one running.
async function toggleRecording() {
  if (!trouble) return;
  if (!trouble.current && !canTrouble()) { say('Recording is for admins and moderators. Log in with such an account.', true); push(); return; }
  await trouble.toggle();
  syncKeyHook();
  push();
}
// What the Developer tools ask for. Only admins get an answer from the server.
async function devAction(a) {
  if (!cloud || !isAdmin()) return { error: 'Only admins can use the Developer tools.' };
  if (a.type === 'users') return cloud.users();
  if (a.type === 'setRole') { const error = await cloud.setRole(String(a.name || ''), String(a.role || '')); return { error }; }
  if (a.type === 'github') { const g = await cloud.github(); return g.error ? g : { repo: g.repo, hasToken: !!g.token, tokenEnd: g.token ? g.token.slice(-4) : '', by: g.by, at: g.at }; }
  if (a.type === 'setGithub') {
    const patch = {};
    if (a.repo !== undefined) patch.repo = String(a.repo || '').trim();
    if (a.token !== undefined) patch.token = String(a.token || '').trim();
    const r = await cloud.setGithub(patch);
    return r.error ? r : { ok: true };
  }
  return { error: 'Unknown request.' };
}


function loadLearned() {
  backlog.load(readJson('unrecognised.json', []), decodePrint);
  learned = readJson('learned.json', []);
  seenItems = readJson('seen.json', {}) || {};
  reader.ignoreNames = new Set(config.ignoredItems || []);
  for (const l of learned) indexLearned(l);
}

// ---- updates ---------------------------------------------------------------------
async function checkUpdate() {
  if (!updater || status.update.checking || status.update.applying) return;
  status.update.checking = true;
  push();
  try {
    await updater.check();
    status.update.error = null;
    status.update.checkedAt = Date.now();
  } catch (e) {
    status.update.error = e.message || String(e);
  } finally {
    status.update.checking = false;
    status.update.current = updater.current;
    status.update.latest = updater.latest;
    status.update.available = updater.available;
    push();
  }
}

// Hotkeys, the key listener and the helper programs: all let go, each on its own so one failure
// does not keep the rest.
function releaseEverything() {
  for (const step of [
    () => globalShortcut.unregisterAll(),
    () => watch.stop(),
    () => { clearInterval(timedTimer); },
    () => { if (hook) { hook.uIOhook.removeAllListeners(); hook.uIOhook.stop(); hook = null; hookListening = false; } },
    () => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); },
  ]) { try { step(); } catch (_) { /* closing anyway */ } }
}

// Starts the app again after it has fully closed. The new copy is told which copy it replaces
// and waits until that one is gone before it starts (see the top of the start section):
// starting while the old one was still shutting down left it without a window. Electron starts
// it, so no command window shows on the way.
function restartApp() {
  const args = process.argv.slice(1).filter((a) => !String(a).startsWith('--after-pid='));
  app.relaunch({ args: [...args, `--after-pid=${process.pid}`] });
  // Give back everything this copy holds before it goes: a copy that lingers with its hotkeys
  // still taken leaves the new one unable to use them.
  releaseEverything();
  app.exit(0);
}

// Puts a shortcut on the Desktop that starts the app directly, with no command window.
function makeShortcut() {
  if (process.platform !== 'win32') { say('Shortcuts are only made on Windows.', true); return; }
  const link = path.join(app.getPath('desktop'), 'Map Companion.lnk');
  const ok = shell.writeShortcutLink(link, app.isPackaged
    ? { target: process.execPath, description: 'Map Companion' }
    : { target: process.execPath, args: `"${app.getAppPath()}"`, cwd: app.getAppPath(), description: 'Map Companion', icon: path.join(app.getAppPath(), 'build', 'icon.ico'), iconIndex: 0 });
  say(ok ? 'A "Map Companion" shortcut is on your Desktop. Start the app with it from now on.' : 'The shortcut could not be made.', !ok);
}

async function applyUpdate() {
  if (!updater || status.update.applying) return;
  status.update.applying = true;
  status.update.error = null;
  status.update.step = 'Downloading';
  push();
  try {
    if (!updater.latest) await updater.check();
    // The installed program cannot fetch new components itself; such an update needs the new installer.
    const { depsChanged } = await updater.apply(undefined, { refuseDepsChange: app.isPackaged });
    if (depsChanged) { status.update.step = 'Installing new parts (this can take a minute)'; push(); await updater.installDeps(); }
    writeJson('session.json', session.toJSON());
    writeJson('ledger.json', ledger.toJSON());
    writeJson('trades.json', book.toJSON());
    // Long enough for the window to show that the app is about to close and come back.
    status.update.step = 'Restarting';
    push();
    await new Promise((r) => setTimeout(r, 700));
    restartApp();
  } catch (e) {
    status.update.applying = false;
    status.update.step = '';
    status.update.error = e.message || String(e);
    push();
  }
}

// ---- clipboard (read once per hotkey press or button click) --------------------
// count: over the inventory, also name or count the item's slot (the check key does; the price
// check key and nothing else does not).
function checkText(text, { count = true } = {}) {
  const item = parseItemText(text);
  if (!item) { priceCheck = { error: 'The clipboard does not hold a Path of Exile item. Hover an item in game and press Ctrl+C first.', at: Date.now() }; return; }
  if (item.isMap) {
    const mods = checkMods(item.mods, config.mapRules);
    mapCheck = {
      at: Date.now(), name: item.baseType || item.name, tier: item.mapTier, quantity: item.quantity,
      rarity: item.rarityBonus, packSize: item.packSize, corrupted: !!item.corrupted, unidentified: !!item.unidentified,
      mods, dangerCount: mods.filter((m) => m.dangerous).length,
    };
    const base = item.baseType || item.name;
    const mapEntry = (item.mapTier && prices.get(`${base} (T${item.mapTier})`)) || prices.get(base);
    if (count) nameUnderCursor(item, base, mapEntry);
    return;
  }
  const name = priceName(item);
  const entry = prices.get(name);
  startTradeCheck(item, { always: !count });
  priceCheck = {
    at: Date.now(), name, qty: item.stackSize, found: !!entry,
    each: entry ? entry.chaos : 0, total: entry ? entry.chaos * item.stackSize : 0,
  };
  if (count) nameUnderCursor(item, entry ? entry.name : name, entry);
}

// ---- trade site search for gear (rares, magic items, rolled uniques) -------------------
// A listing's price in chaos, or null when the app has no rate for its currency.
function chaosOfPrice(amount, currency) {
  if (currency === 'chaos') return amount;
  const each = prices.chaosOf(currencyName(currency));
  return each > 0 ? amount * each : null;
}
// always: search whatever the item is (the price check key). Otherwise, with the key that
// also counts loot, a search is only sent where it says something without any ticking.
// A price check that is not a search: what the window shows for currency and other things
// poe.ninja prices (kind 'price'), and the uniques an unidentified one can be (kind 'pick').
const checkBase = (extra) => ({ at: Date.now(), rev: ++tradeRev, filtersRev: 0, state: 'idle', error: '', total: 0, listings: [], url: '', summary: null, searchedAt: 0, inGame: false, ninja: null, icon: null, ...extra });
const CATEGORY_NAMES = Object.fromEntries(CATEGORY_LABELS.flatMap(([, list]) => list));
function quickPrice(item) {
  const entry = prices.get(priceName(item));
  if (!entry) return;
  tradeCheck = checkBase({
    kind: 'price', filters: { ok: false, why: '' }, icon: entry.icon || null, ninja: entry.chaos,
    url: exchangeUrl(config.league, entry.name),
    price: { name: entry.name, category: CATEGORY_NAMES[entry.category] || entry.category || '', each: entry.chaos, qty: item.stackSize || 1, change: entry.change ?? null, spark: entry.spark || null, listings: entry.listings ?? null },
  });
  showCheckPanel();
}
function pickUnique(item) {
  const base = item.baseType;
  const choices = prices.uniquesOfBase(base);
  const why = choices.length ? `Unidentified ${base}: it can be ${choices.length === 1 ? choices[0].name : `any of ${choices.length} uniques`}. Pick which in the window over the game.` : `Unidentified ${base}: no unique on this base has a price on poe.ninja. Identify it first.`;
  tradeCheck = checkBase({ kind: 'pick', filters: { ok: false, why }, item, choices, picked: '', base, why });
  if (choices.length === 1) { pickChoice(choices[0].name); return; }
  if (choices.length) showCheckPanel();
}
// name: one of the choices, or '' to go back to the list.
function pickChoice(name) {
  const tc = tradeCheck;
  if (!tc || tc.kind !== 'pick') return;
  const ch = tc.choices.find((c) => c.name === name);
  Object.assign(tc, { state: 'idle', error: '', total: 0, listings: [], url: '', summary: null, searchedAt: 0, iconW: 0, iconH: 0 });
  if (!ch) Object.assign(tc, { picked: '', filters: { ok: false, why: tc.why }, ninja: null, icon: null });
  else {
    let filters;
    try { statIndex = statIndex || StatIndex.load(); filters = buildFilters({ ...tc.item, name: ch.name, unidentified: false }, statIndex); } catch (e) { filters = { ok: false, why: `The list of trade stats could not be read: ${e.message || e}` }; }
    Object.assign(tc, { picked: ch.name, filters, ninja: ch.chaos, icon: ch.icon });
  }
  tc.filtersRev += 1; tc.rev = ++tradeRev;
  push();
  if (ch && tc.filters.ok && (config.priceSearch || {}).auto !== false) runTradeSearch(false);
}

function startTradeCheck(item, { always = false } = {}) {
  tradeCheck = null;
  if (!searchable(item)) { quickPrice(item); return; }
  if (item.rarity === 'Unique' && item.unidentified) { pickUnique(item); return; }
  let filters;
  try {
    statIndex = statIndex || StatIndex.load();
    filters = buildFilters(item, statIndex);
  } catch (e) {
    filters = { ok: false, why: `The list of trade stats could not be read: ${e.message || e}` };
  }
  tradeCheck = { at: Date.now(), rev: ++tradeRev, filtersRev: 0, filters, state: 'idle', error: '', total: 0, listings: [], url: '', summary: null, searchedAt: 0, inGame: false };
  const entry = prices.get(priceName(item));
  tradeCheck.ninja = entry ? entry.chaos : null; // what poe.ninja says, for uniques
  tradeCheck.icon = entry && entry.icon ? entry.icon : null; // a unique's picture; others get theirs from the search
  if (filters.ok) showCheckPanel();
  // The price check key searches at once, with what is ticked from the start. The check key is
  // also pressed just to count loot, so there a unique (it has a poe.ninja price already) and
  // an item with nothing ticked (it would only find the cheapest of its kind) wait for the button.
  const worthIt = always || (item.rarity !== 'Unique' && isNarrow(filters));
  if (filters.ok && worthIt && (config.priceSearch || {}).auto !== false) runTradeSearch(true);
}
// announce: say the outcome in game, as the check key's own message does.
async function runTradeSearch(announce) {
  const tc = tradeCheck;
  if (!tc || !tc.filters.ok || tc.state === 'searching') return;
  tc.state = 'searching'; tc.error = ''; tc.rev = ++tradeRev;
  push();
  try {
    const r = await tradeClient.check(config.league, buildQuery(tc.filters));
    tc.compare = compareSpec(tc.filters);
    tc.listings = markBait(r.listings.map((l) => readListing(l, chaosOfPrice, tc.compare)));
    // The item's own picture: a listing of the same base looks the same (a unique has its own).
    // Its size too (for where the sockets go), even when the picture came from poe.ninja.
    const same = tc.listings.find((l) => l.icon && tc.filters.type && l.base === tc.filters.type.value) || (tc.filters.name ? tc.listings.find((l) => l.icon) : null);
    if (same) { if (!tc.icon) tc.icon = same.icon; if (same.w) { tc.iconW = same.w; tc.iconH = same.h; } }
    tc.total = r.total;
    tc.url = r.queryId ? searchUrl(config.league, r.queryId) : '';
    tc.summary = summarize(r.total, tc.listings.filter((l) => !l.bait)); // a bait price is not what it sells for
    tc.state = 'done'; tc.searchedAt = Date.now();
  } catch (e) {
    tc.state = 'error'; tc.error = e.message || String(e);
  }
  tc.rev = ++tradeRev;
  if (tradeCheck !== tc) return; // another item was checked meanwhile
  if (announce && !tc.inGame) showToast(tradeMessage(tc, prices.divine)); // the window in game says it itself
  push();
}

// The price check window on top of the game. It opens beside the game panel the mouse is over.
// coins: the pictures of the currencies prices are asked in.
function coinIcons(listings) {
  const out = {};
  for (const id of new Set(['chaos', 'divine', ...(listings || []).map((l) => l.price && l.price.currency).filter(Boolean)])) {
    const e = prices.get(id === 'chaos' ? 'Chaos Orb' : currencyName(id));
    if (e && e.icon) out[id] = e.icon;
  }
  return out;
}
const checkPanelData = () => ({ ...tradeCheck, divine: prices.divine, auto: config.priceSearch.auto !== false, coins: coinIcons(tradeCheck && tradeCheck.listings) });
function showCheckPanel() {
  if (!checkPanel || !overlay || config.priceSearch.overlay === false || layoutWin) return;
  if (!overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() })) return;
  tradeCheck.inGame = true;
  checkPanel.show(checkPanelData(), { bounds: overlay.display().bounds, cursor: screen.getCursorScreenPoint(), custom: checkPlacement() });
}

// One press of the check hotkey: copy the hovered item (a single Ctrl+Alt+C sent to the game, the
// same thing price-check tools do), then read the clipboard once.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function checkHovered({ count = true } = {}) {
  const started = Date.now();
  if (checkPanel) { checkPanel.hide(); if (tradeCheck) tradeCheck.inGame = false; } // the last item's window goes; a new one opens if this is gear
  if (config.inventory.autoCopy && hook) {
    const before = clipboard.readText();
    try {
      clipboard.writeText('');
      // With Alt the game copies its fuller text, which also names each modifier's tier.
      if (trouble) trouble.ownKeys(300);
      await copyItem(hook);
      if (trouble) trouble.ownKeys(20); // the last released keys arrive a moment later; yours after that are yours
      let text = '';
      for (let i = 0; i < 16 && !text; i++) { await sleep(25); text = clipboard.readText(); }
      if (!text) { clipboard.writeText(before); say('No item under the mouse in game. Hover an item and press the key again.', true); showCheckToast(started); changed(); return; }
      checkText(text, { count });
    } catch (e) {
      // Whatever went wrong is said as it is, not passed off as an empty clipboard.
      clipboard.writeText(before);
      say(`The item could not be checked: ${e.message || e}`, true);
    }
  } else if (config.inventory.autoCopy) {
    // The app is meant to copy the item itself but cannot press keys: say so, as what is on
    // the clipboard is then not the item under the mouse.
    say('The item was not copied, because the part of the app that presses keys in the game could not be loaded. Restart the app; if this stays, reinstall it.', true);
  } else {
    checkText(clipboard.readText(), { count });
    // With copying switched off, an empty hand is most likely the setting, so name it.
    if (priceCheck && priceCheck.error && priceCheck.at >= started) priceCheck.error = 'Nothing to check: "Check item price" is switched off (Settings, Price check). Switch it on, or press Ctrl+C on the item before the key.';
  }
  showCheckToast(started);
  changed();
}

// The price check window over the game goes; the search stays on the Prices page.
function closeCheckPanel() { if (checkPanel) checkPanel.hide(); if (tradeCheck) tradeCheck.inGame = false; }
// What the check key just did, in a line or two, shown in game for a moment.
function showCheckToast(started) {
  if (tradeCheck && tradeCheck.at >= started && tradeCheck.inGame) return; // its own window is on screen
  showToast(checkMessage({ mapCheck, priceCheck, tradeCheck, notice, divine: prices.divine }, started));
}
// always: shown even when the message after the check key is turned off (reading alerts have their own switch).
function showToast(message, always = false) {
  if (trouble) trouble.event('toast', { message, always: always || undefined });
  if (!toast || (!always && config.checkToast === false) || !message) return;
  if (!overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() })) return;
  // Tall enough for a two-line headline and three lines of small print; a problem stays longer.
  toast.show(overlayBounds(overlay.display(), 112, toastPlacement()), message, message.bad ? 6000 : 2500);
}

let gameKeysOn = false; // the keys that only mean something in the game are held right now
let gameKeysTaken = []; // those of the chat command keys another app already holds
let keysPaused = null; // a timer while a key is being chosen in Settings: the app holds none of its keys then
function registerHotkeys() {
  if (keysPaused) return; // they are taken again when the choice has been made
  globalShortcut.unregisterAll();
  gameKeysOn = false;
  status.hotkeys = { clipboard: false, snapshot: false, priceCheck: false, tradeNext: false, tradeDismiss: false, layout: false };
  // Keys that only mean something in the game are held only while the game is in front.
  // Anywhere else they stay with the program you are in (Ctrl+D bookmarks, F5 refreshes).
  gameKeysOn = watch.gameInFront();
  const noted = (job, accel, fn) => () => { if (trouble) trouble.event('hotkey', { job, key: accel }); return fn(); };
  const reg = (key, accel, fn) => {
    if (!accel) return;
    try { status.hotkeys[key] = globalShortcut.register(accel, noted(key, accel, fn)); } catch (_) { status.hotkeys[key] = false; }
  };
  reg('clipboard', config.hotkeys.clipboard, () => { checkHovered(); });
  reg('snapshot', config.hotkeys.snapshot, () => { saveDiagnostic(true).then(changed); });
  // Held for admins and moderators only (and while a recording runs, so it can always be stopped).
  if (canTrouble() || (trouble && trouble.current)) reg('record', config.hotkeys.record, () => { toggleRecording(); });
  // The price check key: the same check without naming or counting anything.
  status.hotkeys.priceCheckHeld = gameKeysOn && !!config.hotkeys.priceCheck;
  if (gameKeysOn) reg('priceCheck', config.hotkeys.priceCheck, () => { checkHovered({ count: false }); });
  const hk = config.trade.hotkeys, taken = [];
  const extra = (accel, fn) => { if (!accel) return; try { if (!globalShortcut.register(accel, noted('chat or trade key', accel, fn))) taken.push(accel); } catch (_) { taken.push(accel); } };
  // Layout mode places every part of the overlay (the price check window and the check message
  // as well as the trade offers), so its key does not wait for trade offers to be switched on.
  reg('layout', hk.layout, () => toggleLayout());
  if (config.trade.enabled) {
    reg('tradeNext', hk.next, () => { const o = book.firstActionable(); if (o) tradeDo(o.id, 'next').then(changed); });
    for (const action of ['invite', 'trade', 'busy', 'still', 'whisper']) {
      extra(hk[action], () => { const o = book.latestIncoming(); if (o) tradeDo(o.id, action).then(changed); else { say('No buyer to act on.'); changed(); } });
    }
    reg('tradeDismiss', hk.dismiss, () => { const o = book.offers[0]; if (o) { book.remove(o.id); saveTradesSoon(); changed(); } });
  }
  // /hideout and /remaining are plain chat commands, so they work whether or not trade offers
  // are read. They are only held while the game is in front, so F5 still refreshes a browser page.
  const mine = [hk.hideout, hk.remaining].filter(Boolean);
  if (gameKeysOn) {
    const before = taken.length;
    extra(hk.hideout, () => sendChat('/hideout').then(changed));
    extra(hk.remaining, () => sendChat('/remaining').then(changed));
    gameKeysTaken = taken.splice(before);
  }
  gameKeysTaken = gameKeysTaken.filter((k) => mine.includes(k)); // remembered while you are away from the game
  status.hotkeys.tradeTaken = [...taken, ...gameKeysTaken];
}

// While a key is being chosen in Settings, the app lets go of its own keys, so that the key
// being pressed reaches the window instead of doing its job, and the window's own menu keys
// (Ctrl+R, Ctrl+W, F11) are left alone for the same reason. Everything is taken back when the
// choice has been made, and by itself after a while in case the window never says so.
const KEYS_PAUSE_MS = 20000;
function pauseKeys(on) {
  clearTimeout(keysPaused);
  keysPaused = on ? setTimeout(() => pauseKeys(false), KEYS_PAUSE_MS) : null;
  try { if (win && !win.isDestroyed()) win.webContents.setIgnoreMenuShortcuts(!!on); } catch (_) { /* the keys still come back below */ }
  if (on) { try { globalShortcut.unregisterAll(); } catch (_) { /* nothing was held */ } }
  else { registerHotkeys(); push(); }
}

// ---- trade offers ---------------------------------------------------------------
function tradeState() {
  const s = book.summary(prices);
  return { ...s, divine: prices.divine, labels: LABELS, defaultMessages: DEFAULT_MESSAGES,
    overlayInfo: { on: !!config.trade.overlay, helper: watch.running, front: watch.running ? watch.name : '', allowed: overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() }), layoutOpen: !!layoutWin },
    canSend: !!hook && watch.running, sendProblem: !hook ? 'the keyboard helper is not installed' : (watch.running ? '' : 'the app cannot tell which window is in front on this PC'), hotkeys: config.trade.hotkeys, enabled: config.trade.enabled };
}
function saveTradesSoon() {
  clearTimeout(tradeSaveTimer);
  tradeSaveTimer = setTimeout(() => writeJson('trades.json', book.toJSON()), 1000);
}
const tradePlacement = () => ({ position: config.trade.position, offsetX: config.trade.offsetX, offsetY: config.trade.offsetY, custom: (config.overlayLayout || {}).trade || null });

// Everything that can be placed on the overlay. A new overlay part gets a line here and can
// then be dragged in layout mode like the rest. sample: its height in layout mode.
// The check key's message: top centre, a little below the trade offers' default "top" spot.
const toastPlacement = () => ({ position: 'top', offsetY: 9, custom: (config.overlayLayout || {}).toast || null });

// The price check window: beside the inventory or stash unless it has been dragged somewhere.
const checkPlacement = () => (config.overlayLayout || {}).check || null;

const WIDGETS = [
  { id: 'trade', label: 'Trade offers', sample: 84, placement: tradePlacement },
  { id: 'toast', label: 'Check key message', sample: 112, placement: toastPlacement },
  // Its default spot is shown as for an item in the inventory.
  { id: 'check', label: 'Price check', bounds: (d) => checkPanelBounds(d.bounds, d.bounds.x + d.bounds.width, 300, checkPlacement()) },
];

// Layout mode: a see-through window over the whole game screen with a stand-in for each
// overlay part, to drag where you want it. Opened and closed with its own key.
function layoutData() {
  const d = overlay.display();
  return {
    hotkey: config.trade.hotkeys.layout,
    widgets: WIDGETS.map((w) => {
      const r = w.bounds ? w.bounds(d) : overlayBounds(d, w.sample, w.placement());
      return { id: w.id, label: w.label, x: r.x - d.bounds.x, y: r.y - d.bounds.y, width: r.width, height: r.height, moved: !!(config.overlayLayout || {})[w.id] };
    }),
  };
}
function toggleLayout() {
  if (layoutWin) { layoutWin.close(); return; }
  if (!overlay) return;
  const d = overlay.display();
  layoutWin = new BrowserWindow({
    ...d.bounds, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, title: 'Map Companion layout',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  layoutWin.setAlwaysOnTop(true, 'screen-saver');
  layoutWin.setMenuBarVisibility(false);
  layoutWin.loadFile(path.join(__dirname, 'ui', 'layout.html'));
  layoutWin.once('ready-to-show', () => { if (layoutWin) { layoutWin.setBounds(d.bounds); layoutWin.show(); layoutWin.focus(); } });
  layoutWin.on('closed', () => { layoutWin = null; push(); });
  syncOverlay();
}
// rects: what the layout window reports, [{ id, x, y, width, height }] in its own points.
function saveLayout(rects, screenSize) {
  const next = { ...(config.overlayLayout || {}) };
  for (const r of Array.isArray(rects) ? rects : []) {
    if (!WIDGETS.some((w) => w.id === r.id) || ![r.x, r.y, r.width, r.height].every(Number.isFinite)) continue;
    if (r.reset) delete next[r.id];
    else next[r.id] = placementFromRect(r, screenSize);
  }
  applyConfig({ overlayLayout: next });
}

function syncOverlay() {
  if (!overlay) return;
  const t = config.trade;
  const data = tradeState();
  // Away from the game (alt-tab, another program in front) nothing is drawn over the screen.
  const allowed = overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() });
  const on = t.enabled && t.overlay && allowed;
  overlay.update(data, {
    show: on && data.offers.length > 0 && !layoutWin, // in layout mode a stand-in is shown instead
    displayId: config.inventory.displayId,
    placement: tradePlacement(),
  });
}

// Sends one chat line to the game. Returns true when it went out.
// Nothing is typed unless Path of Exile is confirmed to be the window in front: keys go to
// whatever window has the keyboard, so typing blind could put the line in a browser or a chat.
// auto: the line is not the result of a click or key press, so the game window is never pulled
// to the front for it and failures stay quiet. send: false leaves the line unsent in the chat box.
async function sendChat(text, { auto = false, send = true } = {}) {
  if (trouble) trouble.event('chat', { text, auto, send, busy: chatBusy || undefined });
  if (chatBusy) return false;
  if (auto && !(hook && watch.gameInFront())) return false;
  if (!hook) { say('Nothing was sent: the keyboard helper is not installed, so the app cannot type in the game. Run npm install in the app folder.', true); return false; }
  if (!watch.running) { say('Nothing was sent: the app cannot tell which window is in front on this PC, so it will not type. Offers are still listed.', true); return false; }
  chatBusy = true;
  try {
    if (!auto && !watch.gameInFront()) {
      // The click came from another window (this app's own, usually): hand the keyboard to the game.
      const asked = Date.now();
      const got = await focusGame();
      if (got === 'none') { say('Nothing was sent: Path of Exile is not running.', true); return false; }
      if (!(await watch.waitForGame(2500, asked))) {
        say('Nothing was sent: the app could not bring the game window to the front. Click the game first, then use the button or the next-step key.', true);
        return false;
      }
      await sleep(120);
    }
    if (!watch.gameInFront()) { say('Nothing was sent: the game is not the window in front.', true); return false; }
    if (trouble) trouble.ownKeys(500);
    return await typeChat(hook, clipboard, text, { send });
  } catch (e) {
    if (!auto) say(`Nothing was sent: ${e.message || e}`, true);
    return false;
  } finally {
    chatBusy = false;
  }
}

// Steps the app takes by itself (after a trade, or on a party invite), one chat line each with
// a pause between. Only while the game is in front; whatever cannot be sent stays on the
// offer's buttons for you to press.
let autoQueue = Promise.resolve();
function autoRun(offer, steps) {
  if (!offer || !steps.length || offer.test) return;
  const opts = { messages: config.trade.messages, characterName: config.characterName };
  const lines = steps.map((action) => ({ action, text: chatCommand(action, offer, opts) })).filter((l) => l.text);
  autoQueue = autoQueue.then(async () => {
    await sleep(40); // let the trade window close first
    for (const { action, text } of lines) {
      for (let wait = 0; chatBusy && wait < 100; wait++) await sleep(20);
      if (!(await sendChat(text, { auto: true }))) {
        say(`Trade with ${offer.player} is done, but "${text}" was not sent by itself because the game was not in front. Use the offer's buttons.`, true);
        break;
      }
      book.applied(offer.id, action);
    }
    saveTradesSoon(); changed();
  }).catch(() => {});
}

// One click or key press on an offer: at most one chat line goes to the game.
async function tradeDo(id, what) {
  const offer = book.get(id);
  if (!offer) return;
  if (what === 'dismiss') { book.remove(id); saveTradesSoon(); return; }
  const action = what === 'next' ? nextAction(offer) : what;
  if (!action) { say(`Nothing to do for ${offer.player} yet: waiting for them.`); return; }
  if (offer.test) {
    // A test offer walks through the steps without typing anything in the game.
    book.applied(id, action);
    if (action === 'invite') book.onLog({ type: 'joined', name: offer.player });
    else if (action === 'trade') book.onLog({ type: 'trade', result: 'accepted' });
    say(`Test offer: "${chatCommand(action, offer, { messages: config.trade.messages, characterName: config.characterName })}" would be typed in the game. Nothing was sent.`);
    return;
  }
  const text = chatCommand(action, offer, { messages: config.trade.messages, characterName: config.characterName });
  if (!text) { say('That message is empty. Set its text in Settings, under Trade.', true); return; }
  if (action === 'whisper') { await sendChat(text, { send: false }); return; }
  if (await sendChat(text)) { book.applied(id, action); saveTradesSoon(); }
}

let testSeq = 1;
function addTestOffer() {
  const n = testSeq++;
  const samples = [
    'Hi, I would like to buy your Tabula Rasa Simple Robe listed for 12 chaos in Standard (stash tab "Sell"; position: left 3, top 5)',
    "Hi, I'd like to buy your 40 Chaos Orb for my 1 Divine Orb in Standard.",
    'Hi, I would like to buy your Mageblood Heavy Belt listed for 180 divine in Standard (stash tab "Big sales"; position: left 14, top 2)',
  ];
  book.onLog({ type: 'whisper', dir: n % 4 === 0 ? 'out' : 'in', player: `TestExile${n}`, text: samples[(n - 1) % samples.length], test: true });
}

// ---- window --------------------------------------------------------------------
function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const second = screen.getAllDisplays().find((d) => d.id !== primary.id);
  const target = second || primary;
  win = new BrowserWindow({
    x: target.workArea.x + 40, y: target.workArea.y + 40,
    width: Math.min(1500, target.workArea.width - 80), height: Math.min(950, target.workArea.height - 80),
    backgroundColor: '#1b1f24', title: 'Map Companion', autoHideMenuBar: true, icon: path.join(__dirname, 'ui', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => { if (second) win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; if (overlay) overlay.destroy(); if (layoutWin) layoutWin.destroy(); if (toast) toast.destroy(); if (checkPanel) checkPanel.destroy(); });
}

// ---- IPC -----------------------------------------------------------------------
function applyConfig(patch) {
  if (trouble) trouble.event('setting', patch);
  const leagueBefore = config.league, logBefore = config.logPath, hookBefore = hookSetup();
  if (patch.trade) patch = { ...patch, trade: mergeTrade(config.trade, patch.trade) };
  config = {
    ...config, ...patch,
    hotkeys: { ...config.hotkeys, ...(patch.hotkeys || {}) },
    inventory: { ...config.inventory, ...(patch.inventory || {}) },
    priceSearch: { ...config.priceSearch, ...(patch.priceSearch || {}) },
  };
  writeJson('config.json', config);
  if (patch.priceSearch && config.priceSearch.overlay === false && checkPanel) { checkPanel.hide(); if (tradeCheck) tradeCheck.inGame = false; }
  if (patch.customPrices) { prices.setCustom(config.customPrices); itemsRev++; }
  if (patch.ignoredItems) { reader.ignoreNames = new Set(config.ignoredItems); reader.forgetCells(); itemsRev++; }
  // The map last checked is judged again by the mods ticked now, so its verdict follows the ticks.
  if (patch.mapRules && mapCheck) {
    const mods = checkMods(mapCheck.mods.map((m) => m.mod), config.mapRules);
    mapCheck = { ...mapCheck, mods, dangerCount: mods.filter((m) => m.dangerous).length };
  }
  if (patch.hotkeys || patch.trade) registerHotkeys();
  if (patch.trade && !config.trade.enabled) book.clearTests();
  if (config.logPath !== logBefore) startLog();
  if (config.league !== leagueBefore) refreshPrices();
  if (patch.inventory) syncTimedWatch();
  if (hookSetup() !== hookBefore) syncKeyHook();
  push();
}

const actions = {
  startRun: (a) => { session.startRun({ name: a.name || 'Manual run', loadout: config.loadout }); syncLedger(); },
  endRun: () => { session.endRun(); syncLedger(); },
  recheckMaps: () => { recheckMaps(); },
  deleteRun: (a) => { session.deleteRun(a.runId); if (snapshots) snapshots.remove(a.runId); syncLedger(); },
  // The session that ends is kept, with its values as they are now.
  newSession: () => {
    if (closeSession() === 'saved') say('The finished session is saved. Pick it from the row of sessions above the map list to look at it again.');
  },
  // Strategies: what you are farming. The running session always belongs to the active one,
  // so switching closes the session first.
  runStrategy: (a) => {
    const next = config.strategies.find((x) => x.id === a.id);
    if (!next || next.id === config.activeStrategy) return;
    const closed = closeSession();
    if (closed === false) return;
    applyConfig({ activeStrategy: next.id });
    say(`Now running ${next.name}.${closed === 'saved' ? ' The session you had open is saved under its own strategy.' : ''}`);
  },
  saveStrategy: (a) => {
    const name = String(a.name || '').trim().slice(0, 40);
    if (!name) { say('Give the strategy a name.', true); return; }
    const atlasUrl = cleanUrl(a.atlasUrl);
    if (String(a.atlasUrl || '').trim() && !atlasUrl) say('That atlas tree link was not saved: it has to start with https://', true);
    const id = String(a.id || '');
    const list = config.strategies.some((x) => x.id === id)
      ? config.strategies.map((x) => (x.id === id ? { ...x, name, atlasUrl } : x))
      : [...config.strategies, { id: id || `s${Date.now().toString(36)}`, name, atlasUrl }];
    applyConfig({ strategies: list });
  },
  deleteStrategy: (a) => {
    if (config.strategies.length < 2) { say('This is the only strategy, so it stays. Rename it instead.', true); return; }
    if (a.id === config.activeStrategy) { say('You are running this strategy. Run another one first, then delete it.', true); return; }
    if (!config.strategies.some((x) => x.id === a.id)) return;
    const gone = archive ? archive.list().filter((x) => strategyOf(x) === a.id).map((x) => x.id) : [];
    for (const id of gone) dropSession(id);
    applyConfig({ strategies: config.strategies.filter((x) => x.id !== a.id) });
  },
  deleteSession: (a) => {
    if (archive) dropSession(a.id);
  },
  addLoot: (a) => {
    if (!session.current && !a.runId) { session.startRun({ name: 'Manual run', loadout: config.loadout }); syncLedger(); }
    session.addLoot([{ name: a.name, qty: a.qty }], 'manual', a.runId || session.currentId);
  },
  removeLoot: (a) => session.removeLoot(a.runId, a.lootId),
  // A slot taken to be in the inventory before the map is loot after all. id: snap:<trip>:<cell>.
  markLoot: (a) => {
    const [, tripNo, cellNo] = String(a.id || '').split(':');
    const run = session.runs.find((r) => r.id === a.runId);
    const trip = run && snapshots ? snapshots.get(run.id).trips.find((t) => t.trip === Number(tripNo)) : null;
    const c = trip && trip.cells.find((q) => q.cell === Number(cellNo));
    if (!c || !(c.carriedQty > 0)) { say('That slot is no longer there or is already counted.', true); return; }
    const n = c.carriedQty;
    c.carried = false; c.carriedQty = 0;
    snapshots.rewrite(run.id);
    session.markSnapshot(run.id);
    // Later reads of this trip must not dim it again.
    if (carriedIn && carriedIn.runId === run.id && carriedIn.trip === trip.trip) {
      const b = carriedIn.cells.find((x) => x.cell === c.cell);
      if (b) { b.name = null; b.qty = 0; b.print = null; saveCarried(); }
    }
    if (!c.name) { say('Counted as loot. It has no stack number or name, so it adds nothing to the value.'); return; }
    session.addLoot([{ name: c.name, qty: n }], 'manual', run.id);
    if (run.id === session.currentId && trip.trip === (run.trip || 1) && (ledger.inMap || ledger.pendingArrival)) ledger.markLoot(c.name, n);
    say(`Counted ${n} ${c.name} as loot from this map.`);
  },
  removeLootName: (a) => session.removeLootName(a.runId, a.name),
  addCost: (a) => session.addCost(a.runId, a.cost),
  removeCost: (a) => session.removeCost(a.runId, a.costId),
  readInventory: () => readInventory(),
  learn: (a) => {
    const u = backlog.get(a.id);
    const name = String(a.name || '').trim();
    if (!u) { say('That item is no longer in the list.', true); return; }
    if (!name) { say('Type the item name first, or pick one of the suggestions.', true); return; }
    const t = teach(name, u.print, u.image);
    const fixed = recheckMaps(true);
    const also = fixed.slots ? ` Added it to ${fixed.maps} ${fixed.maps === 1 ? 'map' : 'maps'} of this session where it had not been counted.` : '';
    say(t.entry ? `Saved: ${t.name}.${also}` : `Saved as "${t.name}", but no price is known under that name, so it counts as 0c. Check the spelling if that is wrong.`, !t.entry);
  },
  ignore: (a) => {
    const u = backlog.get(a.id);
    if (u) learnPrint('', u.print, u.image);
  },
  // Takes an item off the not-recognised list without naming it. It comes back if it is seen again.
  dismissUnknown: (a) => { if (backlog.remove(a.id)) saveBacklog(); },
  clearUnknown: () => { if (backlog.clear()) saveBacklog(); },
  saveDiagnostic: () => saveDiagnostic(),
  // Troubleshooting page.
  troubleToggle: () => toggleRecording(),
  troubleNote: (a) => { if (trouble && trouble.setNote(a.id, a.note)) troubleRev++; },
  // The Refresh button: says what came in, unlike the quiet look once a minute.
  troubleSync: async (a) => {
    if (!trouble || !canTrouble()) return;
    const n = await trouble.syncRemote();
    if (!a.quiet) say(trouble.remoteError ? `Could not look for new recordings: ${trouble.remoteError}` : n ? `${n} new recording${n === 1 ? '' : 's'}.` : 'Nothing new.', !!trouble.remoteError);
  },
  troubleFixed: async (a) => {
    if (!trouble || !canTrouble()) return;
    const error = await trouble.setFixed(String(a.id || ''), !!a.fixed);
    say(error ? `Not marked: ${error}` : a.fixed ? 'Marked as fixed, for everyone.' : 'Marked as not fixed.', !!error);
  },
  troubleImageRemove: (a) => { if (trouble) trouble.removeImage(String(a.id || ''), String(a.name || '')); },
  troubleRemove: (a) => { if (trouble && trouble.remove(a.id)) { troubleRev++; say('Recording deleted.'); } },
  troubleSend: async (a) => {
    if (!trouble) return;
    if (!canTrouble()) { say('Sending recordings is for admins and moderators.', true); return; }
    const error = await trouble.send(a.id, a.note);
    troubleRev++;
    say(error ? `The recording was not sent: ${error}` : 'Recording sent. Thanks, it will be looked at.', !!error);
  },
  copyText: (a) => { clipboard.writeText(String(a.text || '').slice(0, 20000)); say('Copied. Paste it into a message to whoever is helping you.'); },
  makeShortcut: () => makeShortcut(),
  setCustomPrice: (a) => {
    const name = String(a.name || '').trim(), chaos = Number(a.chaos);
    if (!name || !isFinite(chaos) || chaos < 0) { say('Give the item a name and a price in chaos.', true); return; }
    applyConfig({ customPrices: { ...config.customPrices, [name]: chaos } });
    say(`Your price for ${name} is now ${chaos}c.`);
  },
  removeCustomPrice: (a) => {
    const next = { ...config.customPrices };
    delete next[a.name];
    applyConfig({ customPrices: next });
  },
  uploadShared: () => offerLocalItems({ announce: true, retry: true }),
  refreshShared: async () => { if (sharedLoading) return; sharedLoading = true; push(); try { await loadShared(); } finally { sharedLoading = false; } },
  // A picture in the item database gets another name, or goes. id: "mine:3" for one kept on
  // this PC, "shared:5" for one that is only in the shared database.
  renameItem: (a) => {
    const [list, n] = String(a.id || '').split(':');
    const typed = String(a.name || '').trim();
    if (!typed) { say('Type the item name first.', true); return; }
    let print = null, image = null;
    try {
      if (list === 'mine' && learned[n]) { print = decodePrint(learned[n].print); image = learned[n].image || null; }
      else if (list === 'shared' && index.shared[n]) print = index.shared[n].print;
    } catch (_) { /* a broken entry */ }
    if (!print) { say('That picture is no longer in the database.', true); return; }
    const t = teach(typed, print, image);
    const fixed = recheckMaps(true);
    const also = fixed.slots ? ` Corrected ${fixed.slots} ${fixed.slots === 1 ? 'slot' : 'slots'} in ${fixed.maps} ${fixed.maps === 1 ? 'map' : 'maps'} of this session.` : '';
    const where = shared && shared.canUpload ? ', here and for everyone' : ' on this PC';
    say(t.entry ? `That picture now counts as ${t.name}${where}.${also}` : `Saved as "${t.name}", but no price is known under that name, so it counts as 0c.`, !t.entry);
  },
  // Whether an item is counted at all. qty 0: never count it, 1: count it again.
  setCounted: (a) => {
    const name = String(a.name || '');
    if (!name) return;
    const set = new Set(config.ignoredItems || []);
    if (Number(a.qty)) set.delete(name); else set.add(name);
    applyConfig({ ignoredItems: [...set] });
    say(Number(a.qty) ? `${name} is counted again.` : `${name} is never counted from now on. Loot of it already listed stays; remove it there if you want.`);
  },
  // A clean slate: every name given by hand on this PC goes, here and (when logged in) in the
  // shared database. What the app learned by itself and the pictures you chose to ignore stay.
  removeNamed: async () => {
    const mine = learned.filter((l) => l.name && !l.auto);
    if (!mine.length) { say('There are no names given by hand on this PC.'); return; }
    const prints = [];
    for (const l of mine) { try { prints.push(decodePrint(l.print)); } catch (_) { /* a broken entry */ } }
    learned = learned.filter((l) => !l.name || l.auto);
    relearn();
    let gone = 0;
    if (shared && shared.canUpload) { gone = await shared.removeMany(prints); index.setShared(shared.items); itemsRev++; }
    say(`Removed ${mine.length} ${mine.length === 1 ? 'name' : 'names'} given by hand on this PC${gone ? `, and ${gone} of them from the shared database` : ''}. The app reads those items by itself where it can and asks you about the rest.`);
  },
  forgetItem: async (a) => {
    const [list, n] = String(a.id || '').split(':');
    let print = null;
    try {
      if (list === 'mine' && learned[n]) { print = decodePrint(learned[n].print); learned.splice(Number(n), 1); relearn(); }
      else if (list === 'shared' && index.shared[n]) print = index.shared[n].print;
    } catch (_) { /* a broken entry */ }
    if (!print) return;
    if (shared && shared.canUpload) {
      const gone = await shared.remove(print);
      index.setShared(shared.items); itemsRev++;
      if (gone) say('That picture is removed from the database for everyone.');
      else if (shared.refused && list === 'shared') say('Someone else added that picture, so only they or the owner of the item list can remove it for everyone. You can still rename it, which applies on this PC.', true);
      else say('That picture is removed from this PC.');
    } else if (list === 'shared') {
      say('Removing a picture for everyone needs an account: log in at the bottom of the sidebar. You can still rename it, which applies on this PC.', true);
    } else say('That picture is removed from this PC.');
  },
  // A slot was read wrong, or not at all, and you say what it is. id: "inv:<slot>" for the
  // inventory as last read, "snap:<trip>:<slot>" with runId for a map's kept picture.
  fixSlot: (a) => {
    const [where, x, y] = String(a.id || '').split(':');
    const typed = String(a.name || '').trim();
    if (!typed) { say('Type the item name first, or pick one of the suggestions.', true); return; }
    let print = null, image = null, live = null;
    if (where === 'inv') {
      live = lastInventory.cells.find((c) => c.cell === Number(x));
      if (live) { print = live.print; image = live.image; }
    } else if (where === 'snap' && snapshots) {
      const trip = snapshots.get(String(a.runId || '')).trips.find((t) => t.trip === Number(x));
      const c = trip && trip.cells.find((q) => q.cell === Number(y));
      if (c) {
        let cut = null;
        try { cut = cellsOfPicture(trip.image); } catch (_) { /* no picture */ }
        const rgb = cut ? cut(c.cell) : null;
        try { print = c.packed ? unpackPrint(c.packed) : null; } catch (_) { /* fall back to the picture */ }
        print = print || (rgb ? fingerprint(rgb) : null);
        image = rgb ? thumbnail(rgb) : null;
      }
    }
    if (!print) { say('That slot is no longer there. Read the inventory again and try once more.', true); return; }
    const t = teach(typed, print, image);
    const fixed = recheckMaps(true);
    if (live) {
      lastInventory = { ...lastInventory, rev: lastInventory.rev + 1, cells: lastInventory.cells.map((c) => (c.print && similarity(c.print, print) > 0.95 ? { ...c, name: t.name, status: 'item', source: 'learned', how: null, score: 100 } : c)) };
    }
    const also = fixed.slots ? ` Corrected ${fixed.slots} ${fixed.slots === 1 ? 'slot' : 'slots'} in ${fixed.maps} ${fixed.maps === 1 ? 'map' : 'maps'} of this session.` : '';
    say(`Fixed: that picture counts as ${t.name} from now on.${also}${t.entry ? '' : ' No price is known under that name, so it counts as 0c.'}`, !t.entry);
  },
  forget: (a) => {
    const name = a.name === '(ignored items)' ? '' : a.name;
    index.forget(name);
    learned = learned.filter((l) => l.name !== name);
    writeJson('learned.json', learned);
    reader.forgetCells();
  },
  trade: (a) => tradeDo(a.id, String(a.do || '')),
  layoutToggle: () => toggleLayout(),
  layoutSave: (a) => {
    const s = a.screen || {};
    if (Number(s.width) > 0 && Number(s.height) > 0) saveLayout(a.widgets, { width: Number(s.width), height: Number(s.height) });
    if (layoutWin) layoutWin.close();
  },
  layoutCancel: () => { if (layoutWin) layoutWin.close(); },
  layoutReset: () => applyConfig({ overlayLayout: {}, trade: { position: 'bottom', offsetX: 0, offsetY: 0 } }),
  // Choosing a key in Settings: see pauseKeys.
  keysPause: () => pauseKeys(true),
  keysResume: () => { if (keysPaused) pauseKeys(false); },
  // Every key back to what a fresh install has.
  resetKeys: () => {
    applyConfig({ hotkeys: { ...DEFAULT_CONFIG.hotkeys }, trade: { hotkeys: { ...DEFAULT_CONFIG.trade.hotkeys } }, inventory: { key: DEFAULT_CONFIG.inventory.key } });
    say('Every key is back to its default.');
  },
  tradeTest: () => {
    addTestOffer();
    const onGame = config.trade.enabled && config.trade.overlay;
    say(`A test offer is on the Trade page${onGame ? ', and on top of the game while the game is the window in front' : ''}. Test offers never type anything in the game.`);
  },
  tradeDismissAll: () => { for (const o of book.offers.slice()) book.remove(o.id); saveTradesSoon(); },
  tradeClear: () => { for (const o of book.offers.slice()) book.remove(o.id); saveTradesSoon(); },
  tradeForget: (a) => { book.removeHistory(String(a.id || '')); saveTradesSoon(); },
  // The Search button: what was ticked and typed replaces the choices, then one search is sent.
  tradeSearch: async (a) => {
    if (!tradeCheck || !tradeCheck.filters.ok || tradeCheck.state === 'searching') return;
    tradeCheck.filters = applyEdits(tradeCheck.filters, a.edits);
    tradeCheck.filtersRev += 1; // the other window showing this item redraws its tick boxes
    await runTradeSearch(false);
  },
  tradeClose: () => { tradeCheck = null; if (checkPanel) checkPanel.hide(); },
  // The cross on the window in game: the search stays on the Prices page.
  checkPanelClose: () => closeCheckPanel(),
  checkPickUnique: (a) => pickChoice(String(a.name || '')),
  tradeOpen: () => { if (tradeCheck && /^https:\/\/www\.pathofexile\.com\//.test(tradeCheck.url)) shell.openExternal(tradeCheck.url); },
  readClipboard: () => checkText(clipboard.readText()),
  checkText: (a) => checkText(String(a.text || '')),
  refreshPrices: () => { refreshPrices(); },
  checkUpdate: () => checkUpdate(),
  applyUpdate: () => { applyUpdate(); },
  browseLog: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose Client.txt', properties: ['openFile'], filters: [{ name: 'Client.txt', extensions: ['txt'] }] });
    if (!r.canceled && r.filePaths[0]) applyConfig({ logPath: r.filePaths[0] });
  },
};

function setupIpc() {
  ipcMain.handle('get-state', () => buildState());
  ipcMain.handle('set-config', (_e, patch) => { applyConfig(patch || {}); return true; });
  ipcMain.handle('account', (_e, a) => accountAction(a));
  // The game log check: is the file being written to, what arrived, and what the tracker did.
  ipcMain.handle('log-check', () => ({
    path: status.log.path, ok: status.log.ok, error: status.log.error, now: Date.now(),
    stats: logTail ? { ...logTail.stats } : null,
    inMap: !!(session.current && session.current.segmentStart !== null), mapName: session.current ? session.current.name || session.current.code : null,
    location: session.location, trace: logTrace.slice().reverse(),
  }));
  ipcMain.handle('inventory', () => {
    const cells = lastInventory.cells.map((c) => {
      const each = c.name ? prices.chaosOf(c.name) : 0;
      return { cell: c.cell, status: c.status, name: c.name, qty: c.qty, source: c.source, score: c.score, how: c.how, near: c.near, guess: c.guess, image: c.image, each, total: each * (c.qty || 0) };
    });
    return { rev: lastInventory.rev, at: lastInventory.at, cols: COLS, rows: ROWS, cells };
  });
  // The inventory pictures kept for one map, with each slot's value at today's prices.
  ipcMain.handle('run-snapshot', (_e, runId) => {
    const data = snapshots ? snapshots.get(String(runId || '')) : { trips: [] };
    return {
      cols: COLS, rows: ROWS,
      trips: data.trips.map((t) => ({
        trip: t.trip, at: t.at, image: t.image, stale: !!t.stale,
        cells: t.cells.map((c) => { const each = c.name ? prices.chaosOf(c.name) : 0; return { ...c, packed: undefined, each, total: each * (c.qty || 0) }; }),
      })),
    };
  });
  ipcMain.handle('items-list', () => itemDatabase());
  ipcMain.handle('saved-session', (_e, id) => (archive ? archive.get(String(id || '')) : null));
  ipcMain.handle('price-categories', () => {
    const counts = prices.categoryCounts();
    const icons = prices.categoryIcons();
    const iconOf = (name) => { const e = prices.get(name); return e && e.icon ? e.icon : null; };
    icons.Currency = iconOf('Chaos Orb') || icons.Currency;
    return {
      chaosIcon: iconOf('Chaos Orb'), divineIcon: iconOf('Divine Orb'),
      groups: CATEGORY_LABELS.map(([group, list]) => ({ group, categories: list.filter(([id]) => counts[id] || id === 'Custom').map(([id, label]) => ({ id, label, count: counts[id], icon: icons[id] || null })) }))
        .filter((g) => g.categories.length),
    };
  });
  ipcMain.handle('price-list', (_e, a) => {
    const r = prices.list(String((a && a.category) || ''), String((a && a.query) || ''), 400);
    return { total: r.total, rows: r.rows.map((e) => ({ name: e.name, chaos: e.chaos, category: e.category, icon: e.icon || null, change: e.change == null ? null : e.change, volume: e.volume == null ? null : e.volume, listings: e.listings == null ? null : e.listings, spark: e.spark || null })) };
  });
  ipcMain.handle('search', (_e, q) => prices.search(String(q || ''), 40).map((e) => ({ name: e.name, chaos: e.chaos })));
  ipcMain.handle('layout-get', () => layoutData());
  ipcMain.on('check-size', (e, h) => { if (checkPanel && checkPanel.win && e.sender === checkPanel.win.webContents) checkPanel.setHeight(h); });
  // A number typed in the price check window: it takes the keyboard for that moment, then the
  // game gets it back (only when the game had it before).
  ipcMain.on('check-keys', (e, on) => {
    if (!checkPanel || !checkPanel.win || e.sender !== checkPanel.win.webContents) return;
    if (on) { checkPanel.gameHadKeys = watch.gameInFront(); checkPanel.takeKeys(true); return; }
    checkPanel.takeKeys(false);
    if (checkPanel.gameHadKeys) focusGame().catch(() => {});
    checkPanel.gameHadKeys = false;
  });
  ipcMain.on('overlay-size', (e, h) => { if (overlay && overlay.win && e.sender === overlay.win.webContents) overlay.setHeight(h); });
  ipcMain.handle('trouble-list', () => (trouble ? trouble.list() : []));
  ipcMain.handle('trouble-details', (_e, id) => (trouble ? trouble.details(String(id || '')) : null));
  ipcMain.handle('trouble-video', async (_e, id) => {
    if (!trouble) return null;
    try { return await trouble.videoFor(String(id || '')); } catch (e) { say(`The video could not be fetched: ${e.message || e}`, true); push(); return null; }
  });
  ipcMain.handle('dev', (_e, a) => devAction(a || {}));
  // Written reports: a new one (answers its id), pictures added to it, and pictures to show.
  ipcMain.handle('trouble-new', async () => (trouble && canTrouble() ? trouble.newReport() : null));
  ipcMain.handle('trouble-add-image', (_e, id, bytes, type) => (trouble ? trouble.addImage(String(id || ''), bytes, String(type || '')) : 'Not ready.'));
  ipcMain.handle('trouble-image', (_e, id, name) => (trouble ? trouble.image(String(id || ''), String(name || '')) : null));
  ipcMain.handle('action', async (_e, a) => {
    const fn = a && actions[a.type];
    if (!fn) return false;
    // Typing a note is not news; everything else pressed in the window is.
    if (trouble && a.type !== 'troubleNote') trouble.event('action', a);
    await fn(a);
    changed();
    return true;
  });
}

// ---- start ---------------------------------------------------------------------
// Started by an update: the copy that started this one goes first.
if (afterPid(process.argv)) waitForExit(afterPid(process.argv));
// Only one copy may run. A second one (the installed program started while the copy from
// start.bat is still open, say) could not take the hotkeys, and the two would fight over the
// overlay and the saved files. The second copy brings the first to the front and closes.
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) app.quit();
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});

app.whenReady().then(() => {
  if (!firstCopy) return;
  loadConfig();
  prices.setCustom(config.customPrices);
  session.restore(readJson('session.json', null));
  ledger.restore(readJson('ledger.json', null));
  loadLearned();
  snapshots = new SnapshotStore(dataFile('snapshots'));
  try {
    const c = readJson('carried.json', null);
    if (c && Array.isArray(c.cells)) carriedIn = { ...c, cells: c.cells.map((x) => ({ ...x, print: x.print ? decodePrint(x.print) : null })) };
  } catch (_) { carriedIn = null; }
  archive = new SessionArchive(dataFile('sessions'));
  book.restore(readJson('trades.json', null));
  overlay = new Overlay({ preload: path.join(__dirname, 'preload.js'), page: path.join(__dirname, 'ui', 'overlay.html') });
  toast = new Toast({ page: path.join(__dirname, 'ui', 'toast.html') });
  checkPanel = new CheckPanel({ preload: path.join(__dirname, 'preload.js'), page: path.join(__dirname, 'ui', 'check.html'), onClose: () => { if (tradeCheck) tradeCheck.inGame = false; } });
  watch.on('change', syncOverlay);
  watch.on('change', () => { if (trouble) trouble.event('front', { game: watch.gameInFront(), own: watch.ownInFront(), name: watch.name || '' }); });
  // Away from the game nothing is drawn over the screen.
  watch.on('change', () => { if (checkPanel.visible && !overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() })) { checkPanel.hide(); if (tradeCheck) tradeCheck.inGame = false; } });
  watch.on('change', () => { if (watch.gameInFront() !== gameKeysOn) { registerHotkeys(); push(); } });
  watch.start();
  const cached = PriceTable.fromJSON(readJson('prices.json', null));
  if (cached.size > 1) { setPrices(cached); syncArt(); }

  setupIpc();
  createWindow();
  registerHotkeys();
  // A copy left behind by an earlier restart still holds the hotkeys: close it, then take them.
  // The program file alone identifies the app when it is the installed one, or the Electron that
  // lives inside this app's own folder; only a shared Electron needs the folder checked as well.
  const ownProgram = app.isPackaged || process.execPath.toLowerCase().startsWith(app.getAppPath().toLowerCase());
  closeLeftovers({ appDir: ownProgram ? '' : app.getAppPath() }).then((n) => {
    if (!n) return;
    registerHotkeys();
    say(`Closed ${n} leftover ${n === 1 ? 'copy' : 'copies'} of the app that ${n === 1 ? 'was' : 'were'} still running without a window and holding the hotkeys.`);
    push();
  });
  startLog();
  syncKeyHook();
  syncTimedWatch();
  refreshPrices();
  setInterval(refreshPrices, PRICE_REFRESH_MS);
  setInterval(() => {
    const sec = Number(config.trade.auto.closeBoughtSec) || 0;
    if (sec > 0 && book.closeBought(sec * 1000)) saveTradesSoon();
    push();
  }, 5000);

  loadCloud();
  setupTrouble();
  registerHotkeys(); // the record key goes with the role kept from the last login
  // The role may have been given or taken since the last start.
  cloud.refresh().then((moved) => { if (moved) { registerHotkeys(); push(); } }, () => {});
  shared = new SharedItems({ cloud });
  loadShared();
  setInterval(loadShared, SHARED_REFRESH_MS);
  setTimeout(syncCloud, 5000);
  setInterval(syncCloud, CLOUD_RETRY_MS);

  updater = new Updater(app.getAppPath(), webFetch);
  status.update.current = updater.current;
  if (updater.current && updater.current.sha) trouble.version = updater.current.sha;
  checkUpdate();
  setInterval(checkUpdate, UPDATE_CHECK_MS);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  watch.stop();
  clearInterval(timedTimer);
  if (hook) { try { hook.uIOhook.stop(); } catch (_) { /* closing anyway */ } }
  writeJson('session.json', session.toJSON());
  writeJson('ledger.json', ledger.toJSON());
  writeJson('trades.json', book.toJSON());
  writeJson('seen.json', seenItems);
});
// The overlay is a window too, so quitting hangs on the main window alone.
app.on('window-all-closed', () => app.quit());
