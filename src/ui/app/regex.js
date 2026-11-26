'use strict';
// Regex page: your saved stash searches (opened in game with the stash search key), builders
// for map and vendor searches, and a tester that shows what a search finds on a copied item.
// The logic is in src/core/regex.js (window.PoeRegex); this file draws the page.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

const RX = window.PoeRegex;
const RX_TABS = ['saved', 'maps', 'vendor', 'test'];
let rxTab = 'saved';
try { if (RX_TABS.includes(localStorage.getItem('regexTab'))) rxTab = localStorage.getItem('regexTab'); } catch (_) { /* storage off */ }
let rxDrawn = '';      // the part of the page drawn now: its controls are drawn once, then only the answers
let rxB = null;        // the builders' choices (config.regex), changed here and saved a moment later
let rxSaveTimer = 0;
let ssDrawn = '';      // the saved list as last drawn: a save of what was typed does not draw it again
let rxFilter = '';
const rxTry = { item: '', search: '' }; // the tester's item and search, kept while the app runs

function regexShown() { rxDrawn = ''; renderRegex(); }
function renderRegex() {
  if (!state || $('tab-regex').hidden) return;
  if (!rxB) rxB = RX.cleanBuilders(state.config.regex);
  for (const b of $('rx-tabs').querySelectorAll('[data-rx]')) b.setAttribute('aria-selected', String(b.dataset.rx === rxTab));
  if (rxDrawn !== rxTab) {
    rxDrawn = rxTab; ssDrawn = '';
    setHtml($('rx-body'), rxTab === 'maps' ? rxMapsHtml() : rxTab === 'vendor' ? rxVendorHtml() : rxTab === 'test' ? rxTestHtml() : rxSavedHtml());
    if (rxTab === 'test') { $('rx-item').value = rxTry.item; $('rx-try').value = rxTry.search; }
  }
  if (rxTab === 'saved') renderSearches();
  else if (rxTab === 'test') rxTestOut();
  else rxOut();
}

