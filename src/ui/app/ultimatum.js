'use strict';
// Ultimatum page (#tab-ultimatum): every Inscribed Ultimatum in a public stash tab, read from
// the trade site by account name, valued by what it gives and shown where it lies in the tab.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

const ul = { account: '', keep: 20, last: null, busy: false, progress: null, error: '', asked: false, hot: '', found: '', tab: 0, byId: new Map(), byIdOf: null };
// The account name and the light-up value are kept in this window, like the Jewels page's choices.
try {
  const kept = JSON.parse(localStorage.getItem('ultimatum') || 'null') || {};
  ul.account = String(kept.account || jw.bf.account || '');
  if (kept.keep >= 0) ul.keep = Number(kept.keep);
} catch (_) { /* storage off: asked for again */ }
const ulSave = () => { try { localStorage.setItem('ultimatum', JSON.stringify({ account: ul.account, keep: ul.keep })); } catch (_) { /* not kept */ } };

const ulWorth = (u) => (u.value && u.value.chaos !== null ? u.value.chaos : null);
const ulKept = (u) => ulWorth(u) !== null && ulWorth(u) >= ul.keep;
// What it does, in one line: "Doubles 4 × Exalted Orb", "Mageblood for Headhunter".
function ulWhat(u) {
  const s = u.sacrifice, sac = s ? `${s.count > 1 ? `${s.count} × ` : ''}${s.name}` : '';
  if (u.value.kind === 'double') return sac ? `Doubles ${sac}` : u.reward;
  if (!u.reward) return sac ? `Asks for ${sac}` : 'Inscribed Ultimatum';
  return sac ? `${u.reward} for ${sac}` : u.reward;
}
const ulWhere = (u) => (u.x === null ? '' : `${u.tab ? `${u.tab}, ` : ''}column ${u.x + 1}, row ${u.y + 1}`);

function ulStatus() {
  if (ul.busy) return ul.progress && ul.progress.total ? `Reading ${ul.progress.done} of ${ul.progress.total}…` : 'Asking the trade site…';
  if (ul.error) return ul.error;
  return ul.last ? `${ul.last.account} in ${ul.last.league}, read at ${clock(ul.last.at)}` : '';
}

const UL_HELP = `<div class="ul-help">
  <h3>Check a whole tab of Inscribed Ultimatums at once</h3>
  <ol>
    <li>Put them in one stash tab and make that tab <b>public</b> (right-click the tab in game). No price is needed. To be sure nobody whispers, give the tab a price nobody pays, like 1 mirror each.</li>
    <li>Wait a few minutes: the trade site needs a moment to see a tab that just became public.</li>
    <li>Type your account name as the trade site shows it (Name#1234) and press <b>Look up</b>.</li>
  </ol>
  <p class="hint">The app reads them from the official trade site, without a login. Each one is valued by what it gives, at poe.ninja's prices: one that doubles what you put in is worth what you put in.</p>
</div>`;

// The price in a slot: short enough for a stash cell ("1.6d", "56c").
function ulShort(c) {
  const d = state ? state.summary.divine : 0;
  if (c === null) return '?';
  return d > 0 && c >= d ? `${(c / d).toFixed(1)}d` : `${Math.round(c)}c`;
}
const ulById = (id) => (ul.last && id ? ul.byId.get(id) : null) || null;

function ulListHtml() {
  const r = ul.last;
  if (!r) return UL_HELP;
  if (!r.items.length) return `<div class="ul-help"><h3>No Inscribed Ultimatums found for ${esc(r.account)} in ${esc(r.league)}</h3><p class="hint">Is the tab public, and has it been for a few minutes? Is the account name written as the trade site shows it, with its number? Is the league in Settings the one you play in?</p></div>`;
  const more = r.total > r.items.length ? `<p class="ul-more">The trade site shows ${r.items.length} at most for one search; ${r.total - r.items.length} more are not listed here. Take the ones you have checked out of the tab and look again.</p>` : '';
  const rows = r.items.map((u) => {
    const w = ulWorth(u);
    const small = [u.challenge, u.areaLevel ? `area ${u.areaLevel}` : '', u.mods.length ? `${u.mods.length} mods` : '', u.listed ? `listed for ${u.listed.amount} ${esc(u.listed.currency)}` : ''].filter(Boolean).join(' · ');
    return `<div class="ul-row${ulKept(u) ? ' keep' : ''}${w === null ? ' blind' : ''}${u.id === ul.found ? ' found' : ''}" data-id="${esc(u.id)}">
      <b class="ul-val num">${w === null ? 'no price' : fmtValue(w)}</b>
      <span class="ul-what"><span>${esc(ulWhat(u))}</span><small>${esc(small)}</small></span>
      <span class="ul-where">${esc(ulWhere(u))}</span>
    </div>`;
  }).join('');
  return `<h3>Most valuable first <small>click one to light it up in your stash in game</small></h3>${more}${rows}`;
}

