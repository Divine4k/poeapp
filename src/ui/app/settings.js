'use strict';
// Settings page and the Keys list (KEY_GROUPS).
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- settings ---------------------------------------------------------------------
// One page with its sections on the left. Nothing waits for a Save button: a change goes to
// the app as it is made, and the page always shows what the app holds.
const setPage = $('tab-settings');
const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const patchOf = (path, value) => path.split('.').reduceRight((v, k) => ({ [k]: v }), value);
// Switches that are on unless they were switched off: settings saved before they existed hold nothing for them.
const ON_UNLESS_OFF = new Set(['checkToast', 'inventory.alerts', 'priceSearch.auto', 'priceSearch.overlay']);
// Fields shown in another unit than they are kept in, or kept within limits.
const FIELDS = {
  'inventory.intervalMs': { show: (v) => (Number(v) || 1000) / 1000, read: (el) => Math.max(500, Math.min(30000, Math.round((Number(el.value) || 1) * 1000))) },
  'trade.auto.closeBoughtSec': { show: (v) => Number(v) || 0, read: (el) => Math.max(0, Math.min(600, Math.round(Number(el.value) || 0))) },
  'inventory.displayId': { show: (v) => (v == null ? '' : v), read: (el) => el.value || null },
};
let savedTimer = null;
function saveSetting(path, value) {
  api.setConfig(patchOf(path, value));
  $('set-saved').hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('set-saved').hidden = true; }, 1500);
}
setPage.addEventListener('change', (e) => {
  const el = e.target.closest('[data-cfg]');
  if (!el) return;
  const path = el.dataset.cfg, field = FIELDS[path];
  if (el.type === 'checkbox') { saveSetting(path, el.checked); return; }
  const value = field ? field.read(el) : el.value.trim();
  if (field && el.tagName === 'INPUT') el.value = field.show(value); // what was typed, brought within its limits
  saveSetting(path, value);
});

let setSec = 'general';
function showSettings(sec) {
  if (sec && $(`set-${sec}`)) setSec = sec;
  stopListening();
  for (const b of $('set-nav').querySelectorAll('[data-set]')) b.setAttribute('aria-pressed', String(b.dataset.set === setSec));
  for (const x of setPage.querySelectorAll('.set-sec')) x.hidden = x.id !== `set-${setSec}`;
  $('set-main').scrollTop = 0;
  renderSettings();
}
$('set-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-set]'); if (b) showSettings(b.dataset.set); });

const keyText = (v) => (v ? Keys.pretty(v) : 'no key set');
function renderSettings() {
  if (!state || setPage.hidden) return;
  const c = state.config, st = state.status;
  // The lists to choose from come first, so that the choice can be shown in them.
  const leagues = state.leagues.length ? state.leagues : (c.league ? [{ id: c.league, name: c.league }] : []);
  setHtml(setPage.querySelector('[data-cfg="league"]'), leagues.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join(''));
  setHtml(setPage.querySelector('[data-cfg="inventory.displayId"]'), `<option value="">Main screen</option>${(state.displays || []).map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('')}`);
  for (const el of setPage.querySelectorAll('[data-cfg]')) {
    const path = el.dataset.cfg, v = getPath(c, path);
    if (el.type === 'checkbox') { el.checked = ON_UNLESS_OFF.has(path) ? v !== false : !!v; continue; }
    if (el === document.activeElement && el.tagName === 'INPUT') continue; // being typed in
    const shown = String(FIELDS[path] ? FIELDS[path].show(v) : (v == null ? '' : v));
    if (el.value !== shown) el.value = shown;
  }
  const pr = st.prices;
  $('set-prices-line').textContent = pr.loading ? 'Loading prices from poe.ninja…'
    : pr.count > 1 ? `${pr.count.toLocaleString()} prices from poe.ninja for ${pr.league}, updated at ${clock(pr.updatedAt)}. They are refreshed every half hour.`
      : (pr.errors[0] || 'No prices loaded yet.');
  $('btn-refresh-prices').disabled = !!pr.loading;
  $('set-log-line').textContent = st.log.ok ? 'Connected. The map timer, deaths and trade whispers are read from this file.' : (st.log.error || 'Not connected.');
  $('set-log-line').classList.toggle('bad', !st.log.ok);
  setPage.querySelector('[data-cfg="logPath"]').placeholder = st.log.path || 'Found automatically';
  $('set-interval-row').hidden = !c.inventory.timed;
  $('set-trade-off').hidden = !!c.trade.enabled;
  $('set-shortcut-row').hidden = !!state.packaged; // the installer already made the shortcuts
  for (const el of setPage.querySelectorAll('[data-keyname]')) el.textContent = keyText(getPath(c, el.dataset.keyname));
  // An emptied message falls back on the app's own wording, shown in the empty field.
  const fallback = (state.trade && state.trade.defaultMessages) || {};
  for (const el of setPage.querySelectorAll('[data-cfg^="trade.messages."]')) el.placeholder = fallback[el.dataset.cfg.split('.').pop()] || '';
  // Why the overlay is or is not on screen right now, so a problem can be told apart.
  const oi = (state.trade && state.trade.overlayInfo) || null;
  $('overlay-info').textContent = !oi ? '' : `Right now: ${oi.layoutOpen ? 'layout mode is open'
    : !oi.helper ? 'the app cannot tell which window is in front on this PC, so the overlay shows whenever there is something to show'
      : oi.allowed ? `the overlay can show; the window in front is "${oi.front}"` : `the overlay is hidden, because the window in front is "${oi.front}" and not the game`}.`;
  renderKeys();
}

