'use strict';
// Tracker page: ideas, things to make, work in progress and what is done, split over tabs the
// owner makes (listed on the left). Two views of a tab: a map (all its boxes, moved by hand,
// joined by lines) and a board (columns). Right-click on a box for quick changes.
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
// Tabs (owner's wish in 0.55): the boxes are split over tabs the owner makes himself (Main,
// Jewels, Trading...), listed down the left of the map. A tab shows all its boxes at once, flat,
// joined by lines; no boxes inside boxes. A box's tab is its own label "tab: <name>"
// (src/tracker.js), or its parent's tab when it has none, or Main.
let tkTab = 'Main';
try { tkTab = localStorage.getItem('trackerTab') || 'Main'; } catch (_) { /* start on Main */ }
let tkHideDone = false;
try { tkHideDone = localStorage.getItem('trackerHideDone') === '1'; } catch (_) { /* show everything */ }
let tkShown = new Set(); // the boxes on the tab shown right now (numbers)
let tkTabEdit = null;    // a tab being named: { mode: 'new' } or { mode: 'rename', name }

// An update from GitHub. Its parent is only taken when GitHub said it (src/tracker.js).
function tkMerge(it, item) {
  const { parent, ...rest } = item;
  Object.assign(it, rest);
  if (parent !== undefined) it.parent = parent;
  tkChanged();
}
// Look-ups by number, and each item's tab. Built once after the list changes (tkChanged) and
// used by every draw, search and drag, so none of them scans the whole list for each box.
let tkIdx = null;
function tkIndex() {
  if (tkIdx && tkIdx.list === tkItems && tkIdx.size === tkItems.length) return tkIdx;
  const by = new Map(tkItems.map((i) => [i.number, i])), tabs = new Map();
  const tabOf = (i, seen) => {
    if (tabs.has(i.number)) return tabs.get(i.number);
    let t = i.tab || '';
    if (!t) {
      const p = i.parent != null ? by.get(i.parent) : null;
      seen.add(i.number);
      t = p && !seen.has(p.number) ? tabOf(p, seen) : 'Main';
    }
    tabs.set(i.number, t);
    return t;
  };
  for (const i of tkItems) tabOf(i, new Set());
  return (tkIdx = { list: tkItems, size: tkItems.length, by, tabs });
}
// Call after an item's parent or tab changes or the list is replaced.
function tkChanged() { tkIdx = null; }
const tkFind = (n) => tkIndex().by.get(n);
const tkTabOf = (i) => tkIndex().tabs.get(i.number) || 'Main';
// The box a line comes from on the tab shown: the item's parent when that is on the tab too,
// otherwise the tab's own box on the left.
const tkParentKey = (i) => (i.parent != null && tkShown.has(i.parent) ? i.parent : 'root');
// Is item a under item b (at any depth)?
function tkUnderOf(a, b) {
  const seen = new Set();
  for (let i = tkFind(a); i && !seen.has(i.number); i = tkFind(i.parent)) {
    seen.add(i.number);
    if (i.parent === b) return true;
  }
  return false;
}
// Every tab: Main, then the ones made here in their order, then any found on the boxes only.
function tkTabs() {
  const out = ['Main'];
  for (const t of state.config.trackerTabs || []) if (t && !out.includes(t)) out.push(t);
  for (const t of tkIndex().tabs.values()) if (!out.includes(t)) out.push(t);
  return out;
}
// A tab name as GitHub labels take it (the same rule as cleanTab in src/tracker.js).
const tkCleanTab = (name) => String(name || '').replace(/[\r\n,]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
function tkGoTab(name) {
  tkTab = name;
  tkUnder = null;
  try { localStorage.setItem('trackerTab', name); } catch (_) { /* not kept */ }
  $('tk-map').scrollTo(0, 0);
  tkDraw();
}

function renderTracker() {
  const admin = !!(state.trouble && state.trouble.admin);
  // Moderators have Developer tools without the Tracker (devBar in render.js).
  devBar();
  if (!admin) { tkLoaded = false; tkItems = []; tkChanged(); if (!$('tab-tracker').hidden) showTab('mapping'); return; }
  // Another repository was set in Developer tools: the list is read again when the page shows.
  if (tkLoaded && state.config.trackerRepo !== tkCfg) tkLoaded = false;
  // A recording was put in a box (or taken out) since the list was read: read it again, in the
  // background, keeping what is on screen (until 0.55.1 the page stopped drawing changes until
  // it was opened again, so new boxes and edits seemed to do nothing).
  if (tkLoaded && state.trouble && state.trouble.marksRev !== tkMarks) {
    tkMarks = state.trouble.marksRev;
    if (!$('tab-tracker').hidden) tkLoad(); else tkStale = true;
  }
}
let tkStale = false;
let tkMarks = -1;
function trackerShown() { if (tkLoaded && !tkStale) tkDraw(); else tkLoad(); }
// Opens the tracker on one box (from a recording on the Troubleshooting page).
async function trackerOpenItem(number) {
  showTab('tracker');
  if (!tkLoaded) await tkLoad();
  const it = tkFind(number);
  if (!it) return;
  if (tkTabOf(it) !== tkTab) tkGoTab(tkTabOf(it));
  tkOpenItem(number);
}

function tkError(text) { $('tk-error').textContent = text || ''; $('tk-error').hidden = !text; }

// One reading at a time; whoever asks while one runs gets that one (so "read it again, then
// draw" never draws the old list).
let tkLoading = null;
function tkLoad() { return tkLoading || (tkLoading = tkLoadNow().finally(() => { tkLoading = null; })); }
async function tkLoadNow() {
  tkBusy = true;
  $('tk-refresh').disabled = true; $('tk-refresh').classList.add('busy');
  if (!tkLoaded) { setHtml($('tk-board'), '<p class="empty">Loading from GitHub…</p>'); setHtml($('tk-nodes'), '<p class="empty tk-loading">Loading from GitHub…</p>'); $('tk-lines').innerHTML = ''; }
  const cfg = state.config.trackerRepo;
  const r = await api.tracker({ type: 'list' });
  tkBusy = false;
  $('tk-refresh').disabled = false; $('tk-refresh').classList.remove('busy');
  if (r.error) { tkError(r.error); if (!tkLoaded) { setHtml($('tk-board'), ''); setHtml($('tk-nodes'), ''); } return; }
  tkError('');
  tkItems = r.items; tkRepo = r.repo; tkCfg = cfg; tkLoaded = true; tkStale = false; tkChanged();
  tkMarks = state.trouble ? state.trouble.marksRev : -1;
  tkDraw();
}

function tkSort(col) {
  return col === 'done'
    ? (a, b) => b.closed - a.closed
    : (a, b) => TK_PRI[b.priority] - TK_PRI[a.priority] || b.updated - a.updated;
}

// How many troubleshooting recordings are connected to a box.
const tkNoteTag = (i) => (i.notes ? `<span class="tag tk-notetag" title="${i.notes} note${i.notes === 1 ? '' : 's'} over time">✎ ${i.notes}</span>` : '');
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
    <span class="tk-cmeta"><span class="dim num">#${i.number}</span>${tkRecTag(i)}${tkNoteTag(i)}${tags}</span>
    ${p.total ? `<span class="tk-prog"><progress max="${p.total}" value="${p.done}"></progress><small class="num">${p.done}/${p.total}</small></span>` : ''}
  </button></li>`;
}

const tkMatch = (i, q) => !q || `#${i.number} ${i.title} ${i.body} ${i.labels.join(' ')}`.toLowerCase().includes(q);

function tkDraw() {
  const map = tkView === 'map';
  for (const b of $('tk-views').querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === tkView));
  $('tk-hidedone').setAttribute('aria-pressed', String(tkHideDone));
  $('tk-map').hidden = !map; $('tk-hint-map').hidden = !map;
  $('tk-board').hidden = map; $('tk-hint-board').hidden = map;
  tkUnderLine();
  if (!tkLoaded) return;
  if (!tkTabs().includes(tkTab)) tkTab = 'Main';
  const link = $('tk-repo');
  link.textContent = tkRepo; link.href = `https://github.com/${tkRepo}/issues`;
  tkTabsDraw();
  if (map) tkMapDraw(); else tkBoardDraw();
}

