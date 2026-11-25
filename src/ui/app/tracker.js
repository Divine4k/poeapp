'use strict';
// Tracker page: ideas, things to make, work in progress and what is done. Two views: a map
// (boxes branching out from the app, moved by hand, joined by lines) and a board (columns).
// Only admins see it (state.trouble.admin). The items are GitHub issues (src/tracker.js), so
// Claude works from the same list; the lines are GitHub sub-issues, the box positions are kept
// in config.trackerLayout. Steps are the "- [ ]" lines of an issue (src/ui/steps.js).
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

const TK_COLS = [['idea', 'Ideas'], ['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
const TK_PRI = { high: 3, normal: 2, low: 1 };
let tkItems = [];
let tkLoaded = false;
let tkRepo = '';      // the repository the list was read from
let tkCfg = null;     // config.trackerRepo when it was read
let tkBusy = false;
let tkOpen = null;    // the item in the dialog (null: none)
let tkSteps = [];     // its steps while being edited
let tkDrag = null;    // number of the card being dragged
let tkUnder = null;   // the new item goes under this one (null: straight under the app)
let tkPos = {};       // where each box sits on the map right now: number or 'root' -> [x, y]
let tkMoved = {};     // moved here and sent to the settings, until the settings come back with it
let tkView = 'map';
try { tkView = localStorage.getItem('trackerView') === 'board' ? 'board' : 'map'; } catch (_) { /* storage off: the map */ }
// The map shows one layer at a time: the box you went into and what hangs straight under it.
// A box with items under it has an "N inside" button to go in; the path above the map goes back.
let tkFocus = 'root';
try { const f = Number(localStorage.getItem('trackerFocus')); if (f > 0) tkFocus = f; } catch (_) { /* start at the top */ }
const TK_STATUS = { idea: 'Idea', todo: 'To do', doing: 'In progress', done: 'Done' };

// An update from GitHub. Its parent is only taken when GitHub said it (src/tracker.js).
function tkMerge(it, item) {
  const { parent, ...rest } = item;
  Object.assign(it, rest);
  if (parent !== undefined) it.parent = parent;
}
const tkFind = (n) => tkItems.find((i) => i.number === n);
// The item's parent, if that one is in the list; otherwise it hangs straight under the app.
const tkParentKey = (i) => (i.parent != null && tkFind(i.parent) ? i.parent : 'root');
// Is item a under item b (at any depth)?
function tkUnderOf(a, b) {
  const seen = new Set();
  for (let i = tkFind(a); i && !seen.has(i.number); i = tkFind(i.parent)) {
    seen.add(i.number);
    if (i.parent === b) return true;
  }
  return false;
}
// What hangs straight under a box ('root': under the app).
const tkKids = (key) => tkItems.filter((i) => tkParentKey(i) === key);
// The layer being shown; back to the top when its item is gone.
function tkLayer() {
  if (tkFocus !== 'root' && !tkFind(tkFocus)) tkFocus = 'root';
  return tkFocus;
}
function tkGo(key) {
  tkFocus = key;
  tkUnder = null;
  try { localStorage.setItem('trackerFocus', String(key)); } catch (_) { /* not kept */ }
  $('tk-map').scrollTo(0, 0);
  tkDraw();
}
// The way from the top to the layer shown: ['root', ..., focus].
function tkTrail() {
  const out = [], seen = new Set();
  for (let k = tkLayer(); k !== 'root' && !seen.has(k); k = tkParentKey(tkFind(k))) { seen.add(k); out.unshift(k); }
  return ['root', ...out];
}
// Does the item, or anything under it, match the search? Keeps a box with a match inside lit.
function tkMatchDeep(i, q, seen = new Set()) {
  if (!q || tkMatch(i, q)) return true;
  seen.add(i.number);
  return tkKids(i.number).some((c) => !seen.has(c.number) && tkMatchDeep(c, q, seen));
}

function renderTracker() {
  const admin = !!(state.trouble && state.trouble.admin);
  $('nav-tracker').hidden = !admin;
  if (!admin) { tkLoaded = false; tkItems = []; if (!$('tab-tracker').hidden) showTab('mapping'); return; }
  // Another repository was set in Developer tools: the list is read again when the page shows.
  if (tkLoaded && state.config.trackerRepo !== tkCfg) tkLoaded = false;
}
function trackerShown() { if (tkLoaded) tkDraw(); else tkLoad(); }

function tkError(text) { $('tk-error').textContent = text || ''; $('tk-error').hidden = !text; }

async function tkLoad() {
  if (tkBusy) return;
  tkBusy = true;
  $('tk-refresh').disabled = true; $('tk-refresh').classList.add('busy');
  if (!tkLoaded) { setHtml($('tk-board'), '<p class="empty">Loading from GitHub…</p>'); setHtml($('tk-nodes'), '<p class="empty tk-loading">Loading from GitHub…</p>'); $('tk-lines').innerHTML = ''; }
  const cfg = state.config.trackerRepo;
  const r = await api.tracker({ type: 'list' });
  tkBusy = false;
  $('tk-refresh').disabled = false; $('tk-refresh').classList.remove('busy');
  if (r.error) { tkError(r.error); if (!tkLoaded) { setHtml($('tk-board'), ''); setHtml($('tk-nodes'), ''); } return; }
  tkError('');
  tkItems = r.items; tkRepo = r.repo; tkCfg = cfg; tkLoaded = true;
  tkDraw();
}

function tkSort(col) {
  return col === 'done'
    ? (a, b) => b.closed - a.closed
    : (a, b) => TK_PRI[b.priority] - TK_PRI[a.priority] || b.updated - a.updated;
}

function tkCard(i) {
  const p = i.progress;
  const tags = [
    i.priority === 'high' ? '<span class="tag warn">High</span>' : i.priority === 'low' ? '<span class="tag dimmed">Low</span>' : '',
    i.dropped ? '<span class="tag dimmed">Dropped</span>' : '',
    ...i.labels.map((l) => `<span class="tag">${esc(l)}</span>`),
  ].join('');
  return `<li><button type="button" class="tk-card pri-${i.priority}${i.dropped ? ' dropped' : ''}" draggable="true" data-tk="${i.number}">
    <span class="tk-ctitle">${esc(i.title)}</span>
    <span class="tk-cmeta"><span class="dim num">#${i.number}</span>${tags}</span>
    ${p.total ? `<span class="tk-prog"><progress max="${p.total}" value="${p.done}"></progress><small class="num">${p.done}/${p.total}</small></span>` : ''}
  </button></li>`;
}

const tkMatch = (i, q) => !q || `#${i.number} ${i.title} ${i.body} ${i.labels.join(' ')}`.toLowerCase().includes(q);

function tkDraw() {
  const map = tkView === 'map';
  for (const b of $('tk-views').querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === tkView));
  $('tk-map').hidden = !map; $('tk-hint-map').hidden = !map; $('tk-crumbs').hidden = !map || !tkLoaded;
  $('tk-board').hidden = map; $('tk-hint-board').hidden = map;
  tkUnderLine();
  if (!tkLoaded) return;
  const link = $('tk-repo');
  link.textContent = tkRepo; link.href = `https://github.com/${tkRepo}/issues`;
  if (map) tkMapDraw(); else tkBoardDraw();
}

function tkBoardDraw() {
  const q = $('tk-filter').value.trim().toLowerCase();
  const shown = tkItems.filter((i) => tkMatch(i, q));
  setHtml($('tk-board'), TK_COLS.map(([col, label]) => {
    const list = shown.filter((i) => i.status === col).sort(tkSort(col));
    return `<section class="tk-col panel" data-col="${col}" aria-label="${label}">
      <header class="tk-chead"><b>${label}</b><span class="tk-count num">${list.length}</span></header>
      <ul class="tk-list">${list.length ? list.map(tkCard).join('') : `<li class="empty">${q ? 'Nothing found.' : col === 'done' ? 'Nothing finished yet.' : 'Empty.'}</li>`}</ul>
    </section>`;
  }).join(''));
}

// Moves an item to another column at once; GitHub is told behind it.
async function tkMove(number, status) {
  const it = tkItems.find((i) => i.number === number);
  if (!it || it.status === status) return;
  const was = { status: it.status, closed: it.closed };
  Object.assign(it, { status, closed: status === 'done' ? Date.now() : 0 });
  tkDraw();
  const r = await api.tracker({ type: 'update', number, patch: { status } });
  if (r.error) { Object.assign(it, was); tkDraw(); tkError(r.error); return; }
  tkError('');
  tkMerge(it, r.item);
  tkDraw();
}

// ---- the item dialog: title, where it stands, priority, notes and steps ----
function tkStepsDraw() {
  const done = tkSteps.filter((s) => s.done).length;
  $('tk-dprog').textContent = tkSteps.length ? `${done} of ${tkSteps.length} done` : '';
  setHtml($('tk-steps'), tkSteps.length ? tkSteps.map((s, n) => `<li class="${s.done ? 'done' : ''}">
    <input type="checkbox" data-step-done="${n}"${s.done ? ' checked' : ''} aria-label="Done">
    <input class="tk-steptext" data-step-text="${n}" value="${esc(s.text)}" maxlength="300" aria-label="Step ${n + 1}">
    <button type="button" class="link" data-step-del="${n}" title="Remove this step" aria-label="Remove this step">×</button>
  </li>`).join('') : '<li class="empty">No steps yet. Break the work into steps to see how far along it is.</li>');
}

function tkOpenItem(number) {
  const it = tkItems.find((i) => i.number === number);
  if (!it) return;
  tkOpen = number;
  const f = $('tk-form'), parts = Steps.parseSteps(it.body);
  f.elements.title.value = it.title;
  f.elements.status.value = it.status;
  f.elements.priority.value = it.priority;
  f.elements.notes.value = parts.notes;
  // Part of: anything but itself and what already hangs under it.
  const opts = tkItems.filter((i) => i.number !== number && !tkUnderOf(i.number, number)).sort((a, b) => a.number - b.number);
  f.elements.parent.innerHTML = `<option value="">Nothing: straight under the app</option>${opts.map((i) => `<option value="${i.number}">#${i.number} ${esc(i.title)}</option>`).join('')}`;
  f.elements.parent.value = it.parent != null && tkFind(it.parent) ? String(it.parent) : '';
  tkSteps = parts.steps;
  $('tk-dtitle').textContent = `#${it.number}`;
  $('tk-dlink').href = it.url;
  const day = (ts) => new Date(ts).toLocaleDateString();
  $('tk-dby').textContent = `Added${it.by ? ` by ${it.by}` : ''} on ${day(it.created)}${it.closed ? `, finished on ${day(it.closed)}` : ''}`;
  $('tk-derror').hidden = true;
  $('tk-save').disabled = false;
  $('tk-stepnew').value = '';
  tkStepsDraw();
  $('tk-dialog').showModal();
}

function tkAddStep() {
  const v = $('tk-stepnew').value.trim();
  if (!v) return;
  tkSteps.push({ text: v, done: false });
  $('tk-stepnew').value = '';
  tkStepsDraw();
  $('tk-stepnew').focus();
}

$('tk-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const patch = {
    title: f.elements.title.value, status: f.elements.status.value, priority: f.elements.priority.value,
    body: Steps.joinSteps(f.elements.notes.value, tkSteps),
  };
  $('tk-save').disabled = true;
  const it = tkFind(tkOpen);
  const parent = f.elements.parent.value ? Number(f.elements.parent.value) : null;
  const r = await api.tracker({ type: 'update', number: tkOpen, patch });
  if (!r.error && it) tkMerge(it, r.item);
  const p = !r.error && it && parent !== (it.parent != null && tkFind(it.parent) ? it.parent : null) ? await api.tracker({ type: 'parent', number: tkOpen, parent }) : null;
  $('tk-save').disabled = false;
  const error = r.error || (p && p.error);
  if (error) { $('tk-derror').textContent = error; $('tk-derror').hidden = false; tkDraw(); return; }
  if (p) tkMerge(it, p.item);
  $('tk-dialog').close();
  tkDraw();
});
$('tk-cancel').addEventListener('click', () => $('tk-dialog').close());
$('tk-stepbtn').addEventListener('click', tkAddStep);
$('tk-stepnew').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tkAddStep(); } });
$('tk-steps').addEventListener('change', (e) => {
  const d = e.target.closest('[data-step-done]');
  if (d) { tkSteps[+d.dataset.stepDone].done = d.checked; tkStepsDraw(); }
});
$('tk-steps').addEventListener('input', (e) => {
  const t = e.target.closest('[data-step-text]');
  if (t) tkSteps[+t.dataset.stepText].text = t.value;
});
$('tk-steps').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('[data-step-text]')) e.preventDefault(); });
$('tk-steps').addEventListener('click', (e) => {
  const x = e.target.closest('[data-step-del]');
  if (x) { tkSteps.splice(+x.dataset.stepDel, 1); tkStepsDraw(); }
});

