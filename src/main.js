'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, dialog, screen, shell, nativeImage, safeStorage } = require('electron');

const { LogTail, findLogPath } = require('./core/clientLog');
const { PriceTable, PriceService, CATEGORY_LABELS } = require('./core/prices');
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
const { SnapshotStore, SessionArchive, markCarried } = require('./core/store');

const PRICE_REFRESH_MS = 30 * 60 * 1000;
const UPDATE_CHECK_MS = 2 * 60 * 1000;
const SHARED_REFRESH_MS = 10 * 60 * 1000;

const DEFAULT_CONFIG = {
  league: '',
  logPath: '',
  characterName: '',
  hotkeys: { clipboard: 'F8', snapshot: 'F9' },
  // key: the key that opens your inventory in game. onKey: read once each time you press it.
  // timed: also check by itself every intervalMs (breaks GGG's one-read-per-key-press rule).
  // autoCopy: the check hotkey presses Ctrl+C in the game for you (one copy per key press).
  inventory: { displayId: null, key: 'Tab', onKey: true, timed: false, intervalMs: 1000, autoCopy: true },
  mapRules: DEFAULT_RULES,
  loadout: [],
  customPrices: {}, // name -> chaos, for items poe.ninja does not list
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
let snapshots = null; // the inventory as read for each map
let archive = null;   // sessions closed with "Start new session"
let flushTimer = null;
let notice = null; // { text, bad, at }
let lastInventory = { rev: 0, at: 0, cells: [] };
let singlesBaseline = 0;  // single (unnumbered) items in the inventory when the map was entered
let carriedIn = null; // { runId, trip, cells } the inventory as it was when this trip into the map began
let lastSingles = 0; // what the last clean read saw, for the Inventory tab
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
  hotkeys: { clipboard: false, snapshot: false },
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
    sessions: archive ? archive.list() : [],
  };
}
function push() {
  if (win && !win.isDestroyed()) win.webContents.send('state', buildState());
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
  logTail = new LogTail(p);
  logTail.on('status', (s) => { status.log = { ok: s.ok, path: p, error: s.ok ? null : `Cannot read the log (${s.error})` }; push(); });
  logTail.on('event', (ev) => {
    const before = session.currentId;
    session.handleLogEvent(ev, { characterName: config.characterName, loadout: config.loadout });
    if (ev.type === 'area') syncLedger();
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
  if (!config.inventory.onKey && !config.inventory.autoCopy) return;
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
  unknown = unknown.filter((u) => similarity(u.print, print) <= 0.95);
  if (!name) { say('That item is ignored from now on. Undo it under Settings, Items you named.'); return; }
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
    say(`Could not count ${name}: the app has not had a clear view of that slot yet. Move the mouse off the inventory for a second, then try again.`, true);
    return;
  }
  const sharedPicture = /Divination Card|Map/i.test(item.itemClass) || item.isMap;
  if (item.stackable && !sharedPicture) {
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
    const base = item.baseType || item.name;
    const mapEntry = (item.mapTier && prices.get(`${base} (T${item.mapTier})`)) || prices.get(base);
    nameUnderCursor(item, base, mapEntry);
    return;
  }
  const name = priceName(item);
  const entry = prices.get(name);
  priceCheck = {
    at: Date.now(), name, qty: item.stackSize, found: !!entry,
    each: entry ? entry.chaos : 0, total: entry ? entry.chaos * item.stackSize : 0,
  };
  nameUnderCursor(item, entry ? entry.name : name, entry);
}

// One press of the check hotkey: copy the hovered item (a single Ctrl+C sent to the game, the
// same thing price-check tools do), then read the clipboard once.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function checkHovered() {
  if (config.inventory.autoCopy && hook) {
    const before = clipboard.readText();
    try {
      clipboard.writeText('');
      hook.uIOhook.keyTap(hook.UiohookKey.C, [hook.UiohookKey.Ctrl]);
      let text = '';
      for (let i = 0; i < 16 && !text; i++) { await sleep(25); text = clipboard.readText(); }
      if (!text) { clipboard.writeText(before); say('No item under the mouse in game. Hover an item and press the key again.', true); changed(); return; }
      checkText(text);
    } catch (e) {
      clipboard.writeText(before);
      checkText(before);
    }
  } else {
    checkText(clipboard.readText());
  }
  changed();
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  status.hotkeys = { clipboard: false, snapshot: false };
  const reg = (key, fn) => {
    if (!config.hotkeys[key]) return;
    try { status.hotkeys[key] = globalShortcut.register(config.hotkeys[key], fn); } catch (_) { status.hotkeys[key] = false; }
  };
  reg('clipboard', () => { checkHovered(); });
  reg('snapshot', () => { saveDiagnostic(true).then(changed); });
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
  if (patch.customPrices) prices.setCustom(config.customPrices);
  if (patch.hotkeys) registerHotkeys();
  if (config.logPath !== logBefore) startLog();
  if (config.league !== leagueBefore) refreshPrices();
  if (patch.inventory) { syncTimedWatch(); syncKeyHook(); }
  push();
}

const actions = {
  startRun: (a) => { session.startRun({ name: a.name || 'Manual run', loadout: config.loadout }); syncLedger(); },
  endRun: () => { session.endRun(); syncLedger(); },
  deleteRun: (a) => { session.deleteRun(a.runId); if (snapshots) snapshots.remove(a.runId); syncLedger(); },
  // The session that ends is kept under Sessions, with its values as they are now.
  newSession: () => {
    session.endRun();
    try {
      const saved = archive && archive.save(session.summary(prices));
      if (saved) say('The finished session is saved. Pick it from the row of sessions above the map list to look at it again.');
    } catch (e) {
      say(`The session could not be saved (${e.message || e}), so it is still open.`, true);
      return;
    }
    session.reset(); syncLedger();
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
