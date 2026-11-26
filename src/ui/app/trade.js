'use strict';
// Trade page: the open offers (a queue and the picked offer), and the history, numbers and people read from the trade book.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- trade page -----------------------------------------------------------------
let tradeDrawn = '';
let tradeSeen = null; // highest offer id already announced with a sound
function beep() {
  try {
    const ctx = beep.ctx || (beep.ctx = new AudioContext());
    const t = ctx.currentTime;
    for (const [freq, at] of [[660, 0], [880, 0.13]]) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.18, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + at); osc.stop(t + at + 0.25);
    }
  } catch (_) { /* no sound device */ }
}

// Sold per day for the last two weeks: one column per day, today on the right.
let salesDrawn = '';
function renderSales(t) {
  const days = t.days || [], plot = $('sales-plot'), tip = $('sales-tip');
  const key = JSON.stringify([days, t.divine]);
  if (key === salesDrawn) return;
  salesDrawn = key;
  tip.hidden = true;
  const total = days.reduce((a, x) => a + x.sold, 0), count = days.reduce((a, x) => a + x.soldCount, 0);
  $('sales-sub').textContent = count ? `last ${days.length} days: ${count} ${count === 1 ? 'sale' : 'sales'}, ${fmtValue(total, t.divine)}` : `last ${days.length} days`;
  const max = Math.max(0, ...days.map((x) => x.sold));
  if (!count || max <= 0) {
    plot.innerHTML = `<p class="sales-empty">${count ? 'Sales in this period have no known value to chart.' : 'No sales in this period yet. Each finished sale adds to its day here.'}</p>`;
    return;
  }
  // One unit for the whole axis: divine once the tallest day is worth a few, chaos otherwise.
  const inDiv = t.divine > 0 && max >= t.divine * 3, unit = inDiv ? t.divine : 1, word = inDiv ? 'div' : 'c';
  const top = max / unit;
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((s) => top / s <= 3) || Math.ceil(top / 3);
  const ceil = Math.ceil(top / step) * step;
  const W = 560, H = 150, L = 44, R = 6, T = 14, B = 22, pw = W - L - R, ph = H - T - B;
  const band = pw / days.length, bw = Math.min(24, band - 2);
  const y = (v) => T + ph - (v / unit / ceil) * ph;
  const peak = days.reduce((a, x) => (x.sold > a.sold ? x : a), days[0]);
  let grid = '', cols = '';
  for (let v = 0; v <= ceil; v += step) {
    const gy = T + ph - (v / ceil) * ph;
    grid += `<line class="${v ? 'grid' : 'axis'}" x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}"/><text x="${L - 6}" y="${gy + 4}" text-anchor="end">${v}${v ? ` ${word}` : ''}</text>`;
  }
  days.forEach((x, i) => {
    const cx = L + band * i + band / 2, h = x.sold > 0 ? Math.max(2, T + ph - y(x.sold)) : 0, by = T + ph - h, r = Math.min(4, h, bw / 2);
    const date = new Date(x.day);
    // rounded at the data end, square on the baseline
    const bar = h ? `<path class="bar" d="M${cx - bw / 2},${T + ph} V${by + r} Q${cx - bw / 2},${by} ${cx - bw / 2 + r},${by} H${cx + bw / 2 - r} Q${cx + bw / 2},${by} ${cx + bw / 2},${by + r} V${T + ph} Z"/>` : '';
    const label = i % 2 === (days.length - 1) % 2 ? `<text x="${cx}" y="${H - 6}" text-anchor="middle">${date.getDate()}</text>` : '';
    const value = x === peak ? `<text class="peak" x="${cx}" y="${by - 4}" text-anchor="middle">${esc(fmtValue(x.sold, t.divine))}</text>` : '';
    cols += `<g class="col" tabindex="0" data-day="${i}">${bar}${value}${label}<rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${ph + B}"/></g>`;
  });
  plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Value sold per day over the last ${days.length} days. The same trades are listed under Finished trades.">${grid}${cols}</svg>`;
  const show = (g) => {
    const x = days[Number(g.dataset.day)];
    tip.textContent = '';
    const head = document.createElement('b'); head.textContent = x.soldCount ? fmtValue(x.sold, t.divine) : 'Nothing sold';
    const when = document.createElement('span'); when.textContent = `${dayOf(x.day)}: ${x.soldCount} ${x.soldCount === 1 ? 'sale' : 'sales'}`;
    tip.append(head, when);
    if (x.boughtCount) { const b = document.createElement('span'); b.textContent = `Bought ${x.boughtCount} for ${fmtValue(x.bought, t.divine)}`; tip.append(b); }
    tip.hidden = false;
    const box = g.querySelector('.hit').getBoundingClientRect(), host = $('sales').getBoundingClientRect();
    const left = Math.max(0, Math.min(box.left - host.left + box.width / 2 - tip.offsetWidth / 2, host.width - tip.offsetWidth));
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(0, box.top - host.top - tip.offsetHeight + 16)}px`;
  };
  for (const g of plot.querySelectorAll('.col')) {
    g.addEventListener('pointerenter', () => show(g));
    g.addEventListener('focus', () => show(g));
    g.addEventListener('pointerleave', () => { tip.hidden = true; });
    g.addEventListener('blur', () => { tip.hidden = true; });
  }
}


// ---- which part is open ------------------------------------------------------------
const TRADE_PARTS = { offers: 'trade-offers', history: 'trade-ledger', numbers: 'trade-numbers', people: 'trade-people' };
const tradeKept = (k, d) => { try { return localStorage.getItem(k) || d; } catch (_) { return d; } };
const tradeKeep = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
let tradeTab = TRADE_PARTS[tradeKept('tradeTab', 'offers')] ? tradeKept('tradeTab', 'offers') : 'offers';
let tradePick = null; // id of the offer shown on the right
let tradeSort = tradeKept('tradeSort', 'time');
const tradeSeg = { 'th-kind': 'all', 'th-when': '7', 'th-mode': 'each', 'tn-when': '14', 'tp-kind': 'all' };
let tradePlayer = ''; // the player shown on the People part

// The trade book (whole history, missed offers, notes) is asked for when a part that needs it
// is open, and again only when the book has changed (t.rev).
let tradeBook = null, tradeBookRev = null, tradeBookBusy = false, tradeBookKey = '';
function needBook(t) {
  if (tradeBookBusy || (tradeBook && tradeBookRev === t.rev)) return !!tradeBook;
  tradeBookBusy = true;
  Promise.resolve(api.tradeBook ? api.tradeBook() : null).catch(() => null).then((b) => {
    tradeBook = b || { history: t.history || [], missed: [], notes: {} };
    tradeBookRev = t.rev; tradeBookBusy = false; tradeBookKey = `${t.rev}|${Date.now()}`;
    renderTrade();
  });
  return !!tradeBook;
}
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Start of the period a "days" choice means: 1 = today, 7 = the last 7 days, 0 = everything.
const tradeSince = (days) => (Number(days) ? dayStart() - (Number(days) - 1) * 86400000 : 0);
const span = (ms) => TradeCard.ago(ms);
const countOf = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

// ---- offers: the queue ---------------------------------------------------------------
const TRADE_SETS = { in: [['invite', 'trade', 'thanks', 'kick'], ['busy', 'still', 'sold', 'whisper']], out: [['hideout', 'trade', 'thanks', 'leave'], ['whisper']] };
const TRADE_SHORT = { thanks: 'Thanks', sold: 'Sold', hideout: 'Hideout', leave: 'Leave', still: 'Still interested?', busy: 'Busy', whisper: 'Whisper' };
const TRADE_STEPS = { in: ['Whisper', 'Invite', 'In your hideout', 'Trade', 'Thanks'], out: ['Whisper', 'Their hideout', 'Trade', 'Thanks'] };
const stepAt = (o) => (o.dir === 'out' ? { new: 1, there: 2, trading: 2, done: 3 } : { new: 1, invited: 2, here: 3, trading: 3, done: 4 })[o.state] || 1;
// A buyer who has waited without an answer cools off: after 2 minutes, and after 5 most have moved on.
function freshOf(o, now) {
  if (o.dir !== 'in' || o.state !== 'new') return '';
  const age = now - (o.lastAt || o.at);
  return age > 5 * 60000 ? 'gone' : age > 2 * 60000 ? 'cool' : '';
}
const FRESH = { cool: 'cooling off', gone: 'probably gone' };
const offerPrice = (o) => (o.price ? `${o.price.amount} ${o.price.currency}` : 'no price');
function rowsInOrder(t) {
  const list = t.offers.slice();
  if (tradeSort === 'value') list.sort((a, b) => (b.value || 0) - (a.value || 0));
  const first = new Map(); // buyers of one thing stay together, where the first of them stands
  list.forEach((o, i) => { const k = o.group || o.id; if (!first.has(k)) first.set(k, i); });
  return list.map((o, i) => [first.get(o.group || o.id), i, o]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}
function queueHtml(t, rows, now) {
  let last = null;
  const lead = (rows.find((x) => x.next) || {}).id; // the offer the next-step key acts on
  return rows.map((o) => {
    const k = o.group || o.id, out = o.dir === 'out';
    const head = o.buyers > 1 && k !== last ? `<div class="tq-group">${countOf(o.buyers, 'buyer')} for this${o.buyers > 2 ? ' <em>may be priced low</em>' : ''}</div>` : '';
    last = k;
    const fresh = freshOf(o, now);
    const flags = [];
    if (o.soldAlready) flags.push(['bad', 'already sold']);
    if (o.low) flags.push(['bad', 'below market']);
    if (o.noShow) flags.push(['wait', 'did not come before']);
    else if (o.sales) flags.push(['ok', o.sales > 2 ? 'regular' : `bought ${o.sales}×`]);
    if (fresh) flags.push([fresh === 'gone' ? '' : 'wait', FRESH[fresh]]);
    const status = o.waiting || (out ? 'whispered, waiting for an invite' : '');
    const step = o.next
      ? `<button type="button" class="${o.id === lead ? 'primary' : ''}" data-trade="${o.next}" data-id="${esc(o.id)}" title="${esc((t.labels || {})[o.next] || o.next)} (${esc(o.player)})">${esc(TRADE_SHORT[o.next] || (t.labels || {})[o.next] || o.next)}</button>`
      : '<span class="tq-wait">Waiting</span>';
    return `${head}<div class="tq-row ${out ? 'out' : 'in'} ${esc(o.state)}${String(o.id) === String(tradePick) ? ' sel' : ''}${fresh === 'gone' ? ' gone' : ''}">
      <button type="button" class="tq-open" data-pick="${esc(o.id)}" aria-pressed="${String(o.id) === String(tradePick)}">
        <span class="tq-main"><b>${o.qty > 1 ? `${esc(o.qty)} × ` : ''}${esc(o.item)}</b><span>${out ? 'You buy from' : 'Buyer'} ${esc(o.player)}${status ? ` · ${esc(status)}` : ''}</span>${flags.length ? `<span class="tq-flags">${flags.map(([c, x]) => `<i class="${c}">${esc(x)}</i>`).join('')}</span>` : ''}</span>
        <span class="tq-num"><b class="${out ? '' : 'gold'}">${esc(offerPrice(o))}</b><span data-at="${Number(o.at) || 0}">${span(now - o.at)}</span></span>
      </button>${step}</div>`;
  }).join('');
}

// ---- offers: the picked offer ---------------------------------------------------------
function bigStash(o) {
  if (!o.grid) return '';
  const size = 120, cell = size / o.grid, mark = Math.max(cell, 8);
  const x = Math.min(size - mark, (o.left - 1) * cell), y = Math.min(size - mark, (o.top - 1) * cell);
  return `<div class="td-stash"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="The stash tab with the item's slot marked"><rect class="tc-tab" x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="6"/><rect class="tc-slot" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${mark.toFixed(1)}" height="${mark.toFixed(1)}" rx="2"/></svg>
    <div><span class="tx-label">Where it is</span><b>Tab “${esc(o.tab)}”</b><span>Left ${esc(o.left)}, top ${esc(o.top)}${o.grid === 24 ? ' (quad tab)' : ''}</span></div></div>`;
}
function verdictHtml(o, d) {
  if (o.value == null || o.market == null || !(o.market > 0)) return '';
  const pct = Math.round(((o.value - o.market) / o.market) * 100), m = TradeCard.chaosText(o.market, d);
  if (o.dir === 'out') return `<span class="td-verdict">poe.ninja has it at ${esc(m)}</span>`;
  if (o.low) return `<span class="td-verdict bad">${-pct}% under poe.ninja's ${esc(m)}</span>`;
  return `<span class="td-verdict${pct >= -10 ? ' ok' : ''}">${pct >= -10 && pct <= 10 ? 'Fair price' : pct > 10 ? `${pct}% over the market` : `${-pct}% under the market`}: poe.ninja ${esc(m)}</span>`;
}
function detailHtml(o, t) {
  const labels = t.labels || {}, out = o.dir === 'out';
  const [main, extra] = TRADE_SETS[out ? 'out' : 'in'];
  const btn = (a) => `<button type="button" class="${a === o.next ? 'primary' : ''}" data-trade="${a}" data-id="${esc(o.id)}" title="${esc(labels[a] || a)}">${esc(TRADE_SHORT[a] || labels[a] || a)}</button>`;
  const at = stepAt(o), steps = TRADE_STEPS[out ? 'out' : 'in'];
  const worth = o.price && o.value != null && !/^(chaos|div)/i.test(o.price.currency) ? `<small>${esc(TradeCard.chaosText(o.value, t.divine))}</small>` : '';
  const facts = [];
  if (!out) facts.push(o.sales ? `Bought from you ${o.sales === 1 ? 'once' : `${o.sales} times`} before.` : 'First sale to this player.');
  if (o.noShow) facts.push(`Was invited ${o.noShow === 1 ? 'once' : `${o.noShow} times`} before and did not come.`);
  if (o.asks > 1) facts.push(`Asked ${o.asks} times.`);
  if (o.buyers > 1) facts.push(`${o.buyers - 1} more ${o.buyers === 2 ? 'buyer wants' : 'buyers want'} this.`);
  if (o.rough) facts.push(`${o.lang || 'Another language'}: read roughly, check the whisper in game.`);
  else if (o.lang) facts.push(`Whisper in ${o.lang}.`);
  if (o.soldAlready) facts.push('You already sold this.');
  if (o.test) facts.push('A test offer: nothing is typed in the game.');
  return `<header><div><span class="tx-label">${out ? 'You buy from' : 'Buyer'} · ${esc(o.player)} · <span data-at="${Number(o.at) || 0}">${span(Date.now() - o.at)}</span></span>
      <h3>${o.qty > 1 ? `<span class="tc-qty">${esc(o.qty)} ×</span> ` : ''}${esc(o.item)}</h3></div>
      <div class="td-price"><b class="${o.price ? '' : 'none'}">${esc(o.price ? offerPrice(o) : 'no price given')}</b>${worth}${verdictHtml(o, t.divine)}</div></header>
    <ol class="td-steps" aria-label="Where this trade stands">${steps.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${s}</li>`).join('')}</ol>
    ${o.waiting && o.state !== 'here' ? `<p class="td-wait ${o.state === 'done' ? 'ok' : ''}">${esc(o.waiting)}</p>` : ''}
    <div class="td-info">${bigStash(o)}<ul class="td-facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}${o.playerNote ? `<li class="note">Your note: ${esc(o.playerNote)}</li>` : ''}</ul></div>
    ${o.note ? `<p class="td-note">They added: “${esc(o.note)}”</p>` : ''}
    <div class="td-btns"><div>${main.map(btn).join('')}</div>
      <div><span class="tx-label">Say</span>${extra.map(btn).join('')}<button type="button" class="td-dismiss" data-trade="dismiss" data-id="${esc(o.id)}">Dismiss</button></div></div>`;
}

let offersDrawn = '';
function renderOffers(t, cfg) {
  const now = Date.now(), rows = rowsInOrder(t);
  if (!rows.some((o) => String(o.id) === String(tradePick))) tradePick = (rows.find((o) => o.next) || rows[0] || {}).id ?? null;
  // The 30-second step redraws the "cooling off" marks without a change in the offers.
  const key = JSON.stringify([t.offers, t.divine, tradePick, tradeSort, Math.floor(now / 30000)]);
  if (key !== offersDrawn) {
    offersDrawn = key;
    const hk = cfg.hotkeys || {};
    const sort = rows.length > 1 ? `<div class="tq-sort"><span>${countOf(rows.length, 'open offer')}</span><button type="button" class="link" data-tsort="${tradeSort === 'value' ? 'time' : 'value'}">${tradeSort === 'value' ? 'Most valuable first' : 'Oldest first'} ⇅</button></div>` : '';
    $('trade-queue').innerHTML = rows.length ? sort + queueHtml(t, rows, now)
      : `<p class="empty">No open offers. When someone whispers you about an item, it appears here with the buttons to invite, trade and thank them${cfg.overlay ? ', and on top of the game' : ''}.${hk.next ? ` ${esc(hk.next)} does the next step for the oldest offer${hk.dismiss ? `, ${esc(hk.dismiss)} dismisses it` : ''}.` : ''}</p>`;
    const o = rows.find((x) => String(x.id) === String(tradePick));
    $('trade-detail').innerHTML = o ? detailHtml(o, t) : '<p class="empty">Pick an offer to see where the item is and every button for it.</p>';
    $('trade-detail').classList.toggle('none', !o);
  }
  const tot = t.totals, seen = t.seen || { whispers: 0, offers: 0 };
  const cell = (x, label) => `<div><span class="tx-label">${label}</span><b>${fmtValue(x.chaos, t.divine)}</b><span>${countOf(x.count, 'trade')}</span></div>`;
  setHtml($('trade-foot'), `${cell(tot.soldToday, 'Sold today')}${cell(tot.boughtToday, 'Bought today')}<p>${!state.status.log.ok ? 'The game log is not connected, so no whispers can be read.'
    : seen.whispers ? `${countOf(seen.whispers, 'whisper')} read since the app started, ${seen.offers} of them trade offers. Last at ${clock(seen.lastWhisperAt)}.` : 'No whispers read since the app started.'}</p>`);
}
// Once a second while the offers are on screen (the timer is in app/account.js).
function tradeTick() {
  TradeCard.tick($('trade-offers'));
  if (state && state.trade && state.trade.offers.length && offersDrawn && !offersDrawn.endsWith(`,${Math.floor(Date.now() / 30000)}]`)) renderOffers(state.trade, state.config.trade);
}

// ---- history ---------------------------------------------------------------------------
function ledgerRows() {
  const find = $('th-find').value.trim().toLowerCase(), kind = tradeSeg['th-kind'], from = tradeSince(tradeSeg['th-when']);
  return tradeBook.history.filter((h) => h.at >= from && (kind === 'all' || h.dir === kind) && (!find || h.item.toLowerCase().includes(find) || String(h.player).toLowerCase().includes(find)));
}
const took = (h) => (h.askedAt && h.at > h.askedAt ? h.at - h.askedAt : 0);
function perItem(rows) {
  const by = new Map();
  for (const h of rows) {
    const g = by.get(h.item) || by.set(h.item, { item: h.item, sold: 0, soldSum: 0, bought: 0, boughtSum: 0, took: 0, tookN: 0, last: h }).get(h.item);
    if (h.dir === 'in') { g.sold += h.qty || 1; g.soldSum += h.value || 0; if (took(h)) { g.took += took(h); g.tookN++; } } else { g.bought += h.qty || 1; g.boughtSum += h.value || 0; }
    if (h.at > g.last.at) g.last = h;
  }
  return [...by.values()].sort((a, b) => (b.soldSum - b.boughtSum) - (a.soldSum - a.boughtSum));
}
let ledgerDrawn = '';
function renderLedger(t) {
  if (!needBook(t)) return;
  const key = [tradeBookKey, $('th-find').value, tradeSeg['th-kind'], tradeSeg['th-when'], tradeSeg['th-mode'], t.divine, dayStart()].join('|');
  if (key === ledgerDrawn) return;
  ledgerDrawn = key;
  const rows = ledgerRows(), d = t.divine, MAX = 300;
  const money = (v) => (v ? fmtValue(v, d) : '');
  if (tradeSeg['th-mode'] === 'item') {
    $('th-head').innerHTML = '<tr><th>Item</th><th class="num">Sold</th><th class="num">Usual price</th><th class="num">Bought</th><th class="num">Earned</th><th class="num">Offer to done</th><th>Last</th></tr>';
    $('th-body').innerHTML = perItem(rows).slice(0, MAX).map((g) => `<tr>
      <td><b>${esc(g.item)}</b></td><td class="num">${g.sold ? `${g.sold} ×` : ''}</td><td class="num">${g.sold ? money(g.soldSum / g.sold) : ''}</td>
      <td class="num">${g.bought ? `${g.bought} × ${money(g.boughtSum / g.bought)}` : ''}</td>
      <td class="num ${g.soldSum - g.boughtSum < 0 ? 'neg' : 'pos'}">${fmtValue(g.soldSum - g.boughtSum, d)}</td>
      <td class="num">${g.tookN ? span(g.took / g.tookN) : ''}</td><td class="quiet">${esc(dayOf(g.last.at))}, ${clock(g.last.at)} · ${esc(g.last.player)}</td></tr>`).join('');
  } else {
    $('th-head').innerHTML = '<tr><th>When</th><th></th><th>Item</th><th class="num">Price</th><th class="num">Worth</th><th>Player</th><th class="num">Offer to done</th><th></th></tr>';
    $('th-body').innerHTML = rows.slice(0, MAX).map((h) => `<tr>
      <td>${esc(dayOf(h.at))}, ${clock(h.at)}</td><td><span class="kind ${h.dir === 'in' ? 'sold' : 'bought'}">${h.dir === 'in' ? 'Sold' : 'Bought'}</span></td>
      <td>${h.qty > 1 ? `${esc(h.qty)} × ` : ''}${esc(h.item)}</td><td class="num">${h.price ? `${esc(h.price.amount)} ${esc(h.price.currency)}` : 'n/a'}</td><td class="num">${money(h.value)}</td>
      <td><button type="button" class="link" data-player="${esc(h.player)}">${esc(h.player)}</button></td><td class="num">${took(h) ? span(took(h)) : ''}</td>
      <td><button type="button" class="link" data-act="tradeForget" data-id="${esc(h.id)}" aria-label="Remove this trade from the list">Remove</button></td></tr>`).join('');
  }
  if (!rows.length) $('th-body').innerHTML = `<tr><td colspan="8" class="empty">${tradeBook.history.length ? 'No trade fits. Try another period or word.' : 'Trades are listed here once the game reports "Trade accepted".'}</td></tr>`;
  const sum = (dir) => rows.reduce((a, h) => a + (h.dir === dir ? h.value || 0 : 0), 0), sold = sum('in'), bought = sum('out');
  $('th-sum').innerHTML = `<div><span class="tx-label">Found</span><b>${countOf(rows.length, 'trade')}</b></div><div><span class="tx-label">Sold</span><b class="gold">${fmtValue(sold, d)}</b></div>
    <div><span class="tx-label">Bought</span><b>${fmtValue(bought, d)}</b></div><div><span class="tx-label">Earned</span><b class="${sold - bought < 0 ? 'neg' : 'pos'}">${fmtValue(sold - bought, d)}</b></div>
    <p>${rows.length > MAX ? `The first ${MAX} are shown; the export has all of them. ` : ''}Kept on this computer, the newest 500 trades.</p>`;
}
function ledgerCsv() {
  if (!tradeBook) return;
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [['When', 'Kind', 'Quantity', 'Item', 'Price', 'Currency', 'Worth in chaos', 'Player', 'League', 'Seconds from offer to done'].join(',')];
  for (const h of ledgerRows()) lines.push([new Date(h.at).toISOString(), h.dir === 'in' ? 'Sold' : 'Bought', h.qty || 1, h.item, h.price ? h.price.amount : '', h.price ? h.price.currency : '', h.value == null ? '' : Math.round(h.value * 10) / 10, h.player, h.league || '', took(h) ? Math.round(took(h) / 1000) : ''].map(q).join(','));
  act({ type: 'tradeExport', text: `\ufeff${lines.join('\r\n')}` });
}

// ---- numbers ---------------------------------------------------------------------------
let numbersDrawn = '';
function renderNumbers(t) {
  renderSales(t);
  if (!needBook(t)) return;
  const key = [tradeBookKey, tradeSeg['tn-when'], t.divine, dayStart()].join('|');
  if (key === numbersDrawn) return;
  numbersDrawn = key;
  const from = tradeSince(tradeSeg['tn-when']), d = t.divine;
  const hist = tradeBook.history.filter((h) => h.at >= from), missed = tradeBook.missed.filter((m) => m.at >= from);
  const sold = hist.filter((h) => h.dir === 'in'), bought = hist.filter((h) => h.dir === 'out');
  const total = (list) => list.reduce((a, x) => a + (x.value || 0), 0);
  const timed = sold.filter(took), silent = missed.filter((m) => !m.invited), asked = sold.length + missed.length;
  const stat = (label, big, small, cls = '') => `<div><span class="tx-label">${label}</span><b class="${cls}">${big}</b><span>${small}</span></div>`;
  $('tn-stats').innerHTML = stat('Sold', fmtValue(total(sold), d), countOf(sold.length, 'sale'), 'gold') + stat('Bought', fmtValue(total(bought), d), countOf(bought.length, 'buy'))
    + stat('Offers that sold', asked ? `${Math.round((sold.length / asked) * 100)}%` : 'n/a', asked ? `${sold.length} of ${countOf(asked, 'offer')}` : 'no offers in this period')
    + stat('Offer to done', timed.length ? span(timed.reduce((a, h) => a + took(h), 0) / timed.length) : 'n/a', timed.length ? 'usual time for a sale' : 'counted from now on')
    + stat('Never answered', fmtValue(total(silent), d), `${countOf(silent.length, 'offer')} dismissed or left without an invite`, silent.length ? 'neg' : '');
  // When buyers whisper: every offer of the period by the hour it arrived.
  const hours = new Array(24).fill(0);
  for (const x of sold) hours[new Date(x.askedAt || x.at).getHours()]++;
  for (const x of missed) hours[new Date(x.at).getHours()]++;
  const peak = Math.max(...hours), best = hours.indexOf(peak);
  $('tn-hours').innerHTML = `<div class="tn-cap"><b>When buyers whisper you</b><span>${peak ? `busiest around ${String(best).padStart(2, '0')}:00` : 'no offers in this period yet'}</span></div>
    <svg class="tn-heat" viewBox="0 0 240 16" preserveAspectRatio="none" role="img" aria-label="${peak ? `Offers per hour of the day; most arrive around ${best}:00` : 'No offers yet'}">${hours.map((n, h) => `<rect x="${h * 10}" y="0" width="9" height="16" rx="2" fill-opacity="${peak ? (0.08 + (n / peak) * 0.92).toFixed(2) : 0.08}"><title>${String(h).padStart(2, '0')}:00, ${countOf(n, 'offer')}</title></rect>`).join('')}</svg>
    <div class="tn-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>`;
  const items = perItem(sold).filter((g) => g.soldSum > 0).sort((a, b) => b.soldSum - a.soldSum).slice(0, 6);
  // Asked for often and seldom sold: buyers leave before an answer, or the price draws the wrong crowd.
  const asks = new Map();
  for (const m of missed) asks.set(m.item, (asks.get(m.item) || 0) + 1);
  const soldBy = new Map(sold.map((h) => [h.item, 0]));
  for (const h of sold) soldBy.set(h.item, soldBy.get(h.item) + 1);
  const look = [...asks].map(([item, n]) => ({ item, n, sold: soldBy.get(item) || 0 })).filter((x) => x.n >= 3 && x.sold * 2 <= x.n).sort((a, b) => b.n - a.n).slice(0, 3);
  $('tn-side').innerHTML = `<h2>What sells for you</h2>${items.length ? `<ul class="tn-top">${items.map((g) => `<li><span>${esc(g.item)} <small>× ${g.sold}</small></span><b>${fmtValue(g.soldSum, d)}</b></li>`).join('')}</ul>` : '<p class="empty">Nothing sold in this period yet.</p>'}
    <h2>Worth a look</h2>${look.length ? look.map((x) => `<p class="tn-look"><b>${esc(x.item)}</b> was asked for ${x.n + x.sold} times and sold ${x.sold === 1 ? 'once' : `${x.sold} times`}. Buyers leave before an answer, or it is priced to be asked about.</p>`).join('')
    : '<p class="empty">Nothing stands out. An item that is asked for often and seldom sold shows up here.</p>'}`;
}

