'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, dialog, screen, shell, nativeImage, safeStorage } = require('electron');

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
const { IconIndex, similarity, fingerprint, encodePrint, decodePrint } = require('./core/inventory/icons');
const { readStack } = require('./core/inventory/digits');
const { InventoryReader, SINGLE_ART_SCORE } = require('./core/inventory/reader');
const { LootLedger } = require('./core/inventory/ledger');
const { captureFrame, cursorInFrame, cursorOnDisplay } = require('./capture');
const { ArtLoader } = require('./art');
const { Updater } = require('./updater');
const { webFetch } = require('./http');
const { SharedItems } = require('./shared');
const { SnapshotStore, SessionArchive, markCarried, recheckCells } = require('./core/store');
const { Backlog } = require('./core/inventory/backlog');
const { checkMessage, noteMessage, tradeMessage } = require('./core/checkMessage');
const { TradeBook, chatCommand, nextAction, autoSteps, overlayAllowed, overlayBounds, placementFromRect, DEFAULT_MESSAGES, LABELS } = require('./core/trade');
const { focusGame, typeChat } = require('./chat');
const { Overlay, Toast, CheckPanel } = require('./overlay');
const { GameWatch } = require('./gamewin');
const { closeLeftovers, restartCommand } = require('./leftovers');
const { checkPanelBounds } = require('./core/checkPanel');
const { StatIndex } = require('./core/tradeStats');
const { searchable, buildFilters, applyEdits, isNarrow, buildQuery, summarize } = require('./core/tradeQuery');
const { TradeClient, readListing, searchUrl, currencyName } = require('./core/tradeApi');

const PRICE_REFRESH_MS = 30 * 60 * 1000;
const UPDATE_CHECK_MS = 2 * 60 * 1000;
const SHARED_REFRESH_MS = 10 * 60 * 1000;

const DEFAULT_CONFIG = {
  league: '',
  logPath: '',
  characterName: '',
  // clipboard: check the hovered item and, over the inventory, name or count its slot.
  // priceCheck: only check its price; nothing is named or counted. Held only while the game is in front.
  hotkeys: { clipboard: 'F8', snapshot: 'F9', priceCheck: 'Ctrl+F' },
  checkToast: true, // after the check key, say in game for a moment what was read
  // auto: checking an item searches the trade site straight away (two web requests).
  // overlay: show the search on top of the game, beside the inventory or stash.
  priceSearch: { auto: true, overlay: true },
  // key: the key that opens your inventory in game. onKey: read once each time you press it.
  // timed: also check by itself every intervalMs (breaks GGG's one-read-per-key-press rule).
  // autoCopy: the check hotkey presses Ctrl+Alt+C in the game for you (one copy per key press).
  inventory: { displayId: null, key: 'Tab', onKey: true, timed: false, intervalMs: 1000, autoCopy: true },
  mapRules: DEFAULT_RULES,
  loadout: [],
  // What you are farming: each has a name and an atlas tree link, and its own sessions.
  strategies: [{ id: 'default', name: 'Default', atlasUrl: '' }],
  activeStrategy: 'default',
  customPrices: {}, // name -> chaos, for items poe.ninja does not list
  navOrder: [], // sidebar pages in the order you dragged them; pages not listed keep their usual place
  shareToken: '', // GitHub token for uploading named items, stored encrypted
  // Trade offers from whispers. overlay: show them on top of the game. position and offsets:
  // where on the game's screen. hotkeys.next does the next step for the oldest offer (one chat
  // line per press); hotkeys.dismiss removes the oldest offer.
  trade: {
    enabled: true, overlay: true, position: 'bottom', offsetX: 0, offsetY: 0, sound: true,
    // invite, trade, busy, still and whisper act on the newest buyer and are unset until you
    // choose them. hideout and remaining type /hideout and /remaining; they are only held while
    // the game is in front, so F5 still refreshes a browser page.
    hotkeys: { next: 'F2', dismiss: 'F3', layout: 'Shift+F2', invite: '', trade: '', busy: '', still: '', whisper: '', hideout: 'F5', remaining: '' },
    // Steps taken without a key press once the game reports "Trade accepted", and around it.
    // All off unless switched on: GGG's rule is one action per key press or click.
    auto: { thankSold: false, kickSold: false, thankBought: false, leaveBought: false, homeBought: false, joinHideout: false, ignoreSold: false, closeBoughtSec: 0 },
    messages: { ...DEFAULT_MESSAGES },
  },
  // Where each thing on the overlay sits, once it has been dragged in layout mode: id -> { x, y, grow }.
  overlayLayout: {},
};

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
let snapshots = null; // the inventory as read for each map
let archive = null;   // sessions closed with "Start new session"
let flushTimer = null;
let notice = null; // { text, bad, at }
let lastInventory = { rev: 0, at: 0, cells: [] };
const logTrace = []; // the last area lines from the game log and what the tracker did with each
let singlesBaseline = 0;  // single (unnumbered) items in the inventory when the map was entered
let carriedIn = null; // { runId, trip, cells } the inventory as it was when this trip into the map began
let lastSingles = 0; // what the last clean read saw, for the Inventory tab
// Items the reader could not name, kept until named, ignored or dismissed: [{ id, qty, print, image, guesses, at, here }]
const backlog = new Backlog({ similar: (a, b) => similarity(a, b) > 0.95 });
const saveBacklog = () => writeJson('unrecognised.json', backlog.save(encodePrint));
let learned = []; // [{ name, print(base64) }]
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
let chatBusy = false;
let tradeSaveTimer = null;

