'use strict';
// Trade page, Search (#trade-find, tracker #85). Laid out like the game's own market (the
// owner's wish, 0.68): on top the item search with who sells beside it, then every filter
// group of the trade site as a folding bar with one row per filter (name left, value right),
// stat filters last ("+ Add stat filter", "+ Add stat group"), and the buttons in a bar that
// stays at the bottom. Two tabs as in game: Search and Bulk exchange.
// What the game's market does not have: **live search** (as on the website, signed in): any
// search is watched, each new listing comes into a feed with a sound and a toast over the game,
// several at once. The right side shows the feed or the last search.
// The search, its answer, the filter list, live searches and the sign-in live in the main
// process (findAction); this file only draws and asks. Part of the main window script: one scope.

const TF_BLANK = () => ({ mode: 'items', item: null, text: '', seller: 'available', filters: {}, groups: [], sort: { by: 'price', dir: 'asc' }, bulk: { want: [], have: [], minimum: '', seller: 'online' } });
const tf = {
  form: TF_BLANK(),
  view: null,      // what the main process last answered (findView)
  lists: null,     // { groups, from, statGroups, sellers, bulkSellers, kinds }, asked for once
  asked: false, busy: '', error: '', open: '', // open: the listing unfolded
  rev: 0, drawn: '', formKey: '', footKey: '', liveKey: '',
  show: 'search',  // the right side: 'search' (the last search) or 'live' (the live feed)
  feedSeen: 0,     // newest live listing already told with a sound
  shut: {},        // filter groups opened or closed by hand, by id: true = open
  sug: { box: '', items: [], at: 0, note: '' }, // suggestions under one field
};
// What is being filled in is kept in this window, so it is still there after a restart.
try { const k = JSON.parse(localStorage.getItem('tradeFind') || 'null'); if (k && typeof k === 'object') tf.form = { ...TF_BLANK(), ...k }; } catch (_) { /* storage off */ }
try { tf.shut = JSON.parse(localStorage.getItem('tradeFindOpen') || '{}') || {}; } catch (_) { tf.shut = {}; }
const tfKeep = () => { try { localStorage.setItem('tradeFind', JSON.stringify(tf.form)); } catch (_) { /* not kept */ } };
const tfAmount = (n) => String(Math.round(Number(n) * 100) / 100);
const tfTimed = (what, fn) => (window.Hood ? window.Hood.run(`drawing the Trade page, search ${what}`, fn) : fn());
const tfOptions = (list, picked) => list.map(([id, label]) => `<option value="${esc(id)}"${String(id) === String(picked ?? '') ? ' selected' : ''}>${esc(label)}</option>`).join('');
const tfVal = (v) => (v === undefined || v === null ? '' : esc(v));
const tfSigned = () => !!(tf.view && tf.view.site && tf.view.site.in);
const tfX = (act, label, extra = '') => `<button type="button" class="tf-x" data-tfact="${act}" ${extra} aria-label="${esc(label)}" title="${esc(label)}">×</button>`;

// One ask of the main process; the answer is the new view. What went wrong shows over the results.
async function tfAsk(a, busy = '') {
  if (tf.busy && busy) return null;
  if (busy) { tf.busy = busy; tf.error = ''; tfDrawResults(); tfDrawFoot(); }
  try {
    const v = await api.tradeFind(a);
    if (v && 'league' in v) { tf.view = v; tf.rev += 1; tfLiveSound(); }
    if (busy) tf.error = '';
    return v;
  } catch (e) {
    tf.error = String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
    return null;
  } finally { if (busy) tf.busy = ''; renderFind(); }
}
// A new listing in the live feed: the same sound as a new trade offer (when sounds are on).
function tfLiveSound() {
  const top = tf.view && tf.view.live && tf.view.live.feed[0];
  if (!top) return;
  if (top.at > tf.feedSeen && tf.feedSeen && state && state.config && state.config.trade && state.config.trade.sound) beep();
  tf.feedSeen = Math.max(tf.feedSeen, top.at);
}

// ---- the form ------------------------------------------------------------------------------
const tfSugBox = (box) => `<div class="tf-sug" id="tf-sug-${box.replace(':', '-')}" role="listbox" aria-label="Matches" hidden></div>`;

// One bar of a folding group, as the game draws them: its name, how many are filled, clear.
function tfBar(id, title, n, open, inner) {
  return `<details class="tf-fg" data-fg="${esc(id)}"${open ? ' open' : ''}><summary><span class="tf-bt">${esc(title)}</span><b class="tf-n">${n || ''}</b>${n ? tfX('clearfg', `Clear ${title}`, `data-fg="${esc(id)}"`) : ''}</summary><div class="tf-rows">${inner}</div></details>`;
}
const tfRow = (label, control, tip = '', wide = false) => `<div class="tf-r${wide ? ' wide' : ''}"${tip ? ` title="${esc(tip)}"` : ''}><span class="tf-l">${esc(label)}</span><span class="tf-c">${control}</span></div>`;

