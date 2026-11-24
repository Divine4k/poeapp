'use strict';
// The loading screen: what the app checks while it starts, and whether there is an update.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// The theme on the page follows the settings (the engine is theme.js, the looks are themes.css).
function applyTheme() {
  Theme.apply({ id: state.config.theme, custom: state.config.themeCustom });
  Theme.motion(state.config.motion !== false);
}

// ---- loading screen ----------------------------------------------------------------
const BOOT_MIN_MS = 1100;   // long enough to read, short enough not to be in the way
const BOOT_MAX_MS = 9000;   // the app is usable before slow answers arrive; it never waits longer
const BOOT_UPDATE_MS = 7000; // an update found while starting is offered this long before the app goes on
const bootStart = Date.now();
let bootDone = false, bootUpdateSince = 0, bootTimer = null;

function bootSteps() {
  if (!state) return [['busy', 'Starting']];
  const st = state.status, steps = [['ok', 'Settings loaded']];
  steps.push(st.log.ok ? ['ok', 'Game log found'] : ['bad', 'Game log not found: choose Client.txt in Settings']);
  steps.push(st.prices.loading && st.prices.count <= 1 ? ['busy', 'Loading prices from poe.ninja']
    : st.prices.count > 1 ? ['ok', `${st.prices.count.toLocaleString()} prices for ${st.prices.league}`]
      : ['bad', `No prices: ${st.prices.errors[0] || 'poe.ninja did not answer'}`]);
  const art = st.inventory.art;
  steps.push(art.total > art.done ? ['busy', `Learning item pictures: ${art.done} of ${art.total}`] : art.known ? ['ok', `${art.known.toLocaleString()} item pictures known`] : ['', 'Item pictures come with the prices']);
  const c = st.cloud || {};
  if (c.enabled) steps.push(c.signedIn ? ['ok', `Logged in as ${c.name}`] : ['', 'Not logged in']);
  const up = st.update;
  steps.push(up.applying ? ['busy', `${up.step || 'Updating'}…`] : up.checking || (!up.checkedAt && !up.error) ? ['busy', 'Checking for updates']
    : up.error ? ['bad', 'Could not check for updates'] : up.available ? ['new', `Update available: ${up.latest.message}`] : ['ok', 'Up to date']);
  return steps;
}

function renderBoot() {
  if (bootDone) return;
  const steps = bootSteps();
  setHtml($('boot-steps'), steps.map(([cls, text]) => `<li class="${cls}">${esc(text)}</li>`).join(''));
  const waiting = steps.filter(([cls]) => cls === 'busy').length;
  $('boot-fill').style.width = `${Math.round(((steps.length - waiting) / Math.max(steps.length, 1)) * 100)}%`;
  const up = state && state.status.update;
  const offer = up && up.available && !up.applying;
  if (offer && !bootUpdateSince) bootUpdateSince = Date.now();
  const left = offer ? Math.max(0, Math.ceil((BOOT_UPDATE_MS - (Date.now() - bootUpdateSince)) / 1000)) : 0;
  setHtml($('boot-actions'), offer ? `<button type="button" class="primary" id="boot-install">Install now</button><button type="button" id="boot-later">Later (${left})</button>` : '');
  $('boot-actions').hidden = !offer;
  const elapsed = Date.now() - bootStart;
  const ready = state && !waiting && !(up && up.applying);
  if ((ready && elapsed >= BOOT_MIN_MS && (!offer || left <= 0)) || (elapsed >= BOOT_MAX_MS && !offer && !(up && up.applying))) { endBoot(); return; }
  clearTimeout(bootTimer);
  bootTimer = setTimeout(renderBoot, 250);
}
function endBoot() {
  if (bootDone) return;
  bootDone = true;
  clearTimeout(bootTimer);
  $('boot').classList.add('gone');
  setTimeout(() => { $('boot').hidden = true; }, 350);
  if (state) render(); // things kept back while it showed (the account question) come now
}
$('boot').addEventListener('click', (e) => {
  if (e.target.closest('#boot-install')) { act({ type: 'applyUpdate' }); bootUpdateSince = Date.now() + 60000; return; }
  if (e.target.closest('#boot-later')) endBoot();
});
document.addEventListener('keydown', (e) => { if (!bootDone && e.key === 'Escape') endBoot(); });
renderBoot();
