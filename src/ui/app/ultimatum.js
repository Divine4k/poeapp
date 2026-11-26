'use strict';
// Ultimatum page (#tab-ultimatum): every Inscribed Ultimatum in a public stash tab, read from
// the trade site by account name, valued by what it gives and shown where it lies in the tab.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

const ul = { account: '', keep: 20, last: null, busy: false, progress: null, error: '', asked: false, hot: '' };
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

function ulListHtml() {
  const r = ul.last;
  if (!r) return UL_HELP;
  if (!r.items.length) return `<div class="ul-help"><h3>No Inscribed Ultimatums found for ${esc(r.account)} in ${esc(r.league)}</h3><p class="hint">Is the tab public, and has it been for a few minutes? Is the account name written as the trade site shows it, with its number? Is the league in Settings the one you play in?</p></div>`;
  let sum = 0, kept = 0, blind = 0;
  for (const u of r.items) { const w = ulWorth(u); if (w === null) blind += 1; else { sum += w; if (w >= ul.keep) kept += 1; } }
  const more = r.total > r.items.length ? `<p class="ul-more">The trade site shows ${r.items.length} at most for one search; ${r.total - r.items.length} more are not listed here. Take the ones you have checked out of the tab and look again.</p>` : '';
  const rows = r.items.map((u) => {
    const w = ulWorth(u);
    const small = [u.challenge, u.areaLevel ? `area ${u.areaLevel}` : '', u.mods.length ? `${u.mods.length} mods` : '', u.listed ? `listed for ${u.listed.amount} ${esc(u.listed.currency)}` : ''].filter(Boolean).join(' · ');
    return `<div class="ul-row${ulKept(u) ? ' keep' : ''}${w === null ? ' blind' : ''}" data-id="${esc(u.id)}" title="${esc([u.value.why, u.mods.join(', ')].filter(Boolean).join('\n'))}">
      <b class="ul-val num">${w === null ? 'no price' : fmtValue(w)}</b>
      <span class="ul-what"><span>${esc(ulWhat(u))}</span><small>${esc(small)}</small></span>
      <span class="ul-where">${esc(ulWhere(u))}</span>
    </div>`;
  }).join('');
  return `<div class="ul-sum"><b>${r.items.length}</b> Ultimatums <span>worth <b class="num">${fmtValue(sum)}</b> to run</span> <span><b>${kept}</b> at ${fmtValue(ul.keep)} or more</span>${blind ? ` <span><b>${blind}</b> without a price</span>` : ''}</div>${more}<div class="ul-rows">${rows}</div>`;
}

function ulTabsHtml() {
  const r = ul.last;
  if (!r || !r.items.length) return '<p class="empty">Your stash tab is drawn here, with the valuable ones lit up.</p>';
  if (!r.tabs.length) return '<p class="empty">The trade site did not say where they lie in the tab.</p>';
  const byId = new Map(r.items.map((u) => [u.id, u]));
  return r.tabs.map((t) => {
    let cells = '';
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
      const u = byId.get(t.cells[`${x},${y}`]);
      if (!u) { cells += '<i></i>'; continue; }
      const w = ulWorth(u);
      cells += `<i class="has${ulKept(u) ? ' keep' : ''}${w === null ? ' blind' : ''}" data-id="${esc(u.id)}" title="${esc(`${ulWhat(u)}\n${w === null ? 'no price' : fmtValue(w)}`)}"></i>`;
    }
    return `<div class="ul-tab"><h3>${esc(t.name || 'Stash tab')} <small>${t.count} here</small></h3><div class="ul-grid g${t.size}">${cells}</div></div>`;
  }).join('') + '<p class="ul-key"><i class="has keep"></i> worth keeping <i class="has"></i> below your value <i class="has blind"></i> no price</p>';
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
  setHtml($('ul-list'), ulListHtml());
  setHtml($('ul-tabs'), ulTabsHtml());
  window.Hood.note('drawing the Ultimatum page', performance.now() - t0);
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

// The row and its cell in the tab light up together, whichever the mouse is on; a click on a
// cell brings its row into view.
function ulHot(id) {
  if (id === ul.hot) return;
  const page = $('tab-ultimatum');
  for (const el of page.querySelectorAll('.hot')) el.classList.remove('hot');
  ul.hot = id;
  if (id) for (const el of page.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) el.classList.add('hot');
}
$('tab-ultimatum').addEventListener('pointerover', (e) => { const el = e.target.closest('[data-id]'); ulHot(el ? el.dataset.id : ''); });
$('tab-ultimatum').addEventListener('pointerleave', () => ulHot(''));
$('ul-tabs').addEventListener('click', (e) => {
  const cell = e.target.closest('i[data-id]');
  const row = cell && $('ul-list').querySelector(`.ul-row[data-id="${CSS.escape(cell.dataset.id)}"]`);
  if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
});