const status = {
  log: { ok: false, path: '', error: 'Not started' },
  prices: { count: 0, updatedAt: 0, league: '', errors: [], loading: false },
  inventory: { keyHook: 'off', open: false, lastReadAt: 0, recognised: 0, error: null, art: { known: 0, done: 0, total: 0, failed: 0 } },
  hotkeys: { clipboard: false, snapshot: false, tradeNext: false, tradeDismiss: false, layout: false },
  shared: { count: 0, loadedAt: 0, error: null, uploaded: 0, canUpload: false },
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

function mergeTrade(base, patch) {
  const p = patch || {};
  return { ...base, ...p, hotkeys: { ...base.hotkeys, ...(p.hotkeys || {}) }, messages: { ...base.messages, ...(p.messages || {}) }, auto: { ...base.auto, ...(p.auto || {}) } };
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
  if (!Array.isArray(config.strategies) || !config.strategies.length) config.strategies = DEFAULT_CONFIG.strategies;
  if (!config.strategies.some((x) => x.id === config.activeStrategy)) config.activeStrategy = config.strategies[0].id;
  // Keep the user's rule choices but pick up rules added in newer versions.
  const byId = new Map((saved.mapRules || []).map((r) => [r.id, r]));
  config.mapRules = [
    ...DEFAULT_RULES.map((r) => ({ ...r, ...(byId.get(r.id) || {}) })),
    ...(saved.mapRules || []).filter((r) => !DEFAULT_RULES.some((d) => d.id === r.id)),
  ];
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
  if (shared) status.shared = { ...shared.status, canUpload: !!shared.token, waiting: shared.pending.length };
  return {
    config: { ...config, shareToken: undefined }, status, leagues, mapCheck, priceCheck, tradeCheck, notice,
    inventoryRev: lastInventory.rev,
    unknown: backlog.items.map((u) => ({ id: u.id, qty: u.qty, image: u.image, guesses: u.guesses, at: u.at, here: !!u.here })),
    learned: [...new Set(learned.map((l) => l.name || '(ignored items)'))].sort(),
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `Screen ${i + 1} (${d.size.width}x${d.size.height})` })),
    summary: withIcons(session.summary(prices)),
    sessions: archive ? archive.list().map((x) => ({ ...x, strategyId: strategyOf(x) })) : [],
    trade: tradeState(),
  };
}
// The current map's loot gets its item pictures, for the loot list.
function withIcons(summary) {
  const cur = summary.runs.find((r) => r.id === summary.currentId);
  if (cur) for (const i of cur.items) { const e = prices.get(i.name); i.icon = (e && e.icon) || null; }
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
    return saved ? 'saved' : 'empty';
  } catch (e) {
    say(`The session could not be saved (${e.message || e}), so it is still open.`, true);
    return false;
  }
}
const cleanUrl = (u) => { const v = String(u || '').trim(); return /^https?:\/\/\S+$/i.test(v) ? v : ''; };
function push() {
  if (win && !win.isDestroyed()) win.webContents.send('state', buildState());
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
      // Whatever the last reading showed is what goes into the map with you.
      carriedIn = { runId: cur.id, trip: cur.trip, cells: lastInventory.cells.map((c) => ({ cell: c.cell, name: c.name || null, qty: c.qty || 0, print: c.print || null })) };
      writeJson('carried.json', { ...carriedIn, cells: carriedIn.cells.map((c) => ({ ...c, print: c.print ? encodePrint(c.print) : null })) });
    }
    ledger.enterMap();
  } else ledger.leaveMap();
}