function tfFilterHtml(g, f) {
  const v = (tf.form.filters[g.id] || {})[f.id];
  const o = v && typeof v === 'object' ? v : {};
  const key = `${g.id}.${f.id}`;
  const mm = `<input data-f="${key}.min" inputmode="decimal" placeholder="min" aria-label="${esc(f.text)} at least" value="${tfVal(o.min)}"><input data-f="${key}.max" inputmode="decimal" placeholder="max" aria-label="${esc(f.text)} at most" value="${tfVal(o.max)}">`;
  const opts = (f.options || []).map((x) => [x.id, x.text]);
  if (f.kind === 'range') return tfRow(f.text, `<span class="tf-mm">${mm}</span>`, f.tip);
  if (f.kind === 'option') return tfRow(f.text, `<select data-f="${key}.option" aria-label="${esc(f.text)}">${tfOptions(opts, o.option)}</select>`, f.tip);
  if (f.kind === 'text') return tfRow(f.text, `<input data-f="${key}.input" spellcheck="false" aria-label="${esc(f.text)}" value="${tfVal(typeof v === 'string' ? v : '')}">`, f.tip);
  if (f.kind === 'price') return tfRow(f.text, `<span class="tf-mm"><select data-f="${key}.option" aria-label="Currency">${tfOptions(opts, o.option)}</select>${mm}</span>`, f.tip, true);
  if (f.kind === 'sockets') return tfRow(f.text, `<span class="tf-sock">${['r', 'g', 'b', 'w'].map((c) => `<input class="c-${c}" data-f="${key}.${c}" inputmode="numeric" placeholder="${c.toUpperCase()}" aria-label="${esc(f.text)}, ${{ r: 'red', g: 'green', b: 'blue', w: 'white' }[c]}" value="${tfVal(o[c])}">`).join('')}${mm}</span>`, f.tip, true);
  return '';
}
const tfCount = (gid) => Object.keys(tf.form.filters[gid] || {}).length;
const tfIsOpen = (id, dflt) => (id in tf.shut ? tf.shut[id] : dflt);
const tfTypes = () => ((tf.lists && tf.lists.statGroups) || []).map((t) => [t.id, t.signedIn && !tfSigned() ? `${t.text} (signed in)` : t.text]);

function tfStatsHtml() {
  const L = tf.lists, kinds = L.kinds || {}, types = L.statGroups || [];
  const groups = tf.form.groups.map((g, gi) => {
    const def = types.find((x) => x.id === g.type) || types[0];
    const rows = g.stats.map((s, si) => `<div class="tf-stat${def.weights ? ' w' : ''}${s.off ? ' off' : ''}">
        <input type="checkbox" data-st="${gi}.${si}.on" ${s.off ? '' : 'checked'} aria-label="Use this stat" title="Use this stat">
        <span class="tf-ref" title="${esc(s.ref)}">${esc(s.ref)}</span>
        <select data-st="${gi}.${si}.kind" aria-label="Which kind of modifier" title="Which kind of modifier">${tfOptions([['any', 'Any']].concat((s.kinds || []).map((k) => [k, kinds[k] || k])), s.kind || 'any')}</select>
        <input data-st="${gi}.${si}.min" inputmode="decimal" placeholder="min" aria-label="At least" value="${tfVal(s.min)}"><input data-st="${gi}.${si}.max" inputmode="decimal" placeholder="max" aria-label="At most" value="${tfVal(s.max)}">
        ${def.weights ? `<input data-st="${gi}.${si}.weight" inputmode="decimal" placeholder="wt" aria-label="Weight" title="Weight" value="${tfVal(s.weight)}">` : ''}
        ${tfX('unstat', 'Take this stat out', `data-g="${gi}" data-s="${si}"`)}</div>`).join('');
    return `<div class="tf-group${g.off ? ' off' : ''}">
      <div class="tf-ghead"><input type="checkbox" data-gr="${gi}.on" ${g.off ? '' : 'checked'} aria-label="Use this group" title="Use this group">
        <select data-gr="${gi}.type" aria-label="Kind of group">${tfOptions(tfTypes(), g.type)}</select>
        ${def.minMax ? `<span class="tf-mm"><input data-gr="${gi}.min" inputmode="decimal" placeholder="min" aria-label="Group at least" value="${tfVal(g.min)}"><input data-gr="${gi}.max" inputmode="decimal" placeholder="max" aria-label="Group at most" value="${tfVal(g.max)}"></span>` : '<span></span>'}
        ${tfX('ungroup', 'Take this group out', `data-g="${gi}"`)}</div>
      ${rows}
      <div class="tf-box tf-addstat"><input type="search" data-sug="stat:${gi}" placeholder="+ Add stat filter" aria-label="Add a stat" spellcheck="false">${tfSugBox(`stat:${gi}`)}</div>
    </div>`;
  }).join('');
  const n = tf.form.groups.reduce((a, g) => a + g.stats.length, 0);
  const add = `<div class="tf-addgroup"><select data-tfaddgroup aria-label="Add a stat group"${tf.form.groups.length >= 8 ? ' disabled' : ''}><option value="">+ Add stat group</option>${tfOptions(tfTypes(), '')}</select></div>`;
  return tfBar('stats', 'Stat Filters', n, tfIsOpen('stats', true), groups + add);
}

