'use strict';
// Items page: what could not be recognised, and the list of named items.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- items page: what could not be recognised, and what you have named --------------
function renderItems() {
  const un = state.unknown || [];
  $('items-dot').hidden = !un.length;
  $('unknown-box').hidden = !un.length;
  $('hk-name').textContent = state.config.hotkeys.clipboard;
  $('unknown-title').textContent = un.length ? `Not recognised: ${un.length}` : 'Not recognised';
  $('btn-unknown-clear').hidden = !un.length;
  const list = $('unknown');
  // Rebuild only when the items or suggestions change, and never while a name is being typed.
  const key = un.map((u) => `${u.id}:${u.here}:${u.qty}:${u.guesses.map((g) => g.name).join('|')}`).join(',');
  const typing = list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.value;
  if (list.dataset.key !== key && !typing) {
    list.dataset.key = key;
    list.innerHTML = un.length ? un.map((u) => `<li>
        <img src="${esc(u.image)}" alt="Unrecognised item">
        <div class="pick">
          <p class="seen">${u.here ? '<b>In your inventory now</b>' : `Last seen ${esc(dayOf(u.at))}, ${clock(u.at)}`}, stack of ${u.qty}</p>
          ${u.guesses.length ? `<div class="chips">${u.guesses.map((g) => `<button type="button" data-act="learn" data-id="${u.id}" data-name="${esc(g.name)}" title="${g.score}% match">${esc(g.name)}</button>`).join('')}</div>` : ''}
          <form class="inline-form" data-learn-form="${u.id}" autocomplete="off">
            <input list="price-names" placeholder="${u.guesses.length ? 'Or type its name' : 'Type its name'}" aria-label="Item name">
            <button type="submit">Save</button>
            <button type="button" data-act="ignore" data-id="${u.id}" title="Never count or ask about this item again">Ignore</button>
            <button type="button" class="link" data-act="dismissUnknown" data-id="${u.id}" title="Take it off this list. It comes back if it is seen again">Dismiss</button>
          </form>
        </div></li>`).join('')
      : '<li class="empty">Nothing waiting. A stack the app cannot recognise lands here and stays until you name it.</li>';
  }

  renderKnown();
}

