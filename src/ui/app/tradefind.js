'use strict';
// Trade page, Search (#trade-find, tracker #85): a search of the trade site started from
// nothing. Left: what to search for (an item picked by name, a kind, stats found by words,
// numbers, price, who sells). Right: what the site has, cheapest first, with one button per
// listing (Whisper, or Travel for an instant buyout when signed in to the trade site).
// The search itself, its answer and the sign-in live in the main process (findAction);
// this file only draws and asks. Part of the main window script: one scope with the others.

const tf = {
  form: { item: null, text: '', category: '', rarity: '', seller: 'available', priceMax: '', currency: '', links: '', sockets: '', ilvlMin: '', quality: '', gemLevel: '', corrupted: '', stats: [] },
  view: null,      // what the main process last answered (findView)
  lists: null,     // the choices of the selects, asked for once
  rev: 0, drawn: '',  // the results are drawn again only when the answer, what is unfolded or the half minute changed
  asked: false, busy: '', error: '', open: '', // open: the listing unfolded
  sug: { box: '', items: [], at: 0, note: '' }, // suggestions under the item or the stat field
};
// What is being filled in is kept in this window, so it is still there after a restart.
try { const k = JSON.parse(localStorage.getItem('tradeFind') || 'null'); if (k && typeof k === 'object') Object.assign(tf.form, k, { stats: Array.isArray(k.stats) ? k.stats : [] }); } catch (_) { /* storage off */ }
const tfKeep = () => { try { localStorage.setItem('tradeFind', JSON.stringify(tf.form)); } catch (_) { /* not kept */ } };
// A price as the site gives it, without a long tail of digits.
const tfAmount = (n) => String(Math.round(Number(n) * 100) / 100);
const tfTimed = (what, fn) => (window.Hood ? window.Hood.run(`drawing the Trade page, search ${what}`, fn) : fn());

// One ask of the main process; the answer is the new view. What went wrong shows over the results.
async function tfAsk(a, busy = '') {
  if (tf.busy) return null;
  tf.busy = busy; tf.error = '';
  if (busy) tfDrawResults();
  try {
    const v = await api.tradeFind(a);
    if (v && 'league' in v) { tf.view = v; tf.rev += 1; }
    return v;
  } catch (e) {
    tf.error = String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
    return null;
  } finally { tf.busy = ''; renderFind(); }
}

// ---- the form ------------------------------------------------------------------------------
const tfOptions = (list, picked) => list.map(([id, label]) => `<option value="${esc(id)}"${id === picked ? ' selected' : ''}>${esc(label)}</option>`).join('');
function tfDrawForm() {
  const f = tf.form, L = tf.lists;
  if (L) { setHtml($('tf-cat'), tfOptions(L.categories, f.category)); setHtml($('tf-rar'), tfOptions(L.rarities, f.rarity)); setHtml($('tf-sel'), tfOptions(L.sellers, f.seller)); }
  // Fields being typed in are left alone; the rest follow the form (a saved search loaded, Start over).
  for (const el of $('tf-form').querySelectorAll('[data-tf]')) if (el !== document.activeElement && el.value !== String(f[el.dataset.tf] ?? '')) el.value = String(f[el.dataset.tf] ?? '');
  $('tf-picked').hidden = !f.item;
  setHtml($('tf-picked'), f.item ? `<b>${esc(f.item.label)}</b><button type="button" class="tf-x" data-tfact="unpick" aria-label="Take the item out" title="Take the item out">×</button>` : '');
  const it = $('tf-item');
  it.hidden = !!f.item;
  if (!f.item && it !== document.activeElement && it.value !== f.text) it.value = f.text;
  const kinds = (L && L.kinds) || {};
  setHtml($('tf-stats'), f.stats.map((s, i) => `<div class="tf-stat" data-i="${i}"><span class="tf-ref" title="${esc(s.ref)}">${esc(s.ref)}</span>
      <select data-tfstat="kind" aria-label="Which kind of modifier">${tfOptions([['any', 'Any kind']].concat((s.kinds || []).map((k) => [k, kinds[k] || k])), s.kind || 'any')}</select>
      <input data-tfstat="min" inputmode="decimal" placeholder="min" aria-label="At least" value="${esc(s.min ?? '')}"><input data-tfstat="max" inputmode="decimal" placeholder="max" aria-label="At most" value="${esc(s.max ?? '')}">
      <button type="button" class="tf-x" data-tfact="unstat" aria-label="Take this stat out" title="Take this stat out">×</button></div>`).join(''));
  $('tf-search').disabled = !!tf.busy;
  $('tf-search').textContent = tf.busy === 'search' ? 'Searching…' : 'Search';
  const v = tf.view, saved = (v && v.saved) || [];
  setHtml($('tf-saved'), saved.length ? `<span class="tx-label">Saved searches</span><div class="tf-chips">${saved.map((s) => `<span class="tf-chip"><button type="button" data-tfact="load" data-name="${esc(s.name)}" title="Fill this search in">${esc(s.name)}</button><button type="button" class="tf-x" data-tfact="unsave" data-name="${esc(s.name)}" aria-label="Forget this search" title="Forget this search">×</button></span>`).join('')}</div>` : '');
  const site = v && v.site;
  setHtml($('tf-site'), !site ? '' : site.in
    ? `<p><b class="pos">Signed in to the trade site${site.name ? ` as ${esc(site.name)}` : ''}.</b> Searches count against your own account's limits, and an instant buyout has a Travel button.</p><button type="button" data-tfact="signout">Sign out</button>`
    : `<p><b>Not signed in to the trade site.</b> Searching and whispering work without it. Signed in, an instant buyout gets a Travel button that takes you to the seller's hideout. You sign in on pathofexile.com's own page; the app never sees your password.</p><button type="button" data-tfact="signin">${site.window ? 'Show the sign-in window' : 'Sign in'}</button>`);
}

