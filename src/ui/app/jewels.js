'use strict';
// Jewels page: timeless jewels (look up a seed, or find seeds for the stats you want), radius
// jewels (Thread of Hope and friends) and cluster jewels. The work is done in the main process
// (src/jewels.js) through api.jewels({ op, ... }); this file draws and keeps the choices.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

const jw = {
  info: null, loading: false, kind: 'timeless',
  // timeless
  mode: 'look', jewel: 'vanity', seed: null, conqueror: null, socket: null,
  result: null, taken: new Set(), busy: '', error: '', progress: null, price: null, verdict: null,
  want: [], searchable: [], scope: 'all', smalls: false, found: null, statFilter: '',
  goals: [], goalList: [], guideOpen: false,
  // the player's build (Path of Building code or a character), kept in this window
  build: null, bf: { open: false, text: '', account: '', chars: null, busy: '', error: '' },
  // radius jewels
  rj: { jewel: 'thread', ring: 'large', socket: null, keystone: null, result: null, taken: new Set(), error: '' },
  // cluster jewels
  cl: { base: 'Large Cluster Jewel', skill: null, filter: '', result: null },
};

// The last choices (and the build) are kept in this window, like the sidebar width, not in the settings.
const JW_KEEP = ['kind', 'mode', 'jewel', 'seed', 'conqueror', 'socket', 'scope', 'smalls', 'goals', 'build', 'want'];
function jwSave() {
  const keep = Object.fromEntries(JW_KEEP.map((k) => [k, jw[k]]));
  keep.account = jw.bf.account;
  keep.rj = { jewel: jw.rj.jewel, ring: jw.rj.ring, socket: jw.rj.socket, keystone: jw.rj.keystone };
  keep.cl = { base: jw.cl.base, skill: jw.cl.skill };
  try { localStorage.setItem('jewels', JSON.stringify(keep)); } catch (_) { /* not kept */ }
}
try {
  const kept = JSON.parse(localStorage.getItem('jewels') || 'null');
  if (kept) {
    for (const k of JW_KEEP) if (kept[k] !== undefined) jw[k] = kept[k];
    if (!Array.isArray(jw.want)) jw.want = [];
    if (!Array.isArray(jw.goals)) jw.goals = [];
    jw.bf.account = kept.account || '';
    Object.assign(jw.rj, kept.rj || {});
    Object.assign(jw.cl, kept.cl || {});
  }
} catch (_) { /* start fresh */ }