// The item database: every item the app can read, in one table. Each row says how the app
// knows the item (official picture, pictures from the game and who named them, or the tier
// numeral for maps), when it was last read, its price and whether it is counted. A row opens
// to manage the item: rename or remove a picture, stop counting it, give it your own price.
let known = null, knownRev = null, dbFilter = 'all', dbCat = '', dbLimit = 100, dbOpen = null, dbSort = { key: 'name', dir: 1 };
const dbPics = new Map(); // picture id -> { row, p }, for the dialog
function whoNamed(p) {
  // A picture kept on this PC and not in the shared database: say why, since sharing is the point.
  const here = !p.onlyHere ? '' : (p.auto ? ' on this PC' : (known && known.canUpload ? ', waiting to be sent' : ', not shared yet'));
  if (p.over) return `named ${p.by ? `by ${p.by}` : 'by someone'}; not used here, you named this picture ${p.over}`;
  if (p.auto) return `learned by the app${p.by ? ` (${p.by})` : ''}${here}`;
  return `named by ${p.by || (p.onlyHere ? 'you' : 'someone')}${here}`;
}
const READ_BY = { art: 'official picture', learned: 'picture from the game', shared: 'picture from the game', pinned: 'your name for that slot', map: 'tier numeral' };
function whenRead(seen) {
  if (!seen) return '<span class="dim">Not yet</span>';
  const today = new Date().toDateString() === new Date(seen.at).toDateString();
  return `${today ? 'Today' : esc(dayOf(seen.at))}, ${clock(seen.at)}<small>${esc(READ_BY[seen.source] || 'read')}${seen.score ? `, ${seen.score}%` : ''}</small>`;
}
function refreshKnown() {
  if (!api.itemsList) return;
  knownRev = state.itemsRev;
  api.itemsList().then((d) => { known = d; renderKnown(); });
}
function renderKnown() {
  if ($('tab-items').hidden) return;
  if (state.itemsRev !== knownRev) refreshKnown();
  if (!known) return;
  const hasDoubt = (r) => r.pictures.some((p) => p.doubt && !p.over);
  const tests = {
    all: () => true,
    read: (r) => !!r.seen,
    pics: (r) => r.pictures.length > 0,
    people: (r) => r.pictures.some((p) => !p.auto),
    check: hasDoubt,
    off: (r) => !r.counted,
  };
  const inCat = known.rows.filter((r) => !dbCat || r.category === dbCat);
  if (!tests[dbFilter] || (dbFilter !== 'all' && !inCat.some(tests[dbFilter]))) dbFilter = 'all';
  const labels = [['all', 'Every item'], ['read', 'Read by the app'], ['pics', 'With a picture from the game'], ['people', 'Named by people'], ['check', 'To check'], ['off', 'Not counted']];
  $('db-filters').innerHTML = labels.map(([id, label]) => [id, label, inCat.filter(tests[id]).length]).filter(([id, , n]) => id === 'all' || n)
    .map(([id, label, n]) => `<button type="button" role="tab" data-db-filter="${id}" aria-selected="${id === dbFilter}"${id === 'check' ? ' class="check"' : ''}>${label} <span>${n}</span></button>`).join('');
  const cats = $('db-cats');
  const catHtml = `<button type="button" data-db-cat="" aria-pressed="${!dbCat}"><span class="noicon"></span><span class="cat-name">All categories</span><span class="n">${known.rows.length}</span></button>`
    + known.categories.map((c) => `<button type="button" data-db-cat="${esc(c.id)}" aria-pressed="${c.id === dbCat}">${c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy">` : '<span class="noicon"></span>'}<span class="cat-name">${esc(c.label)}</span><span class="n">${c.count}</span></button>`).join('');
  if (cats.dataset.html !== catHtml) { cats.dataset.html = catHtml; cats.innerHTML = catHtml; }
  $('db-title').textContent = 'Items';
  // Whether what you name reaches everyone, said where you manage the items.
  const sh = state.status.shared || {}, share = $('db-share');
  const unsent = known.rows.reduce((n, r) => n + r.pictures.filter((p) => p.onlyHere && !p.auto).length, 0);
  let shareHtml, shareCls;
  if (!sh.canUpload) {
    shareCls = 'off';
    shareHtml = `<span><b>Sharing is off.</b> ${unsent ? `The ${unsent === 1 ? 'name' : `${unsent} names`} you gave ${unsent === 1 ? 'is' : 'are'}` : 'Names you give are'} kept on this PC only, because you are not logged in. Log in and everything is sent at once, for everyone.</span>
        <button type="button" class="primary" data-open-account>Log in to share</button>`;
  } else if (sh.error) {
    shareCls = 'bad';
    shareHtml = `<span><b>The item database did not take the last upload.</b> ${esc(sh.error)}${unsent ? ` ${unsent} ${unsent === 1 ? 'name is' : 'names are'} waiting on this PC.` : ''}</span>
        <span class="row"><button type="button" data-act="uploadShared">Try again</button></span>`;
  } else {
    shareCls = 'on';
    shareHtml = `<span>Sharing is on. What you name is sent to the item database as <b>${esc(sh.by || known.me)}</b> and every app has it at its next start, or when Refresh shared list is pressed. ${sh.count} ${sh.count === 1 ? 'picture' : 'pictures'} in the database.${unsent ? ` ${unsent} on this PC not sent yet.` : ''}</span>
        ${unsent ? '<button type="button" data-act="uploadShared">Send now</button>' : ''}`;
  }
  share.hidden = false;
  share.className = `db-share ${shareCls}`;
  if (share.dataset.html !== shareHtml) { share.dataset.html = shareHtml; share.innerHTML = shareHtml; }
  const reset = $('db-reset');
  reset.hidden = !known.named;
  reset.textContent = `Remove all ${known.named} names given by hand`;
  reset.dataset.confirm = `Remove all ${known.named} names given by hand on this PC?${known.canUpload ? ' They are also removed from the shared database.' : ''} What the app learned by itself stays. The app then reads those items by itself where it can, and asks you about the rest.`;

  const q = $('learned-filter').value.trim().toLowerCase();
  const list = inCat.filter(tests[dbFilter]).filter((r) => !q || (r.name || 'ignored').toLowerCase().includes(q) || r.pictures.some((p) => (p.by || '').toLowerCase().includes(q)));
  const by = {
    name: (x, y) => (x.name || '').localeCompare(y.name || ''),
    price: (x, y) => (x.chaos || 0) - (y.chaos || 0),
    read: (x, y) => ((x.seen || {}).at || 0) - ((y.seen || {}).at || 0),
  }[dbSort.key];
  list.sort((x, y) => (hasDoubt(y) ? 1 : 0) - (hasDoubt(x) ? 1 : 0) || dbSort.dir * by(x, y) || (x.name || '').localeCompare(y.name || ''));
  for (const b of document.querySelectorAll('[data-db-sort]')) b.dataset.dir = b.dataset.dbSort === dbSort.key ? (dbSort.dir > 0 ? 'up' : 'down') : '';
  $('db-hint').textContent = `${list.length} of ${known.rows.length} items. Click an item to manage it: its pictures, whether it is counted, and its price.`;

  dbPics.clear();
  const icon = (src, cls = 'official') => (src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<span class="${cls} none"></span>`);
  const how = (r) => {
    if (r.method === 'tier') return '<span class="tag">Tier numeral on the map</span>';
    if (r.pictures.length) {
      const shown = r.pictures.filter((p) => !p.over);
      const thumbs = r.pictures.slice(0, 3).map((p) => `<img class="thumb${p.sharp ? '' : ' blur'}${p.over ? ' over' : ''}" src="${esc(p.seen)}" alt="">`).join('');
      const who = shown.length === 1 ? whoNamed(shown[0]) : `${r.pictures.length} pictures`;
      return `<span class="thumbs">${thumbs}</span><span class="tag good">Picture from the game</span><small>${esc(who)}</small>`;
    }
    if (r.method === 'slot') return '<span class="tag">Named by you for one slot</span>';
    return r.official ? '<span class="tag">Official picture</span>' : '<span class="tag dimmed">Official picture not downloaded yet</span>';
  };
  const detail = (r) => {
    const official = r.method === 'tier'
      ? '<li><span class="official none"></span><div><b>Tier numeral</b><small>The Roman numeral on the map is compared with one reference picture per tier.</small></div></li>'
      : `<li>${icon(r.icon)}<div><b>Official picture</b><small>${r.official ? 'From poe.ninja. A slot must look at least 82% like it.' : (r.icon ? 'Not downloaded yet. It is fetched in the background.' : 'There is none: poe.ninja does not list this name.')}</small></div></li>`;
    const pics = r.pictures.map((p) => {
      dbPics.set(p.id, { row: r, p });
      const doubt = p.doubt && !p.over ? `<span class="doubt">Looks more like ${icon(p.doubt.icon, 'mini')}<b>${esc(p.doubt.name)}</b> <button type="button" data-act="renameItem" data-id="${esc(p.id)}" data-name="${esc(p.doubt.name)}">Rename to ${esc(p.doubt.name)}</button></span>` : '';
      const canRemove = known.canUpload || p.id.startsWith('mine:');
      return `<li class="${p.over ? 'over' : ''}"><img class="seen${p.sharp ? '' : ' blur'}" src="${esc(p.seen)}" alt="">
          <div><b>Picture from the game</b><small>${esc(whoNamed(p))}${p.sharp ? '' : '. Only a blur of it was kept'}</small>${doubt}</div>
          <span class="acts"><button type="button" data-fix="db:${esc(p.id)}">Rename</button>${canRemove ? `<button type="button" class="link" data-act="forgetItem" data-id="${esc(p.id)}" data-confirm="Remove this picture?${known.canUpload ? ' It is removed for everyone.' : ''}">Remove</button>` : ''}</span></li>`;
    }).join('');
    const none = r.method === 'picture' && !r.pictures.length ? '<p class="fine">No picture from the game yet. The app saves one by itself after a clear read, and from then on recognises this item almost exactly.</p>' : '';
    const price = r.name ? `<form class="inline-form" data-db-price="${esc(r.name)}" autocomplete="off">
          <label>Your own price <input type="number" min="0" step="0.01" value="${r.own !== null ? r.own : ''}" placeholder="${r.ninja !== null ? r.ninja : 'none'}" aria-label="Your own price in chaos"> c</label>
          <button type="submit">Save</button>${r.own !== null ? `<button type="button" class="link" data-db-price-clear="${esc(r.name)}">${r.ninja !== null ? 'Use the poe.ninja price' : 'Remove'}</button>` : ''}</form>
          <p class="fine">${r.ninja !== null ? `poe.ninja: ${fmtValue(r.ninja)}.` : 'poe.ninja has no price for this name.'}${r.own !== null ? ' Your own price is the one used.' : ''}</p>` : '';
    const count = r.name ? `<label class="check"><input type="checkbox" data-db-count="${esc(r.name)}"${r.counted ? ' checked' : ''}> Count this item as loot</label>` : '<p class="fine">Pictures you chose to ignore. Remove one and the app asks about it again.</p>';
    return `<tr class="detail dbdetail"><td colspan="5"><div class="dbd">
        <section><h3>How the app recognises it</h3><ul class="dbpics">${r.name ? official : ''}${pics}</ul>${none}</section>
        <section><h3>Counting and price</h3>${count}${price}</section>
      </div></td></tr>`;
  };
  const html = list.slice(0, dbLimit).map((r) => {
    const key = r.name || '(ignored)';
    const flags = `${r.counted ? '' : '<span class="tag off">Not counted</span>'}${hasDoubt(r) ? '<span class="tag warn">Check</span>' : ''}`;
    const cat = (known.categories.find((c) => c.id === r.category) || {}).label || r.category;
    return `<tr class="dbrow${dbOpen === key ? ' open' : ''}${r.counted ? '' : ' off'}" data-db-row="${esc(key)}">
        <td><div class="pname">${icon(r.icon, 'picon')}<div>${r.name ? esc(r.name) : 'Ignored pictures'}<small>${esc(cat)}</small></div></div></td>
        <td class="num val">${r.chaos === null ? '<span class="dim">none</span>' : fmtValue(r.chaos)}${r.own !== null ? '<small>your price</small>' : ''}</td>
        <td class="how">${how(r)}</td>
        <td class="when">${whenRead(r.seen)}</td>
        <td class="flags">${flags}</td></tr>${dbOpen === key ? detail(r) : ''}`;
  }).join('') || `<tr><td colspan="5" class="empty">${q ? 'No item matches that.' : 'Nothing here.'}</td></tr>`;
  const box = $('db-rows');
  const typing = box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number';
  if (box.dataset.html !== html && !typing) { box.dataset.html = html; box.innerHTML = html; }
  const more = $('db-more');
  more.hidden = list.length <= dbLimit;
  more.textContent = `Show more (${list.length - dbLimit} left)`;
}
const dbTop = () => { document.querySelector('#tab-items .table-wrap').scrollTop = 0; };
$('db-filters').addEventListener('click', (e) => { const b = e.target.closest('[data-db-filter]'); if (b) { dbFilter = b.dataset.dbFilter; dbLimit = 100; renderKnown(); dbTop(); } });
$('db-cats').addEventListener('click', (e) => { const b = e.target.closest('[data-db-cat]'); if (b) { dbCat = b.dataset.dbCat; dbLimit = 100; renderKnown(); dbTop(); } });
$('db-more').addEventListener('click', () => { dbLimit += 300; renderKnown(); });
document.querySelector('.db-table thead').addEventListener('click', (e) => {
  const b = e.target.closest('[data-db-sort]');
  if (!b) return;
  dbSort = { key: b.dataset.dbSort, dir: dbSort.key === b.dataset.dbSort ? -dbSort.dir : (b.dataset.dbSort === 'name' ? 1 : -1) };
  renderKnown();
});
$('db-rows').addEventListener('click', (e) => {
  if (e.target.closest('button, input, label, form, a')) {
    const clear = e.target.closest('[data-db-price-clear]');
    if (clear) act({ type: 'removeCustomPrice', name: clear.dataset.dbPriceClear });
    return;
  }
  const row = e.target.closest('[data-db-row]');
  if (!row) return;
  dbOpen = dbOpen === row.dataset.dbRow ? null : row.dataset.dbRow;
  renderKnown();
});
$('db-rows').addEventListener('change', (e) => { const c = e.target.closest('[data-db-count]'); if (c) act({ type: 'setCounted', name: c.dataset.dbCount, qty: c.checked ? 1 : 0 }); });
$('db-rows').addEventListener('submit', (e) => {
  const f = e.target.closest('[data-db-price]');
  if (!f) return;
  e.preventDefault();
  const input = f.querySelector('input'), v = input.value.trim();
  input.blur();
  if (v === '') act({ type: 'removeCustomPrice', name: f.dataset.dbPrice }); else act({ type: 'setCustomPrice', name: f.dataset.dbPrice, chaos: v });
});