// ---- the board ----
$('tk-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, title = f.elements.title.value.trim();
  if (!title) return;
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  const parent = tkUnder != null ? tkUnder : tkView === 'map' && tkLayer() !== 'root' ? tkLayer() : null;
  const r = await api.tracker({ type: 'add', title, status: f.elements.status.value, parent });
  btn.disabled = false;
  if (r.error) { tkError(r.error); return; }
  tkError('');
  f.elements.title.value = '';
  tkItems.push({ ...r.item, parent: r.item.parent !== undefined ? r.item.parent : parent });
  tkUnder = null;
  tkDraw();
});
$('tk-refresh').addEventListener('click', tkLoad);
$('tk-filter').addEventListener('input', tkDraw);
$('tk-views').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  tkView = b.dataset.view;
  try { localStorage.setItem('trackerView', tkView); } catch (_) { /* not kept */ }
  tkDraw();
});
$('tk-under-clear').addEventListener('click', () => { tkUnder = null; tkUnderLine(); });
$('tk-board').addEventListener('click', (e) => {
  const c = e.target.closest('[data-tk]');
  if (c) tkOpenItem(+c.dataset.tk);
});
$('tk-board').addEventListener('dragstart', (e) => {
  const c = e.target.closest('[data-tk]');
  if (!c) return;
  tkDrag = +c.dataset.tk;
  c.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(tkDrag));
});
$('tk-board').addEventListener('dragover', (e) => {
  const col = tkDrag != null && e.target.closest('[data-col]');
  if (!col) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  for (const c of $('tk-board').querySelectorAll('.tk-col.drop')) if (c !== col) c.classList.remove('drop');
  col.classList.add('drop');
});
$('tk-board').addEventListener('dragleave', (e) => {
  const col = e.target.closest('[data-col]');
  if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop');
});
$('tk-board').addEventListener('drop', (e) => {
  const col = tkDrag != null && e.target.closest('[data-col]');
  if (!col) return;
  e.preventDefault();
  const n = tkDrag;
  tkDrag = null;
  tkMove(n, col.dataset.col);
});
$('tk-board').addEventListener('dragend', () => {
  tkDrag = null;
  for (const c of $('tk-board').querySelectorAll('.drop, .dragging')) c.classList.remove('drop', 'dragging');
});

