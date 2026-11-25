'use strict';
// Jewels page: timeless jewels (look up a seed, or find seeds for the stats you want), radius
// jewels (Thread of Hope and friends) and cluster jewels. The work is done in the main process
// (src/jewels.js) through api.jewels({ op, ... }); this file draws and keeps the choices.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

const jw = {
  info: null, loading: false, kind: 'timeless',
  // timeless
  mode: 'look', jewel: 'vanity', seed: null, conqueror: null, socket: null,
  result: null, taken: new Set(), busy: '', error: '', progress: null, price: null,
  want: [], searchable: [], scope: 'all', smalls: false, found: null, statFilter: '',
  // radius jewels
  rj: { jewel: 'thread', ring: 'large', socket: null, keystone: null, result: null, taken: new Set(), error: '' },
  // cluster jewels
  cl: { base: 'Large Cluster Jewel', skill: null, filter: '', result: null },
};

// The last choices are kept in this window (like the sidebar width), not in the settings.
const JW_KEEP = ['kind', 'mode', 'jewel', 'seed', 'conqueror', 'socket', 'scope', 'smalls'];
function jwSave() {
  const keep = Object.fromEntries(JW_KEEP.map((k) => [k, jw[k]]));
  keep.want = jw.want;
  keep.rj = { jewel: jw.rj.jewel, ring: jw.rj.ring, socket: jw.rj.socket, keystone: jw.rj.keystone };
  keep.cl = { base: jw.cl.base, skill: jw.cl.skill };
  try { localStorage.setItem('jewels', JSON.stringify(keep)); } catch (_) { /* not kept */ }
}
try {
  const kept = JSON.parse(localStorage.getItem('jewels') || 'null');
  if (kept) {
    for (const k of JW_KEEP) if (kept[k] !== undefined) jw[k] = kept[k];
    if (Array.isArray(kept.want)) jw.want = kept.want;
    Object.assign(jw.rj, kept.rj || {});
    Object.assign(jw.cl, kept.cl || {});
  }
} catch (_) { /* start fresh */ }

