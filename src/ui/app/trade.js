'use strict';
// Trade page: offers and sales.
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

function renderTrade() {
  const t = state.trade, cfg = state.config.trade;
  if (!t || !cfg) return;
  const incoming = t.offers.filter((o) => o.dir === 'in');
  $('trade-dot').hidden = !incoming.length;
  const newest = incoming.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
  if (tradeSeen !== null && newest > tradeSeen && cfg.sound) beep();
  tradeSeen = Math.max(tradeSeen || 0, newest);

  const warn = $('trade-warn');
  const problems = [];
  if (!cfg.enabled) problems.push('Trade offers are switched off. Switch them on under Trade settings.');
  else if (!t.canSend) problems.push(`The buttons cannot type in the game: ${t.sendProblem || 'something is missing'}. Offers are still listed.`);
  if (t.afk) problems.push('You are marked AFK in game, so buyers get your auto-reply.');
  warn.hidden = !problems.length;
  warn.textContent = problems.join(' ');
  const hk = cfg.hotkeys;
  $('trade-hint').textContent = `Whispers from the trade site show up here${cfg.overlay ? ' and on top of the game' : ''}. The gold button is the next step${hk.next ? `; ${hk.next} presses it for the oldest offer` : ''}${hk.dismiss ? `, ${hk.dismiss} dismisses it` : ''}.`;
  const seen = t.seen || { whispers: 0, offers: 0 };
  $('trade-seen').textContent = !state.status.log.ok ? 'The game log is not connected, so no whispers can be read.'
    : seen.whispers ? `Since the app started: ${seen.whispers} ${seen.whispers === 1 ? 'whisper' : 'whispers'} read from the game log, ${seen.offers} of them trade offers. Last one at ${clock(seen.lastWhisperAt)}.`
      : 'No whispers read from the game log since the app started.';
  $('btn-trade-clear').hidden = !t.offers.length;

  const box = $('trade-offers');
  const key = JSON.stringify([t.offers, t.divine]);
  if (key !== tradeDrawn) {
    tradeDrawn = key;
    box.innerHTML = t.offers.length
      ? t.offers.map((o) => TradeCard.cardHtml(o, { divine: t.divine, labels: t.labels })).join('')
      : '<p class="empty">No open offers. When someone whispers you about an item, it appears here with the buttons to invite, trade and thank them.</p>';
  }

  renderSales(t);
  const tot = t.totals, d = t.divine;
  const cell = (x, label) => `<div>${fmtValue(x.chaos, d)}<span>${label}: ${x.count} ${x.count === 1 ? 'trade' : 'trades'}${x.unpriced ? `, ${x.unpriced} without a known value` : ''}</span></div>`;
  $('trade-totals').innerHTML = cell(tot.soldToday, 'Sold today') + cell(tot.boughtToday, 'Bought today') + cell(tot.soldAll, 'Sold in total') + cell(tot.boughtAll, 'Bought in total');
  $('trade-history').innerHTML = t.history.length ? t.history.map((h) => `<tr>
      <td>${esc(dayOf(h.at))}, ${clock(h.at)}</td>
      <td><span class="kind ${h.dir === 'in' ? 'sold' : 'bought'}">${h.dir === 'in' ? 'Sold' : 'Bought'}</span></td>
      <td>${h.qty > 1 ? `${esc(h.qty)} × ` : ''}${esc(h.item)}</td>
      <td class="num">${h.price ? `${esc(h.price.amount)} ${esc(h.price.currency)}` : 'n/a'}</td>
      <td>${esc(h.player)}</td>
      <td><button type="button" class="link" data-act="tradeForget" data-id="${esc(h.id)}" aria-label="Remove this trade from the list">Remove</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">Trades are listed here once the game reports "Trade accepted".</td></tr>';
}
