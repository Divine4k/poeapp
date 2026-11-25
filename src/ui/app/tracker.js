'use strict';
// Tracker page: ideas, things to make, work in progress and what is done. Two views: a map
// (boxes branching out from the app, moved by hand, joined by lines) and a board (columns).
// Only admins see it (state.trouble.admin). The items are GitHub issues (src/tracker.js), so
// Claude works from the same list; the lines are GitHub sub-issues, the box positions are kept
// in config.trackerLayout. Steps are the "- [ ]" lines of an issue (src/ui/steps.js).
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// Every status in order, and the board's four columns: each holds a few statuses, the first is
// what a card dropped into the column gets.
const TK_STATUS = { idea: 'Idea', considering: 'Considering', todo: 'To do', doing: 'In progress', testing: 'Testing', hold: 'On hold', blocked: 'Blocked', done: 'Done', dropped: 'Dropped' };
const TK_COLS = [['idea', 'Ideas', ['idea', 'considering']], ['todo', 'To do', ['todo', 'blocked', 'hold']], ['doing', 'In progress', ['doing', 'testing']], ['done', 'Done', ['done', 'dropped']]];
const tkClosed = (i) => i.status === 'done' || i.status === 'dropped';
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

// An update from GitHub. Its parent is only taken when GitHub said it (src/tracker.js).
function tkMerge(it, item) {
  const { parent, ...rest } = item;
  Object.assign(it, rest);
  if (parent !== undefined) it.parent = parent;
  tkChanged();
}
// Look-ups by number and by parent. Built once after the list changes (tkChanged) and used by
// every draw, search and drag, so none of them scans the whole list for each box.
let tkIdx = null;
function tkIndex() {
  if (tkIdx && tkIdx.list === tkItems && tkIdx.size === tkItems.length) return tkIdx;
  const by = new Map(tkItems.map((i) => [i.number, i])), kids = new Map();
  for (const i of tkItems) {
    const k = i.parent != null && by.has(i.parent) ? i.parent : 'root';
    if (kids.has(k)) kids.get(k).push(i); else kids.set(k, [i]);
  }
  return (tkIdx = { list: tkItems, size: tkItems.length, by, kids });
}
// Call after an item's parent changes or the list is replaced.
function tkChanged() { tkIdx = null; }
const tkFind = (n) => tkIndex().by.get(n);
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
const tkKids = (key) => (tkIndex().kids.get(key) || []).slice();
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
  // Moderators have only Troubleshooting in Developer tools: no page switch for them.
  $('dev-bar').hidden = !admin || ($('tab-trouble').hidden && $('tab-tracker').hidden);
  if (!admin) { tkLoaded = false; tkItems = []; tkChanged(); if (!$('tab-tracker').hidden) showTab('mapping'); return; }
  // Another repository was set in Developer tools: the list is read again when the page shows.
  if (tkLoaded && state.config.trackerRepo !== tkCfg) tkLoaded = false;
  // A recording was put in a box (or taken out) since the list was read: read it again.
  if (tkLoaded && state.trouble && state.trouble.marksRev !== tkMarks) tkLoaded = false;
}
let tkMarks = -1;
function trackerShown() { if (tkLoaded) tkDraw(); else tkLoad(); }
// Opens the tracker on one box (from a recording on the Troubleshooting page).
async function trackerOpenItem(number) {
  showTab('tracker');
  if (!tkLoaded) await tkLoad();
  if (tkFind(number)) tkOpenItem(number);
}

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
  tkItems = r.items; tkRepo = r.repo; tkCfg = cfg; tkLoaded = true; tkChanged();
  tkMarks = state.trouble ? state.trouble.marksRev : -1;
  tkDraw();
}

function tkSort(col) {
  return col === 'done'
    ? (a, b) => b.closed - a.closed
    : (a, b) => TK_PRI[b.priority] - TK_PRI[a.priority] || b.updated - a.updated;
}