// The list of tabs down the left: each with how many open boxes it has; + New tab at the end.
function tkTabsDraw() {
  const open = new Map();
  for (const i of tkItems) if (!tkClosed(i)) { const t = tkTabOf(i); open.set(t, (open.get(t) || 0) + 1); }
  const edit = tkTabEdit;
  const input = (value) => `<input class="tk-tabinput" id="tk-tabinput" maxlength="40" value="${esc(value)}" placeholder="Tab name" aria-label="Tab name" spellcheck="false" autocomplete="off">`;
  setHtml($('tk-tabs'), tkTabs().map((t) => (edit && edit.mode === 'rename' && edit.name === t
    ? input(t)
    : `<div class="tk-tab${t === tkTab ? ' on' : ''}" data-tabname="${esc(t)}" role="button" tabindex="0" aria-current="${t === tkTab}"${t === 'Main' ? '' : ' title="Double-click to rename. Drop a box here to move it to this tab."'}>
      <span class="tk-tabname">${esc(t === 'Main' ? 'Main' : t)}</span><span class="tk-tabcount num">${open.get(t) || ''}</span>${t === 'Main' ? '' : `<button type="button" class="tk-tabx" data-tabdel="${esc(t)}" title="Remove this tab (its boxes go back to Main)" aria-label="Remove the tab ${esc(t)}">×</button>`}
    </div>`)).join('') + (edit && edit.mode === 'new' ? input('') : '<button type="button" class="tk-newtab" id="tk-newtab">+ New tab</button>'));
  const inp = $('tk-tabinput');
  if (inp && document.activeElement !== inp) { inp.focus(); inp.select(); }
}

function tkBoardDraw() {
  const q = $('tk-filter').value.trim().toLowerCase();
  const shown = tkItems.filter((i) => tkTabOf(i) === tkTab && tkMatch(i, q));
  const cols = tkHideDone ? TK_COLS.filter((c) => c[0] !== 'done') : TK_COLS;
  setHtml($('tk-board'), cols.map(([col, label, has]) => {
    const list = shown.filter((i) => has.includes(i.status)).sort(tkSort(col));
    return `<section class="tk-col panel" data-col="${col}" aria-label="${label}">
      <header class="tk-chead"><b>${label}</b><span class="tk-count num">${list.length}</span></header>
      <ul class="tk-list">${list.length ? list.map((i) => tkCard(i, col)).join('') : `<li class="empty">${q ? 'Nothing found.' : col === 'done' ? 'Nothing finished yet.' : 'Empty.'}</li>`}</ul>
    </section>`;
  }).join(''));
}

// Moves an item to another column (or, with exact, to that very status) at once; GitHub is
// told behind it.
async function tkMove(number, status, exact = false) {
  const it = tkFind(number);
  const col = !exact && TK_COLS.find((c) => c[0] === status);
  if (!it || it.status === status || (col && col[2].includes(it.status))) return; // already there
  const was = { status: it.status, closed: it.closed, dropped: it.dropped };
  Object.assign(it, { status, dropped: status === 'dropped', closed: status === 'done' || status === 'dropped' ? Date.now() : 0 });
  tkDraw();
  const r = await api.tracker({ type: 'update', number, patch: { status } });
  if (r.error) { Object.assign(it, was); tkDraw(); tkError(r.error); return; }
  tkError('');
  tkMerge(it, r.item);
  tkDraw();
}
async function tkSetPriority(number, priority) {
  const it = tkFind(number);
  if (!it || it.priority === priority) return;
  const was = it.priority;
  it.priority = priority;
  tkDraw();
  const r = await api.tracker({ type: 'update', number, patch: { priority } });
  if (r.error) { it.priority = was; tkDraw(); tkError(r.error); return; }
  tkError('');
  tkMerge(it, r.item);
  tkDraw();
}
// Puts a box (and what hangs under it without a tab of its own) on another tab. Going to Main
// while its parent stays on another tab also takes it off that parent, or it would follow it back.
async function tkSetTab(number, tab) {
  const it = tkFind(number);
  if (!it || tkTabOf(it) === tab) return;
  const was = { tab: it.tab, parent: it.parent };
  const p = it.parent != null ? tkFind(it.parent) : null;
  const detach = tab === 'Main' && p && tkTabOf(p) !== 'Main';
  it.tab = tab === 'Main' ? '' : tab;
  if (detach) it.parent = null;
  tkChanged();
  tkDraw();
  const r = await api.tracker({ type: 'update', number, patch: { tab } });
  const r2 = !r.error && detach ? await api.tracker({ type: 'parent', number, parent: null }) : null;
  const error = r.error || (r2 && r2.error);
  if (error) { Object.assign(it, was); tkChanged(); tkDraw(); tkError(error); return; }
  tkError('');
  tkMerge(it, r.item);
  if (r2) tkMerge(it, r2.item);
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
  f.elements.tab.innerHTML = tkTabs().map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  f.elements.tab.value = tkTabOf(it);
  f.elements.parent.innerHTML = `<option value="">Nothing: straight under the tab</option>${opts.map((i) => `<option value="${i.number}">#${i.number} ${esc(i.title)}</option>`).join('')}`;
  f.elements.parent.value = it.parent != null && tkFind(it.parent) ? String(it.parent) : '';
  tkSteps = parts.steps;
  tkTags = it.labels.slice();
  tkTagsDraw();
  tkRecDraw(it);
  $('tk-recpick').hidden = true;
  tkNotesLoad(number);
  $('tk-notenew').value = '';
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
  if (it && tkTags.join('\n') !== it.labels.join('\n')) patch.tags = tkTags;
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
  if (it && f.elements.tab.value && f.elements.tab.value !== tkTabOf(it)) tkSetTab(it.number, f.elements.tab.value);
});
$('tk-cancel').addEventListener('click', () => $('tk-dialog').close());

