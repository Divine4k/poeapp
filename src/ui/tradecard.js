'use strict';
// How one trade offer is drawn. Shared by the Trade page and the overlay on top of the game.
(() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function ago(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function chaosText(c, divine) {
    if (c == null || !isFinite(c)) return '';
    const a = Math.abs(c);
    if (divine > 0 && a >= divine) return `${(c / divine).toFixed(a >= divine * 10 ? 1 : 2)} div`;
    return `${a >= 100 ? Math.round(c) : Math.round(c * 10) / 10}c`;
  }

  // A small picture of the stash tab with the item's slot marked.
  function stashHtml(o) {
    if (!o.grid) return '';
    const size = 40, cell = size / o.grid, mark = Math.max(cell, 4);
    const x = Math.min(size - mark, (o.left - 1) * cell), y = Math.min(size - mark, (o.top - 1) * cell);
    const where = `Left ${o.left}, top ${o.top}${o.grid === 24 ? ' (quad tab)' : ''}`;
    return `<div class="tc-stash" title="${esc(where)}">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><rect class="tc-tab" x="0.5" y="0.5" width="${size - 1}" height="${size - 1}"/><rect class="tc-slot" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${mark.toFixed(1)}" height="${mark.toFixed(1)}"/></svg>
      <span><b>${esc(o.tab)}</b><small>${esc(where)}</small></span></div>`;
  }

  const SETS = {
    in: [['invite', 'trade', 'thanks', 'kick'], ['busy', 'still', 'sold']],
    out: [['hideout', 'trade', 'thanks', 'leave'], []],
  };
  const SHORT = { thanks: 'Thanks', sold: 'Sold', hideout: 'Hideout', leave: 'Leave', still: 'Interested?' };

  // o: an offer from the app's trade state. opt: { divine, labels, now }.
  function cardHtml(o, opt = {}) {
    const labels = opt.labels || {};
    const name = (a) => SHORT[a] || labels[a] || a;
    const [main, extra] = SETS[o.dir === 'out' ? 'out' : 'in'];
    const btn = (a) => `<button type="button" class="${a === o.next ? 'primary' : ''}" data-trade="${a}" data-id="${esc(o.id)}" title="${esc(labels[a] || a)}">${esc(name(a))}</button>`;
    const amount = o.qty > 1 ? `<span class="tc-qty">${esc(o.qty)} ×</span> ` : '';
    const worth = o.price && o.value != null && !/^chaos$/i.test(o.price.currency) ? ` <small>${esc(chaosText(o.value, opt.divine))}</small>` : '';
    const price = o.price ? `<span class="tc-price">${esc(o.price.amount)} ${esc(o.price.currency)}${worth}</span>` : '<span class="tc-price none">no price given</span>';
    const flags = [];
    if (o.test) flags.push(['', 'Test']);
    if (o.asks > 1) flags.push(['', `Asked ${o.asks} times`]);
    if (o.soldAlready) flags.push(['bad', 'You already sold this']);
    if (o.low) flags.push(['bad', `Below market: ${chaosText(o.market, opt.divine)} on poe.ninja`]);
    else if (o.market != null && o.value != null) flags.push(['', `Market ${chaosText(o.market, opt.divine)}`]);
    if (o.waiting) flags.push([o.state === 'done' ? 'ok' : 'wait', o.waiting]);
    return `<article class="tc ${o.dir === 'out' ? 'out' : 'in'} ${esc(o.state)}">
      <header><span class="tc-dir">${o.dir === 'out' ? 'You buy from' : 'Buyer'}</span><b class="tc-player">${esc(o.player)}</b>
        <span class="tc-age" data-at="${Number(o.at) || 0}">${ago((opt.now || Date.now()) - o.at)}</span>
        <button type="button" class="tc-x" data-trade="dismiss" data-id="${esc(o.id)}" aria-label="Dismiss the offer from ${esc(o.player)}">✕</button></header>
      <div class="tc-what"><span class="tc-item">${amount}${esc(o.item)}</span>${price}</div>
      ${o.note ? `<p class="tc-note">${esc(o.note)}</p>` : ''}
      <div class="tc-info">${stashHtml(o)}<ul class="tc-flags">${flags.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join('')}</ul></div>
      <div class="tc-btns">${main.map(btn).join('')}${extra.length ? `<span class="tc-gap"></span>${extra.map(btn).join('')}` : ''}</div>
    </article>`;
  }

  // Keeps the "how long ago" labels inside root moving.
  function tick(root) {
    const now = Date.now();
    for (const el of root.querySelectorAll('[data-at]')) el.textContent = ago(now - Number(el.dataset.at));
  }

  const shortPrice = (p) => (p ? `${p.amount} ${String(p.currency).replace(/ Orb$/i, '').replace(/^Orb of /i, '').toLowerCase()}` : '?');

  // The small version for the overlay: the next step, the item and the price on one line.
  function tileHtml(o, opt = {}) {
    const labels = opt.labels || {};
    const step = o.next
      ? `<button type="button" class="primary" data-trade="${o.next}" data-id="${esc(o.id)}" title="${esc(labels[o.next] || o.next)} (${esc(o.player)})">${esc(SHORT[o.next] || labels[o.next] || o.next)}</button>`
      : `<span class="tt-wait" title="${esc(o.waiting)}">…</span>`;
    const warn = o.soldAlready ? 'Already sold' : (o.low ? 'Below market' : '');
    return `<div class="tt ${o.dir === 'out' ? 'out' : 'in'} ${esc(o.state)}">
      ${step}
      <button type="button" class="tt-open" data-open="${esc(o.id)}" title="${esc(`${o.dir === 'out' ? 'You buy from' : 'Buyer:'} ${o.player}. ${o.waiting || 'Click for all buttons'}`)}">
        <span class="tt-item">${o.qty > 1 ? `${esc(o.qty)}× ` : ''}${esc(o.item)}</span>${warn ? `<span class="tt-warn">${warn}</span>` : ''}<span class="tt-price">${esc(shortPrice(o.price))}</span></button>
      ${o.dir !== 'out' && o.state !== 'done' ? `<button type="button" class="tt-say" data-trade="busy" data-id="${esc(o.id)}" title="Whisper ${esc(o.player)} that you are busy">Busy</button><button type="button" class="tt-say" data-trade="sold" data-id="${esc(o.id)}" title="Whisper ${esc(o.player)} that it is sold, and dismiss">Sold</button>` : ''}
      <button type="button" class="tt-ico" data-trade="dismiss" data-id="${esc(o.id)}" aria-label="Dismiss the offer from ${esc(o.player)}">✕</button></div>`;
  }

  window.TradeCard = { esc, ago, chaosText, cardHtml, tileHtml, tick };
})();