function startLog() {
  if (logTail) { logTail.stop(); logTail = null; }
  const p = config.logPath || findLogPath();
  if (!p) {
    status.log = { ok: false, path: '', error: 'Client.txt not found. Choose it in Settings.' };
    return;
  }
  status.log = { ok: false, path: p, error: 'Waiting for the file' };
  if (config.trade.enabled && book.catchUp(readRecent(p))) saveTradesSoon();
  logTail = new LogTail(p);
  logTail.on('status', (s) => { status.log = { ok: s.ok, path: p, error: s.ok ? null : `Cannot read the log (${s.error})` }; push(); });
  logTail.on('raw', (line, ev) => {
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
function thumbnail(rgb) {
  const bgra = Buffer.alloc(CANON * CANON * 4);
  for (let p = 0; p < CANON * CANON; p++) {
    bgra[p * 4] = rgb[p * 3 + 2]; bgra[p * 4 + 1] = rgb[p * 3 + 1]; bgra[p * 4 + 2] = rgb[p * 3]; bgra[p * 4 + 3] = 255;
  }
  return nativeImage.createFromBitmap(bgra, { width: CANON, height: CANON }).toDataURL();
}

// The whole inventory as one picture, for keeping with a map. cells: [{ cell, rgb }].
const EMPTY_SLOT = [16, 19, 23];
function gridPicture(cells) {
  const w = COLS * CANON, h = ROWS * CANON;
  const bgra = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) { bgra[p * 4] = EMPTY_SLOT[2]; bgra[p * 4 + 1] = EMPTY_SLOT[1]; bgra[p * 4 + 2] = EMPTY_SLOT[0]; bgra[p * 4 + 3] = 255; }
  for (const c of cells) {
    const x0 = (c.cell % COLS) * CANON, y0 = Math.floor(c.cell / COLS) * CANON;
    for (let y = 0; y < CANON; y++) {
      for (let x = 0; x < CANON; x++) {
        const s = (y * CANON + x) * 3, d = ((y0 + y) * w + x0 + x) * 4;
        bgra[d] = c.rgb[s + 2]; bgra[d + 1] = c.rgb[s + 1]; bgra[d + 2] = c.rgb[s];
      }
    }
  }
  const jpeg = nativeImage.createFromBitmap(bgra, { width: w, height: h }).toJPEG(84);
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

// The slots of a kept inventory picture, cut back out of it: cell number -> pixels.
function cellsOfPicture(dataUrl) {
  const img = nativeImage.createFromDataURL(dataUrl);
  const { width, height } = img.getSize();
  if (width !== COLS * CANON || height !== ROWS * CANON) return null;
  const bgra = img.toBitmap();
  return (cell) => {
    const x0 = (cell % COLS) * CANON, y0 = Math.floor(cell / COLS) * CANON;
    const rgb = Buffer.alloc(CANON * CANON * 3);
    for (let y = 0; y < CANON; y++) {
      for (let x = 0; x < CANON; x++) {
        const s = ((y0 + y) * width + x0 + x) * 4, d = (y * CANON + x) * 3;
        rgb[d] = bgra[s + 2]; rgb[d + 1] = bgra[s + 1]; rgb[d + 2] = bgra[s];
      }
    }
    return rgb;
  };
}

// Looks at the kept pictures of every map in the open session again, with the item pictures
// and names known now, and corrects the loot that was counted under a wrong name or not at all.
function recheckMaps() {
  if (!snapshots) return;
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
        const hit = index.match(fingerprint(cut(c.cell)));
        if (!hit || hit.ignored) return null;
        if (hit.source === 'art' && c.qty <= 1 && hit.score < SINGLE_ART_SCORE) return null;
        return hit;
      }, (name) => index.knows(name));
      for (const ch of changes) {
        touched = true; slots++;
        const n = session.moveLoot(run.id, ch.from, ch.to, ch.qty);
        if (n) { const key = `${ch.from || 'not recognised'} → ${ch.to}`; moved.set(key, (moved.get(key) || 0) + n); }
      }
    }
    if (touched) {
      maps++;
      try { snapshots.rewrite(run.id); } catch (e) { console.error('snapshot save failed', e.message); }
      session.markSnapshot(run.id);
    }
  }
  if (!slots) { say('Checked the maps of this session again: nothing to correct.'); return; }
  const list = [...moved].map(([k, n]) => `${k} ×${n}`).join(', ');
  say(`Corrected ${slots} ${slots === 1 ? 'slot' : 'slots'} in ${maps} ${maps === 1 ? 'map' : 'maps'}${list ? `: ${list}` : ''}.`);
}