// ---- more in the box window: tags, recordings, notes over time, duplicate ----
let tkTags = [];
function tkTagsDraw() {
  setHtml($('tk-tags'), tkTags.map((t, n) => `<span class="tag tk-tag">${esc(t)}<button type="button" class="link" data-tagdel="${n}" aria-label="Remove the tag ${esc(t)}">×</button></span>`).join(''));
  // Every tag used anywhere, offered while typing.
  const all = new Set();
  for (const i of tkItems) for (const l of i.labels) all.add(l);
  setHtml($('tk-taglist'), [...all].sort().map((t) => `<option value="${esc(t)}">`).join(''));
}
$('tk-tagnew').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const t = e.target.value.replace(/[\r\n,]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (t && !/^tab:/i.test(t) && !tkTags.some((x) => x.toLowerCase() === t.toLowerCase()) && tkTags.length < 10) tkTags.push(t);
  e.target.value = '';
  tkTagsDraw();
});
$('tk-tags').addEventListener('click', (e) => {
  const x = e.target.closest('[data-tagdel]');
  if (x) { tkTags.splice(Number(x.dataset.tagdel), 1); tkTagsDraw(); }
});

// The recordings and reports connected to the box: watch one, take one out, connect another.
function tkRecDraw(it) {
  const recs = (it && it.recordings) || [];
  setHtml($('tk-reclist'), recs.length ? recs.map((id) => `<li class="tk-recrow" data-rec-row="${esc(id)}"><button type="button" class="tk-watch" data-watch="${esc(id)}">▶ Watch</button><span class="tk-recnote dim">${esc(id)}</span><button type="button" class="link tk-untrack" data-untrack="${esc(id)}" title="Take it out of this box (the recording stays)">Take out</button></li>`).join('') : '<li class="empty">None yet. Connect a recording or report sent from the Troubleshooting page.</li>');
  tkRecNotes(recs);
}
const tkRecWhat = (r) => (r.type === 'suggestion' ? 'Suggestion' : r.kind === 'note' ? 'Report' : 'Recording');
async function tkRecPick() {
  const box = $('tk-recpick');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  setHtml(box, '<p class="empty">Looking for recordings…</p>');
  const it = tkFind(tkOpen), have = new Set((it && it.recordings) || []);
  const list = ((await api.troubleList()) || []).filter((r) => r.sent && !have.has(r.id));
  if (tkFind(tkOpen) !== it) return;
  setHtml(box, list.length ? `<ul>${list.slice(0, 60).map((r) => {
    const first = String(r.note || '').trim().split('\n')[0] || 'No note';
    return `<li><button type="button" class="tk-recopt" data-recpick="${esc(r.id)}"><b>${tkRecWhat(r)}</b> <span class="dim">${esc(r.by || 'someone')}, ${new Date(r.startedAt).toLocaleDateString()}${r.issue ? `, in #${r.issue}` : ''}</span><span class="tk-recline">${esc(first)}</span></button></li>`;
  }).join('')}</ul>` : '<p class="empty">Nothing to connect: only recordings and reports sent from the Troubleshooting page can go into a box.</p>');
}
$('tk-recadd').addEventListener('click', tkRecPick);
$('tk-recpick').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-recpick]');
  if (!b) return;
  const n = tkOpen;
  b.disabled = true;
  await act({ type: 'troubleTrack', id: b.dataset.recpick, issue: n });
  await tkLoad();
  $('tk-recpick').hidden = true;
  if (tkOpen === n) tkRecDraw(tkFind(n));
});
$('tk-reclist').addEventListener('click', async (e) => {
  const x = e.target.closest('[data-untrack]');
  if (!x) return;
  const n = tkOpen;
  if (!await askYes('Take this recording out of the box? The recording itself stays.', { yes: 'Take it out' })) return;
  await act({ type: 'troubleUntrack', id: x.dataset.untrack });
  await tkLoad();
  if (tkOpen === n) tkRecDraw(tkFind(n));
});

// Notes over time: the issue's comments on GitHub, newest last, each with who and when.
async function tkNotesLoad(number) {
  $('tk-ncount').textContent = '';
  setHtml($('tk-notes'), '<li class="empty">Loading…</li>');
  const r = await api.tracker({ type: 'notes', number });
  if (tkOpen !== number) return;
  if (r.error) { setHtml($('tk-notes'), `<li class="empty">${esc(r.error)}</li>`); return; }
  tkNotesDraw(r.notes);
}
let tkNotesShown = [];
function tkNotesDraw(notes) {
  tkNotesShown = notes;
  $('tk-ncount').textContent = notes.length ? String(notes.length) : '';
  setHtml($('tk-notes'), notes.length ? notes.map((n) => `<li><div class="tk-nhead"><b>${esc(n.by || 'someone')}</b><span class="dim">${new Date(n.at).toLocaleString()}</span></div><p>${esc(n.text)}</p></li>`).join('') : '<li class="empty">No notes yet. Add what you find, try or decide along the way; it keeps its date.</li>');
  const list = $('tk-notes');
  list.scrollTop = list.scrollHeight;
}
async function tkNoteAdd() {
  const text = $('tk-notenew').value.trim(), n = tkOpen;
  if (!text) return;
  $('tk-notebtn').disabled = true;
  const r = await api.tracker({ type: 'addNote', number: n, text });
  $('tk-notebtn').disabled = false;
  if (r.error) { $('tk-derror').textContent = r.error; $('tk-derror').hidden = false; return; }
  const it = tkFind(n);
  if (it) { it.notes = (it.notes || 0) + 1; tkDraw(); }
  if (tkOpen !== n) return;
  $('tk-notenew').value = '';
  tkNotesDraw([...tkNotesShown, r.note]);
}
$('tk-notebtn').addEventListener('click', tkNoteAdd);
// Ctrl+Enter adds the note; Enter alone makes a new line.
$('tk-notenew').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); tkNoteAdd(); } });

