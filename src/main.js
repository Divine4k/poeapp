'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, dialog, screen, shell } = require('electron');

const { LogTail, findLogPath } = require('./core/clientLog');
const { PriceTable, PriceService } = require('./core/prices');
const { NameMatcher } = require('./core/fuzzy');
const { parseItemText, priceName } = require('./core/itemText');
const { DEFAULT_RULES, checkMods } = require('./core/mapMods');
const { Session } = require('./core/session');
const { detect, LabelTracker } = require('./core/labelTracker');
const { ScreenScanner } = require('./screen');

const PRICE_REFRESH_MS = 30 * 60 * 1000;

const DEFAULT_CONFIG = {
  league: '',
  logPath: '',
  characterName: '',
  hotkeys: { scan: 'F7', clipboard: 'F8' },
  screen: { displayId: null, scale: 1, cropBottom: 0.82, timed: false, intervalMs: 1000, centerY: 0.44, radius: 0.3 },
  mapRules: DEFAULT_RULES,
  loadout: [],
};

let win = null;
let config = null;
let logTail = null;
let scanner = null;
let matcher = new NameMatcher([]);
let prices = new PriceTable();
let leagues = [];
let timedTimer = null;
let timedGen = 0;
let saveTimer = null;
const session = new Session();
const tracker = new LabelTracker();
const priceService = new PriceService();

const status = {
  log: { ok: false, path: '', error: 'Not started' },
  prices: { count: 0, updatedAt: 0, league: '', errors: [], loading: false },
  screen: { ready: false, error: null, lastScanAt: 0, lastMs: 0, lastFound: 0, loading: false },
  hotkeys: { scan: false, clipboard: false },
};
let mapCheck = null;
let priceCheck = null;
let lastBatch = null;

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
    screen: { ...DEFAULT_CONFIG.screen, ...(saved.screen || {}) },
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
  status.screen.ready = scanner ? scanner.ready : false;
  return {
    config, status, leagues, mapCheck, priceCheck, lastBatch,
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `Screen ${i + 1} (${d.size.width}x${d.size.height})` })),
    summary: session.summary(prices),
  };
}
function push() {
  if (win && !win.isDestroyed()) win.webContents.send('state', buildState());
}
function changed() { scheduleSave(); push(); }

// ---- game log ----------------------------------------------------------------
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
    if (ev.type === 'area') {
      if (session.currentId !== before) tracker.reset();
      syncTimedScan();
    }
    changed();
  });
  logTail.start();
}

// ---- prices --------------------------------------------------------------------
function setPrices(table) {
  prices = table;
  matcher = new NameMatcher(prices.screenNames());
  status.prices.count = prices.size;
  status.prices.updatedAt = prices.updatedAt;
  status.prices.league = prices.league || '';
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
    if (table.size > 1) { setPrices(table); writeJson('prices.json', table.toJSON()); }
    else status.prices.errors = ['No prices came back for this league.', ...errors];
  } catch (e) {
    status.prices.errors = [e.message || String(e)];
  } finally {
    status.prices.loading = false; push();
  }
}

// ---- screen scanning -----------------------------------------------------------
async function runScan(mode) {
  if (!scanner) scanner = new ScreenScanner({ cachePath: app.getPath('userData') });
  if (!scanner.ready) { status.screen.loading = true; push(); }
  let result;
  try {
    result = await scanner.scan(config.screen);
  } catch (e) {
    status.screen.error = e.message || String(e);
    status.screen.loading = false; push();
    return;
  }
  status.screen.loading = false;
  if (!result) return; // previous scan still running
  status.screen.error = null;
  status.screen.lastScanAt = Date.now();
  status.screen.lastMs = result.ms;
  const found = detect(result.lines, matcher);
  status.screen.lastFound = found.length;

  if (mode === 'manual') {
    // One press = "count what is on the ground right now".
    const grouped = new Map();
    for (const f of found) grouped.set(f.name, (grouped.get(f.name) || 0) + f.qty);
    const entries = [...grouped].map(([name, qty]) => ({ name, qty }));
    if (entries.length) {
      if (!session.current) session.startRun({ name: session.location.name || 'Manual run', loadout: config.loadout });
      const runId = session.currentId;
      const batch = session.addLoot(entries, 'scan');
      lastBatch = { runId, batch, count: entries.length, at: Date.now() };
    } else {
      lastBatch = { runId: null, batch: null, count: 0, at: Date.now() };
    }
  } else {
    const frame = { width: result.width, height: result.height };
    tracker.centerY = config.screen.centerY;
    tracker.radius = config.screen.radius;
    const events = tracker.update(found, frame);
    const seen = events.filter((e) => e.type === 'seen');
    const picked = events.filter((e) => e.type === 'pickup');
    if (seen.length) session.addSeen(seen);
    if (picked.length) session.addLoot(picked, 'pickup');
  }
  changed();
}

