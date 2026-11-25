'use strict';
// Sessions and strategies: the session's numbers, map list, strategy tabs, session picker.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- session ------------------------------------------------------------------
// The session's numbers in one row. Best drop: the most valuable item over all its maps.
function bestDrop(runs) {
  const by = new Map();
  for (const r of runs) for (const i of r.items || []) if (i.chaos > 0) { const e = by.get(i.name) || { name: i.name, qty: 0, chaos: 0 }; e.qty += i.qty; e.chaos += i.chaos; by.set(i.name, e); }
  return [...by.values()].sort((x, y) => y.chaos - x.chaos)[0] || null;
}
const totalsHtml = (t, divine, runs) => {
  const best = bestDrop(runs);
  const short = (n) => n.replace(/ Orb$/, '').replace(/^Orb of /, '');
  return `
      <div class="lead ${t.net < 0 ? 'neg' : ''}"><small>Session</small><b>${fmtValue(t.net, divine)}</b></div>
      <div class="rate ${t.netPerHour < 0 ? 'neg' : ''}"><small>Per hour</small><b>${t.netPerHour ? fmtValue(t.netPerHour, divine) : 'n/a'}</b></div>
      <div><small>Maps</small><b>${t.maps}</b></div>
      <div><small>Average</small><b>${t.maps ? fmtTime(t.avgMapMs) : 'n/a'}</b></div>
      <div title="${best ? esc(`${best.qty} × ${best.name}, ${fmtValue(best.chaos, divine)}`) : ''}"><small>Best drop</small><b>${best ? esc(`${best.qty > 1 ? `${best.qty} ` : ''}${short(best.name)}`) : '—'}</b></div>`;
};

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
// "vs average": how much more or less a map made than the session's average finished map.
// The maps of a session, newest first. Each row is its own bar: as long as what the map made
// (against the session's best), green when it beat the session's average (the thin line),
// gold for the best, striped for the map being run. Then when it ended, how long it took, and
// what it made. A click opens the map's pictures and loot under it.
const SKULL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5c-3.4 0-6 2.4-6 5.6 0 1.9.9 3.4 2.3 4.3V13c0 .8.6 1.5 1.4 1.5h4.6c.8 0 1.4-.7 1.4-1.5v-1.6c1.4-.9 2.3-2.4 2.3-4.3 0-3.2-2.6-5.6-6-5.6Zm-2.4 7.9a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm4.8 0a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z"/></svg>';
// A map's tier from its area level, as the game logs it: tier 1 is area level 68, tier 16 is
// 83 and tier 17 is 84. Anything else (the campaign, a hideout) has no tier.
const tierOf = (level) => (level >= 68 && level <= 84 ? level - 67 : null);
const deathsHtml = (n) => (n ? `<span class="deaths" title="Died ${n === 1 ? 'once' : `${n} times`}">${SKULL}${n}</span>` : '');
function runsHtml(sum, { open, readonly, redraw, divine }) {
  const runs = sum.runs.slice().reverse();
  if (!runs.length) return '<tr><td colspan="6" class="empty">Finished maps are listed here.</td></tr>';
  const done = sum.runs.filter((r) => r.id !== sum.currentId);
  const avg = done.length ? done.reduce((a, r) => a + r.net, 0) / done.length : 0;
  const best = done.length > 1 ? done.reduce((a, r) => (r.net > a.net ? r : a), done[0]) : null;
  const top = Math.max(1, ...sum.runs.map((r) => r.net));
  const avgAt = done.length > 1 && avg > 0 ? Math.round((avg / top) * 1000) / 10 : null;
  return runs.map((r) => {
    const live = r.id === sum.currentId;
    const cls = live ? 'now' : r === best ? 'best' : r.net < 0 ? 'neg' : done.length > 1 && r.net >= avg ? 'up' : '';
    const w = Math.max(1.5, Math.round((Math.max(0, r.net) / top) * 1000) / 10);
    const diff = r.net - avg;
    const tip = live || done.length < 2 ? '' : `${diff >= 0 ? '+' : '−'}${fmtValue(Math.abs(diff), divine)} against the session's average`;
    let html = `<tr class="run ${live ? 'live' : ''} ${open === r.id ? 'open' : ''}" data-expand="${esc(r.id)}">
        <td class="nm"${live ? ' title="The map you are in"' : ''}><span>${tierOf(r.level) ? `<span class="tier" title="Area level ${r.level}">T${tierOf(r.level)}</span>` : ''}<b>${esc(r.name)}</b>${best === r ? '<u>best</u>' : ''}${deathsHtml(r.deaths)}</span></td>
        <td class="mbar"${tip ? ` title="${esc(tip)}"` : ''}><span class="track">${avgAt !== null ? `<i class="avg" data-at="${avgAt}"></i>` : ''}<i class="fill ${cls}" data-w="${w}"></i></span></td>
        <td class="num end"${!live && r.endedAt ? ` title="${esc(`${dayOf(r.endedAt)}, ${clock(r.endedAt)}`)}"` : ''}>${live ? 'in progress' : r.endedAt ? clock(r.endedAt) : ''}</td>
        <td class="num t">${fmtTime(live ? liveDuration(r) : r.durationMs)}</td>
        <td class="num net ${r.net < 0 ? 'neg' : live ? 'gold' : ''}">${r.net > 0 ? '+' : ''}${fmtValue(r.net, divine)}</td>
        <td class="x">${readonly ? '' : `<button type="button" class="link" data-act="deleteRun" data-run="${esc(r.id)}" data-confirm="${esc(`Delete ${r.name} from this session?`)}" title="Delete this map" aria-label="Delete ${esc(r.name)}">×</button>`}</td></tr>`;
    if (open === r.id) {
      const costs = r.costs.length ? `<p class="costline">Costs: ${r.costs.map((c) => `${esc(c.name)} ×${c.qty} (${fmtValue(c.total, divine)})`).join(', ')}</p>` : '';
      const data = snapData(r, redraw);
      const snap = snapHtml(data, false, divine);
      html += `<tr class="detail"><td colspan="6">${snap ? `<div class="snaps">${snap}</div>${snapLegend(data)}` : ''}${itemsHtml(r, divine)}${costs}</td></tr>`;
    }
    return html;
  }).join('');
}
// The bars' lengths and the average line, through CSS variables (the page allows no style attributes).
function sizeBars(box) {
  for (const i of box.querySelectorAll('.track .fill[data-w]')) i.style.setProperty('--w', `${i.dataset.w}%`);
  for (const i of box.querySelectorAll('.track .avg[data-at]')) i.style.setProperty('--at', `${i.dataset.at}%`);
  // the live row is drawn anew every second; start its pulse part-way so it carries on smoothly
  const live = box.querySelector('tr.live td');
  if (live && !live.style.getPropertyValue('--breathe-at')) live.style.setProperty('--breathe-at', `${-(Date.now() % 2400)}ms`);
}
// The line under the maps: the average map.
const runsTotal = (sum, divine) => {
  const done = sum.runs.filter((r) => r.id !== sum.currentId);
  if (!done.length) return '';
  const ms = done.reduce((a, r) => a + r.durationMs, 0) / done.length, net = done.reduce((a, r) => a + r.net, 0) / done.length;
  return `<tr class="total"><td class="nm" colspan="2"><b>Average map</b><em class="dim">${mapsWord(done.length)} finished</em></td><td></td><td class="num">${fmtTime(ms)}</td>
    <td class="num net">${net > 0 ? '+' : ''}${fmtValue(net, divine)}</td><td></td></tr>`;
};

