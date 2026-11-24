'use strict';
// Mapping page: status bar, the inventory picture kept per map, things that need you, the current map.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- status bar ----------------------------------------------------------
// Short chips across the top. Each says one thing at a glance; its hover text says the rest,
// and a click goes where it can be fixed or refreshed. Things that are fine and need no
// attention (item pictures known, the Divine price) are left out.
function statusChips() {
  const st = state.status, c = state.config, hk = c.hotkeys, chips = [];
  const chip = (cls, label, tip, go) => chips.push({ cls, label, tip, go });
  const g = st.game || {};
  if (g.known) chip(g.front ? 'ok' : '', 'Game', g.front ? 'Path of Exile is the window in front, so the check keys work.' : 'Path of Exile is not the window in front. The price check and hideout keys only work while it is.', null);
  if (st.log.ok) chip('ok', 'Game log', `Reading ${st.log.path || 'the game log'}. Click for the game log check.`, 'logcheck');
  else chip('bad', 'Game log not found', `${st.log.error || 'The game log is not connected'}. Click to choose Client.txt.`, 'set:general');
  const pr = st.prices, old = pr.updatedAt && Date.now() - pr.updatedAt > 2 * 3600000;
  if (pr.loading) chip('busy', 'Prices…', 'Loading prices from poe.ninja.', null);
  else if (pr.count > 1) chip(old ? 'busy' : 'ok', `Prices · ${pr.league}`, `${pr.count.toLocaleString()} prices for ${pr.league} from poe.ninja, updated at ${clock(pr.updatedAt)}.${old ? ' They are more than two hours old.' : ''} Click to refresh.`, 'prices');
  else chip('bad', 'No prices', `${pr.errors[0] || 'No prices loaded'}. Click to try again.`, 'prices');
  const inv = st.inventory, ic = c.inventory;
  if (inv.error) chip('bad', 'Inventory', `Reading the inventory failed: ${inv.error}`, 'tab:inventory');
  else if (inv.keyHook === 'missing' && ic.onKey && !ic.timed) chip('bad', 'Inventory key', 'The key listener is not installed, so your inventory key is not noticed. Switch on "Also read it by itself" in Settings, Loot counting, or use Read inventory now.', 'set:loot');
  else if (inv.keyHook === 'badkey') chip('bad', 'Inventory key', `"${ic.key}" is not a key name the app knows. Click to choose it again.`, 'set:keys');
  else if (inv.lastReadAt) chip('ok', `Inventory · ${clock(inv.lastReadAt)}`, `Last read at ${clock(inv.lastReadAt)}: ${inv.recognised} item stacks recognised. Click to see it.`, 'tab:inventory');
  else chip('', 'Inventory', `Not read yet. Open your inventory in game (${ic.key}).`, 'tab:inventory');
  const art = inv.art;
  if (art.total > art.done) chip('busy', `Pictures ${art.done}/${art.total}`, 'Learning item pictures from poe.ninja.', null);
  else if (art.failed && !art.known) chip('bad', 'Item pictures', `${art.failed} item pictures failed to download.`, null);
  else if (!art.known && pr.count > 1) chip('bad', 'Item pictures', 'Prices loaded but no item pictures came with them.', null);
  // Every key problem in one chip.
  const keys = [];
  if (!st.hotkeys.clipboard) keys.push(`${hk.clipboard} (check and count) is taken by another program`);
  if (st.hotkeys.priceCheckHeld && !st.hotkeys.priceCheck) keys.push(`${hk.priceCheck} (price check) is taken by another program or is not a key name`);
  if (hk.snapshot && !st.hotkeys.snapshot) keys.push(`${hk.snapshot} (report) is taken by another program`);
  const tc = c.trade;
  if (tc) {
    if (tc.hotkeys.layout && !st.hotkeys.layout) keys.push(`${tc.hotkeys.layout} (move the overlay) is taken by another program`);
    if (tc.enabled && tc.hotkeys.next && !st.hotkeys.tradeNext) keys.push(`${tc.hotkeys.next} (next trade step) is taken by another program`);
    if (tc.enabled && tc.hotkeys.dismiss && !st.hotkeys.tradeDismiss) keys.push(`${tc.hotkeys.dismiss} (dismiss offer) is taken by another program`);
    for (const k of st.hotkeys.tradeTaken || []) keys.push(`${k} is taken by another program or is not a key name`);
  }
  if (keys.length) chip('bad', `${keys.length} ${keys.length === 1 ? 'key' : 'keys'} not working`, `${keys.join('.\n')}.\nClick to change them.`, 'set:keys');
  else chip('ok', 'Keys', `Every key works: price check ${hk.priceCheck || 'not set'}, check and count ${hk.clipboard}. Click to change them.`, 'set:keys');
  const offers = (state.trade && state.trade.offers || []).filter((o) => !o.test).length;
  if (tc && tc.enabled && offers) chip('busy', `${offers} trade ${offers === 1 ? 'offer' : 'offers'}`, 'Open trade offers. Click to see them.', 'tab:trade');
  const cl = st.cloud || {};
  if (cl.enabled && cl.signedIn && cl.error) chip('bad', 'Upload stopped', `${cl.error} It is tried again by itself. Click for your account.`, 'account');
  else if (cl.enabled && cl.signedIn && cl.waiting) chip('busy', `${cl.waiting} to upload`, `${cl.waiting} finished ${cl.waiting === 1 ? 'session is' : 'sessions are'} waiting to go up.`, 'account');
  return chips;
}
// When nothing is wrong, the fine ones fold into one "All working" chip (its hover text lists
// them). Anything wrong shows on its own with a Fix button; things under way (prices loading,
// trade offers) show beside it.
function renderStatus() {
  const all = statusChips();
  const bad = all.filter((x) => x.cls === 'bad'), busy = all.filter((x) => x.cls === 'busy');
  const fine = all.filter((x) => x.cls === 'ok' || x.cls === '');
  const shown = bad.length ? [...bad, ...busy] : [{ cls: 'ok all', label: 'All working', tip: fine.map((x) => `${x.label}: ${x.tip.replace(/ Click.*$/, '')}`).join('\n'), go: null }, ...busy];
  setHtml($('status'), shown.map((x) => `<li><${x.go ? `button type="button" data-go="${x.go}"${x.go === 'logcheck' ? ' data-logcheck' : ''}` : 'span'} class="chip ${x.cls}" title="${esc(x.tip)}">${esc(x.label)}${x.cls === 'bad' && x.go ? '<em>Fix</em>' : ''}</${x.go ? 'button' : 'span'}></li>`).join(''));
  renderUpdate();
}
$('status').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b) return;
  const go = b.dataset.go;
  if (go === 'prices') act({ type: 'refreshPrices' });
  // 'logcheck' is opened by the game log check's own click handler (data-logcheck).
  else if (go === 'account') $('btn-account').click();
  else if (go.startsWith('tab:')) showTab(go.slice(4));
  else if (go.startsWith('set:')) { showTab('settings'); showSettings(go.slice(4)); }
});