// How many troubleshooting recordings are connected to a box.
const tkRecTag = (i) => ((i.recordings || []).length ? `<span class="tag tk-rec" title="${i.recordings.length} recording${i.recordings.length === 1 ? '' : 's'} or report${i.recordings.length === 1 ? '' : 's'} connected">▶ ${i.recordings.length}</span>` : '');
function tkCard(i, col) {
  const p = i.progress;
  const tags = [
    i.priority === 'high' ? '<span class="tag warn">High</span>' : i.priority === 'low' ? '<span class="tag dimmed">Low</span>' : '',
    i.status !== col ? `<span class="tag tk-sttag st-${i.status}">${TK_STATUS[i.status]}</span>` : '',
    ...i.labels.map((l) => `<span class="tag">${esc(l)}</span>`),
  ].join('');
  return `<li><button type="button" class="tk-card pri-${i.priority}${i.status === 'dropped' ? ' dropped' : ''}" draggable="true" data-tk="${i.number}">
    <span class="tk-ctitle">${esc(i.title)}</span>
    <span class="tk-cmeta"><span class="dim num">#${i.number}</span>${tkRecTag(i)}${tags}</span>
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
  setHtml($('tk-board'), TK_COLS.map(([col, label, has]) => {
    const list = shown.filter((i) => has.includes(i.status)).sort(tkSort(col));
    return `<section class="tk-col panel" data-col="${col}" aria-label="${label}">
      <header class="tk-chead"><b>${label}</b><span class="tk-count num">${list.length}</span></header>
      <ul class="tk-list">${list.length ? list.map((i) => tkCard(i, col)).join('') : `<li class="empty">${q ? 'Nothing found.' : col === 'done' ? 'Nothing finished yet.' : 'Empty.'}</li>`}</ul>
    </section>`;
  }).join(''));
}

// Moves an item to another column at once; GitHub is told behind it.
async function tkMove(number, status) {
  const it = tkItems.find((i) => i.number === number);
  const col = TK_COLS.find((c) => c[0] === status);
  if (!it || it.status === status || (col && col[2].includes(it.status))) return; // already in that column
  const was = { status: it.status, closed: it.closed, dropped: it.dropped };
  Object.assign(it, { status, dropped: status === 'dropped', closed: status === 'done' || status === 'dropped' ? Date.now() : 0 });
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
  const it = tkFind(number);
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
  // The recordings connected to it, each opened on the Troubleshooting page.
  const recs = it.recordings || [];
  $('tk-recs').hidden = !recs.length;
  setHtml($('tk-reclist'), recs.map((id) => `<li class="tk-recrow" data-rec-row="${esc(id)}"><button type="button" class="tk-watch" data-watch="${esc(id)}">▶ Watch</button><span class="tk-recnote dim">${esc(id)}</span></li>`).join(''));
  tkRecNotes(recs);
  $('tk-dtitle').textContent = `#${it.number}`;
  $('tk-dlink').href = it.url;
  const day = (ts) => new Date(ts).toLocaleDateString();
  $('tk-dby').textContent = `Added${it.by ? ` by ${it.by}` : ''} on ${day(it.created)}${it.closed ? `, ${it.status === 'dropped' ? 'dropped' : 'finished'} on ${day(it.closed)}` : ''}`;
  $('tk-delete').disabled = false;
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
// Delete for good (GitHub needs admin rights on the token for this; src/tracker.js deleteItem).
$('tk-delete').addEventListener('click', async () => {
  const it = tkFind(tkOpen);
  if (!it) return;
  const inside = tkKids(it.number).length;
  if (!window.confirm(`Delete #${it.number} "${it.title}" for good? It cannot be brought back.${inside ? ` The ${inside} item${inside === 1 ? '' : 's'} under it move to the top of the map.` : ''}\n\nTo keep it but put it aside, set it to Dropped instead.`)) return;
  $('tk-delete').disabled = true;
  const r = await api.tracker({ type: 'delete', number: it.number });
  $('tk-delete').disabled = false;
  if (r.error) { $('tk-derror').textContent = r.error; $('tk-derror').hidden = false; return; }
  for (const c of tkItems) if (c.parent === it.number) c.parent = null;
  tkItems = tkItems.filter((i) => i !== it);
  tkChanged();
  $('tk-dialog').close();
  tkDraw();
});
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
  tkChanged();
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
  const kids = tkKids(focus).sort((a, b) => tkClosed(a) - tkClosed(b) || a.number - b.number);
  const node = (i, own) => {
    const p = i.progress, inside = tkKids(i.number), open = inside.filter((c) => !tkClosed(c)).length;
    return `<div class="tk-node st-${i.status} pri-${i.priority}${i.status === 'dropped' ? ' dropped' : ''}${own ? ' focus' : ''}${own || tkMatchDeep(i, q) ? '' : ' faded'}" data-node="${i.number}" tabindex="0" role="button" aria-label="#${i.number} ${esc(i.title)}">
      <span class="tk-ntitle">${esc(i.title)}</span>
      <span class="tk-nmeta"><span class="num">#${i.number}</span><span class="tk-st">${TK_STATUS[i.status]}</span>${tkRecTag(i)}${i.priority === 'high' ? '<span class="tag warn">High</span>' : ''}${p.total ? `<small class="num">${p.done}/${p.total}</small>` : ''}</span>
      ${p.total ? `<progress max="${p.total}" value="${p.done}"></progress>` : ''}
      ${!own && inside.length ? `<button type="button" class="tk-into" data-into="${i.number}" title="Open what hangs under this">${inside.length} inside${open < inside.length ? `, ${inside.length - open} finished` : ''} <span aria-hidden="true">›</span></button>` : ''}
      <button type="button" class="tk-plus" data-plus="${i.number}" title="Add something under this" aria-label="Add something under #${i.number}">+</button>
      <span class="tk-plug" data-plug="${i.number}" title="Drag onto another box to hang it under this one"></span>
    </div>`;
  };
  const all = tkItems.filter((i) => !tkClosed(i)).length;
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
  const els = tkEls = new Map([...$('tk-nodes').querySelectorAll('[data-node]')].map((el) => [tkKey(el.dataset.node), el]));
  // Measured once per draw (the only time a box changes size); moving boxes never measures.
  tkSize = new Map([...els].map(([k, el]) => [k, [el.offsetWidth, el.offsetHeight]]));
  const auto = tkAutoLayout((k) => (tkSize.has(k) ? tkSize.get(k)[1] : 60), focus, kids);
  // A box moved by hand keeps its place; one never moved sits where the layout puts it,
  // shifted as far as the layer's own box was moved, so the layer stays together.
  const own = (k) => (Array.isArray(saved[tkLayoutKey(k)]) ? saved[tkLayoutKey(k)].slice(0, 2) : null);
  tkPos = {};
  tkPos[focus] = own(focus) || auto[focus];
  const shift = [tkPos[focus][0] - auto[focus][0], tkPos[focus][1] - auto[focus][1]];
  for (const c of kids) tkPos[c.number] = own(c.number) || [auto[c.number][0] + shift[0], Math.max(0, auto[c.number][1] + shift[1])];
  for (const el of els.values()) tkPlace(el);
  tkLinesNow();
}