function tfItemsHtml() {
  const f = tf.form, L = tf.lists;
  const head = `<div class="tf-top"><div class="tf-box">${f.item
    ? `<div class="tf-pick"><b>${esc(f.item.label)}</b>${tfX('unpick', 'Take the item out')}</div>`
    : `<input type="search" data-sug="item" placeholder="Search items" aria-label="Name of an item" spellcheck="false" value="${tfVal(f.text)}">${tfSugBox('item')}`}</div>
    <select data-tfseller aria-label="Who sells">${tfOptions(L.sellers, f.seller)}</select></div>`;
  const bars = L.groups.filter((g) => g.filters.length).map((g) => tfBar(g.id, g.title, tfCount(g.id), tfIsOpen(g.id, !!g.open || tfCount(g.id) > 0), g.filters.map((x) => tfFilterHtml(g, x)).join(''))).join('');
  return head + `<div class="tf-bars">${bars}${tfStatsHtml()}</div>`;
}

function tfChips(side) {
  return tf.form.bulk[side].map((x, i) => `<span class="tf-chip"><span class="it xs">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : ''}</span><span class="tf-cl">${esc(x.label)}</span>${tfX('unbulk', `Take ${x.label} out`, `data-side="${side}" data-i="${i}"`)}</span>`).join('');
}
function tfBulkHtml() {
  const b = tf.form.bulk, L = tf.lists;
  const pick = (side, ph) => `<div class="tf-box">${tf.form.bulk[side].length ? `<div class="tf-chips">${tfChips(side)}</div>` : ''}<input type="search" data-sug="${side}" placeholder="${ph}" aria-label="${ph}" spellcheck="false">${tfSugBox(side)}</div>`;
  return `<div class="tf-top"><span class="tf-l">Bulk item exchange</span><select data-bulk="seller" aria-label="Who sells">${tfOptions(L.bulkSellers, b.seller)}</select></div>
    <div class="tf-bars">${tfBar('bulk', 'What to exchange', b.want.length + b.have.length, true,
    tfRow('I want', pick('want', 'Type a name, like divine'), '', true) + tfRow('I pay with', pick('have', 'Anything, or type a name'), '', true) + tfRow('Minimum stock', `<input data-bulk="minimum" inputmode="numeric" placeholder="any" aria-label="Minimum stock" value="${tfVal(b.minimum)}">`))}</div>`;
}

// The form is drawn again only when its make-up changed (a stat or group added, the mode, a
// load), never for a value: typing only changes tf.form, so a field being typed in is kept.
function tfDrawForm(force = false) {
  const box = $('tf-formbox');
  if (!tf.lists) { setHtml(box, '<p class="empty">Reading the trade site\'s list of filters…</p>'); return; }
  const f = tf.form, items = f.mode !== 'bulk';
  const key = JSON.stringify([f.mode, f.item, f.groups.map((g) => [g.type, g.off, g.stats.map((s) => [s.ref, s.kind, s.off])]), f.bulk.want, f.bulk.have, tf.lists.from, tfSigned()]);
  if (!force && key === tf.formKey) return;
  tf.formKey = key;
  const html = `<form id="tf-form" autocomplete="off">
    <div class="tf-modes" role="tablist" aria-label="Kind of search"><button type="button" role="tab" data-tfmode="items" aria-selected="${items}">Search</button><button type="button" role="tab" data-tfmode="bulk" aria-selected="${!items}">Bulk exchange</button></div>
    ${items ? tfItemsHtml() : tfBulkHtml()}
    ${tf.lists.from !== 'site' && items ? '<p class="quiet tf-from">The trade site did not give its list of filters, so the app\'s own copy is shown. It is tried again at the next search.</p>' : ''}
  </form>`;
  const focus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute('data-sug') : null;
  const top = box.scrollTop;
  setHtml(box, html);
  box.scrollTop = top;
  if (focus) { const el = box.querySelector(`[data-sug="${focus}"]`); if (el) el.focus(); }
}