// ---- the update button at the bottom of the sidebar ---------------------------------
// It always says what it is doing: checking, up to date, install, downloading, restarting, or
// what went wrong. A click shows its new state at once, before the app has answered.
let updPressed = 0;   // when "Check for updates" was clicked
let updInstall = 0;   // when "Install update" was clicked
let updTimer = null;
function updateLook() {
  const up = state.status.update, now = Date.now();
  if (up.applying || (updInstall && now - updInstall < 3000 && !up.error)) {
    const step = up.step || 'Downloading';
    return { cls: 'busy', label: step === 'Restarting' ? 'Restarting…' : /Installing/.test(step) ? 'Installing…' : 'Downloading…', sub: step === 'Restarting' ? 'Back in a moment' : 'Keep the app open', busy: true, tip: step };
  }
  if (up.checking || (updPressed && now - updPressed < 600)) return { cls: 'busy', label: 'Checking…', sub: 'Asking GitHub', busy: true, tip: '' };
  if (up.error) return { cls: 'bad', label: up.available ? 'Install failed' : 'Check failed', sub: 'Click to try again', tip: up.error };
  if (up.available) return { cls: 'has-update', label: 'Install update', sub: up.latest.message, tip: `New: ${up.latest.message}. The app closes and opens again by itself.` };
  if (updPressed && up.checkedAt >= updPressed - 1000 && now - up.checkedAt < 5000) return { cls: 'done', label: 'Up to date', sub: 'You have the newest version', tip: '' };
  return { cls: '', label: 'Check for updates', sub: up.checkedAt ? `Checked at ${clock(up.checkedAt)}` : '', tip: up.current ? `Installed: ${up.current.message}` : '' };
}
function renderUpdate() {
  const look = updateLook(), btn = $('btn-side-update'), up = state.status.update;
  btn.className = `navi upd ${look.cls}`;
  // The narrow sidebar has room for one word under the icon.
  btn.dataset.short = look.busy ? (look.label === 'Checking…' ? 'Checking' : 'Updating') : look.cls === 'has-update' ? 'Update' : look.cls === 'done' ? 'Up to date' : look.cls === 'bad' ? 'Failed' : 'Updates';
  btn.disabled = !!look.busy;
  btn.setAttribute('aria-busy', String(!!look.busy));
  $('side-update-icon').classList.toggle('spin', !!look.busy);
  $('side-update-label').textContent = look.label;
  $('side-update-sub').textContent = look.sub;
  btn.title = look.tip;
  const line = $('version-line');
  if (line) {
    const cur = up.current ? `Installed version ${up.current.sha.slice(0, 7)} (${up.current.message}).` : 'Installed from a download, so the exact version is not known yet. Install the update once to fix that.';
    const chk = up.checkedAt ? ` Last checked at ${clock(up.checkedAt)}${up.available ? '' : ': up to date'}.` : '';
    line.textContent = cur + chk;
  }
  // "Checking…" and "Up to date" change by time alone, so they are drawn again without a new state.
  clearTimeout(updTimer);
  if (look.busy || look.cls === 'done') updTimer = setTimeout(() => { if (state) renderUpdate(); }, 400);
}