// ---- the map: boxes branching out from the app, joined by lines ----
// Where the new item goes, shown in front of the add field.
function tkUnderLine() {
  const it = tkUnder != null && tkFind(tkUnder);
  if (tkUnder != null && !it) tkUnder = null;
  // Inside a layer, new items go into it unless + on a box said otherwise.
  const layer = !it && tkView === 'map' && tkLoaded && tkLayer() !== 'root' && tkFind(tkLayer());
  const shown = it || layer;
  $('tk-under').hidden = !shown;
  $('tk-under-name').textContent = shown ? `#${shown.number} ${shown.title}` : '';
  $('tk-under-clear').hidden = !it;
}

// The path above the map: every layer from the top down to the one shown, each one a button.
function tkCrumbs() {
  const trail = tkTrail();
  setHtml($('tk-crumbs'), trail.map((k, n) => {
    const name = k === 'root' ? 'Map Companion' : tkFind(k).title;
    return n === trail.length - 1
      ? `<b aria-current="page">${esc(name)}</b>`
      : `<button type="button" class="link" data-crumb="${k}">${esc(name)}</button><span class="tk-sep" aria-hidden="true">›</span>`;
  }).join(''));
}

// Positions are kept per layer ("layer/box"), so a box can sit elsewhere in each layer.
const tkLayoutKey = (key) => `${tkLayer()}/${key}`;