const jwJewel = () => jw.info.timeless.find((j) => j.key === jw.jewel) || jw.info.timeless[0];
const jwSocket = (id) => jw.info.sockets.find((s) => s.id === id);
// A stat line from its template and numbers: "+#% to Fire Resistance" + [12].
const fill = (tpl, vals) => { let k = 0; return tpl.replace(/#/g, () => { const v = vals[k++]; return v == null ? '?' : String(v); }); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Adds up stat lines across passives: [{ tpl, vals, count }].
function jwTotals(nodes) {
  const out = new Map();
  for (const n of nodes) {
    for (const p of n.parts) {
      const cur = out.get(p.tpl);
      if (!cur) out.set(p.tpl, { tpl: p.tpl, vals: p.vals.slice(), count: 1 });
      else { cur.count++; cur.vals = cur.vals.map((v, k) => (v == null || p.vals[k] == null ? v : Math.round((v + p.vals[k]) * 100) / 100)); }
    }
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

async function jewelsShown() {
  if (!jw.info && !jw.loading) {
    jw.loading = true;
    setHtml($('jw-main'), '<p class="empty">Loading the passive tree…</p>');
    try { jw.info = await api.jewels({ op: 'info' }); } catch (e) { jw.loading = false; setHtml($('jw-main'), `<p class="empty">${esc(e.message)}</p>`); return; }
    jw.loading = false;
    if (!jwSocket(jw.socket)) jw.socket = null;
    if (!jw.info.timeless.some((j) => j.key === jw.jewel)) jw.jewel = 'vanity';
    if (jw.kind === 'timeless' && jw.seed && jw.socket) jwLook();
    if (jw.kind === 'radius') jwRadius();
    if (jw.kind === 'cluster' && jw.cl.skill) jwCluster();
  }
  jwRender();
}

if (api.onJewelProgress) {
  api.onJewelProgress((p) => {
    jw.progress = p;
    const j = jw.info && jw.info.timeless.find((x) => x.type === p.type);
    jw.busy = `Downloading the ${j ? j.name : 'jewel'} data once${p.parts > 1 ? ` (part ${p.part} of ${p.parts})` : ''}…`;
    jwRenderMain();
  });
}

function jwRender() {
  if (!jw.info) return;
  for (const b of $('jw-kind').querySelectorAll('[data-kind]')) b.setAttribute('aria-selected', String(b.dataset.kind === jw.kind));
  jwRenderSide();
  jwRenderMain();
}

// ---- the tree pictures -------------------------------------------------------------
// The whole tree, small, for picking a socket (or a keystone for Impossible Escape).
function overviewSvg(pick, selected, reach) {
  const ov = jw.info.overview;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ov.nodes) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const pad = 400;
  const lines = ov.links.map(([a, b, c, d]) => `M${a} ${b}L${c} ${d}`).join('');
  const dots = ov.nodes.filter((n) => n[2] === 1).map(([x, y]) => `M${x} ${y}h0`).join('');
  const big = ov.nodes.filter((n) => n[2] === 2 || n[2] === 3).map(([x, y, k]) => `<circle cx="${x}" cy="${y}" r="${k === 3 ? 170 : 100}" class="${k === 3 ? 'ks' : 'nt'}"/>`).join('');
  const targets = pick === 'keystone'
    ? jw.info.keystones.map((k) => `<circle cx="${k.x}" cy="${k.y}" r="300" class="pick${k.id === selected ? ' on' : ''}" data-pick="${k.id}"><title>${esc(k.name)}</title></circle>`).join('')
    : jw.info.sockets.map((s) => `<circle cx="${s.x}" cy="${s.y}" r="280" class="pick${s.id === selected ? ' on' : ''}" data-pick="${s.id}"><title>${esc(s.label)}</title></circle>`).join('');
  const at = pick === 'keystone' ? jw.info.keystones.find((k) => k.id === selected) : jwSocket(selected);
  const ring = at && reach ? `<circle cx="${at.x}" cy="${at.y}" r="${reach}" class="reach"/>` : '';
  return `<svg class="jw-ov" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}" role="img" aria-label="The passive tree. Click a ${pick === 'keystone' ? 'keystone' : 'jewel socket'} to choose it.">
    <path d="${lines}" class="ln"/><path d="${dots}" class="dot"/>${big}${ring}${targets}</svg>`;
}

// The tree around a point. marks(node) gives extra classes; tips are shown on hover.
function treeSvg(area, center, outer, inner, marks) {
  const half = Math.max(...area.nodes.map((n) => Math.max(Math.abs(n.x - center.x), Math.abs(n.y - center.y))), outer) + 120;
  const lines = area.links.map(([a, b, c, d]) => `M${a} ${b}L${c} ${d}`).join('');
  const R = { small: 34, notable: 56, keystone: 80, socket: 52, mastery: 46, start: 60 };
  const nodes = area.nodes.map((n) => {
    if (n.kind === 'start') return '';
    const m = marks(n) || '';
    return `<circle cx="${n.x}" cy="${n.y}" r="${R[n.kind] || 34}" class="n k-${n.kind} ${m}"${m.includes('in') ? ` data-node="${n.id}" tabindex="-1"` : ''}/>`;
  }).join('');
  const rings = (inner ? `<circle cx="${center.x}" cy="${center.y}" r="${inner}" class="reach in"/>` : '') + `<circle cx="${center.x}" cy="${center.y}" r="${outer}" class="reach"/>`;
  return `<svg class="jw-tree" viewBox="${center.x - half} ${center.y - half} ${2 * half} ${2 * half}" role="img" aria-label="Passives around the socket. Click one to mark it as taken.">
    <path d="${lines}" class="ln"/>${rings}${nodes}<circle cx="${center.x}" cy="${center.y}" r="62" class="here"/></svg>`;
}

// ---- side panel: the choices ---------------------------------------------------------
function jwRenderSide() {
  if (jw.kind === 'timeless') return setHtml($('jw-side'), timelessSide());
  if (jw.kind === 'radius') return setHtml($('jw-side'), radiusSide());
  return setHtml($('jw-side'), clusterSide());
}

function timelessSide() {
  const j = jwJewel();
  const jewels = jw.info.timeless.map((x) => `<button type="button" class="jw-pick${x.key === jw.jewel ? ' on' : ''}" data-jewel="${x.key}"><b>${esc(x.name)}</b><small>${x.min.toLocaleString()} – ${x.max.toLocaleString()}</small></button>`).join('');
  const conq = j.conquerors.map((c) => `<button type="button" class="${c.name === jw.conqueror ? 'yes' : ''}" data-conqueror="${esc(c.name)}" title="Keystone: ${esc(c.keystone)}">${esc(c.name)}<small>${esc(c.keystone)}</small></button>`).join('');
  const sockets = `<option value="">Choose a socket…</option>${jw.info.sockets.map((s) => `<option value="${s.id}"${s.id === jw.socket ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}`;
  const look = `
    <label class="jw-label" for="jw-seed">Number on the jewel</label>
    <div class="jw-seed">
      <button type="button" class="small" data-seedstep="-1" aria-label="Previous number">‹</button>
      <input id="jw-seed" type="number" inputmode="numeric" min="${j.min}" max="${j.max}" step="${j.step}" value="${jw.seed == null ? '' : jw.seed}" placeholder="${j.min} to ${j.max}">
      <button type="button" class="small" data-seedstep="1" aria-label="Next number">›</button>
    </div>
    <p class="jw-help">${j.step > 1 ? `Steps of ${j.step}. ` : ''}The number in "${esc(sampleLine(j))}".</p>
    <span class="jw-label">Conqueror <small>only changes the keystone</small></span>
    <div class="chips jw-conq">${conq}</div>`;
  const find = `
    <label class="jw-label" for="jw-stat">Stats you want</label>
    <div class="jw-statpick">
      <input id="jw-stat" placeholder="Type a stat, like life or block" autocomplete="off" value="${esc(jw.statFilter)}">
      <ul class="jw-stats" id="jw-stats">${statOptions()}</ul>
    </div>
    <ul class="jw-want">${jw.want.length ? jw.want.map((w, i) => `<li>
        <span class="jw-wname">${esc(w.tpl.replace(/#/g, 'X'))}</span>
        <label>At least <input type="number" min="0" step="any" value="${w.min || ''}" data-want-min="${i}" aria-label="At least"></label>
        <label>Weight <input type="number" min="0" step="any" value="${w.weight == null ? 1 : w.weight}" data-want-weight="${i}" aria-label="Weight"></label>
        <button type="button" class="link" data-want-drop="${i}" aria-label="Remove">×</button></li>`).join('') : '<li class="dim">Nothing yet. Add the stats you want; weights say which matter more.</li>'}</ul>
    <div class="jw-row">
      <select id="jw-scope" aria-label="Where to look"><option value="all"${jw.scope === 'all' ? ' selected' : ''}>Every socket</option><option value="one"${jw.scope === 'one' ? ' selected' : ''}>Only the socket below</option></select>
      <label class="jw-check"><input type="checkbox" id="jw-smalls"${jw.smalls ? ' checked' : ''}> Count small passives</label>
    </div>
    <button type="button" class="primary jw-go" data-jw="search"${jw.want.length && !jw.busy ? '' : ' disabled'}>Find seeds</button>`;
  return `
    <button type="button" class="jw-paste" data-jw="paste" title="Hover the jewel in game and press Ctrl+C first">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/></svg>
      <span><b>Paste a copied jewel</b><small>Ctrl+C on it in game, then click here</small></span></button>
    <div class="jw-seg small" role="tablist" aria-label="What to do">
      <button type="button" role="tab" data-mode="look" aria-selected="${jw.mode === 'look'}">Look up a seed</button>
      <button type="button" role="tab" data-mode="find" aria-selected="${jw.mode === 'find'}">Find a seed</button>
    </div>
    <div class="jw-jewels">${jewels}</div>
    ${jw.mode === 'look' ? look : find}
    <label class="jw-label" for="jw-socket">Socket <small>or click one on the tree</small></label>
    <select id="jw-socket">${sockets}</select>
    ${overviewSvg('socket', jw.socket, 1800)}`;
}

function sampleLine(j) {
  return {
    vanity: 'Bathed in the blood of 2000 sacrificed…', pride: 'Commanded leadership over 12000 warriors…', restraint: 'Denoted service of 2000 dekhara…',
    faith: 'Carved to glorify 2000 new faithful…', hubris: 'Commissioned 2000 coins…', tragedy: 'Remembrancing 2000 songworthy deeds…',
  }[j.key] || '';
}

function statOptions() {
  const q = jw.statFilter.trim().toLowerCase();
  if (!q) return '';
  const words = q.split(/\s+/);
  const have = new Set(jw.want.map((w) => w.tpl));
  const list = jw.searchable.filter((s) => !have.has(s.tpl) && words.every((w) => s.tpl.toLowerCase().includes(w))).slice(0, 30);
  if (!list.length) return '<li class="dim">No stat with those words on this jewel.</li>';
  return list.map((s) => `<li><button type="button" data-want-add="${esc(s.tpl)}">${esc(s.tpl.replace(/#/g, 'X'))}<small>${s.from.includes('notable') ? 'notables' : ''}${s.from.length > 1 ? ' and ' : ''}${s.from.includes('small') ? 'small passives' : ''}</small></button></li>`).join('');
}

function radiusSide() {
  const r = jw.rj;
  const j = jw.info.radius.find((x) => x.key === r.jewel) || jw.info.radius[0];
  const jewels = jw.info.radius.map((x) => `<button type="button" class="jw-pick${x.key === r.jewel ? ' on' : ''}" data-rjewel="${x.key}"><b>${esc(x.name)}</b></button>`).join('');
  const reach = j.pick === 'ring' ? { small: 1320, medium: 1680, large: 2040, veryLarge: 2400, massive: 2880 }[r.ring] : { small: 960, medium: 1440, large: 1800 }[j.radius];
  let where;
  if (j.pick === 'keystone') {
    where = `<label class="jw-label" for="jw-keystone">Keystone <small>or click one on the tree</small></label>
      <select id="jw-keystone"><option value="">Choose a keystone…</option>${jw.info.keystones.map((k) => `<option value="${k.id}"${k.id === r.keystone ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
      ${overviewSvg('keystone', r.keystone, reach)}`;
  } else {
    where = `${j.pick === 'ring' ? `<span class="jw-label">Ring</span><div class="chips">${jw.info.rings.map((x) => `<button type="button" class="${x.key === r.ring ? 'yes' : ''}" data-ring="${x.key}">${esc(x.name)}</button>`).join('')}</div>` : ''}
      <label class="jw-label" for="jw-rsocket">Socket <small>or click one on the tree</small></label>
      <select id="jw-rsocket"><option value="">Choose a socket…</option>${jw.info.sockets.map((s) => `<option value="${s.id}"${s.id === r.socket ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
      ${overviewSvg('socket', r.socket, reach)}`;
  }
  return `<div class="jw-jewels one">${jewels}</div><p class="jw-help">${esc(j.text)}</p>${where}`;
}

function clusterSide() {
  const c = jw.cl;
  const base = jw.info.cluster.find((b) => b.base === c.base) || jw.info.cluster[0];
  const q = c.filter.trim().toLowerCase();
  const skills = base.skills.map((s) => {
    const hits = q ? s.notables.filter((n) => n.toLowerCase().includes(q)) : [];
    if (q && !hits.length && !s.name.toLowerCase().includes(q)) return '';
    return `<li><button type="button" class="${s.key === c.skill ? 'on' : ''}" data-skill="${esc(s.key)}">${esc(s.name)}${hits.length ? `<small>${esc(hits.join(', '))}</small>` : ''}</button></li>`;
  }).join('');
  return `
    <div class="jw-seg small" role="tablist" aria-label="Size">${jw.info.cluster.map((b) => `<button type="button" role="tab" data-base="${esc(b.base)}" aria-selected="${b.base === base.base}">${esc(b.size)}</button>`).join('')}</div>
    <label class="jw-label" for="jw-cfilter">Enchant <small>type a notable to see which enchants can have it</small></label>
    <input id="jw-cfilter" placeholder="Search enchants or notables" autocomplete="off" value="${esc(c.filter)}">
    <ul class="jw-skills">${skills || '<li class="dim">No enchant has a notable with that name.</li>'}</ul>`;
}

// ---- main panel ---------------------------------------------------------------------
function jwRenderMain() {
  if (!jw.info) return;
  $('jw-tip').hidden = true; // its passive may be gone after this
  if (jw.kind === 'timeless') return setHtml($('jw-main'), jw.mode === 'find' && !jw.result ? findMain() : timelessMain());
  if (jw.kind === 'radius') return setHtml($('jw-main'), radiusMain());
  return setHtml($('jw-main'), clusterMain());
}

const busyLine = () => (jw.busy ? `<p class="jw-busy"><span class="spin" aria-hidden="true"></span>${esc(jw.busy)}</p>` : '');
const errLine = (e) => (e ? `<p class="jw-err">${esc(e)}</p>` : '');

function findMain() {
  const head = `<div class="p-head"><h2>Seeds${jw.found ? ` <small>${jw.found.length ? `best ${jw.found.length}` : 'none found'}</small>` : ''}</h2></div>`;
  if (!jw.found) {
    return `${head}<div class="jw-pad">${busyLine()}${errLine(jw.error)}${jw.busy ? '' : `<p class="empty">Pick the stats you want on the left, then Find seeds. Every seed of ${esc(jwJewel().name)} is checked${jw.scope === 'all' ? ' in every socket' : ''}; the ones that give the most come first.</p>`}</div>`;
  }
  const rows = jw.found.map((r) => `<tr>
      <td class="num"><b>${r.seed}</b></td>
      <td>${esc((jwSocket(r.socket) || {}).label || r.socket)}</td>
      <td>${r.totals.map((t, i) => `<span class="jw-got">${esc(fill(jw.want[i] ? jw.want[i].tpl : '#', [t]))}</span>`).join('')}</td>
      <td class="num"><button type="button" class="small" data-show-seed="${r.seed}" data-show-socket="${r.socket}">Show</button></td></tr>`).join('');
  return `${head}<div class="jw-pad">${busyLine()}${errLine(jw.error)}
    ${jw.found.length ? `<div class="table-wrap"><table class="jw-table"><thead><tr><th class="num">Seed</th><th>Socket</th><th>Adds up to</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="empty">No seed gives all of that. Lower an "at least" or remove a stat.</p>'}</div>`;
}

function timelessMain() {
  const j = jwJewel();
  const r = jw.result;
  const back = jw.mode === 'find' ? '<button type="button" class="link" data-jw="back">← Back to the seeds</button>' : '';
  if (!r) {
    const need = [!jw.seed && 'the number on the jewel', !jw.socket && 'a socket'].filter(Boolean);
    return `<div class="p-head"><h2>${esc(j.name)}</h2>${back}</div><div class="jw-pad">${busyLine()}${errLine(jw.error)}${jw.busy ? '' : `<p class="empty">${need.length ? `Choose ${need.join(' and ')}.` : 'Working…'} Or copy the jewel in game (Ctrl+C) and press Paste.</p>`}</div>`;
  }
  const changed = r.nodes.filter((n) => n.kind !== 'small');
  const smalls = r.nodes.filter((n) => n.kind === 'small');
  const taken = r.nodes.filter((n) => jw.taken.has(n.id));
  const totals = jwTotals(taken);
  const lines = (n) => n.parts.length ? n.parts.map((p) => `<li>${esc(fill(p.tpl, p.vals))}</li>`).join('') : '<li class="dim">No stats</li>';
  const notableRows = changed.map((n) => `<li class="jw-node${jw.taken.has(n.id) ? ' taken' : ''} m-${n.mode}" data-node="${n.id}">
      <button type="button" class="jw-tick" data-take="${n.id}" aria-pressed="${jw.taken.has(n.id)}" aria-label="Taken"></button>
      <div><b>${esc(n.name)}</b>${n.name !== n.was ? `<small>was ${esc(n.was)}</small>` : ''}${n.kind === 'keystone' ? '<small>keystone</small>' : ''}<ul>${lines(n)}</ul></div></li>`).join('');
  const smallSum = jwTotals(smalls);
  const price = jw.price;
  const priceHtml = price && price.loading ? '<span class="dim">Asking the trade site…</span>'
    : price && price.error ? `<span class="neg">${esc(price.error)}</span>`
    : price ? `<span>${price.total ? `${plural(price.total, 'listed', 'listed')}${price.cheapest != null ? `, from <b>${esc(fmtValue(price.cheapest))}</b>` : ''}` : 'None listed right now'}</span>${price.url ? '<button type="button" class="link" data-jw="trade">Open on trade</button>' : ''}` : '';
  return `<div class="p-head"><h2>${esc(j.name)} ${r.seed} <small>${esc(r.conqueror || '')} · ${esc((jwSocket(r.socket) || {}).label || '')}</small></h2>
      <div class="jw-actions">${back}${priceHtml}${price && !price.loading ? '' : `<button type="button" class="small" data-jw="price"${price && price.loading ? ' disabled' : ''}>Price on trade</button>`}</div></div>
    ${busyLine()}${errLine(jw.error)}
    <div class="jw-view">
      <div class="jw-treebox">${treeSvg(r.area, r.center, r.radius, 0, (n) => {
        const hit = r.nodes.find((x) => x.id === n.id);
        if (!hit) return '';
        return `in m-${hit.mode}${jw.taken.has(n.id) ? ' taken' : ''}`;
      })}
        <p class="jw-legend"><span class="lg rep"></span>changed <span class="lg add"></span>stat added <span class="lg tk"></span>taken · click passives you take</p></div>
      <div class="jw-lists">
        <h3>What you get <small>${plural(taken.length, 'passive', 'passives')} taken</small>
          <span class="jw-quick"><button type="button" class="link" data-jw="take-notables">Notables</button><button type="button" class="link" data-jw="take-all">All</button><button type="button" class="link" data-jw="take-none">None</button></span></h3>
        <ul class="jw-sum">${totals.length ? totals.map((t) => `<li>${esc(fill(t.tpl, t.vals))}${t.count > 1 ? `<small>×${t.count}</small>` : ''}</li>`).join('') : '<li class="dim">Click the passives you take, on the tree or below.</li>'}</ul>
        <h3>Notables and keystone <small>${changed.length} in reach</small></h3>
        <ul class="jw-nodes">${notableRows}</ul>
        <h3>Small passives <small>${smalls.length} in reach, all of them together</small></h3>
        <ul class="jw-sum">${smallSum.length ? smallSum.map((t) => `<li>${esc(fill(t.tpl, t.vals))}${t.count > 1 ? `<small>×${t.count}</small>` : ''}</li>`).join('') : '<li class="dim">No stats</li>'}</ul>
      </div>
    </div>`;
}

function radiusMain() {
  const r = jw.rj;
  const j = jw.info.radius.find((x) => x.key === r.jewel);
  const res = r.result;
  if (!res) return `<div class="p-head"><h2>${esc(j.name)}</h2></div><div class="jw-pad">${errLine(r.error)}<p class="empty">Choose ${j.pick === 'keystone' ? 'a keystone' : 'a socket'}.</p></div>`;
  const notables = res.nodes.filter((n) => n.kind !== 'small');
  const smalls = res.nodes.filter((n) => n.kind === 'small');
  const counts = res.jewel === 'instinct' || res.jewel === 'meek';
  // Only small passives count for these jewels, so notables get no tick box.
  const list = notables.map((n) => `<li class="jw-node" data-node="${n.id}"><div><b>${esc(n.name)}</b>${n.kind === 'keystone' ? '<small>keystone</small>' : ''}<ul>${n.stats.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div></li>`).join('');
  return `<div class="p-head"><h2>${esc(j.name)} <small>${plural(notables.filter((n) => n.kind === 'notable').length, 'notable', 'notables')}, ${plural(smalls.length, 'small passive', 'small passives')}${notables.some((n) => n.kind === 'keystone') ? ', a keystone' : ''}</small></h2></div>
    ${errLine(r.error)}
    <div class="jw-view">
      <div class="jw-treebox">${treeSvg(res.area, res.center, res.outer, res.inner, (n) => (res.nodes.some((x) => x.id === n.id) ? `in m-reach${r.taken.has(n.id) ? ' taken' : ''}${counts && n.kind !== 'small' ? ' fixed' : ''}` : ''))}
        <p class="jw-legend"><span class="lg reach"></span>in reach${counts ? ' <span class="lg tk"></span>taken · click the small passives you take' : ''}</p></div>
      <div class="jw-lists">
        ${counts ? `<h3>${res.jewel === 'instinct' ? 'What the small passives you did not take give' : 'Your small passives, 50% stronger'}</h3>
          <ul class="jw-sum">${res.gain.length ? res.gain.map((t) => `<li>${esc(fill(t.tpl, t.vals))}${t.count > 1 ? `<small>×${t.count}</small>` : ''}</li>`).join('') : `<li class="dim">${res.jewel === 'meek' ? 'Click the small passives you take.' : 'Every small passive is taken.'}</li>`}</ul>` : ''}
        <h3>Notables and keystones in reach</h3>
        <ul class="jw-nodes">${list || '<li class="dim">None</li>'}</ul>
        <h3>Small passives in reach</h3>
        <ul class="jw-sum">${jwTotals(smalls.map((n) => ({ parts: n.stats.map((s) => ({ tpl: s.replace(/\d+(\.\d+)?/g, '#'), vals: (s.match(/\d+(\.\d+)?/g) || []).map(Number) })) }))).map((t) => `<li>${esc(fill(t.tpl, t.vals))}${t.count > 1 ? `<small>×${t.count}</small>` : ''}</li>`).join('') || '<li class="dim">None</li>'}</ul>
      </div>
    </div>`;
}

function clusterMain() {
  const c = jw.cl;
  const res = c.result;
  if (!res) return '<div class="p-head"><h2>Cluster jewels</h2></div><div class="jw-pad"><p class="empty">Choose the size and the enchant. You will see every notable it can roll and how likely each one is.</p></div>';
  const q = c.filter.trim().toLowerCase();
  const rows = res.notables.map((n) => `<tr class="${q && (n.name.toLowerCase().includes(q) || n.stats.some((s) => s.toLowerCase().includes(q))) ? 'hit' : ''}">
      <td><b>${esc(n.name)}</b><ul>${n.stats.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></td>
      <td>${n.prefix ? 'Prefix' : 'Suffix'}</td>
      <td class="num"><span class="jw-bar"><i data-pct="${Math.round(n.chance)}"></i></span>${n.chance}%</td>
      <td class="num">${n.level}</td></tr>`).join('');
  const base = jw.info.cluster.find((b) => b.base === c.base);
  const skill = base && base.skills.find((s) => s.key === c.skill);
  return `<div class="p-head"><h2>${esc(res.size)} cluster jewel <small>${esc(skill ? skill.name : '')}</small></h2></div>
    <div class="jw-pad">
      <p class="jw-help">Its small passives give ${esc(res.smalls.join(' or '))}. Chances are among the notables of the same kind (prefix or suffix). Item level is the lowest the jewel needs for the notable to roll.</p>
      <div class="table-wrap"><table class="jw-table jw-cl"><thead><tr><th>Notable</th><th>Kind</th><th class="num">Chance</th><th class="num">Item level</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">No notables.</td></tr>'}</tbody></table></div>
    </div>`;
}

// The chance bars: their width comes from CSS custom properties (no style attributes allowed).
function jwBars() { for (const i of $('jw-main').querySelectorAll('.jw-bar i[data-pct]')) i.style.setProperty('--pct', `${i.dataset.pct}%`); }

// ---- doing things -----------------------------------------------------------------------
function jwCheck() {
  const j = jwJewel();
  if (jw.seed == null || !jw.socket) return null;
  if (jw.seed < j.min || jw.seed > j.max) return `${j.name} numbers go from ${j.min} to ${j.max}.`;
  if (jw.seed % j.step) return `${j.name} numbers are steps of ${j.step}.`;
  return '';
}

let lookToken = 0;
async function jwLook() {
  const why = jwCheck();
  jw.price = null;
  if (why === null) { jw.result = null; jw.error = ''; jwRender(); return; }
  if (why) { jw.result = null; jw.error = why; jwRender(); return; }
  if (!jw.conqueror || !jwJewel().conquerors.some((c) => c.name === jw.conqueror)) jw.conqueror = jwJewel().conquerors[0].name;
  const token = ++lookToken;
  jw.error = '';
  if (!jwJewel().downloaded) jw.busy = `Getting the ${jwJewel().name} data once…`;
  jwRender();
  try {
    const r = await api.jewels({ op: 'timeless', jewel: jw.jewel, seed: jw.seed, conqueror: jw.conqueror, socket: jw.socket });
    if (token !== lookToken) return;
    const sameSpot = jw.result && jw.result.socket === r.socket;
    jw.result = r;
    jwJewel().downloaded = true;
    // Passives marked as taken stay taken while you flip through seeds in the same socket.
    if (!sameSpot) jw.taken = new Set(r.nodes.filter((n) => n.kind === 'notable').map((n) => n.id));
  } catch (e) {
    if (token !== lookToken) return;
    jw.result = null;
    jw.error = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  jw.busy = '';
  jwSave();
  jwRender();
}

async function jwSearch() {
  jw.result = null;
  jw.found = null;
  jw.error = '';
  jw.busy = jwJewel().downloaded ? 'Checking every seed…' : `Getting the ${jwJewel().name} data once…`;
  jwRender();
  try {
    jw.found = await api.jewels({ op: 'search', jewel: jw.jewel, want: jw.want, sockets: jw.scope === 'one' && jw.socket ? [jw.socket] : [], smalls: jw.smalls });
    jwJewel().downloaded = true;
  } catch (e) { jw.error = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  jw.busy = '';
  jwRender();
}

async function jwLoadSearchable() {
  jw.searchable = [];
  jw.searchable = await api.jewels({ op: 'searchable', jewel: jw.jewel });
  // Stats that this jewel cannot give are dropped from the wanted list.
  const ok = new Set(jw.searchable.map((s) => s.tpl));
  jw.want = jw.want.filter((w) => ok.has(w.tpl));
  jwRenderSide();
}

async function jwPrice() {
  if (!jw.result) return;
  jw.price = { loading: true };
  jwRenderMain();
  try { jw.price = await api.jewels({ op: 'price', jewel: jw.result.jewel, seed: jw.result.seed }); } catch (e) { jw.price = { error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; }
  jwRenderMain();
}

async function jwPaste() {
  let got = null;
  try { got = await api.jewels({ op: 'paste' }); } catch (e) { got = { error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; }
  if (!got || got.error) {
    jw.error = (got && got.error) || 'No timeless jewel was copied. Hover it in game, press Ctrl+C, then Paste.';
    jw.result = null;
    jw.mode = 'look'; // the message shows where the jewel will appear
    jwRender();
    return;
  }
  Object.assign(jw, { jewel: got.jewel, seed: got.seed, conqueror: got.conqueror, mode: 'look', error: '' });
  if (!jw.socket) { jw.error = ''; jwRender(); $('jw-socket').focus(); }
  jwLook();
}

let radiusToken = 0;
async function jwRadius() {
  const r = jw.rj;
  const j = jw.info.radius.find((x) => x.key === r.jewel);
  if (!(j.pick === 'keystone' ? r.keystone : r.socket)) { r.result = null; jwRender(); return; }
  const token = ++radiusToken;
  try {
    const res = await api.jewels({ op: 'radius', jewel: r.jewel, socket: r.socket, ring: r.ring, keystone: r.keystone, taken: [...r.taken] });
    if (token !== radiusToken) return;
    r.result = res; r.error = '';
  } catch (e) { r.result = null; r.error = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  jwSave();
  jwRender();
}

async function jwCluster() {
  const c = jw.cl;
  if (!c.skill) { c.result = null; jwRender(); return; }
  try { c.result = await api.jewels({ op: 'cluster', base: c.base, skill: c.skill }); } catch (_) { c.result = null; }
  jwSave();
  jwRender();
  jwBars();
}

const jwView = $('tab-jewels');
jwView.addEventListener('click', (e) => {
  const t = e.target;
  const kind = t.closest('[data-kind]');
  if (kind) {
    jw.kind = kind.dataset.kind;
    jwSave();
    if (jw.kind === 'radius' && !jw.rj.result) jwRadius();
    if (jw.kind === 'cluster' && !jw.cl.result) jwCluster();
    jwRender(); jwBars();
    return;
  }
  const mode = t.closest('[data-mode]');
  if (mode) {
    jw.mode = mode.dataset.mode; jw.error = ''; jwSave();
    if (jw.mode === 'find') { jw.result = null; jwLoadSearchable(); } else jwLook();
    jwRender();
    return;
  }
  const jewel = t.closest('[data-jewel]');
  if (jewel) {
    if (jewel.dataset.jewel === jw.jewel) return;
    jw.jewel = jewel.dataset.jewel; jw.seed = null; jw.conqueror = jwJewel().conquerors[0].name; jw.result = null; jw.found = null; jw.price = null; jw.error = '';
    jwSave();
    if (jw.mode === 'find') jwLoadSearchable();
    jwRender();
    $('jw-seed') && $('jw-seed').focus();
    return;
  }
  const conq = t.closest('[data-conqueror]');
  if (conq) { jw.conqueror = conq.dataset.conqueror; jwLook(); return; }
  const stepB = t.closest('[data-seedstep]');
  if (stepB) {
    const j = jwJewel();
    const next = jw.seed == null ? j.min : jw.seed + Number(stepB.dataset.seedstep) * j.step;
    jw.seed = Math.min(j.max, Math.max(j.min, next));
    $('jw-seed').value = jw.seed;
    jwLook();
    return;
  }
  const pick = t.closest('[data-pick]');
  if (pick) {
    const id = Number(pick.dataset.pick);
    if (jw.kind === 'timeless') { jw.socket = id; jw.mode === 'look' ? jwLook() : (jwSave(), jwRender()); }
    else if (jw.info.radius.find((x) => x.key === jw.rj.jewel).pick === 'keystone') { jw.rj.keystone = id; jwRadius(); }
    else { jw.rj.socket = id; jw.rj.taken = new Set(); jwRadius(); }
    return;
  }
  const take = t.closest('[data-take], .jw-tree [data-node]');
  if (take && jw.kind === 'timeless' && jw.result) {
    const id = Number(take.dataset.take || take.dataset.node);
    if (jw.taken.has(id)) jw.taken.delete(id); else jw.taken.add(id);
    jwRenderMain();
    return;
  }
  const rtake = t.closest('.jw-tree [data-node]');
  const counting = jw.rj.result && (jw.rj.result.jewel === 'instinct' || jw.rj.result.jewel === 'meek');
  if (rtake && jw.kind === 'radius' && counting && !rtake.classList.contains('fixed')) {
    const id = Number(rtake.dataset.node);
    if (jw.rj.taken.has(id)) jw.rj.taken.delete(id); else jw.rj.taken.add(id);
    jwRadius();
    return;
  }
  const add = t.closest('[data-want-add]');
  if (add) { jw.want.push({ tpl: add.dataset.wantAdd, min: 0, weight: 1 }); jw.statFilter = ''; jwSave(); jwRenderSide(); $('jw-stat').focus(); return; }
  const drop = t.closest('[data-want-drop]');
  if (drop) { jw.want.splice(Number(drop.dataset.wantDrop), 1); jwSave(); jwRenderSide(); return; }
  const show = t.closest('[data-show-seed]');
  if (show) { jw.seed = Number(show.dataset.showSeed); jw.socket = Number(show.dataset.showSocket); jwLook(); return; }
  const rj = t.closest('[data-rjewel]');
  if (rj) { jw.rj.jewel = rj.dataset.rjewel; jw.rj.taken = new Set(); jwRadius(); return; }
  const ring = t.closest('[data-ring]');
  if (ring) { jw.rj.ring = ring.dataset.ring; jwRadius(); return; }
  const base = t.closest('[data-base]');
  if (base) { jw.cl.base = base.dataset.base; jw.cl.skill = null; jw.cl.result = null; jwSave(); jwRender(); return; }
  const skill = t.closest('[data-skill]');
  if (skill) { jw.cl.skill = skill.dataset.skill; jwCluster(); return; }
  const b = t.closest('[data-jw]');
  if (!b) return;
  const what = b.dataset.jw;
  if (what === 'paste') jwPaste();
  else if (what === 'search') jwSearch();
  else if (what === 'price') jwPrice();
  else if (what === 'trade' && jw.price && jw.price.url) api.jewels({ op: 'open', url: jw.price.url });
  else if (what === 'back') { jw.result = null; jw.price = null; jwRender(); }
  else if (what.startsWith('take-') && jw.result) {
    const pickOf = { 'take-notables': (n) => n.kind === 'notable', 'take-all': (n) => n.kind !== 'keystone', 'take-none': () => false }[what];
    jw.taken = new Set(jw.result.nodes.filter(pickOf).map((n) => n.id));
    jwRenderMain();
  }
});

jwView.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'jw-seed') { jw.seed = t.value === '' ? null : Number(t.value); jwLook(); }
  else if (t.id === 'jw-socket') { jw.socket = t.value ? Number(t.value) : null; jw.mode === 'look' ? jwLook() : (jwSave(), jwRender()); }
  else if (t.id === 'jw-scope') { jw.scope = t.value; jwSave(); }
  else if (t.id === 'jw-smalls') { jw.smalls = t.checked; jwSave(); }
  else if (t.id === 'jw-rsocket') { jw.rj.socket = t.value ? Number(t.value) : null; jw.rj.taken = new Set(); jwRadius(); }
  else if (t.id === 'jw-keystone') { jw.rj.keystone = t.value ? Number(t.value) : null; jwRadius(); }
  else if (t.dataset.wantMin !== undefined) { jw.want[Number(t.dataset.wantMin)].min = Number(t.value) || 0; jwSave(); }
  else if (t.dataset.wantWeight !== undefined) { jw.want[Number(t.dataset.wantWeight)].weight = t.value === '' ? 1 : Number(t.value); jwSave(); }
});

// Typing: the seed looks itself up after a short pause; the stat and enchant lists filter at once.
let seedTimer = null;
jwView.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'jw-seed') {
    clearTimeout(seedTimer);
    seedTimer = setTimeout(() => { jw.seed = t.value === '' ? null : Number(t.value); jwLook(); }, 350);
  } else if (t.id === 'jw-stat') {
    jw.statFilter = t.value;
    $('jw-stats').innerHTML = statOptions();
  } else if (t.id === 'jw-cfilter') {
    jw.cl.filter = t.value;
    const at = t.selectionStart;
    jwRender(); jwBars();
    const f = $('jw-cfilter'); f.focus(); f.setSelectionRange(at, at);
  }
});
jwView.addEventListener('keydown', (e) => {
  if (e.target.id === 'jw-seed' && e.key === 'Enter') { clearTimeout(seedTimer); jw.seed = e.target.value === '' ? null : Number(e.target.value); jwLook(); }
  if (e.target.id === 'jw-stat' && e.key === 'Enter') { const first = $('jw-stats').querySelector('[data-want-add]'); if (first) first.click(); }
});

// Hovering a passive on the tree shows what it was and what it is now.
jwView.addEventListener('mouseover', (e) => {
  const c = e.target.closest('.jw-tree [data-node]');
  const tip = $('jw-tip');
  if (!c) { tip.hidden = true; return; }
  const id = Number(c.dataset.node);
  let html = '';
  if (jw.kind === 'timeless' && jw.result) {
    const n = jw.result.nodes.find((x) => x.id === id);
    if (n) html = `<b>${esc(n.name)}</b>${n.name !== n.was ? `<small>was ${esc(n.was)}</small>` : ''}<ul>${n.parts.map((p) => `<li>${esc(fill(p.tpl, p.vals))}</li>`).join('') || '<li class="dim">No stats</li>'}</ul>${n.mode === 'replace' && n.before.length ? `<small>Before: ${esc(n.before.join(' · '))}</small>` : ''}`;
  } else if (jw.kind === 'radius' && jw.rj.result) {
    const n = jw.rj.result.nodes.find((x) => x.id === id);
    if (n) html = `<b>${esc(n.name)}</b><ul>${n.stats.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
  }
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html;
  tip.hidden = false;
  const box = c.getBoundingClientRect(), page = jwView.getBoundingClientRect();
  const left = Math.min(box.right - page.left + 10, page.width - tip.offsetWidth - 10);
  tip.style.left = `${Math.max(10, left)}px`;
  tip.style.top = `${box.top - page.top + jwView.scrollTop}px`;
});
jwView.addEventListener('mouseleave', () => { $('jw-tip').hidden = true; });
