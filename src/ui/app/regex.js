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

// ---- the search being built: one bar on top --------------------------------------------
// Name, the search on one line (hover it for what each part does), its length, Copy, Put in
// game, Save and Reset. The same bar on Maps and Vendor.
const rxBuilt = () => (rxTab === 'maps' ? RX.mapSearch(rxB.map) : RX.vendorSearch(rxB.vendor));
function rxLenHtml(text) {
  const n = text.length, over = n > RX.GAME_LIMIT;
  return `<div class="rx-len${over ? ' over' : ''}"><progress max="${RX.GAME_LIMIT}" value="${Math.min(n, RX.GAME_LIMIT)}" aria-label="Length"></progress><span>${n} / ${RX.GAME_LIMIT}</span></div>`;
}
function rxBarHtml(name) {
  return `<section class="panel rx-bar" aria-label="Your search">
    <input type="text" id="rx-name" class="rx-name" maxlength="60" placeholder="${esc(name)}" value="${esc(rxEditing && rxTab === 'maps' ? rxEditing.name : '')}" aria-label="Name to save it under">
    <input type="text" class="rx-code" id="rx-code" spellcheck="false" autocomplete="off" aria-label="The search: paste one you have, or edit it here">
    <span class="rx-n" id="rx-n"></span>
    <button type="button" class="primary" data-rx-do="copy" data-rx-need>Copy</button>
    <button type="button" data-rx-do="send" data-rx-need title="Brings the game to the front and puts the search in the stash search box">Put in game</button>
    ${rxEditing && rxTab === 'maps' ? `<button type="button" data-rx-do="save" data-rx-need title="Changes &quot;${esc(rxEditing.name || 'this search')}&quot; in My searches">Save changes</button><button type="button" class="link" data-rx-do="saveNew" data-rx-need title="Adds it to My searches as a new search">Save as new</button>`
    : '<button type="button" data-rx-do="save" data-rx-need title="Adds it to My searches, under the name on the left">Save</button>'}
    <button type="button" class="link" data-rx-do="reset" title="Clears everything picked here">Reset</button>
  </section>
  <p class="rx-kept" id="rx-kept" hidden></p>`;
}
function rxOut() {
  const code = $('rx-code');
  if (!code) return;
  const r = rxBuilt(), probs = r.text ? RX.problems(r.text) : [], n = r.text.length;
  // Not while you type in it: what you typed is read when you press Enter or leave the field.
  if (document.activeElement !== code) code.value = r.text;
  code.placeholder = rxTab === 'maps' ? 'Paste a search you have, or pick mods below' : 'Paste a search you have, or tick what to look for below';
  const kept = rxTab === 'maps' ? rxB.map.kept : [];
  $('rx-kept').hidden = !kept.length;
  if (kept.length) setHtml($('rx-kept'), `Kept as you wrote ${kept.length > 1 ? 'them' : 'it'}, at the end: ${kept.map((k) => `<code>${esc(k)}</code>`).join(' ')} <button type="button" class="link" data-rx-do="unkeep">Take ${kept.length > 1 ? 'them' : 'it'} out</button>`);
  code.title = r.parts.map((x) => `${x.text}   ${x.what}`).concat(probs).join('\n');
  $('rx-n').textContent = `${n} / ${RX.GAME_LIMIT}`;
  $('rx-n').classList.toggle('over', n > RX.GAME_LIMIT);
  $('rx-n').title = n > RX.GAME_LIMIT ? `The game keeps only the first ${RX.GAME_LIMIT} characters` : 'Characters used of the game\'s 250';
  for (const b of $('rx-body').querySelectorAll('[data-rx-need]')) b.disabled = !r.text;
  if (rxTab === 'maps') { rxListOut('avoid'); rxListOut('wantMods'); }
}