// Boxes not moved by hand yet: the layer's own box on the left, what hangs under it in columns
// of up to 8 on the right (open items first), so a big layer fits without scrolling far; the
// layer's box halfway along the first column.
function tkAutoLayout(height, focus, kids) {
  const pos = {};
  const per = Math.ceil(kids.length / Math.ceil(kids.length / 8 || 1));
  let y = 40, bottom = 40;
  kids.forEach((c, n) => {
    if (n % per === 0) y = 40;
    pos[c.number] = [380 + Math.floor(n / per) * 270, y];
    y += height(c.number) + 14;
    if (n < per) bottom = y;
  });
  const mid = kids.length ? (40 + bottom - 14) / 2 : 40 + height(focus) / 2;
  pos[focus] = [40, Math.max(40, Math.round(mid - height(focus) / 2))];
  return pos;
}

function tkMapDraw() {
  const q = $('tk-filter').value.trim().toLowerCase();
  const focus = tkLayer();
  const saved = { ...(state.config.trackerLayout || {}), ...tkMoved };
  const kids = tkKids(focus).sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.number - b.number);
  const node = (i, own) => {
    const p = i.progress, inside = tkKids(i.number), open = inside.filter((c) => c.status !== 'done').length;
    return `<div class="tk-node st-${i.status} pri-${i.priority}${i.dropped ? ' dropped' : ''}${own ? ' focus' : ''}${own || tkMatchDeep(i, q) ? '' : ' faded'}" data-node="${i.number}" tabindex="0" role="button" aria-label="#${i.number} ${esc(i.title)}">
      <span class="tk-ntitle">${esc(i.title)}</span>
      <span class="tk-nmeta"><span class="num">#${i.number}</span><span class="tk-st">${i.dropped ? 'Dropped' : TK_STATUS[i.status]}</span>${i.priority === 'high' ? '<span class="tag warn">High</span>' : ''}${p.total ? `<small class="num">${p.done}/${p.total}</small>` : ''}</span>
      ${p.total ? `<progress max="${p.total}" value="${p.done}"></progress>` : ''}
      ${!own && inside.length ? `<button type="button" class="tk-into" data-into="${i.number}" title="Open what hangs under this">${inside.length} inside${open < inside.length ? `, ${inside.length - open} done` : ''} <span aria-hidden="true">›</span></button>` : ''}
      <button type="button" class="tk-plus" data-plus="${i.number}" title="Add something under this" aria-label="Add something under #${i.number}">+</button>
      <span class="tk-plug" data-plug="${i.number}" title="Drag onto another box to hang it under this one"></span>
    </div>`;
  };
  const all = tkItems.filter((i) => i.status !== 'done').length;
  const head = focus === 'root'
    ? `<div class="tk-node root" data-node="root" tabindex="0" role="button" aria-label="Map Companion">
      <span class="tk-ntitle">Map Companion</span>
      <span class="tk-nmeta">${all} open, ${tkItems.length - all} done</span>
      <button type="button" class="tk-plus" data-plus="root" title="Add something straight under the app" aria-label="Add something straight under the app">+</button>
      <span class="tk-plug" data-plug="root" title="Drag onto a box to hang it straight under the app"></span>
    </div>`
    : node(tkFind(focus), true);
  setHtml($('tk-nodes'), head + kids.map((i) => node(i, false)).join('') + (kids.length ? '' : '<p class="empty tk-loading tk-nothing">Nothing under this yet. Use + or the field above to add something.</p>'));
  tkCrumbs();
  tkUnderLine();
  // Laid out once the boxes are drawn, so each one's real height is known.
  const els = new Map([...$('tk-nodes').querySelectorAll('[data-node]')].map((el) => [tkKey(el.dataset.node), el]));
  const auto = tkAutoLayout((k) => (els.get(k) ? els.get(k).offsetHeight : 60), focus, kids);
  // A box moved by hand keeps its place; one never moved sits where the layout puts it,
  // shifted as far as the layer's own box was moved, so the layer stays together.
  const own = (k) => (Array.isArray(saved[tkLayoutKey(k)]) ? saved[tkLayoutKey(k)].slice(0, 2) : null);
  tkPos = {};
  tkPos[focus] = own(focus) || auto[focus];
  const shift = [tkPos[focus][0] - auto[focus][0], tkPos[focus][1] - auto[focus][1]];
  for (const c of kids) tkPos[c.number] = own(c.number) || [auto[c.number][0] + shift[0], Math.max(0, auto[c.number][1] + shift[1])];
  for (const el of els.values()) tkPlace(el);
  tkLines();
}

