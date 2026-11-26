'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, dialog, screen, shell, safeStorage, session: webSessions } = require('electron');
const APP_VERSION = require('../package.json').version;

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
const { captureFrame, cursorInFrame, cursorOnDisplay, judge: judgeCapture, warmUp: warmUpCapture, shutDown: stopCapture, watchOwnWindows } = require('./capture');
const { ArtLoader } = require('./art');
const { Updater } = require('./updater');
const { webFetch } = require('./http');
const { SharedItems } = require('./shared');
const { Cloud } = require('./cloud');
const tracker = require('./tracker');
const { SnapshotStore, SessionArchive, markCarried, recheckCells } = require('./core/store');
const { Backlog } = require('./core/inventory/backlog');
const { checkMessage, noteMessage, tradeMessage } = require('./core/checkMessage');
const { TradeBook, chatCommand, nextAction, autoSteps, overlayAllowed, overlayBounds, placementFromRect, DEFAULT_MESSAGES, LABELS } = require('./core/trade');
const { focusGame, typeChat, typeSearch, copyItem } = require('./chat');
const { Overlay, Toast, CheckPanel, SearchMenu, guard, hideFromCapture } = require('./overlay');
const { cleanSearches, menuEntries } = require('./core/stashSearch');
const { cleanBuilders, GAME_LIMIT: SEARCH_LIMIT } = require('./core/regex');
const { GameWatch } = require('./gamewin');
const { closeLeftovers, waitForExit, afterPid } = require('./leftovers');
const { checkPanelBounds } = require('./core/checkPanel');
const { placeWindow } = require('./core/windowPlace');
const { StatIndex } = require('./core/tradeStats');
const { searchable, gemType, buildFilters, applyEdits, isNarrow, buildQuery, summarize, compareSpec, markBait } = require('./core/tradeQuery');
const ultimatum = require('./core/ultimatum');
const { TradeClient, readListing, readOffer, tokensOf, searchUrl, exchangeUrl, currencyName } = require('./core/tradeApi');
const tradeFind = require('./core/tradeFind');
const { JewelService } = require('./jewels');
const { readJewelText, tradeQuery: jewelTradeQuery } = require('./core/jewels/timeless');
const { dustValue } = require('./core/dust');
const { vendorRecipe, verdict, craftRoom, withCrafts, typicalPrice, bulkPrice } = require('./core/worth');
const advanced = require('./core/advanced');
const { movedDefault } = require('./ui/keys');
const { DEFAULT_CONFIG, mergeTrade } = require('./config');
const { thumbnail, gridPicture, cellsOfPicture, pixelsOfThumb, printPicture } = require('./pictures');
const { ScreenRecorder } = require('./recorder');
const { Troubleshoot, scrub } = require('./troubleshoot');
const diagnose = require('./diagnose');
const { diag } = diagnose; // times and counts for the Under the hood page (src/core/diag.js)
const { report: hoodReport } = require('./core/diag');
const { uploadFolder } = require('./github');

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
const saveBacklog = () => writeJsonSoon('unrecognised.json', () => backlog.save(encodePrint));
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
let searchMenu = null; // the saved stash searches, opened at the mouse with their key
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
// Signed in to the trade site (Trade page, Search), its requests go through that session.
const tradeClient = new TradeClient({ fetchImpl: (url, init) => webFetch(url, tradeSite.in ? { ...init, session: tradeSession() } : init) });

// ---- files ----------------------------------------------------------------
const dataFile = (name) => path.join(app.getPath('userData'), name);
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch (_) { return fallback; }
}
function writeJson(name, value) {
  const done = diag.start(`file: ${name} (the app waits)`);
  try { fs.writeFileSync(dataFile(name), JSON.stringify(value)); } catch (e) { console.error('save failed', name, e.message); }
  done();
}
// The same, for files that change in the middle of things (a setting, a box dragged on the
// Tracker, an item learned during a reading): written a moment later and without holding the
// app up. Changes close together become one write of the newest value (get() is asked when it
// is written). Written beside the file and then swapped in, so a half-written file is never
// read back. flushSaves() writes whatever is still waiting at once: before quitting or restarting.
const SAVE_WAIT_MS = 400;
const savesWaiting = new Map(); // name -> { get, timer }
const savesRunning = new Map(); // name -> get, while its write is under way
let savesClosed = false;
function writeJsonSoon(name, get) {
  if (savesClosed) { writeJson(name, get()); return; }
  const w = savesWaiting.get(name);
  if (w) { w.get = get; return; }
  savesWaiting.set(name, { get, timer: setTimeout(() => saveWaiting(name), SAVE_WAIT_MS) });
}
async function saveWaiting(name) {
  const w = savesWaiting.get(name);
  if (!w) return;
  // One write per file at a time: a second one waits its turn.
  if (savesRunning.has(name)) { w.timer = setTimeout(() => saveWaiting(name), 100); return; }
  savesWaiting.delete(name);
  savesRunning.set(name, w.get);
  const file = dataFile(name), tmp = `${file}.tmp`;
  let text;
  const made = diag.start(`file: ${name}, made into text`);
  try { text = JSON.stringify(w.get()); } catch (e) { console.error('save failed', name, e.message); savesRunning.delete(name); return; }
  made(`${Math.round(text.length / 1024)} KB`);
  const done = diag.start(`file writing in the background: ${name}`);
  try {
    await fs.promises.writeFile(tmp, text);
    // Swapped in at once (not in the background), so it cannot land after a newer write.
    if (!savesClosed) fs.renameSync(tmp, file);
  } catch (_) {
    // The swap can fail on Windows while another program looks at the file: written the plain way.
    if (!savesClosed) { try { fs.writeFileSync(file, text); } catch (e) { console.error('save failed', name, e.message); } }
  }
  done();
  savesRunning.delete(name);
}
function flushSaves() {
  savesClosed = true;
  const gets = new Map([...savesRunning, ...[...savesWaiting].map(([name, w]) => [name, w.get])]);
  for (const w of savesWaiting.values()) clearTimeout(w.timer);
  savesWaiting.clear();
  for (const [name, get] of gets) { try { writeJson(name, get()); } catch (e) { console.error('save failed', name, e.message); } }
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
  config.stashSearches = cleanSearches(config.stashSearches);
  config.regex = cleanBuilders(config.regex);
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

// At most one save per 1.5 s. A save already waiting is left to run: starting the wait again on
// every change would put it off for as long as changes keep coming (timed inventory reading).
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeJson('session.json', session.toJSON()); writeJson('ledger.json', ledger.toJSON()); }, 1500);
}

// ---- state to the window ---------------------------------------------------
// full: with each map's line-by-line loot (the report and recordings want it; the window never reads it).
function buildState(full) {
  status.inventory.art.known = index.art.length;
  status.inventory.awaitingArrival = ledger.pendingArrival && !!session.current;
  status.inventory.noBaseline = !ledger.baseline;
  if (shared) status.shared = { ...shared.status, canUpload: shared.canUpload, waiting: shared.pending.length, by: shareName(), loading: sharedLoading };
  if (cloud) status.cloud = cloud.status;
  status.game = { known: watch.running, front: watch.gameInFront() };
  return {
    trouble: trouble ? { ...trouble.status, can: canTrouble(), admin: isAdmin(), rev: troubleRev } : null,
    config: { ...config, shareToken: undefined }, status, leagues, mapCheck, priceCheck, tradeCheck, notice,
    version: APP_VERSION, packaged: app.isPackaged, // the installed program already has its shortcuts
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
    summary: withIcons(session.summary(prices), full === true),
    sessions: archive ? archive.list().map((x) => ({ ...x, strategyId: strategyOf(x) })) : [],
    trade: tradeState(),
  };
}
// Loot gets its item pictures: the current map's list and the session's best drops show them.
// The window shows each map's loot grouped by name (items); the line-by-line lists it never
// reads are left out, which is about a third of what is sent on every update.
function withIcons(summary, full) {
  for (const r of summary.runs) {
    for (const i of r.items) { const e = prices.get(i.name); i.icon = (e && e.icon) || null; }
    r.lootCount = r.loot.length;
    if (!full) { delete r.loot; delete r.seen; }
  }
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
// Tells the window (and the overlay) that something changed. Calls that come close together
// (a burst of log lines, an action that changes several things) become one update: the state is
// built and sent once, PUSH_WAIT_MS after the first of them. See "Performance" in CLAUDE.md.
const PUSH_WAIT_MS = 30;
let pushTimer = null;
function push() {
  if (!pushTimer) pushTimer = setTimeout(pushNow, PUSH_WAIT_MS);
}
function pushNow() {
  clearTimeout(pushTimer); pushTimer = null;
  const open = win && !win.isDestroyed();
  const recording = trouble && trouble.recording;
  const built = diag.start('state update: put together');
  const s = open || recording ? buildState(!!recording) : null;
  built();
  if (open) { const sent = diag.start('state update: sent to the window'); win.webContents.send('state', s); sent(); }
  if (trouble && s) trouble.state(s); // what changed: a line under the hood, and in a recording
  const over = diag.start('state update: overlay and price check window');
  syncOverlay();
  if (checkPanel && checkPanel.visible && tradeCheck) checkPanel.update(checkPanelData());
  over();
  // How big one update is, measured now and then (measuring costs a little itself).
  if (s && Date.now() - stateSizedAt > 30000) { stateSizedAt = Date.now(); try { diag.gauge('One state update', Math.round(JSON.stringify(s).length / 1024), 'KB'); } catch (_) { /* not measured */ } }
}
let stateSizedAt = 0;
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
  // A file that cannot be read reports so on every look (several a second): only a change is news.
  logTail.on('status', (s) => {
    const error = s.ok ? null : `Cannot read the log (${s.error})`;
    if (status.log.ok === s.ok && status.log.error === error && status.log.path === p) return;
    status.log = { ok: s.ok, path: p, error }; push();
  });
  logTail.on('raw', (line, ev) => {
    if (trouble) trouble.event('log', { line, ev: ev || undefined });
    // Shown in the game log check: what the game wrote. What the app did with it is added below.
    logTrace.push({ at: Date.now(), raw: line.replace(/^\S+ \S+ \d+ \S+ /, '').slice(0, 220), type: ev ? ev.type : null, kind: ev ? ev.kind || null : null, code: ev ? ev.code || null : null, did: ev ? '' : 'Nothing: not a line the tracker acts on' });
    if (logTrace.length > 40) logTrace.shift();
  });
  logTail.on('event', (ev) => diag.run('game log: one line handled', () => {
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
  }, ev.type));
  logTail.start();
}

// ---- prices and item art --------------------------------------------------------
function setPrices(table) {
  prices = table;
  prices.setCustom(config.customPrices);
  index.rev++; // look-alikes are settled by price: answers kept per slot are worked out again
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
    if (!config.league && leagues.length) { config.league = leagues[0].id; writeJsonSoon('config.json', () => config); }
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
  writeJsonSoon('learned.json', () => learned);
  reader.forgetCells();
}

