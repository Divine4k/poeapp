'use strict';
// The price check window on top of the game: the item's picture with its sockets and the
// answer beside it, the item's stats with tick boxes and a number to nudge with - and +, and
// what the trade site lists like it, each listing with its own picture. The window does not take
// the keyboard (the game keeps it), except while a number is being typed in: a click on the
// number asks for the keys, and Enter, Escape or a click elsewhere gives them back.
(() => {
  const api = window.api;
  const panel = document.getElementById('panel');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND_WORDS = { pseudo: 'total', implicit: 'implicit', corruption: 'corruption', crafted: 'crafted', fractured: 'fractured', enchant: 'enchant', scourge: 'scourge', crucible: 'crucible' };
  const COIN_WORDS = { chaos: 'chaos', divine: 'divine', exalted: 'exalted', mirror: 'mirror' };
  const STATUS_WORDS = { instant: 'Instant buyout', online: 'Online', afk: 'Away', offline: 'Offline' };

  let data = null;
  let rows = [];     // what is ticked and set right now
  let formFor = '';  // which item and which round of choices the rows belong to
  let mode = 'stats'; // which of the two searches is set up: by the item's stats, or for its base
  let modeFor = 0;    // the item the mode belongs to

  function fmtValue(c) {
    const divine = data ? data.divine : 0;
    if (!isFinite(c)) return '0c';
    const a = Math.abs(c);
    if (divine > 0 && a >= divine) return `${(c / divine).toFixed(a >= divine * 10 ? 1 : 2)} div`;
    return `${a >= 100 ? Math.round(c) : a < 1 ? num(c) : Math.round(c * 10) / 10}c`;
  }
  function ago(ts, withAgo) {
    if (!ts) return '';
    const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (withAgo) return secs < 60 ? 'just now' : `${ago(ts)} ago`;
    const m = Math.floor(secs / 60);
    if (m < 60) return `${m} min`;
    if (m < 48 * 60) return `${Math.floor(m / 60)} h`;
    return `${Math.floor(m / 1440)} d`;
  }
  // One per click; a tenth for values with a decimal point (1.5% crit).
  const stepFor = (value) => (Number.isInteger(Number(value)) ? 1 : 0.1);

  function rowsFrom(f) {
    const out = [];
    // Short facts about the item: shown as a row of buttons, lit when they are part of the search.
    // pk: the tick's name in the two ready-made searches (see presets).
    if (f.category) out.push({ tc: 'category', pk: 'category', chip: true, label: f.category.label, title: 'Any base type of this kind', enabled: f.category.enabled });
    if (f.type) out.push({ tc: 'type', pk: 'type', chip: true, label: f.type.value, title: 'Only this base type', enabled: f.type.enabled });
    for (const x of f.flags) out.push({ tc: 'flag', pk: `flag:${x.key}`, chip: true, key: x.key, label: x.label, enabled: x.enabled });
    out.push({ tc: 'offline', chip: true, label: 'Offline sellers too', enabled: f.offline });
    for (const x of f.props) out.push({ tc: 'prop', pk: `prop:${x.key}`, key: x.key, label: `${x.label}: ${x.value}`, enabled: x.enabled, bound: 'min', num: x.min === null ? x.value : x.min, mine: x.value, step: stepFor(x.value) });
    for (const x of f.stats) {
      // The number shown is the one the search asks for: a lowest value for most stats, a
      // highest where less is better. A "reduced" stat is kept below zero by the trade site;
      // it is shown the way the item words it.
      const bound = x.value === null ? null : (x.min === null && x.max !== null ? 'max' : 'min');
      out.push({ tc: 'stat', pk: `stat:${x.key}`, key: x.key, label: x.text, mk: x.kind || 'explicit', kind: KIND_WORDS[x.kind] || '', tiers: x.tiers || [], enabled: x.enabled, bound, num: bound ? x[bound] : null, mine: x.value === null ? null : (x.negated ? -Math.abs(x.value) : x.value), step: stepFor(x.value), flip: !!x.negated });
    }
    return out;
  }

  const chipHtml = (r, i) => `<button type="button" class="pc-chip${r.enabled ? ' on' : ''}" data-row="${i}" aria-pressed="${r.enabled}"${r.title ? ` title="${esc(r.title)}"` : ''}>${esc(r.label)}</button>`;
  // One stat: a tick, the line in the colour the game gives its kind, its tier, and the number
  // searched for between - and +.
  // The number as the item words it ("reduced" stats are kept below zero by the trade site).
  const shown = (r, n) => (r.flip ? -n : n);
  function rowHtml(r, i) {
    let num = '';
    if (r.bound && r.num !== null) {
      const word = (r.bound === 'min') !== r.flip ? 'at least' : 'at most';
      const match = r.mine !== null && r.mine !== undefined ? `<button type="button" class="pc-match${r.num === r.mine ? ' same' : ''}" data-match title="Set to this item's own ${esc(shown(r, r.mine))}">Match</button>` : '';
      num = `${match}<div class="pc-num" title="${word} (click the number to type one)"><button type="button" data-step="-1" aria-label="Lower">−</button><b data-type tabindex="-1">${esc(shown(r, r.num))}</b><button type="button" data-step="1" aria-label="Higher">+</button></div>`;
    }
    const tiers = (r.tiers || []).map((t) => `<small class="pc-tier${t === 1 ? ' best' : ''}" title="Tier ${t}: tier 1 is the best this modifier can be">T${t}</small>`).join('');
    const kind = r.kind && r.mk !== 'pseudo' ? `<small class="k-${r.mk}">${r.kind}</small>` : '';
    return `<li class="${r.enabled ? 'on' : 'off'}" data-row="${i}">
      <label class="pc-tick"><input type="checkbox" ${r.enabled ? 'checked' : ''}><span class="m-${r.tc === 'prop' ? 'prop' : esc(r.mk)}" title="${esc(r.label)}">${esc(r.label)}</span>${kind}${tiers}</label>${num}</li>`;
  }

  // An item's picture as the game shows it: no frame, the sockets and their links drawn over it.
  // sockets: "R-R-G B" as the game writes them. w: how many cells wide the item is.
  const SOCKET_ORDER = { 1: [[0, 0], [0, 1], [0, 2], [0, 3]], 2: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 2], [1, 2]] };
  function socketsHtml(text, w) {
    if (!text) return '';
    const cols = w >= 2 ? 2 : 1;
    const list = [];
    for (const g of text.split(' ')) g.split('-').forEach((c, i) => list.push({ c: c.toLowerCase(), linked: i > 0 }));
    const order = SOCKET_ORDER[cols].slice(0, list.length);
    const rows = Math.max(...order.map((p) => p[1])) + 1;
    const at = new Map(order.map((p, i) => [`${p[0]},${p[1]}`, i]));
    let html = '';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = at.get(`${x},${y}`);
      if (i === undefined) { html += '<i class="none"></i>'; continue; }
      let cls = `s-${list[i].c}`;
      const next = list[i + 1], to = order[i + 1];
      if (next && next.linked) { if (to[1] === y && to[0] === x + 1) cls += ' lr'; else if (to[1] === y + 1) cls += ' ld'; else if (to[1] === y && to[0] === x - 1) cls += ' ll'; }
      html += `<i class="${cls}"></i>`;
    }
    return `<span class="sk-grid c${cols}">${html}</span>`;
  }
  const art = (icon, sockets, w, h, size) => `<span class="pc-art ${size} w${Math.min(2, w || 1)} h${Math.min(4, h || 1)}">${icon ? `<img src="${esc(icon)}" alt="">` : ''}${socketsHtml(sockets, w)}</span>`;

  // A price with the picture of its currency (or its name when the picture is not known).
  function coin(id) {
    const url = data && data.coins && data.coins[id];
    return url ? `<img class="pc-coin" src="${esc(url)}" alt="${esc(COIN_WORDS[id] || id)}" title="${esc(COIN_WORDS[id] || id)}">` : `<span class="pc-cw">${esc(COIN_WORDS[id] || id)}</span>`;
  }
  // A value in chaos, shown in divines once it is worth one or more.
  function priceHtml(c, c2) {
    const divine = data ? data.divine : 0;
    const inDiv = divine > 0 && c >= divine;
    const f = (v) => { const x = inDiv ? v / divine : v; return x >= 100 ? Math.round(x).toLocaleString() : x < 1 ? num(x) : String(Math.round(x * (inDiv ? 100 : 10)) / (inDiv ? 100 : 10)); };
    const a = f(c), b = c2 != null ? f(c2) : a;
    return `<b>${a === b ? a : `${a}–${b}`}</b>${coin(inDiv ? 'divine' : 'chaos')}`;
  }

  // The answer, beside the picture: the cheapest and the typical price big, the rest in a line.
  function headlineHtml(d) {
    const bulk = d.kind === 'bulk';
    if (d.state === 'searching') return `<p class="pc-wait">Searching the ${bulk ? 'bulk exchange' : 'trade site'}…</p>${extrasHtml(d)}`;
    if (d.state === 'error') return `<p class="pc-bad">${esc(d.error)}</p>${extrasHtml(d)}`;
    const ninja = d.ninja !== null && d.ninja !== undefined ? `poe.ninja <b>${fmtValue(d.ninja)}</b>` : '';
    const s = d.summary || {};
    // what the whole stack is worth, at the cheapest offer (or poe.ninja's price before a search)
    const each = s.low !== null && s.low !== undefined ? s.low : d.ninja;
    const stack = d.qty > 1 && each ? `your ${d.qty.toLocaleString()} <b>${fmtValue(each * d.qty)}</b>` : '';
    if (bulk && !d.want) return `<div class="pc-price">${d.title === 'Chaos Orb' && d.divine ? `<b>${num(d.divine)}</b>${coin('chaos')}<small>for one divine</small>` : priceHtml(d.ninja)}</div><p class="pc-sub">${[ninja, stack].filter(Boolean).join('<i>·</i>')}</p>`;
    if (d.state !== 'done') return `<p class="pc-say">${bulk ? 'Press Search to see what the bulk exchange offers.' : 'Tick what matters, then press Search.'}</p>${ninja || stack ? `<p class="pc-sub">${[ninja, stack].filter(Boolean).join('<i>·</i>')}</p>` : ''}${extrasHtml(d)}`;
    if (!d.total) return `<p class="pc-say">${bulk ? 'Nobody offers it on the bulk exchange right now.' : 'Nothing like it is listed. Switch a stat off or lower a number.'}</p>${ninja ? `<p class="pc-sub">${ninja}</p>` : ''}${extrasHtml(d)}`;
    const sub = [`<b>${d.total.toLocaleString()}</b> ${bulk ? 'offers' : 'listed'}`, ninja, stack, d.searchedAt ? `searched ${ago(d.searchedAt, true)}` : ''].filter(Boolean).join('<i>·</i>');
    if (s.low === null) return `<p class="pc-sub">${sub}</p>${extrasHtml(d)}`;
    return `<div class="pc-price">${priceHtml(s.low, s.median)}<small>${s.low === s.median ? 'cheapest' : 'cheapest – typical'}${bulk ? ' each' : ''}</small></div><p class="pc-sub">${sub}</p>${extrasHtml(d)}`;
  }
  // The verdict at a glance, beside the price.
  const VERDICT_TIPS = { top: 'Worth a divine or more', sell: 'Worth listing on the trade site', vendor: 'A vendor gives more than it sells for', low: 'Sells for less than a few chaos' };
  const verdictHtml = (d) => (d.verdict ? `<span class="pc-verdict v-${esc(d.verdict.kind)}" title="${esc(VERDICT_TIPS[d.verdict.kind] || '')}">${esc(d.verdict.text)}</span>` : '');
  // Lines under the price: the vendor recipe it fits, and what a unique gives when disenchanted.
  // One line kept from the start (empty until there is something), so nothing moves when the answer comes.
  const extrasHtml = (d) => `<div class="pc-notes">${verdictHtml(d)}${vendorHtml(d)}${dustHtml(d)}</div>`;
  function vendorHtml(d) {
    const v = d.vendor;
    if (!v) return '';
    const pic = v.icon ? `<img src="${esc(v.icon)}" alt="">` : esc(v.name);
    return `<p class="pc-dust pc-vendor" title="Sold to any vendor, an item with ${esc(v.why)} gives ${v.count} ${esc(v.name)}${v.count > 1 ? 's' : ''}">Vendor <i>→</i> <b>${v.count}</b> × ${pic}${v.chaos ? ` <span>≈ ${fmtValue(v.chaos)}</span>` : ''}</p>`;
  }
  // What a unique gives at the Disenchanting bench in Kingsmarch.
  const dustHtml = (d) => (d.dust ? `<p class="pc-dust" title="Thaumaturgic Dust from the Disenchanting bench in Kingsmarch (item level, quality, influences and corruptions counted)">Disenchanting <i>→</i> <b>${d.dust.toLocaleString()}</b> × <img src="dust.png" alt="Thaumaturgic Dust"></p>` : '');

  // The listings, cheapest first: picture, price, seller, and the one number compared. The space
  // for them is there from the start (empty rows while searching), so the window keeps its size
  // when the answer comes.
  const LIST_ROWS = 10;
  function listHtml(d) {
    const cmp = d.state === 'done' ? d.compare : null;
    const head = cmp ? `<span title="${esc(cmp.label)}">${esc(shortLabel(cmp.label))}: yours <b>${esc(cmp.mine)}</b></span>` : '';
    const wrap = (inner) => `<div class="pc-listings"><div class="pc-lh"><span>Cheapest first</span>${head}</div>${inner}</div>`;
    if (d.state === 'searching') return wrap(`<ul class="pc-list wait">${'<li><i class="sk-art"></i><i class="sk-p"></i><i class="sk-w"></i></li>'.repeat(LIST_ROWS)}</ul>`);
    if (d.state !== 'done') return wrap(`<p class="pc-empty">${d.state === 'error' ? 'The search did not go through.' : 'Press Search to see what is listed.'}</p>`);
    if (!d.listings.length) return wrap('<p class="pc-empty">Nothing listed.</p>');
    const first = d.listings.find((l) => !l.bait);
    const rowsHtml = d.listings.map((l, i) => {
      const amount = l.price ? num(l.price.amount) : '';
      const price = l.price ? `<b>${amount}</b>${coin(l.price.currency)}` : '<span class="pc-cw">no price</span>';
      let vs = '';
      if (cmp && l.cmp !== null && l.cmp !== undefined) {
        const better = cmp.lower ? l.cmp < cmp.mine : l.cmp > cmp.mine, worse = cmp.lower ? l.cmp > cmp.mine : l.cmp < cmp.mine;
        vs = `<span class="pc-vs ${better ? 'up' : worse ? 'down' : ''}" title="${esc(cmp.label)}: ${l.cmp} (yours ${cmp.mine})">${l.cmp}</span>`;
      } else if (cmp) vs = '<span class="pc-vs">—</span>';
      return `<li class="${l.bait ? 'bait' : l === first ? 'first' : ''}${l.detail ? ' can-open' : ''}" data-li="${i}"${l.detail ? ' title="Click to see the whole item"' : ''}>${art(l.icon, l.sockets, l.w, l.h, 'sm')}<span class="pc-lp">${price}</span>
        <span class="pc-who"><b>${esc(l.seller)}</b><small>${l.bait ? '<em>price looks like bait</em> · ' : ''}<i class="st ${esc(l.status)}"></i>${STATUS_WORDS[l.status] || ''}${l.stock ? ` · ${l.stock.toLocaleString()} in stock` : ''}${l.listedAt ? ` · ${ago(l.listedAt)}` : ''}</small></span>${vs}</li>`;
    }).join('');
    return wrap(`<ul class="pc-list${cmp ? ' cmp' : ''}">${rowsHtml}</ul>`);
  }
  // A listing unfolded: the item as the game shows it when hovered, under its row.
  function detailHtml(l) {
    const x = l.detail;
    const props = x.props.map(([n, v]) => `<p class="pd-prop">${esc(n)}: <b>${esc(v)}</b></p>`).join('');
    let last = '';
    const mods = x.mods.map((m) => {
      // a line between the implicits and the rest, as in game
      const sep = last && (last === 'implicit' || last === 'enchant') !== (m.kind === 'implicit' || m.kind === 'enchant') ? '<hr>' : '';
      last = m.kind;
      return `${sep}<p class="pd-mod m-${esc(m.kind)}"${m.raw ? ` title="${esc(m.raw)}"` : ''}>${esc(m.text)}${m.kind === 'crafted' || m.kind === 'fractured' || m.kind === 'enchant' ? `<small>${m.kind}</small>` : ''}</p>`;
    }).join('');
    const flags = [x.corrupted ? '<p class="pd-flag corrupted">Corrupted</p>' : '', x.mirrored ? '<p class="pd-flag">Mirrored</p>' : '', x.split ? '<p class="pd-flag">Split</p>' : ''].join('');
    return `<li class="pc-detail">${art(l.icon, l.sockets, l.w, l.h, 'big')}<div class="pd-text r-${esc(x.rarity)}">
        ${x.name ? `<p class="pd-name">${esc(x.name)}</p>` : ''}<p class="pd-base">${esc(x.base)}${x.ilvl ? ` <small>item level ${x.ilvl}</small>` : ''}</p>
        ${props ? `<div class="pd-props">${props}</div>` : ''}${mods ? `<div class="pd-mods">${mods}</div>` : ''}${flags}</div></li>`;
  }
  const shortLabel = (t) => { const s = String(t).replace(/^[+#%\s]+/, '').replace(/^total /i, ''); return s.length > 26 ? `${s.slice(0, 24)}…` : s; };

  // The checked item's size in cells: from a listing of the same base when there is one, else
  // from its kind, else a guess from how many sockets it has (more than four: two wide).
  function headSize(d, f) {
    if (d.iconW) return [d.iconW, d.iconH || 3];
    if (f.size) return f.size;
    const n = f.sockets ? f.sockets.replace(/[- ]/g, '').length : 0;
    return n > 4 ? [2, 3] : [1, n > 3 ? 4 : 3];
  }

  // A number of chaos with as many digits as it needs: 1,240 · 85 · 3.5 · 0.04.
  function num(x) {
    const a = Math.abs(x);
    if (a >= 100) return Math.round(x).toLocaleString();
    if (a >= 10) return String(Math.round(x * 10) / 10);
    if (a >= 1) return String(Math.round(x * 100) / 100);
    return String(Number(x.toPrecision(2)));
  }
  // A price in chaos, or in divines once it is worth one or more, with the currency's picture.
  function valueHtml(c) {
    const divine = data ? data.divine : 0;
    const inDiv = divine > 0 && c >= divine;
    return `<b>${num(inDiv ? c / divine : c)}</b>${coin(inDiv ? 'divine' : 'chaos')}`;
  }
  // Top right: the socket button (where there are sockets to show) and the cross.
  const SOCKET_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="3.6"/><circle cx="15" cy="10" r="3.6"/><path d="M8.6 10h2.8"/></svg>';
  function headTools(sockets) {
    const on = !data || data.sockets !== false;
    const sk = sockets ? `<button type="button" class="pc-tool${on ? ' on' : ''}" data-sockets title="${on ? 'Hide' : 'Show'} the sockets on item pictures" aria-pressed="${on}">${SOCKET_ICON}</button>` : '';
    return `<div class="pc-tools">${sk}<button type="button" class="pc-x" data-close aria-label="Close" title="Close (Escape)">×</button></div>`;
  }
  // The bottom line: where to read more about the item, which league, and what a divine is worth.
  function footHtml(d) {
    const divine = d.divine > 0 ? `<span class="pc-rate" title="Divine Orb on poe.ninja">1 ${coin('divine')} = <b>${num(d.divine)}</b> ${coin('chaos')}</span>` : '';
    return `<div class="pc-foot"><span class="pc-sites"><button type="button" data-site="wiki" title="Its page on the Path of Exile wiki">Wiki</button><button type="button" data-site="poedb" title="Its page on PoEDB">PoEDB</button></span>
      <span class="pc-league">${d.league ? `<span title="The league prices and listings are for">${esc(d.league)}</span>` : ''}${divine}</span></div>`;
  }

  // Currency and other things sold in bulk: laid out like any other item, with the bulk
  // exchange's offers as its listings.
  function bulkView(d) {
    return `<div class="pc-head">${art(d.icon, '', 1, 1, 'cur')}
        <div class="pc-meta"><h1>${esc(d.title)}</h1><p class="pc-about">${esc([d.about, d.qty > 1 ? `stack of ${d.qty.toLocaleString()}` : ''].filter(Boolean).join(' · '))}</p><div class="pc-answer">${headlineHtml(d)}</div></div>
        ${headTools(false)}</div>
      ${d.want ? `<div class="pc-go"><button type="button" class="primary" data-search ${d.state === 'searching' ? 'disabled' : ''}>${d.state === 'done' ? 'Search again' : 'Search the bulk exchange'}</button>
        ${d.url ? '<button type="button" class="pc-site" data-open>Trade site ↗</button>' : ''}</div>${listHtml(d)}` : '<div class="pc-gap"></div>'}
      ${footHtml(d)}`;
  }

  // An unidentified unique: the uniques its base can be, dearest first. A click searches for it.
  function pickView(d) {
    const rowsHtml = d.choices.map((c) => `<li><button type="button" data-pick="${esc(c.name)}">${art(c.icon, '', 1, 1, 'sm')}
        <span class="pc-pn">${esc(c.name)}${c.dust ? `<small>${c.dust.toLocaleString()} dust</small>` : ''}</span><span class="pc-lp">${valueHtml(c.chaos)}</span></button></li>`).join('');
    return `<div class="pc-head">
        <div class="pc-meta"><h1>Unidentified ${esc(d.base)}</h1><p class="pc-about">${d.choices.length} uniques come on this base</p>
          <p class="pc-say">Which one is it? Pick it to see its price and what is listed.</p></div>
        ${headTools(false)}</div>
      <div class="pc-listings pick"><div class="pc-lh"><span>Dearest first</span><span>poe.ninja</span></div><ul class="pc-list pick">${rowsHtml}</ul></div>
      ${footHtml(d)}`;
  }

  // Possible bench crafts: room left for one, the usual craft for each open slot with what it
  // adds to the price (worked out by itself after each search, ticked or not: runCrafts in
  // main.js), and a tick that searches the item as if the craft were already on it.
  let craftOn = [];  // the crafts ticked, by their total line
  // Ticks or numbers changed: what each craft adds is worked out again for them, a moment after
  // the last change (so a run of clicks on + sends one request, not one per click).
  let craftPending = false, craftTimer = null;
  function choicesChanged() {
    if (!data || !data.craft || data.state !== 'done' || !data.craft.ideas.some((i) => i.priced)) return;
    craftPending = true;
    redrawCraft();
    clearTimeout(craftTimer);
    craftTimer = setTimeout(() => { craftPending = false; api.action({ type: 'craftPrices', edits: edits() }); }, 1200);
  }
  function redrawCraft() {
    const box = panel.querySelector('.pc-craft');
    if (box && data) box.outerHTML = craftHtml(data);
  }
  function craftHtml(d) {
    const c = d.craft;
    if (!c) return '';
    const open = [c.open.prefix ? `${c.open.prefix} prefix${c.open.prefix > 1 ? 'es' : ''}` : '', c.open.suffix ? `${c.open.suffix} suffix${c.open.suffix > 1 ? 'es' : ''}` : ''].filter(Boolean).join(' and ');
    const ideas = c.ideas.map((i) => {
      let right;
      const working = craftPending || i.state === 'waiting' || i.state === 'running';
      if (!i.priced) right = '<small title="The trade site has no total line to search it on">not priced</small>';
      else if (d.state !== 'done' || !i.state) right = '<small>after the search</small>';
      else if (working) right = '<small>working it out…</small>';
      else if (i.state === 'later') right = `<small title="${esc(i.why)}">later</small>`;
      else if (i.state === 'error') right = `<small class="bad" title="${esc(i.why)}">could not search</small>`;
      else if (i.baseFew) right = '<small title="Too few items with these stats are listed to compare with">too few listed</small>';
      else if (i.chaos === null) right = `<small title="Only ${i.n} item${i.n === 1 ? '' : 's'} like it with the craft listed">too few with it</small>`;
      else {
        const sure = i.n >= 5;
        const tip = `Items like it with the craft: the five cheapest average ${fmtValue(i.chaos)} (${i.n} listed)${sure ? '' : '. Few listed, so take it as a rough guess'}`;
        right = `<span class="pc-lp${sure ? '' : ' rough'}" title="${esc(tip)}">${i.delta > 0 ? `<em class="up">+${esc(fmtValue(i.delta))}</em>` : '<em>adds ≈ 0</em>'}<small>→</small> ${priceHtml(i.chaos)}</span>`;
      }
      const on = craftOn.includes(i.stat);
      return `<li class="${on ? 'on' : 'off'}" title="The usual craft for an open ${esc(i.slot)}, priced at its lowest roll. Ticked: searched as if it were already on the item.">
        <label class="pc-tick"><input type="checkbox" data-craft="${esc(i.stat)}" ${on ? 'checked' : ''} ${i.priced ? '' : 'disabled'}><span class="m-crafted">${esc(i.text)}</span><small>${esc(i.slot)}</small></label>${right}</li>`;
    }).join('');
    const note = c.ideas.length > 1 ? ' · one at a time' : '';
    return `<div class="pc-craft"><p><b>Possible bench crafts</b> · ${esc(open)} open${note}</p>${ideas ? `<ul class="pc-rows">${ideas}</ul>` : ''}</div>`;
  }

  function draw() {
    const d = data;
    const kind = d && d.kind === 'bulk' ? 'bulk' : d && d.kind === 'pick' && !(d.filters && d.filters.ok) && d.choices && d.choices.length ? 'pick' : d && d.filters && d.filters.ok ? 'search' : '';
    if (!kind) { panel.innerHTML = ''; sendSize(0); return; }
    // A new item: the window waits for its height before it shows, so it is always sent.
    if (modeFor !== d.at) { modeFor = d.at; mode = 'stats'; sentHeight = -1; again = false; craftOn = []; craftPending = false; clearTimeout(craftTimer); }
    if (kind !== 'search') { panel.innerHTML = kind === 'bulk' ? bulkView(d) : pickView(d); sendSize(fullHeight()); return; }
    const key = `${d.at}:${d.filtersRev}`;
    if (key !== formFor) { formFor = key; rows = rowsFrom(d.filters); }
    const f = d.filters;
    const tabs = f.presets ? `<div class="pc-tabs" role="tablist">
        <button type="button" role="tab" class="pc-tab${mode === 'stats' ? ' on' : ''}" aria-selected="${mode === 'stats'}" data-mode="stats" title="Items with stats like this one">Stats</button>
        <button type="button" role="tab" class="pc-tab${mode === 'base' ? ' on' : ''}" aria-selected="${mode === 'base'}" data-mode="base" title="This base type at this item level, whatever is rolled on it">Base item</button></div>` : '';
    const chips = rows.map((r, i) => (r.chip ? chipHtml(r, i) : '')).join('');
    const stats = rows.map((r, i) => (r.chip ? '' : rowHtml(r, i))).join('');
    const busy = d.state === 'searching';
    const about = [f.type && f.name !== f.title ? f.type.value : (f.category ? f.category.label : ''), f.itemLevel ? `item level ${f.itemLevel}` : '', f.sockets ? `${Math.max(...f.sockets.split(' ').map((g) => g.split('-').length))} linked` : ''].filter(Boolean);
    panel.innerHTML = `<div class="pc-head">${art(d.icon, f.sockets, ...headSize(d, f), 'big')}
        <div class="pc-meta"><h1>${esc(f.title)}</h1><p class="pc-about">${d.picked ? 'Unidentified · <button type="button" class="pc-link" data-pick="">Not this one?</button> · ' : ''}${esc(about.join(' · '))}</p><div class="pc-answer">${headlineHtml(d)}</div></div>
        ${headTools(true)}</div>
      ${tabs}
      <div class="pc-body"><div class="pc-chips">${chips}</div>
        ${stats ? `<ul class="pc-rows">${stats}</ul>` : ''}
        ${f.unknown.length ? `<p class="pc-note">Not on the trade site: ${f.unknown.map(esc).join('; ')}</p>` : ''}${craftHtml(d)}</div>
      <div class="pc-go"><button type="button" class="primary" data-search ${busy ? 'disabled' : ''}>${d.state === 'done' ? 'Search again' : 'Search'}</button>
        ${d.url ? '<button type="button" class="pc-site" data-open>Trade site ↗</button>' : ''}</div>
      ${listHtml(d)}
      ${footHtml(d)}`;
    sendSize(fullHeight());
  }
  // The window is only told its height when it changed: each change moves a see-through window,
  // which is slow on Windows.
  let sentHeight = -1;
  function sendSize(h) { if (h !== sentHeight) { sentHeight = h; api.checkSize(h); } }

  // How tall the panel wants to be: everything, with room for ten listings. It is never taller
  // than its window (the listings then scroll; the stats never do), which means its height on
  // screen says nothing while the window is still small: the limit is lifted for the moment of
  // measuring.
  function fullHeight() {
    panel.style.maxHeight = 'none';
    const h = Math.ceil(panel.getBoundingClientRect().height) + 2;
    panel.style.maxHeight = '';
    return h;
  }

  // What is ticked and set, in the shape the app lays over its own copy of the choices.
  function edits() {
    const e = { flags: {}, props: {}, stats: {}, crafts: craftOn.slice() };
    for (const r of rows) {
      if (r.tc === 'offline' || r.tc === 'type' || r.tc === 'category') e[r.tc] = r.enabled;
      else if (r.tc === 'flag') e.flags[r.key] = r.enabled;
      else if (r.tc === 'prop') e.props[r.key] = { enabled: r.enabled, min: r.num };
      else if (r.tc === 'stat') e.stats[r.key] = r.bound ? { enabled: r.enabled, [r.bound]: r.num } : { enabled: r.enabled };
    }
    return e;
  }

  function nudge(row, dir) {
    if (!row || !row.bound || row.num === null) return;
    setNum(row, Math.round((Number(row.num) + (row.flip ? -dir : dir) * row.step) * 10) / 10);
  }
  // A new number for a line. Only the number, its Match button and the tick change: the rest of
  // the window stays as it is (no redraw, so holding + or turning the wheel stays smooth).
  function setNum(row, n) {
    row.num = n;
    row.enabled = true; // setting a number means wanting it searched
    const li = panel.querySelector(`li[data-row="${rows.indexOf(row)}"]`);
    if (!li) { draw(); return; }
    const b = li.querySelector('.pc-num b');
    if (b) b.textContent = shown(row, row.num);
    const m = li.querySelector('.pc-match');
    if (m) m.classList.toggle('same', row.num === row.mine);
    setOn(li, true);
    choicesChanged();
  }

  // Typing a number: the number becomes a box, and the window asks for the keyboard until
  // Enter, Escape or a click elsewhere.
  let typing = null; // { row, input }
  function startTyping(b) {
    const li = b.closest('li[data-row]');
    const row = rows[Number(li.dataset.row)];
    if (!row || typing) return;
    const input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'decimal'; input.className = 'pc-type';
    input.value = String(shown(row, row.num));
    b.replaceWith(input);
    typing = { row, input };
    api.checkKeys(true);
    input.focus(); input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); stopTyping(true); }
      else if (e.key === 'Escape') { e.preventDefault(); stopTyping(false); }
    });
    input.addEventListener('blur', () => stopTyping(true));
  }
  function stopTyping(keep) {
    if (!typing) return;
    const { row, input } = typing;
    typing = null;
    const v = Number(String(input.value).replace(',', '.').trim());
    const b = document.createElement('b');
    b.dataset.type = ''; b.tabIndex = -1;
    b.textContent = shown(row, row.num);
    if (input.isConnected) input.replaceWith(b);
    api.checkKeys(false);
    if (keep && input.value.trim() !== '' && isFinite(v)) setNum(row, Math.round(shown(row, v) * 100) / 100);
  }
  function setOn(el, on) {
    el.classList.toggle('on', on); el.classList.toggle('off', !on);
    const box = el.querySelector('input[type=checkbox]');
    if (box) box.checked = on;
    if (el.classList.contains('pc-chip')) el.setAttribute('aria-pressed', String(on));
  }

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { api.action({ type: 'checkPanelClose' }); return; }
    if (e.target.closest('[data-search]')) { api.action({ type: 'tradeSearch', edits: edits() }); return; }
    if (e.target.closest('[data-open]')) { api.action({ type: 'tradeOpen' }); return; }
    if (e.target.closest('[data-sockets]')) {
      // shown or hidden at once here; the app keeps the choice for next time
      const on = panel.classList.toggle('no-sk') === false;
      const b = e.target.closest('[data-sockets]');
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.title = `${on ? 'Hide' : 'Show'} the sockets on item pictures`;
      api.action({ type: 'checkSockets' });
      return;
    }
    // a listing: unfolds to the whole item under it, or folds back
    const row = e.target.closest('li.can-open');
    if (row) {
      const l = data && data.listings && data.listings[Number(row.dataset.li)];
      const open = row.nextElementSibling && row.nextElementSibling.classList.contains('pc-detail');
      if (open) row.nextElementSibling.remove();
      else if (l) { row.insertAdjacentHTML('afterend', detailHtml(l)); row.nextElementSibling.scrollIntoView({ block: 'nearest' }); }
      row.classList.toggle('open', !open);
      return;
    }
    const site = e.target.closest('[data-site]');
    if (site) { api.action({ type: 'checkSite', site: site.dataset.site }); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) { api.action({ type: 'checkPickUnique', name: pick.dataset.pick }); return; }
    const tab = e.target.closest('[data-mode]');
    if (tab && data.filters.presets) {
      // A ready-made search: its ticks replace the ones on screen. Numbers stay as set.
      mode = tab.dataset.mode;
      const set = data.filters.presets[mode] || {};
      for (const r of rows) if (r.pk in set) r.enabled = !!set[r.pk];
      draw();
      // and searched straight away (the same search within a minute comes back at once)
      // (one still running: this one goes as soon as it is back)
      if (data.state !== 'searching') api.action({ type: 'tradeSearch', edits: edits() }); else again = true;
      return;
    }
    const chip = e.target.closest('.pc-chip');
    if (chip) { const r = rows[Number(chip.dataset.row)]; r.enabled = !r.enabled; setOn(chip, r.enabled); choicesChanged(); return; }
    const li = e.target.closest('[data-row]');
    if (!li) return;
    const step = e.target.closest('[data-step]');
    if (step) { nudge(rows[Number(li.dataset.row)], Number(step.dataset.step)); return; }
    if (e.target.closest('[data-match]')) { const r = rows[Number(li.dataset.row)]; setNum(r, r.mine); return; }
    const num = e.target.closest('[data-type]');
    if (num) startTyping(num);
  });
  panel.addEventListener('change', (e) => {
    const craft = e.target.closest('[data-craft]');
    if (craft) {
      // The bench adds one craft at a time: ticking one unticks the other.
      craftOn = craft.checked ? [craft.dataset.craft] : craftOn.filter((k) => k !== craft.dataset.craft);
      for (const box of panel.querySelectorAll('[data-craft]')) { box.checked = craftOn.includes(box.dataset.craft); const li = box.closest('li'); li.classList.toggle('on', box.checked); li.classList.toggle('off', !box.checked); }
      return;
    }
    const li = e.target.closest('[data-row]');
    if (!li || e.target.type !== 'checkbox') return;
    rows[Number(li.dataset.row)].enabled = e.target.checked;
    setOn(li, e.target.checked);
    choicesChanged();
  });
  // The wheel over a number moves it too.
  panel.addEventListener('wheel', (e) => {
    const num = e.target.closest('.pc-num');
    if (!num) return;
    e.preventDefault();
    nudge(rows[Number(num.closest('[data-row]').dataset.row)], e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  panel.addEventListener('load', () => sendSize(fullHeight()), true);

  // The app sends its state often; the window is only redrawn when this item's search has news,
  // so a click is never lost to a redraw in the middle of it.
  let drawnFor = '';
  let again = false; // the search to send once the running one is back
  api.onCheck((d) => {
    if (again && d && d.state !== 'searching') { again = false; data = d; api.action({ type: 'tradeSearch', edits: edits() }); }
    const key = d && d.filters ? `${d.at}:${d.filtersRev}:${d.rev}:${Math.round(d.divine || 0)}` : '';
    data = d;
    panel.classList.toggle('no-sk', !!d && d.sockets === false);
    if (key !== drawnFor || !key) { drawnFor = key; if (typing) stopTyping(true); draw(); }
  });
})();