// The bar at the bottom: the buttons, then the saved searches and the sign-in.
function tfDrawFoot() {
  const v = tf.view, saved = (v && v.saved) || [], site = v && v.site, signed = tfSigned();
  const items = tf.form.mode !== 'bulk';
  const live = v && v.live;
  const full = live && live.searches.length >= live.max;
  const html = `<div class="tf-go">
      <button type="submit" form="tf-form" class="primary" id="tf-search"${tf.busy ? ' disabled' : ''}>${tf.busy === 'search' ? 'Searching…' : 'Search'}</button>
      ${items ? `<button type="button" class="tf-golive" data-tfact="live"${tf.busy || full ? ' disabled' : ''} title="${signed ? 'Watch this search: every new listing that matches comes in at once, with a sound and a note over the game' : 'Live search needs the sign-in to the trade site, as on the website'}"><i></i>${tf.busy === 'live' ? 'Starting…' : 'Go live'}</button>` : ''}
      <button type="button" data-tfact="save" title="Save this search">Save</button>
      <button type="button" data-tfact="reset" title="Clear every filter">Clear</button>
    </div>
    <div class="tf-meta">
      ${saved.length ? `<select data-tfload aria-label="Saved searches"><option value="">Saved searches (${saved.length})</option>${tfOptions(saved.map((s) => [s.name, s.name]), '')}</select>` : '<span class="quiet">No saved searches</span>'}
      ${!site ? '' : site.in ? `<span class="tf-who"><i class="ok"></i>${esc(site.name || 'Signed in')}<button type="button" class="link" data-tfact="signout">Sign out</button></span>`
        : `<span class="tf-who"><i></i>Not signed in<button type="button" class="link" data-tfact="signin" title="Sign in on pathofexile.com's own page: live search, weighted sums and Travel to hideout. The app never sees your password.">${site.window ? 'Show sign-in' : 'Sign in'}</button></span>`}
    </div>`;
  if (html === tf.footKey) return;
  tf.footKey = html;
  setHtml($('tf-foot'), html);
}

// ---- suggestions under a field ---------------------------------------------------------------
let tfSugTimer = 0;
function tfSuggest(box, typed) {
  clearTimeout(tfSugTimer);
  if (typed.trim().length < 2) { tfSugClose(); return; }
  tfSugTimer = setTimeout(async () => {
    const at = Date.now();
    const op = box === 'item' ? 'items' : box === 'want' || box === 'have' ? 'static' : 'stats';
    let r = null;
    try { r = await api.tradeFind({ op, text: typed }); } catch (_) { r = null; }
    if (tf.sug.at > at) return; // a later ask already answered
    const items = (r && (r.items || r.stats)) || [];
    tf.sug = { box, items, at, note: (r && r.problem) || (items.length ? '' : op === 'items' ? 'No item with that name. Press Search to look for these words anyway.' : op === 'stats' ? 'No stat with those words.' : 'Nothing with that name.') };
    tfDrawSug();
  }, 180);
}
function tfSugClose() { tf.sug = { box: '', items: [], at: Date.now(), note: '' }; tfDrawSug(); }
function tfDrawSug() {
  for (const el of $('tf-formbox').querySelectorAll('.tf-sug')) {
    const on = el.id === `tf-sug-${tf.sug.box.replace(':', '-')}`;
    el.hidden = !on;
    setHtml(el, !on ? '' : tf.sug.items.map((x, i) => (x.ref
      ? `<button type="button" role="option" data-tfsug="${i}"><b>${esc(x.ref)}</b></button>`
      : `<button type="button" role="option" data-tfsug="${i}">${x.image ? `<span class="it xs"><img src="${esc(x.image)}" alt="" loading="lazy"></span>` : ''}<b>${esc(x.label)}</b><small>${x.unique ? 'Unique · ' : ''}${esc(x.group)}</small></button>`)).join('') + (tf.sug.note ? `<p class="quiet">${esc(tf.sug.note)}</p>` : ''));
  }
}
function tfPickSug(i) {
  const x = tf.sug.items[i], box = tf.sug.box;
  if (!x) return;
  if (box === 'item') { tf.form.item = { label: x.label, name: x.name, type: x.type, disc: x.disc }; tf.form.text = ''; }
  else if (box === 'want' || box === 'have') { const list = tf.form.bulk[box]; if (!list.some((y) => y.id === x.id) && list.length < 10) list.push({ id: x.id, label: x.label, image: x.image || '' }); }
  else {
    const g = tf.form.groups[Number(box.split(':')[1])];
    if (g && !g.stats.some((s) => s.ref === x.ref) && g.stats.length < 40) g.stats.push({ ref: x.ref, kinds: x.kinds, kind: 'any', min: '', max: '', weight: '', off: false });
  }
  tfSugClose(); tfKeep(); tfDrawForm();
  const input = $('tf-formbox').querySelector(`[data-sug="${box}"]`);
  if (input) { input.value = ''; input.focus(); }
}

