'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, dialog, screen, shell, nativeImage, safeStorage } = require('electron');

const { LogTail, findLogPath } = require('./core/clientLog');
const { PriceTable, PriceService } = require('./core/prices');
const { parseItemText, priceName } = require('./core/itemText');
const { DEFAULT_RULES, checkMods } = require('./core/mapMods');
const { Session } = require('./core/session');
const { CANON, COLS, ROWS, gridRect, isInventoryOpen, extractCell, isEmptyCell } = require('./core/inventory/grid');
const { IconIndex, similarity, fingerprint, encodePrint, decodePrint } = require('./core/inventory/icons');
const { readStack } = require('./core/inventory/digits');
const { InventoryReader } = require('./core/inventory/reader');
const { LootLedger } = require('./core/inventory/ledger');
const { captureFrame, cursorInFrame, cursorOnDisplay } = require('./capture');
const { ArtLoader } = require('./art');
const { Updater } = require('./updater');
const { webFetch } = require('./http');
const { SharedItems } = require('./shared');

const PRICE_REFRESH_MS = 30 * 60 * 1000;
const UPDATE_CHECK_MS = 2 * 60 * 1000;
const SHARED_REFRESH_MS = 10 * 60 * 1000;

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
  shareToken: '', // GitHub token for uploading named items, stored encrypted
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
let flushTimer = null;
let notice = null; // { text, bad, at }
let lastInventory = { rev: 0, at: 0, cells: [] }; // what the last clean read saw, for the Inventory tab
let unknownSeq = 1;
let unknown = []; // [{ id, qty, print, image, guesses }]
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
  shared: { count: 0, loadedAt: 0, error: null, uploaded: 0, canUpload: false },
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
  saveTimer = setTimeout(() => { writeJson('session.json', session.toJSON()); writeJson('ledger.json', ledger.toJSON()); }, 1500);
}