const jwJewel = () => jw.info.timeless.find((j) => j.key === jw.jewel) || jw.info.timeless[0];
const jwSocket = (id) => jw.info.sockets.find((s) => s.id === id);
// A stat line from its template and numbers: "+#% to Fire Resistance" + [12].
const fill = (tpl, vals) => { let k = 0; return tpl.replace(/#/g, () => { const v = vals[k++]; return v == null ? '?' : String(v); }); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cleanErr = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
// What is searched for and judged: the chosen goals' lines and any single stats added by hand.
const jwGoal = (key) => jw.goalList.find((g) => g.key === key);
const effWant = () => [...jw.goals.flatMap((k) => (jwGoal(k) ? jwGoal(k).want : [])), ...jw.want];
const goalNames = () => jw.goals.map((k) => (jwGoal(k) || {}).name).filter(Boolean);
// How far a socket is from the build's tree, in words.
function socketNote(id) {
  if (!jw.build || !jw.build.distances) return '';
  const d = jw.build.distances[id];
  return d == null ? '' : d === 0 ? 'on your tree' : `${plural(d, 'point', 'points')} away`;
}
const nearSockets = () => (jw.build ? jw.info.sockets.filter((s) => { const d = jw.build.distances[s.id]; return d != null && d <= 3; }).map((s) => s.id) : []);

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
    try { jw.info = await api.jewels({ op: 'info' }); } catch (e) { jw.loading = false; setHtml($('jw-main'), `<p class="empty">${esc(cleanErr(e))}</p>`); return; }
    jw.loading = false;
    if (!jwSocket(jw.socket)) jw.socket = null;
    if (!jw.info.timeless.some((j) => j.key === jw.jewel)) jw.jewel = 'vanity';
    await jwLoadLists();
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
  const mine = new Set(jw.build ? jw.build.nodes : []);
  const lines = ov.links.map(([a, b, c, d]) => `M${a} ${b}L${c} ${d}`).join('');
  const dots = ov.nodes.filter((n) => n[2] === 1 && !mine.has(n[3])).map(([x, y]) => `M${x} ${y}h0`).join('');
  const own = ov.nodes.filter((n) => mine.has(n[3])).map(([x, y]) => `M${x} ${y}h0`).join('');
  const big = ov.nodes.filter((n) => (n[2] === 2 || n[2] === 3) && !mine.has(n[3])).map(([x, y, k]) => `<circle cx="${x}" cy="${y}" r="${k === 3 ? 170 : 100}" class="${k === 3 ? 'ks' : 'nt'}"/>`).join('');
  const sockClass = (id) => { const d = jw.build && jw.build.distances ? jw.build.distances[id] : null; return d === 0 ? ' mine' : d != null && d <= 3 ? ' near' : ''; };
  const targets = pick === 'keystone'
    ? jw.info.keystones.map((k) => `<circle cx="${k.x}" cy="${k.y}" r="300" class="pick${k.id === selected ? ' on' : ''}" data-pick="${k.id}"><title>${esc(k.name)}</title></circle>`).join('')
    : jw.info.sockets.map((s) => `<circle cx="${s.x}" cy="${s.y}" r="280" class="pick${sockClass(s.id)}${s.id === selected ? ' on' : ''}" data-pick="${s.id}"><title>${esc(s.label)}${socketNote(s.id) ? ` (${esc(socketNote(s.id))})` : ''}</title></circle>`).join('');
  const at = pick === 'keystone' ? jw.info.keystones.find((k) => k.id === selected) : jwSocket(selected);
  const ring = at && reach ? `<circle cx="${at.x}" cy="${at.y}" r="${reach}" class="reach"/>` : '';
  return `<svg class="jw-ov" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}" role="img" aria-label="The passive tree. Click a ${pick === 'keystone' ? 'keystone' : 'jewel socket'} to choose it.">
    <path d="${lines}" class="ln"/><path d="${dots}" class="dot"/>${big}${own ? `<path d="${own}" class="own"/>` : ''}${ring}${targets}</svg>`;
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

// The build: import it once, and the page knows which passives count and which sockets are near.
function buildCard() {
  const b = jw.build, f = jw.bf;
  if (b && !f.open) {
    const who = [b.name, b.className, b.level ? `level ${b.level}` : '', b.skill].filter(Boolean).join(' · ');
    const jewels = (b.jewels || []).map((j, i) => {
      const def = jw.info.timeless.find((x) => x.key === j.jewel);
      return `<button type="button" class="link" data-own-jewel="${i}">Show your ${esc(def ? def.name : 'jewel')} ${j.seed}</button>`;
    }).join('');
    return `<div class="jw-build on">
      <div class="jw-build-head"><b>Your build</b><span><button type="button" class="link" data-jw="build-open">Change</button><button type="button" class="link" data-jw="build-forget">Forget</button></span></div>
      <p>${esc(who || 'Imported build')}<small>${plural(b.nodes.length, 'passive', 'passives')}, ${plural(b.sockets.length, 'jewel socket', 'jewel sockets')}. Only the passives you take are counted.</small></p>
      ${jewels}</div>`;
  }
  if (!f.open) {
    return `<button type="button" class="jw-build-cta" data-jw="build-open"><b>Use my build</b><small>Then the app counts only the passives you take, finds the sockets near your tree and judges each seed for you.</small></button>`;
  }
  const chars = f.chars ? `<ul class="jw-chars">${f.chars.length ? f.chars.map((c) => `<li><button type="button" data-char="${esc(c.name)}"><b>${esc(c.name)}</b><small>${esc(c.class)} · level ${c.level} · ${esc(c.league)}</small></button></li>`).join('') : '<li class="dim">No characters.</li>'}</ul>` : '';
  return `<div class="jw-build">
    <div class="jw-build-head"><b>Your build</b>${b || f.open ? '<button type="button" class="link" data-jw="build-close">Close</button>' : ''}</div>
    <label class="jw-label" for="jw-pob">Path of Building code or link</label>
    <textarea id="jw-pob" rows="2" placeholder="In Path of Building: Import/Export Build, Generate, Copy. Or a pobb.in link." spellcheck="false">${esc(f.text)}</textarea>
    <button type="button" class="small" data-jw="build-pob"${f.busy ? ' disabled' : ''}>Use this build</button>
    <label class="jw-label" for="jw-account">Or your pathofexile.com account <small>characters must be public</small></label>
    <div class="jw-row"><input id="jw-account" placeholder="Name#1234" value="${esc(f.account)}" autocomplete="off"><button type="button" class="small" data-jw="build-chars"${f.busy ? ' disabled' : ''}>Find</button></div>
    ${chars}
    ${f.busy ? `<p class="jw-busy"><span class="spin" aria-hidden="true"></span>${esc(f.busy)}</p>` : ''}${f.error ? `<p class="jw-err">${esc(f.error)}</p>` : ''}
  </div>`;
}

// What the player wants from the jewel, in plain choices. The build's own picks are starred.
function goalChips() {
  if (!jw.goalList.length) return '';
  const suggested = new Set(jw.build && jw.build.interests ? [...jw.build.interests.top, ...jw.build.interests.more] : []);
  const groups = [['defence', 'Defence'], ['offence', 'Offence'], ['support', 'Other']];
  return groups.map(([g, title]) => {
    const list = jw.goalList.filter((x) => x.group === g);
    if (!list.length) return '';
    return `<div class="jw-goals"><small>${title}</small><div class="chips">${list.map((x) => `<button type="button" class="${jw.goals.includes(x.key) ? 'yes' : ''}${suggested.has(x.key) ? ' sug' : ''}" data-goal="${x.key}" title="${esc(x.want.length)} kinds of stats">${suggested.has(x.key) ? '★ ' : ''}${esc(x.name)}</button>`).join('')}</div></div>`;
  }).join('');
}

function jewelGuide(j) {
  const g = j.guide || {};
  return `<details class="jw-guide" id="jw-guide"${jw.guideOpen ? ' open' : ''}>
    <summary>How ${esc(j.name)} works</summary>
    <ul class="jw-basics">${jw.info.basics.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <dl>
      <dt>Small passives</dt><dd>${esc(g.smalls || '')}</dd>
      <dt>Notables</dt><dd>${esc(g.notables || '')}</dd>
      <dt>Good for</dt><dd>${esc(g.goodFor || '')}</dd>
      <dt>Keystones</dt><dd>A keystone in the circle becomes the conqueror's keystone:
        <ul>${j.conquerors.map((c) => `<li><b>${esc(c.name)}: ${esc(c.keystone)}</b><small>${esc((c.lines || []).join(' · '))}</small></li>`).join('')}</ul></dd>
    </dl>
  </details>`;
}

function timelessSide() {
  const j = jwJewel();
  const jewels = jw.info.timeless.map((x) => `<button type="button" class="jw-pick${x.key === jw.jewel ? ' on' : ''}" data-jewel="${x.key}"><b>${esc(x.name)}</b><small>${x.min.toLocaleString()} – ${x.max.toLocaleString()}</small></button>`).join('');
  const conq = j.conquerors.map((c) => `<button type="button" class="${c.name === jw.conqueror ? 'yes' : ''}" data-conqueror="${esc(c.name)}" title="${esc(c.keystone)}: ${esc((c.lines || []).join(' · '))}">${esc(c.name)}<small>${esc(c.keystone)}</small></button>`).join('');
  // With a build, its sockets come first, nearest first.
  const sockets = jw.info.sockets.slice();
  if (jw.build) sockets.sort((a, b) => (jw.build.distances[a.id] ?? 99) - (jw.build.distances[b.id] ?? 99));
  const socketOpts = `<option value="">Choose a socket…</option>${sockets.map((s) => `<option value="${s.id}"${s.id === jw.socket ? ' selected' : ''}>${esc(s.label)}${socketNote(s.id) ? ` — ${esc(socketNote(s.id))}` : ''}</option>`).join('')}`;
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
  const scope = jw.build
    ? `<option value="near"${jw.scope === 'near' ? ' selected' : ''}>Sockets near my tree</option><option value="all"${jw.scope === 'all' ? ' selected' : ''}>Every socket</option><option value="one"${jw.scope === 'one' ? ' selected' : ''}>Only the socket below</option>`
    : `<option value="all"${jw.scope !== 'one' ? ' selected' : ''}>Every socket</option><option value="one"${jw.scope === 'one' ? ' selected' : ''}>Only the socket below</option>`;
  const find = `
    <details class="jw-more"${jw.want.length ? ' open' : ''}><summary>A specific stat <small>optional</small></summary>
    <div class="jw-statpick">
      <input id="jw-stat" placeholder="Type a stat, like life or block" autocomplete="off" value="${esc(jw.statFilter)}">
      <ul class="jw-stats" id="jw-stats">${statOptions()}</ul>
    </div>
    <ul class="jw-want">${jw.want.map((w, i) => `<li>
        <span class="jw-wname">${esc(w.tpl.replace(/#/g, 'X'))}</span>
        <label>At least <input type="number" min="0" step="any" value="${w.min || ''}" data-want-min="${i}" aria-label="At least"></label>
        <label>Weight <input type="number" min="0" step="any" value="${w.weight == null ? 1 : w.weight}" data-want-weight="${i}" aria-label="Weight"></label>
        <button type="button" class="link" data-want-drop="${i}" aria-label="Remove">×</button></li>`).join('')}</ul>
    </details>
    <div class="jw-row">
      <select id="jw-scope" aria-label="Where to look">${scope}</select>
      ${jw.build ? '' : `<label class="jw-check"><input type="checkbox" id="jw-smalls"${jw.smalls ? ' checked' : ''}> Count small passives</label>`}
    </div>
    <button type="button" class="primary jw-go" data-jw="search"${effWant().length && !jw.busy ? '' : ' disabled'}>Find the best seeds</button>`;
  return `
    ${buildCard()}
    <button type="button" class="jw-paste" data-jw="paste" title="Hover the jewel in game and press Ctrl+C first">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/></svg>
      <span><b>Paste a copied jewel</b><small>Ctrl+C on it in game, then click here</small></span></button>
    <div class="jw-seg small" role="tablist" aria-label="What to do">
      <button type="button" role="tab" data-mode="look" aria-selected="${jw.mode === 'look'}">I have a jewel</button>
      <button type="button" role="tab" data-mode="find" aria-selected="${jw.mode === 'find'}">Help me find one</button>
    </div>
    <div class="jw-jewels">${jewels}</div>
    <p class="jw-help">${esc((j.guide || {}).short || '')}</p>
    ${jewelGuide(j)}
    <span class="jw-label">What do you want from it? <small>${jw.build ? '★ = what your build takes most' : 'pick one or more'}</small></span>
    ${goalChips()}
    ${jw.mode === 'look' ? look : find}
    <label class="jw-label" for="jw-socket">Socket <small>or click one on the tree</small></label>
    <select id="jw-socket">${socketOpts}</select>
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
  const head = `<div class="p-head"><h2>Best seeds${jw.found ? ` <small>${jw.found.length ? `${jw.found.length} found${goalNames().length ? ` for ${esc(goalNames().join(', ').toLowerCase())}` : ''}` : 'none found'}</small>` : ''}</h2></div>`;
  if (!jw.found) {
    const how = jw.build
      ? 'Only the passives your build takes are counted, in the sockets near your tree.'
      : 'Tip: use your build (top left) so only the passives you take are counted.';
    return `${head}<div class="jw-pad">${busyLine()}${errLine(jw.error)}${jw.busy ? '' : `<ol class="jw-steps"><li>Pick a jewel. Not sure which? Open "How it works" under the jewels.</li><li>Pick what you want from it${jw.build ? ' (your build\'s picks are starred)' : ''}.</li><li>Press Find the best seeds. Every number the jewel can have is checked.</li></ol><p class="jw-help">${esc(how)}</p>`}</div>`;
  }
  const want = effWant();
  const weight = new Map();
  for (const w of want) weight.set(w.tpl, (weight.get(w.tpl) || 0) + (w.weight == null ? 1 : Number(w.weight)));
  const rows = jw.found.map((r) => {
    const top = Object.entries(r.totals).sort((a, b) => b[1] * (weight.get(b[0]) || 1) - a[1] * (weight.get(a[0]) || 1)).slice(0, 4);
    return `<tr>
      <td class="num"><b>${r.seed}</b></td>
      <td>${esc((jwSocket(r.socket) || {}).label || r.socket)}${socketNote(r.socket) ? `<small class="jw-dist">${esc(socketNote(r.socket))}</small>` : ''}</td>
      <td>${top.map(([tpl, v]) => `<span class="jw-got">${esc(fill(tpl, [v]))}</span>`).join('')}</td>
      <td class="num">${jw.goals.length ? `<span class="jw-score" title="About how many passives' worth of what you want">≈ ${r.score}</span>` : r.score}</td>
      <td class="num"><button type="button" class="small" data-show-seed="${r.seed}" data-show-socket="${r.socket}">Show</button></td></tr>`;
  }).join('');
  return `${head}<div class="jw-pad">${busyLine()}${errLine(jw.error)}
    ${jw.found.length ? `<p class="jw-help">The score is about how many passives' worth of what you want a seed gives. Show opens one with its verdict and price.</p>
      <div class="table-wrap"><table class="jw-table"><thead><tr><th class="num">Seed</th><th>Socket</th><th>Gives</th><th class="num">Score</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="empty">No seed gives all of that. Lower an "at least" or pick another goal.</p>'}</div>`;
}

function verdictBox() {
  const v = jw.verdict;
  if (!jw.result) return '';
  if (!effWant().length && !(v && v.notes.length)) {
    return `<div class="jw-verdict none"><b>Is this seed good for me?</b><p>Pick what you want from it on the left${jw.build ? '' : ', or use your build'} and the app tells you.</p></div>`;
  }
  if (!v) return '<div class="jw-verdict none"><p class="jw-busy"><span class="spin" aria-hidden="true"></span>Comparing with every other seed…</p></div>';
  return `<div class="jw-verdict ${v.level}"><b>${esc(v.title)}</b>${v.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>`;
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
  const mine = new Set(jw.build ? jw.build.nodes : []);
  const lines = (n) => n.parts.length ? n.parts.map((p) => `<li>${esc(fill(p.tpl, p.vals))}</li>`).join('') : '<li class="dim">No stats</li>';
  const notableRows = changed.map((n) => `<li class="jw-node${jw.taken.has(n.id) ? ' taken' : ''} m-${n.mode}" data-node="${n.id}">
      <button type="button" class="jw-tick" data-take="${n.id}" aria-pressed="${jw.taken.has(n.id)}" aria-label="Taken"></button>
      <div><b>${esc(n.name)}</b>${n.name !== n.was ? `<small>was ${esc(n.was)}</small>` : ''}${n.kind === 'keystone' ? '<small>keystone</small>' : ''}${mine.has(n.id) ? '<small class="jw-yours">yours</small>' : ''}<ul>${lines(n)}</ul></div></li>`).join('');
  const smallSum = jwTotals(smalls);
  const price = jw.price;
  const priceHtml = price && price.loading ? '<span class="dim">Asking the trade site…</span>'
    : price && price.error ? `<span class="neg">${esc(price.error)}</span>`
    : price ? `<span>${price.total ? `${plural(price.total, 'listed', 'listed')}${price.cheapest != null ? `, from <b>${esc(fmtValue(price.cheapest))}</b>` : ''}` : 'None listed right now'}</span>${price.url ? '<button type="button" class="link" data-jw="trade">Open on trade</button>' : ''}` : '';
  return `<div class="p-head"><h2>${esc(j.name)} ${r.seed} <small>${esc(r.conqueror || '')} · ${esc((jwSocket(r.socket) || {}).label || '')}${socketNote(r.socket) ? ` · ${esc(socketNote(r.socket))}` : ''}</small></h2>
      <div class="jw-actions">${back}${priceHtml}${price && !price.loading ? '' : `<button type="button" class="small" data-jw="price"${price && price.loading ? ' disabled' : ''}>Price on trade</button>`}</div></div>
    ${busyLine()}${errLine(jw.error)}
    <div class="jw-pad jw-vpad">${verdictBox()}</div>
    <div class="jw-view">
      <div class="jw-treebox">${treeSvg(r.area, r.center, r.radius, 0, (n) => {
        const hit = r.nodes.find((x) => x.id === n.id);
        if (!hit) return '';
        return `in m-${hit.mode}${jw.taken.has(n.id) ? ' taken' : ''}`;
      })}
        <p class="jw-legend"><span class="lg rep"></span>changed <span class="lg add"></span>stat added <span class="lg tk"></span>taken · click passives you take</p></div>
      <div class="jw-lists">
        <h3>What you get <small>${plural(taken.length, 'passive', 'passives')} taken</small>
          <span class="jw-quick">${jw.build ? '<button type="button" class="link" data-jw="take-mine">Mine</button>' : ''}<button type="button" class="link" data-jw="take-notables">Notables</button><button type="button" class="link" data-jw="take-all">All</button><button type="button" class="link" data-jw="take-none">None</button></span></h3>
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

// The taken passives when a seed is shown: the build's own, otherwise every notable.
function defaultTaken(r) {
  if (jw.build) { const mine = new Set(jw.build.nodes); return new Set(r.nodes.filter((n) => mine.has(n.id)).map((n) => n.id)); }
  return new Set(r.nodes.filter((n) => n.kind === 'notable').map((n) => n.id));
}

let lookToken = 0;
async function jwLook() {
  const why = jwCheck();
  jw.price = null;
  jw.verdict = null;
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
    if (!sameSpot) jw.taken = defaultTaken(r);
  } catch (e) {
    if (token !== lookToken) return;
    jw.result = null;
    jw.error = cleanErr(e);
  }
  jw.busy = '';
  jwSave();
  jwRender();
  if (jw.result) jwVerdict(token);
}

async function jwVerdict(token = lookToken) {
  if (!jw.result || (!effWant().length && !jw.build)) { jw.verdict = null; jwRenderMain(); return; }
  try {
    const v = await api.jewels({ op: 'verdict', jewel: jw.jewel, seed: jw.result.seed, conqueror: jw.conqueror, socket: jw.result.socket, want: effWant(), goals: goalNames(), nodes: jw.build ? jw.build.nodes : [], smalls: jw.smalls });
    if (token !== lookToken) return;
    jw.verdict = v;
  } catch (e) { if (token === lookToken) jw.verdict = { level: 'none', title: 'No verdict', notes: [cleanErr(e)] }; }
  jwRenderMain();
}

async function jwSearch() {
  jw.result = null;
  jw.found = null;
  jw.error = '';
  jw.busy = jwJewel().downloaded ? 'Checking every seed…' : `Getting the ${jwJewel().name} data once…`;
  jwRender();
  const sockets = jw.scope === 'one' && jw.socket ? [jw.socket] : jw.scope === 'near' && jw.build ? nearSockets() : [];
  try {
    jw.found = await api.jewels({ op: 'search', jewel: jw.jewel, want: effWant(), sockets, smalls: jw.build ? true : jw.smalls, onlyNodes: jw.build ? jw.build.nodes : null });
    jwJewel().downloaded = true;
  } catch (e) { jw.error = cleanErr(e); }
  jw.busy = '';
  jwRender();
}

// The stat lines and goals of the chosen jewel. Goals it cannot give are dropped; with a build
// and nothing chosen yet, the build's own goals are picked.
async function jwLoadLists() {
  const key = jw.jewel;
  const [lines, goals] = await Promise.all([api.jewels({ op: 'searchable', jewel: key }), api.jewels({ op: 'goals', jewel: key })]);
  if (key !== jw.jewel) return;
  jw.searchable = lines;
  jw.goalList = goals;
  const ok = new Set(lines.map((s) => s.tpl));
  jw.want = jw.want.filter((w) => ok.has(w.tpl));
  jw.goals = jw.goals.filter((k) => goals.some((g) => g.key === k));
  if (!jw.goals.length && jw.build && jw.build.interests) jw.goals = jw.build.interests.top.filter((k) => goals.some((g) => g.key === k));
  jwSave();
  jwRenderSide();
}

async function jwPrice() {
  if (!jw.result) return;
  jw.price = { loading: true };
  jwRenderMain();
  try { jw.price = await api.jewels({ op: 'price', jewel: jw.result.jewel, seed: jw.result.seed }); } catch (e) { jw.price = { error: cleanErr(e) }; }
  jwRenderMain();
}

async function jwPaste() {
  let got = null;
  try { got = await api.jewels({ op: 'paste' }); } catch (e) { got = { error: cleanErr(e) }; }
  if (!got || got.error) {
    jw.error = (got && got.error) || 'No timeless jewel was copied. Hover it in game, press Ctrl+C, then Paste.';
    jw.result = null;
    jw.mode = 'look'; // the message shows where the jewel will appear
    jwRender();
    return;
  }
  showJewel(got);
}

// Shows a jewel (pasted, or the one in the imported build): its own socket when known, otherwise
// the build's nearest socket.
async function showJewel(j) {
  const changed = j.jewel !== jw.jewel;
  Object.assign(jw, { jewel: j.jewel, seed: j.seed, conqueror: j.conqueror, mode: 'look', error: '' });
  if (j.socket) jw.socket = j.socket;
  else if (!jw.socket && jw.build) jw.socket = jw.build.sockets[0] || null;
  if (changed) await jwLoadLists();
  if (!jw.socket) { jwRender(); $('jw-socket').focus(); return; }
  jwLook();
}

// ---- the build ----
async function useBuild(get) {
  jw.bf.busy = 'Reading the build…';
  jw.bf.error = '';
  jwRenderSide();
  try {
    const b = await get();
    jw.build = b;
    jw.bf = { ...jw.bf, open: false, busy: '', error: '', chars: null, text: '' };
    jw.goals = b.interests.top.filter((k) => jw.goalList.some((g) => g.key === k));
    if (jw.scope === 'all') jw.scope = 'near';
    if (!jw.socket || jw.build.distances[jw.socket] == null) jw.socket = (b.jewels[0] && b.jewels[0].socket) || b.sockets[0] || jw.socket;
    jwSave();
    if (b.jewels.length) { showJewel(b.jewels[0]); return; }
    if (jw.result) { jw.taken = defaultTaken(jw.result); jwVerdict(); }
  } catch (e) { jw.bf.busy = ''; jw.bf.error = cleanErr(e); }
  jwRender();
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
    if (jw.mode === 'find') jw.result = null; else jwLook();
    jwRender();
    return;
  }
  const jewel = t.closest('[data-jewel]');
  if (jewel) {
    if (jewel.dataset.jewel === jw.jewel) return;
    jw.jewel = jewel.dataset.jewel; jw.seed = null; jw.conqueror = jwJewel().conquerors[0].name; jw.result = null; jw.found = null; jw.price = null; jw.error = '';
    jw.goals = jw.goals.slice(); // kept where the new jewel has them (jwLoadLists drops the rest)
    jwSave();
    jwLoadLists();
    jwRender();
    $('jw-seed') && $('jw-seed').focus();
    return;
  }
  const goal = t.closest('[data-goal]');
  if (goal) {
    const k = goal.dataset.goal;
    jw.goals = jw.goals.includes(k) ? jw.goals.filter((x) => x !== k) : [...jw.goals, k];
    jwSave();
    jwRenderSide();
    if (jw.result) { jw.verdict = null; jwRenderMain(); jwVerdict(); }
    return;
  }
  const own = t.closest('[data-own-jewel]');
  if (own && jw.build) { showJewel(jw.build.jewels[Number(own.dataset.ownJewel)]); return; }
  const ch = t.closest('[data-char]');
  if (ch) { const name = ch.dataset.char; useBuild(() => api.jewels({ op: 'character', account: jw.bf.account, name })); return; }
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
  if (add) { jw.want.push({ tpl: add.dataset.wantAdd, min: 0, weight: 1 }); jw.statFilter = ''; jwSave(); jwRenderSide(); $('jw-stat').focus(); if (jw.result) jwVerdict(); return; }
  const drop = t.closest('[data-want-drop]');
  if (drop) { jw.want.splice(Number(drop.dataset.wantDrop), 1); jwSave(); jwRenderSide(); if (jw.result) jwVerdict(); return; }
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
  else if (what === 'build-open') { jw.bf.open = true; jw.bf.error = ''; jwRenderSide(); $('jw-pob').focus(); }
  else if (what === 'build-close') { jw.bf.open = false; jwRenderSide(); }
  else if (what === 'build-forget') {
    jw.build = null; jw.goals = []; if (jw.scope === 'near') jw.scope = 'all';
    if (jw.result) jw.taken = defaultTaken(jw.result);
    jwSave(); jwRender(); if (jw.result) jwVerdict();
  } else if (what === 'build-pob') { const text = jw.bf.text; if (text.trim()) useBuild(() => api.jewels({ op: 'build', text })); }
  else if (what === 'build-chars') {
    jw.bf.busy = 'Looking up the characters…'; jw.bf.error = ''; jw.bf.chars = null; jwRenderSide();
    api.jewels({ op: 'characters', account: jw.bf.account }).then((list) => { jw.bf.chars = list; }, (e) => { jw.bf.error = cleanErr(e); })
      .finally(() => { jw.bf.busy = ''; jwSave(); jwRenderSide(); });
  }
  else if (what === 'search') jwSearch();
  else if (what === 'price') jwPrice();
  else if (what === 'trade' && jw.price && jw.price.url) api.jewels({ op: 'open', url: jw.price.url });
  else if (what === 'back') { jw.result = null; jw.price = null; jwRender(); }
  else if (what.startsWith('take-') && jw.result) {
    if (what === 'take-mine') { jw.taken = defaultTaken(jw.result); jwRenderMain(); return; }
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
  } else if (t.id === 'jw-pob') {
    jw.bf.text = t.value;
  } else if (t.id === 'jw-account') {
    jw.bf.account = t.value;
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
  if (e.target.id === 'jw-account' && e.key === 'Enter') jwClick('build-chars');
  if (e.target.id === 'jw-stat' && e.key === 'Enter') { const first = $('jw-stats').querySelector('[data-want-add]'); if (first) first.click(); }
});

function jwClick(what) { const b = jwView.querySelector(`[data-jw="${what}"]`); if (b) b.click(); }
// The guide stays open or shut across redraws ('toggle' does not bubble, so it is caught on the way down).
jwView.addEventListener('toggle', (e) => { if (e.target.id === 'jw-guide') jw.guideOpen = e.target.open; }, true);

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