// ---- small parts of the boxes --------------------------------------------------------------
// A choice of a few (Exact / Shorter, Include / Exclude): values are text, 'true' and 'false' for yes and no.
const rxSw = (path, now, opts, off) => `<span class="rx-sw${off ? ' off' : ''}" role="radiogroup">${opts.map(([v, label, cls]) => {
  const on = String(now) === v;
  return `<button type="button" role="radio" aria-checked="${on}" data-rx-set="${path}" data-v="${v}"${on ? ` class="on${cls ? ` ${cls}` : ''}"` : ''}>${label}</button>`;
}).join('')}</span>`;
const rxInOut = (path, now, off) => rxSw(path, now, [['include', 'Include', 'in'], ['exclude', 'Exclude', 'ex']], off);
const rxCk = (path, on, label) => `<label class="rx-ck"><input type="checkbox" data-rx-f="${path}"${on ? ' checked' : ''}> ${label}</label>`;
const rxNum = (path, n, label) => `<label class="rx-nf">${label}<span><input type="text" inputmode="numeric" maxlength="3" data-rx-num="${path}" value="${n || ''}" placeholder="–" aria-label="${label}, at least">%</span></label>`;

// ---- map builder: the four boxes as on poe.re, then mods not wanted and wanted ---------------
// A saved search opened with Edit: Save then changes it in place. { i, name } or null.
let rxEditing = null;
let rxFind = { avoid: '', wantMods: '' }; // what is typed in each list's search box
const rxListKey = {}; // what each list was last drawn from
function rxMapsHtml() {
  return `${rxBarHtml('Maps')}
    <div class="rx-boxes" id="rx-boxes">${rxBoxesHtml()}</div>
    <div class="rx-lists">${rxListPanel('avoid')}${rxListPanel('wantMods')}</div>`;
}
function rxBoxesHtml() {
  const m = rxB.map;
  const short = (path, now) => rxSw(path, now, [['false', 'Exact'], ['true', 'Shorter']]);
  return `<section class="panel rx-box"><div class="rx-bh"><h3>Drops and yield</h3>${short('map.yieldShort', m.yieldShort)}</div>
      <div class="rx-g2">${RX.YIELDS.map((y) => rxNum(`map.yields.${y.id}`, m.yields[y.id], y.label)).join('')}</div>
      ${rxCk('map.yieldAny', m.yieldAny, 'One of these is enough')}</section>
    <section class="panel rx-box"><div class="rx-bh"><h3>Map state</h3></div>
      <div class="rx-ln">${rxCk('map.corruptedOn', m.corruptedOn, 'Corrupted')}${rxInOut('map.corruptedMode', m.corruptedMode, !m.corruptedOn)}</div>
      <div class="rx-ln rx-wrap"><span class="rx-row">${RX.RARITIES.map((r) => rxCk(`map.rarity.${r.id}`, m.rarity[r.id], r.label)).join('')}</span>${rxInOut('map.rarityMode', m.rarityMode)}</div>
      <div class="rx-ln">${rxCk('map.unidOn', m.unidOn, 'Unidentified')}${rxInOut('map.unidMode', m.unidMode, !m.unidOn)}</div>
      <p class="rx-hint">An unidentified map shows no mods, so it passes "Don't want". Exclude them when that matters.</p></section>
    <section class="panel rx-box"><div class="rx-bh"><h3>Quality (Maven chisels)</h3>${short('map.qualShort', m.qualShort)}</div>
      <div class="rx-g2">${RX.QUALITY.map((q) => rxNum(`map.quality.${q.id}`, m.quality[q.id], q.id === 'any' ? 'Any kind' : q.label)).join('')}</div>
      ${rxCk('map.qualAny', m.qualAny, 'One kind of quality is enough')}</section>
    <section class="panel rx-box"><div class="rx-bh"><h3>Map types</h3></div>
      <div class="rx-types">${RX.MAP_TYPES.map((t) => `<div class="rx-tl">${rxCk(`map.typeOn.${t.id}`, m.typeOn[t.id], t.label)}${rxInOut(`map.typeMode.${t.id}`, m.typeMode[t.id], !m.typeOn[t.id])}</div>`).join('')}</div></section>`;
}
function rxListPanel(list) {
  const avoid = list === 'avoid';
  return `<section class="panel rx-list" aria-label="${avoid ? 'Mods you don\'t want' : 'Mods you want'}">
    <div class="rx-lh"><h2 class="${avoid ? 'no' : 'yes'}">${avoid ? 'Don\'t want' : 'Want'} <span id="rx-c-${list}"></span></h2>
      ${avoid ? '<button type="button" class="small" data-rx-do="fromRules" title="Adds the mods ticked on the Map check page">Add my Map check ticks</button>'
    : `<span class="rx-sw" role="radiogroup" id="rx-wantall"></span>`}</div>
    <p class="rx-hint">${avoid ? 'A map with any of these stays dark.' : 'Lights up maps with these.'} The number on each mod is how many of the ${RX.GAME_LIMIT} characters it adds.</p>
    <input type="search" class="rx-find" data-rx-find="${list}" placeholder="Find a mod, or paste a line from a map" aria-label="Find a mod" autocomplete="off" value="${esc(rxFind[list])}">
    <div class="rx-mlist" id="rx-l-${list}"></div>
  </section>`;
}
const RX_TICK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
function rxListOut(list) {
  const box = $(`rx-l-${list}`);
  if (!box) return;
  const m = rxB.map, mine = new Set(m[list]), other = new Set(m[list === 'avoid' ? 'wantMods' : 'avoid']);
  // Drawn only when something it shows changed: a state update every few seconds must not redo it.
  const key = JSON.stringify([m, rxFind[list], list === 'avoid' ? state.config.mapRules : 0]);
  if (rxListKey[list] === key && box.childElementCount) return;
  rxListKey[list] = key;
  const ticks = list === 'avoid' ? new Set(RX.modsFromRules(state.config.mapRules)) : new Set();
  const q = rxFind[list].trim().toLowerCase();
  // A pasted map line finds its mod by the mod's own piece.
  const fits = (x) => !q || x.text.toLowerCase().includes(q) || x.label.toLowerCase().includes(q) || (q.length > 8 && new RegExp(x.tok, 'i').test(q));
  const row = (x) => {
    const on = mine.has(x.id), taken = other.has(x.id), cost = taken ? 0 : Math.abs(RX.modCost(m, x.id, list));
    return `<button type="button" class="rx-md${on ? ' on' : ''}" data-rx-pick="${list}" data-id="${x.id}" aria-pressed="${on}"${taken ? ' disabled' : ''}>
      <span class="rx-tick">${on ? RX_TICK : ''}</span>
      <span>${esc(x.text)}${ticks.has(x.id) ? '<span class="rx-tag">Map check</span>' : ''}${taken ? `<span class="rx-in">in ${list === 'avoid' ? 'Want' : 'Don\'t want'}</span>` : ''}</span>
      ${taken ? '<span></span>' : `<span class="rx-cost" title="${on ? 'Characters this mod uses in the search' : 'Characters this mod would add to the search'}">${on ? '' : '+'}${cost}</span>`}</button>`;
  };
  const picked = RX.MAP_MODS.filter((x) => mine.has(x.id) && fits(x)), rest = RX.MAP_MODS.filter((x) => !mine.has(x.id) && fits(x));
  setHtml(box, picked.map(row).join('') + (picked.length && rest.length ? '<div class="rx-more">More mods</div>' : '') + rest.map(row).join('')
    || '<p class="rx-empty">No mod matches. Mods not in this list can still be found by their words in My searches.</p>');
  $(`rx-c-${list}`).textContent = m[list].length ? `${m[list].length} picked` : '';
  if (list === 'wantMods') setHtml($('rx-wantall'), rxSw('map.wantMatch', m.wantMatch, [['any', 'Any one'], ['all', 'All of them']]).replace(/^<span[^>]*>|<\/span>$/g, ''));
}

