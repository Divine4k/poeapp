'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, dialog, screen, shell, nativeImage } = require('electron');

const { LogTail, findLogPath } = require('./core/clientLog');
const { PriceTable, PriceService } = require('./core/prices');
const { parseItemText, priceName } = require('./core/itemText');
const { DEFAULT_RULES, checkMods } = require('./core/mapMods');
const { Session } = require('./core/session');
const { CANON, COLS, ROWS, gridRect, isInventoryOpen } = require('./core/inventory/grid');
const { IconIndex, similarity, encodePrint, decodePrint } = require('./core/inventory/icons');
const { InventoryReader } = require('./core/inventory/reader');
const { LootLedger } = require('./core/inventory/ledger');
const { captureFrame, cursorInFrame } = require('./capture');
const { ArtLoader } = require('./art');
const { Updater } = require('./updater');
const { webFetch } = require('./http');

const PRICE_REFRESH_MS = 30 * 60 * 1000;
const UPDATE_CHECK_MS = 2 * 60 * 1000;

const DEFAULT_CONFIG = {
  league: '',
  logPath: '',
  characterName: '',
  hotkeys: { clipboard: 'F8' },
  // key: the key that opens your inventory in game. onKey: read once each time you press it.
  // timed: also check by itself every intervalMs (breaks GGG's one-read-per-key-press rule).
  inventory: { displayId: null, key: 'Tab', onKey: true, timed: false, intervalMs: 1000 },
  mapRules: DEFAULT_RULES,
  loadout: [],
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
let unknownSeq = 1;
let unknown = []; // [{ id, qty, print, image }]
let learned = []; // [{ name, print(base64) }]
const session = new Session();
const index = new IconIndex();
const reader = new InventoryReader(index);
const ledger = new LootLedger();
const priceService = new PriceService({ fetchImpl: webFetch });

const status = {
  log: { ok: false, path: '', error: 'Not started' },
  prices: { count: 0, updatedAt: 0, league: '', errors: [], loading: false },
  inventory: { keyHook: 'off', open: false, lastReadAt: 0, recognised: 0, error: null, art: { known: 0, done: 0, total: 0, failed: 0 } },
  hotkeys: { clipboard: false },
  update: { current: null, latest: null, available: false, checking: false, applying: false, step: '', error: null, checkedAt: 0 },
};
let mapCheck = null;
let priceCheck = null;

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
  };
  // Keep the user's rule choices but pick up rules added in newer versions.
  const byId = new Map((saved.mapRules || []).map((r) => [r.id, r]));
  config.mapRules = [
    ...DEFAULT_RULES.map((r) => ({ ...r, ...(byId.get(r.id) || {}) })),
    ...(saved.mapRules || []).filter((r) => !DEFAULT_RULES.some((d) => d.id === r.id)),
  ];
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson('session.json', session.toJSON()), 1500);
}

// ---- state to the window ---------------------------------------------------
function buildState() {
  status.inventory.art.known = index.art.length;
  return {
    config, status, leagues, mapCheck, priceCheck,
    unknown: unknown.map((u) => ({ id: u.id, qty: u.qty, image: u.image, guess: u.guess })),
    learned: [...new Set(learned.map((l) => l.name))].sort(),
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `Screen ${i + 1} (${d.size.width}x${d.size.height})` })),
    summary: session.summary(prices),
  };
}
function push() {
  if (win && !win.isDestroyed()) win.webContents.send('state', buildState());
}
function changed() { scheduleSave(); push(); }

// ---- game log ----------------------------------------------------------------
function syncLedger(runChanged) {
  const cur = session.current;
  if (cur && cur.segmentStart !== null) ledger.enterMap(runChanged);
  else ledger.leaveMap();
}

function startLog() {
  if (logTail) { logTail.stop(); logTail = null; }
  const p = config.logPath || findLogPath();
  if (!p) {
    status.log = { ok: false, path: '', error: 'Client.txt not found. Choose it in Settings.' };
    return;
  }
  status.log = { ok: false, path: p, error: 'Waiting for the file' };
  logTail = new LogTail(p);
  logTail.on('status', (s) => { status.log = { ok: s.ok, path: p, error: s.ok ? null : `Cannot read the log (${s.error})` }; push(); });
  logTail.on('event', (ev) => {
    const before = session.currentId;
    session.handleLogEvent(ev, { characterName: config.characterName, loadout: config.loadout });
    if (ev.type === 'area') syncLedger(session.currentId !== before);
    changed();
  });
  logTail.start();
}