// A copy of a box: same text, status, priority, tags, tab and place.
async function tkDuplicate(number) {
  const it = tkFind(number);
  if (!it) return '';
  const r = await api.tracker({ type: 'add', title: `${it.title} (copy)`.slice(0, 200), body: it.body, status: it.status, priority: it.priority, parent: it.parent != null ? it.parent : null, tab: it.parent == null && tkTabOf(it) !== 'Main' ? tkTabOf(it) : undefined });
  if (r.error) return r.error;
  let item = { ...r.item, parent: r.item.parent !== undefined ? r.item.parent : it.parent };
  if (it.labels.length) { const t = await api.tracker({ type: 'update', number: item.number, patch: { tags: it.labels } }); if (!t.error) item = { ...item, ...t.item, parent: item.parent }; }
  tkItems.push(item);
  tkChanged();
  tkDraw();
  return '';
}
$('tk-dup').addEventListener('click', async () => {
  const n = tkOpen;
  $('tk-dup').disabled = true;
  const error = await tkDuplicate(n);
  $('tk-dup').disabled = false;
  if (error) { $('tk-derror').textContent = error; $('tk-derror').hidden = false; return; }
  $('tk-dialog').close();
  tkOpenItem(Math.max(...tkItems.map((i) => i.number)));
});
// Delete for good (GitHub needs admin rights on the token for this; src/tracker.js deleteItem).
// Asks first. Returns an error text, or '' when it went (or the question was answered No).
async function tkDeleteItem(number) {
  const it = tkFind(number);
  if (!it) return '';
  const inside = tkItems.filter((c) => c.parent === it.number).length;
  if (!await askYes(`Delete #${it.number} "${it.title}" for good? It cannot be brought back.${inside ? ` The ${inside} item${inside === 1 ? '' : 's'} under it stay, no longer connected to it.` : ''}\n\nTo keep it but put it aside, set it to Dropped instead.`, { yes: 'Delete', danger: true })) return '';
  const r = await api.tracker({ type: 'delete', number: it.number });
  if (r.error) return r.error;
  for (const c of tkItems) if (c.parent === it.number) { c.parent = null; if (!c.tab && tkTabOf(it) !== 'Main') c.tab = tkTabOf(it); }
  tkItems = tkItems.filter((i) => i !== it);
  tkChanged();
  tkDraw();
  return '';
}
$('tk-delete').addEventListener('click', async () => {
  $('tk-delete').disabled = true;
  const error = await tkDeleteItem(tkOpen);
  $('tk-delete').disabled = false;
  if (error) { $('tk-derror').textContent = error; $('tk-derror').hidden = false; return; }
  if (!tkFind(tkOpen)) $('tk-dialog').close();
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
  // On the tab shown: under the box whose + was pressed (it takes that box's tab), or straight
  // under the tab with the tab's label.
  const parent = tkUnder;
  const tab = parent == null && tkTab !== 'Main' ? tkTab : undefined;
  const r = await api.tracker({ type: 'add', title, status: f.elements.status.value, parent, tab });
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

// ---- the map: one tab at a time, every box on it, joined by lines ----
// Where the new item goes, shown in front of the add field (after + on a box).
function tkUnderLine() {
  const it = tkUnder != null && tkFind(tkUnder);
  if (tkUnder != null && !it) tkUnder = null;
  $('tk-under').hidden = !it;
  $('tk-under-name').textContent = it ? `#${it.number} ${it.title}` : '';
}

// Positions are kept per tab ("<tab>/<box>"); Main uses "root/", as the top layer did before 0.55,
// so boxes placed there by hand keep their place.
const tkLayoutKey = (key) => `${tkTab === 'Main' ? 'root' : `tab:${tkTab}`}/${key}`;

// Boxes not moved by hand yet are laid out as a tree: one column per level, each parent
// halfway along its children (open ones first). height(key): the box's drawn height.
// The tab itself is the map's left edge (0.60, owner's idea: "a tab is technically a box"): a
// rail with connector dots there, a line from it to each box straight on the tab.
const TK_EDGE = 14;
function tkAutoLayout(height, list) {
  const kids = new Map();
  for (const i of list) { const k = tkParentKey(i); if (kids.has(k)) kids.get(k).push(i); else kids.set(k, [i]); }
  for (const l of kids.values()) l.sort((a, b) => tkClosed(a) - tkClosed(b) || a.number - b.number);
  const pos = {}, seen = new Set();
  let next = 40;
  const place = (key, depth) => {
    seen.add(key);
    const h = height(key);
    const ch = (kids.get(key) || []).filter((c) => !seen.has(c.number));
    let mid;
    if (!ch.length) { mid = next + h / 2; next += h + 14; } else { const ms = ch.map((c) => place(c.number, depth + 1)); mid = (ms[0] + ms[ms.length - 1]) / 2; next = Math.max(next, mid + h / 2 + 14); }
    pos[key] = [TK_EDGE + 70 + (depth - 1) * 300, Math.round(mid - h / 2)];
    return mid;
  };
  place('root', 0);
  delete pos.root; // the tab has no box of its own: its edge is the map's left side
  return pos;
}

function tkMapDraw() {
  const q = $('tk-filter').value.trim().toLowerCase();
  const saved = { ...(state.config.trackerLayout || {}), ...tkMoved };
  const list = tkItems.filter((i) => tkTabOf(i) === tkTab && !(tkHideDone && tkClosed(i)));
  tkShown = new Set(list.map((i) => i.number));
  const node = (i) => {
    const p = i.progress;
    return `<div class="tk-node st-${i.status} pri-${i.priority}${i.status === 'dropped' ? ' dropped' : ''}${tkMatch(i, q) ? '' : ' faded'}" data-node="${i.number}" tabindex="0" role="button" aria-label="#${i.number} ${esc(i.title)}">
      <span class="tk-ntitle">${esc(i.title)}</span>
      <span class="tk-nmeta"><span class="num">#${i.number}</span><span class="tk-st">${TK_STATUS[i.status]}</span>${tkRecTag(i)}${tkNoteTag(i)}${i.priority === 'high' ? '<span class="tag warn">High</span>' : ''}${i.labels.slice(0, 2).map((l) => `<span class="tag">${esc(l)}</span>`).join('')}${p.total ? `<small class="num">${p.done}/${p.total}</small>` : ''}</span>
      ${p.total ? `<progress max="${p.total}" value="${p.done}"></progress>` : ''}
      <button type="button" class="tk-plus" data-plus="${i.number}" title="Add something under this" aria-label="Add something under #${i.number}">+</button>
      <span class="tk-plug" data-plug="${i.number}" title="Drag onto another box to connect it under this one"></span>
    </div>`;
  };
  const all = tkItems.filter((i) => tkTabOf(i) === tkTab);
  setHtml($('tk-nodes'), list.map(node).join('') + (list.length ? '' : `<p class="empty tk-loading tk-nothing">${all.length ? 'Everything on this tab is finished (Hide finished is on).' : 'Nothing on this tab yet. Add something with the field above, or drag a box onto this tab from another one.'}</p>`));
  tkUnderLine();
  // Laid out once the boxes are drawn, so each one's real height is known.
  const els = tkEls = new Map([...$('tk-nodes').querySelectorAll('[data-node]')].map((el) => [tkKey(el.dataset.node), el]));
  // Measured once per draw (the only time a box changes size); moving boxes never measures.
  tkSize = new Map([...els].map(([k, el]) => [k, [el.offsetWidth, el.offsetHeight]]));
  const auto = tkAutoLayout((k) => (tkSize.has(k) ? tkSize.get(k)[1] : 60), list);
  // A box moved by hand keeps its place; one never moved sits where the tree puts it, shifted as
  // far as its parent was moved, so a branch stays together under a moved box.
  const own = (k) => (Array.isArray(saved[tkLayoutKey(k)]) ? saved[tkLayoutKey(k)].slice(0, 2) : null);
  tkPos = {};
  const kids = new Map();
  for (const i of list) { const k = tkParentKey(i); if (kids.has(k)) kids.get(k).push(i.number); else kids.set(k, [i.number]); }
  const placeAt = (key, shift) => {
    tkPos[key] = own(key) || [Math.max(0, auto[key][0] + shift[0]), Math.max(0, auto[key][1] + shift[1])];
    const next = [tkPos[key][0] - auto[key][0], tkPos[key][1] - auto[key][1]];
    for (const c of kids.get(key) || []) if (!(c in tkPos) && auto[c]) placeAt(c, next);
  };
  for (const c of kids.get('root') || []) if (auto[c]) placeAt(c, [0, 0]);
  for (const k of Object.keys(auto)) if (!(k in tkPos)) tkPos[k] = auto[k];
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
  const height = maxY + 160;
  const paths = [`<path class="tk-rail" d="M${TK_EDGE},0 V${height}"/>`], dots = [];
  for (const k of tkSize.keys()) {
    const i = tkFind(k), b = tkBox(k);
    if (!i || !b) continue;
    const my = Math.round(b.y + b.h / 2);
    if (tkParentKey(i) === 'root') {
      // Straight on the tab: a line from the edge, with its dot there.
      paths.push(`<path class="tk-line st-${i.status}" d="M${TK_EDGE},${my} H${b.x}"/>`);
      dots.push(my);
      continue;
    }
    const a = tkBox(tkParentKey(i));
    if (!a) continue;
    const d = tkBranchPath(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2);
    paths.push(`<path class="tk-hit" data-line="${i.number}" d="${d}"><title>Click to take #${i.number} off here</title></path><path class="tk-line st-${i.status}" d="${d}"/>`);
  }
  // Spare dots every so often down the edge, to drag from wherever is handy.
  for (let y = 60; y < height - 20; y += 120) if (!dots.some((d) => Math.abs(d - y) < 45)) dots.push(y);
  const dot = (y) => `<circle class="tk-edgedot" data-plug="root" data-y="${y}" cx="${TK_EDGE}" cy="${y}" r="5"><title>Drag onto a box to put it straight on this tab</title></circle>`;
  svg.innerHTML = paths.join('') + dots.map(dot).join('') + (temp ? `<path class="tk-line temp" d="${temp}"/>` : '');
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
// off, drag the empty map around, or drop a box on a tab in the list on the left.
let tkGesture = null;
function tkCanvasPoint(e) { const r = $('tk-canvas').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
// What moves along with a box: everything under it on this tab (the tab's own box: all of it).
function tkBranch(key) {
  if (key === 'root') return Object.keys(tkPos).map(tkKey);
  const out = [key];
  const kids = new Map();
  for (const n of tkShown) { const k = tkParentKey(tkFind(n)); if (kids.has(k)) kids.get(k).push(n); else kids.set(k, [n]); }
  for (let n = 0; n < out.length; n++) for (const c of kids.get(out[n]) || []) if (!out.includes(c)) out.push(c);
  return out;
}
function tkTargetAt(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const n = el && el.closest('#tk-nodes [data-node]');
  return n ? tkKey(n.dataset.node) : null;
}
// The tab under the pointer while a box is dragged; looked up only when the pointer is over the
// list of tabs, so moving a box over the map stays cheap.
function tkTabAt(e, g) {
  if (!g.tabs || e.clientX > g.tabs.right || e.clientX < g.tabs.left || e.clientY < g.tabs.top || e.clientY > g.tabs.bottom) return null;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const t = el && el.closest('[data-tabname]');
  return t && t.dataset.tabname !== tkTab ? t : null;
}

$('tk-map').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('[data-plus]')) return;
  tkMenuClose();
  const map = $('tk-map');
  const plug = e.target.closest('[data-plug]');
  const line = e.target.closest('[data-line]');
  const box = e.target.closest('[data-node]');
  if (line) {
    const n = Number(line.dataset.line), it = tkFind(n), p = it && tkFind(it.parent);
    if (p) askYes(`Take #${n} off #${p.number}? It stays on this tab, straight under it.`, { yes: 'Take it off' }).then((ok) => { if (ok) tkLink(n, null); });
    return;
  }
  e.preventDefault();
  map.setPointerCapture(e.pointerId);
  if (plug) tkGesture = { kind: 'link', from: tkKey(plug.dataset.plug), fromY: Number(plug.dataset.y) || 0 };
  else if (box) {
    const key = tkKey(box.dataset.node), [x0, y0] = tkCanvasPoint(e);
    tkGesture = { kind: 'move', key, x0, y0, moved: false, tabs: key === 'root' ? null : $('tk-tabs').getBoundingClientRect(), start: Object.fromEntries(tkBranch(key).map((k) => [k, (tkPos[k] || [40, 40]).slice()])) };
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
    const tab = tkTabAt(e, g);
    if (tab !== g.tab) { if (g.tab) g.tab.classList.remove('drop'); if (tab) tab.classList.add('drop'); g.tab = tab; }
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
  const a = g.from === 'root' ? { x: TK_EDGE, w: 0, y: g.fromY, h: 0 } : tkBox(g.from), [x, y] = tkCanvasPoint(e);
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
  if (g.tab) g.tab.classList.remove('drop');
  if (g.kind === 'move') {
    if (!g.moved) { if (!cancelled && g.key !== 'root') tkOpenItem(g.key); return; }
    // Dropped on a tab in the list: the box goes there, and its place here is not kept.
    if (g.tab && !cancelled) {
      for (const [k, p] of Object.entries(g.start)) tkPos[tkKey(k)] = p;
      tkSetTab(g.key, g.tab.dataset.tabname);
      return;
    }
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
  if (g.from !== 'root' && tkUnderOf(g.from, t)) { tkError(`#${g.from} already hangs under #${t}, so #${t} cannot go under it. Take #${g.from} off its line first.`); return; }
  tkLink(t, g.from === 'root' ? null : g.from);
}
$('tk-map').addEventListener('pointerup', (e) => tkGestureEnd(e, false));
$('tk-map').addEventListener('pointercancel', (e) => tkGestureEnd(e, true));
$('tk-map').addEventListener('click', (e) => {
  const plus = e.target.closest('[data-plus]');
  if (!plus) return;
  tkUnder = plus.dataset.plus === 'root' ? null : Number(plus.dataset.plus);
  tkUnderLine();
  $('tk-add').elements.title.focus();
});
$('tk-map').addEventListener('keydown', (e) => {
  const box = e.target.closest('[data-node]');
  if (box && box.dataset.node !== 'root' && (e.key === 'Enter' || e.key === ' ') && e.target === box) { e.preventDefault(); tkOpenItem(Number(box.dataset.node)); }
});

// Hangs item `number` under `parent` (null: straight under the tab) at once; GitHub is told
// behind it. Taken off a parent on another tab than Main, it gets that tab as its own, so it
// does not fall back to Main.
async function tkLink(number, parent) {
  const it = tkFind(number);
  if (!it || (it.parent ?? null) === parent) return;
  const tab = tkTabOf(it);
  const keep = parent == null && !it.tab && tab !== 'Main';
  const was = { parent: it.parent, tab: it.tab };
  it.parent = parent;
  if (keep) it.tab = tab;
  tkChanged();
  tkDraw();
  const r = await api.tracker({ type: 'parent', number, parent });
  const r2 = !r.error && keep ? await api.tracker({ type: 'update', number, patch: { tab } }) : null;
  const error = r.error || (r2 && r2.error);
  if (error) { Object.assign(it, was); tkChanged(); tkDraw(); tkError(error); return; }
  tkError('');
  tkMerge(it, r.item);
  if (r2) tkMerge(it, r2.item);
  tkDraw();
}

// ---- the tabs down the left ----
function tkSaveTabs(tabs, extra = {}) {
  api.setConfig({ trackerTabs: tabs.filter((t) => t !== 'Main'), ...extra });
  state.config.trackerTabs = tabs.filter((t) => t !== 'Main'); // drawn at once, before the settings come back
}
async function tkTabNamed(value) {
  const edit = tkTabEdit;
  tkTabEdit = null;
  const name = tkCleanTab(value);
  const tabs = tkTabs();
  if (!edit || !name || (edit.mode === 'rename' && name === edit.name)) { tkDraw(); return; }
  if (name === 'Main' || tabs.includes(name)) { tkError(`There is already a tab called ${name}.`); tkDraw(); return; }
  tkError('');
  if (edit.mode === 'new') { tkSaveTabs([...tabs, name]); tkGoTab(name); return; }
  // Rename: the label on GitHub, the boxes here, and the places kept for its boxes.
  const from = edit.name;
  const layout = {};
  for (const [k, v] of Object.entries(state.config.trackerLayout || {})) layout[k.startsWith(`tab:${from}/`) ? `tab:${name}/${k.slice(from.length + 5)}` : k] = v;
  for (const k of Object.keys(tkMoved)) if (k.startsWith(`tab:${from}/`)) { tkMoved[`tab:${name}/${k.slice(from.length + 5)}`] = tkMoved[k]; delete tkMoved[k]; }
  tkSaveTabs(tabs.map((t) => (t === from ? name : t)), { trackerLayout: layout });
  state.config.trackerLayout = layout;
  for (const i of tkItems) if (i.tab === from) i.tab = name;
  tkChanged();
  if (tkTab === from) tkTab = name;
  try { localStorage.setItem('trackerTab', tkTab); } catch (_) { /* not kept */ }
  tkDraw();
  const r = await api.tracker({ type: 'renameTab', from, to: name });
  if (r.error) { tkError(`${r.error} The tab is renamed here; press Refresh to see what GitHub has.`); }
}
async function tkRemoveTab(name) {
  const n = tkItems.filter((i) => tkTabOf(i) === name).length;
  if (!await askYes(`Remove the tab "${name}"?${n ? ` Its ${n} box${n === 1 ? '' : 'es'} go back to Main (nothing is deleted).` : ''}`, { yes: 'Remove tab' })) return;
  tkSaveTabs(tkTabs().filter((t) => t !== name));
  for (const i of tkItems) if (i.tab === name) i.tab = '';
  tkChanged();
  if (tkTab === name) tkTab = 'Main';
  tkDraw();
  const r = await api.tracker({ type: 'removeTab', name });
  if (r.error) tkError(r.error);
}
$('tk-tabs').addEventListener('click', (e) => {
  if (tkTabDragged) { tkTabDragged = false; return; } // the end of a drag, not a click
  if (e.target.closest('#tk-newtab')) { tkTabEdit = { mode: 'new' }; tkDraw(); return; }
  const x = e.target.closest('[data-tabdel]');
  if (x) { tkRemoveTab(x.dataset.tabdel); return; }
  const t = e.target.closest('[data-tabname]');
  if (t && t.dataset.tabname !== tkTab) tkGoTab(t.dataset.tabname);
});
// Dragging a tab up or down puts it elsewhere in the list (Main stays first). A line shows
// where it will land; the tabs' places are measured once, when the drag starts.
let tkTabDrag = null, tkTabDragged = false;
$('tk-tabs').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('[data-tabdel], #tk-tabinput, #tk-newtab')) return;
  const t = e.target.closest('[data-tabname]');
  if (!t || t.dataset.tabname === 'Main') return;
  tkTabDrag = { el: t, name: t.dataset.tabname, y0: e.clientY, id: e.pointerId, moved: false };
});
$('tk-tabs').addEventListener('pointermove', (e) => {
  const d = tkTabDrag;
  if (!d) return;
  if (!d.moved) {
    if (Math.abs(e.clientY - d.y0) < 5) return;
    d.moved = true;
    $('tk-tabs').setPointerCapture(d.id);
    d.el.classList.add('dragging');
    d.rows = [...$('tk-tabs').querySelectorAll('[data-tabname]')].map((el) => { const b = el.getBoundingClientRect(); return { el, name: el.dataset.tabname, mid: b.top + b.height / 2 }; });
  }
  d.el.style.transform = `translateY(${e.clientY - d.y0}px)`;
  const before = d.rows.find((x) => x.name !== 'Main' && x.el !== d.el && e.clientY < x.mid) || null;
  d.before = before ? before.name : '';
  for (const x of d.rows) x.el.classList.toggle('insert-before', x === before);
  const nt = $('tk-newtab');
  if (nt) nt.classList.toggle('insert-before', !before);
});
function tkTabDragEnd(cancelled) {
  const d = tkTabDrag;
  tkTabDrag = null;
  if (!d || !d.moved) return;
  tkTabDragged = true;
  setTimeout(() => { tkTabDragged = false; }, 0); // only the click that ends this drag is skipped
  d.el.style.transform = '';
  d.el.classList.remove('dragging');
  for (const el of $('tk-tabs').querySelectorAll('.insert-before')) el.classList.remove('insert-before');
  if (cancelled) return;
  const tabs = tkTabs().filter((t) => t !== 'Main' && t !== d.name);
  const at = d.before ? tabs.indexOf(d.before) : tabs.length;
  tabs.splice(at < 0 ? tabs.length : at, 0, d.name);
  tkSaveTabs(tabs);
  tkDraw();
}
$('tk-tabs').addEventListener('pointerup', () => tkTabDragEnd(false));
$('tk-tabs').addEventListener('pointercancel', () => tkTabDragEnd(true));
$('tk-tabs').addEventListener('dblclick', (e) => {
  const t = e.target.closest('[data-tabname]');
  if (t && t.dataset.tabname !== 'Main') { tkTabEdit = { mode: 'rename', name: t.dataset.tabname }; tkDraw(); }
});
$('tk-tabs').addEventListener('keydown', (e) => {
  if (e.target.id === 'tk-tabinput') {
    if (e.key === 'Enter') { e.preventDefault(); tkTabNamed(e.target.value); }
    if (e.key === 'Escape') { e.preventDefault(); tkTabEdit = null; tkDraw(); }
    return;
  }
  const t = e.target.closest('[data-tabname]');
  if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tkGoTab(t.dataset.tabname); }
  if (t && e.key === 'F2' && t.dataset.tabname !== 'Main') { tkTabEdit = { mode: 'rename', name: t.dataset.tabname }; tkDraw(); }
});
// Leaving the name field keeps what was typed, like pressing Enter.
$('tk-tabs').addEventListener('focusout', (e) => { if (e.target.id === 'tk-tabinput' && tkTabEdit) tkTabNamed(e.target.value); });
$('tk-hidedone').addEventListener('click', () => {
  tkHideDone = !tkHideDone;
  try { localStorage.setItem('trackerHideDone', tkHideDone ? '1' : ''); } catch (_) { /* not kept */ }
  tkDraw();
});