// ---- vendor builder ---------------------------------------------------------------------
function rxVendorHtml() {
  const v = rxB.vendor;
  const sel = (path, now, opts) => `<select data-rx-field="${path}">${opts.map(([x, l]) => `<option value="${x}"${now === x ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const box = (path, on, label, hint) => `<label class="rx-check"><input type="checkbox" data-rx-field="${path}"${on ? ' checked' : ''}> <span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
  return `${rxBarHtml('Vendor')}
    <section class="panel rx-vendor">
      <div class="rx-bh"><h3>Light up items at a vendor with any of these</h3></div>
      <p class="rx-hint">For levelling: press Ctrl+F in a vendor's window and paste, or open My searches in game with the stash search key.</p>
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
    </section>`;
}

// ---- tester ---------------------------------------------------------------------------------
function rxTestHtml() {
  return `<div class="rx-test">
    <label class="rx-field">The item <small>Hover an item in game, press Ctrl+C, then paste it here.</small>
      <textarea id="rx-item" rows="16" spellcheck="false" placeholder="Item Class: Maps&#10;Rarity: Rare&#10;…"></textarea></label>
    <div class="rx-test-side">
      <label class="rx-field">Search to try
        <input type="text" id="rx-try" class="mono" spellcheck="false" autocomplete="off" placeholder="&quot;!f phys|regen&quot; &quot;r pa.*([3-9]\\d|\\d{3})%&quot;"></label>
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
        <button type="button" class="small" data-ss-edit="${i}" ${x.text ? '' : 'disabled'} title="Opens it in Maps, ready to change">Edit</button>
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
// A change to the builders: kept at once, saved a moment later. redraw: the boxes are drawn
// again (after a click or tick; not while a number is typed, so the field keeps the cursor).
function rxSet(path, value, redraw) {
  const keys = path.split('.'), last = keys.pop();
  let o = rxB;
  for (const k of keys) o = o[k] = { ...(o[k] || {}) };
  o[last] = value === 'true' ? true : value === 'false' ? false : value;
  rxB = RX.cleanBuilders(rxB);
  clearTimeout(rxSaveTimer);
  rxSaveTimer = setTimeout(() => api.setConfig({ regex: rxB }), 400);
  if (redraw && $('rx-boxes')) {
    const a = document.activeElement, sel = a && a.dataset ? (a.dataset.rxSet ? `[data-rx-set="${a.dataset.rxSet}"][data-v="${a.dataset.v}"]` : a.dataset.rxF ? `[data-rx-f="${a.dataset.rxF}"]` : '') : '';
    setHtml($('rx-boxes'), rxBoxesHtml());
    const back = sel && $('rx-boxes').querySelector(sel);
    if (back) back.focus();
  }
  rxOut();
}
// A search pasted or typed in the bar: read back into the ticks, numbers and lists.
function rxRead(text) {
  if (rxTab === 'maps') rxB = { ...rxB, map: RX.readMapSearch(text) };
  else {
    // Vendor: what is pasted becomes your own words (one per part of the search).
    const t = RX.parseSearch(text).map((x) => x.body).join('|');
    rxB = RX.cleanBuilders({ ...rxB, vendor: { extra: t.split('|').map((x) => x.trim()).filter(Boolean).join(', ') } });
  }
  clearTimeout(rxSaveTimer); api.setConfig({ regex: rxB });
  const at = document.activeElement;
  rxDrawn = ''; renderRegex();
  if (at && at.id === 'rx-code') { const c = $('rx-code'); c.focus(); c.value = rxBuilt().text; }
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
  if (seg) { rxSet(seg.dataset.rxSet, seg.dataset.v, true); return; }
  const pick = e.target.closest('[data-rx-pick]');
  if (pick) {
    const list = pick.dataset.rxPick, id = pick.dataset.id, now = rxB.map[list];
    rxSet(`map.${list}`, now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
    return;
  }
  const d = e.target.closest('[data-rx-do]');
  if (d) {
    const what = d.dataset.rxDo, text = rxB && rxDrawn !== 'saved' && rxDrawn !== 'test' ? rxBuilt().text : '';
    if (what === 'fromRules') rxSet('map.avoid', [...new Set([...rxB.map.avoid, ...RX.modsFromRules(state.config.mapRules)])]);
    else if (what === 'unkeep') rxSet('map.kept', []);
    else if (what === 'reset') {
      rxEditing = null;
      rxB = RX.cleanBuilders({ ...rxB, [rxTab === 'maps' ? 'map' : 'vendor']: {} });
      rxFind = { avoid: '', wantMods: '' };
      clearTimeout(rxSaveTimer); api.setConfig({ regex: rxB });
      rxDrawn = ''; renderRegex();
    }
    else if (what === 'copy' && text) act({ type: 'regexCopy', text });
    else if (what === 'send' && text) act({ type: 'regexSend', text });
    else if ((what === 'save' || what === 'saveNew') && text) {
      const name = $('rx-name').value.trim() || $('rx-name').placeholder, list = ssList();
      // The row is found again by its text, in case the list was moved around meanwhile.
      const at = rxEditing ? (list[rxEditing.i] && list[rxEditing.i].text === rxEditing.orig ? rxEditing.i : list.findIndex((x) => x.text === rxEditing.orig)) : -1;
      if (what === 'save' && rxEditing && rxTab === 'maps' && at >= 0) {
        list[at] = { name, text };
        rxEditing = { i: at, name, orig: text };
        saveSearches(list);
      } else {
        saveSearches([...list, { name, text }]);
        if (rxEditing && rxTab === 'maps') { rxEditing = { i: list.length, name, orig: text }; rxDrawn = ''; renderRegex(); return; } // now editing the new copy
        $('rx-name').value = '';
      }
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
  const row = e.target.closest('[data-ss-copy],[data-ss-send],[data-ss-edit],[data-ss-try],[data-ss-move],[data-ss-del]');
  if (!row) return;
  const list = ssList(), ds = row.dataset;
  if (ds.ssCopy) { const x = list[Number(ds.ssCopy)]; if (x && x.text) act({ type: 'regexCopy', text: x.text }); return; }
  if (ds.ssSend) { act({ type: 'stashSearch', i: Number(ds.ssSend) }); return; }
  if (ds.ssEdit) {
    // Opens Maps with this search read in, its name in the bar; Save changes it in place.
    const i = Number(ds.ssEdit), x = list[i];
    if (!x || !x.text) return;
    rxB = { ...rxB, map: RX.readMapSearch(x.text) };
    clearTimeout(rxSaveTimer); api.setConfig({ regex: rxB });
    rxEditing = { i, name: x.name, orig: x.text };
    rxFind = { avoid: '', wantMods: '' };
    rxTab = 'maps';
    try { localStorage.setItem('regexTab', rxTab); } catch (_) { /* not kept */ }
    rxDrawn = ''; renderRegex();
    return;
  }
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
  if (t.id === 'rx-code') { if (t.value.trim() !== rxBuilt().text) rxRead(t.value); return; }
  if (t.dataset.rxF) { rxSet(t.dataset.rxF, t.checked, true); return; }
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
  if (t.dataset.rxNum) { rxSet(t.dataset.rxNum, Number(t.value.replace(/\D/g, '')) || 0); return; }
  if (t.dataset.rxFind) { rxFind[t.dataset.rxFind] = t.value; rxListOut(t.dataset.rxFind); return; }
  if (t.dataset.rxField && t.type === 'text') { rxSet(t.dataset.rxField, t.value); return; }
  if (t.id === 'rx-filter') { rxFilter = t.value; renderSearches(); return; }
  if (t.id === 'rx-item') { rxTry.item = t.value; rxTestOut(); return; }
  if (t.id === 'rx-try') { rxTry.search = t.value; rxTestOut(); }
});
// A paste is read at once; Escape puts the search back as it was.
$('rx-body').addEventListener('paste', (e) => { if (e.target.id === 'rx-code') setTimeout(() => rxRead(e.target.value), 0); });
$('rx-body').addEventListener('keydown', (e) => {
  if (e.target.id !== 'rx-code') return;
  if (e.key === 'Enter') { e.preventDefault(); rxRead(e.target.value); }
  else if (e.key === 'Escape') { e.target.value = rxBuilt().text; e.target.blur(); }
});
// Leaving the list draws it again, so the length and any problem show.
$('rx-body').addEventListener('focusout', (e) => {
  const box = $('ss-rows');
  if (!box || !box.contains(e.target) || (e.relatedTarget && box.contains(e.relatedTarget))) return;
  setTimeout(() => { if (state) { ssDrawn = ''; renderSearches(); } }, 0);
});