// ---- strategies: tabs across the top; each has its own sessions ----------------
let stratSel = null; // the strategy being looked at; the one being run is config.activeStrategy
let sessionSel = 'current';
const saved = new Map(); // id -> the full saved session
const dayOf = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const mapsWord = (n) => `${n} ${n === 1 ? 'map' : 'maps'}`;

function renderStrategies() {
  const list = state.config.strategies || [], active = state.config.activeStrategy;
  if (!list.some((x) => x.id === stratSel)) stratSel = active;
  const cur = list.find((x) => x.id === stratSel);
  // Everything this strategy has made: its saved sessions plus the running one.
  const mine = (state.sessions || []).filter((x) => x.strategyId === stratSel).map((x) => x.totals);
  if (stratSel === active && state.summary.runs.length) mine.push(state.summary.totals);
  const sum = mine.reduce((a, t) => ({ maps: a.maps + t.maps, net: a.net + t.net, ms: a.ms + (t.elapsedMs || 0) }), { maps: 0, net: 0, ms: 0 });
  const perHour = sum.ms > 60000 ? sum.net / (sum.ms / 3600000) : 0;
  const stats = mine.length
    ? `${mine.length} ${mine.length === 1 ? 'session' : 'sessions'}, ${mapsWord(sum.maps)}, ${fmtValue(sum.net)} net${perHour ? `, ${fmtValue(perHour)} per hour` : ''}`
    : 'No sessions yet';
  setHtml($('strat-tabs'), list.map((x) => `<button type="button" role="tab" data-strat="${esc(x.id)}" aria-selected="${x.id === stratSel}"${x.id === stratSel ? ` title="${esc(stats)}"` : ''}>
      ${x.id === active ? '<span class="live-dot" title="You are running this one"></span>' : ''}${esc(x.name)}</button>`).join('')
    + '<button type="button" class="add" id="btn-strategy-new" title="New strategy" aria-label="New strategy">+</button>');
  setHtml($('strat-info'), `
      ${stratSel === active ? '' : `<button type="button" class="primary small" data-act="runStrategy" data-id="${esc(cur.id)}"${state.summary.runs.length ? ' data-confirm="Switch strategy? The session you have open is saved and closed first."' : ''}>Run this one</button>`}
      ${cur.atlasUrl ? `<a href="${esc(cur.atlasUrl)}" target="_blank" rel="noreferrer" title="Open the atlas tree of ${esc(cur.name)}">Atlas tree</a>` : ''}
      <button type="button" class="link" id="btn-strategy-edit">Edit</button>`);
}

