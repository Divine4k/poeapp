'use strict';
(() => {
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  let state = null;
  let receivedAt = 0;
  let expanded = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtValue(c) {
    const divine = state ? state.summary.divine : 0;
    if (!isFinite(c)) return '0c';
    const a = Math.abs(c);
    if (divine > 0 && a >= divine) return `${(c / divine).toFixed(a >= divine * 10 ? 1 : 2)} div`;
    return `${a >= 100 ? Math.round(c) : Math.round(c * 10) / 10}c`;
  }
  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }
  const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const currentRun = () => state.summary.runs.find((r) => r.id === state.summary.currentId) || null;
  const liveDuration = (run) => run.durationMs + (run.segmentStart !== null ? Date.now() - receivedAt : 0);
  const act = (a) => api.action(a);

  // ---- status bar ----------------------------------------------------------
  function renderStatus() {
    const st = state.status, hk = state.config.hotkeys, items = [];
    items.push(st.log.ok ? ['ok', 'Game log connected'] : ['bad', st.log.error || 'Game log not connected']);
    if (st.prices.loading) items.push(['busy', 'Loading prices']);
    else if (st.prices.count > 1) items.push(['ok', `${st.prices.count} prices for ${st.prices.league}, updated ${clock(st.prices.updatedAt)}`]);
    else items.push(['bad', st.prices.errors[0] || 'No prices loaded']);
    if (st.screen.error) items.push(['bad', `Screen scan failed: ${st.screen.error}`]);
    else if (st.screen.loading) items.push(['busy', 'Loading the text reader (first scan only)']);
    else if (st.screen.lastScanAt) items.push(['ok', `${state.config.screen.timed ? 'Timed scan on. ' : ''}Last scan found ${st.screen.lastFound} loot labels in ${st.screen.lastMs} ms`]);
    else items.push(['', state.config.screen.timed ? 'Timed scan starts when you enter a map' : `Press ${hk.scan} in game to scan loot`]);
    if (!st.hotkeys.scan) items.push(['bad', `Hotkey ${hk.scan} is taken by another app`]);
    if (!st.hotkeys.clipboard) items.push(['bad', `Hotkey ${hk.clipboard} is taken by another app`]);
    if (state.summary.divine > 0) items.push(['', `1 Divine = ${Math.round(state.summary.divine)}c`]);
    $('status').innerHTML = items.map(([cls, text]) => `<li class="${cls}">${esc(text)}</li>`).join('');
  }

  // ---- current map ------------------------------------------------------------
  function renderNow() {
    const run = currentRun();
    const hk = state.config.hotkeys;
    $('btn-scan').textContent = `Scan loot on screen (${hk.scan})`;
    $('btn-run-toggle').textContent = run ? 'End this map' : 'Start a map manually';
    if (!run) {
      $('now-head').innerHTML = `<div class="map-name">Not in a map</div>
        <div class="map-meta">Enter a map and the timer starts by itself.</div>
        <div class="big"><span class="timer" id="timer">0:00</span></div>`;
    } else {
      const paused = run.segmentStart === null;
      $('now-head').innerHTML = `<div class="map-name">${esc(run.name)}</div>
        <div class="map-meta">${run.level ? `Area level ${run.level}. ` : ''}${paused ? '<span class="paused">Timer paused while you are out of the map.</span>' : ''}${run.deaths ? ` ${run.deaths} ${run.deaths === 1 ? 'death' : 'deaths'}.` : ''}</div>
        <div class="big">
          <span class="timer" id="timer">${fmtTime(liveDuration(run))}</span>
          <span class="value ${run.net < 0 ? 'neg' : ''}">${fmtValue(run.net)}
            <small>Loot ${fmtValue(run.lootValue)}, costs ${fmtValue(run.costValue)}</small></span>
        </div>`;
    }

    const note = $('scan-note');
    const lb = state.lastBatch;
    if (lb && Date.now() - lb.at < 20000) {
      note.hidden = false;
      note.className = 'notice';
      note.innerHTML = lb.count
        ? `Scan added ${lb.count} ${lb.count === 1 ? 'item' : 'items'}. <button type="button" class="link" data-act="removeBatch" data-run="${esc(lb.runId)}" data-batch="${esc(lb.batch)}">Undo scan</button>`
        : 'Scan found no priced loot labels on screen.';
    } else note.hidden = true;

    const feed = $('feed');
    if (!run || !run.loot.length) {
      feed.innerHTML = `<li class="empty">${run ? `No loot yet. Press ${esc(hk.scan)} in game when drops are on screen, or add items by name.` : 'Loot shows up here once a map is running.'}</li>`;
    } else {
      const label = { scan: 'scan', pickup: 'picked up', manual: 'added', clipboard: 'copied' };
      feed.innerHTML = run.loot.slice().reverse().map((l) => `<li>
        <span>${esc(l.name)} <span class="qty">×${l.qty}</span><span class="src">${label[l.source] || ''}</span></span>
        <span class="val">${l.chaos > 0 ? fmtValue(l.chaos) : 'no price'}</span>
        <button type="button" class="link" data-act="removeLoot" data-run="${esc(run.id)}" data-loot="${esc(l.id)}" aria-label="Remove ${esc(l.name)}">Remove</button></li>`).join('');
    }
    const showSeen = !!(run && state.config.screen.timed && run.seen.length);
    $('seen-wrap').hidden = !showSeen;
    if (showSeen) {
      $('seen').innerHTML = run.seen.slice().reverse().slice(0, 12).map((s) => `<li><span>${esc(s.name)} ×${s.qty}</span><span class="val">${fmtValue(s.chaos)}</span></li>`).join('');
    }
  }

  // ---- session ------------------------------------------------------------------
  function renderSession() {
    const t = state.summary.totals;
    $('totals').innerHTML = `
      <div class="${t.net < 0 ? 'neg' : ''}">${fmtValue(t.net)}<span>Net profit</span></div>
      <div>${t.netPerHour ? fmtValue(t.netPerHour) : 'n/a'}<span>Per hour</span></div>
      <div>${t.maps}<span>Maps run</span></div>
      <div>${t.maps ? fmtTime(t.avgMapMs) : 'n/a'}<span>Average map</span></div>
      <div>${t.deaths}<span>Deaths</span></div>`;
    const runs = state.summary.runs.slice().reverse();
    if (!runs.length) {
      $('runs').innerHTML = '<tr><td colspan="7" class="empty">Finished maps are listed here.</td></tr>';
      return;
    }
    $('runs').innerHTML = runs.map((r) => {
      const live = r.id === state.summary.currentId;
      let html = `<tr class="run ${live ? 'live' : ''}" data-expand="${esc(r.id)}">
        <td>${esc(r.name)}</td>
        <td class="num">${fmtTime(live ? liveDuration(r) : r.durationMs)}</td>
        <td class="num">${fmtValue(r.lootValue)}</td>
        <td class="num">${fmtValue(r.costValue)}</td>
        <td class="num ${r.net < 0 ? 'neg' : 'pos'}">${fmtValue(r.net)}</td>
        <td class="num">${r.deaths}</td>
        <td><button type="button" class="link" data-act="deleteRun" data-run="${esc(r.id)}" aria-label="Delete ${esc(r.name)}">Delete</button></td></tr>`;
      if (expanded === r.id) {
        const items = r.items.length ? r.items.map((i) => `<b>${esc(i.name)}</b> ×${i.qty} (${fmtValue(i.chaos)})`).join(', ') : 'No loot recorded.';
        const costs = r.costs.length ? r.costs.map((c) => `${esc(c.name)} ×${c.qty} (${fmtValue(c.total)})`).join(', ') : 'none';
        html += `<tr class="detail"><td colspan="7">${items}<br>Costs: ${costs}</td></tr>`;
      }
      return html;
    }).join('');
  }

  // ---- tools ----------------------------------------------------------------------
  function renderMapCheck() {
    const mc = state.mapCheck, hk = state.config.hotkeys;
    const anyRule = state.config.mapRules.some((r) => r.enabled);
    let html;
    if (!mc) {
      html = `<p class="hint">Hover a map in game and press Ctrl+C, then press ${esc(hk.clipboard)}. The mods your build cannot run are flagged here.</p>
        ${anyRule ? '' : '<p class="notice">No mods are marked as dangerous yet. Pick them in Settings.</p>'}
        <button type="button" data-act="readClipboard">Check the copied item now</button>`;
    } else {
      const stats = [mc.tier ? `Tier ${mc.tier}` : '', mc.quantity != null ? `${mc.quantity}% quantity` : '', mc.packSize != null ? `${mc.packSize}% pack size` : '', mc.corrupted ? 'corrupted' : '']
        .filter(Boolean).join(', ');
      const verdict = mc.unidentified ? '<div class="verdict danger">Unidentified: mods are hidden</div>'
        : mc.dangerCount ? `<div class="verdict danger">Do not run: ${mc.dangerCount} dangerous ${mc.dangerCount === 1 ? 'mod' : 'mods'}</div>`
          : `<div class="verdict safe">${anyRule ? 'Safe to run' : 'No dangerous mods are set up'}</div>`;
      html = `${verdict}<div class="map-meta">${esc(mc.name)}${stats ? `. ${esc(stats)}` : ''}</div>
        <ul class="mods">${mc.mods.map((m) => `<li class="${m.dangerous ? 'danger' : ''}">${esc(m.mod)}${m.dangerous ? `<small>${esc(m.labels.join(', '))}</small>` : ''}</li>`).join('')}</ul>`;
    }
    $('tab-mapcheck').innerHTML = html;
  }

  function costRow(c, attrs) {
    const fixed = c.chaos != null && c.chaos !== '';
    const each = c.each != null ? c.each : (fixed ? Number(c.chaos) : null);
    const val = each == null ? '' : (each > 0 || fixed ? fmtValue(each * (c.qty || 1)) : 'no price');
    return `<li><span>${esc(c.name)} ×${c.qty || 1}</span><span class="val">${val}</span>
      <button type="button" class="link" ${attrs} aria-label="Remove ${esc(c.name)}">Remove</button></li>`;
  }
  function renderCosts() {
    const lo = state.config.loadout || [];
    $('loadout').innerHTML = lo.length ? lo.map((c, i) => costRow(c, `data-loadout="${i}"`)).join('')
      : '<li class="empty">Add what you put into each map (scarabs, the map, chisels) to see net profit.</li>';
    const run = currentRun();
    $('run-costs').innerHTML = run && run.costs.length
      ? run.costs.map((c) => costRow(c, `data-act="removeCost" data-run="${esc(run.id)}" data-cost="${esc(c.id)}"`)).join('')
      : `<li class="empty">${run ? 'No costs on this map.' : 'No map is running.'}</li>`;
  }

  function renderPriceCheck() {
    const pc = state.priceCheck;
    if (!pc) { $('price-check').innerHTML = ''; return; }
    if (pc.error) { $('price-check').innerHTML = `<p class="notice bad">${esc(pc.error)}</p>`; return; }
    $('price-check').innerHTML = pc.found
      ? `<p class="notice">${esc(pc.name)} ×${pc.qty} is worth ${fmtValue(pc.total)} (${fmtValue(pc.each)} each).
          <button type="button" class="link" data-act="addLoot" data-name="${esc(pc.name)}" data-qty="${pc.qty}">Add to this map's loot</button></p>`
      : `<p class="notice bad">No price found for ${esc(pc.name)}.</p>`;
  }

  function render() {
    if (!state) return;
    renderStatus(); renderNow(); renderSession(); renderMapCheck(); renderCosts(); renderPriceCheck();
  }

  function setState(s) {
    const hadCheck = state && state.mapCheck ? state.mapCheck.at : 0;
    const hadPrice = state && state.priceCheck ? state.priceCheck.at : 0;
    state = s; receivedAt = Date.now();
    if (s.mapCheck && s.mapCheck.at !== hadCheck) showTab('mapcheck');
    else if (s.priceCheck && s.priceCheck.at !== hadPrice) showTab('prices');
    render();
  }

  function showTab(name) {
    for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const id of ['mapcheck', 'costs', 'prices']) $(`tab-${id}`).hidden = id !== name;
  }

  // ---- events ---------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const d = b.dataset;
      e.stopPropagation();
      act({ type: d.act, runId: d.run, lootId: d.loot, batch: d.batch, costId: d.cost, name: d.name, qty: d.qty ? Number(d.qty) : undefined });
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
    const row = e.target.closest('[data-expand]');
    if (row) { expanded = expanded === row.dataset.expand ? null : row.dataset.expand; renderSession(); }
  });

  $('btn-scan').addEventListener('click', () => act({ type: 'scanNow' }));
  $('btn-run-toggle').addEventListener('click', () => act({ type: currentRun() ? 'endRun' : 'startRun' }));
  $('btn-new-session').addEventListener('click', () => {
    if (!state.summary.runs.length || window.confirm('Start a new session? The current list of maps is cleared.')) act({ type: 'newSession' });
  });

  async function suggest(q) {
    if (!q || q.length < 2) return;
    const res = await api.search(q);
    $('price-names').innerHTML = res.slice(0, 20).map((r) => `<option value="${esc(r.name)}"></option>`).join('');
  }
  document.addEventListener('input', (e) => { if (e.target.getAttribute('list') === 'price-names') suggest(e.target.value); });

  $('add-loot').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('add-loot-name').value.trim();
    if (!name) return;
    act({ type: 'addLoot', name, qty: Number($('add-loot-qty').value) || 1 });
    $('add-loot-name').value = ''; $('add-loot-qty').value = 1;
  });

  const readCost = (form) => {
    const f = new FormData(form);
    const chaos = f.get('chaos');
    return { name: String(f.get('name')).trim(), qty: Number(f.get('qty')) || 1, chaos: chaos === '' || chaos == null ? null : Number(chaos) };
  };
  $('add-loadout').addEventListener('submit', (e) => {
    e.preventDefault();
    api.setConfig({ loadout: [...(state.config.loadout || []), readCost(e.target)] });
    e.target.reset();
  });
  $('add-run-cost').addEventListener('submit', (e) => {
    e.preventDefault();
    const run = currentRun();
    if (!run) return;
    act({ type: 'addCost', runId: run.id, cost: readCost(e.target) });
    e.target.reset();
  });

  let searchTimer = null;
  $('price-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(async () => {
      const res = q.trim() ? await api.search(q) : [];
      $('price-results').innerHTML = res.length
        ? res.map((r) => `<li><span>${esc(r.name)}</span><span class="val">${fmtValue(r.chaos)}</span>
            <button type="button" class="link" data-act="addLoot" data-name="${esc(r.name)}" data-qty="1">Add to loot</button></li>`).join('')
        : (q.trim() ? '<li class="empty">Nothing matches that name.</li>' : '');
    }, 150);
  });

  // ---- settings ---------------------------------------------------------------------
  const dlg = $('settings');
  const form = $('settings-form');
  $('btn-settings').addEventListener('click', () => {
    const c = state.config, el = form.elements;
    const leagues = state.leagues.length ? state.leagues : (c.league ? [{ id: c.league, name: c.league }] : []);
    el.league.innerHTML = leagues.map((l) => `<option value="${esc(l.id)}" ${l.id === c.league ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    el.characterName.value = c.characterName || '';
    el.logPath.value = c.logPath || '';
    el.logPath.placeholder = state.status.log.path || 'Found automatically when empty';
    el.hkScan.value = c.hotkeys.scan; el.hkClip.value = c.hotkeys.clipboard;
    el.displayId.innerHTML = `<option value="">Main screen</option>${state.displays.map((d) => `<option value="${d.id}" ${String(d.id) === String(c.screen.displayId) ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}`;
    el.cropBottom.value = c.screen.cropBottom;
    el.timed.checked = !!c.screen.timed;
    el.intervalSec.value = (c.screen.intervalMs || 1000) / 1000;
    $('rules').innerHTML = c.mapRules.map((r) => `<label><input type="checkbox" data-rule="${esc(r.id)}" ${r.enabled ? 'checked' : ''}> ${esc(r.label)}</label>`).join('');
    dlg.showModal();
  });
  $('btn-browse').addEventListener('click', async () => { await act({ type: 'browseLog' }); form.elements.logPath.value = state.config.logPath || ''; });
  $('btn-refresh-prices').addEventListener('click', () => act({ type: 'refreshPrices' }));
  form.addEventListener('submit', () => {
    const el = form.elements, c = state.config;
    const enabled = new Set([...document.querySelectorAll('[data-rule]')].filter((x) => x.checked).map((x) => x.dataset.rule));
    api.setConfig({
      league: el.league.value || c.league,
      characterName: el.characterName.value.trim(),
      logPath: el.logPath.value.trim(),
      hotkeys: { scan: el.hkScan.value.trim() || 'F7', clipboard: el.hkClip.value.trim() || 'F8' },
      screen: {
        displayId: el.displayId.value || null,
        cropBottom: Math.min(1, Math.max(0.3, Number(el.cropBottom.value) || 0.82)),
        timed: el.timed.checked,
        intervalMs: Math.max(500, Math.round((Number(el.intervalSec.value) || 1) * 1000)),
      },
      mapRules: c.mapRules.map((r) => ({ ...r, enabled: enabled.has(r.id) })),
    });
  });

  // ---- go -------------------------------------------------------------------------------
  setInterval(() => {
    if (!state) return;
    const run = currentRun();
    const t = $('timer');
    if (run && t) t.textContent = fmtTime(liveDuration(run));
    const note = $('scan-note');
    if (!note.hidden && state.lastBatch && Date.now() - state.lastBatch.at >= 20000) note.hidden = true;
  }, 500);

  api.onState(setState);
  api.getState().then(setState);
})();
