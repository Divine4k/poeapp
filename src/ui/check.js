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
  // One per click; a tenth only for small values with a decimal point (1.5% crit). Numbers of
  // 10 or more go in whole steps (wholeFor in core/tradeQuery.js), so Match and typing do too.
  const stepFor = (value) => (Number.isInteger(Number(value)) || Math.abs(Number(value)) >= 10 ? 1 : 0.1);
  const mineFor = (value, step) => (value === null || step < 1 ? value : Math.round(value));

  function rowsFrom(f) {
    const out = [];
    // Short facts about the item: shown as a row of buttons, lit when they are part of the search.
    // pk: the tick's name in the two ready-made searches (see presets).
    if (f.category) out.push({ tc: 'category', pk: 'category', chip: true, label: f.category.label, title: 'Any base type of this kind', enabled: f.category.enabled });
    if (f.type) out.push({ tc: 'type', pk: 'type', chip: true, label: f.type.value, title: 'Only this base type', enabled: f.type.enabled });
    for (const x of f.flags) out.push({ tc: 'flag', pk: `flag:${x.key}`, chip: true, key: x.key, label: x.label, enabled: x.enabled });
    out.push({ tc: 'offline', chip: true, label: 'Offline sellers too', enabled: f.offline });
    for (const x of f.props) out.push({ tc: 'prop', pk: `prop:${x.key}`, key: x.key, label: `${x.label}: ${x.value}${x.unit || ''}`, enabled: x.enabled, bound: 'min', num: x.min === null ? mineFor(x.value, stepFor(x.value)) : x.min, mine: mineFor(x.value, stepFor(x.value)), step: stepFor(x.value) });
    for (const x of f.stats) {
      // The number shown is the one the search asks for: a lowest value for most stats, a
      // highest where less is better. A "reduced" stat is kept below zero by the trade site;
      // it is shown the way the item words it.
      const bound = x.value === null ? null : (x.min === null && x.max !== null ? 'max' : 'min');
      out.push({ tc: 'stat', pk: `stat:${x.key}`, key: x.key, label: x.text, mk: x.kind || 'explicit', kind: KIND_WORDS[x.kind] || '', tiers: x.tiers || [], enabled: x.enabled, bound, num: bound ? x[bound] : null, mine: x.value === null ? null : mineFor(x.negated ? -Math.abs(x.value) : x.value, stepFor(x.value)), step: stepFor(x.value), flip: !!x.negated });
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
      <label class="pc-tick"><input type="checkbox" ${r.enabled ? 'checked' : ''}><span class="m-${r.tc === 'prop' ? 'prop' : esc(r.mk)}">${esc(r.label)}</span>${kind}${tiers}</label>${num}</li>`;
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
    const f = (v) => { const x = inDiv ? v / divine : v; return x >= 100 || (!inDiv && x >= 10) ? Math.round(x).toLocaleString() : x < 1 ? num(x) : String(Math.round(x * (inDiv ? 100 : 10)) / (inDiv ? 100 : 10)); };
    const a = f(c), b = c2 != null ? f(c2) : a;
    return `<b>${a === b ? a : `${a}–${b}`}</b>${coin(inDiv ? 'divine' : 'chaos')}`;
  }

  // The answer, beside the picture: the cheapest and the typical price big, the rest in a line.
  function headlineHtml(d) {
    const bulk = d.kind === 'bulk';
    if (d.state === 'searching') return `<p class="pc-wait">Searching the ${bulk ? 'bulk exchange' : 'trade site'}…</p>${extrasHtml(d)}`;
    if (d.state === 'error') return `<p class="pc-bad">${esc(d.error)}</p>${extrasHtml(d)}`;
    // poe.ninja's price; a unique listed per variant (Mageblood by its flasks) as the range it is
    const ninja = d.ninja !== null && d.ninja !== undefined ? `<span${d.ninjaHigh ? ' title="poe.ninja prices it per variant: from the cheapest to the dearest one commonly listed"' : d.ninjaFor ? ` title="poe.ninja's price for this gem at ${esc(d.ninjaFor)}: the closest version it lists"` : ''}>poe.ninja <b>${d.ninjaHigh ? rangeText(d.ninja, d.ninjaHigh) : fmtValue(d.ninja)}</b></span>` : '';
    const s = d.summary || {};
    // what the whole stack is worth, at the cheapest offer (or poe.ninja's price before a search)
    const each = s.typical !== null && s.typical !== undefined ? s.typical : (s.low !== null && s.low !== undefined ? s.low : d.ninja);
    const stack = d.qty > 1 && each ? `your ${d.qty.toLocaleString()} <b>~${fmtValue(each * d.qty)}</b>` : '';
    if (bulk && !d.want) return `<div class="pc-price">${d.title === 'Chaos Orb' && d.divine ? `<b>${num(d.divine)}</b>${coin('chaos')}<small>for one divine</small>` : priceHtml(d.ninja)}</div><p class="pc-sub">${[ninja, stack].filter(Boolean).join('<i>·</i>')}</p>`;
    if (d.state !== 'done') return `<p class="pc-say">${bulk ? 'Press Search to see what the bulk exchange offers.' : 'Tick what matters, then press Search.'}</p>${ninja || stack ? `<p class="pc-sub">${[ninja, stack].filter(Boolean).join('<i>·</i>')}</p>` : ''}${extrasHtml(d)}`;
    if (!d.total) return `<p class="pc-say">${bulk ? 'Nobody offers it on the bulk exchange right now.' : 'Nothing like it is listed. Switch a stat off or lower a number.'}</p>${ninja ? `<p class="pc-sub">${ninja}</p>` : ''}${extrasHtml(d)}`;
    const sub = [`<b>${d.total.toLocaleString()}</b> ${bulk ? 'offers' : 'listed'}`, ninja, stack, d.searchedAt ? `searched ${ago(d.searchedAt, true)}` : ''].filter(Boolean).join('<i>·</i>');
    if (s.low === null && (s.typical === null || s.typical === undefined)) return `<p class="pc-sub">${sub}</p>${extrasHtml(d)}`;
    // one price, more or less: the average of the five cheapest real listings
    const typ = s.typical !== null && s.typical !== undefined ? s.typical : s.low;
    const how = s.from === 'ninja' ? `poe.ninja's price, from the game's currency exchange${s.low !== null ? ` (the cheapest real offer here is ${fmtValue(s.low)})` : ''}` : `The average of the five cheapest listings, bait left out (the cheapest is ${fmtValue(s.low)})`;
    return `<div class="pc-price" title="${esc(how)}"><span class="pc-about-sign">~</span>${priceHtml(typ)}<small>${bulk ? 'each' : d.adv ? 'standard' : ''}</small></div><p class="pc-sub">${sub}</p>${extrasHtml(d)}`;
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
        // a gem's "21/20" is shown as it is: neither more nor less than yours
        const better = !cmp.gem && (cmp.lower ? l.cmp < cmp.mine : l.cmp > cmp.mine), worse = !cmp.gem && (cmp.lower ? l.cmp > cmp.mine : l.cmp < cmp.mine);
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
  // The same range with the currency's picture, for the list of uniques.
  function rangeHtml(lo, hi) {
    const divine = data ? data.divine : 0;
    const inDiv = divine > 0 && hi >= divine;
    const f = (v) => { const x = inDiv ? v / divine : v; return x >= 10 ? Math.round(x).toLocaleString() : num(x); };
    return `<b>${f(lo)}–${f(hi)}</b>${coin(inDiv ? 'divine' : 'chaos')}`;
  }
  // "85–240 div": a range in one unit (divines once the top is worth one).
  function rangeText(lo, hi) {
    const divine = data ? data.divine : 0;
    const f = (x) => (x >= 10 ? Math.round(x).toLocaleString() : num(x));
    if (divine > 0 && hi >= divine) return `${f(lo / divine)}–${f(hi / divine)} div`;
    return `${f(lo)}–${f(hi)}c`;
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
        <span class="pc-pn">${esc(c.name)}${c.dust ? `<small>${c.dust.toLocaleString()} dust</small>` : ''}</span><span class="pc-lp"${c.high ? ' title="Priced per variant on poe.ninja: from the cheapest to the dearest one commonly listed"' : ''}>${c.high ? rangeHtml(c.chaos, c.high) : valueHtml(c.chaos)}</span></button></li>`).join('');
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
    if (box && data) { shownCraft = craftHtml(data); box.outerHTML = shownCraft; }
  }
  // What the window shows now, the bench crafts apart: while their prices come in one by one
  // (several updates within seconds of a search) only their box is drawn again, so the stats
  // above it stay as they are under the mouse and a quick run of clicks on them is not held up.
  let shownMain = null, shownCraft = '', shownAdv = '';
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
        right = `<span class="pc-lp${sure ? '' : ' rough'}" title="${esc(tip)}">${i.delta > 0 ? `<em class="up">~+${esc(fmtValue(i.delta))}</em>` : '<em>~+0</em>'}</span>`;
      }
      const on = craftOn.includes(i.stat);
      return `<li class="${on ? 'on' : 'off'}" title="The usual craft for an open ${esc(i.slot)}, priced at its lowest roll. Ticked: searched as if it were already on the item.">
        <label class="pc-tick"><input type="checkbox" data-craft="${esc(i.stat)}" ${on ? 'checked' : ''} ${i.priced ? '' : 'disabled'}><span class="m-crafted">${esc(i.text)}</span><small>${esc(i.slot)}</small></label>${right}</li>`;
    }).join('');
    const note = c.ideas.length > 1 ? ' · one at a time' : '';
    return `<div class="pc-craft"><p><b>Possibly good bench crafts</b> · ${esc(open)} open${note}</p>${ideas ? `<ul class="pc-rows">${ideas}</ul>` : ''}</div>`;
  }

  // The advanced price check's band, under the head (only after its own key): its own price as a
  // range, how sure it is, how fast such items sell, who the item fits and what carries it, and
  // a row to say how the price was. It keeps its four rows from the start, each one line high
  // whatever it says, so the window does not change height when its answer comes a moment after
  // the standard one.
  const SURE = { sure: ['sure', 'Plenty of fresh listings like it, close in price'], fair: ['fairly sure', 'Take it as a good guide, not to the chaos'], guess: ['a guess', 'Too little to go by: look at the listings yourself'] };
  const SPEED = { fast: ['sells fast', 'The cheapest listings like it are fresh: cheap ones get bought within a day'], steady: ['sells', 'The cheapest listings like it are a few days old'], slow: ['slow to sell', 'The cheapest listings like it have sat for days: expect to wait, or to go lower'] };
  const STEP_WORDS = ['', 'search widened once', 'search widened twice'];
  // The same range in the other currency, once it is worth half a divine: both are quoted in trade.
  function otherUnit(lo, hi) {
    const divine = data ? data.divine : 0;
    if (!(divine > 0) || hi < divine / 2) return '';
    const f = (x) => (x >= 10 ? Math.round(x).toLocaleString() : num(x));
    return lo >= divine ? `${f(lo)}–${f(hi)}c` : `${f(lo / divine)}–${f(hi / divine)} div`;
  }
  const dots = (parts) => parts.filter(Boolean).join('<i>·</i>');
  function advHtml(d) {
    const a = d.adv;
    if (!a) return '';
    const done = a.state === 'done';
    let top;
    if (done) {
      const other = otherUnit(a.low, a.high);
      const sure = SURE[a.sure] || SURE.guess, speed = a.speed ? SPEED[a.speed] : null;
      top = `<span class="pa-price" title="From what sells quickly to what a patient seller gets (typical: ${esc(fmtValue(a.typical))})">${priceHtml(a.low, a.high)}${other ? `<small>${esc(other)}</small>` : ''}</span>
        <span class="pa-pill p-${esc(a.sure)}" title="${esc(sure[1])}">${sure[0]}</span>${speed ? `<span class="pa-pill p-speed" title="${esc(speed[1])}">${speed[0]}</span>` : ''}`;
    } else if (a.state === 'working') top = '<span class="pa-wait">Working out its own price…</span>';
    else if (a.state === 'waiting') top = `<span class="pa-wait">${d.state === 'searching' ? 'Comes after the standard search…' : d.state === 'error' ? 'Needs the standard search to go through first.' : 'Its own price comes with the search.'}</span>`;
    else top = `<span class="pa-wait${a.state === 'error' ? ' pa-bad' : ''}" title="${esc(a.why || '')}">${esc(a.state === 'none' ? (a.why || 'Nothing to go by.') : a.state === 'later' ? (a.why || 'The trade site asked for a pause.') : `It could not be worked out: ${a.why || ''}`)}</span>`;
    // who it fits and what carries it (known at once, before any search)
    let fits;
    if (a.kind === 'score' && a.worth) fits = dots([a.fits.length ? `Fits <b>${esc(a.fits.join(' and '))}</b>` : '', ...a.parts.map((p) => `<span title="How much of its worth comes from this">${esc(p.as)} <b>${p.share}%</b></span>`)]);
    else if (a.kind === 'score') fits = `Nothing on it that buyers search for (<b>${a.score}</b> points): read from the standard search.`;
    else if (a.kind === 'exact') fits = 'Searched with exactly its number of passives.';
    else fits = 'No search of its own for this kind of item: read from the standard search.';
    if (a.unknown && a.unknown.length) fits += `<i>·</i><span class="pa-warn" title="A top-tier modifier the advanced check gives no points for. If it is what the item is bought for, the price is too low: press Too low.">not weighed: ${esc(a.unknown.join('; '))}</span>`;
    // what the price stands on
    const how = dots([
      ...(done ? (a.facts || []).map(esc) : []),
      done && a.source !== 'standard' && a.step > 0 ? STEP_WORDS[a.step] || '' : '',
      a.base ? `<span title="poe.ninja's price for ${esc(a.base.what)}, whatever is rolled on it">base alone ≈ <b>${esc(fmtValue(a.base.chaos))}</b></span>` : '',
      a.trend ? `<span title="How poe.ninja's price for it moved over the last week">${a.trend > 0 ? 'up' : 'down'} <b>${Math.abs(a.trend)}%</b> this week</span>` : '',
    ]);
    // how was the price: what the advanced check is tuned from (kept with the item and both prices)
    const say = (k, word, tip) => `<button type="button" class="${a.said === k ? 'on' : ''}" data-adv-say="${k}" aria-pressed="${a.said === k}" title="${esc(tip)}"${done ? '' : ' disabled'}>${word}</button>`;
    const ask = `<div class="pa-ask"><span>${a.said ? 'Noted, thank you.' : 'How is this price?'}</span>${say('low', 'Too low', 'It is worth more than this')}${say('right', 'Right', 'This price is right')}${say('high', 'Too high', 'It is worth less than this')}
      ${done && a.url ? '<button type="button" class="pc-link" data-adv-open title="The listings it was compared with, on the trade site">See them ↗</button>' : ''}</div>`;
    const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return `<div class="pc-adv s-${esc(a.state)}"><div class="pa-top"><span class="pa-tag">Advanced</span>${top}</div>
      <p class="pa-line" title="${esc(plain(fits))}">${fits}</p><p class="pa-line pa-how" title="${esc(plain(how))}">${how || '&nbsp;'}</p>${ask}</div>`;
  }

  // rowsMoved: the ticks were changed by something other than a click on them (a ready-made search).
  // Timed for the Under the hood page: this window must stay quick while mods are clicked.
  function draw(rowsMoved) { return window.Hood ? window.Hood.run('drawing the price check window', () => drawNow(rowsMoved)) : drawNow(rowsMoved); }
  function drawNow(rowsMoved) {
    const d = data;
    const kind = d && d.kind === 'bulk' ? 'bulk' : d && d.kind === 'pick' && !(d.filters && d.filters.ok) && d.choices && d.choices.length ? 'pick' : d && d.filters && d.filters.ok ? 'search' : '';
    if (!kind) { shownMain = null; panel.innerHTML = ''; sendSize(0); return; }
    // A new item: the window waits for its height before it shows, so it is always sent.
    if (modeFor !== d.at) { modeFor = d.at; mode = 'stats'; sentHeight = -1; again = false; craftOn = []; craftPending = false; clearTimeout(craftTimer); }
    if (kind !== 'search') { shownMain = null; panel.innerHTML = kind === 'bulk' ? bulkView(d) : pickView(d); sendSize(fullHeight()); return; }
    const key = `${d.at}:${d.filtersRev}`;
    if (key !== formFor) { formFor = key; rows = rowsFrom(d.filters); rowsMoved = true; }
    const f = d.filters;
    const tabs = f.presets ? `<div class="pc-tabs" role="tablist">
        <button type="button" role="tab" class="pc-tab${mode === 'stats' ? ' on' : ''}" aria-selected="${mode === 'stats'}" data-mode="stats" title="Items with stats like this one">Stats</button>
        <button type="button" role="tab" class="pc-tab${mode === 'base' ? ' on' : ''}" aria-selected="${mode === 'base'}" data-mode="base" title="This base type at this item level, whatever is rolled on it">Base item</button></div>` : '';
    const chips = rows.map((r, i) => (r.chip ? chipHtml(r, i) : '')).join('');
    const stats = rows.map((r, i) => (r.chip ? '' : rowHtml(r, i))).join('');
    const busy = d.state === 'searching';
    const about = [f.gem ? `Gem · level ${f.level} · quality +${f.gemQuality}%` : '', !f.gem && f.type && f.name !== f.title ? f.type.value : (f.category ? f.category.label : ''), f.itemLevel ? `item level ${f.itemLevel}` : '', f.quality ? `quality +${f.quality}%` : '', f.catalyst ? `quality +${f.catalyst.value}% (${f.catalyst.kind.toLowerCase()})` : '', f.sockets ? `${Math.max(...f.sockets.split(' ').map((g) => g.split('-').length))} linked` : ''].filter(Boolean);
    const craft = craftHtml(d), adv = advHtml(d);
    const main = (chips, stats, c, a) => `<div class="pc-head">${art(d.icon, f.sockets, ...headSize(d, f), 'big')}
        <div class="pc-meta"><h1>${esc(f.title)}</h1><p class="pc-about">${d.picked ? 'Unidentified · <button type="button" class="pc-link" data-pick="">Not this one?</button> · ' : ''}${esc(about.join(' · '))}</p><div class="pc-answer">${headlineHtml(d)}</div></div>
        ${headTools(true)}</div>
      ${a}${tabs}
      <div class="pc-body"><div class="pc-chips">${chips}</div>
        ${stats ? `<ul class="pc-rows">${stats}</ul>` : ''}
        ${f.unknown.length ? `<p class="pc-note">Not on the trade site: ${f.unknown.map(esc).join('; ')}</p>` : ''}${c}</div>
      <div class="pc-go"><button type="button" class="primary" data-search ${busy ? 'disabled' : ''}>${d.state === 'done' ? 'Search again' : 'Search'}</button>
        ${d.url ? '<button type="button" class="pc-site" data-open>Trade site ↗</button>' : ''}</div>
      ${listHtml(d)}
      ${footHtml(d)}`;
    // Compared without the stats: a click on one changes it in place (setOn, setNum), so what is
    // on screen already matches `rows`.
    const rest = main('', stats ? ' ' : '', '', '');
    // The bench crafts and the advanced band each sit in a box of their own: when only they
    // have news, only they are written again.
    const same = !rowsMoved && rest === shownMain;
    const box = same && craft && shownCraft ? panel.querySelector('.pc-craft') : null;
    const band = same && adv && shownAdv ? panel.querySelector('.pc-adv') : null;
    if ((box || band) && (craft === shownCraft || box) && (adv === shownAdv || band)) {
      if (box && craft !== shownCraft) box.outerHTML = craft;
      if (band && adv !== shownAdv) band.outerHTML = adv;
    } else panel.innerHTML = main(chips, stats, craft, adv);
    shownMain = rest; shownCraft = craft; shownAdv = adv;
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
    if (!li) { draw(true); return; }
    const b = li.querySelector('.pc-num b');
    if (b) b.textContent = shown(row, row.num);
    const m = li.querySelector('.pc-match');
    if (m) m.classList.toggle('same', row.num === row.mine);
    setOn(li, true);
    choicesChanged();
  }

  // Typing a number: the number becomes a box. The window never takes the keyboard (that moved
  // the game out of the front, and Windows put Explorer there instead): the app holds the keys a
  // number needs while it is typed and passes each one here (onCheckKey). Enter keeps the
  // number, Escape drops it, a click anywhere else keeps it.
  let typing = null; // { row, input, fresh, at }
  let drawLater = false; // news came in while typing: draw once it ends
  function startTyping(b) {
    const li = b.closest('li[data-row]');
    const row = rows[Number(li.dataset.row)];
    if (!row || typing) return;
    const input = document.createElement('input');
    input.type = 'text'; input.readOnly = true; input.tabIndex = -1; input.className = 'pc-type fresh';
    input.value = String(shown(row, row.num));
    b.replaceWith(input);
    typing = { row, input, fresh: true, at: data && data.at }; // the first key replaces the number shown
    api.checkKeys(true);
  }
  function typeKey(k) {
    if (!typing) return;
    if (k === 'Enter' || k === 'done') { stopTyping(true); return; }
    if (k === 'Escape') { stopTyping(false); return; }
    const t = typing;
    let v = t.fresh ? '' : t.input.value;
    t.fresh = false;
    t.input.classList.remove('fresh');
    if (k === 'Backspace') v = v.slice(0, -1);
    else if (k === '-') v = v.startsWith('-') ? v.slice(1) : `-${v}`;
    // A point only where the item's own number has one (damage per second), and then one digit
    // after it, as the + and - steps go; whole-number stats take whole numbers only.
    else if (k === '.') { if (t.row.step < 1 && !v.includes('.')) v = `${v || '0'}.`; }
    else if (/^[0-9]$/.test(k)) {
      const after = v.includes('.') ? v.split('.')[1].length : 0;
      if (v.replace(/[-.]/g, '').length < 6 && !(v.includes('.') && after >= 1)) v += k;
    }
    t.input.value = v;
  }
  if (api.onCheckKey) api.onCheckKey(typeKey);
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
    if (keep && input.value.trim() !== '' && input.value.trim() !== '-' && isFinite(v)) {
      const n = row.step < 1 ? Math.round(shown(row, v) * 10) / 10 : Math.round(shown(row, v));
      if (n !== row.num) setNum(row, n); // unchanged: nothing to search again
    }
    if (drawLater) { drawLater = false; draw(); }
  }
  function setOn(el, on) {
    el.classList.toggle('on', on); el.classList.toggle('off', !on);
    const box = el.querySelector('input[type=checkbox]');
    if (box) box.checked = on;
    if (el.classList.contains('pc-chip')) el.setAttribute('aria-pressed', String(on));
  }

  // Ticks and chips answer the press of the mouse, not the click. A click only counts when the
  // button goes down and comes up on the same thing, and going quickly down a list the mouse is
  // already on its way to the next row when the button comes up: those clicks were lost.
  //
  // A press reaches the window two ways: as its own pointerdown, and from the app, which sees
  // every press of the mouse on the screen and passes on those that land in this window
  // ('hook'). Over the game the window's own events do not always come: in a recording, eleven
  // presses in a row on one line with the mouse held still did nothing, though the app saw
  // every one. Whichever way comes first does the work; the same press coming the other way
  // within a moment is left alone.
  let lastPress = null; // { key, source, at }
  function pressOn(target, source, y) {
    const chip = target && target.closest('.pc-chip');
    // The whole line is the target, from edge to edge, not only its text: anywhere on it but
    // the number, its buttons and Match.
    // Found by height within the list, so the rounded corners of a line and the hair between
    // two lines belong to a line as well.
    const list = !chip && target && !target.closest('.pc-num, .pc-match, button, input[type=text]') && target.closest('.pc-rows');
    const line = list && [...list.children].find((li) => { const r = li.getBoundingClientRect(); return y >= r.top && y < r.bottom; });
    const tick = line && line.querySelector('.pc-tick');
    const box = tick && tick.querySelector('input[type=checkbox]');
    if (!chip && (!box || box.disabled)) return;
    const key = chip ? `chip:${chip.dataset.row}` : box.dataset.craft ? `craft:${box.dataset.craft}` : `row:${line.dataset.row}`;
    const now = performance.now();
    if (lastPress && lastPress.key === key && lastPress.source !== source && now - lastPress.at < 150) { lastPress = null; return; }
    lastPress = { key, source, at: now };
    if (chip) { const r = rows[Number(chip.dataset.row)]; r.enabled = !r.enabled; setOn(chip, r.enabled); choicesChanged(); return; }
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // A press anywhere but the box being typed in ends the typing first, keeping the number.
  const endTypingFor = (el) => { if (typing && !(el && el === typing.input)) stopTyping(true); };
  panel.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; endTypingFor(e.target); pressOn(e.target, 'page', e.clientY); });
  if (api.onCheckPress) api.onCheckPress((p) => {
    const el = document.elementFromPoint(p.x, p.y);
    if (typing) { endTypingFor(el); return; }
    // A number clicked over the game: its own click does not always come (the window never had
    // the keyboard), so the press the app saw starts the typing.
    const num = el && el.closest('[data-type]');
    if (num) { startTyping(num); return; }
    pressOn(el, 'hook', p.y);
  });
  panel.addEventListener('click', (e) => {
    // The click that follows such a press has been dealt with (detail 0: made by the keyboard, not the mouse).
    if (e.detail > 0 && (e.target.closest('.pc-tick, .pc-chip') || (e.target.closest('.pc-rows') && !e.target.closest('.pc-num, .pc-match, button')))) { e.preventDefault(); return; }
    if (e.target.closest('[data-close]')) { api.action({ type: 'checkPanelClose' }); return; }
    if (e.target.closest('[data-search]')) { api.action({ type: 'tradeSearch', edits: edits() }); return; }
    if (e.target.closest('[data-open]')) { api.action({ type: 'tradeOpen' }); return; }
    if (e.target.closest('[data-adv-open]')) { api.action({ type: 'advancedOpen' }); return; }
    const mark = e.target.closest('[data-adv-say]');
    if (mark) { api.action({ type: 'advancedSay', say: mark.dataset.advSay }); return; }
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
      draw(true);
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
    if (key !== drawnFor || !key) {
      drawnFor = key;
      // News while a number is typed (the bench craft prices come in a moment after any change)
      // waits until the typing ends: drawing now took the box away under the user's fingers,
      // and the keys typed after that went to the game. A new item ends the typing.
      if (typing && d && d.at === typing.at) { drawLater = true; return; }
      if (typing) stopTyping(false);
      draw();
    }
  });
})();