// Keeps this reading as the picture of what the current map brought in.
function keepSnapshot(result) {
  const run = session.current;
  if (!snapshots || !run || !(ledger.inMap || ledger.pendingArrival)) return;
  const trip = run.trip || 1;
  const base = carriedIn && carriedIn.runId === run.id && carriedIn.trip === trip ? carriedIn.cells : [];
  const cells = markCarried(result.cells.filter((c) => c.status !== 'covered'), base, (a, b) => similarity(a, b) > 0.9);
  const growing = ledger.inMap;
  if (!snapshots.wants(run.id, trip, cells, growing)) return;
  if (snapshots.record(run.id, trip, { at: Date.now(), cells, image: gridPicture(cells), growing })) session.markSnapshot(run.id);
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
    status.inventory.open = isInventoryOpen(frame, rect);
    if (!status.inventory.open) return;
    // With the mouse over the inventory a tooltip covers some slots; the reader keeps what it
    // knew about those and reads the rest.
    const result = reader.read(frame, { cursor: cursorCell(cursorInFrame(frame), rect) });
    if (!result) return;
    status.inventory.lastReadAt = Date.now();
    status.inventory.recognised = result.recognised;
    settlePendingNames();
    updateUnknown(result.unknown);
    const before = new Map(lastInventory.cells.map((c) => [c.cell, c]));
    lastInventory = {
      rev: lastInventory.rev + 1, at: Date.now(),
      cells: result.cells.map((c) => {
        const prev = before.get(c.cell);
        const same = prev && prev.print && c.print && similarity(prev.print, c.print) > 0.98;
        const guess = c.print && (c.status === 'unknown' || c.status === 'skipped') ? index.suggest(c.print, 1)[0] : null;
        return {
          cell: c.cell, print: c.print, status: c.status, name: c.name, qty: c.qty, source: c.source,
          score: c.score ? Math.round(c.score * 100) : null,
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
const KEY_ALIASES = { tab: 'Tab', space: 'Space', escape: 'Escape', esc: 'Escape', enter: 'Enter', backquote: 'Backquote', '`': 'Backquote' };
function syncKeyHook() {
  if (hook) { try { hook.uIOhook.removeAllListeners('keydown'); hook.uIOhook.stop(); } catch (_) { /* already stopped */ } hook = null; }
  status.inventory.keyHook = 'off';
  if (!config.inventory.onKey && !config.inventory.autoCopy && !config.trade.enabled) return;
  let lib;
  try { lib = require('uiohook-napi'); } catch (_) { status.inventory.keyHook = 'missing'; return; }
  if (config.inventory.onKey) {
    const raw = String(config.inventory.key || 'Tab').trim();
    const name = KEY_ALIASES[raw.toLowerCase()] || (raw.length === 1 ? raw.toUpperCase() : raw);
    const code = lib.UiohookKey[name];
    if (code === undefined) status.inventory.keyHook = 'badkey';
    else lib.uIOhook.on('keydown', (e) => { if (e.keycode === code) setTimeout(readInventory, 200); });
  }
  try { lib.uIOhook.start(); hook = lib; if (status.inventory.keyHook !== 'badkey') status.inventory.keyHook = 'ok'; } catch (_) { status.inventory.keyHook = 'missing'; }
}

// ---- naming items ------------------------------------------------------------------
function say(text, bad = false) { notice = { text, bad, at: Date.now() }; }

// Remembers that this picture is the named item ('' = ignore it) and queues it for sharing.
function learnPrint(typed, print) {
  const entry = typed ? prices.get(typed) : null;
  const name = entry ? entry.name : String(typed || '').trim();
  index.addLearned(name, print);
  learned.push({ name, print: encodePrint(print) });
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
    learnPrint(name, print);
    return;
  }
  if (!entry) { say(`${name} has no known price, so it is not counted.`, true); return; }
  reader.pin(k, entry.name, item.stackSize || 1);
  say(`Counting ${entry.name}${item.stackSize > 1 ? ` ×${item.stackSize}` : ''} in that slot: ${Math.round(entry.chaos * (item.stackSize || 1) * 10) / 10}c. It shows up in the loot at the next inventory read.`);
}

async function loadShared() {
  if (!shared) return;
  await shared.load();
  index.setShared(shared.items);
  push();
}

// Writes what the app saw and what it compared against to a file on the Desktop, for tuning.
async function saveDiagnostic(snapshot = false) {
  try {
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
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const name = `${snapshot ? 'snapshot' : 'diagnostic'}-${stamp}.json.gz`;
    const data = zlib.gzipSync(JSON.stringify(report));
    // Kept on this PC in the app's own folder, and sent to the repository when a token is saved.
    const dir = dataFile('reports');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, data);
    const closed = open ? '' : ' The inventory was not open in game, so it holds no items.';
    if (shared && shared.token) {
      try {
        await shared.uploadFile(`reports/${name}`, data, `Report ${name}`);
        say(`Report sent: ${name}.${closed}`, !open);
      } catch (e) {
        say(`The report could not be sent (${e.message || e}). It is saved on this PC as ${file}.${closed}`, true);
      }
    } else {
      say(`Report saved on this PC as ${file}. To have reports sent by themselves, add a GitHub token under Settings, Shared item list.${closed}`, true);
    }
  } catch (e) {
    say(`Could not make the report: ${e.message || e}`, true);
  }
}

function readToken() {
  if (!config.shareToken) return '';
  try { return safeStorage.decryptString(Buffer.from(config.shareToken, 'base64')); } catch (_) { return ''; }
}

function loadLearned() {
  backlog.load(readJson('unrecognised.json', []), decodePrint);
  learned = readJson('learned.json', []);
  for (const l of learned) { try { index.addLearned(l.name, decodePrint(l.print)); } catch (_) { /* skip a broken entry */ } }
}

// ---- updates ---------------------------------------------------------------------
async function checkUpdate() {
  if (!updater || status.update.checking || status.update.applying) return;
  status.update.checking = true;
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
    () => { if (hook) { hook.uIOhook.removeAllListeners(); hook.uIOhook.stop(); hook = null; } },
    () => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); },
  ]) { try { step(); } catch (_) { /* closing anyway */ } }
}