// ---- people ----------------------------------------------------------------------------
let peopleKept = null, peopleKey = '';
function people() {
  if (peopleKept && peopleKey === tradeBookKey) return peopleKept;
  const map = new Map();
  const of = (p) => map.get(p) || map.set(p, { player: p, offers: 0, sales: 0, bought: 0, paid: 0, noShow: 0, last: 0, trades: [] }).get(p);
  for (const h of tradeBook.history) {
    const x = of(h.player);
    if (h.dir === 'in') { x.offers++; x.sales++; x.paid += h.value || 0; } else x.bought++;
    x.last = Math.max(x.last, h.at); x.trades.push(h);
  }
  for (const m of tradeBook.missed) { const x = of(m.player); x.offers++; if (m.invited && !m.came) x.noShow++; x.last = Math.max(x.last, m.at); }
  peopleKey = tradeBookKey;
  return (peopleKept = [...map.values()].sort((a, b) => b.paid - a.paid || b.offers - a.offers));
}
const personTag = (x) => (x.sales > 2 ? ['ok', 'regular'] : x.noShow && !x.sales ? ['bad', 'did not come'] : x.sales ? ['', `${x.sales}×`] : ['', '']);
let peopleDrawn = '';
function renderPeople(t) {
  if (!needBook(t)) return;
  const find = $('tp-find').value.trim().toLowerCase(), kind = tradeSeg['tp-kind'];
  const key = [tradeBookKey, find, kind, tradePlayer, t.divine].join('|');
  if (key === peopleDrawn) return;
  peopleDrawn = key;
  const all = people(), d = t.divine;
  const list = all.filter((x) => (!find || x.player.toLowerCase().includes(find)) && (kind === 'all' || (kind === 'regular' ? x.sales > 2 : x.noShow > 0)));
  if (!list.some((x) => x.player === tradePlayer)) tradePlayer = list.length ? list[0].player : '';
  $('tp-list').innerHTML = list.length ? list.slice(0, 200).map((x) => {
    const [cls, tag] = personTag(x);
    return `<button type="button" class="tp-row${x.player === tradePlayer ? ' sel' : ''}" data-player="${esc(x.player)}" aria-pressed="${x.player === tradePlayer}">
      <span class="tq-main"><b>${esc(x.player)}</b><span>${countOf(x.offers, 'offer')} · ${countOf(x.sales, 'sale')}${x.bought ? ` · you bought ${x.bought}×` : ''}${x.noShow ? ` · did not come ${x.noShow}×` : ''} · last ${esc(dayOf(x.last))}</span></span>
      ${tag ? `<i class="${cls}">${esc(tag)}</i>` : ''}<b class="tp-paid">${x.paid ? fmtValue(x.paid, d) : ''}</b></button>`;
  }).join('') : `<p class="empty">${all.length ? 'No player fits.' : 'Players you trade with are listed here, from your own whispers and trades. Nothing is looked up about anyone.'}</p>`;
  const x = list.find((p) => p.player === tradePlayer);
  $('tp-detail').classList.toggle('none', !x);
  if (!x) { $('tp-detail').innerHTML = '<p class="empty">Pick a player to see your trades with them.</p>'; return; }
  const [cls, tag] = personTag(x), note = (tradeBook.notes || {})[x.player] || '';
  $('tp-detail').innerHTML = `<header><div><span class="tx-label">Player</span><h3>${esc(x.player)}</h3></div>${tag ? `<i class="tp-tag ${cls}">${esc(tag)}</i>` : ''}</header>
    <div class="tp-stats"><div><span class="tx-label">Paid you</span><b class="gold">${fmtValue(x.paid, d)}</b></div><div><span class="tx-label">Sales</span><b>${x.sales} of ${x.offers}</b></div><div><span class="tx-label">Did not come</span><b>${x.noShow}</b></div></div>
    ${x.trades.length ? `<ul class="tn-top">${x.trades.slice(0, 6).map((h) => `<li><span>${h.dir === 'in' ? '' : 'You bought '}${h.qty > 1 ? `${esc(h.qty)} × ` : ''}${esc(h.item)} <small>· ${esc(dayOf(h.at))}</small></span><b>${h.price ? `${esc(h.price.amount)} ${esc(h.price.currency)}` : 'n/a'}</b></li>`).join('')}</ul>${x.trades.length > 6 ? `<p class="quiet">${x.trades.length - 6} more in History.</p>` : ''}` : '<p class="empty">No finished trade with this player.</p>'}
    <label class="tp-note"><span class="tx-label">Your note (shown on their next offer)</span><textarea id="tp-note" rows="2" maxlength="300" data-player="${esc(x.player)}">${esc(note)}</textarea></label>
    <div class="td-btns"><div><button type="button" class="primary" data-tplayer="whisper">Whisper</button><button type="button" data-tplayer="history">Their trades</button><button type="button" data-tplayer="ignore">Ignore in game</button></div></div>`;
}