// Does a named picture look clearly more like another item's official picture than like the
// one it is named after? Returns { name, icon } of that other item, or null.
// The name of that other item, or null. Compares with every downloaded picture.
function otherLookalike(name, print) {
  if (!name) return null;
  const a = IconIndex.best(index.art, print);
  if (!a.best || a.best.name === name || a.score < 0.8) return null;
  let own = null;
  for (const e of index.art) if (e.name === name) own = Math.max(own === null ? -1 : own, similarity(print, e.print));
  if (own === null || a.score - own < index.artMargin) return null;
  return a.best.name;
}
// What the Items page list costs most to work out, kept between two askings: which shared
// picture is one of your own, which pictures look like another item, and the drawn pictures.
// The first two are only good while the item lists are the same (index.stamp); a picture drawn
// from a print never changes.
const itemKept = { stamp: null, twins: new Map(), doubts: new Map(), drawn: new Map(), drawnShared: new WeakMap() };

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
  const stamp = `${index.stamp}:${learned.length}`;
  if (itemKept.stamp !== stamp) { itemKept.stamp = stamp; itemKept.twins = new Map(); itemKept.doubts = new Map(); }
  const mine = new Map(); // place in the list of your own pictures -> its line here
  learned.forEach((l, i) => {
    try { pics.push({ id: `mine:${i}`, key: `m:${l.print}`, name: l.name, print: decodePrint(l.print), image: l.image || null, auto: !!l.auto, local: true, shared: false, by: '', over: null }); mine.set(i, pics[pics.length - 1]); } catch (_) { /* skip a broken entry */ }
  });
  const locals = pics.slice();
  index.shared.forEach((e, i) => {
    if (!itemKept.twins.has(e.print)) { const t = locals.find((p) => similarity(p.print, e.print) > 0.95); itemKept.twins.set(e.print, t ? Number(t.id.slice(5)) : -1); }
    const twin = mine.get(itemKept.twins.get(e.print));
    if (twin && twin.name === e.name) { twin.shared = true; twin.by = e.by || ''; twin.auto = !!e.auto; return; }
    // Your own name for the same picture differs: yours is the one used on this PC.
    pics.push({ id: `shared:${i}`, key: e.print, name: e.name, print: e.print, image: null, auto: !!e.auto, local: false, shared: true, by: e.by || '', over: twin ? (twin.name || 'ignored') : null });
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
    const dk = typeof p.key === 'string' ? `${p.key}|${p.name}` : p.key; // a shared picture has one name
    if (!itemKept.doubts.has(dk)) itemKept.doubts.set(dk, otherLookalike(p.name, p.print));
    const like = itemKept.doubts.get(dk), likeEntry = like ? prices.get(like) : null;
    let seen = p.image;
    if (!seen) {
      const store = typeof p.key === 'string' ? itemKept.drawn : itemKept.drawnShared;
      seen = store.get(p.key);
      if (!seen) { seen = printPicture(p.print); store.set(p.key, seen); }
    }
    rowOf(p.name).pictures.push({
      id: p.id, seen, sharp: !!p.image, by: p.by, auto: p.auto,
      onlyHere: p.local && !p.shared, over: p.over, doubt: like ? { name: like, icon: (likeEntry && likeEntry.icon) || null } : null,
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
    itemsRev++; writeJsonSoon('learned.json', () => learned);
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
  // Back from the map, a slot first seen empty (or seen holding something else) has been filled
  // from the stash since: not what the map brought out, so it is not in the picture.
  const withdrawn = new Set();
  if (ledger.pendingArrival) {
    for (const c of result.cells) {
      if (!ledger.arrival.has(c.cell)) continue;
      const first = ledger.arrival.get(c.cell);
      if (first === null || (c.name && first.name !== c.name)) withdrawn.add(c.cell);
    }
  }
  const cells = markCarried(result.cells.filter((c) => c.status !== 'covered' && !withdrawn.has(c.cell)), base, (a, b) => similarity(a, b) > 0.9)
    .map((c) => ({ ...c, score: c.score ? Math.round(c.score * 100) : null, near: nearList(c.near), packed: c.print ? packPrint(c.print) : null }));
  const growing = ledger.inMap;
  const stale = !!(carriedIn && carriedIn.stale && base === carriedIn.cells);
  // A picture that shows such a slot is replaced even by a smaller one.
  const prev = snapshots.get(run.id).trips.find((t) => t.trip === trip);
  const fix = !!prev && ledger.pendingArrival && prev.cells.some((c) => {
    if (!ledger.arrival.has(c.cell)) return false;
    const first = ledger.arrival.get(c.cell);
    return first === null || (c.name && first.name !== c.name);
  });
  if (!snapshots.wants(run.id, trip, cells, growing || fix)) return;
  if (snapshots.record(run.id, trip, { at: Date.now(), cells, image: gridPicture(cells), growing: growing || fix, stale })) session.markSnapshot(run.id);
}

function updateUnknown(found) {
  const added = backlog.update(found, (u) => ({
    image: thumbnail(u.rgb),
    guesses: index.suggest(u.print, 3).filter((g) => g.score >= 0.4).map((g) => ({ name: g.name, score: Math.round(g.score * 100) })),
  }));
  if (added) saveBacklog();
}

// Which inventory slot the mouse is over, with where in it (fx, fy: 0 to 1), or null.
function cursorCell(cur, rect) {
  if (!cur) return null;
  const gx = (cur.x - rect.x0) / rect.cell, gy = (cur.y - rect.y0) / rect.cell;
  const col = Math.floor(gx), row = Math.floor(gy);
  return col >= 0 && col < COLS && row >= 0 && row < ROWS ? { row, col, fx: gx - col, fy: gy - row } : null;
}

// force: asked for by hand in the app's own window. Otherwise nothing is read while another
// program is in front: the game's inventory cannot have changed, and a reading takes a picture of
// the whole screen. Where the app cannot tell which program is in front (no helper, or its last
// word is out of date), it reads as before.
// The closest downloaded picture for a slot's picture. Kept per picture: the reader hands out
// the same print for a slot that has not changed, and gear sits in its slot for a whole map.
const guessKept = new WeakMap(); // print -> { stamp, guess }
function bestGuess(print) {
  const k = guessKept.get(print), stamp = index.stamp;
  if (k && k.stamp === stamp) return k.guess;
  const guess = index.suggest(print, 1)[0] || null;
  guessKept.set(print, { stamp, guess });
  return guess;
}

async function readInventory(force) {
  if (invBusy) { diag.count('inventory: not read, the reading before was still going'); return; }
  if (force !== true && watch.otherInFront()) { diag.count('inventory: not read, another program was in front'); return; }
  invBusy = true;
  diag.count(force === true ? 'inventory: reading asked for by hand or key' : 'inventory: reading by itself');
  const inv = status.inventory, was = `${inv.open}|${inv.error}|${inv.lastReadAt}`;
  try {
    const t0 = performance.now();
    const frame = await captureFrame(config.inventory.displayId);
    const captureMs = performance.now() - t0;
    diag.time('inventory: capture of the screen', captureMs, `${frame.width}x${frame.height}`);
    const rect = gridRect(frame.width, frame.height);
    status.inventory.error = null;
    const wasOpen = status.inventory.open;
    status.inventory.open = isInventoryOpen(frame, rect);
    // The inventory was seen open and now closed some other way (Space, a click on its cross):
    // the window goes too. Only on that change, so a screen the reader cannot make out never
    // closes it.
    if (wasOpen && !status.inventory.open && checkPanel && checkPanel.visible) closeCheckPanel();
    if (!status.inventory.open) { diag.count('inventory: looked, and the inventory was not open'); stopFollow(); return; }
    judgeCapture(frame, rect); // the quick way of capture is only trusted once its pictures match (capture.js)
    // A tooltip (or the mouse pointer) may cover some slots; the reader finds them, keeps what
    // it knew about those and reads the rest.
    const t1 = performance.now();
    const result = reader.read(frame, { cursor: cursorCell(cursorInFrame(frame), rect) });
    // How long a reading takes on this PC, for troubleshooting recordings: whether the reading
    // should move to a worker, or the capture be made smaller.
    diag.time('inventory: reading the slots', performance.now() - t1, result ? `${result.recognised} recognised${result.unknown && result.unknown.length ? `, ${result.unknown.length} not known` : ''}${result.hidden ? `, ${result.hidden} covered` : ''}${result.warm != null ? `, ${typeof result.warm === 'number' ? result.warm : JSON.stringify(result.warm)} kept from before` : ''}${follow ? ', follow-up' : ''}` : 'nothing read');
    if (trouble && trouble.recording) trouble.event('inventoryRead', { captureMs: Math.round(captureMs), readMs: Math.round(performance.now() - t1), hidden: result ? result.hidden : null, follow: !!follow });
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
        const same = prev && prev.print && c.print && (prev.print === c.print || similarity(prev.print, c.print) > 0.98);
        const guess = c.print && (c.status === 'unknown' || c.status === 'skipped') ? bestGuess(c.print) : null;
        return {
          cell: c.cell, print: c.print, status: c.status, name: c.name, qty: c.qty, source: c.source,
          score: c.score ? Math.round(c.score * 100) : null, how: c.how, near: nearList(c.near),
          guess: guess ? { name: guess.name, score: Math.round(guess.score * 100) } : null,
          image: same ? prev.image : thumbnail(c.rgb),
        };
      }),
    };
    trackBlind(result);
    const known = result.cells.filter((c) => c.name).map((c) => ({ cell: c.cell, name: c.name, qty: c.qty }));
    const gains = ledger.reading({ counts: result.counts, cells: known, empties: result.empties });
    if (gains.length && session.current) session.addLoot(gains, 'inventory');
    // What could not be counted, so each map can say how far its total can be trusted.
    lastSingles = result.cells.filter((c) => c.status === 'skipped').length;
    if (session.current && (ledger.inMap || ledger.pendingArrival)) {
      session.setUncounted(session.currentId, result.unknown.length, Math.max(0, lastSingles - singlesBaseline));
    }
    try { keepSnapshot(result); } catch (e) { console.error('snapshot failed', e.message); }
    followUp(result.hidden);
    scheduleSave();
  } catch (e) {
    status.inventory.error = e.message || String(e);
  } finally {
    invBusy = false;
    // A look at a closed inventory changes nothing; the window is only told when something did.
    if (`${inv.open}|${inv.error}|${inv.lastReadAt}` !== was) push();
  }
}

// After a reading with covered slots, a few more follow while the mouse moves: each move shows
// the slots under the old tooltip, and every slot takes what a clear view of it shows. Stops
// when a reading has nothing covered, the inventory closes, or the limits are reached. Nothing
// is read while the mouse stands still: the picture would be the same.
const FOLLOW = { everyMs: 250, forMs: 3000, reads: 6 };
let follow = null; // { until, reads, at, timer }
function mouseSpot() {
  const p = cursorOnDisplay(config.inventory.displayId);
  return p ? `${Math.round(p.x / 6)},${Math.round(p.y / 6)}` : 'off';
}
// Back from a map: slots that were covered every time they were looked at, so nothing is known
// about them. One that is first seen empty may have held loot that went to the stash unseen:
// the map then says so in its "not in this total" line. Asked before the ledger takes the reading.
const blindSlots = new Set();
let blindTold = false; // the in-game hint was given for this trip back
function trackBlind(result) {
  if (!ledger.pendingArrival) { blindSlots.clear(); blindTold = false; return; }
  for (const k of result.blind) if (!ledger.arrival.has(k)) blindSlots.add(k);
  let lost = 0;
  for (const k of result.empties) if (blindSlots.delete(k) && result.warm) lost++;
  for (const c of result.cells) if (c.status !== 'covered') blindSlots.delete(c.cell);
  if (lost && session.current) session.addHidden(session.currentId, lost);
}
// The follow-up readings are over and slots are still blind: ask for a moment without a tooltip.
function tellBlind() {
  if (blindTold || !blindSlots.size || config.inventory.alerts === false) return;
  blindTold = true;
  const n = blindSlots.size;
  showToast({ title: `${n} ${n === 1 ? 'slot is' : 'slots are'} hidden by a tooltip`, detail: 'Move the mouse off the inventory for a moment so Map Companion can read them before you stash.', bad: true }, true);
}

