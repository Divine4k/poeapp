'use strict';
// The overlay on top of the game: the oldest open offers with their buttons.
(() => {
  const api = window.api;
  const { cardHtml, tick } = window.TradeCard;
  const stack = document.getElementById('stack');
  const MAX = 4;
  let drawn = '';

  function render(t) {
    const offers = (t && t.offers) || [];
    const shown = offers.slice(0, MAX);
    const key = JSON.stringify([shown, offers.length, t && t.divine]);
    if (key !== drawn) {
      drawn = key;
      const more = offers.length - shown.length;
      const hk = t && t.hotkeys && t.hotkeys.next;
      stack.innerHTML = shown.map((o) => cardHtml(o, { divine: t.divine, labels: t.labels })).join('')
        + (more > 0 ? `<p class="ov-more">${more} more ${more === 1 ? 'offer' : 'offers'} in the app${hk ? `. ${hk} does the next step for the top one` : ''}</p>` : '');
    }
    api.overlaySize(offers.length ? Math.ceil(stack.getBoundingClientRect().height) : 0);
  }

  stack.addEventListener('click', (e) => {
    const b = e.target.closest('[data-trade]');
    if (b) api.action({ type: 'trade', id: b.dataset.id, do: b.dataset.trade });
  });
  setInterval(() => tick(stack), 1000);
  api.onTrade(render);
})();
