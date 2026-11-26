'use strict';
// The speed check: `npm run perf`. Opens the main window with the preview data (src/ui/demo.js)
// in a hidden Electron window, makes it big (60 maps, 150 tracker items) and times the things
// that must stay quick. Each has a limit; going over one fails the check. The limits are loose
// (about three times what a normal PC needs), so only a real slowdown trips them. Run it before
// and after a change that could slow the window down and compare the numbers.
// See "Performance" in CLAUDE.md.
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { Session } = require('../src/core/session');

// name -> [limit in ms, what it is]
const LIMITS = {
  redrawMapping: [8, 'one state update, Mapping page open, 60 maps'],
  redrawOther: [1.5, 'one state update, another page open'],
  trackerDraw: [30, 'drawing the Tracker map, 150 items on four tabs, about 40 on screen'],
  trackerDragMove: [5, 'one pointer movement while dragging a Tracker box'],
  trackerFilterKey: [30, 'one key in the Tracker search'],
  summary: [25, 'main process: summary of a 100 map session'],
};

// Runs inside the page (all of src/ui/app shares one scope, so its names are in reach).
const inPage = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const time = (n, fn) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) / n; };
  while (typeof state === 'undefined' || !state) await sleep(50);
  await sleep(300);
  const out = {};
  // A long session: the finished maps of the preview, repeated up to 60.
  const big = JSON.parse(JSON.stringify(state));
  const done = big.summary.runs.filter((r) => r.id !== big.summary.currentId);
  for (let n = 0; big.summary.runs.length < 60; n++) big.summary.runs.push({ ...done[n % done.length], id: `perf${n}` });
  const fresh = () => JSON.parse(JSON.stringify(big)); // every update is a new object, as from the main process
  showTab('mapping'); setState(fresh()); await sleep(300);
  out.redrawMapping = time(40, () => setState(fresh())) - time(40, fresh);
  showTab('costs'); await sleep(100);
  out.redrawOther = time(40, () => setState(fresh())) - time(40, fresh);
  // A big tracker: 150 items on four tabs, about 40 on the tab shown (Main).
  const body = 'Notes about this item.\n\n- [x] first step\n- [ ] second step\n- [ ] third step';
  window.demoTracker = Array.from({ length: 150 }, (_, k) => {
    const i = k + 1;
    return { number: i, parent: i <= 40 ? null : 1 + ((i * 7) % 40), tab: i <= 40 ? ['', 'Jewels', 'Trade', 'Regex'][i % 4] : '', title: `Tracker item number ${i} with a title`, body, status: ['idea', 'todo', 'doing', 'done'][i % 4], priority: ['normal', 'high', 'low'][i % 3], dropped: false, labels: [], progress: window.Steps.progress(body), url: '#', by: 'perf', created: 0, updated: 0, closed: 0 };
  });
  tkLoaded = false; tkTab = 'Main'; tkHideDone = false; tkView = 'map';
  showTab('tracker');
  while (!tkLoaded) await sleep(50);
  await sleep(200);
  out.trackerDraw = time(10, () => { htmlShown.delete($('tk-nodes')); tkDraw(); });
  const filter = $('tk-filter');
  out.trackerFilterKey = time(10, () => { filter.value = filter.value ? '' : 'item number 7'; tkDraw(); });
  filter.value = ''; tkDraw();
  // Dragging: the gesture is set up by hand (a made-up pointer cannot be captured), then moved.
  const key = [...tkShown][0], map = $('tk-map');
  tkGesture = { kind: 'move', key, x0: 0, y0: 0, moved: false, start: { [key]: tkPos[key].slice() } };
  const r = $('tk-canvas').getBoundingClientRect();
  let n = 0;
  out.trackerDragMove = time(120, () => { n++; map.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + n * 2, clientY: r.top + n, bubbles: true })); tkLinesNow(); });
  tkGesture = null;
  return out;
};

function summaryTime() {
  const s = new Session();
  for (let m = 0; m < 100; m++) {
    s.startRun({ name: `Map ${m}` });
    s.addLoot(Array.from({ length: 60 }, (_, i) => ({ name: `Item ${(m * 7 + i * 13) % 300}`, qty: 1 + (i % 5) })), 'inventory');
    s.endRun();
  }
  const prices = { chaosOf: (n) => n.length % 7, divine: 200 };
  const t = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) s.summary(prices);
  return Number(process.hrtime.bigint() - t) / 1e6 / 20;
}

app.commandLine.appendSwitch('disable-renderer-backgrounding'); // a hidden window must not be slowed down
app.whenReady().then(async () => {
  let failed = false;
  try {
    const win = new BrowserWindow({ width: 1500, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'), { query: { account: 'in', role: 'admin' } });
    const out = await win.webContents.executeJavaScript(`(${inPage})()`);
    out.summary = summaryTime();
    for (const [name, [limit, what]] of Object.entries(LIMITS)) {
      const ms = out[name], over = !(ms <= limit);
      failed = failed || over;
      console.log(`${over ? 'SLOW' : 'ok  '}  ${String(ms.toFixed(2)).padStart(7)} ms  (limit ${limit})  ${what}`);
    }
  } catch (e) {
    failed = true;
    console.error(`The speed check could not run: ${e && e.message ? e.message : e}`);
  }
  app.exit(failed ? 1 : 0);
});