// ---- what a built search is, and the buttons under it ----------------------------------
const rxBuilt = () => (rxTab === 'maps' ? RX.mapSearch(rxB.map) : RX.vendorSearch(rxB.vendor));
function rxLenHtml(text) {
  const n = text.length, over = n > RX.GAME_LIMIT;
  return `<div class="rx-len${over ? ' over' : ''}"><progress max="${RX.GAME_LIMIT}" value="${Math.min(n, RX.GAME_LIMIT)}" aria-label="Length"></progress><span>${n} / ${RX.GAME_LIMIT}</span></div>`;
}
function rxOut() {
  const box = $('rx-result');
  if (!box) return;
  const r = rxBuilt(), probs = r.text ? RX.problems(r.text) : [];
  setHtml(box, r.text
    ? `<code class="rx-code">${esc(r.text)}</code>${rxLenHtml(r.text)}
      ${probs.length ? `<ul class="rx-probs" role="alert">${probs.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      <ul class="rx-parts">${r.parts.map((p) => `<li><code>${esc(p.text)}</code><span>${esc(p.what)}</span></li>`).join('')}</ul>`
    : `<p class="rx-empty">${rxTab === 'maps' ? 'Tick mods to avoid or set numbers the map must have.' : 'Tick what to look for.'}</p>`);
  for (const b of $('rx-body').querySelectorAll('[data-rx-need]')) b.disabled = !r.text;
}
function rxOutHtml(name) {
  return `<aside class="panel rx-out" aria-label="Your search">
    <h3>Your search</h3>
    <div id="rx-result" aria-live="polite"></div>
    <div class="rx-acts">
      <button type="button" class="primary" data-rx-do="copy" data-rx-need>Copy</button>
      <button type="button" data-rx-do="send" data-rx-need title="Brings the game to the front and puts the search in the stash search box">Put in game</button>
    </div>
    <div class="rx-saveas"><input type="text" id="rx-name" maxlength="60" placeholder="${esc(name)}" aria-label="Name to save it under"><button type="button" data-rx-do="save" data-rx-need>Save to my searches</button></div>
  </aside>`;
}

// ---- map builder ----------------------------------------------------------------------
const rxSeg = (path, now, opts) => `<div class="rx-seg" role="radiogroup">${opts.map(([v, label]) => `<button type="button" role="radio" data-rx-set="${path}" data-v="${v}" aria-checked="${String(now === v)}">${label}</button>`).join('')}</div>`;
function rxMapsHtml() {
  const m = rxB.map, avoid = new Set(m.avoid);
  const groups = [...new Set(RX.MAP_MODS.map((x) => x.group))];
  const tierOpts = (now, none) => `<option value="0"${now ? '' : ' selected'}>${none}</option>` + Array.from({ length: 17 }, (_, i) => `<option value="${i + 1}"${now === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('');
  const sel = (path, now, opts) => `<select data-rx-field="${path}">${opts.map(([v, l]) => `<option value="${v}"${now === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="rx-build">
    <div class="rx-opts">
      <section>
        <h3>Light up</h3>
        ${rxSeg('map.mode', m.mode, [['run', 'Maps to run'], ['skip', 'Maps to skip']])}
        <p class="hint small" id="rx-mode-hint">${m.mode === 'skip' ? 'Lights up maps that have any mod you avoid, to sell or reroll them.' : 'Lights up maps with none of the mods you avoid and every number you ask for.'}</p>
      </section>
      <section>
        <div class="rx-head"><h3>Mods to avoid <span class="rx-count" id="rx-avoid-n">${avoid.size || ''}</span></h3>
          <span><button type="button" class="link" data-rx-do="fromRules" title="Ticks the mods ticked on the Map check page">Use my Map check ticks</button><button type="button" class="link" data-rx-do="clearAvoid">Clear</button></span></div>
        ${groups.map((g) => `<h4>${g}</h4><div class="rules rx-mods">${RX.MAP_MODS.filter((x) => x.group === g).map((x) => `<label title="${esc(x.text)}"><input type="checkbox" data-rx-mod="${x.id}"${avoid.has(x.id) ? ' checked' : ''}> ${esc(x.label)}</label>`).join('')}</div>`).join('')}
        <label class="rx-field">Your own words, split by commas <small>any text on the map, such as a mod not listed here</small>
          <input type="text" class="mono" data-rx-field="map.extra" value="${esc(m.extra)}" maxlength="200" spellcheck="false" placeholder="ghosts, abomin"></label>
      </section>
      <section class="rx-wants"${m.mode === 'skip' ? ' hidden' : ''} id="rx-wants">
        <h3>The map must have at least</h3>
        <div class="rx-nums">${RX.MAP_WANTS.map((w) => `<label>${esc(w.label)}<span><input type="number" min="0" max="999" step="5" data-rx-want="${w.id}" value="${m.want[w.id] || ''}" placeholder="any">%</span></label>`).join('')}</div>
        <label class="rx-check"><input type="checkbox" data-rx-field="map.wantAny"${m.wantAny ? ' checked' : ''}> One of these numbers is enough</label>
        <div class="rx-nums">
          <label>Tier from<span><select data-rx-field="map.tierMin">${tierOpts(m.tierMin, 'any')}</select></span></label>
          <label>Tier up to<span><select data-rx-field="map.tierMax">${tierOpts(m.tierMax, 'any')}</select></span></label>
          <label>Corrupted<span>${sel('map.corrupted', m.corrupted, [['any', 'either'], ['only', 'only corrupted'], ['not', 'not corrupted']])}</span></label>
          <label>Unidentified<span>${sel('map.unidentified', m.unidentified, [['any', 'include'], ['not', 'leave out']])}</span></label>
        </div>
        <p class="hint small">An unidentified map shows no mods, so it passes "mods to avoid". Leave unidentified maps out when that matters.</p>
      </section>
    </div>
    ${rxOutHtml('Maps to run')}
  </div>`;
}

// ---- vendor builder ---------------------------------------------------------------------
function rxVendorHtml() {
  const v = rxB.vendor;
  const sel = (path, now, opts) => `<select data-rx-field="${path}">${opts.map(([x, l]) => `<option value="${x}"${now === x ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const box = (path, on, label, hint) => `<label class="rx-check"><input type="checkbox" data-rx-field="${path}"${on ? ' checked' : ''}> <span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
  return `<div class="rx-build">
    <div class="rx-opts">
      <section>
        <h3>Light up items at a vendor with any of</h3>
        <p class="hint small">For levelling: press Ctrl+F in a vendor's window and paste, or open your saved searches with the stash search key.</p>
        ${box('vendor.rgb', v.rgb, 'Red, green and blue linked', 'side by side; sold for a Chromatic Orb')}
        <div class="rx-nums">
          <label>Linked sockets<span>${sel('vendor.links', v.links, [[0, 'off'], [3, '3 or more'], [4, '4 or more'], [5, '5 or more'], [6, '6']])}</span></label>
          <label>Sockets<span>${sel('vendor.sockets', v.sockets, [[0, 'off'], [5, '5 or more'], [6, '6']])}</span></label>
          <label>Movement speed<span>${sel('vendor.moveMin', v.moveMin, [[0, 'off'], [-1, 'any'], [10, '10% or more'], [15, '15% or more'], [20, '20% or more'], [25, '25% or more'], [30, '30% or more']])}</span></label>
        </div>
        ${box('vendor.white', v.white, 'A white socket', 'takes a gem of any colour')}
        ${box('vendor.gemLevel', v.gemLevel, '+ levels to gems', 'such as +1 to Level of Socketed Gems')}
        <label class="rx-field">Your own words, split by commas <small>for example a base type you want</small>
          <input type="text" class="mono" data-rx-field="vendor.extra" value="${esc(v.extra)}" maxlength="200" spellcheck="false" placeholder="sapphire ring, \\+1 to level"></label>
      </section>
    </div>
    ${rxOutHtml('Vendor')}
  </div>`;
}

// ---- tester ---------------------------------------------------------------------------------
function rxTestHtml() {
  return `<div class="rx-test">
    <label class="rx-field">The item <small>Hover an item in game, press Ctrl+C, then paste it here.</small>
      <textarea id="rx-item" rows="16" spellcheck="false" placeholder="Item Class: Maps&#10;Rarity: Rare&#10;…"></textarea></label>
    <div class="rx-test-side">
      <label class="rx-field">Search to try
        <input type="text" id="rx-try" class="mono" spellcheck="false" autocomplete="off" placeholder="&quot;!f phys|regen&quot; &quot;tity: .(9\\d|\\d{3})%&quot;"></label>
      <div id="rx-try-out" aria-live="polite"></div>
      <h3>Your saved searches on this item</h3>
      <div id="rx-try-saved"></div>
    </div>
  </div>`;
}
const rxVerdict = (r) => (r.ok ? '<b class="rx-yes">Lights up</b>' : '<b class="rx-no">Stays dark</b>');
function rxTestOut() {
  const out = $('rx-try-out'), saved = $('rx-try-saved');
  if (!out) return;
  const item = rxTry.item, s = rxTry.search;
  if (!item.trim()) { setHtml(out, '<p class="rx-empty">Paste an item to see what lights it up.</p>'); setHtml(saved, ''); return; }
  if (!s.trim()) setHtml(out, '');
  else {
    const r = RX.testSearch(s, item);
    setHtml(out, `<p class="rx-verdict">${rxVerdict(r)}${rxLenHtml(s)}</p>
      <ul class="rx-terms">${r.terms.map((t) => `<li class="${t.pass ? 'pass' : 'fail'}"><code>${esc(t.text)}</code><span>${t.error ? esc(t.error)
        : t.neg ? (t.hit ? `found "${esc(t.match)}", so it fails` : 'not found, good') : t.hit ? `found "${esc(t.match)}"` : 'not found'}</span></li>`).join('')}</ul>`);
  }
  const list = ssList().filter((x) => x.text);
  setHtml(saved, list.length ? `<ul class="rx-terms">${list.map((x) => { const r = RX.testSearch(x.text, item); return `<li class="${r.ok ? 'pass' : 'fail'}"><b>${esc(x.name || x.text)}</b><span>${r.ok ? 'lights up' : r.error ? esc(r.error) : 'stays dark'}</span></li>`; }).join('')}</ul>`
    : '<p class="rx-empty">No saved searches yet.</p>');
}

// ---- saved searches (config.stashSearches; the menu in game shows the same list) ----------
const ssList = () => (Array.isArray(state.config.stashSearches) ? state.config.stashSearches : []).map((x) => ({ name: x.name || '', text: x.text || '' }));
function rxSavedHtml() {
  const key = state.config.hotkeys.stashSearch;
  return `<div class="rx-saved-top">
      <input type="search" id="rx-filter" placeholder="Find a search" aria-label="Find a search" autocomplete="off">
      <button type="button" id="ss-add" class="primary">Add a search</button>
    </div>
    <p class="hint small">${key ? `In game, press <span class="keyname">${esc(key)}</span> to open these at the mouse; a click puts one in the stash search box.` : 'Set a key for stash searches to open these in game.'} <button type="button" class="link" data-settings="keys">Change the key</button> The game's box takes ${RX.GAME_LIMIT} characters.</p>
    <div class="panel ss-rows" id="ss-rows"></div>`;
}
function renderSearches() {
  const box = $('ss-rows');
  if (!box) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const list = ssList(), key = JSON.stringify(list) + '\n' + rxFilter;
  if (key === ssDrawn && box.childElementCount) return;
  ssDrawn = key;
  const f = rxFilter.trim().toLowerCase();
  const rows = list.map((x, i) => ({ x, i })).filter(({ x }) => !f || x.name.toLowerCase().includes(f) || x.text.toLowerCase().includes(f));
  setHtml(box, rows.length ? rows.map(({ x, i }) => {
    const probs = x.text ? RX.problems(x.text) : [];
    return `<div class="ss-row">
      <input type="text" class="ss-in-name" data-ss="${i}" data-ss-field="name" value="${esc(x.name)}" placeholder="Name, such as Maps 16" maxlength="60" aria-label="Name of search ${i + 1}">
      <input type="text" class="ss-in-text mono" data-ss="${i}" data-ss-field="text" value="${esc(x.text)}" placeholder="The search, such as &quot;m q.*1[6-9]&quot;" maxlength="500" spellcheck="false" autocomplete="off" aria-label="Search ${i + 1}">
      <span class="ss-btns">
        <button type="button" class="small" data-ss-copy="${i}" ${x.text ? '' : 'disabled'}>Copy</button>
        <button type="button" class="small" data-ss-send="${i}" ${x.text ? '' : 'disabled'} title="Brings the game to the front and puts the search in the stash search box">In game</button>
        <button type="button" class="link" data-ss-try="${i}" ${x.text ? '' : 'disabled'} title="Try it on an item">Try</button>
        <button type="button" class="link" data-ss-move="${i}" data-dir="-1" ${i && !f ? '' : 'disabled'} aria-label="Move up">Up</button>
        <button type="button" class="link" data-ss-move="${i}" data-dir="1" ${i < list.length - 1 && !f ? '' : 'disabled'} aria-label="Move down">Down</button>
        <button type="button" class="link" data-ss-del="${i}" aria-label="Remove this search">Remove</button></span>
      <small class="ss-meta${probs.length ? ' bad' : ''}">${x.text.length} / ${RX.GAME_LIMIT}${probs.length ? ` · ${esc(probs.join(' '))}` : ''}</small></div>`;
  }).join('')
    : `<p class="set-off">${list.length ? 'No search matches.' : 'No searches yet. Add one, or build one in Maps or Vendor and save it.'}</p>`);
}
function saveSearches(list) {
  state.config.stashSearches = list; // shown at once; the app sends back the cleaned list
  api.setConfig({ stashSearches: list });
}

// ---- events -------------------------------------------------------------------------------
function rxSet(path, value) {
  const [part, key] = path.split('.');
  rxB[part][key] = value;
  rxB = RX.cleanBuilders(rxB);
  clearTimeout(rxSaveTimer);
  rxSaveTimer = setTimeout(() => api.setConfig({ regex: rxB }), 400);
  if (path === 'map.mode') {
    for (const b of $('rx-body').querySelectorAll('[data-rx-set="map.mode"]')) b.setAttribute('aria-checked', String(b.dataset.v === value));
    $('rx-wants').hidden = value === 'skip';
    $('rx-mode-hint').textContent = value === 'skip' ? 'Lights up maps that have any mod you avoid, to sell or reroll them.' : 'Lights up maps with none of the mods you avoid and every number you ask for.';
  }
  if (path === 'map.avoid') {
    const on = new Set(rxB.map.avoid);
    for (const c of $('rx-body').querySelectorAll('[data-rx-mod]')) c.checked = on.has(c.dataset.rxMod);
    $('rx-avoid-n').textContent = on.size || '';
  }
  rxOut();
}
const rxFlash = (b, text) => { const was = b.textContent; b.textContent = text; b.disabled = true; setTimeout(() => { b.textContent = was; b.disabled = false; }, 1200); };

$('rx-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rx]');
  if (!b) return;
  rxTab = b.dataset.rx;
  try { localStorage.setItem('regexTab', rxTab); } catch (_) { /* not kept */ }
  renderRegex();
});
$('rx-body').addEventListener('click', (e) => {
  const seg = e.target.closest('[data-rx-set]');
  if (seg) { rxSet(seg.dataset.rxSet, seg.dataset.v); return; }
  const d = e.target.closest('[data-rx-do]');
  if (d) {
    const what = d.dataset.rxDo, text = rxB && rxDrawn !== 'saved' && rxDrawn !== 'test' ? rxBuilt().text : '';
    if (what === 'fromRules') rxSet('map.avoid', [...new Set([...rxB.map.avoid, ...RX.modsFromRules(state.config.mapRules)])]);
    else if (what === 'clearAvoid') rxSet('map.avoid', []);
    else if (what === 'copy' && text) act({ type: 'regexCopy', text });
    else if (what === 'send' && text) act({ type: 'regexSend', text });
    else if (what === 'save' && text) {
      const name = $('rx-name').value.trim() || $('rx-name').placeholder;
      saveSearches([...ssList(), { name, text }]);
      $('rx-name').value = '';
      rxFlash(d, 'Saved');
    }
    return;
  }
  if (e.target.closest('#ss-add')) {
    rxFilter = ''; $('rx-filter').value = '';
    saveSearches([...ssList(), { name: '', text: '' }]);
    ssDrawn = ''; renderSearches();
    const rows = $('ss-rows').querySelectorAll('.ss-in-name');
    if (rows.length) rows[rows.length - 1].focus();
    return;
  }
  const row = e.target.closest('[data-ss-copy],[data-ss-send],[data-ss-try],[data-ss-move],[data-ss-del]');
  if (!row) return;
  const list = ssList(), ds = row.dataset;
  if (ds.ssCopy) { const x = list[Number(ds.ssCopy)]; if (x && x.text) act({ type: 'regexCopy', text: x.text }); return; }
  if (ds.ssSend) { act({ type: 'stashSearch', i: Number(ds.ssSend) }); return; }
  if (ds.ssTry) { const x = list[Number(ds.ssTry)]; if (x) { rxTry.search = x.text; rxTab = 'test'; renderRegex(); } return; }
  if (ds.ssMove) {
    const i = Number(ds.ssMove), j = i + Number(ds.dir);
    if (!list[i] || !list[j]) return;
    [list[i], list[j]] = [list[j], list[i]];
  } else if (ds.ssDel) list.splice(Number(ds.ssDel), 1);
  saveSearches(list);
  ssDrawn = ''; renderSearches();
});
$('rx-body').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.rxMod) {
    const on = new Set(rxB.map.avoid);
    if (t.checked) on.add(t.dataset.rxMod); else on.delete(t.dataset.rxMod);
    rxSet('map.avoid', [...on]);
    return;
  }
  if (t.dataset.rxField && (t.type === 'checkbox' || t.tagName === 'SELECT')) { rxSet(t.dataset.rxField, t.type === 'checkbox' ? t.checked : (/^-?\d+$/.test(t.value) ? Number(t.value) : t.value)); return; }
  const ss = t.closest('[data-ss]');
  if (ss) {
    const list = ssList(), i = Number(ss.dataset.ss);
    if (!list[i]) return;
    list[i][ss.dataset.ssField] = ss.value;
    ssDrawn = JSON.stringify(list) + '\n' + rxFilter; // the fields already show it; drawing now would lose the cursor
    saveSearches(list);
  }
});
// Typing: the answer follows each key, without drawing the controls again.
$('rx-body').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.rxWant) { rxB.map.want = { ...rxB.map.want, [t.dataset.rxWant]: Number(t.value) || 0 }; rxSet('map.want', rxB.map.want); return; }
  if (t.dataset.rxField && t.type === 'text') { rxSet(t.dataset.rxField, t.value); return; }
  if (t.id === 'rx-filter') { rxFilter = t.value; renderSearches(); return; }
  if (t.id === 'rx-item') { rxTry.item = t.value; rxTestOut(); return; }
  if (t.id === 'rx-try') { rxTry.search = t.value; rxTestOut(); }
});
// Leaving the list draws it again, so the length and any problem show.
$('rx-body').addEventListener('focusout', (e) => {
  const box = $('ss-rows');
  if (!box || !box.contains(e.target) || (e.relatedTarget && box.contains(e.relatedTarget))) return;
  setTimeout(() => { if (state) { ssDrawn = ''; renderSearches(); } }, 0);
});
