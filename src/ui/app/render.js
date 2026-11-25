'use strict';
// Drawing everything from a new state, sidebar order, switching pages.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

function render() {
  if (!state) return;
  applyTheme();
  renderBoot();
  renderTrade(); // the new-offer sound and dot work with the window minimized too
  // A window that is not on screen draws nothing more; it catches up when it is back (start.js).
  if (document.hidden) return;
  renderStatus(); renderToasts();
  // Only the page that is open is drawn (see "Performance" in CLAUDE.md). A page is drawn by
  // drawPage when it is opened, so nothing is missed.
  const open = openTab();
  if (open !== 'trade') drawPage(open);
  if (open !== 'mapping' && open !== 'items') renderItems(); // the dot on the Items entry
  renderInventory(false); renderPrices(false); renderAccount(); renderTrouble(); renderDev(); renderTracker(); renderSettings(); renderRefresh();
  clockStart();
}
const TABS = ['mapping', 'inventory', 'items', 'trade', 'mapcheck', 'costs', 'prices', 'jewels', 'trouble', 'tracker', 'settings'];
const openTab = () => TABS.find((id) => !$(`tab-${id}`).hidden) || 'mapping';
// What a page needs drawn from the state. Pages not listed draw themselves when shown (showTab).
function drawPage(name) {
  if (!state) return;
  if (name === 'mapping') { renderArrival(); renderAttention(); renderNow(); renderStrategies(); renderSession(); } // renderNow draws the Items dot as well
  else if (name === 'trade') renderTrade();
  else if (name === 'mapcheck') renderMapCheck();
  else if (name === 'costs') renderCosts();
  else if (name === 'prices') { renderPriceCheck(); renderTradeCheck(); }
  else if (name === 'items') renderItems();
}

// The map card's clock with its thousandths: every screen refresh, but only while a map runs
// and the Mapping page is on screen. It stops by itself and is started again by render and showTab.
let clockFrame = 0;
// The session clock in the numbers row is written here too, once its seconds change.
function clockTick() {
  clockFrame = 0;
  if (!state || document.hidden || $('tab-mapping').hidden) return;
  const run = currentRun(), mapOn = !!run && run.segmentStart !== null;
  const sc = state.summary.clock, sessionOn = !!sc && sc.running;
  if (!mapOn && !sessionOn) return;
  if (mapOn) drawClock(liveDuration(run));
  if (sessionOn) { const el = $('totals').querySelector('[data-sclock]'), t = fmtTime(liveClockMs(sc)); if (el && el.textContent !== t) el.textContent = t; }
  clockFrame = requestAnimationFrame(clockTick);
}
function clockStart() { if (!clockFrame) clockFrame = requestAnimationFrame(clockTick); }

// Refresh buttons turn while what they fetch is on its way, and cannot be pressed twice.
function renderRefresh() {
  const st = state.status, prLoading = !!st.prices.loading, shLoading = !!(st.shared && st.shared.loading);
  for (const [id, busy] of [['btn-prices-refresh', prLoading], ['btn-refresh-prices', prLoading], ['btn-refresh-shared', shLoading]]) {
    const b = $(id);
    if (!b) continue;
    b.disabled = busy;
    b.classList.toggle('busy', busy);
  }
  $('btn-refresh-shared').hidden = !(st.cloud && st.cloud.enabled) && !(st.shared && st.shared.count);
  const pr = st.prices;
  $('price-age').textContent = prLoading ? 'Loading from poe.ninja…' : pr.count > 1 ? `${pr.league}, updated at ${clock(pr.updatedAt)}` : '';
}

function setState(s) {
  const hadCheck = state && state.mapCheck ? state.mapCheck.at : 0;
  const hadPrice = state && state.priceCheck ? state.priceCheck.at : 0;
  const hadTrade = state && state.tradeCheck ? state.tradeCheck.at : 0;
  const first = !state;
  state = s; receivedAt = Date.now();
  applyNavOrder(s.config.navOrder);
  // The check key's answer shows in game. Only without that message does the app turn to the
  // page holding the answer; otherwise the page you were on stays put.
  if (s.config.checkToast === false) {
    if (!first && s.mapCheck && s.mapCheck.at !== hadCheck) showTab('mapcheck');
    else if (!first && s.priceCheck && s.priceCheck.at !== hadPrice) showTab('prices');
  }
  // Without its window in game, a trade search is shown on its page: the listings do not fit
  // in the short message.
  if (!first && s.tradeCheck && s.tradeCheck.kind !== 'bulk' && s.tradeCheck.at !== hadTrade && !s.tradeCheck.inGame) showTab('prices');
  render();
}

// ---- sidebar order: drag a page up or down --------------------------------------------
const sidenav = document.querySelector('.sidenav');
let navApplied = null;
let dragging = null;