// Starts the app again after it has fully closed. On Windows this goes through a short hidden
// helper that waits a moment first: starting the new copy while the old one is still shutting
// down left it without a window, because the old one still held the app's files.
function restartApp() {
  if (process.platform === 'win32') {
    const { spawn } = require('child_process');
    // The installed program starts by itself; from a download, Electron is told which folder to run.
    const target = app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`;
    const cmd = restartCommand({ pid: process.pid, target });
    spawn('cmd.exe', ['/d', '/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, cwd: app.getAppPath() }).unref();
  } else {
    app.relaunch();
  }
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
  status.update.step = 'Downloading the update';
  push();
  try {
    if (!updater.latest) await updater.check();
    // The installed program cannot fetch new components itself; such an update needs the new installer.
    const { depsChanged } = await updater.apply(undefined, { refuseDepsChange: app.isPackaged });
    if (depsChanged) { status.update.step = 'Installing new parts (this can take a minute)'; push(); await updater.installDeps(); }
    writeJson('session.json', session.toJSON());
    writeJson('ledger.json', ledger.toJSON());
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
function startTradeCheck(item, { always = false } = {}) {
  tradeCheck = null;
  if (!searchable(item)) return;
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
    tc.listings = r.listings.map((l) => readListing(l, chaosOfPrice));
    tc.total = r.total;
    tc.url = r.queryId ? searchUrl(config.league, r.queryId) : '';
    tc.summary = summarize(r.total, tc.listings);
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
const checkPanelData = () => ({ ...tradeCheck, divine: prices.divine, auto: config.priceSearch.auto !== false });
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
      hook.uIOhook.keyTap(hook.UiohookKey.C, [hook.UiohookKey.Ctrl, hook.UiohookKey.Alt]);
      let text = '';
      for (let i = 0; i < 16 && !text; i++) { await sleep(25); text = clipboard.readText(); }
      if (!text) { clipboard.writeText(before); say('No item under the mouse in game. Hover an item and press the key again.', true); showCheckToast(started); changed(); return; }
      checkText(text, { count });
    } catch (e) {
      clipboard.writeText(before);
      checkText(before, { count });
    }
  } else {
    checkText(clipboard.readText(), { count });
  }
  showCheckToast(started);
  changed();
}

// What the check key just did, in a line or two, shown in game for a moment.
function showCheckToast(started) {
  if (tradeCheck && tradeCheck.at >= started && tradeCheck.inGame) return; // its own window is on screen
  showToast(checkMessage({ mapCheck, priceCheck, tradeCheck, notice, divine: prices.divine }, started));
}
function showToast(message) {
  if (!toast || config.checkToast === false || !message) return;
  if (!overlayAllowed({ known: watch.running, game: watch.gameInFront(), own: watch.ownInFront() })) return;
  // Tall enough for a two-line headline and three lines of small print; a problem stays longer.
  toast.show(overlayBounds(overlay.display(), 112, toastPlacement()), message, message.bad ? 6000 : 2500);
}

let gameKeysOn = false; // the hideout and remaining keys are held right now
let gameKeysTaken = []; // those of them another app already holds
function registerHotkeys() {
  globalShortcut.unregisterAll();
  gameKeysOn = false;
  status.hotkeys = { clipboard: false, snapshot: false, priceCheck: false, tradeNext: false, tradeDismiss: false, layout: false };
  // Keys that only mean something in the game are held only while the game is in front.
  // Anywhere else they stay with the program you are in (Ctrl+F finds text, F5 refreshes).
  gameKeysOn = watch.gameInFront();
  const reg = (key, accel, fn) => {
    if (!accel) return;
    try { status.hotkeys[key] = globalShortcut.register(accel, fn); } catch (_) { status.hotkeys[key] = false; }
  };
  reg('clipboard', config.hotkeys.clipboard, () => { checkHovered(); });
  reg('snapshot', config.hotkeys.snapshot, () => { saveDiagnostic(true).then(changed); });
  // The price check key: the same check without naming or counting anything.
  status.hotkeys.priceCheckHeld = gameKeysOn && !!config.hotkeys.priceCheck;
  if (gameKeysOn) reg('priceCheck', config.hotkeys.priceCheck, () => { checkHovered({ count: false }); });
  if (config.trade.enabled) {
    reg('tradeNext', config.trade.hotkeys.next, () => { const o = book.firstActionable(); if (o) tradeDo(o.id, 'next').then(changed); });
    reg('layout', config.trade.hotkeys.layout, () => toggleLayout());
    const hk = config.trade.hotkeys, taken = [];
    const extra = (accel, fn) => { if (!accel) return; try { if (!globalShortcut.register(accel, fn)) taken.push(accel); } catch (_) { taken.push(accel); } };
    for (const action of ['invite', 'trade', 'busy', 'still', 'whisper']) {
      extra(hk[action], () => { const o = book.latestIncoming(); if (o) tradeDo(o.id, action).then(changed); else { say('No buyer to act on.'); changed(); } });
    }
    const mine = [hk.hideout, hk.remaining].filter(Boolean);
    if (gameKeysOn) {
      const before = taken.length;
      extra(hk.hideout, () => sendChat('/hideout').then(changed));
      extra(hk.remaining, () => sendChat('/remaining').then(changed));
      gameKeysTaken = taken.splice(before);
    }
    gameKeysTaken = gameKeysTaken.filter((k) => mine.includes(k)); // remembered while you are away from the game
    status.hotkeys.tradeTaken = [...taken, ...gameKeysTaken];
    reg('tradeDismiss', config.trade.hotkeys.dismiss, () => { const o = book.offers[0]; if (o) { book.remove(o.id); saveTradesSoon(); changed(); } });
  }
}

// ---- trade offers ---------------------------------------------------------------
function tradeState() {
  const s = book.summary(prices);
  return { ...s, divine: prices.divine, labels: LABELS,
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
  if (!text) { say('That message is empty. Set its text under Trade, Settings.', true); return; }
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
    backgroundColor: '#1b1f24', title: 'Map Companion', autoHideMenuBar: true, icon: path.join(__dirname, 'ui', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  if (second) win.maximize();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; if (overlay) overlay.destroy(); if (layoutWin) layoutWin.destroy(); if (toast) toast.destroy(); if (checkPanel) checkPanel.destroy(); });
}

// ---- IPC -----------------------------------------------------------------------
function applyConfig(patch) {
  const leagueBefore = config.league, logBefore = config.logPath;
  if (patch.trade) patch = { ...patch, trade: mergeTrade(config.trade, patch.trade) };
  if (typeof patch.token === 'string') {
    const token = patch.token.trim();
    patch.shareToken = token && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token).toString('base64') : '';
    if (shared) { shared.token = token && patch.shareToken ? token : ''; shared.status.error = token && !patch.shareToken ? 'This PC cannot store the token safely, so it was not saved.' : null; }
    delete patch.token;
  }
  config = {
    ...config, ...patch,
    hotkeys: { ...config.hotkeys, ...(patch.hotkeys || {}) },
    inventory: { ...config.inventory, ...(patch.inventory || {}) },
    priceSearch: { ...config.priceSearch, ...(patch.priceSearch || {}) },
  };
  writeJson('config.json', config);
  if (patch.priceSearch && config.priceSearch.overlay === false && checkPanel) checkPanel.hide();
  if (patch.customPrices) prices.setCustom(config.customPrices);
  if (patch.hotkeys || patch.trade) registerHotkeys();
  if (patch.trade) { syncKeyHook(); if (!config.trade.enabled) book.clearTests(); }
  if (config.logPath !== logBefore) startLog();
  if (config.league !== leagueBefore) refreshPrices();
  if (patch.inventory) { syncTimedWatch(); syncKeyHook(); }
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
    for (const id of gone) for (const runId of archive.remove(id)) if (snapshots) snapshots.remove(runId);
    applyConfig({ strategies: config.strategies.filter((x) => x.id !== a.id) });
  },
  deleteSession: (a) => {
    if (!archive) return;
    for (const runId of archive.remove(a.id)) if (snapshots) snapshots.remove(runId);
  },
  addLoot: (a) => {
    if (!session.current && !a.runId) { session.startRun({ name: 'Manual run', loadout: config.loadout }); syncLedger(); }
    session.addLoot([{ name: a.name, qty: a.qty }], 'manual', a.runId || session.currentId);
  },
  removeLoot: (a) => session.removeLoot(a.runId, a.lootId),
  removeLootName: (a) => session.removeLootName(a.runId, a.name),
  addCost: (a) => session.addCost(a.runId, a.cost),
  removeCost: (a) => session.removeCost(a.runId, a.costId),
  readInventory: () => readInventory(),
  learn: (a) => {
    const u = backlog.get(a.id);
    const name = String(a.name || '').trim();
    if (!u) { say('That item is no longer in the list.', true); return; }
    if (!name) { say('Type the item name first, or pick one of the suggestions.', true); return; }
    learnPrint(name, u.print);
  },
  ignore: (a) => {
    const u = backlog.get(a.id);
    if (u) learnPrint('', u.print);
  },
  // Takes an item off the not-recognised list without naming it. It comes back if it is seen again.
  dismissUnknown: (a) => { if (backlog.remove(a.id)) saveBacklog(); },
  clearUnknown: () => { if (backlog.clear()) saveBacklog(); },
  saveDiagnostic: () => saveDiagnostic(),
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
  uploadShared: async () => { if (shared) { await shared.flush(); index.setShared(shared.items); } },
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
  tradeTest: () => addTestOffer(),
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
  checkPanelClose: () => { if (checkPanel) checkPanel.hide(); if (tradeCheck) tradeCheck.inGame = false; },
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
      return { cell: c.cell, status: c.status, name: c.name, qty: c.qty, source: c.source, score: c.score, guess: c.guess, image: c.image, each, total: each * (c.qty || 0) };
    });
    return { rev: lastInventory.rev, at: lastInventory.at, cols: COLS, rows: ROWS, cells };
  });
  // The inventory pictures kept for one map, with each slot's value at today's prices.
  ipcMain.handle('run-snapshot', (_e, runId) => {
    const data = snapshots ? snapshots.get(String(runId || '')) : { trips: [] };
    return {
      cols: COLS, rows: ROWS,
      trips: data.trips.map((t) => ({
        trip: t.trip, at: t.at, image: t.image,
        cells: t.cells.map((c) => { const each = c.name ? prices.chaosOf(c.name) : 0; return { ...c, each, total: each * (c.qty || 0) }; }),
      })),
    };
  });
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
  ipcMain.on('overlay-size', (e, h) => { if (overlay && overlay.win && e.sender === overlay.win.webContents) overlay.setHeight(h); });
  ipcMain.handle('action', async (_e, a) => {
    const fn = a && actions[a.type];
    if (!fn) return false;
    await fn(a);
    changed();
    return true;
  });
}

// ---- start ---------------------------------------------------------------------
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

  shared = new SharedItems({ fetchImpl: webFetch, token: readToken() });
  loadShared();
  setInterval(loadShared, SHARED_REFRESH_MS);

  updater = new Updater(app.getAppPath(), webFetch);
  status.update.current = updater.current;
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
});
// The overlay is a window too, so quitting hangs on the main window alone.
app.on('window-all-closed', () => app.quit());