// Every key the app uses, in one list. id: where the key is kept in the settings.
// needed: cannot be left without a key. game: a key of the game itself that the app only
// listens for. bad(status, key): the key could not be taken; without it, the list of taken keys says.
const KEY_GROUPS = [
  { title: 'Checking items', keys: [
    { id: 'hotkeys.priceCheck', name: 'Price check', hint: 'Hover an item in game and press it to see what the item is worth. Gear is looked up on the trade site. Only held while the game is the window in front.',
      bad: (st) => st.hotkeys.priceCheckHeld && !st.hotkeys.priceCheck },
    { id: 'hotkeys.clipboard', name: 'Check and count', needed: true, hint: 'The same check, and more: over your inventory it also counts the item as loot, or names one the app did not recognise. On a map it checks the mods.',
      bad: (st) => !st.hotkeys.clipboard },
    { id: 'inventory.key', name: 'Your inventory key in game', needed: true, game: true, hint: 'The key that opens your inventory in the game. The app only listens for it, to read your inventory once each time you press it.',
      bad: (st) => st.inventory.keyHook === 'badkey' },
  ] },
  { title: 'Overlay', keys: [
    { id: 'trade.hotkeys.layout', name: 'Move the overlay', hint: 'Dims the game and shows a box for each part of the overlay, to drag where you want it.', bad: (st) => !st.hotkeys.layout },
  ] },
  { title: 'Trade offers', off: (c) => !c.trade.enabled, keys: [
    { id: 'trade.hotkeys.next', name: 'Next step for the oldest offer', hint: 'Presses its gold button: invite, trade, thanks, kick.', bad: (st) => !st.hotkeys.tradeNext },
    { id: 'trade.hotkeys.dismiss', name: 'Dismiss the oldest offer', bad: (st) => !st.hotkeys.tradeDismiss },
    { id: 'trade.hotkeys.invite', name: 'Invite the newest buyer' },
    { id: 'trade.hotkeys.trade', name: 'Trade with the newest buyer' },
    { id: 'trade.hotkeys.busy', name: 'Tell the newest buyer you are busy' },
    { id: 'trade.hotkeys.still', name: 'Ask the newest buyer if they are still interested' },
    { id: 'trade.hotkeys.whisper', name: 'Start a whisper to the newest buyer', hint: 'Opens the chat with their name filled in, for you to finish.' },
  ] },
  { title: 'Chat commands', keys: [
    { id: 'trade.hotkeys.hideout', name: 'Go to my hideout', hint: 'Types /hideout. Only held while the game is the window in front.' },
    { id: 'trade.hotkeys.remaining', name: 'Show remaining monsters', hint: 'Types /remaining. Only held while the game is the window in front.' },
  ] },
  { title: 'Help', keys: [
    { id: 'hotkeys.snapshot', name: 'Send a report', hint: 'Sends what the app sees in your inventory to the Map Companion server, to get a reading problem fixed.', bad: (st) => !st.hotkeys.snapshot },
  ] },
  // Only listed for admins and moderators, who have the Troubleshooting page.
  { title: 'Troubleshooting', hide: (s) => !(s.trouble && s.trouble.can), keys: [
    { id: 'hotkeys.record', name: 'Start or stop a recording', hint: 'Records the game screen, your keys and what the app does, for the Troubleshooting page.', bad: (st) => !st.hotkeys.record },
  ] },
];
const KEY_LIST = KEY_GROUPS.flatMap((g) => g.keys);
const takenKey = (st, key) => (st.hotkeys.tradeTaken || []).some((k) => Keys.sameKey(k, key));

let listening = null; // id of the key being chosen right now
let heldKeys = '';    // Ctrl, Alt and Shift held so far while choosing
let keyMsg = null;    // { id, text }: why the last key pressed was not taken
let listenTimer = null;

