'use strict';
// Sessions and strategies: totals, map list, strategy tabs, session picker.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

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
