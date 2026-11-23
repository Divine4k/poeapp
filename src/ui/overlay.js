'use strict';
// The overlay on top of the game: one small line per open offer. A click on an offer's name
// opens it into the full card with every button; a click on the card's top line closes it.
(() => {
  const api = window.api;
  const { cardHtml, tileHtml, tick } = window.TradeCard;
  const stack = document.getElementById('stack');
  const MAX = 5;
  let drawn = '';
  let open = null; // id of the offer shown as a full card
  let last = null;

  function render(t) {
    last = t;
    const offers = (t && t.offers) || [];
    const shown = offers.slice(0, MAX);
    if (open !== null && !shown.some((o) => String(o.id) === open)) open = null;
    const key = JSON.stringify([shown, offers.length, t && t.divine, open]);
    if (key !== drawn) {
      drawn = key;
      const more = offers.length - shown.length;
      const opt = { divine: t.divine, labels: t.labels };
      stack.innerHTML = shown.map((o) => (String(o.id) === open ? cardHtml(o, opt) : tileHtml(o, opt))).join('')
        + (more > 0 ? `<p class="ov-more">${more} more in the app</p>` : '');
    }
    api.overlaySize(offers.length ? Math.ceil(stack.getBoundingClientRect().height) : 0);
  }

  stack.addEventListener('click', (e) => {
    const b = e.target.closest('[data-trade]');
    if (b) { api.action({ type: 'trade', id: b.dataset.id, do: b.dataset.trade }); return; }
    const opener = e.target.closest('[data-open]');
    if (opener) { open = opener.dataset.open; render(last); return; }
    if (e.target.closest('.tc header')) { open = null; render(last); }
  });
  setInterval(() => tick(stack), 1000);
  api.onTrade(render);
})();