function renderKeys() {
  const c = state.config, st = state.status;
  const html = KEY_GROUPS.filter((g) => !g.hide || !g.hide(state)).map((g) => {
    const off = !!(g.off && g.off(c));
    const rows = g.keys.map((k) => {
      const v = getPath(c, k.id) || '', on = listening === k.id;
      const bad = !on && !off && v && (k.bad ? k.bad(st, v) : takenKey(st, v));
      const why = keyMsg && keyMsg.id === k.id ? keyMsg.text
        : bad ? (k.game ? `"${v}" is not a key the app can listen for. Choose the key again.` : `${Keys.pretty(v)} is held by another program, so it does nothing here. Choose another key, or free it in that program.`) : '';
      return `<div class="set-row${on ? ' listening' : ''}">
          <span class="set-what"><b>${esc(k.name)}</b>${k.hint ? `<small>${esc(k.hint)}</small>` : ''}${why ? `<small class="key-msg" role="alert">${esc(why)}</small>` : ''}</span>
          <span class="set-ctl">${v && !k.needed && !on ? `<button type="button" class="link key-clear" data-key-clear="${k.id}" aria-label="Remove the key for ${esc(k.name)}">Clear</button>` : ''}
            <button type="button" class="keycap${v ? '' : ' unset'}${on ? ' listening' : ''}${bad ? ' bad' : ''}" data-key="${k.id}" aria-label="${esc(k.name)}: ${v ? esc(Keys.pretty(v)) : 'no key'}. Press to choose a key.">${on ? esc(heldKeys ? `${heldKeys}+…` : 'Press a key…') : (v ? esc(Keys.pretty(v)) : 'Not set')}</button></span></div>`;
    }).join('');
    return `<h3>${esc(g.title)}</h3>${off ? '<p class="set-off">Trade offers are switched off (see Trade), so these keys do nothing for now.</p>' : ''}<div class="set-list">${rows}</div>`;
  }).join('');
  const box = $('set-keys-list');
  const at = box.contains(document.activeElement) ? (document.activeElement.dataset.key || document.activeElement.dataset.keyClear) : null;
  setHtml(box, html);
  // The list was drawn again: the keyboard stays on the key that was being set.
  if (at && !box.contains(document.activeElement)) { const b = box.querySelector(`[data-key="${at}"]`); if (b) b.focus(); }
}

// Choosing a key: click it, press the new one. Meanwhile the app lets go of its own keys, or
// the key being pressed would do its job instead of reaching this page.
function listenFor(id) {
  if (listening === id) { stopListening(); return; }
  listening = id; heldKeys = ''; keyMsg = null;
  act({ type: 'keysPause' });
  clearTimeout(listenTimer);
  listenTimer = setTimeout(stopListening, 15000);
  renderKeys();
}
function stopListening() {
  if (!listening) return;
  listening = null; heldKeys = '';
  clearTimeout(listenTimer);
  act({ type: 'keysResume' });
  if (state) renderKeys();
}
setPage.addEventListener('click', (e) => {
  const cap = e.target.closest('[data-key]');
  if (cap) { listenFor(cap.dataset.key); return; }
  const clear = e.target.closest('[data-key-clear]');
  if (clear) { keyMsg = null; saveSetting(clear.dataset.keyClear, ''); }
});
document.addEventListener('keydown', (e) => {
  if (!listening) return;
  e.preventDefault(); e.stopPropagation();
  if (e.repeat) return;
  if (e.code === 'Escape') { keyMsg = null; stopListening(); return; }
  const k = KEY_LIST.find((x) => x.id === listening);
  const got = k.game ? Keys.gameKeyFromEvent(e) : Keys.hotkeyFromEvent(e);
  if (got.held !== undefined) { heldKeys = got.held; renderKeys(); return; }
  heldKeys = '';
  if (got.problem) { keyMsg = { id: k.id, text: got.problem }; renderKeys(); return; }
  // Two jobs on one key would leave one of them dead. The inventory key is only listened for, so it may be shared.
  const other = k.game ? null : Keys.clash(KEY_LIST.filter((x) => !x.game).map((x) => ({ id: x.id, name: x.name, key: getPath(state.config, x.id) })), k.id, got.key);
  if (other) { keyMsg = { id: k.id, text: `${Keys.pretty(got.key)} is already the key for "${other.name}". Clear that one first, or press another key.` }; renderKeys(); return; }
  keyMsg = null;
  if (getPath(state.config, k.id) !== got.key) saveSetting(k.id, got.key);
  stopListening();
}, true);
document.addEventListener('keyup', (e) => {
  if (!listening) return;
  e.preventDefault(); e.stopPropagation();
  const held = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean).join('+');
  if (held !== heldKeys) { heldKeys = held; renderKeys(); }
}, true);
// A click anywhere else, or switching to another program, leaves the key as it was. This is
// done on the click itself, before it reaches what was clicked: on the press of the mouse
// button the list would be drawn again under the mouse and the click would be lost.
document.addEventListener('click', (e) => { if (listening && !e.target.closest(`[data-key="${listening}"]`)) stopListening(); }, true);
window.addEventListener('blur', stopListening);