// ---- the page ----------------------------------------------------------------------------
function renderTrade() {
  const t = state.trade, cfg = state.config.trade;
  if (!t || !cfg) return;
  // The sound and the dot work with the page closed and the window minimized.
  const incoming = t.offers.filter((o) => o.dir === 'in');
  $('trade-dot').hidden = !incoming.length;
  const newest = incoming.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
  if (tradeSeen !== null && newest > tradeSeen && cfg.sound) beep();
  tradeSeen = Math.max(tradeSeen || 0, newest);
  if ($('tab-trade').hidden || document.hidden) return;

  const problems = [];
  if (!cfg.enabled) problems.push('Trade offers are switched off. Switch them on under Trade settings.');
  else if (!t.canSend) problems.push(`The buttons cannot type in the game: ${t.sendProblem || 'something is missing'}. Offers are still listed.`);
  if (t.afk) problems.push('You are marked AFK in game, so buyers get your auto-reply.');
  $('trade-warn').hidden = !problems.length;
  $('trade-warn').textContent = problems.join(' ');
  $('btn-trade-clear').hidden = tradeTab !== 'offers' || !t.offers.length;
  $('trade-count').hidden = !t.offers.length;
  $('trade-count').textContent = t.offers.length;
  for (const b of $('trade-tabs').querySelectorAll('[data-tt]')) b.setAttribute('aria-selected', String(b.dataset.tt === tradeTab));
  for (const [name, id] of Object.entries(TRADE_PARTS)) $(id).hidden = name !== tradeTab;
  if (tradeTab === 'offers') renderOffers(t, cfg);
  else if (tradeTab === 'history') renderLedger(t);
  else if (tradeTab === 'numbers') renderNumbers(t);
  else renderPeople(t);
}
function openTradePart(name) { tradeTab = name; tradeKeep('tradeTab', name); renderTrade(); }

