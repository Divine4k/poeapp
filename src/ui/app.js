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
    const inv = st.inventory, ic = state.config.inventory;
    if (inv.error) items.push(['bad', `Inventory reading failed: ${inv.error}`]);
    else if (inv.keyHook === 'missing' && ic.onKey && !ic.timed) items.push(['bad', 'Key listener not installed, so the inventory key is not noticed. Turn on checking by itself in Settings, or use Read inventory now']);
    else if (inv.keyHook === 'badkey') items.push(['bad', `Inventory key "${ic.key}" is not a key name the app knows`]);
    else if (inv.lastReadAt) items.push(['ok', `Inventory read at ${clock(inv.lastReadAt)}: ${inv.recognised} item stacks recognised`]);
    else items.push(['', `Open your inventory in game (${ic.key}) to start reading it`]);
    if (inv.art.total > inv.art.done) items.push(['busy', `Learning item pictures: ${inv.art.done} of ${inv.art.total}`]);
    else if (inv.art.failed && !inv.art.known) items.push(['bad', `${inv.art.failed} item pictures failed to download`]);
    else if (!inv.art.known && st.prices.count > 1) items.push(['bad', 'Prices loaded but no item pictures came with them']);
    else if (inv.art.known) items.push(['ok', `${inv.art.known} item pictures known`]);
    if (!st.hotkeys.clipboard) items.push(['bad', `Hotkey ${hk.clipboard} is taken by another app`]);
    if (state.summary.divine > 0) items.push(['', `1 Divine = ${Math.round(state.summary.divine)}c`]);
    const up = st.update, btn = $('btn-update');
    if (up.applying) items.push(['busy', up.step || 'Updating']);
    else if (up.error) items.push(['bad', `Update problem: ${up.error}`]);
    else if (up.available) items.push(['busy', `Update available: ${up.latest.message}`]);
    btn.hidden = !up.available && !up.applying;
    btn.disabled = !!up.applying;
    btn.textContent = up.applying ? 'Updating' : 'Install update and restart';
    const line = $('version-line');
    if (line) {
      const cur = up.current ? `Installed version ${up.current.sha.slice(0, 7)} (${up.current.message}).` : 'Installed from a download, so the exact version is not known yet. Install the update once to fix that.';
      const chk = up.checkedAt ? ` Last checked at ${clock(up.checkedAt)}${up.available ? '' : ': up to date'}.` : '';
      line.textContent = cur + chk;
    }
    $('status').innerHTML = items.map(([cls, text]) => `<li class="${cls}">${esc(text)}</li>`).join('');
  }

  // ---- current map ------------------------------------------------------------
  function renderNow() {
    const run = currentRun();
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

    const feed = $('feed');
    if (!run || !run.loot.length) {
      feed.innerHTML = `<li class="empty">${run ? `No loot yet. Open your inventory (${esc(state.config.inventory.key)}) after picking things up.` : 'Loot shows up here once a map is running.'}</li>`;
    } else {
      const label = { inventory: '', manual: 'added by hand' };
      feed.innerHTML = run.loot.slice().reverse().map((l) => `<li>
        <span>${esc(l.name)} <span class="qty">×${l.qty}</span><span class="src">${label[l.source] || ''}</span></span>
        <span class="val">${l.chaos > 0 ? fmtValue(l.chaos) : 'no price'}</span>
        <button type="button" class="link" data-act="removeLoot" data-run="${esc(run.id)}" data-loot="${esc(l.id)}" aria-label="Remove ${esc(l.name)}">Remove</button></li>`).join('');
    }
    const invS = state.status.inventory, invC = state.config.inventory, arr = $('arrival');
    if (invS.noBaseline) {
      arr.hidden = false; arr.className = 'notice bad';
      arr.textContent = `The app has not seen your inventory yet, so it cannot tell what is new. Open it once in your hideout (${invC.key}) before the next map.`;
    } else if (invS.awaitingArrival) {
      arr.hidden = false; arr.className = 'notice bad';
      arr.textContent = invC.timed
        ? 'Back from the map: open your stash or inventory now and the loot is counted. Keep the mouse off the inventory for a second.'
        : `Back from the map: press ${invC.key} before you stash anything, or the loot from this map is not counted. To have this happen by itself, turn on "Also check by itself" in Settings.`;
    } else arr.hidden = true;

    const n = state.notice, note = $('notice');
    if (n && Date.now() - n.at < 30000) { note.hidden = false; note.className = n.bad ? 'notice bad' : 'notice'; note.textContent = n.text; }
    else note.hidden = true;

    const un = state.unknown || [];
    $('unknown-wrap').hidden = !un.length;
    $('inv-dot').hidden = !un.length;
    $('hk-name').textContent = state.config.hotkeys.clipboard;
    const list = $('unknown');
    // Rebuild only when the items or suggestions change, and never while a name is being typed.
    const key = un.map((u) => `${u.id}:${u.guesses.map((g) => g.name).join('|')}`).join(',');
    const typing = list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.value;
    if (list.dataset.key !== key && !typing) {
      list.dataset.key = key;
      list.innerHTML = un.map((u) => `<li>
        <img src="${esc(u.image)}" alt="Unrecognised item">
        <div class="pick">
          ${u.guesses.length ? `<div class="chips">${u.guesses.map((g) => `<button type="button" data-act="learn" data-id="${u.id}" data-name="${esc(g.name)}" title="${g.score}% match">${esc(g.name)}</button>`).join('')}</div>` : ''}
          <form class="inline-form" data-learn-form="${u.id}" autocomplete="off">
            <input list="price-names" placeholder="Or type its name" aria-label="Item name">
            <button type="submit">Save</button>
            <button type="button" data-act="ignore" data-id="${u.id}">Ignore</button>
          </form>
        </div></li>`).join('');
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
    $('mapcheck-body').innerHTML = html;
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

  // ---- inventory tab ------------------------------------------------------------------
  let invRev = -1;
  async function renderInventory(force) {
    if ($('tab-inventory').hidden) return;
    if (!force && state.inventoryRev === invRev) return;
    const inv = await api.inventory();
    invRev = inv.rev;
    const box = $('inventory-body');
    if (!inv.at) {
      box.innerHTML = `<p class="hint">Nothing read yet. Open your inventory in game (${esc(state.config.inventory.key)}) and keep the mouse off it for a second.</p>`;
      return;
    }
    const how = { art: 'matched to its picture', learned: 'named by you', shared: 'from the shared list' };
    const describe = (c) => {
      if (c.status === 'item') return `${c.name} ×${c.qty}: ${fmtValue(c.total)}. Recognised: ${how[c.source] || ''}${c.score ? `, ${c.score}% match` : ''}.`;
      if (c.status === 'remembered') return `${c.name} ×${c.qty}: ${fmtValue(c.total)}. Covered in this read, so the last known value is used.`;
      if (c.status === 'unknown') return `Not recognised, stack of ${c.qty}.${c.guess ? ` Closest picture: ${c.guess.name}, ${c.guess.score}% match.` : ''}`;
      if (c.status === 'ignored') return 'Ignored by you.';
      return `No stack number, so it is not counted (gear, gems and other single items).${c.guess ? ` Closest picture: ${c.guess.name}, ${c.guess.score}%.` : ''}`;
    };
    const byCell = new Map(inv.cells.map((c) => [c.cell, c]));
    let grid = '';
    for (let k = 0; k < inv.cols * inv.rows; k++) {
      const c = byCell.get(k);
      grid += c ? `<div class="slot ${c.status}" title="${esc(describe(c))}"><img src="${esc(c.image)}" alt="${esc(c.name || c.status)}"></div>` : '<div class="slot empty"></div>';
    }
    const totals = new Map();
    let sum = 0, unpriced = 0;
    for (const c of inv.cells) {
      if (!c.name) continue;
      const t = totals.get(c.name) || { name: c.name, qty: 0, each: c.each, total: 0 };
      t.qty += c.qty; t.total += c.total; totals.set(c.name, t);
      sum += c.total;
    }
    for (const t of totals.values()) if (!t.each) unpriced++;
    const count = (s) => inv.cells.filter((c) => c.status === s).length;
    const rows = [...totals.values()].sort((a, b) => b.total - a.total).map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.qty}</td><td class="num">${t.each ? fmtValue(t.each) : 'no price'}</td><td class="num">${t.each ? fmtValue(t.total) : ''}</td></tr>`).join('');
    const problems = inv.cells.filter((c) => c.status === 'unknown' || c.status === 'remembered').map((c) => `<li>Row ${Math.floor(c.cell / inv.cols) + 1}, column ${(c.cell % inv.cols) + 1}: ${esc(describe(c))}</li>`).join('');
    box.innerHTML = `
      <div class="inv-top">
        <div class="inv-grid">${grid}</div>
        <div class="inv-sum">
          <div class="verdict">${fmtValue(sum)}</div>
          <div class="map-meta">Value of everything recognised, read at ${clock(inv.at)}.</div>
          <ul class="legend">
            <li class="item">${count('item')} recognised</li>
            <li class="remembered">${count('remembered')} covered, last known value used</li>
            <li class="unknown">${count('unknown')} not recognised</li>
            <li class="skipped">${count('skipped') + count('ignored')} not counted (no stack number, or ignored)</li>
          </ul>
          ${unpriced ? `<p class="map-meta">${unpriced} recognised ${unpriced === 1 ? 'item has' : 'items have'} no price.</p>` : ''}
          <p class="map-meta">Hover a slot to see how it was read.</p>
        </div>
      </div>
      ${problems ? `<ul class="inv-problems">${problems}</ul>` : ''}
      <table><thead><tr><th>Item</th><th class="num">Amount</th><th class="num">Each</th><th class="num">Total</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Nothing recognised in this read.</td></tr>'}</tbody></table>`;
  }

  function render() {
    if (!state) return;
    renderStatus(); renderNow(); renderSession(); renderMapCheck(); renderCosts(); renderPriceCheck(); renderInventory(false); renderPrices(false);
  }

  function setState(s) {
    const hadCheck = state && state.mapCheck ? state.mapCheck.at : 0;
    const hadPrice = state && state.priceCheck ? state.priceCheck.at : 0;
    const first = !state;
    state = s; receivedAt = Date.now();
    if (!first && s.mapCheck && s.mapCheck.at !== hadCheck) showTab('mapcheck');
    else if (!first && s.priceCheck && s.priceCheck.at !== hadPrice) showTab('prices');
    render();
  }

  function showTab(name) {
    for (const b of document.querySelectorAll('.sidenav .navi')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const id of ['mapping', 'inventory', 'mapcheck', 'costs', 'prices']) $(`tab-${id}`).hidden = id !== name;
    if (name === 'inventory') renderInventory(true);
    if (name === 'prices') renderPrices(true);
  }

  // ---- events ---------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const d = b.dataset;
      e.stopPropagation();
      act({ type: d.act, id: d.id, runId: d.run, lootId: d.loot, batch: d.batch, costId: d.cost, name: d.name, qty: d.qty ? Number(d.qty) : undefined });
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

  $('btn-read').addEventListener('click', () => act({ type: 'readInventory' }));
  $('btn-update').addEventListener('click', () => act({ type: 'applyUpdate' }));
  $('btn-check-update').addEventListener('click', () => act({ type: 'checkUpdate' }));
  $('btn-diagnostic').addEventListener('click', () => { act({ type: 'saveDiagnostic' }); dlg.close(); });
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

  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-learn-form]');
    if (!f) return;
    e.preventDefault();
    const input = f.querySelector('input');
    act({ type: 'learn', id: f.dataset.learnForm, name: input.value.trim() });
    input.value = '';
    input.blur();
  });

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

  // ---- price browser ------------------------------------------------------------------
  let priceCat = 'Currency';
  let priceStamp = '';
  let priceMeta = { chaosIcon: null, divineIcon: null, groups: [] };
  let searchTimer = null;
  const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
  const coin = (url, word) => (url ? `<img class="coin" src="${esc(url)}" alt="${word}" width="22" height="22">` : `<span class="coinword">${word}</span>`);

  // Value the way poe.ninja shows it: a number with the currency's picture.
  function valueCell(chaos) {
    const divine = state.summary.divine;
    if (divine > 0 && chaos >= divine) {
      const d = chaos / divine;
      return `${d >= 100 ? Math.round(d).toLocaleString() : d.toFixed(1)} ${coin(priceMeta.divineIcon, 'divine')}`;
    }
    return `${chaos >= 100 ? Math.round(chaos) : Math.round(chaos * 10) / 10} ${coin(priceMeta.chaosIcon, 'chaos')}`;
  }

  // Small trend line for the last 7 days.
  function sparkline(points, change) {
    if (!points || points.length < 2) return '';
    const w = 64, h = 22, min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
    const xy = points.map((v, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
    return `<svg class="spark ${change < 0 ? 'down' : 'up'}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${xy}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  async function renderPriceCats() {
    priceMeta = await api.priceCategories();
    const all = priceMeta.groups.flatMap((g) => g.categories);
    if (priceCat && !all.some((c) => c.id === priceCat) && all.length) priceCat = all[0].id;
    $('price-cats').innerHTML = priceMeta.groups.map((g) => `<h3>${esc(g.group)}</h3>${g.categories.map((c) => `<button type="button" data-cat="${esc(c.id)}" aria-pressed="${c.id === priceCat}">
      ${c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy" width="32" height="32">` : '<span class="noicon"></span>'}<span class="cat-name">${esc(c.label)}</span></button>`).join('')}`).join('');
  }

  async function renderPriceRows() {
    const global = $('price-global').value.trim();
    const query = global || $('price-search').value;
    const everywhere = !!global;
    const res = await api.priceList({ category: everywhere ? '' : priceCat, query });
    const labels = new Map(priceMeta.groups.flatMap((g) => g.categories).map((c) => [c.id, c.label]));
    $('price-title').textContent = everywhere ? `Results for "${global}"` : (labels.get(priceCat) || 'Prices');
    $('price-search').hidden = everywhere;
    $('price-count').textContent = res.total > res.rows.length
      ? `Showing the ${res.rows.length} most valuable of ${res.total.toLocaleString()}. Type more of the name to narrow it down.`
      : `${res.total} ${res.total === 1 ? 'item' : 'items'}, most valuable first.`;
    const hasVolume = res.rows.some((r) => r.volume != null);
    $('price-vol-head').textContent = hasVolume ? 'Volume / hour' : 'Listed';
    $('price-rows').innerHTML = res.rows.length ? res.rows.map((r) => {
      const pct = r.change == null ? '' : `<span class="${r.change < 0 ? 'neg' : 'pos'}">${r.change > 0 ? '+' : ''}${Math.round(r.change)}%</span>`;
      const traded = r.volume != null ? `${compact(r.volume)} ${coin(priceMeta.chaosIcon, 'chaos')}` : (r.listings != null ? compact(r.listings) : '');
      return `<tr>
        <td><div class="pname">${r.icon ? `<img src="${esc(r.icon)}" alt="" loading="lazy" width="36" height="36">` : '<span class="noicon"></span>'}<span>${esc(r.name)}${everywhere ? `<small>${esc(labels.get(r.category) || r.category)}</small>` : ''}</span></div></td>
        <td class="num val">${valueCell(r.chaos)}</td>
        <td class="num"><span class="trend">${sparkline(r.spark, r.change)}${pct}</span></td>
        <td class="num dim">${traded}</td></tr>`;
    }).join('') : `<tr><td colspan="4" class="empty">${query.trim() ? 'Nothing matches that name.' : 'No prices in this category yet.'}</td></tr>`;
  }

  // Redraws the price page when it is opened or when new prices have arrived.
  async function renderPrices(force) {
    if ($('tab-prices').hidden) return;
    const stamp = `${state.status.prices.updatedAt}:${state.status.prices.count}`;
    if (!force && stamp === priceStamp) return;
    priceStamp = stamp;
    await renderPriceCats();
    await renderPriceRows();
  }

  $('price-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    priceCat = b.dataset.cat;
    $('price-global').value = '';
    $('price-search').value = '';
    for (const x of $('price-cats').querySelectorAll('[data-cat]')) x.setAttribute('aria-pressed', String(x === b));
    renderPriceRows();
    document.querySelector('#tab-prices .table-wrap').scrollTop = 0;
  });
  for (const id of ['price-search', 'price-global']) {
    $(id).addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderPriceRows, 150);
    });
  }

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
    el.hkClip.value = c.hotkeys.clipboard;
    el.displayId.innerHTML = `<option value="">Main screen</option>${state.displays.map((d) => `<option value="${d.id}" ${String(d.id) === String(c.inventory.displayId) ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}`;
    el.invKey.value = c.inventory.key || 'Tab';
    el.onKey.checked = !!c.inventory.onKey;
    el.timed.checked = !!c.inventory.timed;
    el.intervalSec.value = (c.inventory.intervalMs || 1000) / 1000;
    $('learned').innerHTML = state.learned.length
      ? state.learned.map((n) => `<li><span>${esc(n)}</span><span></span><button type="button" class="link" data-act="forget" data-name="${esc(n)}">Forget</button></li>`).join('')
      : '<li class="empty">Nothing yet. Items the app cannot recognise show up under the loot list, where you can name them.</li>';
    $('rules').innerHTML = c.mapRules.map((r) => `<label><input type="checkbox" data-rule="${esc(r.id)}" ${r.enabled ? 'checked' : ''}> ${esc(r.label)}</label>`).join('');
    const sh = state.status.shared;
    $('shared-line').textContent = `${sh.count} shared items loaded.`
      + (sh.canUpload ? ` Uploading is on${sh.uploaded ? `: ${sh.uploaded} sent this session` : ''}${sh.waiting ? `, ${sh.waiting} waiting` : ''}.` : ' Uploading is off (no token saved).')
      + (sh.error ? ` Problem: ${sh.error}` : '');
    el.token.value = ''; el.clearToken.checked = false;
    dlg.showModal();
  });
  $('btn-browse').addEventListener('click', async () => { await act({ type: 'browseLog' }); form.elements.logPath.value = state.config.logPath || ''; });
  $('btn-refresh-prices').addEventListener('click', () => act({ type: 'refreshPrices' }));
  form.addEventListener('submit', () => {
    const el = form.elements, c = state.config;
    const enabled = new Set([...document.querySelectorAll('[data-rule]')].filter((x) => x.checked).map((x) => x.dataset.rule));
    const tokenPatch = el.clearToken.checked ? { token: '' } : (el.token.value.trim() ? { token: el.token.value.trim() } : {});
    api.setConfig({
      ...tokenPatch,
      league: el.league.value || c.league,
      characterName: el.characterName.value.trim(),
      logPath: el.logPath.value.trim(),
      hotkeys: { clipboard: el.hkClip.value.trim() || 'F8' },
      inventory: {
        displayId: el.displayId.value || null,
        key: el.invKey.value.trim() || 'Tab',
        onKey: el.onKey.checked,
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
  }, 500);

  api.onState(setState);
  api.getState().then(setState);
})();