// Suggestions under a field: asked for a moment after the last key, drawn under that field.
let tfSugTimer = 0;
function tfSuggest(box, text) {
  clearTimeout(tfSugTimer);
  if (text.trim().length < 2) { tf.sug = { box: '', items: [], at: 0, note: '' }; tfDrawSug(); return; }
  tfSugTimer = setTimeout(async () => {
    const at = Date.now();
    let r = null;
    try { r = await api.tradeFind({ op: box === 'item' ? 'items' : 'stats', text }); } catch (_) { r = null; }
    if (tf.sug.at > at) return; // a later ask already answered
    const items = (r && (r.items || r.stats)) || [];
    tf.sug = { box, items, at, note: (r && r.problem) || (items.length ? '' : box === 'item' ? 'No item with that name. Press Search to look for these words anyway.' : 'No stat with those words.') };
    tfDrawSug();
  }, 180);
}
function tfDrawSug() {
  for (const [box, id] of [['item', 'tf-sug'], ['stat', 'tf-ssug']]) {
    const el = $(id), on = tf.sug.box === box;
    el.hidden = !on;
    setHtml(el, !on ? '' : tf.sug.items.map((x, i) => (box === 'item'
      ? `<button type="button" role="option" data-tfsug="${i}"><b>${esc(x.label)}</b><small>${x.unique ? 'Unique · ' : ''}${esc(x.group)}</small></button>`
      : `<button type="button" role="option" data-tfsug="${i}"><b>${esc(x.ref)}</b></button>`)).join('') + (tf.sug.note ? `<p class="quiet">${esc(tf.sug.note)}</p>` : ''));
  }
}
function tfPickSug(i) {
  const x = tf.sug.items[i], box = tf.sug.box;
  if (!x) return;
  if (box === 'item') { tf.form.item = { label: x.label, name: x.name, type: x.type, disc: x.disc }; tf.form.text = ''; $('tf-item').value = ''; }
  else if (!tf.form.stats.some((s) => s.ref === x.ref) && tf.form.stats.length < 20) { tf.form.stats.push({ ref: x.ref, kinds: x.kinds, kind: 'any', min: '', max: '' }); $('tf-stat').value = ''; }
  tf.sug = { box: '', items: [], at: Date.now(), note: '' };
  tfKeep(); tfDrawSug(); tfDrawForm();
  if (box === 'stat') { const rows = $('tf-stats').querySelectorAll('[data-tfstat="min"]'); if (rows.length) rows[rows.length - 1].focus(); }
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
function tfRowHtml(l, v, d, now) {
  const instant = l.status === 'instant';
  const mark = l.bait ? ['bad', 'likely bait'] : l.asked ? ['wait', `${instant ? 'travelled' : 'whispered'} ${span(now - l.asked)} ago`] : instant ? ['ok', 'instant buyout'] : l.status === 'afk' ? ['', 'AFK'] : l.status === 'offline' ? ['', 'offline'] : ['', ''];
  // One button per listing: the trip for an instant buyout (signed in), else the whisper, else the site.
  const button = l.travel ? `<button type="button" class="primary" data-tfact="travel" data-tfid="${esc(l.id)}" title="The trade site takes you to the seller's hideout, where you buy it from Faustus">Travel</button>`
    : instant ? '<button type="button" data-tfact="open" title="An instant buyout is travelled to from the trade site. Sign in under the form to do it from here.">Trade site</button>'
      : l.whisper && l.status !== 'offline' ? `<button type="button" data-tfact="whisper" data-tfid="${esc(l.id)}"${v.canType ? '' : ' title="The app cannot type in the game on this PC right now"'}>${l.asked ? 'Ask again' : 'Whisper'}</button>` : '<span class="tq-wait">no whisper</span>';
  const sub = [l.chaos != null && l.price && !/^(chaos|div)/i.test(l.price.currency) ? TradeCard.chaosText(l.chaos, d) : '', l.seller, l.listedAt ? `listed ${span(now - l.listedAt)} ago` : '', l.itemLevel ? `item level ${l.itemLevel}` : '', l.corrupted ? 'corrupted' : ''].filter(Boolean).join(' · ');
  const open = tf.open === l.id;
  return `<div class="tw-row tf-row${l.bait ? ' dim' : ''}"><b class="tw-price">${l.price ? `${esc(tfAmount(l.price.amount))} ${esc(l.price.currency)}` : 'no price'}</b>
    <button type="button" class="tf-open" data-tfact="unfold" data-tfid="${esc(l.id)}" aria-expanded="${open}"><span class="it sm">${l.icon ? `<img src="${esc(l.icon)}" alt="" loading="lazy">` : ''}</span><span class="tq-main"><b>${esc(l.name || l.base || 'Item')}</b><span>${esc(sub)}</span></span></button>
    ${mark[1] ? `<i class="${mark[0]}">${esc(mark[1])}</i>` : ''}${button}</div>${open ? tfDetailHtml(l) : ''}`;
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
    setHtml(box, `${err}<p class="empty">Fill in what you are looking for and press Search. Every search is two requests to the trade site, which allows only a few per minute, so it runs when you press the button and not while you type.</p>`);
    return;
  }
  const now = Date.now(), d = state && state.trade ? state.trade.divine : 0;
  const rows = l.listings.map((x) => tfRowHtml(x, v, d, now)).join('');
  const unknown = l.unknown && l.unknown.length ? `<p class="td-note neg">Left out, the trade site no longer has ${l.unknown.length === 1 ? 'this stat' : 'these stats'}: ${l.unknown.map(esc).join('; ')}</p>` : '';
  setHtml(box, `<header><div><span class="tx-label">${esc(Number(l.total).toLocaleString())} listed in ${esc(v.league)} · searched ${esc(span(now - l.at))} ago</span><h3>${esc(l.name)}</h3></div>
      <span class="row"><button type="button" data-tfact="want"${l.listings.length ? '' : ' disabled'} title="Keep this search and its sellers on the Buying list">Add to Buying</button>${l.url ? '<button type="button" data-tfact="open">Trade site</button>' : ''}</span></header>
    ${err}${unknown}
    <div class="tw-rows tf-rows">${rows || '<p class="empty">Nothing like it is listed. Take a stat out or widen a number.</p>'}
      ${l.left ? `<div class="tf-more"><button type="button" data-tfact="more"${tf.busy ? ' disabled' : ''}>${tf.busy === 'more' ? 'Reading…' : `Show ${Math.min(10, l.left)} more`}</button><span class="quiet">${l.listings.length} of ${l.listings.length + l.left} read${l.total > l.listings.length + l.left ? '; the trade site hands out the cheapest 100 of a search' : ''}</span></div>` : ''}</div>
    <p class="quiet tw-foot">One whisper or one trip per click. Click a listing to see the whole item.</p>`);
}