const tkKey = (v) => (v === 'root' ? 'root' : Number(v));
function tkPlace(el) {
  const [x, y] = tkPos[tkKey(el.dataset.node)] || [40, 40];
  el.style.left = `${x}px`; el.style.top = `${y}px`;
}

// A curve from the right edge of the parent to the left edge of the child.
function tkCurve(x1, y1, x2, y2) {
  const d = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`;
}
// The lines between boxes: straight out of the parent, a wide rounded bend, straight into the
// child. Children of one box bend at the same place, so their lines run together like a trunk.
function tkBranchPath(x1, y1, x2, y2) {
  if (x2 < x1 + 16) return tkCurve(x1, y1, x2, y2); // child moved left of its parent: a plain curve
  const dy = y2 - y1;
  if (Math.abs(dy) < 1) return `M${x1},${y1} H${x2}`;
  const mx = x1 + Math.min(44, (x2 - x1) / 2); // where the bend is (halfway when boxes are close)
  // Wide, round bends up to 26px, eased with a cubic so they flow into the straight parts.
  const r = Math.min(26, Math.abs(dy) / 2, mx - x1, x2 - mx), s = Math.sign(dy), k = r * 0.6;
  return `M${x1},${y1} H${mx - r} C${mx - r + k},${y1} ${mx},${y1 + s * (r - k)} ${mx},${y1 + s * r} V${y2 - s * r} C${mx},${y2 - s * (r - k)} ${mx + r - k},${y2} ${mx + r},${y2} H${x2}`;
}
function tkBox(key) {
  const el = $('tk-nodes').querySelector(`[data-node="${key}"]`);
  return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;
}
function tkLines(temp) {
  let maxX = 0, maxY = 0;
  for (const el of $('tk-nodes').querySelectorAll('[data-node]')) { maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth); maxY = Math.max(maxY, el.offsetTop + el.offsetHeight); }
  const canvas = $('tk-canvas'), svg = $('tk-lines');
  canvas.style.width = `${maxX + 240}px`; canvas.style.height = `${maxY + 160}px`;
  svg.setAttribute('width', maxX + 240); svg.setAttribute('height', maxY + 160);
  const paths = tkItems.map((i) => {
    const a = tkBox(tkParentKey(i)), b = tkBox(i.number);
    if (!a || !b) return '';
    const d = tkBranchPath(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2);
    // A wide see-through line under the drawn one, so it is easy to click.
    return `<path class="tk-hit" data-line="${i.number}" d="${d}"><title>Click to take #${i.number} off here</title></path><path class="tk-line st-${i.status}" d="${d}"/>`;
  });
  svg.innerHTML = paths.join('') + (temp ? `<path class="tk-line temp" d="${temp}"/>` : '');
}

