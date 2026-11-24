'use strict';
// Prices page (price browser).
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- price browser ------------------------------------------------------------------
let priceCat = 'Currency';
let priceStamp = '';
let priceMeta = { chaosIcon: null, divineIcon: null, groups: [] };
let searchTimer = null;
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const coin = (url, word) => (url ? `<img class="coin" src="${esc(url)}" alt="${word}" width="22" height="22">` : `<span class="coinword">${word}</span>`);

// Value the way poe.ninja shows it: a number with the currency's picture.
function valueCell(chaos) {
  const divine = state.summary.divine;
  if (divine > 0 && chaos >= divine) {
    const d = chaos / divine;
    return `${d >= 100 ? Math.round(d).toLocaleString() : d.toFixed(1)} ${coin(priceMeta.divineIcon, 'divine')}`;
  }
  return `${chaos >= 100 ? Math.round(chaos) : Math.round(chaos * 10) / 10} ${coin(priceMeta.chaosIcon, 'chaos')}`;
}

// Small trend line for the last 7 days.
function sparkline(points, change) {
  if (!points || points.length < 2) return '';
  const w = 64, h = 22, min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const xy = points.map((v, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark ${change < 0 ? 'down' : 'up'}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${xy}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

async function renderPriceCats() {
  priceMeta = await api.priceCategories();
  const all = priceMeta.groups.flatMap((g) => g.categories);
  if (priceCat && !all.some((c) => c.id === priceCat) && all.length) priceCat = all[0].id;
  $('price-cats').innerHTML = priceMeta.groups.map((g) => `<h3>${esc(g.group)}</h3>${g.categories.map((c) => `<button type="button" data-cat="${esc(c.id)}" aria-pressed="${c.id === priceCat}">
      ${c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy" width="32" height="32">` : '<span class="noicon"></span>'}<span class="cat-name">${esc(c.label)}</span></button>`).join('')}`).join('');
}

async function renderPriceRows() {
  const global = $('price-global').value.trim();
  const query = global || $('price-search').value;
  const everywhere = !!global;
  const res = await api.priceList({ category: everywhere ? '' : priceCat, query });
  const labels = new Map(priceMeta.groups.flatMap((g) => g.categories).map((c) => [c.id, c.label]));
  $('price-title').textContent = everywhere ? `Results for "${global}"` : (labels.get(priceCat) || 'Prices');
  $('price-search').hidden = everywhere;
  const custom = !everywhere && priceCat === 'Custom';
  $('custom-price').hidden = !custom;
  $('price-count').textContent = res.total > res.rows.length
    ? `Showing the ${res.rows.length} most valuable of ${res.total.toLocaleString()}. Type more of the name to narrow it down.`
    : `${res.total} ${res.total === 1 ? 'item' : 'items'}, most valuable first.`;
  const hasVolume = res.rows.some((r) => r.volume != null);
  $('price-vol-head').textContent = hasVolume ? 'Volume / hour' : 'Listed';
  $('price-rows').innerHTML = res.rows.length ? res.rows.map((r) => {
    const pct = r.change == null ? '' : `<span class="${r.change < 0 ? 'neg' : 'pos'}">${r.change > 0 ? '+' : ''}${Math.round(r.change)}%</span>`;
    const traded = r.volume != null ? `${compact(r.volume)} ${coin(priceMeta.chaosIcon, 'chaos')}` : (r.listings != null ? compact(r.listings) : '');
    return `<tr>
        <td><div class="pname">${r.icon ? `<img src="${esc(r.icon)}" alt="" loading="lazy" width="36" height="36">` : '<span class="noicon"></span>'}<span>${esc(r.name)}${everywhere ? `<small>${esc(labels.get(r.category) || r.category)}</small>` : ''}</span></div></td>
        <td class="num val">${valueCell(r.chaos)}</td>
        <td class="num"><span class="trend">${sparkline(r.spark, r.change)}${pct}</span></td>
        <td class="num dim">${custom ? `<button type="button" class="link" data-act="removeCustomPrice" data-name="${esc(r.name)}">Remove</button>` : traded}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">${query.trim() ? 'Nothing matches that name.' : (custom ? 'Set your own price for items poe.ninja does not list, such as special maps. Your price is used wherever the item is counted.' : 'No prices in this category yet.')}</td></tr>`;
}

// Redraws the price page when it is opened or when new prices have arrived.
async function renderPrices(force) {
  if ($('tab-prices').hidden) return;
  const stamp = `${state.status.prices.updatedAt}:${state.status.prices.count}`;
  if (!force && stamp === priceStamp) return;
  priceStamp = stamp;
  await renderPriceCats();
  await renderPriceRows();
}

$('price-cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  priceCat = b.dataset.cat;
  $('price-global').value = '';
  $('price-search').value = '';
  for (const x of $('price-cats').querySelectorAll('[data-cat]')) x.setAttribute('aria-pressed', String(x === b));
  renderPriceRows();
  document.querySelector('#tab-prices .table-wrap').scrollTop = 0;
});
$('custom-price').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  await act({ type: 'setCustomPrice', name: f.get('name'), chaos: f.get('chaos') });
  e.target.reset();
  priceStamp = '';
  renderPrices(true);
});
for (const id of ['price-search', 'price-global']) {
  $(id).addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderPriceRows, 150);
  });
}