// ---- the right side: live searches, the feed, the last search ---------------------------------
function tfDrawLive() {
  const live = tf.view && tf.view.live, box = $('tf-live');
  const list = live ? live.searches : [];
  const now = Date.now();
  const word = { live: 'live', connecting: 'connecting', closed: 'stopped' };
  const html = !list.length && !(live && live.feed.length) ? '' : `<div class="tf-lhead"><span class="tx-label">Live</span>
      <span class="tf-tabs"><button type="button" class="tf-tab" data-tfshow="live" aria-pressed="${tf.show === 'live'}">New listings${live.feed.length ? ` <b>${live.feed.length}</b>` : ''}</button><button type="button" class="tf-tab" data-tfshow="search" aria-pressed="${tf.show === 'search'}">Last search</button></span></div>
    <div class="tf-lchips">${list.map((l) => `<span class="tf-lchip ${esc(l.state)}" title="${esc(`${l.name}: ${word[l.state] || l.state} for ${span(now - l.since)}${l.error ? ` (${l.error})` : ''}`)}"><i></i><button type="button" class="tf-ln" data-tfact="loadlive" data-key="${esc(l.key)}" title="Fill this search in">${esc(l.name)}</button>${l.hits ? `<b>${l.hits}</b>` : ''}${l.state === 'closed' ? `<button type="button" class="link" data-tfact="relive" data-key="${esc(l.key)}">Again</button>` : ''}${tfX('unlive', `Stop watching ${l.name}`, `data-key="${esc(l.key)}"`)}</span>`).join('')}</div>`;
  if (html === tf.liveKey) return;
  tf.liveKey = html;
  setHtml(box, html);
  box.hidden = !html;
}