// Pointer on the map: move a box (and what hangs under it), connect from a dot, take a line
// off, or drag the empty map around.
let tkGesture = null;
function tkCanvasPoint(e) { const r = $('tk-canvas').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
// What moves along with a box: the layer's own box takes the whole layer, any other box itself.
const tkBranch = (key) => (key === tkLayer() ? Object.keys(tkPos).map(tkKey) : [key]);
function tkTargetAt(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const n = el && el.closest('#tk-nodes [data-node]');
  return n ? tkKey(n.dataset.node) : null;
}

$('tk-map').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('[data-plus], [data-into]')) return;
  const map = $('tk-map');
  const plug = e.target.closest('[data-plug]');
  const line = e.target.closest('[data-line]');
  const box = e.target.closest('[data-node]');
  if (line) {
    const n = Number(line.dataset.line), it = tkFind(n), p = it && tkFind(it.parent);
    if (p && window.confirm(`Take #${n} off #${p.number}? It then hangs straight under the app.`)) tkLink(n, null);
    return;
  }
  e.preventDefault();
  map.setPointerCapture(e.pointerId);
  if (plug) tkGesture = { kind: 'link', from: tkKey(plug.dataset.plug) };
  else if (box) {
    const key = tkKey(box.dataset.node), [x0, y0] = tkCanvasPoint(e);
    tkGesture = { kind: 'move', key, x0, y0, moved: false, start: Object.fromEntries(tkBranch(key).map((k) => [k, (tkPos[k] || [40, 40]).slice()])) };
  } else tkGesture = { kind: 'pan', x0: e.clientX, y0: e.clientY, sl: map.scrollLeft, st: map.scrollTop };
});
$('tk-map').addEventListener('pointermove', (e) => {
  const g = tkGesture;
  if (!g) return;
  const map = $('tk-map');
  if (g.kind === 'pan') { map.scrollLeft = g.sl - (e.clientX - g.x0); map.scrollTop = g.st - (e.clientY - g.y0); map.classList.add('panning'); return; }
  if (g.kind === 'move') {
    const [x, y] = tkCanvasPoint(e), dx = x - g.x0, dy = y - g.y0;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    for (const [k, [sx, sy]] of Object.entries(g.start)) {
      tkPos[tkKey(k)] = [Math.max(0, Math.round(sx + dx)), Math.max(0, Math.round(sy + dy))];
      const el = $('tk-nodes').querySelector(`[data-node="${k}"]`);
      if (el) { tkPlace(el); el.classList.add('dragging'); }
    }
    tkLines();
    return;
  }
  // Connecting: a line follows the pointer, the box under it lights up.
  const a = tkBox(g.from), [x, y] = tkCanvasPoint(e);
  const t = tkTargetAt(e);
  for (const el of $('tk-nodes').querySelectorAll('.drop')) el.classList.remove('drop');
  if (t != null && t !== 'root' && t !== g.from) { const el = $('tk-nodes').querySelector(`[data-node="${t}"]`); if (el) el.classList.add('drop'); }
  if (a) tkLines(tkCurve(a.x + a.w, a.y + a.h / 2, x, y));
});
function tkGestureEnd(e, cancelled) {
  const g = tkGesture;
  tkGesture = null;
  if (!g) return;
  $('tk-map').classList.remove('panning');
  for (const el of $('tk-nodes').querySelectorAll('.drop, .dragging')) el.classList.remove('drop', 'dragging');
  if (g.kind === 'move') {
    if (!g.moved) { if (!cancelled && g.key !== 'root') tkOpenItem(g.key); return; }
    const layout = { ...(state.config.trackerLayout || {}) };
    for (const k of Object.keys(g.start)) layout[tkLayoutKey(k)] = tkMoved[tkLayoutKey(k)] = tkPos[tkKey(k)];
    api.setConfig({ trackerLayout: layout });
    return;
  }
  if (g.kind !== 'link') return;
  tkLines();
  const t = cancelled ? null : tkTargetAt(e);
  if (t == null || t === 'root' || t === g.from) return;
  if (g.from !== 'root' && tkUnderOf(g.from, t)) { tkError(`#${g.from} already hangs under #${t}, so #${t} cannot go under it. Move #${g.from} somewhere else first.`); return; }
  tkLink(t, g.from === 'root' ? null : g.from);
}
$('tk-map').addEventListener('pointerup', (e) => tkGestureEnd(e, false));
$('tk-map').addEventListener('pointercancel', (e) => tkGestureEnd(e, true));
$('tk-map').addEventListener('click', (e) => {
  const into = e.target.closest('[data-into]');
  if (into) { tkGo(Number(into.dataset.into)); return; }
  const plus = e.target.closest('[data-plus]');
  if (!plus) return;
  tkUnder = plus.dataset.plus === 'root' ? null : Number(plus.dataset.plus);
  tkUnderLine();
  $('tk-add').elements.title.focus();
});
$('tk-crumbs').addEventListener('click', (e) => {
  const c = e.target.closest('[data-crumb]');
  if (c) tkGo(tkKey(c.dataset.crumb));
});
$('tk-map').addEventListener('keydown', (e) => {
  // Backspace or Escape on the map: one layer up.
  if ((e.key === 'Backspace' || e.key === 'Escape') && tkLayer() !== 'root') { e.preventDefault(); const t = tkTrail(); tkGo(t[t.length - 2]); return; }
  const box = e.target.closest('[data-node]');
  if (box && box.dataset.node !== 'root' && (e.key === 'Enter' || e.key === ' ') && e.target === box) { e.preventDefault(); tkOpenItem(Number(box.dataset.node)); }
});

// Hangs item `number` under `parent` (null: straight under the app) at once; GitHub is told behind it.
async function tkLink(number, parent) {
  const it = tkFind(number);
  if (!it || (it.parent ?? null) === parent) return;
  const was = it.parent;
  it.parent = parent;
  tkDraw();
  const r = await api.tracker({ type: 'parent', number, parent });
  if (r.error) { it.parent = was; tkDraw(); tkError(r.error); return; }
  tkError('');
  tkMerge(it, r.item);
  tkDraw();
}