// ---- right-click menus: on a box, a tab, a line, the tab's own box, the empty map, a column ----
// One menu (#tk-menu) filled for what was clicked; tkMenu says what that was.
let tkMenu = null;
function tkMenuClose() { $('tk-menu').hidden = true; tkMenu = null; }
const tkMBtn = (act, value, label, on, danger) => `<button type="button" role="menuitem" data-act="${act}" data-value="${esc(value)}"${on ? ' class="on" aria-checked="true"' : danger ? ' class="danger"' : ''}>${label}</button>`;
const tkMRow = (title, buttons) => `<div class="tk-msec">${title}</div><div class="tk-mrow">${buttons}</div>`;
const tkMSep = '<div class="tk-msep"></div>';
function tkMenuShow(ctx, head, html, x, y) {
  tkMenu = ctx;
  setHtml($('tk-menu'), `${head ? `<div class="tk-mhead">${head}</div>` : ''}${html}`);
  const m = $('tk-menu');
  m.hidden = false;
  // Kept inside the window.
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  const first = m.querySelector('button');
  if (first) first.focus();
}
// The parts every map menu ends with: things for the whole tab.
const tkMTabTail = () => `${tkMSep}${tkMBtn('add', '', 'Add something to this tab')}${tkMBtn('hidedone', '', tkHideDone ? 'Show finished boxes' : 'Hide finished boxes')}${tkView === 'map' ? tkMBtn('relayout', '', 'Lay this tab out again') : ''}${tkMBtn('refresh', '', 'Refresh from GitHub')}`;
function tkBoxMenu(number, x, y) {
  const it = tkFind(number);
  if (!it) return;
  const p = it.parent != null && tkShown.has(it.parent) ? tkFind(it.parent) : null;
  const tabs = tkTabs().filter((t) => t !== tkTabOf(it));
  tkMenuShow({ kind: 'box', number }, `#${it.number} ${esc(it.title)}`,
    `${tkMBtn('open', '', 'Open')}${tkMBtn('under', '', 'Add something under it')}${p ? tkMBtn('off', '', `Take it off #${p.number}`) : ''}${tkMBtn('note', '', 'Add a note')}${tkMBtn('connect', '', 'Connect a recording')}${tkMBtn('duplicate', '', 'Duplicate')}${tkMBtn('github', '', 'Open on GitHub')}${tkMBtn('copy', '', `Copy "#${it.number} ${esc(it.title.length > 24 ? `${it.title.slice(0, 24)}…` : it.title)}"`)}
    ${tkMRow('Where it stands', Object.entries(TK_STATUS).map(([k, v]) => tkMBtn('status', k, v, it.status === k)).join(''))}
    ${tkMRow('Priority', `${tkMBtn('priority', 'high', 'High', it.priority === 'high')}${tkMBtn('priority', 'normal', 'Normal', it.priority === 'normal')}${tkMBtn('priority', 'low', 'Low', it.priority === 'low')}`)}
    ${tabs.length ? tkMRow('Move to tab', tabs.map((t) => tkMBtn('tab', t, esc(t))).join('')) : ''}
    ${tkMSep}${tkMBtn('delete', '', 'Delete…', false, true)}`, x, y);
}
function tkTabMenu(name, x, y) {
  const tabs = tkTabs(), at = tabs.indexOf(name), main = name === 'Main';
  tkMenuShow({ kind: 'tabitem', tab: name }, esc(name),
    `${name !== tkTab ? tkMBtn('gotab', '', 'Open') : ''}${main ? '' : tkMBtn('rename', '', 'Rename')}${!main && at > 1 ? tkMBtn('tabup', '', 'Move up') : ''}${!main && at < tabs.length - 1 ? tkMBtn('tabdown', '', 'Move down') : ''}${tkMBtn('newtab', '', 'New tab')}${main ? '' : `${tkMSep}${tkMBtn('removetab', '', 'Remove tab…', false, true)}`}`, x, y);
}
function tkRootMenu(x, y) {
  tkMenuShow({ kind: 'root' }, esc(tkTab === 'Main' ? 'Main' : tkTab),
    `${tkTab === 'Main' ? '' : tkMBtn('rename', '', 'Rename this tab')}${tkMTabTail()}`, x, y);
}
function tkLineMenu(number, x, y) {
  const it = tkFind(number), p = it && tkFind(it.parent);
  if (!p) return;
  tkMenuShow({ kind: 'line', number }, `#${it.number} under #${p.number}`, `${tkMBtn('off', '', `Take #${it.number} off #${p.number}`)}${tkMBtn('open', '', `Open #${it.number}`)}${tkMBtn('openparent', '', `Open #${p.number}`)}`, x, y);
}
function tkColMenu(col, x, y) {
  const c = TK_COLS.find((k) => k[0] === col);
  tkMenuShow({ kind: 'col', col }, esc(c ? c[1] : ''), `${col === 'done' ? '' : tkMBtn('addcol', col, `Add something to ${esc(c[1])}`)}${tkMTabTail()}`, x, y);
}

for (const id of ['tk-map', 'tk-board']) {
  $(id).addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const box = e.target.closest('[data-node], [data-tk]');
    const line = e.target.closest('[data-line]');
    const col = e.target.closest('[data-col]');
    if (e.target.closest('[data-plug="root"]')) tkRootMenu(e.clientX, e.clientY);
    else if (box) tkBoxMenu(Number(box.dataset.node || box.dataset.tk), e.clientX, e.clientY);
    else if (line) tkLineMenu(Number(line.dataset.line), e.clientX, e.clientY);
    else if (col) tkColMenu(col.dataset.col, e.clientX, e.clientY);
    else tkMenuShow({ kind: 'empty' }, esc(tkTab), tkMTabTail().replace(tkMSep, ''), e.clientX, e.clientY);
  });
}
$('tk-tabs').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const t = e.target.closest('[data-tabname]');
  if (t) tkTabMenu(t.dataset.tabname, e.clientX, e.clientY);
  else tkMenuShow({ kind: 'tabs' }, '', tkMBtn('newtab', '', 'New tab'), e.clientX, e.clientY);
});