function followUp(hidden) {
  if (!hidden) { stopFollow(); return; }
  if (follow) return; // already watching
  follow = { until: Date.now() + FOLLOW.forMs, reads: 0, at: mouseSpot(), timer: setInterval(followTick, FOLLOW.everyMs) };
}
function followTick() {
  if (!follow) return;
  if (Date.now() > follow.until || follow.reads >= FOLLOW.reads || !status.inventory.open) {
    const open = status.inventory.open;
    stopFollow();
    if (open) tellBlind();
    return;
  }
  if (invBusy) return;
  const at = mouseSpot();
  if (at === follow.at) return;
  follow.at = at; follow.reads++;
  readInventory();
}
function stopFollow() {
  if (!follow) return;
  clearInterval(follow.timer);
  follow = null;
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
let keyReadTimer = null;
const hookWanted = () => !!((trouble && trouble.recording) || config.inventory.onKey || config.inventory.onClick || config.inventory.autoCopy || config.trade.enabled || config.trade.hotkeys.hideout || config.trade.hotkeys.remaining || config.hotkeys.stashSearch);
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
    else lib.uIOhook.on('keydown', (e) => {
      if (e.keycode !== code) return;
      // A held key gives one reading. Just back in the game, the helper may still name the
      // program you came from: then one more try a moment later, so the key press is not lost.
      clearTimeout(keyReadTimer);
      keyReadTimer = setTimeout(() => {
        if (watch.otherInFront()) keyReadTimer = setTimeout(readInventory, 400);
        else readInventory();
      }, 200);
    });
  }
  // The stash searches menu: Escape closes it, a press on it is passed on (as for the price
  // check below), a press anywhere else closes it. The keys and clicks still reach the game.
  lib.uIOhook.on('keydown', (e) => { if (e.keycode === lib.UiohookKey.Escape && searchMenu && searchMenu.visible) closeSearchMenu('Escape'); });
  lib.uIOhook.on('mousedown', (e) => {
    if (!searchMenu || !searchMenu.visible) return;
    const p = screen.getCursorScreenPoint();
    if (!searchMenu.holds(p)) { closeSearchMenu('click elsewhere'); return; }
    if (e.button === 1) searchMenu.press(p.x - searchMenu.rect.x, p.y - searchMenu.rect.y);
  });
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
  // A press of the left button inside the price check window is passed on to it: over the game
  // the window does not always get the press itself (see pressOn in ui/check.js).
  lib.uIOhook.on('mousedown', (e) => {
    if (e.button !== 1 || !checkPanel || !checkPanel.visible || !checkPanel.rect) return;
    const p = screen.getCursorScreenPoint(), r = checkPanel.rect;
    const inWindow = p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
    if (inWindow) checkPanel.press(p.x - r.x, p.y - r.y);
    else if (checkPanel.typing) checkPanel.key('done'); // a click elsewhere ends the typing, keeping the number
  });
  // Back from a map, each of your clicks (moving loot to the stash) is followed by one read, so
  // the app sees the inventory as you leave it. A quick run of clicks gets one read at its end.
  if (config.inventory.onClick) {
    lib.uIOhook.on('mouseup', () => {
      if (ledger.inMap || !ledger.pendingArrival || !watch.gameInFront()) return;
      // A click in the price check window moves nothing in the inventory: no reading for it.
      if (checkPanel && checkPanel.visible && checkPanel.rect) {
        const p = screen.getCursorScreenPoint(), r = checkPanel.rect;
        if (p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height) return;
      }
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
  writeJsonSoon('learned.json', () => learned);
  if (backlog.resolve(print)) saveBacklog();
  if (!name) { say('That item is ignored from now on. Undo it on the Items data page, under Items you named.'); return; }
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
      return { state: { ...buildState(true), logTrace, logStats: logTail ? logTail.stats : null }, inventory };
    },
    who: () => ({ name: cloud && cloud.signedIn ? cloud.name : '', role: cloud ? cloud.role : '' }),
    version: APP_VERSION, // the exact commit is filled in once the updater knows it
    cloud, fetchImpl: webFetch, say, diag,
    changed: () => { syncCaptureHiding(); troubleRev++; push(); },
  });
  // A recording keeps how long each job took (the quickest ones left out) and every slow
  // moment and freeze, at its place on the timeline.
  diag.onTime = (name, ms, slow, detail) => { if (trouble.recording && ms >= 2 && !slow) trouble.event('timing', { name, ms: Math.round(ms * 10) / 10, detail: detail || undefined }); };
  diag.onSlow = (m) => { if (trouble.recording) trouble.event(m.kind === 'freeze' ? 'freeze' : 'slow', { name: m.name, ms: m.ms, limit: m.limit, detail: m.detail }); };
  // Admins and moderators see everyone's recordings: the reports repository is looked at once a minute.
  // Only while the app's window is the one in front: nobody sees new recordings otherwise, and it
  // is four web requests each time. Coming back to the window looks at once if a minute has passed.
  let lookedAt = 0;
  const look = (anyway) => {
    if (!trouble || !canTrouble() || trouble.current) return;
    if (anyway !== true && !(win && !win.isDestroyed() && win.isFocused())) { diag.count('recordings: not looked for, the app was not in front'); return; }
    if (Date.now() - lookedAt < 55 * 1000) return;
    lookedAt = Date.now();
    trouble.syncRemote().catch(() => {});
  };
  setTimeout(() => look(true), 8000);
  setInterval(look, 60 * 1000);
  app.on('browser-window-focus', (_e, w) => { if (w === win) look(); });
  // What the app writes to its console goes into a recording too.
  for (const level of ['log', 'warn', 'error']) {
    const was = console[level].bind(console);
    console[level] = (...args) => {
      was(...args);
      const text = args.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
      if (level === 'error') diag.error('main process', text);
      if (trouble) trouble.event('console', { level, text });
    };
  }
}
// The overlays are left out of screen captures, except while a troubleshooting recording starts
// or runs, so the recording shows them (readings in that time may see them too).
function syncCaptureHiding() { hideFromCapture(!(trouble && (trouble.current || trouble.busy === 'starting'))); }
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
// The Tracker page (admins): ideas and work on the app, kept as GitHub issues in
// config.trackerRepo with the same token the recordings use (src/tracker.js).
async function trackerAction(a) {
  if (!cloud || !isAdmin()) return { error: 'Only admins can use the tracker.' };
  const g = await cloud.github();
  if (g.error) return { error: g.error };
  if (!g.token) return { error: 'No GitHub token is saved. Save one in Settings, Developer tools.' };
  const base = { fetchImpl: webFetch, token: g.token, repo: String(config.trackerRepo || '').trim() };
  try {
    if (a.type === 'list') return { repo: base.repo, items: await tracker.listItems(base) };
    if (a.type === 'add') return { item: await tracker.addItem({ ...base, title: a.title, body: a.body, status: a.status, priority: a.priority, parent: a.parent, tab: a.tab }) };
    if (a.type === 'notes') return { notes: await tracker.listNotes({ ...base, number: a.number }) };
    if (a.type === 'addNote') return { note: await tracker.addNote({ ...base, number: a.number, text: a.text }) };
    if (a.type === 'renameTab') return await tracker.renameTab({ ...base, from: a.from, to: a.to });
    if (a.type === 'removeTab') return await tracker.removeTab({ ...base, name: a.name });
    if (a.type === 'parent') return { item: await tracker.setParent({ ...base, number: a.number, parent: a.parent }) };
    if (a.type === 'update') return { item: await tracker.updateItem({ ...base, number: a.number, patch: a.patch || {} }) };
    if (a.type === 'delete') {
      const r = await tracker.deleteItem({ ...base, number: a.number });
      // Recordings that pointed at the deleted box forget it, so they can be put somewhere else.
      if (trouble) for (const id of r.recordings || []) { const st = trouble.statusOf(id); if (st && Number(st.issue) === r.number) await trouble.setStatus(id, { issue: null }); }
      return r;
    }
    if (a.type === 'record') return { item: await tracker.addRecording({ ...base, number: a.number, rec: a.rec }) };
    if (a.type === 'unrecord') return { item: await tracker.removeRecording({ ...base, number: a.number, id: a.id }) };
  } catch (e) { return { error: e.message || String(e) }; }
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
  flushSaves();
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
    flushSaves();
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
function checkText(text, { count = true, advanced = false } = {}) {
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
  checkedText = { at: Date.now(), text }; // kept for a mark on the advanced price
  startTradeCheck(item, { always: !count, advanced });
  // A gem is worth what its level and quality make it, not what the cheapest of its name costs.
  const worth = (item.isGem && gemEntry(item)) || entry;
  priceCheck = {
    at: Date.now(), name, qty: item.stackSize, found: !!worth,
    each: worth ? worth.chaos : 0, total: worth ? worth.chaos * item.stackSize : 0,
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
// Currency and other things sold in bulk: poe.ninja's price, and what the bulk exchange offers.
// always: search at once (the price check key); the key that also counts loot waits for the button.
function bulkCheck(item, always) {
  const entry = prices.get(priceName(item));
  if (!entry) return;
  // Bought with chaos; what is worth a divine or more, with divines. Chaos itself: its divine rate.
  const want = entry.tradeId === 'chaos' ? '' : (entry.tradeId || '');
  const have = prices.divine > 0 && entry.chaos >= prices.divine ? 'divine' : 'chaos';
  tradeCheck = checkBase({
    kind: 'bulk', filters: { ok: false, why: '' }, title: entry.name, about: CATEGORY_NAMES[entry.category] || entry.category || '',
    icon: entry.icon || null, ninja: entry.chaos, qty: item.stackSize || 1, want, have,
  });
  showCheckPanel();
  if (want && always && (config.priceSearch || {}).auto !== false) runBulkSearch();
}
// The one price shown at the top: the average of the five cheapest real listings (as the
// crafts are compared), or the cheapest when fewer than three are listed.
function withTypical(summary, listings) {
  const t = typicalPrice(listings.map((l) => l.chaos)).value;
  return { ...summary, typical: t !== null ? t : summary.low };
}
async function runBulkSearch() {
  const tc = tradeCheck;
  if (!tc || tc.kind !== 'bulk' || !tc.want || tc.state === 'searching') return;
  tc.state = 'searching'; tc.error = ''; tc.rev = ++tradeRev;
  push();
  const timed = diag.start('price check: bulk search');
  try {
    const r = await tradeClient.exchange(config.league, tc.want, tc.have);
    const offers = r.offers.map((o) => readOffer(o, chaosOfPrice)).filter(Boolean).sort((a, b) => a.price.amount - b.price.amount).slice(0, 10);
    for (const o of offers) o.icon = tc.icon;
    tc.listings = offers;
    tc.total = r.total;
    tc.url = r.queryId ? exchangeUrl(config.league, r.queryId) : '';
    // poe.ninja's price is the one shown; offers far under it are marked bait (bulkPrice in core/worth.js)
    tc.summary = { ...summarize(r.total, offers), ...bulkPrice(offers, tc.ninja) };
    tc.state = 'done'; tc.searchedAt = Date.now();
  } catch (e) {
    tc.state = 'error'; tc.error = e.message || String(e);
  }
  timed(tc.state === 'error' ? `failed: ${tc.error}` : `${tc.total} offers`);
  keyAnswered();
  tc.rev = ++tradeRev;
  if (tradeCheck !== tc) return;
  push();
}
// The choices come from poe.ninja; when it prices none on this base (Vaal Aspects and other
// unique pieces), from the trade site's own item list, without prices (`unpriced`).
async function pickUnique(item) {
  const base = item.baseType;
  const say = (choices) => choices.length ? `Unidentified ${base}: it can be ${choices.length === 1 ? choices[0].name : `any of ${choices.length} uniques`}. Pick which in the window over the game.` : `Unidentified ${base}: no unique on this base is known. Identify it first.`;
  let choices = prices.uniquesOfBase(base).map((c) => ({ ...c, dust: dustValue({ ...item, name: c.name }) }));
  tradeCheck = checkBase({ kind: 'pick', filters: { ok: false, why: say(choices) }, item, choices, picked: '', base, why: say(choices), unpriced: false });
  const tc = tradeCheck;
  if (!choices.length) {
    const listed = await tradeClient.uniquesOfBase(base).catch(() => []);
    if (tradeCheck !== tc) return;
    choices = listed.map((c) => ({ name: c.name, chaos: null, high: null, icon: null, dust: dustValue({ ...item, name: c.name }) }));
    diag.count(`price check: unidentified ${base}, ${choices.length} uniques from the trade site's item list`);
    Object.assign(tc, { choices, why: say(choices), filters: { ok: false, why: say(choices) }, unpriced: true, rev: ++tradeRev });
  }
  if (choices.length === 1) { pickChoice(choices[0].name); return; }
  if (choices.length) showCheckPanel();
  push();
}
// name: one of the choices, or '' to go back to the list.
function pickChoice(name) {
  const tc = tradeCheck;
  if (!tc || tc.kind !== 'pick') return;
  const ch = tc.choices.find((c) => c.name === name);
  Object.assign(tc, { state: 'idle', error: '', total: 0, listings: [], url: '', summary: null, searchedAt: 0, iconW: 0, iconH: 0 });
  if (!ch) Object.assign(tc, { picked: '', filters: { ok: false, why: tc.why }, ninja: null, ninjaHigh: null, icon: null, dust: null, adv: null });
  else {
    let filters;
    try { statIndex = statIndex || StatIndex.load(); filters = buildFilters({ ...tc.item, name: ch.name, unidentified: false }, statIndex); } catch (e) { filters = { ok: false, why: `The list of trade stats could not be read: ${e.message || e}` }; }
    Object.assign(tc, { picked: ch.name, filters, ninja: ch.chaos, ninjaHigh: ch.high || null, icon: ch.icon, dust: ch.dust });
    advancedBegin(tc, { ...tc.item, name: ch.name, unidentified: false });
  }
  tc.filtersRev += 1; tc.rev = ++tradeRev;
  push();
  if (ch && tc.filters.ok && (config.priceSearch || {}).auto !== false) runTradeSearch(false);
}

// A socket recipe's reward with its picture and value, or null.
function vendorFor(item) {
  const r = vendorRecipe(item);
  if (!r) return null;
  const e = prices.get(r.name);
  return { ...r, icon: e ? e.icon || null : null, chaos: e ? e.chaos * r.count : 0 };
}

// The crafts ticked in the window, searched as if they were already on the item.
const craftsOn = (tc) => (tc.craft ? tc.craft.ideas.filter((i) => (tc.craftOn || []).includes(i.stat)) : []);

// What each possible bench craft adds to the item with the stats chosen, ticked or not: the
// typical price (typicalPrice) of items like it with the craft (as withCrafts adds it), against
// the same without any craft, both searched one right after the other. Worked out by itself
// after every search, and again when the ticks and numbers change in the window (filters: those
// choices). The trade site's answers are kept for a minute, so a search already made is not
// sent again. One after another, each waiting for the site to allow it; a newer run, or a
// search, stops it.
async function runCrafts(tc, filters = tc.filters) {
  const ideas = (tc.craft ? tc.craft.ideas : []).filter((i) => i.priced);
  if (!ideas.length) return;
  const run = (tc.craft.run || 0) + 1;
  tc.craft.run = run;
  for (const i of ideas) Object.assign(i, { state: 'waiting', chaos: null, delta: null, n: 0, why: '', run });
  tc.rev = ++tradeRev; push();
  const stale = () => tradeCheck !== tc || tc.craft.run !== run || tc.state === 'searching';
  const typical = (f) => diag.run('price check: one bench craft priced (waiting included)', async () => {
    for (let i = 0; i < 50 && tradeClient.busy; i++) await sleep(100);
    const wait = Math.max(tradeClient.waitMs('search'), tradeClient.waitMs('fetch'));
    if (wait > 20000) throw Object.assign(new Error('The trade site asked for a pause. It is tried again after the next search.'), { later: true });
    if (wait > 0) await sleep(wait + 150);
    if (stale()) return undefined;
    const r = await tradeClient.check(config.league, buildQuery(f));
    const ls = markBait(r.listings.map((l) => readListing(l, chaosOfPrice)));
    return typicalPrice(ls.filter((l) => !l.bait).map((l) => l.chaos));
  });
  let base;
  try { base = await typical(filters); } catch (e) { base = { value: null, n: 0, why: e.message, later: e.later }; }
  if (base === undefined || stale()) return;
  for (const idea of ideas) {
    if (stale()) return;
    if (base.why) { Object.assign(idea, { state: base.later ? 'later' : 'error', why: base.why }); continue; }
    idea.state = 'running'; tc.rev = ++tradeRev; push();
    try {
      const got = await typical(withCrafts(filters, [idea]));
      if (got === undefined || stale()) return;
      const delta = got.value === null || base.value === null ? null : Math.max(0, Math.round((got.value - base.value) * 10) / 10);
      Object.assign(idea, { state: 'done', chaos: got.value, n: got.n, delta, baseFew: base.value === null });
    } catch (e) {
      Object.assign(idea, { state: e.later ? 'later' : 'error', why: e.message || String(e) });
    }
    tc.rev = ++tradeRev; push();
  }
  tc.rev = ++tradeRev; push();
}

// poe.ninja's price for a gem as it is (its level, quality, corrupted or not), or null.
const gemEntry = (item) => prices.gem(item.name, item.gemLevel, item.quality, item.corrupted);
// A transfigured gem is named differently in a search; the site's own list says how. Asked for
// only for gems that can be one ("… of …"), once per run. The search goes by the plain name
// when the list cannot be had.
async function nameGem(tc) {
  const t = tc.filters.type;
  if (!tc.filters.gem || !t || t.as !== undefined || !/ of /.test(t.value)) return;
  const list = await tradeClient.gems();
  if (!list.length) { diag.count('price check: gem searched by its plain name (the trade site gave no item list)'); return; }
  tc.filters = { ...tc.filters, type: { ...tc.filters.type, as: gemType(list, t.value) } };
}
// advanced: the check came from the advanced price check's own key (see its section below).
function startTradeCheck(item, { always = false, advanced = false } = {}) {
  tradeCheck = null;
  if (!searchable(item)) { bulkCheck(item, always); if (advanced) diag.count('price check: advanced left out (priced by poe.ninja, no search of its own)'); return; }
  if (item.rarity === 'Unique' && item.unidentified) { pickUnique(item); if (tradeCheck) tradeCheck.advanced = advanced; return; }
  let filters;
  try {
    statIndex = statIndex || StatIndex.load();
    filters = buildFilters(item, statIndex);
  } catch (e) {
    filters = { ok: false, why: `The list of trade stats could not be read: ${e.message || e}` };
  }
  tradeCheck = { at: Date.now(), rev: ++tradeRev, filtersRev: 0, filters, state: 'idle', error: '', total: 0, listings: [], url: '', summary: null, searchedAt: 0, inGame: false };
  const plain = prices.get(priceName(item));
  const entry = (item.isGem && gemEntry(item)) || plain;
  tradeCheck.ninja = entry ? entry.chaos : null; // what poe.ninja says, for uniques and gems
  tradeCheck.ninjaHigh = entry && entry.high && !item.isGem ? entry.high : null; // its dearest common variant, when they differ
  // which of poe.ninja's versions of the gem that price is for ("20/20, corrupted")
  tradeCheck.ninjaFor = entry && entry.gem ? `level ${entry.gem.level}, quality ${entry.gem.quality}%${entry.gem.corrupted ? ', corrupted' : ''}` : '';
  tradeCheck.icon = entry && entry.icon ? entry.icon : null; // a unique's picture; others get theirs from the search
  tradeCheck.dust = item.rarity === 'Unique' ? dustValue(item) : null; // what it gives at the Disenchanting bench
  tradeCheck.vendor = vendorFor(item);
  tradeCheck.craft = filters.ok ? craftRoom(item, filters, statIndex) : null;
  tradeCheck.craftOn = []; // the crafts ticked: searched as if already on the item
  tradeCheck.advanced = advanced;
  advancedBegin(tradeCheck, item);
  if (filters.ok) showCheckPanel();
  // The price check key searches at once, with what is ticked from the start. The check key is
  // also pressed just to count loot, so there a unique (it has a poe.ninja price already) and
  // an item with nothing ticked (it would only find the cheapest of its kind) wait for the button.
  // A gem poe.ninja prices waits like a unique.
  const worthIt = always || (item.rarity !== 'Unique' && !(item.isGem && entry) && isNarrow(filters));
  if (filters.ok && worthIt && (config.priceSearch || {}).auto !== false) runTradeSearch(true);
}
// announce: say the outcome in game, as the check key's own message does.
async function runTradeSearch(announce) {
  const tc = tradeCheck;
  if (!tc || !tc.filters.ok || tc.state === 'searching') { diag.count(`price check: search not started (${!tc ? 'no item' : !tc.filters.ok ? 'nothing to search by' : 'one was still going'})`); return; }
  tc.state = 'searching'; tc.error = ''; tc.rev = ++tradeRev;
  push();
  const timed = diag.start('price check: search (waiting included)');
  let waited = 0;
  try {
    // A craft's search may still be out, or the site may want a short pause: wait for it here
    // rather than say no.
    const w0 = performance.now();
    for (let i = 0; i < 50 && tradeClient.busy; i++) await sleep(100);
    const wait = Math.max(tradeClient.waitMs('search'), tradeClient.waitMs('fetch'));
    if (wait > 0 && wait <= 10000) await sleep(wait + 150);
    waited = performance.now() - w0;
    // Time spent only waiting for the trade site's permission to ask again (its rate limit).
    if (waited > 5) diag.time('price check: waiting for the trade site\'s pause', waited);
    await nameGem(tc);
    const r = await tradeClient.check(config.league, buildQuery(withCrafts(tc.filters, craftsOn(tc))));
    tc.compare = compareSpec(tc.filters);
    tc.listings = markBait(r.listings.map((l) => readListing(l, chaosOfPrice, tc.compare)));
    // The item's own picture: a listing of the same base looks the same (a unique has its own).
    // Its size too (for where the sockets go), even when the picture came from poe.ninja.
    const same = tc.listings.find((l) => l.icon && tc.filters.type && l.base === tc.filters.type.value) || (tc.filters.name ? tc.listings.find((l) => l.icon) : null);
    if (same) { if (!tc.icon) tc.icon = same.icon; if (same.w) { tc.iconW = same.w; tc.iconH = same.h; } }
    tc.total = r.total;
    tc.url = r.queryId ? searchUrl(config.league, r.queryId) : '';
    tc.summary = withTypical(summarize(r.total, tc.listings.filter((l) => !l.bait)), tc.listings.filter((l) => !l.bait)); // a bait price is not what it sells for
    tc.state = 'done'; tc.searchedAt = Date.now();
  } catch (e) {
    tc.state = 'error'; tc.error = e.message || String(e);
  }
  timed(`${tc.state === 'error' ? `failed: ${tc.error}` : `${tc.total} listings`}${waited > 5 ? `, ${Math.round(waited)} ms of it waiting` : ''}`);
  keyAnswered();
  tc.rev = ++tradeRev;
  if (tradeCheck !== tc) return; // another item was checked meanwhile
  if (announce && !tc.inGame) showToast(tradeMessage(tc, prices.divine)); // the window in game says it itself
  push();
  const crafts = () => { if (tradeCheck === tc && tc.state === 'done' && tc.craft) runCrafts(tc, tc.craftEdits ? applyEdits(tc.filters, tc.craftEdits) : tc.filters).catch(() => {}); };
  // With the advanced check on, its searches go first and what the bench crafts add after them:
  // both take turns with the trade site.
  if (tc.adv) runAdvanced(tc).catch(() => {}).then(crafts); else crafts();
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
// What the item goes for, for the verdict at the top: its cheapest real listing, else poe.ninja's
// price; a stack counts whole.
function checkPrice(tc) {
  if (!tc) return null;
  const low = tc.summary && tc.summary.typical !== null && tc.summary.typical !== undefined ? tc.summary.typical : null;
  const each = low !== null ? low : (tc.ninja !== null && tc.ninja !== undefined ? tc.ninja : null);
  if (each === null) return null;
  return tc.kind === 'bulk' ? each * (tc.qty || 1) : each;
}
const checkPanelData = () => ({ ...tradeCheck, verdict: tradeCheck && tradeCheck.kind !== 'pick' || (tradeCheck && tradeCheck.picked) ? verdict({ price: checkPrice(tradeCheck), vendor: tradeCheck.vendor, divine: prices.divine }) : null, divine: prices.divine, auto: config.priceSearch.auto !== false, sockets: config.priceSearch.sockets !== false, league: config.league, coins: coinIcons(tradeCheck && tradeCheck.listings) });
// The item's page on the wiki or PoEDB, from the links at the bottom of the price check window.
// Both are searches, which land on the page itself when the name is exact.
function checkSiteUrl(site) {
  const tc = tradeCheck;
  if (!tc) return '';
  const f = tc.filters || {};
  const name = tc.kind === 'bulk' ? tc.title : (tc.kind === 'pick' && !tc.picked ? tc.base : (f.name || (f.type && f.type.value) || ''));
  if (!name) return '';
  if (site === 'wiki') return `https://www.poewiki.net/index.php?search=${encodeURIComponent(name)}`;
  if (site === 'poedb') return `https://poedb.tw/us/search?q=${encodeURIComponent(name)}`;
  return '';
}
function showCheckPanel() {
  if (!checkPanel || !overlay || config.priceSearch.overlay === false || layoutWin) return;
  if (!overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() })) return;
  tradeCheck.inGame = true;
  checkPanel.show(checkPanelData(), { bounds: overlay.display().bounds, cursor: screen.getCursorScreenPoint(), custom: checkPlacement() });
}

// One press of the check hotkey: copy the hovered item (a single Ctrl+Alt+C sent to the game, the
// same thing price-check tools do), then read the clipboard once.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// From the check key to the answer on screen, for the Under the hood page.
let checkKeyAt = 0;
function keyAnswered() {
  if (checkKeyAt) diag.time('price check: from the key to the answer', performance.now() - checkKeyAt, tradeCheck ? tradeCheck.kind || 'gear' : 'price list');
  checkKeyAt = 0;
}
async function checkHovered({ count = true, advanced = false } = {}) {
  const started = Date.now();
  checkKeyAt = performance.now();
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
      diag.time('price check: copy from the game', performance.now() - checkKeyAt, text ? '' : 'nothing came');
      const read = diag.start('price check: item text read');
      if (!text) { clipboard.writeText(before); say('No item under the mouse in game. Hover an item and press the key again.', true); showCheckToast(started); changed(); return; }
      checkText(text, { count, advanced });
      read();
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
    checkText(clipboard.readText(), { count, advanced });
    // With copying switched off, an empty hand is most likely the setting, so name it.
    if (priceCheck && priceCheck.error && priceCheck.at >= started) priceCheck.error = 'Nothing to check: "Check item price" is switched off (Settings, Price check). Switch it on, or press Ctrl+C on the item before the key.';
  }
  showCheckToast(started);
  // No search went out (currency, a map, nothing found): the answer is there already.
  if (!(tradeCheck && tradeCheck.at >= started && tradeCheck.state === 'searching')) keyAnswered();
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
// The keys a typed number needs, held from the whole system while it is typed, so the game
// does not get them (1 to 5 are flasks) and the game keeps the keyboard: nothing moves to the
// front. Each key goes to the price check window; all are let go when the typing ends.
const TYPING_KEYS = [
  ...'0123456789'.split('').map((d) => [d, d]), ...'0123456789'.split('').map((d) => [`num${d}`, d]),
  ['.', '.'], [',', '.'], ['numdec', '.'], ['-', '-'], ['numsub', '-'],
  ['Backspace', 'Backspace'], ['Delete', 'Backspace'], ['Enter', 'Enter'], ['Escape', 'Escape'],
];
let typingHeld = [];
function typingKeys(on) {
  for (const accel of typingHeld.splice(0)) { try { globalShortcut.unregister(accel); } catch (_) { /* gone already */ } }
  if (trouble) trouble.event('check-keys', { on: !!on });
  if (!on) return;
  for (const [accel, k] of TYPING_KEYS) {
    try { if (globalShortcut.register(accel, () => { if (checkPanel) checkPanel.key(k); })) typingHeld.push(accel); } catch (_) { /* that key stays with the game */ }
  }
}

function registerHotkeys() {
  if (keysPaused) return; // they are taken again when the choice has been made
  globalShortcut.unregisterAll();
  typingHeld = [];
  if (checkPanel && checkPanel.typing) typingKeys(true); // a number being typed keeps its keys
  gameKeysOn = false;
  status.hotkeys = { clipboard: false, snapshot: false, priceCheck: false, advancedCheck: false, tradeNext: false, tradeDismiss: false, layout: false, stashSearch: false };
  // Keys that only mean something in the game are held only while the game is in front.
  // Anywhere else they stay with the program you are in (Ctrl+D bookmarks, F5 refreshes).
  gameKeysOn = watch.gameInFront();
  const noted = (job, accel, fn) => () => { if (trouble) trouble.event('hotkey', { job, key: accel }); return diag.run(`key: ${job}`, fn, accel); };
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
  // The advanced price check has a key of its own (owner, 0.64.1): the same window with its band.
  status.hotkeys.advancedCheckHeld = gameKeysOn && !!config.hotkeys.advancedCheck;
  if (gameKeysOn) reg('advancedCheck', config.hotkeys.advancedCheck, () => { checkHovered({ count: false, advanced: true }); });
  // The stash searches menu: only while the game is in front, like the price check key.
  status.hotkeys.stashSearchHeld = gameKeysOn && !!config.hotkeys.stashSearch;
  if (gameKeysOn) reg('stashSearch', config.hotkeys.stashSearch, () => { toggleSearchMenu(); });
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

// ---- the advanced price check (its own key, hotkeys.advancedCheck) --------------------
// A checker of its own beside the standard one (owner, 0.64.1: its own key, not a band on every
// check). Its key checks the item as the price check key does and marks the check `advanced`;
// the other keys never set it, so the standard check is left as it was. For that item this
// adds: for a rare, a comparison by score (core/advanced: the value table, a search for items
// with most of what carries its score, their results scored here, widened step by step); for
// anything searched, a range with how sure it is and how fast such items sell; and what the
// base alone is worth. Its answer is `tradeCheck.adv`, drawn as a band of its own in the window
// over the game. Nothing here runs for a check from another key.
const advPlans = new WeakMap(); // a check -> { plan, item }: what its search is built from
const advKept = new Map();      // a search -> { at, found }: answers kept for a minute, as the trade client keeps the standard ones
let checkedText = null;         // { at, text }: the item text last checked, kept with a mark
let advMarks = null;            // the "Too low" / "Right" / "Too high" marks, newest last (advanced-marks.json)

// A newly checked item: what the advanced check will do with it, worked out at once (no web).
function advancedBegin(tc, item) {
  tc.adv = null;
  if (!tc.advanced) return;
  if (!tc.filters || !tc.filters.ok || tc.filters.gem) { diag.count(`price check: advanced left out (${tc.filters && tc.filters.gem ? 'a gem' : 'nothing to search by'})`); return; }
  let plan;
  try { plan = diag.run('price check: advanced plan', () => advanced.plan(item, statIndex)); } catch (e) { plan = { ok: false, why: `it could not be worked out: ${e.message || e}` }; }
  let base = null;
  try { base = advanced.baseValue(item, (name) => prices.get(name)); } catch (_) { /* no base price: left out */ }
  // a unique's price on poe.ninja over the last week: rising or falling by a tenth or more is said
  const known = item.rarity === 'Unique' ? prices.get(priceName(item)) : null;
  const trend = known && isFinite(known.change) && Math.abs(known.change) >= 10 ? Math.round(known.change) : null;
  advPlans.set(tc, { plan, item });
  const own = plan.ok && plan.kind === 'score';
  tc.adv = {
    state: 'waiting', run: 0, kind: plan.ok ? plan.kind : 'standard', worth: own ? plan.worth : null,
    fits: own ? plan.fits : [], parts: own ? plan.parts : [], score: own ? plan.score : null, unknown: own ? plan.unknown : [],
    base: base && base.chaos >= 3 ? base : null, trend, said: '',
  };
  if (trouble) trouble.event('advanced plan', { item: tc.filters.title, plan: advanced.describe(plan), base: base ? `${base.chaos}c for ${base.what}` : undefined });
}

// After each standard search of the item: the advanced answer for it. One search for most
// rares (two requests: the search and ten of its results), up to three when few are listed
// (advanced.run in core/advanced/run.js sends them, each waiting its turn with the trade site).
async function runAdvanced(tc) {
  const held = advPlans.get(tc);
  if (!tc.adv || !held) return;
  if (tc.state !== 'done') { diag.count('price check: advanced not run (the standard search did not finish)'); return; }
  const run = tc.adv.run + 1;
  tc.adv.run = run;
  const stale = () => tradeCheck !== tc || tc.adv.run !== run || tc.state === 'searching';
  const show = (patch) => { Object.assign(tc.adv, patch); tc.rev = ++tradeRev; push(); };
  const read = (est, more) => { const { why: facts, ...rest } = est; return { state: 'done', why: '', facts, ...rest, ...more }; };
  const said = (text) => { if (trouble) trouble.event('advanced check', { item: tc.filters.title, outcome: text }); };
  const { plan } = held;
  // Nothing of its own to search: the standard search's listings, read the honest way.
  if (!plan.ok || !plan.steps) {
    const est = advanced.estimate({ listings: tc.listings, total: tc.total });
    show(est ? read(est, { source: 'standard', step: 0, url: '' }) : { state: 'none', source: 'standard', why: tc.total ? 'None of the listings has a price the app can read.' : 'Nothing like it is listed.' });
    diag.count(`price check: advanced read from the standard search (${!plan.ok ? plan.why : 'nothing on it buyers search for'})`);
    said(advanced.outcome(tc.adv));
    return;
  }
  if (tc.adv.state !== 'done') show({ state: 'working' }); // a search again keeps the last answer on screen until the new one is there
  const done = diag.start('price check: advanced search (waiting included)');
  let failed = false, text = '';
  try {
    const r = await advanced.run({
      plan, league: config.league, offline: !!tc.filters.offline, client: tradeClient, kept: advKept, sleep, stale,
      read: (raw) => markBait(raw.map((l) => readListing(l, chaosOfPrice))),
      // a rare's results are scored here with the value table (the site takes no weighted search without a login)
      score: plan.kind === 'score' ? (l) => advanced.scoreListing(plan, l.item, statIndex) : null,
      count: (what) => diag.count(`price check: advanced ${what}`),
      waited: (ms) => diag.time("price check: advanced, waiting for the trade site's pause", ms),
    });
    if (r.left) { text = 'left: another item or search came'; return; }
    const url = r.queryId ? searchUrl(config.league, r.queryId) : '';
    show(r.state === 'done' ? read(r.est, { source: plan.kind, step: r.step, looked: r.looked, url }) : { state: 'none', source: plan.kind, step: r.step, looked: r.looked, why: r.why, url });
    text = `${advanced.outcome(tc.adv)}; ${r.sent} request${r.sent === 1 ? '' : 's'} sent`;
    said(text);
  } catch (e) {
    const later = !!e.later || e.waitMs > 0; // the site asked for a pause: nothing is wrong
    failed = !later;
    show({ state: later ? 'later' : 'error', why: e.message || String(e) });
    text = advanced.outcome(tc.adv);
    said(text);
  } finally {
    done(text, false, failed);
  }
}

// "Too low", "Right" or "Too high" on the advanced price: kept with the item and both prices, so
// the value table can be tuned from them. Pressing the same one again takes it back. The marks
// go along with a report sent from Under the hood (advanced-marks.json).
function advancedSay(say) {
  const tc = tradeCheck;
  if (!tc || !tc.adv || !['low', 'right', 'high'].includes(say)) return;
  if (!Array.isArray(advMarks)) { advMarks = readJson('advanced-marks.json', []); if (!Array.isArray(advMarks)) advMarks = []; }
  const a = tc.adv, off = a.said === say;
  advMarks = advMarks.filter((m) => m.checked !== tc.at);
  const standard = tc.summary && tc.summary.typical !== undefined ? tc.summary.typical : null;
  if (!off) {
    advMarks.push({
      at: Date.now(), checked: tc.at, say, league: config.league, app: APP_VERSION, item: tc.filters.title,
      text: checkedText && Math.abs(checkedText.at - tc.at) < 5000 ? checkedText.text : '',
      standard, standardFound: tc.total, ninja: tc.ninja,
      advanced: { state: a.state, source: a.source, step: a.step, low: a.low, typical: a.typical, high: a.high, sure: a.sure, speed: a.speed, total: a.total, why: a.why || '', score: a.score, fits: a.fits },
      plan: advanced.describe((advPlans.get(tc) || {}).plan), url: a.url || '',
    });
    if (advMarks.length > 300) advMarks = advMarks.slice(-300);
  }
  writeJsonSoon('advanced-marks.json', () => advMarks);
  a.said = off ? '' : say;
  if (trouble) trouble.event('advanced mark', { item: tc.filters.title, say: off ? 'taken back' : say, standard, advanced: advanced.outcome(a) });
  tc.rev = ++tradeRev;
  push();
}

// ---- trade offers ---------------------------------------------------------------
// The trade site's cheapest listings for an offered unique, asked for with a click on the Trade
// page and kept five minutes: offer id -> { state, at, listings, total, url, error }.
const offerMarket = new Map();
const MARKET_KEEP_MS = 5 * 60 * 1000;
const slimListing = (l) => ({ id: l.id, seller: l.seller, price: l.price, chaos: l.chaos, status: l.status, listedAt: l.listedAt, bait: !!l.bait, whisper: l.whisper || '', name: l.name });
async function tradeMarket(id) {
  const o = book.get(id), entry = o ? prices.unique(o.item) : null;
  if (!entry) { diag.count(`price check: market for an offer not looked up (${o ? 'not a unique' : 'the offer is gone'})`); if (o) say('Only a unique can be looked up from an offer: the whisper carries just its name.'); return; }
  const kept = offerMarket.get(o.id);
  if (kept && (kept.state === 'searching' || (kept.state === 'done' && Date.now() - kept.at < MARKET_KEEP_MS))) { diag.count('price check: market for an offer not looked up (asked a moment ago)'); return; }
  const m = { state: 'searching', at: Date.now(), listings: [], total: 0, url: '', error: '' };
  offerMarket.set(o.id, m);
  push();
  const timed = diag.start('price check: market for a trade offer');
  try {
    const r = await tradeClient.check(config.league, { query: { status: { option: 'available' }, name: entry.name, type: entry.base, stats: [{ type: 'and', filters: [] }] }, sort: { price: 'asc' } });
    m.listings = markBait(r.listings.map((l) => readListing(l, chaosOfPrice))).map(slimListing).map((l) => ({ ...l, whisper: undefined }));
    m.total = r.total; m.url = r.queryId ? searchUrl(config.league, r.queryId) : ''; m.state = 'done'; m.at = Date.now();
  } catch (e) { m.state = 'error'; m.error = e.message || String(e); }
  timed(m.state === 'error' ? `failed: ${m.error}` : `${m.total} listings of ${entry.name}`, false, m.state === 'error');
  push();
}

// ---- the buying list (Trade page, Buying) ----
// The item of the last price check goes on the list with its search and the sellers found.
function wantAdd() {
  const tc = tradeCheck, f = tc && tc.filters;
  if (!tc || tc.kind || !f || !f.ok) { diag.count('trade: nothing added to the buying list (no gear search to take)'); say('Price check an item first (gear, a jewel or a unique); it can then go on the buying list.', true); return; }
  const name = [f.name, f.type && f.type.value].filter(Boolean).join(' ') || 'Item';
  book.addWant({ name, icon: tc.icon || null, body: buildQuery(withCrafts(f, craftsOn(tc))), url: tc.url, listings: tc.state === 'done' ? tc.listings.map(slimListing) : null });
  saveTradesSoon();
  say(`${name} is on the buying list.`);
}
async function wantSearch(id) {
  const w = book.want(id);
  if (!w || !w.body) { diag.count('trade: buying list not searched (no search kept)'); return; }
  const timed = diag.start('price check: search for the buying list');
  try {
    const r = await tradeClient.check(config.league, w.body);
    book.setWant(id, { listings: markBait(r.listings.map((l) => readListing(l, chaosOfPrice))).map(slimListing), url: r.queryId ? searchUrl(config.league, r.queryId) : w.url, searchedAt: Date.now(), error: '' });
    timed(`${r.total} listings of ${w.name}`);
  } catch (e) {
    book.setWant(id, { error: e.message || String(e) });
    timed(`failed: ${e.message || e}`, false, true);
  }
  saveTradesSoon();
}
// One whisper per click: the line the trade site gives for that listing.
async function wantWhisper(id, seller) {
  const w = book.want(id), l = w ? w.listings.find((x) => x.seller === seller) : null;
  const text = l ? String(l.whisper || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500) : '';
  if (!/^@\S+ \S/.test(text)) { diag.count('trade: seller not whispered (no whisper line for that listing)'); say('That listing has no whisper line. Open it on the trade site.', true); return; }
  if (await sendChat(text)) { book.wantAsked(id, seller); saveTradesSoon(); }
}

function tradeState() {
  const s = book.summary(prices);
  for (const id of offerMarket.keys()) if (!book.get(id)) offerMarket.delete(id);
  for (const o of s.offers) o.live = offerMarket.get(o.id) || null;
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
  guard(layoutWin);
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

// ---- the Trade page's Search (a search of the trade site from nothing) ---------------------
// Tracker #85. The form of the page becomes a search (core/tradeFind.js); the answer is kept
// here and the page asks for it. Works without a login. Signed in to the trade site (below),
// searches count against the account's own limits and an instant buyout's "Travel to Hideout"
// works from the page.
let findItemList = null; // the site's items to pick from, read once per run
let findStatList = null; // the stat list, searchable by words
let findLast = null;     // { form, name, queryId, ids, total, shown, tokens, asked, url, at, unknown }
let findBusy = false;

// The sign-in. The app never sees a password: a window shows pathofexile.com's own login page
// in a session of its own (kept by Chromium in <userData>/Partitions, cookies encrypted by
// Windows), and the app only asks through that session afterwards. Nothing of it is in the
// settings, the state, Under the hood or a recording.
const tradeSite = { in: false, name: '', checked: false };
let tradeLoginWin = null;
const tradeSession = () => webSessions.fromPartition('persist:tradesite');
async function tradeSiteCheck() {
  const done = diag.start('price check: is the trade site signed in');
  let state = 'no';
  try {
    const ses = tradeSession();
    const cookies = await ses.cookies.get({ url: 'https://www.pathofexile.com', name: 'POESESSID' });
    if (cookies.length) {
      // The account page sends a visitor to the login page; an account gets the page itself.
      try {
        const res = await ses.fetch('https://www.pathofexile.com/my-account', { headers: { Accept: 'text/html' } });
        const html = res.ok ? await res.text() : '';
        const out = /\/login/.test(res.url || '') || /name="password"/.test(html);
        if (res.ok && !out) { state = 'yes'; const m = /\/account\/view-profile\/([^"'\/?#]+)/.exec(html); tradeSite.name = m ? decodeURIComponent(m[1]).replace(/-(\d{4})$/, '#$1').slice(0, 60) : ''; }
        else if (!res.ok) state = `not known (the account page answered ${res.status})`;
      } catch (e) { state = `not known (${e.message || e})`; }
    }
    // When the site could not say, the last answer stands; a first ask counts as not signed in.
    if (state === 'yes' || state === 'no') tradeSite.in = state === 'yes';
    if (!tradeSite.in) tradeSite.name = '';
  } catch (e) { state = `failed: ${e.message || e}`; }
  tradeSite.checked = true;
  done(`signed in: ${state}`, false, /^failed/.test(state));
  return tradeSite.in;
}
function tradeSignIn() {
  if (tradeLoginWin) { tradeLoginWin.focus(); return; }
  if (trouble) trouble.event('tradeSite', { what: 'sign-in window opened' });
  tradeLoginWin = new BrowserWindow({
    width: 560, height: 780, parent: win || undefined, title: 'Sign in to pathofexile.com', autoHideMenuBar: true, backgroundColor: '#0c0c0e',
    webPreferences: { partition: 'persist:tradesite', contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const w = tradeLoginWin;
  // Never in a screen capture or a troubleshooting recording.
  try { w.setContentProtection(true); } catch (_) { /* not on this system */ }
  w.setMenuBarVisibility(false);
  // A sign-in through Steam or another service opens that service in this same window.
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) w.loadURL(url); return { action: 'deny' }; });
  let asking = false;
  const look = async () => {
    if (asking || w.isDestroyed()) return;
    let host = '', page = '';
    try { const u = new URL(w.webContents.getURL()); host = u.host; page = u.pathname; } catch (_) { return; }
    if (!/(^|\.)pathofexile\.com$/.test(host) || /^\/login/.test(page)) return;
    asking = true;
    try { if (await tradeSiteCheck() && !w.isDestroyed()) w.close(); } finally { asking = false; }
  };
  w.webContents.on('did-navigate', look);
  w.on('closed', async () => {
    tradeLoginWin = null;
    await tradeSiteCheck();
    if (trouble) trouble.event('tradeSite', { what: 'sign-in window closed', signedIn: tradeSite.in });
    if (tradeSite.in) say(`Signed in to the trade site${tradeSite.name ? ` as ${tradeSite.name}` : ''}.`);
    if (win && !win.isDestroyed()) win.webContents.send('trade-find-news');
  });
  w.loadURL('https://www.pathofexile.com/login');
}
async function tradeSignOut() {
  if (tradeLoginWin) tradeLoginWin.close();
  await tradeSession().clearStorageData();
  tradeSite.in = false; tradeSite.name = ''; tradeSite.checked = true;
  if (findLast) findLast.tokens.clear();
  if (trouble) trouble.event('tradeSite', { what: 'signed out' });
}

// What the page gets of the last search: listings as they are shown, never a token.
function findView() {
  const l = findLast;
  return {
    league: config.league, busy: findBusy, saved: config.tradeSearches || [],
    site: { in: tradeSite.in, name: tradeSite.name, window: !!tradeLoginWin },
    canType: !!hook && watch.running,
    last: l ? {
      form: l.form, name: l.name, total: l.total, at: l.at, url: l.url, unknown: l.unknown, left: Math.max(0, l.ids.length - l.shown.length), error: l.error || '',
      listings: l.shown.map((x) => ({ ...x, asked: l.asked[x.id] || 0, travel: tradeSite.in && !!(l.tokens.get(x.id) || {}).hideout })),
    } : null,
  };
}
// Waits its turn behind a price check, and for the pause the site asks for (up to 20 s).
async function findTurn() {
  for (let i = 0; i < 50 && tradeClient.busy; i++) await sleep(100);
  const wait = Math.max(tradeClient.waitMs('search'), tradeClient.waitMs('fetch'));
  if (wait > 20000) throw new Error(`The trade site asked for a pause. It allows another search in ${Math.ceil(wait / 1000)} s.`);
  if (wait > 0) await sleep(wait + 150);
}
function findTake(l, raws) {
  const read = raws.map((r) => { l.tokens.set(r.id, tokensOf(r)); return readListing(r, chaosOfPrice); });
  l.shown = markBait(l.shown.concat(read));
}
async function findSearch(form) {
  const f = tradeFind.cleanForm(form);
  if (tradeFind.isEmpty(f)) { diag.count('trade search: not done, nothing filled in'); throw new Error('Pick an item, type a name, choose a kind of item or add a stat first.'); }
  if (!config.league) throw new Error('Choose a league in Settings first.');
  if (findBusy) { diag.count('trade search: not done, one is already running'); throw new Error('A search is already running.'); }
  findBusy = true;
  const timed = diag.start('price check: search from the Trade page (waiting included)');
  try {
    statIndex = statIndex || StatIndex.load();
    const { body, unknown } = tradeFind.buildFind(f, statIndex);
    if (!tradeSite.checked) await tradeSiteCheck();
    await findTurn();
    const r = await tradeClient.search(config.league, body);
    const l = { form: f, name: tradeFind.nameOf(f), body, queryId: r.queryId, ids: r.ids, total: r.total, shown: [], tokens: new Map(), asked: {}, url: r.queryId ? searchUrl(config.league, r.queryId) : '', at: Date.now(), unknown, error: '' };
    if (r.ids.length) { await findTurn(); findTake(l, await tradeClient.fetchItems(r.ids.slice(0, 10), r.queryId)); }
    findLast = l;
    timed(`${r.total} listed for "${l.name}", ${l.shown.length} read${tradeSite.in ? ', signed in' : ''}${unknown.length ? `, ${unknown.length} stats not known` : ''}`);
    if (trouble) trouble.event('tradeFind', { search: l.name, total: r.total, read: l.shown.length, signedIn: tradeSite.in, stats: f.stats.length, unknown: unknown.length || undefined });
  } catch (e) {
    timed(`failed: ${e.message || e}`, false, true);
    if (trouble) trouble.event('tradeFind', { failed: String(e && e.message) });
    throw e;
  } finally { findBusy = false; }
}
async function findMore() {
  const l = findLast;
  if (!l || l.shown.length >= l.ids.length) { diag.count('trade search: no more results to read'); return; }
  if (findBusy) throw new Error('A search is already running.');
  findBusy = true;
  const timed = diag.start('price check: ten more results on the Trade page (waiting included)');
  try {
    await findTurn();
    findTake(l, await tradeClient.fetchItems(l.ids.slice(l.shown.length, l.shown.length + 10), l.queryId));
    timed(`${l.shown.length} of ${l.ids.length} read`);
  } catch (e) { timed(`failed: ${e.message || e}`, false, true); throw e; } finally { findBusy = false; }
}
async function findAction(a) {
  a = a || {};
  const l = findLast, row = l && a.id ? l.shown.find((x) => x.id === String(a.id)) : null;
  switch (a.op) {
    case 'get': if (!tradeSite.checked) await tradeSiteCheck(); break;
    case 'lists': return { categories: tradeFind.CATEGORIES, rarities: tradeFind.RARITIES, sellers: tradeFind.SELLERS, kinds: tradeFind.KIND_WORDS };
    case 'items': {
      if (!findItemList) { const groups = await tradeClient.itemList(); if (groups.length) findItemList = tradeFind.readItems({ result: groups }); }
      if (!findItemList) { diag.count('trade search: the site gave no item list'); return { items: [], problem: 'The trade site did not give its list of items. Type the name and search by it instead.' }; }
      return { items: tradeFind.findItems(findItemList, String(a.text || '')) };
    }
    case 'stats': {
      if (!findStatList) { statIndex = statIndex || StatIndex.load(); findStatList = tradeFind.statList(statIndex); }
      return { stats: tradeFind.findStats(findStatList, String(a.text || '')) };
    }
    case 'search': await findSearch(a.form); break;
    case 'more': await findMore(); break;
    // One whisper per click: the line the trade site gives for that listing, typed in the game.
    case 'whisper': {
      const text = row ? String(row.whisper || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500) : '';
      if (!/^@\S+ \S/.test(text)) { diag.count('trade search: seller not whispered (no whisper line for that listing)'); throw new Error('That listing has no whisper line. Open the search on the trade site.'); }
      if (await sendChat(text)) l.asked[row.id] = Date.now();
      break;
    }
    // One trip per click: the site's own "Travel to Hideout" for that listing.
    case 'travel': {
      const token = row ? (l.tokens.get(row.id) || {}).hideout : '';
      if (!tradeSite.in || !token) { diag.count(`trade search: no hideout trip (${tradeSite.in ? 'the listing has none' : 'not signed in'})`); throw new Error(tradeSite.in ? 'That listing cannot be travelled to. Search again: the site gives each listing a fresh pass.' : 'Sign in to the trade site first.'); }
      const timed = diag.start('price check: travel to a seller\'s hideout through the trade site');
      try { await tradeClient.act(token); l.asked[row.id] = Date.now(); timed('the site accepted it'); if (trouble) trouble.event('tradeFind', { travel: row.name || row.base }); } catch (e) { timed(`failed: ${e.message || e}`, false, true); throw e; }
      break;
    }
    case 'want': {
      if (!l) { diag.count('trade search: nothing to put on the buying list'); break; }
      const first = l.shown.find((x) => x.icon);
      book.addWant({ name: l.name, icon: first ? first.icon : null, body: l.body, url: l.url, listings: l.shown.slice(0, 10).map(slimListing) });
      saveTradesSoon(); say(`${l.name} is on the buying list.`); push();
      break;
    }
    case 'open': if (l && /^https:\/\/www\.pathofexile\.com\/trade\//.test(l.url)) shell.openExternal(l.url); break;
    case 'save': {
      const form = tradeFind.cleanForm(a.form);
      if (tradeFind.isEmpty(form)) throw new Error('There is nothing in this search to save yet.');
      const name = String(a.name || '').trim().slice(0, 80) || tradeFind.nameOf(form);
      applyConfig({ tradeSearches: [{ name, form }].concat((config.tradeSearches || []).filter((x) => x.name !== name)) });
      break;
    }
    case 'unsave': applyConfig({ tradeSearches: (config.tradeSearches || []).filter((x) => x.name !== String(a.name || '')) }); break;
    case 'signin': tradeSignIn(); break;
    case 'signout': await tradeSignOut(); break;
    default: return null;
  }
  return findView();
}

// ---- stash searches ------------------------------------------------------------
// The menu of saved searches, at the mouse, over the game. Its key opens and closes it.
function toggleSearchMenu() {
  if (!searchMenu || !overlay) return;
  if (searchMenu.visible) { closeSearchMenu('key'); return; }
  if (layoutWin || !overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() })) return;
  const entries = menuEntries(config.stashSearches);
  if (trouble) trouble.event('stashSearchMenu', { open: true, entries: entries.length });
  searchMenu.show({ entries, key: config.hotkeys.stashSearch }, { bounds: overlay.display().bounds, cursor: screen.getCursorScreenPoint() });
}
function closeSearchMenu(why) {
  if (!searchMenu || !searchMenu.visible) return;
  if (trouble) trouble.event('stashSearchMenu', { open: false, why });
  searchMenu.hide();
}
// One click on a saved search: the menu closes and the search goes into the game's stash
// search box. Typed only on that click, never by itself.
async function pickSearch(i) {
  const s = (config.stashSearches || [])[Number(i)];
  closeSearchMenu('picked');
  if (!s || !s.text) return false;
  await sleep(80); // the menu picks on the press: let the mouse button come up before the keys go out
  return sendChat(s.text, { search: true });
}

// Sends one chat line to the game. Returns true when it went out.
// Nothing is typed unless Path of Exile is confirmed to be the window in front: keys go to
// whatever window has the keyboard, so typing blind could put the line in a browser or a chat.
// auto: the line is not the result of a click or key press, so the game window is never pulled
// to the front for it and failures stay quiet. send: false leaves the line unsent in the chat box.
// search: the text goes into the stash search box (Ctrl+F) instead of the chat.
async function sendChat(text, { auto = false, send = true, search = false } = {}) {
  if (trouble) trouble.event(search ? 'stashSearch' : 'chat', { text, auto, send, busy: chatBusy || undefined });
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
    return search ? await typeSearch(hook, clipboard, text) : await typeChat(hook, clipboard, text, { send });
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

// ---- jewels page -----------------------------------------------------------------
// The calculators live in src/jewels.js (timeless jewels in a worker). Here: the window's
// requests, reading a copied jewel, and the trade site price of a timeless seed.
let jewelService = null;
const jewels = () => jewelService || (jewelService = new JewelService({
  dir: dataFile('jewels'),
  fetchImpl: webFetch,
  onProgress: (p) => { if (win) win.webContents.send('jewel-progress', p); },
  onEvent: (kind, detail) => { if (trouble) trouble.event('jewels', { kind, detail }); },
}));

async function jewelAction(a) {
  a = a || {};
  if (trouble) trouble.event('jewels', { op: a.op });
  const svc = jewels();
  switch (a.op) {
    case 'info': return svc.info();
    case 'timeless': return svc.timeless({ jewel: String(a.jewel), seed: Number(a.seed), conqueror: String(a.conqueror || ''), socket: Number(a.socket) });
    case 'searchable': return svc.searchable(String(a.jewel));
    case 'search': return svc.search({ jewel: String(a.jewel), want: (a.want || []).slice(0, 200), sockets: (a.sockets || []).map(Number), smalls: !!a.smalls, limit: a.limit, onlyNodes: a.onlyNodes ? a.onlyNodes.map(Number) : null });
    case 'rank': return svc.rank({ jewel: String(a.jewel), want: (a.want || []).slice(0, 200), socket: Number(a.socket), seed: Number(a.seed), smalls: !!a.smalls, onlyNodes: a.onlyNodes ? a.onlyNodes.map(Number) : null });
    case 'goals': return svc.goals(String(a.jewel));
    case 'verdict': return svc.verdict({ jewel: String(a.jewel), seed: Number(a.seed), conqueror: String(a.conqueror || ''), socket: Number(a.socket), want: (a.want || []).slice(0, 200), goals: (a.goals || []).map(String).slice(0, 12), nodes: (a.nodes || []).map(Number), smalls: !!a.smalls });
    case 'build': return svc.buildFromText(String(a.text || ''));
    case 'characters': return svc.characters(String(a.account || ''));
    case 'character': return svc.character(String(a.account || ''), String(a.name || ''));
    case 'radius': return svc.radius({ jewel: String(a.jewel), socket: Number(a.socket), ring: String(a.ring || ''), keystone: Number(a.keystone), taken: (a.taken || []).map(Number) });
    case 'cluster': return svc.cluster(String(a.base), String(a.skill));
    // A timeless jewel copied in game (Ctrl+C on it, then the Paste button).
    case 'paste': {
      const text = clipboard.readText();
      const got = readJewelText(text);
      if (got) return got;
      // Say what was on the clipboard, so a jewel the reader misses can be put right.
      if (trouble) trouble.event('jewels-paste', { text: text.slice(0, 400) });
      const start = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' / ').slice(0, 90);
      return { error: text.trim()
        ? `The copied text is not a timeless jewel. It starts with: "${start}". Hover the jewel in game, press Ctrl+C, then Paste.`
        : 'The clipboard is empty. Hover the jewel in game, press Ctrl+C, then Paste.' };
    }
    case 'price': {
      // The cheapest listings of this seed, from the official trade site.
      if (!config.league) throw new Error('Pick a league in Settings first.');
      const r = await tradeClient.check(config.league, jewelTradeQuery(String(a.jewel), Number(a.seed), a.conqueror ? String(a.conqueror) : null), 5);
      const listings = r.listings.map((l) => readListing(l, chaosOfPrice)).filter((l) => l.chaos != null);
      return { total: r.total, url: r.queryId ? searchUrl(config.league, r.queryId) : '', cheapest: listings.length ? Math.min(...listings.map((l) => l.chaos)) : null, listings: listings.slice(0, 5).map((l) => ({ chaos: l.chaos, status: l.status })) };
    }
    case 'open': { const url = String(a.url || ''); if (/^https:\/\/www\.pathofexile\.com\/trade\//.test(url)) shell.openExternal(url); return true; }
    default: throw new Error('Unknown request');
  }
}

// ---- ultimatum page --------------------------------------------------------------
// Inscribed Ultimatums in a public stash tab, read from the trade site by account name and
// valued by what they give (src/core/ultimatum.js). The last answer is kept for the page.
let ultimatumLast = null;
let ultimatumBusy = false;
async function ultimatumAction(a) {
  a = a || {};
  if (a.op === 'get') return { last: ultimatumLast, busy: ultimatumBusy, league: config.league };
  if (a.op !== 'scan') return null;
  if (ultimatumBusy) { diag.count('ultimatum: not done, a look-up is already running'); throw new Error('A look-up is already running.'); }
  ultimatumBusy = true;
  const tell = (done, total) => { if (win && !win.isDestroyed()) win.webContents.send('ultimatum-progress', { done, total }); };
  try {
    const r = await ultimatum.scan({ client: tradeClient, league: config.league, account: a.account, sleep, onPart: tell });
    const chaosOf = (name) => prices.chaosOf(name);
    const items = ultimatum.sortByWorth(r.items.map((u) => ({ ...u, value: ultimatum.valueOf(u, chaosOf), find: ultimatum.searchFor(u), listedChaos: u.listed ? chaosOfPrice(u.listed.amount, u.listed.currency) : null })));
    ultimatumLast = { at: Date.now(), account: r.account, league: r.league, total: r.total, items, tabs: ultimatum.tabsOf(items) };
    const unknown = items.filter((u) => u.value.chaos === null).length;
    if (trouble) trouble.event('ultimatum', { found: r.total, read: items.length, noValue: unknown, tabs: ultimatumLast.tabs.map((t) => `${t.name}: ${t.count} as ${t.kind} ${t.cols}x${t.rows} (${t.shape})`) });
    return { last: ultimatumLast, busy: false, league: config.league };
  } catch (e) {
    if (trouble) trouble.event('ultimatum', { failed: String(e && e.message) });
    throw e;
  } finally {
    ultimatumBusy = false;
  }
}

// ---- window --------------------------------------------------------------------
// Opens where it was last (window.json: its place when not maximised, and whether it was
// maximised), see core/windowPlace.js. Saved a moment after every move or resize, not at
// closing: a restart for an update destroys the window without a 'close'.
function createWindow() {
  const place = placeWindow(readJson('window.json', null), screen.getAllDisplays(), screen.getPrimaryDisplay().id);
  const { maximized, from, ...bounds } = place;
  diag.facts['Window opened'] = `${from}: ${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}${maximized ? ', maximised' : ''}`;
  win = new BrowserWindow({
    ...bounds,
    backgroundColor: '#1b1f24', title: 'Map Companion', autoHideMenuBar: true, icon: path.join(__dirname, 'ui', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setBounds(bounds); // again: across screens with different scaling the first placing can land off
  win.once('ready-to-show', () => {
    if (maximized) win.maximize();
    win.show();
    diag.time('start: from opening the app to its window', process.uptime() * 1000);
    // Read now, not when it is written: by then the window can be gone.
    let last = null;
    const keep = () => { if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return; last = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }; writeJsonSoon('window.json', () => last); };
    for (const ev of ['move', 'resize', 'maximize', 'unmaximize']) win.on(ev, keep);
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; if (overlay) overlay.destroy(); if (layoutWin) layoutWin.destroy(); if (toast) toast.destroy(); if (checkPanel) checkPanel.destroy(); if (searchMenu) searchMenu.destroy(); });
}

// ---- IPC -----------------------------------------------------------------------
// "Send to Claude" on the Under the hood page: the same text as Copy for Claude, put into the
// reports repository as hood/<when>-<who>/README.md (with the numbers behind it), so several can
// pile up there and be read later without pasting each into a chat. Returns '' or what went wrong.
async function sendHood(last, note) {
  const done = diag.start('under the hood: report sent to GitHub');
  try {
    const snap = last ? diagnose.lastRun() : diag.snapshot();
    if (!snap) { done('no run before this one is kept', false, true); return 'There is no run before this one to send.'; }
    const gh = await cloud.github();
    if (gh.error || !gh.token) { done('no token', false, true); return gh.error || 'No GitHub token is saved. An admin sets it in Settings, Developer tools.'; }
    const who = (cloud.name || 'someone').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'someone';
    const d = new Date(), two = (n) => String(n).padStart(2, '0');
    const id = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}-${who}${last ? '-before' : ''}`;
    const words = String(note || '').trim().slice(0, 2000);
    const title = last ? `Map Companion, under the hood: the run before this one (${snap.ended || 'it did not close normally: a crash, or the PC went off'})` : 'Map Companion, under the hood';
    const text = `${words ? `> Note from ${who}: ${words.replace(/\n/g, '\n> ')}\n\n` : ''}${hoodReport(snap, { title, version: last ? '' : (trouble && trouble.version) || '' })}`;
    const meta = { id, by: who, role: cloud.role || '', at: Date.now(), app: APP_VERSION, commit: (trouble && trouble.version) || '', last: !!last, note: words };
    const marks = Array.isArray(advMarks) ? advMarks : readJson('advanced-marks.json', []) || [];
    const r = await uploadFolder({
      fetchImpl: webFetch, token: gh.token, repo: gh.repo, folder: `hood/${id}`,
      files: [
        { path: 'README.md', data: Buffer.from(text) },
        { path: 'meta.json', data: Buffer.from(JSON.stringify(meta, null, 1)) },
        { path: 'diagnostics.json.gz', data: zlib.gzipSync(Buffer.from(JSON.stringify(snap))) },
        // the marks on advanced prices (Too low, Right, Too high), each with its item: what the value table is tuned from
        ...(!last && marks.length ? [{ path: 'advanced-marks.json', data: Buffer.from(JSON.stringify(marks, null, 1)) }] : []),
      ],
      message: `Under the hood ${id}${words ? `: ${words.split('\n')[0].slice(0, 70)}` : ''}`,
    });
    done(`hood/${id}`);
    diag.note('hood', `Report sent to GitHub: hood/${id}`);
    return { sent: `hood/${id}`, url: r.url };
  } catch (e) {
    done(`failed: ${e.message || e}`, false, true);
    return e.message || String(e);
  }
}

// What Under the hood knows about how the app is set up: the settings without anything
// private or long, and what the status chips say.
function hoodFacts() {
  const { shareToken, trackerLayout, customPrices, stashSearches, regex, strategies, mapRules, ignoredItems, navOrder, ...rest } = config || {};
  diag.facts.settings = scrub({ ...rest, strategies: (strategies || []).length, stashSearches: (stashSearches || []).length, customPrices: Object.keys(customPrices || {}).length, ignoredItems: (ignoredItems || []).length, mapRulesOff: (mapRules || []).filter((r) => r.enabled === false).map((r) => r.id) });
}
// How big the app's own lists are, read every half minute: something that only ever grows shows here.
function hoodSizes() {
  hoodFacts();
  diag.facts['Game'] = `${watch.running ? 'running' : 'not seen'}${watch.gameInFront() ? ', in front' : ''}; log ${status.log.ok ? 'read' : `not read (${status.log.error})`}; keys helper ${status.inventory.keyHook}; signed in: ${cloud && cloud.signedIn ? `yes (${cloud.role || 'user'})` : 'no'}`;
  return {
    'Maps in this session': session.summary(prices).runs.length, 'Items named on this PC': learned.length, 'Shared item pictures': index.shared.length, 'Item pictures from poe.ninja': index.art.length,
    'Prices known': prices.size || status.prices.count, 'Items waiting for a name': backlog.items.length, 'Trade offers kept': book.offers.length, 'Finished trades kept': book.history.length, 'Missed offers kept': book.missed.length, 'Things on the buying list': book.wants.length,
    'Results of the last trade search': findLast ? findLast.shown.length : 0, 'Items of the trade site kept': findItemList ? findItemList.length : 0,
    'Advanced price searches kept for a minute': advKept.size, 'Marks on advanced prices': Array.isArray(advMarks) ? advMarks.length : 0,
    'Slots in the last reading': lastInventory.cells.length, 'Saved sessions': archive ? archive.list().length : 0, 'Files waiting to be written': savesWaiting.size + savesRunning.size,
  };
}
function applyConfig(patch) {
  if (trouble) trouble.event('setting', patch);
  if (patch.stashSearches) patch = { ...patch, stashSearches: cleanSearches(patch.stashSearches) };
  if (patch.tradeSearches) patch = { ...patch, tradeSearches: tradeFind.cleanSaved(patch.tradeSearches) };
  if (patch.regex) patch = { ...patch, regex: cleanBuilders(patch.regex) };
  const leagueBefore = config.league, logBefore = config.logPath, hookBefore = hookSetup();
  if (patch.trade) patch = { ...patch, trade: mergeTrade(config.trade, patch.trade) };
  config = {
    ...config, ...patch,
    hotkeys: { ...config.hotkeys, ...(patch.hotkeys || {}) },
    inventory: { ...config.inventory, ...(patch.inventory || {}) },
    priceSearch: { ...config.priceSearch, ...(patch.priceSearch || {}) },
  };
  writeJsonSoon('config.json', () => config);
  if (patch.priceSearch && config.priceSearch.overlay === false && checkPanel) { checkPanel.hide(); if (tradeCheck) tradeCheck.inGame = false; }
  if (patch.customPrices) { prices.setCustom(config.customPrices); index.rev++; itemsRev++; }
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
  stashSearch: (a) => pickSearch(a.i),
  // The Regex page: copy a search, or put it in the game's stash search box (one click, one search).
  regexCopy: (a) => {
    const text = String(a.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    if (!text) return;
    clipboard.writeText(text);
    say(text.length > SEARCH_LIMIT ? `Copied, but it is ${text.length} characters: the game keeps only the first ${SEARCH_LIMIT}.` : 'Copied. In game, press Ctrl+F over your stash or a vendor and paste it with Ctrl+V.');
  },
  regexSend: (a) => { const text = String(a.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500); return text ? sendChat(text, { search: true }) : false; },
  startRun: (a) => { session.startRun({ name: a.name || 'Manual run', loadout: config.loadout }); syncLedger(); },
  endRun: () => { session.endRun(); syncLedger(); },
  // The session clock's buttons: pause, resume, stop, start.
  sessionClock: (a) => { session.clockAction(a.id); }, // a.id: pause, resume, stop or start
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
  readInventory: () => readInventory(true),
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
  // Where a sent recording or report stands (Planned, In progress, Fixed…) and whether it is a
  // problem or a suggestion: shared with everyone through the reports repository.
  troubleStatus: async (a) => {
    if (!trouble || !canTrouble()) return;
    const change = {};
    if (a.state !== undefined) change.state = String(a.state || '');
    if (a.kind !== undefined) change.type = String(a.kind || '');
    const error = await trouble.setStatus(String(a.id || ''), change);
    say(error ? `Not changed: ${error}` : 'Changed, for everyone.', !!error);
  },
  // Connects a sent recording or report to a box in the tracker (admins): to one that is there
  // (a line with its link goes into the box's text), or to a new box under one. The recording
  // remembers the box in its status, so everyone sees where it went.
  troubleTrack: async (a) => {
    if (!trouble || !isAdmin()) { say('Only admins can use the tracker.', true); return; }
    const id = String(a.id || '');
    const d = trouble.details(id);
    if (!d || !d.sent) { say('Send it first: only what is on GitHub can go into the tracker.', true); return; }
    const first = String(d.note || '').trim().split('\n')[0].slice(0, 120);
    const rec = { id, type: d.type, by: d.by, title: first || id, url: d.sent.url };
    let r;
    if (a.make) {
      const title = String(a.title || '').trim() || first || `Recording ${id}`;
      r = await trackerAction({ type: 'add', title, body: `${String(d.note || '').trim()}\n\n${tracker.recordingLine(rec)}\n`, status: ['idea', 'considering', 'todo', 'doing'].includes(a.status) ? a.status : d.type === 'suggestion' ? 'idea' : 'todo', parent: a.parent == null ? null : Number(a.parent) });
    } else {
      r = await trackerAction({ type: 'record', number: Number(a.issue), rec });
    }
    if (r.error) { say(`Not put in the tracker: ${r.error}`, true); return; }
    const error = await trouble.setStatus(id, { issue: r.item.number });
    say(error ? `It is in the tracker as #${r.item.number}, but the recording could not remember it: ${error}` : `${a.make ? 'New box' : 'Connected to'} #${r.item.number} in the tracker.`, !!error);
  },
  troubleUntrack: async (a) => {
    if (!trouble || !isAdmin()) return;
    const id = String(a.id || '');
    const st = trouble.statusOf(id);
    if (!st || !st.issue) return;
    const r = await trackerAction({ type: 'unrecord', number: st.issue, id });
    const error = r.error || await trouble.setStatus(id, { issue: null });
    say(error ? `Not taken out: ${error}` : r.item && r.item.gone ? `#${st.issue} was deleted from the tracker; the recording no longer points at it.` : `Taken out of #${st.issue}.`, !!error);
  },
  // Problem or suggestion, chosen before sending.
  troubleType: (a) => { if (trouble) trouble.setType(String(a.id || ''), String(a.kind || '')); },
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
    writeJsonSoon('learned.json', () => learned);
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
  // The History part's Export: the window made the text from what it shows; here it is saved where the owner picks.
  tradeExport: async (a) => {
    const text = String(a.text || '').slice(0, 2_000_000);
    const r = await dialog.showSaveDialog(win, { title: 'Save trades', defaultPath: 'trades.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return;
    try { await fs.promises.writeFile(r.filePath, text, 'utf8'); say(`Saved ${path.basename(r.filePath)}.`); } catch (err) { say(`Could not save the file: ${err.message}`, true); }
  },
  tradeNote: (a) => { book.setNote(a.player, a.text); saveTradesSoon(); },
  tradeTradeNote: (a) => { book.setTradeNote(String(a.id || ''), a.text); saveTradesSoon(); },
  tradeMarket: (a) => tradeMarket(a.id),
  wantAdd: () => wantAdd(),
  wantSearch: (a) => wantSearch(String(a.id || '')),
  wantWhisper: (a) => wantWhisper(String(a.id || ''), String(a.seller || '')),
  wantRemove: (a) => { book.removeWant(String(a.id || '')); saveTradesSoon(); },
  wantLimit: (a) => { const n = Number(a.amount); book.setWant(String(a.id || ''), { limit: n > 0 ? { amount: n, currency: a.currency === 'chaos' ? 'chaos' : 'divine' } : null }); saveTradesSoon(); },
  wantOpen: (a) => { const w = book.want(String(a.id || '')); if (w && /^https:\/\/www\.pathofexile\.com\//.test(w.url)) shell.openExternal(w.url); },
  // A player picked on the Trade page's People part, with no open offer: whisper (left open to finish) or /ignore.
  tradePlayer: async (a) => {
    const what = a.do === 'ignore' ? 'ignore' : 'whisper';
    const text = chatCommand(what, { player: String(a.player || '') });
    if (!text) { say('That player name cannot be typed in the game.', true); return; }
    await sendChat(text, what === 'whisper' ? { send: false } : undefined);
  },
  // The Search button: what was ticked and typed replaces the choices, then one search is sent.
  tradeSearch: async (a) => {
    if (tradeCheck && tradeCheck.kind === 'bulk') { await runBulkSearch(); return; }
    if (!tradeCheck || !tradeCheck.filters.ok || tradeCheck.state === 'searching') return;
    tradeCheck.filters = applyEdits(tradeCheck.filters, a.edits);
    tradeCheck.craftEdits = null; // the choices searched are now the item's own: the crafts follow them
    if (a.edits && Array.isArray(a.edits.crafts) && tradeCheck.craft) tradeCheck.craftOn = a.edits.crafts.filter((k) => tradeCheck.craft.ideas.some((i) => i.stat === k && i.priced));
    tradeCheck.filtersRev += 1; // the other window showing this item redraws its tick boxes
    await runTradeSearch(false);
  },
  tradeClose: () => { tradeCheck = null; if (checkPanel) checkPanel.hide(); },
  // The cross on the window in game: the search stays on the Prices page.
  checkPanelClose: () => closeCheckPanel(),
  checkPickUnique: (a) => pickChoice(String(a.name || '')),
  // The ticks or numbers changed in the window: what each craft adds, for those choices.
  craftPrices: (a) => {
    const tc = tradeCheck;
    if (!tc || !tc.craft || !tc.filters.ok || tc.state !== 'done') return;
    tc.craftEdits = a.edits || null;
    runCrafts(tc, applyEdits(tc.filters, tc.craftEdits)).catch(() => {});
  },
  checkSite: (a) => { const url = checkSiteUrl(String(a.site || '')); if (url) shell.openExternal(url); },
  // the socket button on the price check window: shown or hidden on every item picture there
  checkSockets: () => { applyConfig({ priceSearch: { sockets: config.priceSearch.sockets === false } }); push(); },
  tradeOpen: () => { if (tradeCheck && /^https:\/\/www\.pathofexile\.com\//.test(tradeCheck.url)) shell.openExternal(tradeCheck.url); },
  // the advanced check's band: its own search on the trade site, and a mark on its price
  advancedOpen: () => { const url = tradeCheck && tradeCheck.adv && tradeCheck.adv.url; if (url && /^https:\/\/www\.pathofexile\.com\//.test(url)) shell.openExternal(url); },
  advancedSay: (a) => advancedSay(String(a.say || '')),
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
  // Every question the window asks is timed for the Under the hood page. what(a): the kind of
  // question, where one channel carries several.
  const handle = (channel, fn, what) => ipcMain.handle(channel, (e, ...args) => diag.run(`asked by the window: ${channel}${what ? ` ${what(...args)}` : ''}`, () => fn(e, ...args)));
  const kind = (a) => String((a && (a.type || a.op)) || '');
  handle('get-state', () => buildState());
  handle('set-config', (_e, patch) => { applyConfig(patch || {}); return true; });
  handle('account', (_e, a) => accountAction(a), kind);
  // The game log check: is the file being written to, what arrived, and what the tracker did.
  handle('log-check', () => ({
    path: status.log.path, ok: status.log.ok, error: status.log.error, now: Date.now(),
    stats: logTail ? { ...logTail.stats } : null,
    inMap: !!(session.current && session.current.segmentStart !== null), mapName: session.current ? session.current.name || session.current.code : null,
    location: session.location, trace: logTrace.slice().reverse(),
  }));
  handle('inventory', () => {
    const cells = lastInventory.cells.map((c) => {
      const each = c.name ? prices.chaosOf(c.name) : 0;
      return { cell: c.cell, status: c.status, name: c.name, qty: c.qty, source: c.source, score: c.score, how: c.how, near: c.near, guess: c.guess, image: c.image, each, total: each * (c.qty || 0) };
    });
    return { rev: lastInventory.rev, at: lastInventory.at, cols: COLS, rows: ROWS, cells };
  });
  // The inventory pictures kept for one map, with each slot's value at today's prices.
  handle('run-snapshot', (_e, runId) => {
    const data = snapshots ? snapshots.get(String(runId || '')) : { trips: [] };
    return {
      cols: COLS, rows: ROWS,
      trips: data.trips.map((t) => ({
        trip: t.trip, at: t.at, image: t.image, stale: !!t.stale,
        cells: t.cells.map((c) => { const each = c.name ? prices.chaosOf(c.name) : 0, e = c.name ? prices.get(c.name) : null; return { ...c, packed: undefined, each, total: each * (c.qty || 0), icon: (e && e.icon) || null }; }),
      })),
    };
  });
  handle('jewels', (_e, a) => jewelAction(a), kind);
  handle('ultimatum', (_e, a) => ultimatumAction(a), kind);
  handle('trade-find', (_e, a) => findAction(a), kind);
  handle('items-list', () => itemDatabase());
  handle('saved-session', (_e, id) => (archive ? archive.get(String(id || '')) : null));
  handle('price-categories', () => {
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
  handle('price-list', (_e, a) => {
    const r = prices.list(String((a && a.category) || ''), String((a && a.query) || ''), 400);
    return { total: r.total, rows: r.rows.map((e) => ({ name: e.name, chaos: e.chaos, category: e.category, icon: e.icon || null, change: e.change == null ? null : e.change, volume: e.volume == null ? null : e.volume, listings: e.listings == null ? null : e.listings, spark: e.spark || null })) };
  });
  handle('search', (_e, q) => prices.search(String(q || ''), 40).map((e) => ({ name: e.name, chaos: e.chaos })));
  handle('layout-get', () => layoutData());
  ipcMain.on('check-size', (e, h) => { if (checkPanel && checkPanel.win && e.sender === checkPanel.win.webContents) checkPanel.setHeight(h); });
  // A number typed in the price check window: the keys it needs are held while it is typed.
  ipcMain.on('check-keys', (e, on) => {
    if (!checkPanel || !checkPanel.win || e.sender !== checkPanel.win.webContents) return;
    checkPanel.takeKeys(!!on);
  });
  ipcMain.on('search-size', (e, h) => { if (searchMenu && searchMenu.win && e.sender === searchMenu.win.webContents) searchMenu.setHeight(h); });
  ipcMain.on('overlay-size', (e, h) => { if (overlay && overlay.win && e.sender === overlay.win.webContents) overlay.setHeight(h); });
  handle('trouble-list', () => (trouble ? trouble.list() : []));
  handle('trouble-details', (_e, id) => (trouble ? trouble.details(String(id || '')) : null));
  handle('trouble-video', async (_e, id) => {
    if (!trouble) return null;
    try { return await trouble.videoFor(String(id || '')); } catch (e) { say(`The video could not be fetched: ${e.message || e}`, true); push(); return null; }
  });
  handle('dev', (_e, a) => devAction(a || {}), kind);
  handle('tracker', (_e, a) => trackerAction(a || {}), kind);
  // Written reports: a new one (answers its id), pictures added to it, and pictures to show.
  handle('trouble-new', async () => (trouble && canTrouble() ? trouble.newReport() : null));
  handle('trouble-add-image', (_e, id, bytes, type) => (trouble ? trouble.addImage(String(id || ''), bytes, String(type || '')) : 'Not ready.'));
  handle('trouble-image', (_e, id, name) => (trouble ? trouble.image(String(id || ''), String(name || '')) : null));
  handle('trade-book', () => book.ledger(prices));
  ipcMain.handle('action', async (_e, a) => {
    const fn = a && actions[a.type];
    if (!fn) return false;
    // Typing a note is not news; everything else pressed in the window is.
    if (trouble && a.type !== 'troubleNote') trouble.event('action', a.type === 'tradeExport' ? { type: a.type } : a); // not the whole file's text
    await diag.run(`button: ${a.type}`, () => fn(a));
    changed();
    return true;
  });
  // The Under the hood page (admins and moderators): the numbers, start them over, or the
  // whole thing as text on the clipboard, to paste into a chat with Claude.
  ipcMain.handle('hood', async (_e, a) => {
    if (!canTrouble()) return null;
    const op = a && a.op;
    if (op === 'send' || op === 'sendLast') return sendHood(op === 'sendLast', a.note);
    if (op === 'reset') diag.reset();
    if (op === 'copy') { clipboard.writeText(hoodReport(diag.snapshot(), { title: 'Map Companion, under the hood', version: (trouble && trouble.version) || '' })); return true; }
    // The run before this one, kept on disk: what the app was doing before it was closed, or crashed.
    if (op === 'copyLast') {
      const last = diagnose.lastRun();
      if (!last) return false;
      clipboard.writeText(hoodReport(last, { title: `Map Companion, under the hood: the run before this one (${last.ended || 'it did not close normally: a crash, or the PC went off'})` }));
      return true;
    }
    // The page gets the latest lines only; the rest is in the copy.
    const snap = diag.snapshot();
    return { ...snap, log: snap.log.slice(-400), logAll: snap.log.length + snap.logDropped, every: diagnose.SAMPLE_MS, lastRun: diagnose.hasLastRun() };
  });
  // What a window measured about itself: its drawing times, its own freezes and errors.
  ipcMain.on('hood-page', (e, d) => diagnose.pageNews(e.sender, d));
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
  diagnose.start({ dir: path.join(app.getPath('userData'), 'diagnostics'), sizes: hoodSizes, sampled: (u) => { if (trouble && trouble.recording) trouble.event('usage', { cpu: Math.round(u.cpu * 10) / 10, mem: Math.round(u.mem), pcCpu: u.pcCpu == null ? null : Math.round(u.pcCpu), pcFree: Math.round(u.pcFree) }); } });
  // Every step of the start is timed by name (Under the hood, "start step: ..."): on the owner's
  // PC the app stood still for 2 to 6 seconds here and nothing said in which step.
  diag.time('start step: Electron ready', process.uptime() * 1000, 'from the program starting to here');
  const step = (name, fn) => diag.run(`start step: ${name}`, fn);
  step('settings', () => {
    loadConfig();
    prices.setCustom(config.customPrices);
  });
  step('session and loot from disk', () => {
    session.restore(readJson('session.json', null));
    ledger.restore(readJson('ledger.json', null));
  });
  step('named items from disk', () => {
    loadLearned();
  });
  step('map pictures, saved sessions and trades from disk', () => {
    snapshots = new SnapshotStore(dataFile('snapshots'));
    try {
      const c = readJson('carried.json', null);
      if (c && Array.isArray(c.cells)) carriedIn = { ...c, cells: c.cells.map((x) => ({ ...x, print: x.print ? decodePrint(x.print) : null })) };
    } catch (_) { carriedIn = null; }
    archive = new SessionArchive(dataFile('sessions'));
    book.restore(readJson('trades.json', null));
  });
  step('windows over the game made', () => {
    overlay = new Overlay({ preload: path.join(__dirname, 'preload.js'), page: path.join(__dirname, 'ui', 'overlay.html') });
    toast = new Toast({ page: path.join(__dirname, 'ui', 'toast.html') });
    searchMenu = new SearchMenu({ preload: path.join(__dirname, 'preload.js'), page: path.join(__dirname, 'ui', 'search.html') });
    checkPanel = new CheckPanel({ preload: path.join(__dirname, 'preload.js'), page: path.join(__dirname, 'ui', 'check.html'), onClose: () => { if (tradeCheck) tradeCheck.inGame = false; }, onKeys: (on) => typingKeys(on) });
  });
  watch.on('started', (ms) => diag.time('helper: front-window helper started (on its own thread)', ms));
  watch.on('change', syncOverlay);
  watch.on('change', () => { if (trouble) trouble.event('front', { game: watch.gameInFront(), own: watch.ownInFront(), name: watch.name || '' }); });
  // Away from the game nothing is drawn over the screen.
  watch.on('change', () => { if (checkPanel.visible && !overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() })) { checkPanel.hide(); if (tradeCheck) tradeCheck.inGame = false; } });
  watch.on('change', () => { if (searchMenu && searchMenu.visible && !overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() })) closeSearchMenu('game left the front'); });
  watch.on('change', () => { if (watch.gameInFront() !== gameKeysOn) { registerHotkeys(); push(); } });
  step('front-window helper started', () => {
    watch.start();
  });
  // Where the app's windows over the game are: with one over the inventory, captures go the old way, which leaves them out.
  const onScreen = (w) => !!(w && !w.isDestroyed() && w.isVisible());
  watchOwnWindows(() => [overlay && overlay.win, toast && toast.win, checkPanel && checkPanel.win, searchMenu && searchMenu.win, layoutWin].filter(onScreen).map((w) => w.getBounds()));
  setTimeout(warmUpCapture, 6000);
  step('prices and item pictures from disk', () => {
    const cached = PriceTable.fromJSON(readJson('prices.json', null));
    if (cached.size > 1) { setPrices(cached); syncArt(); }
  });

  step('main window made, keys taken', () => {
    setupIpc();
    createWindow();
    registerHotkeys();
  });
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
  step('game log opened', () => {
    startLog();
  });
  step('key and mouse helper started', () => {
    syncKeyHook();
    syncTimedWatch();
  });
  step('prices asked for', () => {
    refreshPrices();
    setInterval(refreshPrices, PRICE_REFRESH_MS);
  });
  setInterval(() => {
    const sec = Number(config.trade.auto.closeBoughtSec) || 0;
    if (sec > 0 && book.closeBought(sec * 1000)) saveTradesSoon();
    if (session.tick()) scheduleSave(); // the session clock stops after a while with no map
    push();
  }, 5000);

  step('account and troubleshooting set up', () => {
    loadCloud();
    setupTrouble();
    registerHotkeys(); // the record key goes with the role kept from the last login
  });
  // The role may have been given or taken since the last start.
  cloud.refresh().then((moved) => { if (moved) { registerHotkeys(); push(); } }, () => {});
  step('shared items asked for', () => {
    shared = new SharedItems({ cloud });
    loadShared();
  });
  setInterval(loadShared, SHARED_REFRESH_MS);
  setTimeout(syncCloud, 5000);
  setInterval(syncCloud, CLOUD_RETRY_MS);

  step('update looked for', () => {
    updater = new Updater(app.getAppPath(), webFetch);
    status.update.current = updater.current;
    if (updater.current && updater.current.sha) trouble.version = updater.current.sha;
    checkUpdate();
  });
  setInterval(checkUpdate, UPDATE_CHECK_MS);
});

app.on('will-quit', () => {
  diagnose.stop();
  globalShortcut.unregisterAll();
  if (jewelService) jewelService.stop();
  watch.stop();
  stopCapture();
  clearInterval(timedTimer);
  if (hook) { try { hook.uIOhook.stop(); } catch (_) { /* closing anyway */ } }
  writeJson('session.json', session.toJSON());
  writeJson('ledger.json', ledger.toJSON());
  writeJson('trades.json', book.toJSON());
  writeJson('seen.json', seenItems);
  flushSaves();
});
// The overlay is a window too, so quitting hangs on the main window alone.
app.on('window-all-closed', () => app.quit());
