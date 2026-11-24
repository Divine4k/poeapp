'use strict';
// Mapping page: status bar, the inventory picture kept per map, things that need you, the current map.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- status bar ----------------------------------------------------------
function renderStatus() {
  const st = state.status, hk = state.config.hotkeys, items = [];
  items.push(st.log.ok ? ['ok', 'Game log connected'] : ['bad', st.log.error || 'Game log not connected']);
  if (st.prices.loading) items.push(['busy', 'Loading prices']);
  else if (st.prices.count > 1) items.push(['ok', `${st.prices.count} prices for ${st.prices.league}, updated ${clock(st.prices.updatedAt)}`]);
  else items.push(['bad', st.prices.errors[0] || 'No prices loaded']);
  const inv = st.inventory, ic = state.config.inventory;
  if (inv.error) items.push(['bad', `Inventory reading failed: ${inv.error}`]);
  else if (inv.keyHook === 'missing' && ic.onKey && !ic.timed) items.push(['bad', 'Key listener not installed, so the inventory key is not noticed. Switch on "Also read it by itself" in Settings, under Loot counting, or use Read inventory now']);
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
  if (tc) {
    if (tc.hotkeys.layout && !st.hotkeys.layout) items.push(['bad', `Overlay key ${tc.hotkeys.layout} is taken by another app`]);
    if (tc.enabled && tc.hotkeys.next && !st.hotkeys.tradeNext) items.push(['bad', `Trade key ${tc.hotkeys.next} is taken by another app`]);
    for (const k of st.hotkeys.tradeTaken || []) items.push(['bad', `Key ${k} is taken by another app or is not a key name`]);
    if (tc.enabled && tc.hotkeys.dismiss && !st.hotkeys.tradeDismiss) items.push(['bad', `Trade key ${tc.hotkeys.dismiss} is taken by another app`]);
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
  if (c.carried) return `${c.name ? `${c.name} ×${c.qty}` : 'Single item'}: taken into the map with you, not loot. Click if it is loot from this map.`;
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
      if (c && c.carried && data.runId) {
        // Dimmed: one click counts it as loot after all.
        const what = c.name ? `${c.carriedQty > 1 ? `${c.carriedQty} ` : ''}${c.name}` : 'this item';
        cells += `<i class="${esc(c.status)} carried fixable" data-act="markLoot" data-id="snap:${t.trip}:${c.cell}" data-run="${esc(data.runId)}" data-confirm="${esc(`Count ${what} as loot from this map?`)}" title="${esc(snapTip(c, divine))}"></i>`;
        continue;
      }
      cells += c ? `<i class="${esc(c.status)}${c.carried ? ' carried' : ''}${fixable ? ' fixable' : ''}"${fixable ? ` data-fix="snap:${t.trip}:${c.cell}" data-run="${esc(data.runId)}"` : ''} title="${esc(snapTip(c, divine))}${fixable ? ' Click to correct.' : ''}"></i>` : '<i></i>';
    }
    const brought = t.cells.some((c) => c.carried);
    const which = total > 1 ? `Inventory ${n} of ${total}${compact && n === total ? ' (latest)' : ''}, ` : 'Inventory ';
    // The explanation of the dimmed slots is given once, on the first picture shown.
    const legend = brought && (!compact || i === trips.findIndex((x) => x.t.cells.some((c) => c.carried)));
    // In a map's details the legend line explains the colours, so the caption stays short.
    const caption = (compact
      ? `${which}at ${clock(t.at)}.${legend ? ' <span class="xkey">Dimmed slots</span>: taken into the map with you, not loot.' : ''}`
      : `${total > 1 ? `Inventory ${n} of ${total}, ` : ''}${clock(t.at)}`)
      + (t.stale && brought ? ' <span class="stale">Your inventory was not seen after the trip before, so some dimmed slots may be loot. Click one to count it.</span>' : '');
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
let fixTarget = null, lootTarget = null;
function openFix(id, runId) {
  const [where, x, y] = id.split(':');
  let pic = '', now = '', options = [];
  $('fix-remove').hidden = true;
  $('fix-loot').hidden = true;
  lootTarget = null;
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
    if (c.carriedQty > 0 && c.name) {
      now += ` ${c.carriedQty} of them were taken to be in your inventory before the map.`;
      lootTarget = { type: 'markLoot', id, runId };
      $('fix-loot').textContent = `Count those ${c.carriedQty} as loot too`;
      $('fix-loot').hidden = false;
    }
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
$('fix-loot').addEventListener('click', () => { if (lootTarget) act(lootTarget); lootTarget = null; fixTarget = null; $('fix').close(); });
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
      : invC.onClick && invS.keyHook === 'ok'
        ? `Back from the map: open your inventory (${invC.key}) and stash as usual. Each click is followed by one read, so the loot is counted and the app sees what you take back in.`
        : `Back from the map: press ${invC.key} before you stash anything, or the loot from this map is not counted. To have this happen by itself, switch on "Also read it by itself" in Settings, under Loot counting.`;
  } else arr.hidden = true;

  const n = state.notice, note = $('notice');
  if (n && Date.now() - n.at < 30000) { note.hidden = false; note.className = n.bad ? 'notice bad' : 'notice'; note.textContent = n.text; }
  else note.hidden = true;

  renderItems();
}