// Moves a tab one place up or down in the list (Main stays first).
function tkMoveTab(name, by) {
  const tabs = tkTabs().filter((t) => t !== 'Main'), at = tabs.indexOf(name), to = at + by;
  if (at < 0 || to < 0 || to >= tabs.length) return;
  tabs.splice(to, 0, tabs.splice(at, 1)[0]);
  tkSaveTabs(tabs);
  tkDraw();
}
// Forgets where the boxes of the tab shown were put by hand, so the tree lays them out again.
async function tkRelayout() {
  if (!await askYes(`Lay out "${tkTab}" again? The boxes you moved by hand go back to their places in the tree.`, { yes: 'Lay out again' })) return;
  const prefix = `${tkTab === 'Main' ? 'root' : `tab:${tkTab}`}/`;
  const layout = {};
  for (const [k, v] of Object.entries(state.config.trackerLayout || {})) if (!k.startsWith(prefix)) layout[k] = v;
  for (const k of Object.keys(tkMoved)) if (k.startsWith(prefix)) delete tkMoved[k];
  state.config.trackerLayout = layout;
  api.setConfig({ trackerLayout: layout });
  tkDraw();
}
function tkAddFocus(status) {
  const f = $('tk-add');
  if (status && [...f.elements.status.options].some((o) => o.value === status)) f.elements.status.value = status;
  f.elements.title.focus();
}