const TF_KIND = { enchant: 'enchant', implicit: 'implicit', fractured: 'fractured', crafted: 'crafted' };
function tfDetailHtml(l) {
  const d = l.detail || {};
  const props = (d.props || []).map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('');
  const mods = (d.mods || []).map((m) => `<li class="${TF_KIND[m.kind] ? `tf-${TF_KIND[m.kind]}` : ''}"${m.raw ? ` title="${esc(m.raw)}"` : ''}>${esc(m.text)}</li>`).join('');
  const marks = [d.ilvl ? `Item level ${d.ilvl}` : '', l.sockets ? `Sockets ${l.sockets}` : '', d.corrupted ? 'Corrupted' : '', d.mirrored ? 'Mirrored' : '', d.split ? 'Split' : ''].filter(Boolean).join(' · ');
  return `<div class="tf-detail">${marks ? `<p class="quiet">${esc(marks)}</p>` : ''}${props ? `<p class="tf-props">${props}</p>` : ''}${mods ? `<ul>${mods}</ul>` : '<p class="quiet">No modifiers.</p>'}</div>`;
}
function tfButtonHtml(l, v, instant) {
  const live = l.live ? ` data-live="${esc(l.live)}"` : '';
  if (l.travel) return `<button type="button" class="primary" data-tfact="travel" data-tfid="${esc(l.id)}"${live} title="The trade site takes you to the seller's hideout">Travel</button>`;
  if (instant) return '<button type="button" data-tfact="open" title="An instant buyout is travelled to from the trade site. Sign in to do it from here.">Trade site</button>';
  if (l.whisper && l.status !== 'offline') return `<button type="button" data-tfact="whisper" data-tfid="${esc(l.id)}"${live}${v.canType ? '' : ' title="The app cannot type in the game on this PC right now"'}>${l.asked ? 'Ask again' : 'Whisper'}</button>`;
  return '<span class="tq-wait">no whisper</span>';
}
function tfRowHtml(l, v, d, now, names) {
  const instant = l.status === 'instant';
  const mark = l.bait ? ['bad', 'likely bait'] : l.asked ? ['wait', `${instant ? 'travelled' : 'whispered'} ${span(now - l.asked)} ago`] : instant ? ['ok', 'instant buyout'] : l.status === 'afk' ? ['', 'AFK'] : l.status === 'offline' ? ['', 'offline'] : ['', ''];
  const sub = [names ? names[l.live] : '', l.chaos != null && l.price && !/^(chaos|div)/i.test(l.price.currency) ? TradeCard.chaosText(l.chaos, d) : '', l.seller, l.live ? `came in ${span(now - l.at)} ago` : l.listedAt ? `listed ${span(now - l.listedAt)} ago` : '', l.itemLevel ? `item level ${l.itemLevel}` : '', l.corrupted ? 'corrupted' : ''].filter(Boolean).join(' · ');
  const open = tf.open === l.id;
  return `<div class="tw-row tf-row${l.bait ? ' dim' : ''}${l.live && now - l.at < 60000 ? ' fresh' : ''}"><b class="tw-price">${l.price ? `${esc(tfAmount(l.price.amount))} ${esc(l.price.currency)}` : 'no price'}</b>
    <button type="button" class="tf-open" data-tfact="unfold" data-tfid="${esc(l.id)}" aria-expanded="${open}"><span class="it sm">${l.icon ? `<img src="${esc(l.icon)}" alt="" loading="lazy">` : ''}</span><span class="tq-main"><b>${esc(l.name || l.base || 'Item')}</b><span>${esc(sub)}</span></span></button>
    ${mark[1] ? `<i class="${mark[0]}">${esc(mark[1])}</i>` : ''}${tfButtonHtml(l, v, instant)}</div>${open ? tfDetailHtml(l) : ''}`;
}
function tfBulkRowHtml(l, v, now) {
  const mark = l.asked ? ['wait', `whispered ${span(now - l.asked)} ago`] : l.status === 'afk' ? ['', 'AFK'] : l.status === 'offline' ? ['', 'offline'] : ['', ''];
  const sub = [`stock ${l.stock != null ? l.stock : '?'}`, l.seller, l.listedAt ? `listed ${span(now - l.listedAt)} ago` : ''].filter(Boolean).join(' · ');
  return `<div class="tw-row tf-row tf-bulk"><b class="tw-price">${esc(tfAmount(l.pay.amount))} ${esc(l.pay.currency)}</b>
    <span class="tq-main"><b>for ${esc(tfAmount(l.get.amount))} ${esc(l.get.currency)}</b><span>${esc(`${tfAmount(l.get.amount / l.pay.amount)} ${l.get.currency} per ${l.pay.currency} · ${sub}`)}</span></span>
    ${mark[1] ? `<i class="${mark[0]}">${esc(mark[1])}</i>` : ''}${tfButtonHtml(l, v, false)}</div>`;
}
function tfSortHtml() {
  const opts = [['price.asc', 'Cheapest first'], ['price.desc', 'Dearest first']];
  tf.form.groups.forEach((g, gi) => {
    const def = ((tf.lists && tf.lists.statGroups) || []).find((x) => x.id === g.type) || {};
    if (def.weights) opts.push([`group.${gi}`, `Highest ${def.text.toLowerCase()}`]);
    for (const s of g.stats) opts.push([`stat.${s.ref}`, `Highest: ${s.ref}`]);
  });
  const s = tf.form.sort || {};
  const cur = s.by === 'stat' ? `stat.${s.ref}` : s.by === 'group' ? `group.${s.i}` : `price.${s.dir || 'asc'}`;
  return `<select data-tfsort aria-label="Sort by" title="Sort by (searches again)">${tfOptions(opts, opts.some(([id]) => id === cur) ? cur : 'price.asc')}</select>`;
}
function tfDrawResults() {
  const v = tf.view, box = $('tf-results');
  const live = tf.show === 'live' && v && v.live;
  const key = [tf.rev, tf.open, tf.busy, tf.error, tf.show, tf.formKey, state && state.trade ? state.trade.divine : 0, Math.floor(Date.now() / 30000)].join('|');
  if (key === tf.drawn) return;
  tf.drawn = key;
  const err = tf.error ? `<p class="td-note neg">${esc(tf.error)}</p>` : '';
  const now = Date.now(), d = state && state.trade ? state.trade.divine : 0;
  if (live) {
    const names = Object.fromEntries(v.live.searches.map((x) => [x.key, x.name]));
    const rows = v.live.feed.map((x) => tfRowHtml(x, v, d, now, names)).join('');
    setHtml(box, `<header><div><span class="tx-label">Newest first · ${v.live.searches.filter((x) => x.state === 'live').length} watching</span><h3>New listings</h3></div>
        <span class="row">${v.live.feed.length ? '<button type="button" data-tfact="clearfeed">Clear</button>' : ''}</span></header>${err}
      <div class="tw-rows tf-list">${rows || '<p class="empty">Nothing new yet. Each listing that matches a live search comes in here the moment it is listed, with a sound and a note over the game.</p>'}</div>
      <p class="quiet tw-foot">One whisper or one trip per click. Nothing is bought or whispered by itself.</p>`);
    return;
  }
  if (tf.busy === 'search') { setHtml(box, '<p class="empty">Asking the trade site…</p>'); return; }
  const l = v && v.last;
  if (!l) {
    setHtml(box, `${err}<div class="tf-hello"><h3>Search the trade site</h3><p>Fill in the filters on the left and press Search. The site allows only a few searches a minute, so nothing is sent while you type.</p>
      <p><b>Go live</b> watches a search for you: every new listing that matches comes in at once, with a sound and a note over the game, for up to ${(v && v.live && v.live.max) || 10} searches at a time. It needs the sign-in, as on the website.</p></div>`);
    return;
  }
  const bulk = l.mode === 'bulk';
  const rows = l.listings.map((x) => (bulk ? tfBulkRowHtml(x, v, now) : tfRowHtml(x, v, d, now))).join('');
  const unknown = l.unknown && l.unknown.length ? `<p class="td-note neg">Left out, the trade site no longer has ${l.unknown.length === 1 ? 'this stat' : 'these stats'}: ${l.unknown.map(esc).join('; ')}</p>` : '';
  setHtml(box, `<header><div><span class="tx-label">${esc(Number(l.total).toLocaleString())} listed in ${esc(v.league)} · searched ${esc(span(now - l.at))} ago</span><h3>${esc(l.name)}</h3></div>
      <span class="row">${bulk ? '' : `${tfSortHtml()}<button type="button" data-tfact="want"${l.listings.length ? '' : ' disabled'} title="Keep this search and its sellers on the Buying list">Add to Buying</button>`}${l.url ? '<button type="button" data-tfact="open">Trade site</button>' : ''}</span></header>
    ${err}${unknown}
    <div class="tw-rows tf-list">${rows || '<p class="empty">Nothing like it is listed. Take a stat or a filter out, or widen a number.</p>'}
      ${l.left ? `<div class="tf-more"><button type="button" data-tfact="more"${tf.busy ? ' disabled' : ''}>${tf.busy === 'more' ? 'Reading…' : `Show ${Math.min(10, l.left)} more`}</button><span class="quiet">${l.listings.length} of ${l.listings.length + l.left} read${l.total > l.listings.length + l.left ? '; the trade site hands out the first 100 of a search' : ''}</span></div>` : ''}</div>
    <p class="quiet tw-foot">One whisper or one trip per click.${bulk ? '' : ' Click a listing to see the whole item.'}</p>`);
}