// The right half: the sessions of the strategy being looked at.
let runsShown = null;
function renderSession() {
  const list = (state.sessions || []).filter((x) => x.strategyId === stratSel);
  const running = stratSel === state.config.activeStrategy;
  if (sessionSel === 'current' ? !running : !list.some((x) => x.id === sessionSel)) sessionSel = running ? 'current' : (list[0] ? list[0].id : null);
  const live = state.summary;
  const chip = (id, title, t, divine) => `<button type="button" role="tab" data-session="${esc(id)}" aria-selected="${id === sessionSel}" title="${esc(`${mapsWord(t.maps)}, ${fmtValue(t.net, divine)} net`)}">${esc(title)}</button>`;
  $('btn-new-session').hidden = !running; // only the strategy being run has a session to close
  const strip = $('session-strip');
  const left = strip.scrollLeft;
  setHtml(strip, (running ? chip('current', 'This session', live.totals, live.divine) : '')
    + list.map((x) => chip(x.id, `${dayOf(x.startedAt)} ${clock(x.startedAt)}`, x.totals, x.divine)).join('')
    + (list.length || running ? '' : '<p class="strip-hint">Nothing has been run under this strategy yet. Press Run this one and your maps are counted here.</p>'));
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
  } else if (live.runs.length) {
    head = `<p class="session-note"><span>${mapsWord(live.runs.length)} since ${clock(live.runs[0].startedAt)}</span>
        <button type="button" class="link" data-act="recheckMaps" title="Looks at the saved inventory pictures of this session's maps again with the items known now, and corrects loot that was counted under a wrong name or not recognised at the time">Re-check items</button></p>`;
  }
  setHtml($('session-head'), head);
  setHtml($('totals'), totalsHtml(sum.totals, sum.divine, sum.runs));
  // Only redrawn when something changed: redrawing under the mouse would stop the name of a
  // hovered slot from ever showing.
  const rows = runsHtml(sum, { open: expanded, readonly: sum !== live, redraw: renderSession, divine: sum.divine });
  if (rows !== runsShown) { runsShown = rows; $('runs').innerHTML = rows; }
  setHtml($('runs-total'), runsTotal(sum, sum.divine));
  sizeBars($('runs'));
}