$('tk-menu').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !tkMenu) return;
  const ctx = tkMenu, n = ctx.number, v = b.dataset.value, act = b.dataset.act;
  tkMenuClose();
  if (act === 'open') tkOpenItem(n);
  else if (act === 'openparent') tkOpenItem(tkFind(n).parent);
  else if (act === 'under') { tkUnder = n; tkUnderLine(); tkAddFocus(); }
  else if (act === 'off') tkLink(n, null);
  else if (act === 'note') { tkOpenItem(n); $('tk-notenew').focus(); }
  else if (act === 'connect') { tkOpenItem(n); tkRecPick(); }
  else if (act === 'duplicate') { const error = await tkDuplicate(n); if (error) tkError(error); }
  else if (act === 'github') { const it = tkFind(n); if (it && it.url) window.open(it.url, '_blank', 'noreferrer'); }
  else if (act === 'copy') { const it = tkFind(n); if (it) navigator.clipboard.writeText(`#${it.number} ${it.title}`).catch(() => tkError('Could not copy.')); }
  else if (act === 'status') tkMove(n, v, true);
  else if (act === 'priority') tkSetPriority(n, v);
  else if (act === 'tab') tkSetTab(n, v);
  else if (act === 'delete') { const error = await tkDeleteItem(n); if (error) tkError(error); }
  else if (act === 'gotab') tkGoTab(ctx.tab);
  else if (act === 'rename') { tkTabEdit = { mode: 'rename', name: ctx.tab || tkTab }; tkDraw(); }
  else if (act === 'tabup') tkMoveTab(ctx.tab, -1);
  else if (act === 'tabdown') tkMoveTab(ctx.tab, 1);
  else if (act === 'newtab') { tkTabEdit = { mode: 'new' }; tkDraw(); }
  else if (act === 'removetab') tkRemoveTab(ctx.tab);
  else if (act === 'add') { tkUnder = null; tkUnderLine(); tkAddFocus(); }
  else if (act === 'addcol') { tkUnder = null; tkUnderLine(); tkAddFocus(v); }
  else if (act === 'hidedone') $('tk-hidedone').click();
  else if (act === 'relayout') tkRelayout();
  else if (act === 'refresh') tkLoad();
});
document.addEventListener('pointerdown', (e) => { if (!$('tk-menu').hidden && !e.target.closest('#tk-menu')) tkMenuClose(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('tk-menu').hidden) { e.preventDefault(); tkMenuClose(); } });
window.addEventListener('blur', tkMenuClose);

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
