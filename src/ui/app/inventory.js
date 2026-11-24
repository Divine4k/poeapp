'use strict';
// Inventory page.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- inventory tab ------------------------------------------------------------------
let invRev = -1;
const invCells = new Map(); // slot -> what the Inventory page last showed there, for the fix dialog
async function renderInventory(force) {
  if ($('tab-inventory').hidden) return;
  if (!force && state.inventoryRev === invRev) return;
  const inv = await api.inventory();
  invRev = inv.rev;
  const box = $('inventory-body');
  if (!inv.at) {
    box.innerHTML = `<p class="hint">Nothing read yet. Open your inventory in game (${esc(state.config.inventory.key)}) and keep the mouse off it for a second.</p>`;
    return;
  }
  const describe = (c) => {
    if (c.status === 'item') return `${c.name} ×${c.qty}: ${fmtValue(c.total)}.${readNote(c)}`;
    if (c.status === 'remembered') return `${c.name} ×${c.qty}: ${fmtValue(c.total)}. Covered in this read, so the last known value is used.`;
    if (c.status === 'unknown') return `Not recognised, stack of ${c.qty}.${readNote(c) || (c.guess ? ` Closest picture: ${c.guess.name}, ${c.guess.score}% match.` : '')}`;
    if (c.status === 'ignored') return 'Ignored by you.';
    if (c.status === 'covered') return 'Possibly covered by a tooltip in this read, so nothing was concluded.';
    return `A single item the app has no picture for, so it is not counted. Hover it in game and press ${state.config.hotkeys.clipboard} to count it.${c.guess ? ` Closest picture: ${c.guess.name}, ${c.guess.score}%.` : ''}`;
  };
  const byCell = new Map(inv.cells.map((c) => [c.cell, c]));
  let grid = '';
  for (let k = 0; k < inv.cols * inv.rows; k++) {
    const c = byCell.get(k);
    const fixable = c && c.qty > 0 && ['item', 'remembered', 'unknown'].includes(c.status) && c.source !== 'pinned' && c.source !== 'map';
    grid += c ? `<div class="slot ${c.status}${fixable ? ' fixable' : ''}"${fixable ? ` data-fix="inv:${c.cell}"` : ''} title="${esc(describe(c))}${fixable ? ' Click to correct.' : ''}"><img src="${esc(c.image)}" alt="${esc(c.name || c.status)}"></div>` : '<div class="slot empty"></div>';
    if (c) invCells.set(c.cell, c);
  }
  const totals = new Map();
  let sum = 0, unpriced = 0;
  for (const c of inv.cells) {
    if (!c.name) continue;
    const t = totals.get(c.name) || { name: c.name, qty: 0, each: c.each, total: 0 };
    t.qty += c.qty; t.total += c.total; totals.set(c.name, t);
    sum += c.total;
  }
  for (const t of totals.values()) if (!t.each) unpriced++;
  const count = (s) => inv.cells.filter((c) => c.status === s).length;
  const rows = [...totals.values()].sort((a, b) => b.total - a.total).map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.qty}</td><td class="num">${t.each ? fmtValue(t.each) : 'no price'}</td><td class="num">${t.each ? fmtValue(t.total) : ''}</td></tr>`).join('');
  const problems = inv.cells.filter((c) => c.status === 'unknown' || c.status === 'remembered').map((c) => `<li>Row ${Math.floor(c.cell / inv.cols) + 1}, column ${(c.cell % inv.cols) + 1}: ${esc(describe(c))}</li>`).join('');
  box.innerHTML = `
      <div class="inv-top">
        <div class="inv-grid">${grid}</div>
        <div class="inv-sum">
          <div class="verdict">${fmtValue(sum)}</div>
          <div class="map-meta">Value of everything recognised, read at ${clock(inv.at)}.</div>
          <ul class="legend">
            <li class="item">${count('item')} recognised</li>
            <li class="remembered">${count('remembered')} covered, last known value used</li>
            <li class="unknown">${count('unknown')} not recognised</li>
            <li class="skipped">${count('skipped') + count('ignored') + count('covered')} not counted (single items the app has no picture for, such as gear and gems, or ignored, or covered)</li>
          </ul>
          ${unpriced ? `<p class="map-meta">${unpriced} recognised ${unpriced === 1 ? 'item has' : 'items have'} no price.</p>` : ''}
          <p class="map-meta">Hover a slot to see how it was read.</p>
        </div>
      </div>
      ${problems ? `<ul class="inv-problems">${problems}</ul>` : ''}
      <table><thead><tr><th>Item</th><th class="num">Amount</th><th class="num">Each</th><th class="num">Total</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Nothing recognised in this read.</td></tr>'}</tbody></table>`;
}