function renderFind() {
  if (!tf.asked) {
    tf.asked = true;
    api.tradeFind({ op: 'lists' }).then(async (L) => {
      tf.lists = L;
      // A form kept from an older version (or a saved one) is read into the new shape once.
      try { const c = await api.tradeFind({ op: 'clean', form: tf.form }); if (c && c.form) { tf.form = c.form; tfKeep(); } } catch (_) { /* keep as is */ }
      tfDrawForm(true); renderFind();
    }).catch(() => {});
    tfAsk({ op: 'get' });
  }
  tfTimed('form', tfDrawForm);
  tfTimed('foot', tfDrawFoot);
  tfTimed('live', tfDrawLive);
  tfTimed('results', tfDrawResults);
}

// ---- what the user does --------------------------------------------------------------------
function tfSetPath(obj, keys, value) {
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
  o[keys[keys.length - 1]] = value;
}
// A filter changed: its value is kept in the form's own shape (empty parts taken out).
function tfFilterInput(el) {
  const [g, f, part] = el.dataset.f.split('.');
  const all = tf.form.filters;
  if (part === 'input') { if (el.value.trim()) tfSetPath(all, [g, f], el.value); else if (all[g]) delete all[g][f]; }
  else {
    const cur = all[g] && all[g][f] && typeof all[g][f] === 'object' ? all[g][f] : {};
    if (el.value === '') delete cur[part]; else cur[part] = el.value;
    if (Object.keys(cur).length) tfSetPath(all, [g, f], cur); else if (all[g]) delete all[g][f];
  }
  if (all[g] && !Object.keys(all[g]).length) delete all[g];
  const n = el.closest('details') && el.closest('details').querySelector('.tf-n');
  if (n) n.textContent = tfCount(g) || '';
}
function tfSearch() { tfSugClose(); tf.open = ''; tf.show = 'search'; tf.liveKey = ''; tfAsk({ op: 'search', form: tf.form }, 'search'); }
$('trade-find').addEventListener('submit', (e) => { if (e.target.id !== 'tf-form') return; e.preventDefault(); tfSearch(); });
$('trade-find').addEventListener('input', (e) => {
  const el = e.target, d = el.dataset;
  if (d.sug) { if (d.sug === 'item') tf.form.text = el.value; tfSuggest(d.sug, el.value); }
  else if (d.f) tfFilterInput(el);
  else if (d.st) { const [gi, si, part] = d.st.split('.'); const s = (tf.form.groups[gi] || { stats: [] }).stats[si]; if (s) { if (part === 'on') s.off = !el.checked; else s[part] = el.value; } if (part === 'on' || part === 'kind') tfDrawForm(); }
  else if (d.gr) { const [gi, part] = d.gr.split('.'); const g = tf.form.groups[gi]; if (g) { if (part === 'on') g.off = !el.checked; else g[part] = el.value; } if (part === 'on' || part === 'type') tfDrawForm(); }
  else if ('tfseller' in d) tf.form.seller = el.value;
  else if ('tfaddgroup' in d) {
    if (!el.value) return;
    tf.form.groups.push({ type: el.value, min: '', max: '', off: false, stats: [] });
    tf.shut.stats = true;
    tfKeep(); tfDrawForm();
    const box = $('tf-formbox').querySelector(`[data-sug="stat:${tf.form.groups.length - 1}"]`); if (box) box.focus();
    return;
  } else if ('tfsort' in d) {
    const [by, ...rest] = el.value.split('.'); const r = rest.join('.');
    tf.form.sort = by === 'stat' ? { by, ref: r } : by === 'group' ? { by, i: Number(r) } : { by: 'price', dir: r };
    tfKeep(); tfSearch(); return;
  } else if ('tfload' in d) {
    const s = ((tf.view && tf.view.saved) || []).find((x) => x.name === el.value);
    if (s) { tf.form = { ...TF_BLANK(), ...JSON.parse(JSON.stringify(s.form)) }; tfKeep(); tfDrawForm(true); }
    el.value = ''; return;
  } else if (d.bulk) tf.form.bulk[d.bulk] = el.value;
  else return;
  tfKeep();
});
// Enter in a field with suggestions takes the first one; Escape closes them.
$('trade-find').addEventListener('keydown', (e) => {
  const box = e.target.dataset && e.target.dataset.sug;
  if (!box) return;
  if (e.key === 'Escape' && tf.sug.box) { tfSugClose(); e.preventDefault(); }
  else if (e.key === 'Enter' && tf.sug.box === box && tf.sug.items.length) { e.preventDefault(); tfPickSug(0); }
  else if (e.key === 'Enter' && box !== 'item') e.preventDefault(); // a half-typed name does not start a search
});
// A group bar opened or closed by hand stays so (kept in this window).
$('trade-find').addEventListener('toggle', (e) => {
  const g = e.target.dataset && e.target.dataset.fg;
  if (!g) return;
  tf.shut[g] = e.target.open;
  try { localStorage.setItem('tradeFindOpen', JSON.stringify(tf.shut)); } catch (_) { /* not kept */ }
}, true);
$('trade-find').addEventListener('click', async (e) => {
  const sug = e.target.closest('[data-tfsug]');
  if (sug) { tfPickSug(Number(sug.dataset.tfsug)); return; }
  const mode = e.target.closest('[data-tfmode]');
  if (mode) { tf.form.mode = mode.dataset.tfmode; tfSugClose(); tfKeep(); tfDrawForm(); tfDrawFoot(); return; }
  const show = e.target.closest('[data-tfshow]');
  if (show) { tf.show = show.dataset.tfshow; tf.liveKey = ''; renderFind(); return; }
  const b = e.target.closest('[data-tfact]');
  if (!b) return;
  const what = b.dataset.tfact, id = b.dataset.tfid;
  if (what === 'clearfg') { e.preventDefault(); if (b.dataset.fg === 'stats') tf.form.groups = []; else delete tf.form.filters[b.dataset.fg]; tfKeep(); tfDrawForm(true); }
  else if (what === 'reset') { const mode = tf.form.mode; tf.form = { ...TF_BLANK(), mode }; tfKeep(); tfDrawForm(true); }
  else if (what === 'save') await tfAsk({ op: 'save', form: tf.form });
  else if (what === 'unpick') { tf.form.item = null; tfKeep(); tfDrawForm(); const el = $('tf-formbox').querySelector('[data-sug="item"]'); if (el) el.focus(); }
  else if (what === 'ungroup') { tf.form.groups.splice(Number(b.dataset.g), 1); if (tf.form.sort && tf.form.sort.by !== 'price') tf.form.sort = { by: 'price', dir: 'asc' }; tfKeep(); tfDrawForm(); }
  else if (what === 'unstat') { const g = tf.form.groups[Number(b.dataset.g)]; if (g) g.stats.splice(Number(b.dataset.s), 1); tfKeep(); tfDrawForm(); }
  else if (what === 'unbulk') { tf.form.bulk[b.dataset.side].splice(Number(b.dataset.i), 1); tfKeep(); tfDrawForm(); }
  else if (what === 'unfold') { tf.open = tf.open === id ? '' : id; tfDrawResults(); }
  else if (what === 'loadlive') { const l = tf.view.live.searches.find((x) => x.key === b.dataset.key); if (l && l.form) { tf.form = { ...TF_BLANK(), ...JSON.parse(JSON.stringify(l.form)) }; tfKeep(); tfDrawForm(true); } }
  else if (what === 'live') { if (!tfSigned()) { tf.error = 'Live search needs the sign-in to the trade site, as on the website. Sign in at the bottom left.'; tf.drawn = ''; tfDrawResults(); return; } const r = await tfAsk({ op: 'live', form: tf.form }, 'live'); if (r) { tf.show = 'live'; tf.liveKey = ''; renderFind(); } }
  else if (what === 'unlive' || what === 'relive') tfAsk({ op: what, key: b.dataset.key });
  else if (what === 'clearfeed') tfAsk({ op: 'clearfeed' });
  else if (what === 'signout') { if (await askYes('Sign out of the trade site in this app? Live searches stop; searching and whispering keep working.', { yes: 'Sign out' })) tfAsk({ op: 'signout' }); }
  else if (what === 'more') tfAsk({ op: 'more' }, 'more');
  else if (['whisper', 'travel'].includes(what)) tfAsk({ op: what, id, live: b.dataset.live || undefined });
  else if (['want', 'open', 'signin'].includes(what)) tfAsk({ op: what, id });
});
// News from the main process (a live listing, a connection, the sign-in window): ask again.
if (api.onTradeFindNews) api.onTradeFindNews(() => { if (tf.asked) tfAsk({ op: 'get' }); });