function applyNavOrder(order) {
  const key = (order || []).join(',');
  if (key === navApplied || dragging) return;
  navApplied = key;
  const byTab = new Map([...sidenav.querySelectorAll('.navi')].map((b) => [b.dataset.tab, b]));
  // Listed pages first, in the saved order; any page not listed (a new one) keeps its place after them.
  // 'trouble' and 'tracker' were their own pages before 0.49; now one Developer tools entry.
  for (const tab of (order || []).map((t) => (t === 'trouble' || t === 'tracker' ? 'devtools' : t))) { const b = byTab.get(tab); if (b) { sidenav.appendChild(b); byTab.delete(tab); } }
  for (const b of byTab.values()) sidenav.appendChild(b);
}

const clearDropMarks = () => { for (const b of sidenav.querySelectorAll('.drop-before, .drop-after')) b.classList.remove('drop-before', 'drop-after'); };
for (const b of sidenav.querySelectorAll('.navi')) b.draggable = true;

sidenav.addEventListener('dragstart', (e) => {
  const b = e.target.closest('.navi');
  if (!b) return;
  dragging = b;
  b.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', b.dataset.tab);
});
sidenav.addEventListener('dragover', (e) => {
  if (!dragging) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  const over = e.target.closest('.navi');
  if (!over || over === dragging) return;
  const r = over.getBoundingClientRect();
  over.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
});
sidenav.addEventListener('drop', (e) => {
  if (!dragging) return;
  e.preventDefault();
  const over = e.target.closest('.navi');
  if (over && over !== dragging) {
    const r = over.getBoundingClientRect();
    sidenav.insertBefore(dragging, e.clientY < r.top + r.height / 2 ? over : over.nextSibling);
    const order = [...sidenav.querySelectorAll('.navi')].map((b) => b.dataset.tab);
    navApplied = order.join(',');
    api.setConfig({ navOrder: order });
  }
});
sidenav.addEventListener('dragend', () => {
  if (dragging) dragging.classList.remove('dragging');
  dragging = null;
  clearDropMarks();
});

$('learned-filter').addEventListener('input', () => renderItems());

// ---- the sidebar: narrow (icons with a word under them), or opened out with the names ----
// Only how this window looks, so it is kept in the window (localStorage), not in the settings.
function setWide(on) {
  document.body.classList.toggle('wide-side', on);
  $('btn-widen').setAttribute('aria-pressed', String(on));
  $('btn-widen').title = on ? 'Make the sidebar narrow' : 'Show the page names';
  try { localStorage.setItem('wideSide', on ? '1' : ''); } catch (_) { /* storage off: it just isn't kept */ }
}
$('btn-widen').addEventListener('click', () => setWide(!document.body.classList.contains('wide-side')));
try { setWide(localStorage.getItem('wideSide') === '1'); } catch (_) { setWide(false); }

// Developer tools is one sidebar entry with two pages in it (Troubleshooting, Tracker; the
// Tracker for admins only). The entry opens the one last used.
const DEV_TABS = ['trouble', 'tracker'];
let devTab = 'trouble';
try { if (localStorage.getItem('devTab') === 'tracker') devTab = 'tracker'; } catch (_) { /* storage off */ }
function showTab(name) {
  if (name === 'devtools') name = devTab === 'tracker' && state.trouble && state.trouble.admin ? 'tracker' : 'trouble';
  if (DEV_TABS.includes(name) && name !== devTab) { devTab = name; try { localStorage.setItem('devTab', name); } catch (_) { /* not kept */ } }
  if (name !== 'settings') stopListening(); // a key that was being chosen is left as it was
  const side = DEV_TABS.includes(name) ? 'devtools' : name;
  for (const b of document.querySelectorAll('.sidenav .navi')) b.setAttribute('aria-selected', String(b.dataset.tab === side));
  for (const b of document.querySelectorAll('#dev-bar [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  $('dev-bar').hidden = !DEV_TABS.includes(name) || !(state.trouble && state.trouble.admin);
  if (name === 'settings') $('btn-settings').setAttribute('aria-current', 'page'); else $('btn-settings').removeAttribute('aria-current');
  for (const id of TABS) $(`tab-${id}`).hidden = id !== name;
  $('strat').hidden = name !== 'mapping'; // strategies sit in the top bar, for the Mapping page only
  if (name === 'inventory') renderInventory(true);
  if (name === 'items') { refreshKnown(); renderKnown(); }
  if (name === 'prices') renderPrices(true);
  if (name === 'jewels') jewelsShown();
  if (name === 'trouble') troubleShown();
  if (name === 'tracker') trackerShown();
  if (name === 'settings') renderSettings();
  drawPage(name); clockStart();
}