const tkKey = (v) => (v === 'root' ? 'root' : Number(v));
let tkEls = new Map();   // the boxes on the map right now: number or 'root' -> element
let tkSize = new Map();  // their sizes: number or 'root' -> [width, height]
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
// Where a box is, from what the map already knows: no measuring, so it costs nothing while dragging.
function tkBox(key) {
  const p = tkPos[key], z = tkSize.get(key);
  return p && z ? { x: p[0], y: p[1], w: z[0], h: z[1] } : null;
}
let tkCanvasSize = '';
function tkLines(temp) {
  let maxX = 0, maxY = 0;
  for (const k of tkSize.keys()) { const b = tkBox(k); if (b) { maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); } }
  const canvas = $('tk-canvas'), svg = $('tk-lines');
  const size = `${maxX + 240}x${maxY + 160}`;
  if (size !== tkCanvasSize) {
    tkCanvasSize = size;
    canvas.style.width = `${maxX + 240}px`; canvas.style.height = `${maxY + 160}px`;
    svg.setAttribute('width', maxX + 240); svg.setAttribute('height', maxY + 160);
  }
  // Only the boxes of the layer shown have lines; the rest of the list is not on the map.
  const paths = [];
  for (const k of tkSize.keys()) {
    const i = k === 'root' ? null : tkFind(k);
    if (!i) continue;
    const a = tkBox(tkParentKey(i)), b = tkBox(k);
    if (!a || !b) continue;
    const d = tkBranchPath(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2);
    // A wide see-through line under the drawn one, so it is easy to click.
    paths.push(`<path class="tk-hit" data-line="${i.number}" d="${d}"><title>Click to take #${i.number} off here</title></path><path class="tk-line st-${i.status}" d="${d}"/>`);
  }
  svg.innerHTML = paths.join('') + (temp ? `<path class="tk-line temp" d="${temp}"/>` : '');
}
// While a box or a line is dragged the lines are drawn once per screen refresh, however many
// pointer movements arrive in between.
let tkLinesFrame = 0, tkLinesTemp;
function tkLinesSoon(temp) {
  tkLinesTemp = temp;
  if (!tkLinesFrame) tkLinesFrame = requestAnimationFrame(() => { tkLinesFrame = 0; tkLines(tkLinesTemp); });
}
function tkLinesNow(temp) { if (tkLinesFrame) { cancelAnimationFrame(tkLinesFrame); tkLinesFrame = 0; } tkLines(temp); }

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
      const el = tkEls.get(tkKey(k));
      if (el) { tkPlace(el); if (!g.marked) el.classList.add('dragging'); }
    }
    g.marked = true;
    tkLinesSoon();
    return;
  }
  // Connecting: a line follows the pointer, the box under it lights up.
  const a = tkBox(g.from), [x, y] = tkCanvasPoint(e);
  const t = tkTargetAt(e);
  const over = t != null && t !== 'root' && t !== g.from ? tkEls.get(t) : null;
  if (over !== g.over) { if (g.over) g.over.classList.remove('drop'); if (over) over.classList.add('drop'); g.over = over; }
  if (a) tkLinesSoon(tkCurve(a.x + a.w, a.y + a.h / 2, x, y));
});
function tkGestureEnd(e, cancelled) {
  const g = tkGesture;
  tkGesture = null;
  if (!g) return;
  $('tk-map').classList.remove('panning');
  for (const el of $('tk-nodes').querySelectorAll('.drop, .dragging')) el.classList.remove('drop', 'dragging');
  if (g.kind === 'move') {
    if (!g.moved) { if (!cancelled && g.key !== 'root') tkOpenItem(g.key); return; }
    tkLinesNow();
    const layout = { ...(state.config.trackerLayout || {}) };
    for (const k of Object.keys(g.start)) layout[tkLayoutKey(k)] = tkMoved[tkLayoutKey(k)] = tkPos[tkKey(k)];
    api.setConfig({ trackerLayout: layout });
    return;
  }
  if (g.kind !== 'link') return;
  tkLinesNow();
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
  it.parent = parent; tkChanged();
  tkDraw();
  const r = await api.tracker({ type: 'parent', number, parent });
  if (r.error) { it.parent = was; tkChanged(); tkDraw(); tkError(r.error); return; }
  tkError('');
  tkMerge(it, r.item);
  tkDraw();
}

