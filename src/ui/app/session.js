'use strict';
// Sessions and strategies: totals, map list, strategy tabs, session picker.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- session ------------------------------------------------------------------
const totalsHtml = (t, divine) => `
      <div class="kpi lead ${t.net < 0 ? 'neg' : ''}"><small>Net profit</small><b>${fmtValue(t.net, divine)}</b></div>
      <div class="kpi"><small>Per hour</small><b>${t.netPerHour ? fmtValue(t.netPerHour, divine) : 'n/a'}</b></div>
      <div class="kpi"><small>Maps</small><b>${t.maps}</b></div>
      <div class="kpi"><small>Average map</small><b>${t.maps ? fmtTime(t.avgMapMs) : 'n/a'}</b></div>
      <div class="kpi"><small>Deaths</small><b>${t.deaths}</b></div>`;

// Profit over the session as a line, one dot per map with its name. Drawn at the box's real size
// (no stretching, so the names stay sharp), again when the window is resized.
let chartKey = '';
function chartSvg(sum, divine, w, h) {
  const runs = sum.runs.filter((r) => r.startedAt);
  if (runs.length < 1 || w < 50) return '';
  const t0 = sum.startedAt || runs[0].startedAt;
  const end = (r) => (r.id === sum.currentId ? (sum.now || Date.now()) + (Date.now() - receivedAt) : (r.endedAt || r.startedAt + r.durationMs));
  let acc = 0;
  const pts = [{ t: t0, v: 0 }].concat(runs.map((r) => { acc += r.net; return { t: end(r), v: acc, r }; }));
  const tMax = Math.max(...pts.map((p) => p.t), t0 + 60000), vMin = Math.min(0, ...pts.map((p) => p.v)), vMax = Math.max(1, ...pts.map((p) => p.v));
  const L = 6, R = 10, T = 26, B = 22;
  const x = (t) => L + ((t - t0) / (tMax - t0)) * (w - L - R);
  const y = (v) => T + (1 - (v - vMin) / (vMax - vMin)) * (h - T - B);
  // A smooth line through the points (each bend eased with the slope of its neighbours).
  let d = `M${x(pts[0].t).toFixed(1)} ${y(pts[0].v).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], mx = (x(a.t) + x(b.t)) / 2;
    d += ` C${mx.toFixed(1)} ${y(a.v).toFixed(1)} ${mx.toFixed(1)} ${y(b.v).toFixed(1)} ${x(b.t).toFixed(1)} ${y(b.v).toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  const area = `${d} L${x(last.t).toFixed(1)} ${(h - B).toFixed(1)} L${x(pts[0].t).toFixed(1)} ${(h - B).toFixed(1)}Z`;
  const grid = [0.25, 0.5, 0.75].map((f) => `<line class="gl" x1="${L}" x2="${w - R}" y1="${(T + f * (h - T - B)).toFixed(1)}" y2="${(T + f * (h - T - B)).toFixed(1)}"/>`).join('');
  const zero = vMin < 0 ? `<line class="zero" x1="${L}" x2="${w - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>` : '';
  // Names on the dots: every map while they fit, otherwise the best, the worst and the last.
  const maps = pts.slice(1);
  const best = maps.reduce((a, p) => (p.r.net > a.r.net ? p : a), maps[0]);
  const worst = maps.reduce((a, p) => (p.r.net < a.r.net ? p : a), maps[0]);
  const named = maps.length <= Math.max(2, Math.floor(w / 110)) ? maps : maps.filter((p) => p === best || p === worst || p === last);
  const label = (p) => {
    const now = p.r.id === sum.currentId, text = `${p.r.name} ${p.r.net >= 0 ? '+' : '−'}${fmtValue(Math.abs(p.r.net), divine)}`;
    const tw = text.length * 6.3 + 12, px = x(p.t), py = y(p.v);
    const left = px + tw / 2 > w - 2 ? px - tw - 8 : px - tw / 2 < 2 ? px + 8 : px - tw / 2;
    const below = py - 26 < 0 || (p.r.net < 0 && py + 24 < h - B);
    const ty = below ? py + 10 : py - 26;
    return `<g class="pin${now ? ' now' : ''}${p.r.net < 0 ? ' neg' : ''}"><rect x="${left.toFixed(1)}" y="${ty.toFixed(1)}" width="${tw.toFixed(1)}" height="18" rx="5"/><text x="${(left + 6).toFixed(1)}" y="${(ty + 12.5).toFixed(1)}">${esc(text)}</text></g>`;
  };
  const dots = maps.map((p) => `<circle class="${p.r.id === sum.currentId ? 'now' : ''}" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${p.r.id === sum.currentId ? 4.5 : 3.5}"/>`).join('');
  const axis = [t0, (t0 + tMax) / 2, tMax].map((t, i) => `<text class="ax" x="${i === 0 ? L : i === 2 ? w - R : x(t)}" y="${h - 5}" text-anchor="${['start', 'middle', 'end'][i]}">${clock(t)}</text>`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Profit over the session">
      <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="f0"/><stop offset="1" class="f1"/></linearGradient></defs>
      ${grid}${zero}<path class="area" d="${area}"/><path class="line" d="${d}"/>${dots}${named.map(label).join('')}${axis}</svg>`;
}
function renderChart(sum, divine) {
  const box = $('sess-chart');
  const w = Math.round(box.clientWidth), h = Math.round(box.clientHeight);
  // Only redrawn when something it shows changed (or the size), not every timer tick.
  const key = `${w}x${h}|${sum.id || 'live'}|${sum.runs.map((r) => `${r.id}:${Math.round(r.net)}:${r.endedAt || ''}`).join(',')}|${Math.floor(Date.now() / 30000)}`;
  if (key === chartKey) return;
  chartKey = key;
  box.innerHTML = sum.runs.length ? chartSvg(sum, divine, w, h) : '<p class="empty">The profit line starts with the first map.</p>';
}
window.addEventListener('resize', () => { chartKey = ''; if (state) renderSession(); });

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
// Each row has a small bar for its profit, measured against the best map of the session.
function runsHtml(sum, { open, readonly, redraw, divine }) {
  const runs = sum.runs.slice().reverse();
  if (!runs.length) return '<tr><td colspan="8" class="empty">Finished maps are listed here.</td></tr>';
  const top = Math.max(1, ...runs.map((r) => Math.abs(r.net)));
  const best = runs.length > 1 ? runs.reduce((a, r) => (r.net > a.net ? r : a), runs[0]) : null;
  return runs.map((r) => {
    const live = r.id === sum.currentId;
    const note = [live ? 'now' : '', best === r && !live ? 'best' : '', r.deaths ? (r.deaths === 1 ? 'died once' : `died ${r.deaths} times`) : ''].filter(Boolean).join(' · ');
    const w = Math.max(2, Math.round((Math.abs(r.net) / top) * 100));
    let html = `<tr class="run ${live ? 'live' : ''} ${open === r.id ? 'open' : ''}" data-expand="${esc(r.id)}">
        <td class="ic"><span class="it sm map"></span></td>
        <td class="nm"><b>${esc(r.name)}</b>${note ? `<small class="${live ? 'now' : ''}">${note}</small>` : ''}</td>
        <td class="num">${fmtTime(live ? liveDuration(r) : r.durationMs)}</td>
        <td class="num">${fmtValue(r.lootValue, divine)}</td>
        <td class="num">${fmtValue(r.costValue, divine)}</td>
        <td class="barcol"><svg class="nbar ${r.net < 0 ? 'neg' : ''}" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect class="bg" width="100" height="5" rx="2.5"/><rect class="fg" width="${w}" height="5" rx="2.5"/></svg></td>
        <td class="num net"><em class="${r.net < 0 ? 'neg' : live ? 'gold' : ''}">${r.net > 0 ? '+' : ''}${fmtValue(r.net, divine)}</em></td>
        <td class="x">${readonly ? '' : `<button type="button" class="link" data-act="deleteRun" data-run="${esc(r.id)}" data-confirm="${esc(`Delete ${r.name} from this session?`)}" title="Delete this map" aria-label="Delete ${esc(r.name)}">×</button>`}</td></tr>`;
    if (open === r.id) {
      const costs = r.costs.length ? `<p class="costline">Costs: ${r.costs.map((c) => `${esc(c.name)} ×${c.qty} (${fmtValue(c.total, divine)})`).join(', ')}</p>` : '';
      const data = snapData(r, redraw);
      const snap = snapHtml(data, false, divine);
      html += `<tr class="detail"><td colspan="8">${snap ? `<div class="snaps">${snap}</div>${snapLegend(data)}` : ''}${itemsHtml(r, divine)}${costs}</td></tr>`;
    }
    return html;
  }).join('');
}
// The total line under the maps.
const runsTotal = (t, divine) => (t.maps ? `<tr class="total"><td class="ic"></td><td class="nm"><b>Total</b><small>${mapsWord(t.maps)}</small></td>
    <td class="num">${fmtTime(t.mapMs || 0)}</td><td class="num">${fmtValue(t.lootValue || 0, divine)}</td><td class="num">${fmtValue(t.costValue || 0, divine)}</td><td></td>
    <td class="num net"><em class="${t.net < 0 ? 'neg' : 'gold'}">${t.net > 0 ? '+' : ''}${fmtValue(t.net, divine)}</em></td><td></td></tr>` : '');

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
    head = `<p class="session-note"><span>Started at ${clock(live.runs[0].startedAt)}</span>
        <button type="button" class="link" data-act="recheckMaps" title="Looks at the saved inventory pictures of this session's maps again with the items known now, and corrects loot that was counted under a wrong name or not recognised at the time">Re-check items in these maps</button></p>`;
  }
  setHtml($('session-head'), head);
  setHtml($('totals'), totalsHtml(sum.totals, sum.divine));
  renderChart(sum, sum.divine);
  // Only redrawn when something changed: redrawing under the mouse would stop the name of a
  // hovered slot from ever showing.
  const rows = runsHtml(sum, { open: expanded, readonly: sum !== live, redraw: renderSession, divine: sum.divine });
  if (rows !== runsShown) { runsShown = rows; $('runs').innerHTML = rows; }
  setHtml($('runs-total'), runsTotal(sum.totals, sum.divine));
}