// ---- prices and item art --------------------------------------------------------
function setPrices(table) {
  prices = table;
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

function updateUnknown(found) {
  const next = [];
  for (const u of found) {
    if (next.some((n) => similarity(n.print, u.print) > 0.95)) continue; // same item in several cells
    const prev = unknown.find((o) => similarity(o.print, u.print) > 0.95);
    const guess = index.suggest(u.print);
    next.push({
      id: prev ? prev.id : unknownSeq++, qty: u.qty, print: u.print, image: thumbnail(u.rgb),
      guess: guess && guess.score >= 0.5 ? { name: guess.name, score: Math.round(guess.score * 100) } : null,
    });
    if (next.length >= 8) break;
  }
  unknown = next;
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
    // While the mouse is over the grid a tooltip covers some cells, so wait for a clean view.
    const cur = cursorInFrame(frame);
    if (cur && cur.x > rect.x0 - rect.cell * 0.5 && cur.y > rect.y0 - rect.cell * 0.5
      && cur.x < rect.x0 + rect.cell * (COLS + 0.5) && cur.y < rect.y0 + rect.cell * (ROWS + 0.5)) return;
    const result = reader.read(frame);
    if (!result) return;
    status.inventory.lastReadAt = Date.now();
    status.inventory.recognised = result.recognised;
    updateUnknown(result.unknown);
    const gains = ledger.reading(result.counts);
    if (gains.length && session.current) session.addLoot(gains, 'inventory');
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

// Listens for your inventory key without blocking it, and reads once per press.
// Nothing is ever sent to the game.
const KEY_ALIASES = { tab: 'Tab', space: 'Space', escape: 'Escape', esc: 'Escape', enter: 'Enter', backquote: 'Backquote', '`': 'Backquote' };
function syncKeyHook() {
  if (hook) { try { hook.uIOhook.removeAllListeners('keydown'); hook.uIOhook.stop(); } catch (_) { /* already stopped */ } hook = null; }
  status.inventory.keyHook = 'off';
  if (!config.inventory.onKey) return;
  let lib;
  try { lib = require('uiohook-napi'); } catch (_) { status.inventory.keyHook = 'missing'; return; }
  const raw = String(config.inventory.key || 'Tab').trim();
  const name = KEY_ALIASES[raw.toLowerCase()] || (raw.length === 1 ? raw.toUpperCase() : raw);
  const code = lib.UiohookKey[name];
  if (code === undefined) { status.inventory.keyHook = 'badkey'; return; }
  lib.uIOhook.on('keydown', (e) => { if (e.keycode === code) setTimeout(readInventory, 200); });
  try { lib.uIOhook.start(); hook = lib; status.inventory.keyHook = 'ok'; } catch (_) { status.inventory.keyHook = 'missing'; }
}

function loadLearned() {
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

async function applyUpdate() {
  if (!updater || status.update.applying) return;
  status.update.applying = true;
  status.update.error = null;
  status.update.step = 'Downloading the update';
  push();
  try {
    if (!updater.latest) await updater.check();
    const { depsChanged } = await updater.apply();
    if (depsChanged) { status.update.step = 'Installing new parts (this can take a minute)'; push(); await updater.installDeps(); }
    writeJson('session.json', session.toJSON());
    app.relaunch();
    app.exit(0);
  } catch (e) {
    status.update.applying = false;
    status.update.step = '';
    status.update.error = e.message || String(e);
    push();
  }
}

// ---- clipboard (read once per hotkey press or button click) --------------------
function checkText(text) {
  const item = parseItemText(text);
  if (!item) { priceCheck = { error: 'The clipboard does not hold a Path of Exile item. Hover an item in game and press Ctrl+C first.', at: Date.now() }; return; }
  if (item.isMap) {
    const mods = checkMods(item.mods, config.mapRules);
    mapCheck = {
      at: Date.now(), name: item.baseType || item.name, tier: item.mapTier, quantity: item.quantity,
      rarity: item.rarityBonus, packSize: item.packSize, corrupted: !!item.corrupted, unidentified: !!item.unidentified,
      mods, dangerCount: mods.filter((m) => m.dangerous).length,
    };
    return;
  }
  const name = priceName(item);
  const entry = prices.get(name);
  priceCheck = {
    at: Date.now(), name, qty: item.stackSize, found: !!entry,
    each: entry ? entry.chaos : 0, total: entry ? entry.chaos * item.stackSize : 0,
  };
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  status.hotkeys = { clipboard: false };
  if (!config.hotkeys.clipboard) return;
  try {
    status.hotkeys.clipboard = globalShortcut.register(config.hotkeys.clipboard, () => { checkText(clipboard.readText()); push(); });
  } catch (_) { status.hotkeys.clipboard = false; }
}

// ---- window --------------------------------------------------------------------
function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const second = screen.getAllDisplays().find((d) => d.id !== primary.id);
  const target = second || primary;
  win = new BrowserWindow({
    x: target.workArea.x + 40, y: target.workArea.y + 40,
    width: Math.min(1500, target.workArea.width - 80), height: Math.min(950, target.workArea.height - 80),
    backgroundColor: '#1b1f24', title: 'Map Companion', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  if (second) win.maximize();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

// ---- IPC -----------------------------------------------------------------------
function applyConfig(patch) {
  const leagueBefore = config.league, logBefore = config.logPath;
  config = {
    ...config, ...patch,
    hotkeys: { ...config.hotkeys, ...(patch.hotkeys || {}) },
    inventory: { ...config.inventory, ...(patch.inventory || {}) },
  };
  writeJson('config.json', config);
  if (patch.hotkeys) registerHotkeys();
  if (config.logPath !== logBefore) startLog();
  if (config.league !== leagueBefore) refreshPrices();
  if (patch.inventory) { syncTimedWatch(); syncKeyHook(); }
  push();
}

const actions = {
  startRun: (a) => { session.startRun({ name: a.name || 'Manual run', loadout: config.loadout }); syncLedger(true); },
  endRun: () => { session.endRun(); syncLedger(false); },
  deleteRun: (a) => { session.deleteRun(a.runId); syncLedger(false); },
  newSession: () => { session.reset(); syncLedger(false); },
  addLoot: (a) => {
    if (!session.current && !a.runId) { session.startRun({ name: 'Manual run', loadout: config.loadout }); syncLedger(true); }
    session.addLoot([{ name: a.name, qty: a.qty }], 'manual', a.runId || session.currentId);
  },
  removeLoot: (a) => session.removeLoot(a.runId, a.lootId),
  addCost: (a) => session.addCost(a.runId, a.cost),
  removeCost: (a) => session.removeCost(a.runId, a.costId),
  readInventory: () => readInventory(),
  learn: (a) => {
    const u = unknown.find((x) => String(x.id) === String(a.id));
    const entry = prices.get(a.name);
    if (!u || !entry) return;
    index.addLearned(entry.name, u.print);
    learned.push({ name: entry.name, print: encodePrint(u.print) });
    writeJson('learned.json', learned);
    unknown = unknown.filter((x) => x !== u);
  },
  forget: (a) => {
    index.forget(a.name);
    learned = learned.filter((l) => l.name !== a.name);
    writeJson('learned.json', learned);
    reader.forgetCells();
  },
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
  ipcMain.handle('search', (_e, q) => prices.search(String(q || ''), 40).map((e) => ({ name: e.name, chaos: e.chaos })));
  ipcMain.handle('action', async (_e, a) => {
    const fn = a && actions[a.type];
    if (!fn) return false;
    await fn(a);
    changed();
    return true;
  });
}

// ---- start ---------------------------------------------------------------------
app.whenReady().then(() => {
  loadConfig();
  session.restore(readJson('session.json', null));
  loadLearned();
  const cached = PriceTable.fromJSON(readJson('prices.json', null));
  if (cached.size > 1) { setPrices(cached); syncArt(); }

  setupIpc();
  createWindow();
  registerHotkeys();
  startLog();
  syncKeyHook();
  syncTimedWatch();
  refreshPrices();
  setInterval(refreshPrices, PRICE_REFRESH_MS);
  setInterval(push, 5000);

  updater = new Updater(app.getAppPath(), webFetch);
  status.update.current = updater.current;
  checkUpdate();
  setInterval(checkUpdate, UPDATE_CHECK_MS);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(timedTimer);
  if (hook) { try { hook.uIOhook.stop(); } catch (_) { /* closing anyway */ } }
  writeJson('session.json', session.toJSON());
});
app.on('window-all-closed', () => app.quit());
