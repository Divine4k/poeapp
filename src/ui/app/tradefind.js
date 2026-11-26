'use strict';
// Trade page, Search (#trade-find, tracker #85): a search of the trade site started from
// nothing, with everything the site's own search page has (0.67). Two modes, as on the site:
// - Listed items: the item by name, stat groups (And, Not, If, Count, Weighted Sum, v2), every
//   filter group the site lists (drawn from its own list, core/tradeFilters.js), who sells, sort.
// - Bulk exchange: what you want and what you pay with, minimum stock, who sells.
// Right: what the site has, with one button per listing (Whisper, or Travel when signed in).
// The search, its answer, the filter list and the sign-in live in the main process
// (findAction); this file only draws and asks. Part of the main window script: one scope.

const TF_BLANK = () => ({ mode: 'items', item: null, text: '', seller: 'available', filters: {}, groups: [], sort: { by: 'price', dir: 'asc' }, bulk: { want: [], have: [], minimum: '', seller: 'online' } });
const tf = {
  form: TF_BLANK(),
  view: null,      // what the main process last answered (findView)
  lists: null,     // { groups, from, statGroups, sellers, bulkSellers, kinds }, asked for once
  asked: false, busy: '', error: '', open: '', // open: the listing unfolded
  rev: 0, drawn: '', formKey: '',
  shut: {},        // filter groups the user opened or closed, by id: true = open
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

// One ask of the main process; the answer is the new view. What went wrong shows over the results.
async function tfAsk(a, busy = '') {
  if (tf.busy) return null;
  tf.busy = busy; tf.error = '';
  if (busy) { tfDrawResults(); tfDrawForm(); }
  try {
    const v = await api.tradeFind(a);
    if (v && 'league' in v) { tf.view = v; tf.rev += 1; }
    return v;
  } catch (e) {
    tf.error = String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
    return null;
  } finally { tf.busy = ''; renderFind(); }
}

// ---- the form: listed items ----------------------------------------------------------------
const tfSugBox = (box) => `<div class="tf-sug" id="tf-sug-${box}" role="listbox" aria-label="Matches" hidden></div>`;

function tfStatGroupsHtml() {
  const L = tf.lists, kinds = L.kinds || {}, types = L.statGroups || [];
  const signed = !!(tf.view && tf.view.site && tf.view.site.in);
  const groups = tf.form.groups.map((g, gi) => {
    const def = types.find((x) => x.id === g.type) || types[0];
    const rows = g.stats.map((s, si) => `<div class="tf-stat${def.weights ? ' w' : ''}${s.off ? ' off' : ''}">
        <input type="checkbox" data-st="${gi}.${si}.on" ${s.off ? '' : 'checked'} aria-label="Use this stat" title="Use this stat">
        <span class="tf-ref" title="${esc(s.ref)}">${esc(s.ref)}</span>
        <select data-st="${gi}.${si}.kind" aria-label="Which kind of modifier">${tfOptions([['any', 'Any kind']].concat((s.kinds || []).map((k) => [k, kinds[k] || k])), s.kind || 'any')}</select>
        <input data-st="${gi}.${si}.min" inputmode="decimal" placeholder="min" aria-label="At least" value="${tfVal(s.min)}"><input data-st="${gi}.${si}.max" inputmode="decimal" placeholder="max" aria-label="At most" value="${tfVal(s.max)}">
        ${def.weights ? `<input data-st="${gi}.${si}.weight" inputmode="decimal" placeholder="weight" aria-label="Weight" value="${tfVal(s.weight)}">` : ''}
        <button type="button" class="tf-x" data-tfact="unstat" data-g="${gi}" data-s="${si}" aria-label="Take this stat out" title="Take this stat out">×</button></div>`).join('');
    return `<div class="tf-group${g.off ? ' off' : ''}">
      <div class="tf-ghead"><input type="checkbox" data-gr="${gi}.on" ${g.off ? '' : 'checked'} aria-label="Use this group" title="Use this group">
        <select data-gr="${gi}.type" aria-label="Kind of group">${tfOptions(types.map((t) => [t.id, t.signedIn && !signed ? `${t.text} (signed in only)` : t.text]), g.type)}</select>
        ${def.minMax ? `<input data-gr="${gi}.min" inputmode="decimal" placeholder="min" aria-label="Group at least" value="${tfVal(g.min)}"><input data-gr="${gi}.max" inputmode="decimal" placeholder="max" aria-label="Group at most" value="${tfVal(g.max)}">` : '<span></span><span></span>'}
        <button type="button" class="tf-x" data-tfact="ungroup" data-g="${gi}" aria-label="Take this group out" title="Take this group out">×</button></div>
      ${rows}
      <div class="tf-box"><input type="search" data-sug="stat:${gi}" placeholder="Add a stat: type a few words, like max life" aria-label="Add a stat" spellcheck="false">${tfSugBox(`stat-${gi}`)}</div>
    </div>`;
  }).join('');
  return `<div class="tf-sect"><span class="tx-label">Stat filters</span>${groups}
    <button type="button" class="tf-add" data-tfact="addgroup"${tf.form.groups.length >= 8 ? ' disabled' : ''}>+ Add stat group</button></div>`;
}

function tfFilterHtml(g, f) {
  const v = (tf.form.filters[g.id] || {})[f.id];
  const o = v && typeof v === 'object' ? v : {};
  const key = `${g.id}.${f.id}`, tip = f.tip ? ` title="${esc(f.tip)}"` : '';
  const mm = `<input data-f="${key}.min" inputmode="decimal" placeholder="min" aria-label="${esc(f.text)} at least" value="${tfVal(o.min)}"><input data-f="${key}.max" inputmode="decimal" placeholder="max" aria-label="${esc(f.text)} at most" value="${tfVal(o.max)}">`;
  const opts = (f.options || []).map((x) => [x.id, x.text]);
  if (f.kind === 'range') return `<label class="tf-f"${tip}><span>${esc(f.text)}</span><span class="tf-mm">${mm}</span></label>`;
  if (f.kind === 'option') return `<label class="tf-f"${tip}><span>${esc(f.text)}</span><select data-f="${key}.option">${tfOptions(opts, o.option)}</select></label>`;
  if (f.kind === 'text') return `<label class="tf-f"${tip}><span>${esc(f.text)}</span><input data-f="${key}.input" spellcheck="false" value="${tfVal(typeof v === 'string' ? v : '')}"></label>`;
  if (f.kind === 'price') return `<label class="tf-f wide"${tip}><span>${esc(f.text)}</span><span class="tf-mm"><select data-f="${key}.option" aria-label="Currency">${tfOptions(opts, o.option)}</select>${mm}</span></label>`;
  if (f.kind === 'sockets') return `<div class="tf-f wide"${tip}><span>${esc(f.text)}</span><span class="tf-sock">${['r', 'g', 'b', 'w'].map((c) => `<input class="c-${c}" data-f="${key}.${c}" inputmode="numeric" placeholder="${c.toUpperCase()}" aria-label="${esc(f.text)}, ${{ r: 'red', g: 'green', b: 'blue', w: 'white' }[c]}" value="${tfVal(o[c])}">`).join('')}${mm}</span></div>`;
  return '';
}
const tfCount = (gid) => Object.keys(tf.form.filters[gid] || {}).length;
function tfFilterGroupsHtml() {
  return tf.lists.groups.filter((g) => g.filters.length).map((g) => {
    const n = tfCount(g.id), open = g.id in tf.shut ? tf.shut[g.id] : (g.open || n > 0);
    return `<details class="tf-fg" data-fg="${esc(g.id)}"${open ? ' open' : ''}><summary><span>${esc(g.title)}</span><b class="tf-n">${n || ''}</b>${n ? `<button type="button" class="tf-x" data-tfact="clearfg" data-fg="${esc(g.id)}" aria-label="Clear ${esc(g.title)}" title="Clear this group">×</button>` : ''}</summary>
      <div class="tf-fs">${g.filters.map((f) => tfFilterHtml(g, f)).join('')}</div></details>`;
  }).join('');
}

function tfSortHtml() {
  const opts = [['price.asc', 'Price: cheapest first'], ['price.desc', 'Price: dearest first']];
  tf.form.groups.forEach((g, gi) => {
    const def = (tf.lists.statGroups || []).find((x) => x.id === g.type) || {};
    if (def.weights) opts.push([`group.${gi}`, `Highest ${def.text.toLowerCase()} (group ${gi + 1})`]);
    for (const s of g.stats) opts.push([`stat.${s.ref}`, `Highest: ${s.ref}`]);
  });
  const s = tf.form.sort || {};
  const cur = s.by === 'stat' ? `stat.${s.ref}` : s.by === 'group' ? `group.${s.i}` : `price.${s.dir || 'asc'}`;
  return `<label><span class="tx-label">Sort by</span><select data-tfsort>${tfOptions(opts, opts.some(([id]) => id === cur) ? cur : 'price.asc')}</select></label>`;
}

function tfItemsHtml() {
  const f = tf.form, L = tf.lists;
  return `<div class="tf-box"><span class="tx-label">Item</span>
      ${f.item ? `<div class="tf-pick"><b>${esc(f.item.label)}</b><button type="button" class="tf-x" data-tfact="unpick" aria-label="Take the item out" title="Take the item out">×</button></div>`
        : `<input type="search" data-sug="item" placeholder="Name of an item, or leave empty" aria-label="Name of an item" spellcheck="false" value="${tfVal(f.text)}">${tfSugBox('item')}`}
    </div>
    ${tfStatGroupsHtml()}
    <div class="tf-fgs">${tfFilterGroupsHtml()}</div>
    <div class="tf-pair"><label><span class="tx-label">Sold by</span><select data-tfseller>${tfOptions(L.sellers, f.seller)}</select></label>${tfSortHtml()}</div>`;
}

// ---- the form: bulk exchange -----------------------------------------------------------------
function tfChips(side) {
  return tf.form.bulk[side].map((x, i) => `<span class="tf-chip"><span class="it xs">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : ''}</span><span class="tf-cl">${esc(x.label)}</span><button type="button" class="tf-x" data-tfact="unbulk" data-side="${side}" data-i="${i}" aria-label="Take ${esc(x.label)} out" title="Take it out">×</button></span>`).join('');
}
function tfBulkHtml() {
  const b = tf.form.bulk, L = tf.lists;
  return `<div class="tf-box"><span class="tx-label">I want</span><div class="tf-chips">${tfChips('want')}</div>
      <input type="search" data-sug="want" placeholder="Type a name, like divine or scarab" aria-label="What you want" spellcheck="false">${tfSugBox('want')}</div>
    <div class="tf-box"><span class="tx-label">I pay with <small class="quiet">(empty: anything)</small></span><div class="tf-chips">${tfChips('have')}</div>
      <input type="search" data-sug="have" placeholder="Type a name, like chaos" aria-label="What you pay with" spellcheck="false">${tfSugBox('have')}</div>
    <div class="tf-pair"><label><span class="tx-label">Minimum stock</span><input data-bulk="minimum" inputmode="numeric" placeholder="any" value="${tfVal(b.minimum)}"></label>
      <label><span class="tx-label">Sold by</span><select data-bulk="seller">${tfOptions(L.bulkSellers, b.seller)}</select></label></div>`;
}

// The form is drawn again only when its make-up changed (a stat or group added, the mode, a
// load), never for a value: typing only changes tf.form, so a field being typed in is kept.
function tfDrawForm(force = false) {
  const box = $('tf-formbox');
  if (!tf.lists) { setHtml(box, '<p class="empty">Reading the trade site\'s list of filters…</p>'); return; }
  const f = tf.form, items = f.mode !== 'bulk';
  const key = JSON.stringify([f.mode, f.item, f.groups.map((g) => [g.type, g.off, g.stats.map((s) => [s.ref, s.kind, s.off])]), f.bulk.want, f.bulk.have, tf.lists.from, tf.busy, !!(tf.view && tf.view.site && tf.view.site.in)]);
  if (!force && key === tf.formKey) return;
  tf.formKey = key;
  const html = `<form id="tf-form" autocomplete="off">
    <div class="tf-modes" role="tablist" aria-label="Kind of search"><button type="button" role="tab" data-tfmode="items" aria-selected="${items}">Listed items</button><button type="button" role="tab" data-tfmode="bulk" aria-selected="${!items}">Bulk exchange</button></div>
    ${items ? tfItemsHtml() : tfBulkHtml()}
    <div class="tf-go"><button type="submit" class="primary" id="tf-search"${tf.busy ? ' disabled' : ''}>${tf.busy === 'search' ? 'Searching…' : 'Search'}</button><button type="button" data-tfact="save">Save this search</button><button type="button" data-tfact="reset">Start over</button></div>
    ${tf.lists.from !== 'site' && items ? '<p class="quiet tf-from">The trade site did not give its list of filters, so the app\'s own copy is shown. It is tried again at the next search.</p>' : ''}
  </form>`;
  const focus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute('data-sug') : null;
  setHtml(box, html);
  if (focus) { const el = box.querySelector(`[data-sug="${focus}"]`); if (el) el.focus(); }
}

function tfDrawSide() {
  const v = tf.view, saved = (v && v.saved) || [];
  setHtml($('tf-saved'), saved.length ? `<span class="tx-label">Saved searches</span><div class="tf-chips">${saved.map((s) => `<span class="tf-chip"><button type="button" data-tfact="load" data-name="${esc(s.name)}" title="Fill this search in">${esc(s.name)}</button><button type="button" class="tf-x" data-tfact="unsave" data-name="${esc(s.name)}" aria-label="Forget this search" title="Forget this search">×</button></span>`).join('')}</div>` : '');
  const site = v && v.site;
  setHtml($('tf-site'), !site ? '' : site.in
    ? `<p><b class="pos">Signed in to the trade site${site.name ? ` as ${esc(site.name)}` : ''}.</b> Searches count against your own account's limits, weighted sums work, and an instant buyout has a Travel button.</p><button type="button" data-tfact="signout">Sign out</button>`
    : `<p><b>Not signed in to the trade site.</b> Searching and whispering work without it. Signed in, weighted sums work and an instant buyout gets a Travel button. You sign in on pathofexile.com's own page; the app never sees your password.</p><button type="button" data-tfact="signin">${site.window ? 'Show the sign-in window' : 'Sign in'}</button>`);
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

// ---- the results ---------------------------------------------------------------------------
const TF_KIND = { enchant: 'enchant', implicit: 'implicit', fractured: 'fractured', crafted: 'crafted' };
function tfDetailHtml(l) {
  const d = l.detail || {};
  const props = (d.props || []).map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('');
  const mods = (d.mods || []).map((m) => `<li class="${TF_KIND[m.kind] ? `tf-${TF_KIND[m.kind]}` : ''}"${m.raw ? ` title="${esc(m.raw)}"` : ''}>${esc(m.text)}</li>`).join('');
  const marks = [d.ilvl ? `Item level ${d.ilvl}` : '', l.sockets ? `Sockets ${l.sockets}` : '', d.corrupted ? 'Corrupted' : '', d.mirrored ? 'Mirrored' : '', d.split ? 'Split' : ''].filter(Boolean).join(' · ');
  return `<div class="tf-detail">${marks ? `<p class="quiet">${esc(marks)}</p>` : ''}${props ? `<p class="tf-props">${props}</p>` : ''}${mods ? `<ul>${mods}</ul>` : '<p class="quiet">No modifiers.</p>'}</div>`;
}
function tfButtonHtml(l, v, instant) {
  if (l.travel) return `<button type="button" class="primary" data-tfact="travel" data-tfid="${esc(l.id)}" title="The trade site takes you to the seller's hideout">Travel</button>`;
  if (instant) return '<button type="button" data-tfact="open" title="An instant buyout is travelled to from the trade site. Sign in under the form to do it from here.">Trade site</button>';
  if (l.whisper && l.status !== 'offline') return `<button type="button" data-tfact="whisper" data-tfid="${esc(l.id)}"${v.canType ? '' : ' title="The app cannot type in the game on this PC right now"'}>${l.asked ? 'Ask again' : 'Whisper'}</button>`;
  return '<span class="tq-wait">no whisper</span>';
}
function tfRowHtml(l, v, d, now) {
  const instant = l.status === 'instant';
  const mark = l.bait ? ['bad', 'likely bait'] : l.asked ? ['wait', `${instant ? 'travelled' : 'whispered'} ${span(now - l.asked)} ago`] : instant ? ['ok', 'instant buyout'] : l.status === 'afk' ? ['', 'AFK'] : l.status === 'offline' ? ['', 'offline'] : ['', ''];
  const sub = [l.chaos != null && l.price && !/^(chaos|div)/i.test(l.price.currency) ? TradeCard.chaosText(l.chaos, d) : '', l.seller, l.listedAt ? `listed ${span(now - l.listedAt)} ago` : '', l.itemLevel ? `item level ${l.itemLevel}` : '', l.corrupted ? 'corrupted' : ''].filter(Boolean).join(' · ');
  const open = tf.open === l.id;
  return `<div class="tw-row tf-row${l.bait ? ' dim' : ''}"><b class="tw-price">${l.price ? `${esc(tfAmount(l.price.amount))} ${esc(l.price.currency)}` : 'no price'}</b>
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
function tfDrawResults() {
  const v = tf.view, box = $('tf-results');
  const key = [tf.rev, tf.open, tf.busy, tf.error, state && state.trade ? state.trade.divine : 0, Math.floor(Date.now() / 30000)].join('|');
  if (key === tf.drawn) return;
  tf.drawn = key;
  const err = tf.error ? `<p class="td-note neg">${esc(tf.error)}</p>` : '';
  if (tf.busy === 'search') { setHtml(box, '<p class="empty">Asking the trade site…</p>'); return; }
  const l = v && v.last;
  if (!l) {
    setHtml(box, `${err}<p class="empty">Fill in what you are looking for and press Search. Every search is a request to the trade site, which allows only a few per minute, so it runs when you press the button and not while you type.</p>`);
    return;
  }
  const now = Date.now(), d = state && state.trade ? state.trade.divine : 0, bulk = l.mode === 'bulk';
  const rows = l.listings.map((x) => (bulk ? tfBulkRowHtml(x, v, now) : tfRowHtml(x, v, d, now))).join('');
  const unknown = l.unknown && l.unknown.length ? `<p class="td-note neg">Left out, the trade site no longer has ${l.unknown.length === 1 ? 'this stat' : 'these stats'}: ${l.unknown.map(esc).join('; ')}</p>` : '';
  setHtml(box, `<header><div><span class="tx-label">${esc(Number(l.total).toLocaleString())} listed in ${esc(v.league)} · searched ${esc(span(now - l.at))} ago</span><h3>${esc(l.name)}</h3></div>
      <span class="row">${bulk ? '' : `<button type="button" data-tfact="want"${l.listings.length ? '' : ' disabled'} title="Keep this search and its sellers on the Buying list">Add to Buying</button>`}${l.url ? '<button type="button" data-tfact="open">Trade site</button>' : ''}</span></header>
    ${err}${unknown}
    <div class="tw-rows tf-rows">${rows || '<p class="empty">Nothing like it is listed. Take a stat or a filter out, or widen a number.</p>'}
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
  tfTimed('side', tfDrawSide);
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
$('trade-find').addEventListener('submit', (e) => {
  if (e.target.id !== 'tf-form') return;
  e.preventDefault(); tfSugClose(); tf.open = '';
  tfAsk({ op: 'search', form: tf.form }, 'search');
});
$('trade-find').addEventListener('input', (e) => {
  const el = e.target, d = el.dataset;
  if (d.sug) { if (d.sug === 'item') tf.form.text = el.value; tfSuggest(d.sug, el.value); }
  else if (d.f) tfFilterInput(el);
  else if (d.st) { const [gi, si, part] = d.st.split('.'); const s = (tf.form.groups[gi] || { stats: [] }).stats[si]; if (s) { if (part === 'on') s.off = !el.checked; else s[part] = el.value; } if (part === 'on' || part === 'kind') tfDrawForm(); }
  else if (d.gr) { const [gi, part] = d.gr.split('.'); const g = tf.form.groups[gi]; if (g) { if (part === 'on') g.off = !el.checked; else g[part] = el.value; } if (part === 'on' || part === 'type') tfDrawForm(); }
  else if ('tfseller' in d) tf.form.seller = el.value;
  else if ('tfsort' in d) { const [by, ...rest] = el.value.split('.'); const r = rest.join('.'); tf.form.sort = by === 'stat' ? { by, ref: r } : by === 'group' ? { by, i: Number(r) } : { by: 'price', dir: r }; }
  else if (d.bulk) tf.form.bulk[d.bulk] = el.value;
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
// A filter group opened or closed by hand stays so (kept in this window).
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
  if (mode) { tf.form.mode = mode.dataset.tfmode; tfSugClose(); tfKeep(); tfDrawForm(); return; }
  const b = e.target.closest('[data-tfact]');
  if (!b) return;
  const what = b.dataset.tfact, id = b.dataset.tfid;
  if (what === 'clearfg') { e.preventDefault(); delete tf.form.filters[b.dataset.fg]; tfKeep(); tfDrawForm(true); }
  else if (what === 'reset') { const mode = tf.form.mode; tf.form = { ...TF_BLANK(), mode }; tfKeep(); tfDrawForm(true); }
  else if (what === 'save') await tfAsk({ op: 'save', form: tf.form });
  else if (what === 'unpick') { tf.form.item = null; tfKeep(); tfDrawForm(); const el = $('tf-formbox').querySelector('[data-sug="item"]'); if (el) el.focus(); }
  else if (what === 'addgroup') { tf.form.groups.push({ type: 'and', min: '', max: '', off: false, stats: [] }); tfKeep(); tfDrawForm(); const el = $('tf-formbox').querySelector(`[data-sug="stat:${tf.form.groups.length - 1}"]`); if (el) el.focus(); }
  else if (what === 'ungroup') { tf.form.groups.splice(Number(b.dataset.g), 1); if (tf.form.sort && tf.form.sort.by !== 'price') tf.form.sort = { by: 'price', dir: 'asc' }; tfKeep(); tfDrawForm(); }
  else if (what === 'unstat') { const g = tf.form.groups[Number(b.dataset.g)]; if (g) g.stats.splice(Number(b.dataset.s), 1); tfKeep(); tfDrawForm(); }
  else if (what === 'unbulk') { tf.form.bulk[b.dataset.side].splice(Number(b.dataset.i), 1); tfKeep(); tfDrawForm(); }
  else if (what === 'unfold') { tf.open = tf.open === id ? '' : id; tfDrawResults(); }
  else if (what === 'load') {
    const s = ((tf.view && tf.view.saved) || []).find((x) => x.name === b.dataset.name);
    if (s) { tf.form = { ...TF_BLANK(), ...JSON.parse(JSON.stringify(s.form)) }; tfKeep(); tfDrawForm(true); }
  } else if (what === 'unsave') { if (await askYes(`Forget the saved search “${b.dataset.name}”?`, { yes: 'Forget' })) tfAsk({ op: 'unsave', name: b.dataset.name }); }
  else if (what === 'signout') { if (await askYes('Sign out of the trade site in this app? Searching and whispering keep working.', { yes: 'Sign out' })) tfAsk({ op: 'signout' }); }
  else if (what === 'more') tfAsk({ op: 'more' }, 'more');
  else if (['whisper', 'travel', 'want', 'open', 'signin'].includes(what)) tfAsk({ op: what, id });
});
// The sign-in window closed: the line under the form and the buttons follow.
if (api.onTradeFindNews) api.onTradeFindNews(() => { if (tf.asked) tfAsk({ op: 'get' }); });