// ---- messages from the app: small toasts at the bottom right --------------------------
// Each message shows once, for a few seconds (longer when something went wrong), and stays
// while the mouse is on it.
let toastSeen = 0;
function renderToasts() {
  const n = state.notice;
  if (!n || n.at <= toastSeen) return;
  toastSeen = n.at;
  if (Date.now() - n.at > 30000) return; // an old message brought by the first state
  const box = $('toasts');
  for (const t of box.querySelectorAll('.toast')) if (t.dataset.text === n.text) t.remove();
  const t = document.createElement('div');
  t.className = `toast${n.bad ? ' bad' : ''}`;
  t.dataset.text = n.text;
  t.setAttribute('role', n.bad ? 'alert' : 'status');
  t.innerHTML = `<span>${esc(n.text)}</span><button type="button" class="link" aria-label="Close">×</button>`;
  box.prepend(t);
  while (box.children.length > 3) box.lastElementChild.remove();
  const ms = n.bad ? 9000 : 5000;
  let timer = setTimeout(() => closeToast(t), ms);
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', () => { timer = setTimeout(() => closeToast(t), 2500); });
  t.querySelector('button').addEventListener('click', () => closeToast(t));
}
function closeToast(t) { t.classList.add('gone'); setTimeout(() => t.remove(), 250); }

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