// ---- state to the window ---------------------------------------------------
function buildState() {
  status.inventory.art.known = index.art.length;
  status.inventory.awaitingArrival = ledger.pendingArrival && !!session.current;
  status.inventory.noBaseline = !ledger.baseline;
  if (shared) status.shared = { ...shared.status, canUpload: !!shared.token, waiting: shared.pending.length };
  return {
    config: { ...config, shareToken: undefined }, status, leagues, mapCheck, priceCheck, notice,
    inventoryRev: lastInventory.rev,
    unknown: unknown.map((u) => ({ id: u.id, qty: u.qty, image: u.image, guesses: u.guesses })),
    learned: [...new Set(learned.map((l) => l.name || '(ignored items)'))].sort(),
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
    next.push({
      id: prev ? prev.id : unknownSeq++, qty: u.qty, print: u.print, image: prev ? prev.image : thumbnail(u.rgb),
      guesses: index.suggest(u.print, 3).filter((g) => g.score >= 0.4).map((g) => ({ name: g.name, score: Math.round(g.score * 100) })),
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
    const before = new Map(lastInventory.cells.map((c) => [c.cell, c]));
    lastInventory = {
      rev: lastInventory.rev + 1, at: Date.now(),
      cells: result.cells.map((c) => {
        const prev = before.get(c.cell);
        const same = prev && similarity(prev.print, c.print) > 0.98;
        const guess = c.status === 'unknown' || c.status === 'skipped' ? index.suggest(c.print, 1)[0] : null;
        return {
          cell: c.cell, print: c.print, status: c.status, name: c.name, qty: c.qty, source: c.source,
          score: c.score ? Math.round(c.score * 100) : null,
          guess: guess ? { name: guess.name, score: Math.round(guess.score * 100) } : null,
          image: same ? prev.image : thumbnail(c.rgb),
        };
      }),
    };
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

// ---- naming items ------------------------------------------------------------------
function say(text, bad = false) { notice = { text, bad, at: Date.now() }; }

// Remembers that this picture is the named item ('' = ignore it) and queues it for sharing.
function learnPrint(typed, print) {
  const entry = typed ? prices.get(typed) : null;
  const name = entry ? entry.name : String(typed || '').trim();
  index.addLearned(name, print);
  learned.push({ name, print: encodePrint(print) });
  writeJson('learned.json', learned);
  unknown = unknown.filter((u) => similarity(u.print, print) <= 0.95);
  if (!name) { say('That item is ignored from now on. Undo it under Settings, Items you named.'); return; }
  say(entry ? `Saved: ${name}.` : `Saved as "${name}", but no price is known under that name, so it counts as 0c. Check the spelling if that is wrong.`, !entry);
  if (shared) {
    shared.queue(name, print);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => { await shared.flush(); index.setShared(shared.items); push(); }, 3000);
  }
}

// Ctrl+C on an item in game, then the check hotkey: the item under the mouse gets that name.
// No screen capture is needed: the picture comes from the last clean inventory read, because
// the item's own tooltip covers part of the inventory while you hover it.
function nameUnderCursor(name) {
  const cur = cursorOnDisplay(config.inventory.displayId);
  if (!cur) return;
  const rect = gridRect(cur.width, cur.height);
  const col = Math.floor((cur.x - rect.x0) / rect.cell), row = Math.floor((cur.y - rect.y0) / rect.cell);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return; // not over the inventory: a plain price check
  const print = reader.prints[row * COLS + col];
  if (!print) {
    say(`Could not name ${name}: the app has not seen that inventory slot yet. Move the mouse off the inventory, press your inventory key twice (close and open), then try again.`, true);
    return;
  }
  const hit = index.match(print);
  if (hit && hit.name === name) { say(`${name} is already recognised.`); return; }
  learnPrint(name, print);
}

async function loadShared() {
  if (!shared) return;
  await shared.load();
  index.setShared(shared.items);
  push();
}

// Writes what the app saw and what it compared against to a file on the Desktop, for tuning.
async function saveDiagnostic() {
  try {
    const frame = await captureFrame(config.inventory.displayId);
    const rect = gridRect(frame.width, frame.height);
    const open = isInventoryOpen(frame, rect);
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
    for (const name of wanted) {
      const entry = prices.get(name);
      if (!entry || !entry.icon || !artLoader) continue;
      try { const a = await artLoader.fetchRgb(entry.icon); if (a) art.push({ name, url: entry.icon, size: a.size, rgb: b64(a.rgb) }); } catch (_) { /* skip */ }
    }
    const report = {
      version: updater && updater.current, when: new Date().toISOString(), open,
      frame: { width: frame.width, height: frame.height }, rect, display: { scaleFactor: frame.display.scaleFactor, size: frame.display.size },
      counts: { art: index.art.length, learned: index.learned.length, shared: index.shared.length, prices: prices.size },
      artProgress: status.inventory.art, categories: prices.toJSON().entries.reduce((m, e) => { m[e.category] = (m[e.category] || 0) + 1; return m; }, {}), cells, art,
    };
    const file = path.join(app.getPath('desktop'), 'poeapp-diagnostic.json.gz');
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(report)));
    say(open ? `Saved ${file}. Send that file to get the item matching tuned.` : `Saved ${file}, but the inventory was not open in game, so it holds no items. Open it and save again.`, !open);
  } catch (e) {
    say(`Could not save the diagnostic file: ${e.message || e}`, true);
  }
}

function readToken() {
  if (!config.shareToken) return '';
  try { return safeStorage.decryptString(Buffer.from(config.shareToken, 'base64')); } catch (_) { return ''; }
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
    writeJson('ledger.json', ledger.toJSON());
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
  if (item.stackable) nameUnderCursor(entry ? entry.name : name); // only items that are always the same
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  status.hotkeys = { clipboard: false };
  if (!config.hotkeys.clipboard) return;
  try {
    status.hotkeys.clipboard = globalShortcut.register(config.hotkeys.clipboard, () => { checkText(clipboard.readText()); changed(); });
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
    const name = String(a.name || '').trim();
    if (!u) { say('That item is no longer in the list.', true); return; }
    if (!name) { say('Type the item name first, or pick one of the suggestions.', true); return; }
    learnPrint(name, u.print);
  },
  ignore: (a) => {
    const u = unknown.find((x) => String(x.id) === String(a.id));
    if (u) learnPrint('', u.print);
  },
  saveDiagnostic: () => saveDiagnostic(),
  uploadShared: async () => { if (shared) { await shared.flush(); index.setShared(shared.items); } },
  forget: (a) => {
    const name = a.name === '(ignored items)' ? '' : a.name;
    index.forget(name);
    learned = learned.filter((l) => l.name !== name);
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
  ipcMain.handle('inventory', () => {
    const cells = lastInventory.cells.map((c) => {
      const each = c.name ? prices.chaosOf(c.name) : 0;
      return { cell: c.cell, status: c.status, name: c.name, qty: c.qty, source: c.source, score: c.score, guess: c.guess, image: c.image, each, total: each * (c.qty || 0) };
    });
    return { rev: lastInventory.rev, at: lastInventory.at, cols: COLS, rows: ROWS, cells };
  });
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
  ledger.restore(readJson('ledger.json', null));
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
  clearInterval(timedTimer);
  if (hook) { try { hook.uIOhook.stop(); } catch (_) { /* closing anyway */ } }
  writeJson('session.json', session.toJSON());
  writeJson('ledger.json', ledger.toJSON());
});
app.on('window-all-closed', () => app.quit());