function renderFind() {
  if (!tf.asked) {
    tf.asked = true;
    api.tradeFind({ op: 'lists' }).then((L) => { tf.lists = L; renderFind(); }).catch(() => {});
    tfAsk({ op: 'get' });
  }
  tfTimed('form', tfDrawForm);
  tfTimed('results', tfDrawResults);
}

// ---- what the user does --------------------------------------------------------------------
$('tf-form').addEventListener('submit', (e) => { e.preventDefault(); tf.sug = { box: '', items: [], at: Date.now(), note: '' }; tfDrawSug(); tf.open = ''; tfAsk({ op: 'search', form: tf.form }, 'search'); });
$('tf-form').addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'tf-item') { tf.form.text = el.value; tfSuggest('item', el.value); }
  else if (el.id === 'tf-stat') tfSuggest('stat', el.value);
  else if (el.dataset.tf) tf.form[el.dataset.tf] = el.value;
  else if (el.dataset.tfstat) { const s = tf.form.stats[Number(el.closest('[data-i]').dataset.i)]; if (s) s[el.dataset.tfstat] = el.value; }
  tfKeep();
});
// Enter in a field with suggestions takes the first one; Escape closes them.
$('tf-form').addEventListener('keydown', (e) => {
  if (e.target.id !== 'tf-item' && e.target.id !== 'tf-stat') return;
  const box = e.target.id === 'tf-item' ? 'item' : 'stat';
  if (e.key === 'Escape' && tf.sug.box) { tf.sug = { box: '', items: [], at: Date.now(), note: '' }; tfDrawSug(); e.preventDefault(); }
  else if (e.key === 'Enter' && tf.sug.box === box && tf.sug.items.length) { e.preventDefault(); tfPickSug(0); }
  else if (e.key === 'Enter' && box === 'stat') e.preventDefault(); // a half-typed stat does not start a search
});
$('trade-find').addEventListener('click', async (e) => {
  const sug = e.target.closest('[data-tfsug]');
  if (sug) { tfPickSug(Number(sug.dataset.tfsug)); return; }
  if (e.target.closest('#tf-reset')) {
    tf.form = { item: null, text: '', category: '', rarity: '', seller: 'available', priceMax: '', currency: '', links: '', sockets: '', ilvlMin: '', quality: '', gemLevel: '', corrupted: '', stats: [] };
    $('tf-item').value = ''; $('tf-stat').value = ''; tfKeep(); renderFind(); return;
  }
  if (e.target.closest('#tf-save')) { await tfAsk({ op: 'save', form: tf.form }); return; }
  const b = e.target.closest('[data-tfact]');
  if (!b) return;
  const what = b.dataset.tfact, id = b.dataset.tfid;
  if (what === 'unpick') { tf.form.item = null; tfKeep(); renderFind(); $('tf-item').focus(); }
  else if (what === 'unstat') { tf.form.stats.splice(Number(b.closest('[data-i]').dataset.i), 1); tfKeep(); renderFind(); }
  else if (what === 'unfold') { tf.open = tf.open === id ? '' : id; tfDrawResults(); }
  else if (what === 'load') {
    const s = ((tf.view && tf.view.saved) || []).find((x) => x.name === b.dataset.name);
    if (s) { tf.form = JSON.parse(JSON.stringify(s.form)); $('tf-item').value = tf.form.text || ''; tfKeep(); renderFind(); }
  } else if (what === 'unsave') { if (await askYes(`Forget the saved search “${b.dataset.name}”?`, { yes: 'Forget' })) tfAsk({ op: 'unsave', name: b.dataset.name }); }
  else if (what === 'signout') { if (await askYes('Sign out of the trade site in this app? Searching and whispering keep working.', { yes: 'Sign out' })) tfAsk({ op: 'signout' }); }
  else if (what === 'more') tfAsk({ op: 'more' }, 'more');
  else if (['whisper', 'travel', 'want', 'open', 'signin'].includes(what)) tfAsk({ op: what, id });
});
// The sign-in window closed: the line under the form and the buttons follow.
if (api.onTradeFindNews) api.onTradeFindNews(() => { if (tf.asked) tfAsk({ op: 'get' }); });