// ---- back from a map: one short line above the current map --------------------
// Says what to do so this map's loot is counted. Red only when something must be done
// (press the key, open the inventory once); otherwise it is a reminder. Closed with its cross
// until the next time it is needed.
let arrivalClosed = '';
function arrivalNote() {
  const invS = state.status.inventory, invC = state.config.inventory, key = esc(invC.key);
  if (invS.noBaseline) return { id: 'base', bad: true, text: `Open your inventory once (<b>${key}</b>) so the app knows what you already carry.`, tip: 'The app has not seen your inventory yet, so it cannot tell what is new. Do this in your hideout, before the next map.' };
  if (!invS.awaitingArrival) return null;
  const id = `back:${state.summary.currentId || ''}`;
  if (invC.timed) return { id, bad: false, text: 'Back from the map: open your stash or inventory to count the loot.', tip: 'Keep the mouse off the inventory for a second while it is read.' };
  if (invC.onClick && invS.keyHook === 'ok') return { id, bad: false, text: `Back from the map: open your inventory (<b>${key}</b>) and stash as usual.`, tip: 'Each click is followed by one read, so the loot is counted and the app sees what you take back in.' };
  return { id, bad: true, text: `Back from the map: press <b>${key}</b> before you stash, or this map's loot is not counted.`, tip: 'To have this happen by itself, switch on "Also read it by itself" in Settings, Loot counting.' };
}
function renderArrival() {
  const a = arrivalNote(), box = $('arrival');
  const show = a && a.id !== arrivalClosed;
  box.hidden = !show;
  if (!show) return;
  box.className = `arrival${a.bad ? ' bad' : ''}`;
  box.title = a.tip;
  setHtml(box, `<span>${a.text}</span><button type="button" class="link" data-arrival-close aria-label="Hide this note">×</button>`);
  box.dataset.id = a.id;
}
$('arrival').addEventListener('click', (e) => {
  if (!e.target.closest('[data-arrival-close]')) return;
  arrivalClosed = $('arrival').dataset.id;
  $('arrival').hidden = true;
});

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
        <span class="it"><img src="${esc(u.image)}" alt=""></span>
        <div><p><b>What is this?</b> Stack of ${u.qty}, not counted until you say.</p>
        <div class="chips">${u.guesses.map((g) => `<button type="button" data-act="learn" data-id="${u.id}" data-name="${esc(g.name)}" title="${g.score}% alike">${esc(g.name)}</button>`).join('')}
          <button type="button" class="other" data-fix="unknown:${u.id}">Something else…</button>
          <button type="button" class="link" data-act="ignore" data-id="${u.id}" title="Never count or ask about this item again">Ignore</button></div></div></li>`).join('')
    + doubts.map((d) => `<li>
        <span class="it"><img src="${esc(d.image)}" alt=""></span>
        <div><p><b>Is this right?</b> Counted as ${esc(d.name)}${d.qty > 1 ? ` ×${d.qty}` : ''}, but it looks much like ${esc(d.options.join(' or ') || 'another item')}.</p>
        <div class="chips">${[d.name, ...d.options].map((name, i) => `<button type="button"${i ? '' : ' class="yes"'} data-act="fixSlot" data-id="${esc(d.id)}" data-name="${esc(name)}">${i ? '' : '✓ '}${esc(name)}</button>`).join('')}
          <button type="button" class="other" data-fix="${esc(d.id)}">Something else…</button></div></div></li>`).join('');
  box.innerHTML = `<div class="p-head"><h2 class="needs">${n === 1 ? 'One item needs a look' : `${n} items need a look`}</h2></div><ul>${cards}</ul>
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
// Pictures of maps (src/ui/maps), shown behind the map card while you run that map. Add a
// picture there and a line here: its file, and how bright it is from 0 (dark) to 1 (sand, snow).
// Bright ones get a darker veil so the white numbers on them stay readable.
const MAP_PICTURES = {
  Strand: ['maps/strand.jpg', 0.2],
  Dunes: ['maps/dunes.jpg', 0.6],
};
const mapPicture = (name) => MAP_PICTURES[String(name || '').replace(/ Map$/, '')] || null;

// How long a map usually takes you: that map in every saved session, and the ones already
// finished in this session.
function usualMs(name) {
  let n = 0, ms = 0;
  for (const x of state.sessions || []) { const m = x.mapTimes && x.mapTimes[name]; if (m) { n += m.n; ms += m.ms; } }
  for (const r of state.summary.runs) if (r.name === name && r.id !== state.summary.currentId && r.durationMs >= 30000) { n++; ms += r.durationMs; }
  return n ? ms / n : 0;
}

