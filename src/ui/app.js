'use strict';
(() => {
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  let state = null;
  let receivedAt = 0;
  let expanded = null;
  let allItems = false; // the open map row lists every item, not only the most valuable

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // divine: the chaos value of a Divine Orb to show the value in. A saved session brings its own.
  function fmtValue(c, divine = state ? state.summary.divine : 0) {
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
    if (st.hotkeys.priceCheckHeld && !st.hotkeys.priceCheck) items.push(['bad', `Price check key ${hk.priceCheck} is taken by another app or is not a key name`]);
    if (hk.snapshot && !st.hotkeys.snapshot) items.push(['bad', `Hotkey ${hk.snapshot} is taken by another app`]);
    const tc = state.config.trade;
    if (tc && tc.enabled) {
      if (tc.hotkeys.next && !st.hotkeys.tradeNext) items.push(['bad', `Trade key ${tc.hotkeys.next} is taken by another app`]);
      if (tc.hotkeys.layout && !st.hotkeys.layout) items.push(['bad', `Layout key ${tc.hotkeys.layout} is taken by another app`]);
      for (const k of st.hotkeys.tradeTaken || []) items.push(['bad', `Trade key ${k} is taken by another app or is not a key name`]);
      if (tc.hotkeys.dismiss && !st.hotkeys.tradeDismiss) items.push(['bad', `Trade key ${tc.hotkeys.dismiss} is taken by another app`]);
    }
    if (state.summary.divine > 0) items.push(['', `1 Divine = ${Math.round(state.summary.divine)}c`]);
    const up = st.update, btn = $('btn-side-update');
    if (up.applying) items.push(['busy', up.step || 'Updating']);
    else if (up.error) items.push(['bad', `Update problem: ${up.error}`]);
    else if (up.available) items.push(['busy', `Update available: ${up.latest.message}`]);
    // The button at the bottom of the sidebar checks, and turns into "Install update" when there is one.
    btn.disabled = !!up.applying || !!up.checking;
    btn.classList.toggle('has-update', !!up.available && !up.applying);
    $('side-update-label').textContent = up.applying ? 'Updating…' : up.checking ? 'Checking…' : up.available ? 'Install update' : (up.checkedAt && Date.now() - up.checkedAt < 8000 ? 'Up to date' : 'Check for updates');
    btn.title = up.available ? `Installs: ${up.latest.message}. The app restarts.` : (up.checkedAt ? `Last checked at ${clock(up.checkedAt)}` : '');
    const line = $('version-line');
    if (line) {
      const cur = up.current ? `Installed version ${up.current.sha.slice(0, 7)} (${up.current.message}).` : 'Installed from a download, so the exact version is not known yet. Install the update once to fix that.';
      const chk = up.checkedAt ? ` Last checked at ${clock(up.checkedAt)}${up.available ? '' : ': up to date'}.` : '';
      line.textContent = cur + chk;
    }
    $('status').innerHTML = items.map(([cls, text]) => `<li class="${cls}">${esc(text)}</li>`).join('');
  }

  // What a map's total leaves out, in words.
  function uncountedLine(run, withHelp) {
    const u = run.uncounted || { stacks: 0, singles: 0 };
    if (!u.stacks && !u.singles) return '';
    const parts = [];
    if (u.stacks) parts.push(`${u.stacks} unrecognised ${u.stacks === 1 ? 'stack' : 'stacks'}`);
    if (u.singles) parts.push(`${u.singles} single ${u.singles === 1 ? 'item' : 'items'} (maps, gear, gems)`);
    const help = withHelp ? ` Hover one in game and press ${esc(state.config.hotkeys.clipboard)} to count it.` : '';
    return `<p class="uncounted">Not in this total: ${parts.join(' and ')}.${help}</p>`;
  }

  // ---- the inventory picture kept for each map --------------------------------
  const snaps = new Map(); // "run id:when it changed" -> pictures, plus "last:run id" while a newer one loads
  function snapData(run, redraw) {
    if (!run || !run.snapAt) return null;
    const key = `${run.id}:${run.snapAt}`;
    if (snaps.has(key)) return snaps.get(key) || snaps.get(`last:${run.id}`) || null;
    snaps.set(key, null);
    api.runSnapshot(run.id).then((d) => {
      if (snaps.size > 80) snaps.clear();
      d.runId = run.id;
      snaps.set(key, d); snaps.set(`last:${run.id}`, d);
      redraw();
    });
    return snaps.get(`last:${run.id}`) || null;
  }
  // How a slot was read, for its hover text: the match, and the closest names when it was not clear-cut.
  const SOURCE = { art: 'downloaded picture', learned: 'your picture', shared: 'shared picture', pinned: 'named by you for this slot', map: 'map tier read from its picture' };
  const LIMIT = { art: 82, learned: 90, shared: 90 };
  function readNote(c) {
    const parts = [];
    if (c.name && c.source) parts.push(`Matched by ${SOURCE[c.source] || c.source}${c.score ? `, ${c.score}%` : ''}`);
    if (c.how === 'sharp') parts.push('look-alikes told apart on the sharp picture');
    if (c.how === 'doubt') parts.push('look-alikes could not be told apart for certain');
    const near = (c.near || []).filter((n) => n.name !== c.name).slice(0, c.name ? 2 : 3);
    if (near.length) parts.push(`${c.name ? 'Next closest' : 'Closest'}: ${near.map((n) => `${n.name} ${n.score}% (${SOURCE[n.source] || n.source}, needs ${LIMIT[n.source] || 90}%)`).join(', ')}`);
    return parts.length ? ` ${parts.join('. ')}.` : '';
  }
  function snapTip(c, divine) {
    if (c.carried) return `${c.name ? `${c.name} ×${c.qty}` : 'Single item'}: taken into the map with you, not loot`;
    if (c.status === 'item' || c.status === 'remembered') return `${c.name} ×${c.qty}${c.each ? `: ${fmtValue(c.total, divine)}` : ', no price'}${c.carriedQty ? `. ${c.carriedQty} of these were taken into the map with you` : ''}.${readNote(c)}`;
    if (c.status === 'unknown') return `Not recognised, stack of ${c.qty}.${readNote(c)}`;
    if (c.status === 'ignored') return 'Ignored by you';
    return 'No stack number, so not counted (gear, gems and other single items)';
  }
  // One picture per inventory brought out of the map. compact: the small ones beside the timer,
  // newest on top, so the inventory being filled now is always the first one.
  function snapHtml(data, compact, divine) {
    if (!data || !data.trips.length) return '';
    const total = data.trips.length;
    const trips = data.trips.map((t, i) => ({ t, n: i + 1 }));
    if (compact) trips.reverse();
    return trips.map(({ t, n }, i) => {
      const by = new Map(t.cells.map((c) => [c.cell, c]));
      let cells = '';
      for (let k = 0; k < data.cols * data.rows; k++) {
        const c = by.get(k);
        const fixable = c && c.qty > 0 && ['item', 'remembered', 'unknown'].includes(c.status) && c.source !== 'pinned' && c.source !== 'map' && data.runId;
        cells += c ? `<i class="${esc(c.status)}${c.carried ? ' carried' : ''}${fixable ? ' fixable' : ''}"${fixable ? ` data-fix="snap:${t.trip}:${c.cell}" data-run="${esc(data.runId)}"` : ''} title="${esc(snapTip(c, divine))}${fixable ? ' Click to correct.' : ''}"></i>` : '<i></i>';
      }
      const brought = t.cells.some((c) => c.carried);
      const which = total > 1 ? `Inventory ${n} of ${total}${compact && n === total ? ' (latest)' : ''}, ` : 'Inventory ';
      // The explanation of the dimmed slots is given once, on the first picture shown.
      const legend = brought && (!compact || i === trips.findIndex((x) => x.t.cells.some((c) => c.carried)));
      // In a map's details the legend line explains the colours, so the caption stays short.
      const caption = compact
        ? `${which}at ${clock(t.at)}.${legend ? ' <span class="xkey">Dimmed slots</span>: taken into the map with you, not loot.' : ''}`
        : `${total > 1 ? `Inventory ${n} of ${total}, ` : ''}${clock(t.at)}`;
      return `<figure class="snap"><div class="snap-grid"><img src="${esc(t.image)}" alt="Inventory ${n} of ${total}"><div class="snap-cells">${cells}</div></div>
        <figcaption>${caption}</figcaption></figure>`;
    }).join('');
  }

  // ---- things that need you: shown on the Mapping page until dealt with ---------------
  // Each card is one click: pick what the item is. Not-recognised stacks are not counted until
  // named; uncertain ones are counted as the cheaper look-alike until confirmed.
  function renderAttention() {
    const box = $('attention');
    const un = (state.unknown || []).filter((u) => u.here).slice(0, 4), doubts = (state.doubts || []).slice(0, 3);
    const waiting = (state.unknown || []).length - un.length;
    const key = JSON.stringify([un.map((u) => [u.id, u.qty, u.guesses.map((g) => g.name)]), doubts.map((d) => [d.id, d.name, d.options]), waiting]);
    if (box.dataset.key === key) return;
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.value) return;
    box.dataset.key = key;
    box.hidden = !un.length && !doubts.length;
    if (box.hidden) { box.innerHTML = ''; return; }
    const n = un.length + doubts.length;
    const cards = un.map((u) => `<li>
        <img src="${esc(u.image)}" alt="">
        <div><p><b>Not recognised</b>, stack of ${u.qty}. Not counted until you say what it is:</p>
        <div class="chips">${u.guesses.map((g) => `<button type="button" data-act="learn" data-id="${u.id}" data-name="${esc(g.name)}" title="${g.score}% alike">${esc(g.name)}</button>`).join('')}
          <button type="button" class="other" data-fix="unknown:${u.id}">Something else…</button>
          <button type="button" class="link" data-act="ignore" data-id="${u.id}" title="Never count or ask about this item again">Ignore it</button></div></div></li>`).join('')
      + doubts.map((d) => `<li>
        <img src="${esc(d.image)}" alt="">
        <div><p><b>Not sure</b>: counted as ${esc(d.name)}${d.qty > 1 ? ` ×${d.qty}` : ''}, but it looks much like ${esc(d.options.join(' or ') || 'another item')}. Which is it?</p>
        <div class="chips">${[d.name, ...d.options].map((name) => `<button type="button" data-act="fixSlot" data-id="${esc(d.id)}" data-name="${esc(name)}">${esc(name)}</button>`).join('')}
          <button type="button" class="other" data-fix="${esc(d.id)}">Something else…</button></div></div></li>`).join('');
    box.innerHTML = `<h2>${n === 1 ? 'One item needs a look' : `${n} items need a look`}</h2><ul>${cards}</ul>
      ${waiting > 0 ? `<p class="more">${waiting} more from earlier ${waiting === 1 ? 'is' : 'are'} waiting on the <button type="button" class="link" data-tab="items">Items page</button>.</p>` : ''}`;
  }

  // The dialog behind every "click to correct": a slot of the inventory, of a map's picture, or
  // a card above. target: what fixSlot or learn needs to find the picture again.
  let fixTarget = null;
  function openFix(id, runId) {
    const [where, x, y] = id.split(':');
    let pic = '', now = '', options = [];
    $('fix-remove').hidden = true;
    if (where === 'db') {
      const hit = dbPics.get(`${x}:${y}`);
      if (!hit) return;
      const { row, p } = hit;
      pic = `<img src="${esc(p.seen)}" alt="">`;
      now = `This picture counts as <b>${row.name ? esc(row.name) : 'ignored'}</b>: ${esc(whoNamed(p))}.`;
      options = p.doubt ? [p.doubt.name] : [];
      fixTarget = { type: 'renameItem', id: p.id };
      $('fix-remove').hidden = !(known.canUpload || p.onlyHere || x === 'mine');
    } else if (where === 'inv') {
      const c = invCells.get(Number(x)) || (state.doubts || []).find((d) => d.id === id);
      if (!c) return;
      pic = `<img src="${esc(c.image)}" alt="">`;
      now = c.name ? `The app reads this as <b>${esc(c.name)}</b>${c.qty > 1 ? ` ×${c.qty}` : ''}.` : `The app does not recognise this stack of ${c.qty}.`;
      options = (c.near || []).map((n) => n.name).concat(c.options || [], c.guess ? [c.guess.name] : []);
      if (c.name) options.unshift(c.name);
      fixTarget = { type: 'fixSlot', id };
    } else if (where === 'snap') {
      const data = snaps.get(`last:${runId}`), t = data && data.trips.find((q) => String(q.trip) === x), c = t && t.cells.find((q) => String(q.cell) === y);
      if (!c) return;
      const col = c.cell % data.cols, row = Math.floor(c.cell / data.cols);
      pic = `<div class="crop"><img src="${esc(t.image)}" alt="" class="c${col} r${row}"></div>`;
      now = c.name ? `The app read this as <b>${esc(c.name)}</b>${c.qty > 1 ? ` ×${c.qty}` : ''} in that map.` : `The app did not recognise this stack of ${c.qty} in that map.`;
      options = (c.near || []).map((n) => n.name);
      if (c.name) options.unshift(c.name);
      fixTarget = { type: 'fixSlot', id, runId };
    } else {
      const u = (state.unknown || []).find((q) => String(q.id) === x);
      if (!u) return;
      pic = `<img src="${esc(u.image)}" alt="">`;
      now = `The app does not recognise this stack of ${u.qty}.`;
      options = u.guesses.map((g) => g.name);
      fixTarget = { type: 'learn', id: u.id };
    }
    options = [...new Set(options)].slice(0, 4);
    $('fix-pic').innerHTML = pic;
    $('fix-now').innerHTML = now;
    $('fix-options').innerHTML = options.map((name) => `<button type="button" data-fix-name="${esc(name)}">${esc(name)}</button>`).join('');
    $('fix-name').value = '';
    $('fix').showModal();
    $('fix-name').focus();
  }
  const sendFix = (name) => { if (fixTarget && name) act({ ...fixTarget, name }); fixTarget = null; $('fix').close(); };
  $('fix-form').addEventListener('submit', (e) => { e.preventDefault(); const name = $('fix-name').value.trim(); if (name) sendFix(name); });
  $('fix-cancel').addEventListener('click', () => { fixTarget = null; $('fix').close(); });
  $('fix-remove').addEventListener('click', () => { if (fixTarget) act({ type: 'forgetItem', id: fixTarget.id }); fixTarget = null; $('fix').close(); });
  $('fix-options').addEventListener('click', (e) => { const b = e.target.closest('[data-fix-name]'); if (b) sendFix(b.dataset.fixName); });

  // ---- current map ------------------------------------------------------------
  function renderNow() {
    const run = currentRun();
    $('btn-run-toggle').textContent = run ? 'End this map' : 'Start a map manually';
    if (!run) {
      $('now-name').innerHTML = `<div class="map-name">Not in a map</div>
        <div class="map-meta">Enter a map and the timer starts by itself.</div>`;
      $('now-head').innerHTML = '<div class="big"><span class="timer" id="timer">0:00</span></div>';
    } else {
      const paused = run.segmentStart === null;
      const strats = state.config.strategies || [];
      const running = strats.find((x) => x.id === state.config.activeStrategy);
      const meta = [strats.length > 1 && running ? `Counted under ${esc(running.name)}` : '', run.level ? `Area level ${run.level}` : '', run.deaths ? `${run.deaths} ${run.deaths === 1 ? 'death' : 'deaths'}` : '', paused ? '<span class="paused">paused while you are out of the map</span>' : ''].filter(Boolean);
      $('now-name').innerHTML = `<div class="map-name">${esc(run.name)}</div><div class="map-meta">${meta.join(', ')}</div>`;
      $('now-head').innerHTML = `<div class="big">
          <span class="timer ${paused ? 'paused' : ''}" id="timer">${fmtTime(liveDuration(run))}</span>
          <span class="value ${run.net < 0 ? 'neg' : ''}">${fmtValue(run.net)}<small>net this map</small></span>
        </div>
        <dl class="split"><div><dt>Loot</dt><dd>${fmtValue(run.lootValue)}</dd></div><div><dt>Costs</dt><dd>${fmtValue(run.costValue)}</dd></div></dl>
        ${uncountedLine(run, true)}`;
    }

    // The picture is only redrawn when it changes, so it does not flicker with the timer.
    const snapBox = $('now-snap');
    const snap = snapData(run, renderNow);
    // Every inventory this map has filled so far is shown, not only the one being filled now.
    const snapKey = snap && snap.trips.length ? `${run.id}:${snap.trips.map((t) => `${t.trip}@${t.at}`).join(',')}` : '';
    if (snapBox.dataset.key !== snapKey) {
      snapBox.dataset.key = snapKey;
      snapBox.innerHTML = snapHtml(snap, true);
    }

    // One line per item, most valuable first.
    const feed = $('feed');
    $('loot-title').textContent = run && run.items.length ? `Loot this map: ${run.items.length} ${run.items.length === 1 ? 'item' : 'items'}` : 'Loot this map';
    if (!run || !run.items.length) {
      feed.innerHTML = `<li class="empty">${run ? `No loot yet. Open your inventory (${esc(state.config.inventory.key)}) after picking things up.` : 'Loot shows up here once a map is running.'}</li>`;
    } else {
      feed.innerHTML = run.items.map((l) => `<li>
        <span class="qty">${l.qty}</span>
        ${l.icon ? `<img src="${esc(l.icon)}" alt="" loading="lazy" width="26" height="26">` : '<span class="noicon"></span>'}
        <span class="nm">${esc(l.name)}${l.byHand ? '<span class="src">added by hand</span>' : ''}</span>
        <span class="val ${l.chaos > 0 ? '' : 'dim'}">${l.chaos > 0 ? fmtValue(l.chaos) : 'no price'}</span>
        <button type="button" class="link x" data-act="removeLootName" data-run="${esc(run.id)}" data-name="${esc(l.name)}" title="Remove from this map's loot" aria-label="Remove ${esc(l.name)}">×</button></li>`).join('');
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

    renderItems();
  }

  // ---- items page: what could not be recognised, and what you have named --------------
  function renderItems() {
    const un = state.unknown || [];
    $('items-dot').hidden = !un.length;
    $('unknown-box').hidden = !un.length;
    $('hk-name').textContent = state.config.hotkeys.clipboard;
    $('unknown-title').textContent = un.length ? `Not recognised: ${un.length}` : 'Not recognised';
    $('btn-unknown-clear').hidden = !un.length;
    const list = $('unknown');
    // Rebuild only when the items or suggestions change, and never while a name is being typed.
    const key = un.map((u) => `${u.id}:${u.here}:${u.qty}:${u.guesses.map((g) => g.name).join('|')}`).join(',');
    const typing = list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.value;
    if (list.dataset.key !== key && !typing) {
      list.dataset.key = key;
      list.innerHTML = un.length ? un.map((u) => `<li>
        <img src="${esc(u.image)}" alt="Unrecognised item">
        <div class="pick">
          <p class="seen">${u.here ? '<b>In your inventory now</b>' : `Last seen ${esc(dayOf(u.at))}, ${clock(u.at)}`}, stack of ${u.qty}</p>
          ${u.guesses.length ? `<div class="chips">${u.guesses.map((g) => `<button type="button" data-act="learn" data-id="${u.id}" data-name="${esc(g.name)}" title="${g.score}% match">${esc(g.name)}</button>`).join('')}</div>` : ''}
          <form class="inline-form" data-learn-form="${u.id}" autocomplete="off">
            <input list="price-names" placeholder="${u.guesses.length ? 'Or type its name' : 'Type its name'}" aria-label="Item name">
            <button type="submit">Save</button>
            <button type="button" data-act="ignore" data-id="${u.id}" title="Never count or ask about this item again">Ignore</button>
            <button type="button" class="link" data-act="dismissUnknown" data-id="${u.id}" title="Take it off this list. It comes back if it is seen again">Dismiss</button>
          </form>
        </div></li>`).join('')
        : '<li class="empty">Nothing waiting. A stack the app cannot recognise lands here and stays until you name it.</li>';
    }

    renderKnown();
  }

  // The item database: every item the app can read, in one table. Each row says how the app
  // knows the item (official picture, pictures from the game and who named them, or the tier
  // numeral for maps), when it was last read, its price and whether it is counted. A row opens
  // to manage the item: rename or remove a picture, stop counting it, give it your own price.
  let known = null, knownRev = null, dbFilter = 'all', dbCat = '', dbLimit = 100, dbOpen = null, dbSort = { key: 'name', dir: 1 };
  const dbPics = new Map(); // picture id -> { row, p }, for the dialog
  function whoNamed(p) {
    // A picture kept on this PC and not in the shared database: say why, since sharing is the point.
    const here = !p.onlyHere ? '' : (p.auto ? ' on this PC' : (known && known.canUpload ? ', waiting to be sent' : ', not shared yet'));
    if (p.over) return `named ${p.by ? `by ${p.by}` : 'by someone'}; not used here, you named this picture ${p.over}`;
    if (p.auto) return `learned by the app${p.by ? ` (${p.by})` : ''}${here}`;
    return `named by ${p.by || (p.onlyHere ? 'you' : 'someone')}${here}`;
  }
  const READ_BY = { art: 'official picture', learned: 'picture from the game', shared: 'picture from the game', pinned: 'your name for that slot', map: 'tier numeral' };
  function whenRead(seen) {
    if (!seen) return '<span class="dim">Not yet</span>';
    const today = new Date().toDateString() === new Date(seen.at).toDateString();
    return `${today ? 'Today' : esc(dayOf(seen.at))}, ${clock(seen.at)}<small>${esc(READ_BY[seen.source] || 'read')}${seen.score ? `, ${seen.score}%` : ''}</small>`;
  }
  function refreshKnown() {
    if (!api.itemsList) return;
    knownRev = state.itemsRev;
    api.itemsList().then((d) => { known = d; renderKnown(); });
  }
  function renderKnown() {
    if ($('tab-items').hidden) return;
    if (state.itemsRev !== knownRev) refreshKnown();
    if (!known) return;
    const hasDoubt = (r) => r.pictures.some((p) => p.doubt && !p.over);
    const tests = {
      all: () => true,
      read: (r) => !!r.seen,
      pics: (r) => r.pictures.length > 0,
      people: (r) => r.pictures.some((p) => !p.auto),
      check: hasDoubt,
      off: (r) => !r.counted,
    };
    const inCat = known.rows.filter((r) => !dbCat || r.category === dbCat);
    if (!tests[dbFilter] || (dbFilter !== 'all' && !inCat.some(tests[dbFilter]))) dbFilter = 'all';
    const labels = [['all', 'Every item'], ['read', 'Read by the app'], ['pics', 'With a picture from the game'], ['people', 'Named by people'], ['check', 'To check'], ['off', 'Not counted']];
    $('db-filters').innerHTML = labels.map(([id, label]) => [id, label, inCat.filter(tests[id]).length]).filter(([id, , n]) => id === 'all' || n)
      .map(([id, label, n]) => `<button type="button" role="tab" data-db-filter="${id}" aria-selected="${id === dbFilter}"${id === 'check' ? ' class="check"' : ''}>${label} <span>${n}</span></button>`).join('');
    const cats = $('db-cats');
    const catHtml = `<button type="button" data-db-cat="" aria-pressed="${!dbCat}"><span class="noicon"></span><span class="cat-name">All categories</span><span class="n">${known.rows.length}</span></button>`
      + known.categories.map((c) => `<button type="button" data-db-cat="${esc(c.id)}" aria-pressed="${c.id === dbCat}">${c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy">` : '<span class="noicon"></span>'}<span class="cat-name">${esc(c.label)}</span><span class="n">${c.count}</span></button>`).join('');
    if (cats.dataset.html !== catHtml) { cats.dataset.html = catHtml; cats.innerHTML = catHtml; }
    $('db-title').textContent = 'Items';
    // Whether what you name reaches everyone, said where you manage the items.
    const sh = state.status.shared || {}, share = $('db-share');
    const unsent = known.rows.reduce((n, r) => n + r.pictures.filter((p) => p.onlyHere && !p.auto).length, 0);
    let shareHtml, shareCls;
    if (!sh.canUpload) {
      shareCls = 'off';
      shareHtml = `<span><b>Sharing is off.</b> ${unsent ? `The ${unsent === 1 ? 'name' : `${unsent} names`} you gave ${unsent === 1 ? 'is' : 'are'}` : 'Names you give are'} kept on this PC only, because you are not logged in. Log in and everything is sent at once, for everyone.</span>
        <button type="button" class="primary" data-open-account>Log in to share</button>`;
    } else if (sh.error) {
      shareCls = 'bad';
      shareHtml = `<span><b>The item database did not take the last upload.</b> ${esc(sh.error)}${unsent ? ` ${unsent} ${unsent === 1 ? 'name is' : 'names are'} waiting on this PC.` : ''}</span>
        <span class="row"><button type="button" data-act="uploadShared">Try again</button></span>`;
    } else {
      shareCls = 'on';
      shareHtml = `<span>Sharing is on. What you name is sent to the item database as <b>${esc(sh.by || known.me)}</b> and every app has it at its next start. ${sh.count} ${sh.count === 1 ? 'picture' : 'pictures'} in the database.${unsent ? ` ${unsent} on this PC not sent yet.` : ''}</span>
        ${unsent ? '<button type="button" data-act="uploadShared">Send now</button>' : ''}`;
    }
    share.hidden = false;
    share.className = `db-share ${shareCls}`;
    if (share.dataset.html !== shareHtml) { share.dataset.html = shareHtml; share.innerHTML = shareHtml; }
    const reset = $('db-reset');
    reset.hidden = !known.named;
    reset.textContent = `Remove all ${known.named} names given by hand`;
    reset.dataset.confirm = `Remove all ${known.named} names given by hand on this PC?${known.canUpload ? ' They are also removed from the shared database.' : ''} What the app learned by itself stays. The app then reads those items by itself where it can, and asks you about the rest.`;

    const q = $('learned-filter').value.trim().toLowerCase();
    const list = inCat.filter(tests[dbFilter]).filter((r) => !q || (r.name || 'ignored').toLowerCase().includes(q) || r.pictures.some((p) => (p.by || '').toLowerCase().includes(q)));
    const by = {
      name: (x, y) => (x.name || '').localeCompare(y.name || ''),
      price: (x, y) => (x.chaos || 0) - (y.chaos || 0),
      read: (x, y) => ((x.seen || {}).at || 0) - ((y.seen || {}).at || 0),
    }[dbSort.key];
    list.sort((x, y) => (hasDoubt(y) ? 1 : 0) - (hasDoubt(x) ? 1 : 0) || dbSort.dir * by(x, y) || (x.name || '').localeCompare(y.name || ''));
    for (const b of document.querySelectorAll('[data-db-sort]')) b.dataset.dir = b.dataset.dbSort === dbSort.key ? (dbSort.dir > 0 ? 'up' : 'down') : '';
    $('db-hint').textContent = `${list.length} of ${known.rows.length} items. Click an item to manage it: its pictures, whether it is counted, and its price.`;

    dbPics.clear();
    const icon = (src, cls = 'official') => (src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<span class="${cls} none"></span>`);
    const how = (r) => {
      if (r.method === 'tier') return '<span class="tag">Tier numeral on the map</span>';
      if (r.pictures.length) {
        const shown = r.pictures.filter((p) => !p.over);
        const thumbs = r.pictures.slice(0, 3).map((p) => `<img class="thumb${p.sharp ? '' : ' blur'}${p.over ? ' over' : ''}" src="${esc(p.seen)}" alt="">`).join('');
        const who = shown.length === 1 ? whoNamed(shown[0]) : `${r.pictures.length} pictures`;
        return `<span class="thumbs">${thumbs}</span><span class="tag good">Picture from the game</span><small>${esc(who)}</small>`;
      }
      if (r.method === 'slot') return '<span class="tag">Named by you for one slot</span>';
      return r.official ? '<span class="tag">Official picture</span>' : '<span class="tag dimmed">Official picture not downloaded yet</span>';
    };
    const detail = (r) => {
      const official = r.method === 'tier'
        ? '<li><span class="official none"></span><div><b>Tier numeral</b><small>The Roman numeral on the map is compared with one reference picture per tier.</small></div></li>'
        : `<li>${icon(r.icon)}<div><b>Official picture</b><small>${r.official ? 'From poe.ninja. A slot must look at least 82% like it.' : (r.icon ? 'Not downloaded yet. It is fetched in the background.' : 'There is none: poe.ninja does not list this name.')}</small></div></li>`;
      const pics = r.pictures.map((p) => {
        dbPics.set(p.id, { row: r, p });
        const doubt = p.doubt && !p.over ? `<span class="doubt">Looks more like ${icon(p.doubt.icon, 'mini')}<b>${esc(p.doubt.name)}</b> <button type="button" data-act="renameItem" data-id="${esc(p.id)}" data-name="${esc(p.doubt.name)}">Rename to ${esc(p.doubt.name)}</button></span>` : '';
        const canRemove = known.canUpload || p.id.startsWith('mine:');
        return `<li class="${p.over ? 'over' : ''}"><img class="seen${p.sharp ? '' : ' blur'}" src="${esc(p.seen)}" alt="">
          <div><b>Picture from the game</b><small>${esc(whoNamed(p))}${p.sharp ? '' : '. Only a blur of it was kept'}</small>${doubt}</div>
          <span class="acts"><button type="button" data-fix="db:${esc(p.id)}">Rename</button>${canRemove ? `<button type="button" class="link" data-act="forgetItem" data-id="${esc(p.id)}" data-confirm="Remove this picture?${known.canUpload ? ' It is removed for everyone.' : ''}">Remove</button>` : ''}</span></li>`;
      }).join('');
      const none = r.method === 'picture' && !r.pictures.length ? '<p class="fine">No picture from the game yet. The app saves one by itself after a clear read, and from then on recognises this item almost exactly.</p>' : '';
      const price = r.name ? `<form class="inline-form" data-db-price="${esc(r.name)}" autocomplete="off">
          <label>Your own price <input type="number" min="0" step="0.01" value="${r.own !== null ? r.own : ''}" placeholder="${r.ninja !== null ? r.ninja : 'none'}" aria-label="Your own price in chaos"> c</label>
          <button type="submit">Save</button>${r.own !== null ? `<button type="button" class="link" data-db-price-clear="${esc(r.name)}">${r.ninja !== null ? 'Use the poe.ninja price' : 'Remove'}</button>` : ''}</form>
          <p class="fine">${r.ninja !== null ? `poe.ninja: ${fmtValue(r.ninja)}.` : 'poe.ninja has no price for this name.'}${r.own !== null ? ' Your own price is the one used.' : ''}</p>` : '';
      const count = r.name ? `<label class="check"><input type="checkbox" data-db-count="${esc(r.name)}"${r.counted ? ' checked' : ''}> Count this item as loot</label>` : '<p class="fine">Pictures you chose to ignore. Remove one and the app asks about it again.</p>';
      return `<tr class="detail dbdetail"><td colspan="5"><div class="dbd">
        <section><h3>How the app recognises it</h3><ul class="dbpics">${r.name ? official : ''}${pics}</ul>${none}</section>
        <section><h3>Counting and price</h3>${count}${price}</section>
      </div></td></tr>`;
    };
    const html = list.slice(0, dbLimit).map((r) => {
      const key = r.name || '(ignored)';
      const flags = `${r.counted ? '' : '<span class="tag off">Not counted</span>'}${hasDoubt(r) ? '<span class="tag warn">Check</span>' : ''}`;
      const cat = (known.categories.find((c) => c.id === r.category) || {}).label || r.category;
      return `<tr class="dbrow${dbOpen === key ? ' open' : ''}${r.counted ? '' : ' off'}" data-db-row="${esc(key)}">
        <td><div class="pname">${icon(r.icon, 'picon')}<div>${r.name ? esc(r.name) : 'Ignored pictures'}<small>${esc(cat)}</small></div></div></td>
        <td class="num val">${r.chaos === null ? '<span class="dim">none</span>' : fmtValue(r.chaos)}${r.own !== null ? '<small>your price</small>' : ''}</td>
        <td class="how">${how(r)}</td>
        <td class="when">${whenRead(r.seen)}</td>
        <td class="flags">${flags}</td></tr>${dbOpen === key ? detail(r) : ''}`;
    }).join('') || `<tr><td colspan="5" class="empty">${q ? 'No item matches that.' : 'Nothing here.'}</td></tr>`;
    const box = $('db-rows');
    const typing = box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number';
    if (box.dataset.html !== html && !typing) { box.dataset.html = html; box.innerHTML = html; }
    const more = $('db-more');
    more.hidden = list.length <= dbLimit;
    more.textContent = `Show more (${list.length - dbLimit} left)`;
  }
  const dbTop = () => { document.querySelector('#tab-items .table-wrap').scrollTop = 0; };
  $('db-filters').addEventListener('click', (e) => { const b = e.target.closest('[data-db-filter]'); if (b) { dbFilter = b.dataset.dbFilter; dbLimit = 100; renderKnown(); dbTop(); } });
  $('db-cats').addEventListener('click', (e) => { const b = e.target.closest('[data-db-cat]'); if (b) { dbCat = b.dataset.dbCat; dbLimit = 100; renderKnown(); dbTop(); } });
  $('db-more').addEventListener('click', () => { dbLimit += 300; renderKnown(); });
  document.querySelector('.db-table thead').addEventListener('click', (e) => {
    const b = e.target.closest('[data-db-sort]');
    if (!b) return;
    dbSort = { key: b.dataset.dbSort, dir: dbSort.key === b.dataset.dbSort ? -dbSort.dir : (b.dataset.dbSort === 'name' ? 1 : -1) };
    renderKnown();
  });
  $('db-rows').addEventListener('click', (e) => {
    if (e.target.closest('button, input, label, form, a')) {
      const clear = e.target.closest('[data-db-price-clear]');
      if (clear) act({ type: 'removeCustomPrice', name: clear.dataset.dbPriceClear });
      return;
    }
    const row = e.target.closest('[data-db-row]');
    if (!row) return;
    dbOpen = dbOpen === row.dataset.dbRow ? null : row.dataset.dbRow;
    renderKnown();
  });
  $('db-rows').addEventListener('change', (e) => { const c = e.target.closest('[data-db-count]'); if (c) act({ type: 'setCounted', name: c.dataset.dbCount, qty: c.checked ? 1 : 0 }); });
  $('db-rows').addEventListener('submit', (e) => {
    const f = e.target.closest('[data-db-price]');
    if (!f) return;
    e.preventDefault();
    const input = f.querySelector('input'), v = input.value.trim();
    input.blur();
    if (v === '') act({ type: 'removeCustomPrice', name: f.dataset.dbPrice }); else act({ type: 'setCustomPrice', name: f.dataset.dbPrice, chaos: v });
  });

  // ---- session ------------------------------------------------------------------
  const totalsHtml = (t, divine) => `
      <div class="lead ${t.net < 0 ? 'neg' : ''}">${fmtValue(t.net, divine)}<span>Net profit</span></div>
      <div>${t.netPerHour ? fmtValue(t.netPerHour, divine) : 'n/a'}<span>Per hour</span></div>
      <div>${t.maps}<span>Maps run</span></div>
      <div>${t.maps ? fmtTime(t.avgMapMs) : 'n/a'}<span>Average map</span></div>
      <div>${t.deaths}<span>Deaths</span></div>`;

  // One line under a map's pictures saying what the slot colours mean, with how many of each.
  function snapLegend(data) {
    if (!data || !data.trips.length) return '';
    const n = { item: 0, remembered: 0, unknown: 0, other: 0, carried: 0 };
    for (const t of data.trips) for (const c of t.cells) {
      if (c.carried) n.carried++;
      else if (c.status === 'item') n.item++;
      else if (c.status === 'remembered') n.remembered++;
      else if (c.status === 'unknown') n.unknown++;
      else n.other++;
    }
    const entry = (cls, count, label, tip) => `<li class="${cls}${count ? '' : ' none'}" title="${tip}"><b>${count}</b> ${label}</li>`;
    return `<ul class="legend row">
      ${entry('item', n.item, 'recognised', 'Read and priced')}
      ${entry('remembered', n.remembered, 'covered', 'Hidden by a tooltip in that read, so the last known value was used')}
      ${entry('unknown', n.unknown, 'not recognised', 'Has a stack number but no known picture. Hover it in game and press the check key to name it')}
      ${entry('skipped', n.other, 'not counted', 'Single items the app has no picture for, such as gear and gems, or items you ignored')}
      ${entry('carried', n.carried, 'taken in with you', 'Already in your inventory when the map started, so not loot')}
    </ul>`;
  }

  // A map's loot as a tight two-column list, most valuable first. Only the top ones unless asked.
  const TOP_ITEMS = 10;
  function itemsHtml(r, divine) {
    if (!r.items.length) return '<p class="none-yet">No loot recorded.</p>';
    const shown = allItems ? r.items : r.items.slice(0, TOP_ITEMS);
    const rest = r.items.slice(shown.length);
    const restValue = rest.reduce((a, i) => a + i.chaos, 0);
    return `<ul class="loot-compact">${shown.map((i) => `<li><span class="q">${i.qty}</span><span class="n">${esc(i.name)}</span><span class="v">${i.chaos > 0 ? fmtValue(i.chaos, divine) : 'no price'}</span></li>`).join('')}</ul>
      ${r.items.length > TOP_ITEMS ? `<button type="button" class="link more" data-allitems="1">${allItems ? 'Show only the top items' : `Show ${rest.length} more ${rest.length === 1 ? 'item' : 'items'}, worth ${fmtValue(restValue, divine)}`}</button>` : ''}`;
  }

  // The rows of a map table, newest first. open: the id of the row showing its details.
  // readonly: no Delete button (saved sessions). redraw: called when a map's picture has loaded.
  function runsHtml(sum, { open, readonly, redraw, divine }) {
    const runs = sum.runs.slice().reverse();
    if (!runs.length) return '<tr><td colspan="7" class="empty">Finished maps are listed here.</td></tr>';
    return runs.map((r) => {
      const live = r.id === sum.currentId;
      let html = `<tr class="run ${live ? 'live' : ''} ${open === r.id ? 'open' : ''}" data-expand="${esc(r.id)}">
        <td>${esc(r.name)}</td>
        <td class="num">${fmtTime(live ? liveDuration(r) : r.durationMs)}</td>
        <td class="num">${fmtValue(r.lootValue, divine)}</td>
        <td class="num">${fmtValue(r.costValue, divine)}</td>
        <td class="num ${r.net < 0 ? 'neg' : 'pos'}">${fmtValue(r.net, divine)}</td>
        <td class="num">${r.deaths}</td>
        <td>${readonly ? '' : `<button type="button" class="link" data-act="deleteRun" data-run="${esc(r.id)}" aria-label="Delete ${esc(r.name)}">Delete</button>`}</td></tr>`;
      if (open === r.id) {
        const costs = r.costs.length ? `<p class="costline">Costs: ${r.costs.map((c) => `${esc(c.name)} ×${c.qty} (${fmtValue(c.total, divine)})`).join(', ')}</p>` : '';
        const data = snapData(r, redraw);
        const snap = snapHtml(data, false, divine);
        html += `<tr class="detail"><td colspan="7">${snap ? `<div class="snaps">${snap}</div>${snapLegend(data)}` : ''}${itemsHtml(r, divine)}${costs}</td></tr>`;
      }
      return html;
    }).join('');
  }

  // ---- strategies: tabs across the top; each has its own sessions ----------------
  let stratSel = null; // the strategy being looked at; the one being run is config.activeStrategy
  let sessionSel = 'current';
  const saved = new Map(); // id -> the full saved session
  const dayOf = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const mapsWord = (n) => `${n} ${n === 1 ? 'map' : 'maps'}`;

  function renderStrategies() {
    const list = state.config.strategies || [], active = state.config.activeStrategy;
    if (!list.some((x) => x.id === stratSel)) stratSel = active;
    $('strat-tabs').innerHTML = list.map((x) => `<button type="button" role="tab" data-strat="${esc(x.id)}" aria-selected="${x.id === stratSel}">
      ${x.id === active ? '<span class="live-dot" title="You are running this one"></span>' : ''}${esc(x.name)}</button>`).join('')
      + '<button type="button" class="add" id="btn-strategy-new">+ New strategy</button>';
    const cur = list.find((x) => x.id === stratSel);
    // Everything this strategy has made: its saved sessions plus the running one.
    const mine = (state.sessions || []).filter((x) => x.strategyId === stratSel).map((x) => x.totals);
    if (stratSel === active && state.summary.runs.length) mine.push(state.summary.totals);
    const sum = mine.reduce((a, t) => ({ maps: a.maps + t.maps, net: a.net + t.net, ms: a.ms + (t.elapsedMs || 0) }), { maps: 0, net: 0, ms: 0 });
    const perHour = sum.ms > 60000 ? sum.net / (sum.ms / 3600000) : 0;
    const stats = mine.length
      ? `${mine.length} ${mine.length === 1 ? 'session' : 'sessions'}, ${mapsWord(sum.maps)}, <b class="${sum.net < 0 ? 'neg' : ''}">${fmtValue(sum.net)}</b> net${perHour ? `, ${fmtValue(perHour)} per hour` : ''}`
      : 'No sessions yet';
    $('strat-info').innerHTML = `
      ${stratSel === active ? '<span class="running">Running now</span>' : `<button type="button" class="primary" data-act="runStrategy" data-id="${esc(cur.id)}"${state.summary.runs.length ? ' data-confirm="Switch strategy? The session you have open is saved and closed first."' : ''}>Run this strategy now</button>`}
      <span class="strat-stats">${stats}</span>
      <span class="strat-links">
        ${cur.atlasUrl ? `<a href="${esc(cur.atlasUrl)}" target="_blank" rel="noreferrer">Open atlas tree</a>` : '<span class="dim">No atlas tree link</span>'}
        <button type="button" class="link" id="btn-strategy-edit">Edit</button>
      </span>`;
  }

  // The right half: the sessions of the strategy being looked at.
  let runsShown = null;
  function renderSession() {
    const list = (state.sessions || []).filter((x) => x.strategyId === stratSel);
    const running = stratSel === state.config.activeStrategy;
    if (sessionSel === 'current' ? !running : !list.some((x) => x.id === sessionSel)) sessionSel = running ? 'current' : (list[0] ? list[0].id : null);
    const live = state.summary;
    const chip = (id, title, t, divine) => `<button type="button" role="tab" data-session="${esc(id)}" aria-selected="${id === sessionSel}">
      <b>${esc(title)}</b><span>${mapsWord(t.maps)}, <em class="${t.net < 0 ? 'neg' : ''}">${fmtValue(t.net, divine)}</em></span></button>`;
    const strip = $('session-strip');
    const left = strip.scrollLeft;
    strip.innerHTML = (running ? chip('current', 'This session', live.totals, live.divine) : '')
      + list.map((x) => chip(x.id, `${dayOf(x.startedAt)}, ${clock(x.startedAt)}`, x.totals, x.divine)).join('')
      + (list.length ? '' : `<p class="strip-hint">${running ? 'Earlier sessions appear here once you press Start new session.' : 'Nothing has been run under this strategy yet. Press Run this strategy now and your maps are counted here.'}</p>`);
    strip.scrollLeft = left;

    const empty = { maps: 0, deaths: 0, net: 0, netPerHour: 0, avgMapMs: 0 };
    let sum = live, head = '';
    if (!sessionSel) sum = { runs: [], totals: empty, currentId: null };
    else if (sessionSel !== 'current') {
      sum = saved.get(sessionSel);
      if (!sum) {
        const id = sessionSel;
        api.savedSession(id).then((x) => { if (x) { saved.set(id, x); renderSession(); } });
        return;
      }
      head = `<p class="session-note"><span>Saved session, ${esc(dayOf(sum.startedAt))} ${clock(sum.startedAt)} to ${clock(sum.endedAt)}. ${fmtTime(sum.totals.elapsedMs)} long, values as they were then${sum.divine ? ` (1 Divine = ${Math.round(sum.divine)}c)` : ''}.</span>
        <button type="button" class="link" data-act="deleteSession" data-id="${esc(sum.id)}" data-confirm="Delete this saved session? This cannot be undone.">Delete session</button></p>`;
    }
    if (sum === live && live.runs.length) {
      head = `<p class="session-note"><span></span>
        <button type="button" class="link" data-act="recheckMaps" title="Looks at the saved inventory pictures of this session's maps again with the items known now, and corrects loot that was counted under a wrong name or not recognised at the time">Re-check items in these maps</button></p>`;
    }
    if ($('session-head').dataset.html !== head) { $('session-head').dataset.html = head; $('session-head').innerHTML = head; }
    $('totals').innerHTML = totalsHtml(sum.totals, sum.divine);
    // Only redrawn when something changed: redrawing under the mouse would stop the name of a
    // hovered slot from ever showing.
    const rows = runsHtml(sum, { open: expanded, readonly: sum !== live, redraw: renderSession, divine: sum.divine });
    if (rows !== runsShown) { runsShown = rows; $('runs').innerHTML = rows; }
  }

  // ---- tools ----------------------------------------------------------------------
  function renderMapCheck() {
    const mc = state.mapCheck, hk = state.config.hotkeys;
    const anyRule = state.config.mapRules.some((r) => r.enabled);
    let html;
    if (!mc) {
      html = `<p class="hint">Hover a map in game and press ${esc(hk.clipboard)}. The mods your build cannot run are flagged here.</p>
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
    // Gear has no poe.ninja price; the trade search below answers for it.
    if (!pc.found && state.tradeCheck) { $('price-check').innerHTML = ''; return; }
    $('price-check').innerHTML = pc.found
      ? `<p class="notice">${esc(pc.name)} ×${pc.qty} is worth ${fmtValue(pc.total)} (${fmtValue(pc.each)} each).
          <button type="button" class="link" data-act="addLoot" data-name="${esc(pc.name)}" data-qty="${pc.qty}">Add to this map's loot</button></p>`
      : `<p class="notice bad">No price found for ${esc(pc.name)}.</p>`;
  }

  // ---- trade site search for the item last checked ---------------------------------------
  const KIND_WORDS = { pseudo: 'total', implicit: 'implicit', corruption: 'corruption', crafted: 'crafted', fractured: 'fractured', enchant: 'enchant', scourge: 'scourge', crucible: 'crucible' };
  const COIN_WORDS = { chaos: 'c', divine: 'div', exalted: 'ex', mirror: 'mirror' };
  const STATUS_WORDS = { instant: 'Instant buyout', online: 'Online', afk: 'Away', offline: 'Offline' };
  const numAttr = (v) => (v === null || v === undefined ? '' : esc(v));
  function ago(ts) {
    if (!ts) return '';
    const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (m < 60) return `${m} min`;
    if (m < 48 * 60) return `${Math.floor(m / 60)} h`;
    return `${Math.floor(m / 1440)} d`;
  }
  let tradeFormFor = ''; // which check, and which round of its choices, the tick boxes on screen belong to
  let tradeRevShown = -1;

  function tradeFormHtml(f) {
    const tick = (attrs, label, on) => `<label class="tc-tick"><input type="checkbox" ${attrs} ${on ? 'checked' : ''}> <span>${label}</span></label>`;
    const rows = [];
    if (f.category) rows.push(`<li>${tick('data-tc="category"', `Kind: ${esc(f.category.label)}, any base type`, f.category.enabled)}</li>`);
    if (f.type) rows.push(`<li>${tick('data-tc="type"', `Base type: ${esc(f.type.value)}`, f.type.enabled)}</li>`);
    for (const x of f.flags) rows.push(`<li>${tick(`data-tc="flag" data-key="${esc(x.key)}"`, esc(x.label), x.enabled)}</li>`);
    for (const x of f.props) {
      rows.push(`<li>${tick(`data-tc="prop" data-key="${esc(x.key)}"`, `${esc(x.label)}: ${x.value}`, x.enabled)}
        <input type="number" step="any" data-tc-min="${esc(x.key)}" value="${numAttr(x.min)}" placeholder="min" aria-label="Lowest ${esc(x.label)}"></li>`);
    }
    for (const x of f.stats) {
      const kind = (x.tiers || []).map((t) => `<small class="tier${t === 1 ? ' best' : ''}" title="Tier 1 is the best this modifier can be">Tier ${t}</small>`).join('')
        + (KIND_WORDS[x.kind] ? `<small>${KIND_WORDS[x.kind]}</small>` : '');
      const range = x.value === null ? '' : `<input type="number" step="any" data-tc-min="${esc(x.key)}" value="${numAttr(x.min)}" placeholder="min" aria-label="Lowest value for ${esc(x.text)}">
        <input type="number" step="any" data-tc-max="${esc(x.key)}" value="${numAttr(x.max)}" placeholder="max" aria-label="Highest value for ${esc(x.text)}">`;
      rows.push(`<li>${tick(`data-tc="stat" data-key="${esc(x.key)}"`, `${esc(x.text)} ${kind}`, x.enabled)}${range}</li>`);
    }
    rows.push(`<li>${tick('data-tc="offline"', 'Also sellers who are offline', f.offline)}</li>`);
    const unknown = f.unknown.length ? `<p class="hint small">Not searchable on the trade site: ${f.unknown.map(esc).join('; ')}</p>` : '';
    // Two ready-made searches: by the item's stats, or for its base to craft on.
    const modes = f.presets ? `<div class="tc-modes" role="group" aria-label="Ready-made searches"><button type="button" data-tc-mode="stats" aria-pressed="true">Stats</button>
      <button type="button" data-tc-mode="base" aria-pressed="false" title="This base type at this item level, whatever is rolled on it">Base item</button></div>` : '';
    return `${modes}<ul class="tc-rows">${rows.join('')}</ul>${unknown}`;
  }

  function tradeResultHtml(tc) {
    if (tc.state === 'searching') return '<p class="hint">Searching the trade site…</p>';
    if (tc.state === 'error') return `<p class="notice bad">${esc(tc.error)}</p>`;
    if (tc.state !== 'done') return '<p class="hint">Tick what matters about this item, then press Search. Each search is two requests to the trade site, which allows only a few per minute.</p>';
    const link = tc.url ? `<a href="${esc(tc.url)}" target="_blank" rel="noreferrer">Open this search on the trade site</a>` : '';
    if (!tc.total) return `<p class="notice">Nothing like it is listed. Untick a stat or lower a number to widen the search.</p>${link}`;
    const s = tc.summary || {};
    const head = s.low === null ? `${tc.total.toLocaleString()} listed.`
      : `Cheapest <b>${fmtValue(s.low)}</b>, typical <b>${fmtValue(s.median)}</b>. ${tc.total.toLocaleString()} listed.`;
    const rowsHtml = tc.listings.map((l) => {
      const price = l.price ? `${l.price.amount} ${esc(COIN_WORDS[l.price.currency] || l.price.currency)}` : 'No price';
      const inChaos = l.price && l.price.currency !== 'chaos' && l.chaos !== null ? `<small>about ${Math.round(l.chaos).toLocaleString()}c</small>` : '';
      return `<tr><td class="num val">${price}${inChaos}</td>
        <td>${esc(l.name)}${l.itemLevel ? `<small>Item level ${l.itemLevel}${l.corrupted ? ', corrupted' : ''}</small>` : ''}</td>
        <td>${esc(l.seller)}<small class="st-${esc(l.status)}">${STATUS_WORDS[l.status] || ''}</small></td>
        <td class="num dim">${ago(l.listedAt)}</td></tr>`;
    }).join('');
    return `<p class="tc-sum">${head} ${link}</p>
      <div class="table-wrap"><table class="tc-list"><thead><tr><th class="num">Price</th><th>Item</th><th>Seller</th><th class="num">Listed</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  }

  function renderTradeCheck() {
    const tc = state.tradeCheck, box = $('trade-check');
    document.querySelector('#tab-prices .prices').hidden = !!tc;
    $('price-global').hidden = !!tc;
    box.hidden = !tc;
    if (!tc) { tradeFormFor = ''; tradeRevShown = -1; box.innerHTML = ''; return; }
    if (tradeFormFor !== `${tc.at}:${tc.filtersRev}`) {
      // A new item, or a search sent from the window in game: draw the tick boxes. Other
      // updates only touch the results, so what you ticked and typed stays as it is.
      tradeFormFor = `${tc.at}:${tc.filtersRev}`; tradeRevShown = -1;
      const f = tc.filters;
      box.innerHTML = `<div class="tc-head"><h2 class="pagetitle">${esc(f.ok ? f.title : 'Trade search')}</h2>
          <button type="button" data-act="tradeClose">Back to the price lists</button></div>
        ${f.ok ? `<div class="tc-cols"><form id="tc-form" autocomplete="off"><h3>Search for</h3>${tradeFormHtml(f)}
            <div class="tc-go"><button type="submit" class="primary" id="tc-search">Search</button>
              <label class="tc-tick"><input type="checkbox" id="tc-auto" ${(state.config.priceSearch || {}).auto !== false ? 'checked' : ''}> <span>Search straight away when I check an item</span></label>
              <label class="tc-tick"><input type="checkbox" id="tc-overlay" ${(state.config.priceSearch || {}).overlay !== false ? 'checked' : ''}> <span>Show the search on top of the game</span></label></div>
          </form><section id="tc-result" aria-live="polite"></section></div>`
    : `<p class="notice">${esc(f.why)}</p>`}`;
    }
    if (tc.filters.ok && tradeRevShown !== tc.rev) {
      tradeRevShown = tc.rev;
      $('tc-result').innerHTML = `<h3>Listed on the trade site</h3>${tradeResultHtml(tc)}`;
      $('tc-search').disabled = tc.state === 'searching';
    }
  }

  // What is ticked and typed in the search form, for the main process to lay over its own copy.
  function tradeEdits(form) {
    const edits = { flags: {}, props: {}, stats: {} };
    const val = (sel) => { const i = form.querySelector(sel); return i ? i.value : undefined; };
    for (const c of form.querySelectorAll('[data-tc]')) {
      const key = c.dataset.key;
      if (c.dataset.tc === 'offline' || c.dataset.tc === 'type' || c.dataset.tc === 'category') edits[c.dataset.tc] = c.checked;
      else if (c.dataset.tc === 'flag') edits.flags[key] = c.checked;
      else if (c.dataset.tc === 'prop') edits.props[key] = { enabled: c.checked, min: val(`[data-tc-min="${key}"]`) };
      else if (c.dataset.tc === 'stat') {
        const e = { enabled: c.checked }, min = val(`[data-tc-min="${key}"]`), max = val(`[data-tc-max="${key}"]`);
        if (min !== undefined) e.min = min;
        if (max !== undefined) e.max = max;
        edits.stats[key] = e;
      }
    }
    return edits;
  }
  $('trade-check').addEventListener('submit', (e) => {
    e.preventDefault();
    act({ type: 'tradeSearch', edits: tradeEdits(e.target) });
  });
  $('trade-check').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tc-mode]');
    const tc = state.tradeCheck;
    if (!b || !tc || !tc.filters.presets) return;
    const set = tc.filters.presets[b.dataset.tcMode] || {};
    for (const c of $('tc-form').querySelectorAll('[data-tc]')) {
      const name = c.dataset.tc === 'flag' || c.dataset.tc === 'prop' || c.dataset.tc === 'stat' ? `${c.dataset.tc}:${c.dataset.key}` : c.dataset.tc;
      if (name in set) c.checked = !!set[name];
    }
    for (const x of $('tc-form').querySelectorAll('[data-tc-mode]')) x.setAttribute('aria-pressed', String(x === b));
  });
  $('trade-check').addEventListener('change', (e) => {
    if (e.target.id === 'tc-auto') api.setConfig({ priceSearch: { auto: e.target.checked } });
    if (e.target.id === 'tc-overlay') api.setConfig({ priceSearch: { overlay: e.target.checked } });
  });

  // ---- inventory tab ------------------------------------------------------------------
  let invRev = -1;
  const invCells = new Map(); // slot -> what the Inventory page last showed there, for the fix dialog
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
    const describe = (c) => {
      if (c.status === 'item') return `${c.name} ×${c.qty}: ${fmtValue(c.total)}.${readNote(c)}`;
      if (c.status === 'remembered') return `${c.name} ×${c.qty}: ${fmtValue(c.total)}. Covered in this read, so the last known value is used.`;
      if (c.status === 'unknown') return `Not recognised, stack of ${c.qty}.${readNote(c) || (c.guess ? ` Closest picture: ${c.guess.name}, ${c.guess.score}% match.` : '')}`;
      if (c.status === 'ignored') return 'Ignored by you.';
      if (c.status === 'covered') return 'Possibly covered by a tooltip in this read, so nothing was concluded.';
      return `A single item the app has no picture for, so it is not counted. Hover it in game and press ${state.config.hotkeys.clipboard} to count it.${c.guess ? ` Closest picture: ${c.guess.name}, ${c.guess.score}%.` : ''}`;
    };
    const byCell = new Map(inv.cells.map((c) => [c.cell, c]));
    let grid = '';
    for (let k = 0; k < inv.cols * inv.rows; k++) {
      const c = byCell.get(k);
      const fixable = c && c.qty > 0 && ['item', 'remembered', 'unknown'].includes(c.status) && c.source !== 'pinned' && c.source !== 'map';
      grid += c ? `<div class="slot ${c.status}${fixable ? ' fixable' : ''}"${fixable ? ` data-fix="inv:${c.cell}"` : ''} title="${esc(describe(c))}${fixable ? ' Click to correct.' : ''}"><img src="${esc(c.image)}" alt="${esc(c.name || c.status)}"></div>` : '<div class="slot empty"></div>';
      if (c) invCells.set(c.cell, c);
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
            <li class="skipped">${count('skipped') + count('ignored') + count('covered')} not counted (single items the app has no picture for, such as gear and gems, or ignored, or covered)</li>
          </ul>
          ${unpriced ? `<p class="map-meta">${unpriced} recognised ${unpriced === 1 ? 'item has' : 'items have'} no price.</p>` : ''}
          <p class="map-meta">Hover a slot to see how it was read.</p>
        </div>
      </div>
      ${problems ? `<ul class="inv-problems">${problems}</ul>` : ''}
      <table><thead><tr><th>Item</th><th class="num">Amount</th><th class="num">Each</th><th class="num">Total</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Nothing recognised in this read.</td></tr>'}</tbody></table>`;
  }

  // ---- trade page -----------------------------------------------------------------
  let tradeDrawn = '';
  let tradeSeen = null; // highest offer id already announced with a sound
  function beep() {
    try {
      const ctx = beep.ctx || (beep.ctx = new AudioContext());
      const t = ctx.currentTime;
      for (const [freq, at] of [[660, 0], [880, 0.13]]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t + at);
        gain.gain.exponentialRampToValueAtTime(0.18, t + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + at); osc.stop(t + at + 0.25);
      }
    } catch (_) { /* no sound device */ }
  }

  // Sold per day for the last two weeks: one column per day, today on the right.
  let salesDrawn = '';
  function renderSales(t) {
    const days = t.days || [], plot = $('sales-plot'), tip = $('sales-tip');
    const key = JSON.stringify([days, t.divine]);
    if (key === salesDrawn) return;
    salesDrawn = key;
    tip.hidden = true;
    const total = days.reduce((a, x) => a + x.sold, 0), count = days.reduce((a, x) => a + x.soldCount, 0);
    $('sales-sub').textContent = count ? `last ${days.length} days: ${count} ${count === 1 ? 'sale' : 'sales'}, ${fmtValue(total, t.divine)}` : `last ${days.length} days`;
    const max = Math.max(0, ...days.map((x) => x.sold));
    if (!count || max <= 0) {
      plot.innerHTML = `<p class="sales-empty">${count ? 'Sales in this period have no known value to chart.' : 'No sales in this period yet. Each finished sale adds to its day here.'}</p>`;
      return;
    }
    // One unit for the whole axis: divine once the tallest day is worth a few, chaos otherwise.
    const inDiv = t.divine > 0 && max >= t.divine * 3, unit = inDiv ? t.divine : 1, word = inDiv ? 'div' : 'c';
    const top = max / unit;
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((s) => top / s <= 3) || Math.ceil(top / 3);
    const ceil = Math.ceil(top / step) * step;
    const W = 560, H = 150, L = 44, R = 6, T = 14, B = 22, pw = W - L - R, ph = H - T - B;
    const band = pw / days.length, bw = Math.min(24, band - 2);
    const y = (v) => T + ph - (v / unit / ceil) * ph;
    const peak = days.reduce((a, x) => (x.sold > a.sold ? x : a), days[0]);
    let grid = '', cols = '';
    for (let v = 0; v <= ceil; v += step) {
      const gy = T + ph - (v / ceil) * ph;
      grid += `<line class="${v ? 'grid' : 'axis'}" x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}"/><text x="${L - 6}" y="${gy + 4}" text-anchor="end">${v}${v ? ` ${word}` : ''}</text>`;
    }
    days.forEach((x, i) => {
      const cx = L + band * i + band / 2, h = x.sold > 0 ? Math.max(2, T + ph - y(x.sold)) : 0, by = T + ph - h, r = Math.min(4, h, bw / 2);
      const date = new Date(x.day);
      // rounded at the data end, square on the baseline
      const bar = h ? `<path class="bar" d="M${cx - bw / 2},${T + ph} V${by + r} Q${cx - bw / 2},${by} ${cx - bw / 2 + r},${by} H${cx + bw / 2 - r} Q${cx + bw / 2},${by} ${cx + bw / 2},${by + r} V${T + ph} Z"/>` : '';
      const label = i % 2 === (days.length - 1) % 2 ? `<text x="${cx}" y="${H - 6}" text-anchor="middle">${date.getDate()}</text>` : '';
      const value = x === peak ? `<text class="peak" x="${cx}" y="${by - 4}" text-anchor="middle">${esc(fmtValue(x.sold, t.divine))}</text>` : '';
      cols += `<g class="col" tabindex="0" data-day="${i}">${bar}${value}${label}<rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${ph + B}"/></g>`;
    });
    plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Value sold per day over the last ${days.length} days. The same trades are listed under Finished trades.">${grid}${cols}</svg>`;
    const show = (g) => {
      const x = days[Number(g.dataset.day)];
      tip.textContent = '';
      const head = document.createElement('b'); head.textContent = x.soldCount ? fmtValue(x.sold, t.divine) : 'Nothing sold';
      const when = document.createElement('span'); when.textContent = `${dayOf(x.day)}: ${x.soldCount} ${x.soldCount === 1 ? 'sale' : 'sales'}`;
      tip.append(head, when);
      if (x.boughtCount) { const b = document.createElement('span'); b.textContent = `Bought ${x.boughtCount} for ${fmtValue(x.bought, t.divine)}`; tip.append(b); }
      tip.hidden = false;
      const box = g.querySelector('.hit').getBoundingClientRect(), host = $('sales').getBoundingClientRect();
      const left = Math.max(0, Math.min(box.left - host.left + box.width / 2 - tip.offsetWidth / 2, host.width - tip.offsetWidth));
      tip.style.left = `${left}px`; tip.style.top = `${Math.max(0, box.top - host.top - tip.offsetHeight + 16)}px`;
    };
    for (const g of plot.querySelectorAll('.col')) {
      g.addEventListener('pointerenter', () => show(g));
      g.addEventListener('focus', () => show(g));
      g.addEventListener('pointerleave', () => { tip.hidden = true; });
      g.addEventListener('blur', () => { tip.hidden = true; });
    }
  }

  function renderTrade() {
    const t = state.trade, cfg = state.config.trade;
    if (!t || !cfg) return;
    const incoming = t.offers.filter((o) => o.dir === 'in');
    $('trade-dot').hidden = !incoming.length;
    const newest = incoming.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
    if (tradeSeen !== null && newest > tradeSeen && cfg.sound) beep();
    tradeSeen = Math.max(tradeSeen || 0, newest);

    const warn = $('trade-warn');
    const problems = [];
    if (!cfg.enabled) problems.push('Trade offers are switched off. Turn them on under Trade settings.');
    else if (!t.canSend) problems.push(`The buttons cannot type in the game: ${t.sendProblem || 'something is missing'}. Offers are still listed.`);
    if (t.afk) problems.push('You are marked AFK in game, so buyers get your auto-reply.');
    warn.hidden = !problems.length;
    warn.textContent = problems.join(' ');
    const hk = cfg.hotkeys;
    $('trade-hint').textContent = `Whispers from the trade site show up here${cfg.overlay ? ' and on top of the game' : ''}. The gold button is the next step${hk.next ? `; ${hk.next} presses it for the oldest offer` : ''}${hk.dismiss ? `, ${hk.dismiss} dismisses it` : ''}.${hk.layout ? ` ${hk.layout} opens layout mode, where you drag the overlay to a new spot.` : ''}`;
    const seen = t.seen || { whispers: 0, offers: 0 };
    $('trade-seen').textContent = !state.status.log.ok ? 'The game log is not connected, so no whispers can be read.'
      : seen.whispers ? `Since the app started: ${seen.whispers} ${seen.whispers === 1 ? 'whisper' : 'whispers'} read from the game log, ${seen.offers} of them trade offers. Last one at ${clock(seen.lastWhisperAt)}.`
        : 'No whispers read from the game log since the app started.';
    // Why the overlay is or is not on screen right now, so a problem can be told apart.
    const oi = t.overlayInfo || {}, hkOk = state.status.hotkeys;
    const keyState = (name, ok) => (name ? `${name} ${ok ? 'ready' : 'NOT available (another program or another copy of this app has it)'}` : '');
    const keysLine = [keyState(hk.next, hkOk.tradeNext), keyState(hk.dismiss, hkOk.tradeDismiss), keyState(hk.layout, hkOk.layout)].filter(Boolean).join(', ');
    $('trade-overlay-info').textContent = !cfg.enabled ? '' : `Overlay: ${!oi.on ? 'switched off in Trade settings'
      : oi.layoutOpen ? 'layout mode is open'
        : !oi.helper ? 'shown whenever there are offers (the app cannot tell which window is in front)'
          : oi.allowed ? `ready, window in front is "${oi.front}"` : `hidden, because the window in front is "${oi.front}" and not the game`}. Keys: ${keysLine || 'none set'}.`;
    $('btn-trade-clear').hidden = !t.offers.length;

    const box = $('trade-offers');
    const key = JSON.stringify([t.offers, t.divine]);
    if (key !== tradeDrawn) {
      tradeDrawn = key;
      box.innerHTML = t.offers.length
        ? t.offers.map((o) => TradeCard.cardHtml(o, { divine: t.divine, labels: t.labels })).join('')
        : '<p class="empty">No open offers. When someone whispers you about an item, it appears here with the buttons to invite, trade and thank them.</p>';
    }

    renderSales(t);
    const tot = t.totals, d = t.divine;
    const cell = (x, label) => `<div>${fmtValue(x.chaos, d)}<span>${label}: ${x.count} ${x.count === 1 ? 'trade' : 'trades'}${x.unpriced ? `, ${x.unpriced} without a known value` : ''}</span></div>`;
    $('trade-totals').innerHTML = cell(tot.soldToday, 'Sold today') + cell(tot.boughtToday, 'Bought today') + cell(tot.soldAll, 'Sold in total') + cell(tot.boughtAll, 'Bought in total');
    $('trade-history').innerHTML = t.history.length ? t.history.map((h) => `<tr>
      <td>${esc(dayOf(h.at))}, ${clock(h.at)}</td>
      <td><span class="kind ${h.dir === 'in' ? 'sold' : 'bought'}">${h.dir === 'in' ? 'Sold' : 'Bought'}</span></td>
      <td>${h.qty > 1 ? `${esc(h.qty)} × ` : ''}${esc(h.item)}</td>
      <td class="num">${h.price ? `${esc(h.price.amount)} ${esc(h.price.currency)}` : 'n/a'}</td>
      <td>${esc(h.player)}</td>
      <td><button type="button" class="link" data-act="tradeForget" data-id="${esc(h.id)}" aria-label="Remove this trade from the list">Remove</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Trades are listed here once the game reports "Trade accepted".</td></tr>';
  }

  function render() {
    if (!state) return;
    renderTrade();
    renderStatus(); renderAttention(); renderNow(); renderStrategies(); renderSession(); renderMapCheck(); renderCosts(); renderPriceCheck(); renderTradeCheck(); renderInventory(false); renderPrices(false); renderAccount();
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
    if (!first && s.tradeCheck && s.tradeCheck.at !== hadTrade && !s.tradeCheck.inGame) showTab('prices');
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
    for (const tab of order || []) { const b = byTab.get(tab); if (b) { sidenav.appendChild(b); byTab.delete(tab); } }
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

  function showTab(name) {
    for (const b of document.querySelectorAll('.sidenav .navi')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const id of ['mapping', 'inventory', 'items', 'trade', 'mapcheck', 'costs', 'prices']) $(`tab-${id}`).hidden = id !== name;
    if (name === 'inventory') renderInventory(true);
    if (name === 'items') { refreshKnown(); renderKnown(); }
    if (name === 'prices') renderPrices(true);
  }

  // ---- events ---------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-trade]');
    if (tb) { act(tb.dataset.trade === 'dismiss' && e.ctrlKey ? { type: 'tradeDismissAll' } : { type: 'trade', id: tb.dataset.id, do: tb.dataset.trade }); return; }
    if (e.target.closest('[data-open-account]')) { $('btn-account').click(); return; }
    const os = e.target.closest('[data-open-settings]');
    if (os) { $('btn-settings').click(); const f = $('settings-form').elements[os.dataset.openSettings]; if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } return; }
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
    const pick = e.target.closest('[data-session]');
    if (pick) { sessionSel = pick.dataset.session; expanded = null; renderSession(); return; }
    if (e.target.closest('[data-allitems]')) { allItems = !allItems; renderSession(); return; }
    const row = e.target.closest('[data-expand]');
    if (row) { expanded = expanded === row.dataset.expand ? null : row.dataset.expand; allItems = false; renderSession(); }
  });

  $('btn-read').addEventListener('click', () => act({ type: 'readInventory' }));
  $('btn-side-update').addEventListener('click', async () => {
    if (state.status.update.available) { act({ type: 'applyUpdate' }); return; }
    await act({ type: 'checkUpdate' });
    setTimeout(() => { if (state) renderStatus(); }, 8200); // lets "Up to date" fall back to the normal label
  });
  $('btn-diagnostic').addEventListener('click', () => { act({ type: 'saveDiagnostic' }); dlg.close(); });

  // ---- game log check -----------------------------------------------------------------
  // Shows whether the log file is being written to, the area lines that arrived and what the
  // tracker did with each, so "the map does not start" can be told apart into its causes.
  const logDlg = $('logcheck');
  let logTimer = null;
  let logText = '';
  const since = (ms) => (ms < 90000 ? `${Math.round(ms / 1000)} seconds ago` : ms < 5400000 ? `${Math.round(ms / 60000)} minutes ago` : `${Math.round(ms / 3600000)} hours ago`);
  async function renderLogCheck() {
    const d = await api.logCheck();
    const s = d.stats;
    const areaLines = d.trace.filter((t) => t.type === 'area');
    let verdict, bad = true;
    if (!d.path) verdict = 'No game log file is chosen. Pick Client.txt in Settings.';
    else if (!d.ok || !s) verdict = `The file cannot be read: ${d.error || 'unknown reason'}.`;
    else if (!s.lastGrowthAt) verdict = 'Nothing has been added to this file since the app started. Either the game is not running, or this is not the file the game writes to (an old or second install).';
    else if (!areaLines.length) verdict = 'The game is writing to this file, but no area line has arrived yet. Go through a door or portal in game and watch this window.';
    else if (areaLines[0].did && areaLines[0].did.startsWith('Nothing: the area name')) verdict = 'Area lines arrive, but the last area was not treated as a map. The table shows its internal name.';
    else { verdict = 'The log is being read and area lines are being acted on.'; bad = false; }
    $('logcheck-verdict').textContent = verdict;
    $('logcheck-verdict').className = `verdict ${bad ? 'danger' : 'safe'}`;
    const facts = [
      ['File', d.path || 'none'],
      ['File size', s ? `${(s.size / 1048576).toFixed(1)} MB` : 'n/a'],
      ['Last written to by the game', s && s.modifiedAt ? `${since(d.now - s.modifiedAt)}` : 'n/a'],
      ['Read by the app since it started', s ? `${s.lines} lines${s.lastGrowthAt ? `, last ${since(d.now - s.lastGrowthAt)}` : ''}` : 'n/a'],
      ['The tracker thinks you are', d.inMap ? `in a map (${d.mapName || 'unnamed'})` : `not in a map${d.location && d.location.code ? ` (last area: ${d.location.name || d.location.code}, kind: ${d.location.kind})` : ''}`],
    ];
    $('logcheck-facts').innerHTML = facts.map(([k, v]) => `<li><span>${esc(k)}</span><span></span><span class="val">${esc(v)}</span></li>`).join('');
    $('logcheck-rows').innerHTML = d.trace.length
      ? d.trace.map((t) => `<tr><td class="dim">${new Date(t.at).toLocaleTimeString()}</td><td class="mono">${esc(t.raw)}</td><td>${esc(t.did || '')}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">No area lines yet.</td></tr>';
    logText = `Map Companion game log check\n${verdict}\n${facts.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${d.trace.map((t) => `${new Date(t.at).toLocaleTimeString()} | ${t.raw} | ${t.did || ''}`).join('\n')}`;
  }
  $('btn-logcheck').addEventListener('click', () => {
    dlg.close();
    logDlg.showModal();
    renderLogCheck();
    clearInterval(logTimer);
    logTimer = setInterval(renderLogCheck, 1000);
  });
  logDlg.addEventListener('close', () => clearInterval(logTimer));
  $('btn-logcheck-close').addEventListener('click', () => logDlg.close());
  $('btn-logcheck-copy').addEventListener('click', () => act({ type: 'copyText', text: logText }));
  $('btn-shortcut').addEventListener('click', () => { act({ type: 'makeShortcut' }); dlg.close(); });
  $('btn-run-toggle').addEventListener('click', () => act({ type: currentRun() ? 'endRun' : 'startRun' }));
  $('btn-new-session').addEventListener('click', () => {
    if (!state.summary.runs.length || window.confirm('Start a new session? The current one is saved and stays in the row of sessions above the map list.')) act({ type: 'newSession' });
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
    const custom = !everywhere && priceCat === 'Custom';
    $('custom-price').hidden = !custom;
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
        <td class="num dim">${custom ? `<button type="button" class="link" data-act="removeCustomPrice" data-name="${esc(r.name)}">Remove</button>` : traded}</td></tr>`;
    }).join('') : `<tr><td colspan="4" class="empty">${query.trim() ? 'Nothing matches that name.' : (custom ? 'Set your own price for items poe.ninja does not list, such as special maps. Your price is used wherever the item is counted.' : 'No prices in this category yet.')}</td></tr>`;
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
  $('custom-price').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await act({ type: 'setCustomPrice', name: f.get('name'), chaos: f.get('chaos') });
    e.target.reset();
    priceStamp = '';
    renderPrices(true);
  });
  for (const id of ['price-search', 'price-global']) {
    $(id).addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderPriceRows, 150);
    });
  }

  // ---- strategy dialog: new, rename, atlas tree link, delete -------------------------
  const sdlg = $('strategy-dialog'), sform = $('strategy-form');
  let editing = null; // id being edited, or null for a new one
  function openStrategy(id) {
    const cur = id ? state.config.strategies.find((x) => x.id === id) : null;
    editing = cur ? cur.id : null;
    $('strategy-dialog-title').textContent = cur ? 'Edit strategy' : 'New strategy';
    sform.elements.name.value = cur ? cur.name : '';
    sform.elements.atlasUrl.value = cur ? cur.atlasUrl || '' : '';
    $('btn-strategy-delete').hidden = !cur || state.config.strategies.length < 2 || cur.id === state.config.activeStrategy;
    sdlg.showModal();
  }
  $('btn-strategy-cancel').addEventListener('click', () => sdlg.close());
  $('btn-strategy-delete').addEventListener('click', () => {
    const n = (state.sessions || []).filter((x) => x.strategyId === editing).length;
    if (!window.confirm(`Delete this strategy${n ? ` and its ${n} saved ${n === 1 ? 'session' : 'sessions'}` : ''}? This cannot be undone.`)) return;
    act({ type: 'deleteStrategy', id: editing });
    sdlg.close();
  });
  sform.addEventListener('submit', () => {
    const id = editing || `s${Date.now().toString(36)}`;
    if (!editing) stratSel = id; // show the new one straight away
    act({ type: 'saveStrategy', id, name: sform.elements.name.value, atlasUrl: sform.elements.atlasUrl.value });
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
    el.hkClip.value = c.hotkeys.clipboard;
    el.hkSnap.value = c.hotkeys.snapshot || '';
    el.hkPrice.value = c.hotkeys.priceCheck || '';
    el.autoCopy.checked = !!c.inventory.autoCopy;
    el.checkToast.checked = c.checkToast !== false;
    el.displayId.innerHTML = `<option value="">Main screen</option>${state.displays.map((d) => `<option value="${d.id}" ${String(d.id) === String(c.inventory.displayId) ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}`;
    el.invKey.value = c.inventory.key || 'Tab';
    el.onKey.checked = !!c.inventory.onKey;
    el.invAlerts.checked = c.inventory.alerts !== false;
    el.timed.checked = !!c.inventory.timed;
    el.intervalSec.value = (c.inventory.intervalMs || 1000) / 1000;
    $('rules').innerHTML = c.mapRules.map((r) => `<label><input type="checkbox" data-rule="${esc(r.id)}" ${r.enabled ? 'checked' : ''}> ${esc(r.label)}</label>`).join('');
    const sh = state.status.shared;
    $('shared-line').textContent = `${sh.count} pictures in the shared database.`
      + (sh.canUpload ? ` What you name is shared as ${sh.by}${sh.uploaded ? `: ${sh.uploaded} sent this session` : ''}${sh.waiting ? `, ${sh.waiting} waiting` : ''}.` : ' Log in (bottom of the sidebar) to share what you name with everyone.')
      + (sh.error ? ` Problem: ${sh.error}` : '');
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
      checkToast: el.checkToast.checked,
      logPath: el.logPath.value.trim(),
      hotkeys: { clipboard: el.hkClip.value.trim() || 'F8', snapshot: el.hkSnap.value.trim(), priceCheck: el.hkPrice.value.trim() },
      inventory: {
        displayId: el.displayId.value || null,
        key: el.invKey.value.trim() || 'Tab',
        onKey: el.onKey.checked,
        alerts: el.invAlerts.checked,
        autoCopy: el.autoCopy.checked,
        timed: el.timed.checked,
        intervalMs: Math.max(500, Math.round((Number(el.intervalSec.value) || 1) * 1000)),
      },
      mapRules: c.mapRules.map((r) => ({ ...r, enabled: enabled.has(r.id) })),
    });
  });

  // ---- account -------------------------------------------------------------------------
  // Registering is asked for once each time the app starts, until there is an account.
  const acc = $('account'), accForm = $('account-form');
  let accMode = 'register', accAsked = false, accBusy = false;
  const cloudOf = () => (state && state.status.cloud) || { enabled: false };
  const sentAgo = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `at ${clock(ts)}`; };
  function accError(text) { const e = $('account-error'); e.textContent = text || ''; e.hidden = !text; }
  function accView() {
    const c = cloudOf();
    accForm.hidden = c.signedIn; $('account-me').hidden = !c.signedIn;
    if (c.signedIn) {
      $('account-name').textContent = c.name;
      $('account-status').textContent = c.error ? `Uploading stopped: ${c.error} It is tried again by itself.`
        : c.busy ? `Uploading${c.waiting ? `, ${c.waiting} ${c.waiting === 1 ? 'session' : 'sessions'} to go` : ''}…`
        : c.waiting ? `${c.waiting} ${c.waiting === 1 ? 'session is' : 'sessions are'} waiting to go up.`
        : `Everything you finished is uploaded${c.sentAt ? ` (last one ${sentAgo(c.sentAt)})` : ''}. A session goes up when you press "Start new session".`;
      return;
    }
    const reg = accMode === 'register';
    $('account-title').textContent = reg ? 'Create your account' : 'Log in';
    $('account-lead').textContent = reg ? 'Pick the name other players will see your map runs under.' : 'Use the name and password you registered with.';
    $('account-again').hidden = !reg;
    accForm.elements.again.required = reg;
    accForm.elements.password.autocomplete = reg ? 'new-password' : 'current-password';
    $('account-go').textContent = accBusy ? 'One moment…' : (reg ? 'Create account' : 'Log in');
    $('account-go').disabled = accBusy;
    $('account-switch').textContent = reg ? 'I already have an account' : 'I need an account';
  }
  function renderAccount() {
    const c = cloudOf();
    $('btn-account').hidden = !c.enabled;
    if (!c.enabled) return;
    $('account-label').textContent = c.signedIn ? c.name : 'Log in';
    $('account-dot').hidden = !(c.signedIn && c.error);
    if (acc.open) accView();
    else if (!c.signedIn && !accAsked) { accAsked = true; accMode = 'register'; accError(''); accView(); acc.showModal(); }
  }
  $('btn-account').addEventListener('click', () => { accError(''); accView(); acc.showModal(); });
  $('account-later').addEventListener('click', () => acc.close());
  $('account-close').addEventListener('click', () => acc.close());
  $('account-switch').addEventListener('click', () => { accMode = accMode === 'register' ? 'login' : 'register'; accError(''); accView(); });
  accForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (accBusy) return;
    const el = accForm.elements;
    accBusy = true; accError(''); accView();
    const r = await api.account({ type: accMode, name: el.name.value, password: el.password.value, again: el.again.value });
    accBusy = false;
    if (r.error) { accError(r.error); accView(); return; }
    el.password.value = ''; el.again.value = '';
    accView();
  });
  $('account-logout').addEventListener('click', async () => { accAsked = true; accMode = 'login'; await api.account({ type: 'logout' }); accView(); });
  $('account-sync').addEventListener('click', () => api.account({ type: 'sync' }));
  $('account-delete-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, err = $('account-delete-error');
    const r = await api.account({ type: 'delete', password: f.elements.password.value });
    f.elements.password.value = '';
    err.textContent = r.error || ''; err.hidden = !r.error;
    if (!r.error) { f.parentElement.open = false; accMode = 'register'; accView(); }
  });

  // ---- trade settings -----------------------------------------------------------------
  const tradeForm = $('trade-form');
  const HOTKEY_FIELDS = [['hkInvite', 'invite'], ['hkTrade', 'trade'], ['hkBusy', 'busy'], ['hkStill', 'still'], ['hkWhisper', 'whisper'], ['hkHideout', 'hideout'], ['hkRemaining', 'remaining']];
  const AUTO_FIELDS = [['autoThankSold', 'thankSold'], ['autoKickSold', 'kickSold'], ['autoThankBought', 'thankBought'], ['autoLeaveBought', 'leaveBought'], ['autoHomeBought', 'homeBought'], ['autoJoinHideout', 'joinHideout'], ['autoIgnoreSold', 'ignoreSold']];
  $('trade-settings').addEventListener('toggle', (e) => {
    if (!e.target.open) return;
    const c = state.config.trade, el = tradeForm.elements;
    el.enabled.checked = !!c.enabled; el.overlay.checked = !!c.overlay; el.sound.checked = !!c.sound;
    el.hkNext.value = c.hotkeys.next || ''; el.hkDismiss.value = c.hotkeys.dismiss || ''; el.hkLayout.value = c.hotkeys.layout || '';
    for (const [field, key] of HOTKEY_FIELDS) el[field].value = c.hotkeys[key] || '';
    for (const [field, key] of AUTO_FIELDS) el[field].checked = !!(c.auto || {})[key];
    el.autoCloseSec.value = (c.auto || {}).closeBoughtSec || 0;
    el.msgThanks.value = c.messages.thanks; el.msgBusy.value = c.messages.busy; el.msgSold.value = c.messages.sold; el.msgStill.value = c.messages.still;
  });
  tradeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const el = tradeForm.elements;
    api.setConfig({ trade: {
      enabled: el.enabled.checked, overlay: el.overlay.checked, sound: el.sound.checked,
      hotkeys: { next: el.hkNext.value.trim(), dismiss: el.hkDismiss.value.trim(), layout: el.hkLayout.value.trim(), ...Object.fromEntries(HOTKEY_FIELDS.map(([field, key]) => [key, el[field].value.trim()])) },
      auto: { ...Object.fromEntries(AUTO_FIELDS.map(([field, key]) => [key, el[field].checked])), closeBoughtSec: Math.max(0, Math.min(600, Number(el.autoCloseSec.value) || 0)) },
      messages: { thanks: el.msgThanks.value.trim(), busy: el.msgBusy.value.trim(), sold: el.msgSold.value.trim(), still: el.msgStill.value.trim() },
    } });
    $('trade-settings').open = false;
  });
  setInterval(() => TradeCard.tick($('trade-offers')), 1000);

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