// Each connected recording's note in the list (read from this PC; ones not here yet are
// fetched from GitHub first).
async function tkRecNotes(ids, synced = false) {
  let missing = false;
  for (const id of ids) {
    const d = await api.troubleDetails(id);
    const row = $('tk-reclist').querySelector(`[data-rec-row="${CSS.escape(id)}"] .tk-recnote`);
    if (!row) return;
    if (!d) { missing = true; continue; }
    const first = String(d.note || '').trim().split('\n')[0] || 'No note';
    row.textContent = `${d.type === 'suggestion' ? 'Suggestion' : d.kind === 'note' ? 'Report' : 'Recording'} by ${d.by || 'someone'}: ${first}`;
    row.classList.remove('dim');
  }
  if (missing && !synced) { await act({ type: 'troubleSync', quiet: true }); tkRecNotes(ids, true); }
}

// Watching one in the tracker: its video and note in a window of their own.
let tkVUrl = null;
let tkVId = null;
async function tkWatch(id) {
  tkVId = id;
  const v = $('tk-vvideo');
  v.pause(); v.removeAttribute('src'); v.load();
  if (tkVUrl) { URL.revokeObjectURL(tkVUrl); tkVUrl = null; }
  $('tk-vpics').hidden = true; setHtml($('tk-vpics'), '');
  $('tk-viewer').showModal();
  let d = await api.troubleDetails(id);
  if (!d) { $('tk-vwait').hidden = false; $('tk-vwait').textContent = 'Fetching it from GitHub…'; await act({ type: 'troubleSync', quiet: true }); d = await api.troubleDetails(id); }
  if (tkVId !== id) return;
  if (!d) { $('tk-vwait').textContent = 'This one is not on GitHub any more, or was removed from your list.'; v.hidden = true; return; }
  const note = d.kind === 'note';
  $('tk-vtitle').textContent = `${d.type === 'suggestion' ? 'Suggestion' : note ? 'Report' : 'Recording'} by ${d.by || 'someone'}`;
  $('tk-vfacts').textContent = [new Date(d.startedAt).toLocaleString(), note ? null : `${Math.round((d.endedAt - d.startedAt) / 1000)} s`].filter(Boolean).join(' · ');
  $('tk-vnote').textContent = d.note || 'No note.';
  $('tk-vnotehead').textContent = d.type === 'suggestion' ? 'The idea' : 'What went wrong';
  v.hidden = note || !d.video;
  $('tk-vwait').hidden = note || !d.video;
  if (note) {
    // A written report: its pictures instead of a video.
    const cells = [];
    for (const name of d.images || []) {
      const bytes = await api.troubleImage(id, name);
      if (!bytes || tkVId !== id) continue;
      const ext = name.split('.').pop();
      cells.push(`<figure class="tr-pic"><img src="${esc(URL.createObjectURL(new Blob([bytes], { type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` })))}" alt="${esc(name)}"></figure>`);
    }
    $('tk-vpics').hidden = !cells.length;
    setHtml($('tk-vpics'), cells.join(''));
    return;
  }
  if (!d.video) return;
  $('tk-vwait').textContent = d.remote ? 'Fetching the video…' : 'Loading the video…';
  const bytes = await api.troubleVideo(id);
  if (tkVId !== id) return;
  if (!bytes) { $('tk-vwait').textContent = 'The video could not be fetched.'; return; }
  $('tk-vwait').hidden = true;
  tkVUrl = URL.createObjectURL(new Blob([bytes], { type: String(d.video.mime || 'video/webm').split(';')[0] }));
  v.src = tkVUrl;
}
// A video recorded in pieces does not know how long it is until it has been to the end once.
$('tk-vvideo').addEventListener('loadedmetadata', () => {
  const v = $('tk-vvideo');
  if (v.duration !== Infinity) return;
  const back = () => { v.removeEventListener('durationchange', back); v.currentTime = 0; };
  v.addEventListener('durationchange', back);
  v.currentTime = 1e101;
});
function tkVClose() { const v = $('tk-vvideo'); v.pause(); $('tk-viewer').close(); }
$('tk-vclose').addEventListener('click', tkVClose);
$('tk-viewer').addEventListener('close', () => $('tk-vvideo').pause());
$('tk-vfull').addEventListener('click', async () => {
  const id = tkVId;
  tkVClose();
  $('tk-dialog').close();
  showTab('trouble');
  await trLoadList();
  if (trList.some((r) => r.id === id)) trOpen(id);
});
$('tk-reclist').addEventListener('click', (e) => {
  const b = e.target.closest('[data-watch]');
  if (b) tkWatch(b.dataset.watch);
});