// Whether this map's mods were checked (the check key on the map before you ran it), and how
// that went. Only the answer shows here; the mods themselves are on the Map check page.
function mapSafety(run) {
  const mc = state.mapCheck;
  if (!mc || !run || String(mc.name || '').replace(/ Map$/, '') !== run.name) return null;
  if (mc.at < (run.startedAt || 0) - 30 * 60000) return null; // checked long before: another copy of the map
  if (!mc.dangerCount) return { ok: true, text: '✓ Safe to run', tip: 'None of the mods you ticked on the Map check page.' };
  const bad = (mc.mods || []).filter((m) => m.dangerous).map((m) => (m.labels && m.labels.length ? m.labels.join(', ') : m.mod));
  return { ok: false, text: `⚠ ${mc.dangerCount} ${mc.dangerCount === 1 ? 'bad mod' : 'bad mods'}`, tip: bad.join('\n') };
}

// A value split into its number and unit, so the number can be big: "+1.44" and "div".
function bigValue(c, signed = true) {
  const m = /^(-?)([\d.]+)\s*(div|c)$/.exec(fmtValue(c));
  if (!m) return esc(fmtValue(c));
  const sign = m[1] ? '−' : (signed && c > 0 ? '+' : '');
  return `<b>${sign}${m[2]}</b><span>${m[3]}</span>`;
}
// How far into its usual time the map is, as a thin bar (SVG: the page allows no style attributes).
const paceBar = (frac) => `<svg class="usual-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="bg" width="100" height="4" rx="2"/><rect class="fg" id="usual-fill" width="${Math.round(Math.min(1, frac) * 100)}" height="4" rx="2"/></svg>`;

// The big clock on the map card: minutes, seconds and thousandths.
// Drawn on every screen refresh while the map runs (start.js), so the thousandths roll.
function drawClock(ms) {
  const t = $('timer');
  if (!t) return;
  const main = fmtTime(ms), frac = `.${String(Math.floor(Math.max(0, ms)) % 1000).padStart(3, '0')}`;
  if (t.dataset.main !== main) { t.dataset.main = main; t.innerHTML = `${main}<span class="ms"></span>`; }
  t.lastChild.textContent = frac;
}