// Timed scanning only runs while you are inside a map and only when switched on in Settings.
function syncTimedScan() {
  const cur = session.current;
  const want = !!config.screen.timed && !!cur && cur.segmentStart !== null;
  if (!want) { clearTimeout(timedTimer); timedTimer = null; timedGen += 1; return; }
  if (timedTimer) return;
  const gen = ++timedGen;
  const tick = async () => {
    await runScan('timed');
    // Stop if scanning was switched off or restarted while this scan was running.
    if (gen === timedGen && timedTimer !== null) timedTimer = setTimeout(tick, Math.max(500, Number(config.screen.intervalMs) || 1000));
  };
  timedTimer = setTimeout(tick, 200);
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

// ---- hotkeys -------------------------------------------------------------------
function registerHotkeys() {
  globalShortcut.unregisterAll();
  status.hotkeys = { scan: false, clipboard: false };
  const reg = (key, accel, fn) => {
    if (!accel) return;
    try { status.hotkeys[key] = globalShortcut.register(accel, fn); } catch (_) { status.hotkeys[key] = false; }
  };
  reg('scan', config.hotkeys.scan, () => runScan('manual'));
  reg('clipboard', config.hotkeys.clipboard, () => { checkText(clipboard.readText()); push(); });
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
    screen: { ...config.screen, ...(patch.screen || {}) },
  };
  writeJson('config.json', config);
  if (patch.hotkeys) registerHotkeys();
  if (config.logPath !== logBefore) startLog();
  if (config.league !== leagueBefore) refreshPrices();
  if (patch.screen) syncTimedScan();
  push();
}

const actions = {
  startRun: (a) => { session.startRun({ name: a.name || 'Manual run', loadout: config.loadout }); tracker.reset(); syncTimedScan(); },
  endRun: () => { session.endRun(); syncTimedScan(); },
  deleteRun: (a) => { session.deleteRun(a.runId); syncTimedScan(); },
  newSession: () => { session.reset(); tracker.reset(); lastBatch = null; syncTimedScan(); },
  addLoot: (a) => {
    if (!session.current && !a.runId) session.startRun({ name: 'Manual run', loadout: config.loadout });
    session.addLoot([{ name: a.name, qty: a.qty }], 'manual', a.runId || session.currentId);
  },
  removeLoot: (a) => session.removeLoot(a.runId, a.lootId),
  removeBatch: (a) => { session.removeBatch(a.runId, a.batch); if (lastBatch && lastBatch.batch === a.batch) lastBatch = null; },
  addCost: (a) => session.addCost(a.runId, a.cost),
  removeCost: (a) => session.removeCost(a.runId, a.costId),
  scanNow: () => runScan('manual'),
  readClipboard: () => checkText(clipboard.readText()),
  checkText: (a) => checkText(String(a.text || '')),
  clearChecks: () => { mapCheck = null; priceCheck = null; },
  refreshPrices: () => { refreshPrices(); },
  browseLog: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose Client.txt', properties: ['openFile'], filters: [{ name: 'Client.txt', extensions: ['txt'] }] });
    if (!r.canceled && r.filePaths[0]) applyConfig({ logPath: r.filePaths[0] });
  },
};

function setupIpc() {
  ipcMain.handle('get-state', () => buildState());
  ipcMain.handle('set-config', (_e, patch) => { applyConfig(patch || {}); return true; });
  ipcMain.handle('search', (_e, q) => prices.search(String(q || ''), 40));
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
  const cached = PriceTable.fromJSON(readJson('prices.json', null));
  if (cached.size > 1) setPrices(cached);

  setupIpc();
  createWindow();
  registerHotkeys();
  startLog();
  refreshPrices();
  setInterval(refreshPrices, PRICE_REFRESH_MS);
  setInterval(push, 5000);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearTimeout(timedTimer); timedTimer = null;
  writeJson('session.json', session.toJSON());
  if (scanner) scanner.stop();
});
app.on('window-all-closed', () => app.quit());