// The one the mouse is on, else the one last lit up, else the most valuable: shown in full.
function ulDetailHtml() {
  const r = ul.last;
  if (!r || !r.items.length) return '';
  const u = ulById(ul.hot) || ulById(ul.found) || r.items[0];
  const w = ulWorth(u), s = u.sacrifice;
  const label = u.id === ul.hot ? 'Under your mouse' : u.id === ul.found ? 'Lit up in game' : 'The most valuable one';
  const put = s ? `${s.count > 1 ? `${s.count} × ` : ''}${esc(s.name)}${u.value.cost ? ` (${fmtValue(u.value.cost)})` : ''}` : 'not said';
  return `<div class="ul-det">
    <div class="ul-det-top"><span>${label}</span><span>${esc(ulWhere(u))}</span></div>
    <div class="ul-det-main"><b class="ul-big num${w === null ? ' blind' : ulKept(u) ? '' : ' low'}">${w === null ? 'no price' : fmtValue(w)}</b><span>${esc(ulWhat(u))}</span></div>
    <div class="ul-facts"><span>Challenge<b>${esc(u.challenge || 'not said')}</b></span><span>Area level<b>${u.areaLevel || 'not said'}</b></span><span>You put in<b>${put}</b></span></div>
    ${u.mods.length ? `<div class="ul-mods">${u.mods.map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
    <p class="ul-why">${esc(u.value.why)}${u.listed ? ` Listed for ${u.listed.amount} ${esc(u.listed.currency)}.` : ''}</p>
    <div><button type="button" class="primary small" data-ul-find="${esc(u.id)}"${u.find ? '' : ' disabled'}>Light up in game</button></div>
  </div>`;
}

// The catalyst slots above the Ultimatums in the game's Ultimatum tab: only there to make the
// picture look like the tab, they hold nothing.
const UL_CATS = '<div class="ul-cats" aria-hidden="true"><div><i></i><i></i><i></i></div><div><i></i><i></i><i></i><i></i></div><div><i></i><i></i><i></i><i class="gap"></i><i></i><i></i></div></div>';
function ulTabsHtml() {
  const r = ul.last;
  if (!r || !r.items.length) return '';
  if (!r.tabs.length) return '<p class="empty">The trade site did not say where they lie in the tab.</p>';
  const t = r.tabs[Math.min(ul.tab, r.tabs.length - 1)];
  const pick = r.tabs.length > 1 ? `<div class="ul-pick">${r.tabs.map((x, i) => `<button type="button" class="small" data-ul-tab="${i}" aria-pressed="${x === t}">${esc(x.name || 'Stash tab')} <small>${x.count}</small></button>`).join('')}</div>` : '';
  let cells = '';
  for (let y = 0; y < t.rows; y++) for (let x = 0; x < t.cols; x++) {
    const u = ul.byId.get(t.cells[`${x},${y}`]);
    if (!u) { cells += '<i></i>'; continue; }
    const w = ulWorth(u);
    cells += `<i class="has${ulKept(u) ? ' keep' : ''}${w === null ? ' blind' : ''}${u.id === ul.found ? ' found' : ''}" data-id="${esc(u.id)}"><b></b><span>${ulShort(w)}</span></i>`;
  }
  const special = t.kind === 'slots';
  return `${pick}<div class="ul-stash"><div class="ul-stash-top"><b>${esc(t.name || 'Stash tab')}</b><span>${t.count} here, as they lie in game</span></div>${special ? UL_CATS : ''}<div class="ul-grid c${t.cols}">${cells}</div></div>`;
}
function ulStatsHtml() {
  const r = ul.last;
  if (!r || !r.items.length) return '';
  let sum = 0, kept = 0, blind = 0;
  for (const u of r.items) { const w = ulWorth(u); if (w === null) blind += 1; else if (w >= ul.keep) { sum += w; kept += 1; } }
  return `<div><b>${r.items.length}</b>Ultimatums</div><div><b class="gold num">${fmtValue(sum)}</b>worth running</div><div><b>${kept}</b>at ${fmtValue(ul.keep)} or more</div>${blind ? `<div><b>${blind}</b>without a price</div>` : ''}`;
}

function ulDraw() {
  const t0 = performance.now();
  const acc = $('ul-account'), keep = $('ul-keep');
  if (document.activeElement !== acc && acc.value !== ul.account) acc.value = ul.account;
  if (document.activeElement !== keep && keep.value !== String(ul.keep)) keep.value = String(ul.keep);
  $('ul-scan').disabled = ul.busy;
  $('ul-scan').classList.toggle('busy', ul.busy);
  const st = $('ul-status');
  st.textContent = ulStatus();
  st.classList.toggle('bad', !ul.busy && !!ul.error);
  // One look-up of each item by its id for everything drawn, made when the answer changes.
  if (ul.byIdOf !== ul.last) { ul.byIdOf = ul.last; ul.byId = new Map(ul.last ? ul.last.items.map((u) => [u.id, u]) : []); }
  $('ul-body').classList.toggle('none', !(ul.last && ul.last.items.length));
  setHtml($('ul-tabs'), ulTabsHtml());
  setHtml($('ul-stats'), ulStatsHtml());
  setHtml($('ul-detail'), ulDetailHtml());
  setHtml($('ul-list'), ulListHtml());
  ulMark();
  window.Hood.note('drawing the Ultimatum page', performance.now() - t0);
}
// The row and the slot under the mouse are marked after a redraw too.
function ulMark() {
  for (const el of $('tab-ultimatum').querySelectorAll('.hot')) el.classList.remove('hot');
  if (ul.hot) for (const el of $('tab-ultimatum').querySelectorAll(`[data-id="${CSS.escape(ul.hot)}"]`)) el.classList.add('hot');
}

// Opened: what the app last read is shown again (asked for once per start of the window).
function ultShown() {
  ulDraw();
  if (ul.asked || !api.ultimatum) return;
  ul.asked = true;
  api.ultimatum({ op: 'get' }).then((r) => { if (r && !ul.last) { ul.last = r.last; ul.busy = !!r.busy; ulDraw(); } }, () => {});
}

async function ulScan() {
  if (ul.busy) return;
  ul.account = $('ul-account').value.trim();
  ulSave();
  ul.busy = true; ul.error = ''; ul.progress = null;
  ulDraw();
  try { const r = await api.ultimatum({ op: 'scan', account: ul.account }); ul.last = r.last; }
  catch (e) { ul.error = cleanErr(e); }
  ul.busy = false;
  ulDraw();
}

if (api.onUltimatumProgress) api.onUltimatumProgress((p) => { ul.progress = p; if (!$('tab-ultimatum').hidden && !document.hidden) $('ul-status').textContent = ulStatus(); });

$('ul-scan').addEventListener('click', ulScan);
$('ul-account').addEventListener('keydown', (e) => { if (e.key === 'Enter') ulScan(); });
$('ul-keep').addEventListener('input', (e) => {
  const v = Number(String(e.target.value).replace(',', '.'));
  if (!isFinite(v) || v < 0) return;
  ul.keep = v; ulSave(); ulDraw();
});

// The row and its slot light up together, whichever the mouse is on, and the one under the
// mouse is shown in full. Only that box and the two marks change, not the page.
function ulHot(id) {
  if (id === ul.hot) return;
  ul.hot = id;
  ulMark();
  setHtml($('ul-detail'), ulDetailHtml());
}
$('ul-body').addEventListener('pointerover', (e) => { const el = e.target.closest('.ul-row[data-id], i[data-id]'); if (el) ulHot(el.dataset.id); else if (!e.target.closest('#ul-detail')) ulHot(''); });
$('ul-body').addEventListener('pointerleave', () => ulHot(''));
// A click on a row, a slot or the button lights that Ultimatum up in the game: the app goes
// to the game and types the search for it into the stash's search box (the stash must be
// open). The one click is the user's; the one last asked for stays marked on the page.
$('tab-ultimatum').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-ul-tab]');
  if (tab) { ul.tab = Number(tab.dataset.ulTab); ulDraw(); return; }
  const btn = e.target.closest('[data-ul-find]');
  const el = btn || e.target.closest('.ul-row[data-id], i[data-id]');
  const u = el && ulById(btn ? btn.dataset.ulFind : el.dataset.id);
  if (!u) return;
  const row = $('ul-list').querySelector(`.ul-row[data-id="${CSS.escape(u.id)}"]`);
  if (row && el.tagName === 'I') row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (!u.find) return;
  ul.found = u.id; ulDraw();
  act({ type: 'regexSend', text: u.find });
});