function renderNow() {
  const run = currentRun();
  const toggle = $('btn-run-toggle');
  toggle.textContent = run ? 'End map' : 'Start a map manually';
  toggle.classList.toggle('primary', !!run);

  // The map's picture behind the card (set through the style object: no inline style attributes).
  const pic = run && mapPicture(run.name), ph = $('mc-photo');
  $('mapcard').classList.toggle('has-photo', !!pic);
  if (ph.dataset.pic !== (pic ? pic[0] : '')) {
    ph.dataset.pic = pic ? pic[0] : '';
    ph.style.setProperty('--photo', pic ? `url("${pic[0]}")` : 'none');
    ph.style.setProperty('--shade', String(pic ? pic[1] : 0));
  }

  if (!run) {
    setHtml($('now-name'), '<div class="eb idle">Not in a map</div><div class="map-name">Waiting for a map</div><div class="map-meta">Enter a map and the timer starts by itself.</div>');
    setHtml($('now-time'), '<small>Time</small><div class="clock" id="timer"></div>');
    setHtml($('now-net'), '');
    drawClock(0);
  } else {
    const paused = run.segmentStart === null;
    const strats = state.config.strategies || [];
    const running = strats.find((x) => x.id === state.config.activeStrategy);
    const safe = mapSafety(run);
    const meta = [run.level ? `Area level ${run.level}` : '', strats.length > 1 && running ? `counted under ${esc(running.name)}` : '', run.deaths ? `${run.deaths} ${run.deaths === 1 ? 'death' : 'deaths'}` : ''].filter(Boolean);
    setHtml($('now-name'), `<div class="eb ${paused ? 'paused' : ''}">${paused ? 'Paused while you are out of the map' : 'In map'}${safe ? `<span class="safe ${safe.ok ? '' : 'bad'}" title="${esc(safe.tip)}">${esc(safe.text)}</span>` : ''}</div>
        <div class="map-name">${esc(run.name)}</div><div class="map-meta">${meta.join(' · ')}</div>`);
    const live = liveDuration(run), usual = usualMs(run.name);
    setHtml($('now-time'), `<small>Time</small><div class="clock ${paused ? 'paused' : ''}" id="timer"></div>
        ${usual ? `<div class="note" title="Your average for ${esc(run.name)}">${paceBar(live / usual)}usual ${fmtTime(usual)}</div>` : ''}`);
    drawClock(live);
    const hours = live / 3600000;
    const pace = hours > 1 / 60 && run.net > 0 ? `on pace for ${fmtValue(run.net / hours)} / hour` : `${fmtValue(run.lootValue)} loot · ${fmtValue(run.costValue)} costs`;
    setHtml($('now-net'), `<small>Net this map</small><div class="money ${run.net < 0 ? 'neg' : ''}">${bigValue(run.net)}</div><div class="note" title="Loot ${esc(fmtValue(run.lootValue))}, costs ${esc(fmtValue(run.costValue))}">${pace}</div>`);
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
  setHtml($('now-uncounted'), run ? uncountedLine(run, true) : '');

  // One line per item, most valuable first.
  const feed = $('feed');
  const n = run ? run.items.length : 0;
  $('loot-title').innerHTML = run && n ? `Loot this map <small>${n} ${n === 1 ? 'item' : 'items'} · worth ${esc(fmtValue(run.lootValue))}</small>` : 'Loot this map';
  const divine = state.summary.divine || 0;
  const html = !run || !n
    ? `<li class="empty">${run ? `No loot yet. Open your inventory (${esc(state.config.inventory.key)}) after picking things up.` : 'Loot shows up here once a map is running.'}</li>`
    : run.items.map((l) => `<li>
        <span class="it${divine && l.chaos >= divine ? ' g-gold' : ''}">${l.icon ? `<img src="${esc(l.icon)}" alt="" loading="lazy">` : ''}</span>
        <span class="nm"><b>${esc(l.name)}</b><small>×${l.qty}${l.byHand ? ' · added by hand' : ''}</small></span>
        <span class="val ${l.chaos > 0 ? '' : 'dim'}">${l.chaos > 0 ? fmtValue(l.chaos) : 'no price'}</span>
        <button type="button" class="link x" data-act="removeLootName" data-run="${esc(run.id)}" data-name="${esc(l.name)}" title="Remove from this map's loot" aria-label="Remove ${esc(l.name)}">×</button></li>`).join('');
  setHtml(feed, html);
  renderBestDrops();
  renderItems();
}

// The most valuable drops of the session, over all its maps. Only once there is more than one map.
function renderBestDrops() {
  const box = $('best-drops'), runs = state.summary.runs;
  const by = new Map();
  for (const r of runs) for (const i of r.items) {
    if (!(i.chaos > 0)) continue;
    const e = by.get(i.name) || { name: i.name, qty: 0, chaos: 0, icon: i.icon, maps: new Set() };
    e.qty += i.qty; e.chaos += i.chaos; e.icon = e.icon || i.icon; e.maps.add(r.name);
    by.set(i.name, e);
  }
  const top = [...by.values()].sort((a, b) => b.chaos - a.chaos).slice(0, 3);
  box.hidden = runs.length < 2 || !top.length;
  if (box.hidden) return;
  const divine = state.summary.divine || 0;
  setHtml(box, `<div class="p-head"><h2>Best drops this session</h2></div><ul class="feed drops">${top.map((e) => `<li>
      <span class="it${divine && e.chaos >= divine ? ' g-gold' : ''}">${e.icon ? `<img src="${esc(e.icon)}" alt="" loading="lazy">` : ''}</span>
      <span class="nm"><b>${esc(e.name)}</b><small>×${e.qty} · ${esc([...e.maps].slice(0, 3).join(', '))}</small></span>
      <span class="val">${fmtValue(e.chaos)}</span></li>`).join('')}</ul>`);
}