$('tab-trade').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tt]');
  if (tab) { openTradePart(tab.dataset.tt); return; }
  const seg = e.target.closest('.tx-seg [data-v]');
  if (seg) {
    const box = seg.parentElement;
    tradeSeg[box.id] = seg.dataset.v;
    for (const b of box.children) b.setAttribute('aria-pressed', String(b === seg));
    renderTrade();
    return;
  }
  const pick = e.target.closest('[data-pick]');
  if (pick) { tradePick = pick.dataset.pick; renderTrade(); return; }
  const sort = e.target.closest('[data-tsort]');
  if (sort) { tradeSort = sort.dataset.tsort; tradeKeep('tradeSort', tradeSort); renderTrade(); return; }
  if (e.target.closest('#th-csv')) { ledgerCsv(); return; }
  const tp = e.target.closest('[data-tplayer]');
  if (tp && tradePlayer) {
    if (tp.dataset.tplayer === 'history') { $('th-find').value = tradePlayer; openTradePart('history'); return; }
    if (tp.dataset.tplayer === 'ignore' && !window.confirm(`Type /ignore ${tradePlayer} in the game? Their whispers will no longer reach you.`)) return;
    act({ type: 'tradePlayer', player: tradePlayer, do: tp.dataset.tplayer });
    return;
  }
  const who = e.target.closest('[data-player]');
  if (who && who.tagName === 'BUTTON') {
    tradePlayer = who.dataset.player;
    if (tradeTab === 'people') { renderTrade(); return; }
    $('tp-find').value = ''; tradeSeg['tp-kind'] = 'all';
    for (const b of $('tp-kind').children) b.setAttribute('aria-pressed', String(b.dataset.v === 'all'));
    openTradePart('people');
  }
});
$('th-find').addEventListener('input', () => renderTrade());
$('tp-find').addEventListener('input', () => renderTrade());
// A note is saved when its box is left, not per key.
$('tp-detail').addEventListener('change', (e) => { if (e.target.id === 'tp-note') act({ type: 'tradeNote', player: e.target.dataset.player, text: e.target.value }); });
