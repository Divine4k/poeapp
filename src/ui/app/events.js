'use strict';
// Clicks handled for the whole page (data-act, data-tab, data-trade...).
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- events ---------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const tb = e.target.closest('[data-trade]');
  if (tb) { act(tb.dataset.trade === 'dismiss' && e.ctrlKey ? { type: 'tradeDismissAll' } : { type: 'trade', id: tb.dataset.id, do: tb.dataset.trade }); return; }
  if (e.target.closest('[data-open-account]')) { $('btn-account').click(); return; }
  const go = e.target.closest('[data-settings]');
  if (go) { showTab('settings'); showSettings(go.dataset.settings); return; }
  const fx = e.target.closest('[data-fix]');
  if (fx) { e.stopPropagation(); openFix(fx.dataset.fix, fx.dataset.run); return; }
  const b = e.target.closest('[data-act]');
  if (b) {
    const d = b.dataset;
    e.stopPropagation();
    if (d.confirm && !window.confirm(d.confirm)) return;
    Promise.resolve(act({ type: d.act, id: d.id, runId: d.run, lootId: d.loot, batch: d.batch, costId: d.cost, name: d.name, qty: d.qty ? Number(d.qty) : undefined })).then(() => { if (d.act === 'removeCustomPrice') renderPrices(true); });
    return;
  }
  const lo = e.target.closest('[data-loadout]');
  if (lo) {
    const list = (state.config.loadout || []).slice();
    list.splice(Number(lo.dataset.loadout), 1);
    api.setConfig({ loadout: list });
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) { showTab(tab.dataset.tab); return; }
  const st = e.target.closest('[data-strat]');
  if (st) { stratSel = st.dataset.strat; sessionSel = 'current'; expanded = null; renderStrategies(); renderSession(); return; }
  if (e.target.closest('#btn-strategy-new')) { openStrategy(null); return; }
  if (e.target.closest('#btn-strategy-edit')) { openStrategy(stratSel); return; }
  const it = e.target.closest('[data-inv-trip]');
  if (it) { invTrip = Number(it.dataset.invTrip); $('now-snap').dataset.key = ''; renderNow(); return; }
  if (e.target.closest('[data-inv-photo]')) { setInvPhoto(!invPhoto); renderNow(); renderSession(); return; }
  const pick = e.target.closest('[data-session]');
  if (pick) { sessionSel = pick.dataset.session; expanded = null; renderSession(); return; }
  if (e.target.closest('[data-allitems]')) { allItems = !allItems; renderSession(); return; }
  const row = e.target.closest('[data-expand]');
  if (row) { expanded = expanded === row.dataset.expand ? null : row.dataset.expand; allItems = false; renderSession(); }
});

$('btn-read').addEventListener('click', () => act({ type: 'readInventory' }));
$('btn-side-update').addEventListener('click', () => {
  const up = state.status.update;
  if (up.applying || up.checking) return;
  // The button changes at once; the app's answer follows.
  if (up.available) { updInstall = Date.now(); renderUpdate(); act({ type: 'applyUpdate' }); return; }
  updPressed = Date.now(); renderUpdate();
  act({ type: 'checkUpdate' });
});
