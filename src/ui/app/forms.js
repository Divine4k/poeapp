'use strict';
// Run buttons, name suggestions, naming items, adding loot and costs.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

$('btn-run-toggle').addEventListener('click', () => act({ type: currentRun() ? 'endRun' : 'startRun' }));
$('btn-new-session').addEventListener('click', async () => {
  if (!state.summary.runs.length || await askYes('Start a new session? The current one is saved and stays in the row of sessions above the map list.', { yes: 'New session' })) act({ type: 'newSession' });
});
// Adding loot by name is rare, so its fields stay folded until asked for.
$('btn-add-loot').addEventListener('click', () => {
  const f = $('add-loot'), open = f.hidden;
  f.hidden = !open;
  $('btn-add-loot').setAttribute('aria-expanded', String(open));
  if (open) $('add-loot-name').focus();
});

async function suggest(q) {
  if (!q || q.length < 2) return;
  const res = await api.search(q);
  $('price-names').innerHTML = res.slice(0, 20).map((r) => `<option value="${esc(r.name)}"></option>`).join('');
}
document.addEventListener('input', (e) => { if (e.target.getAttribute('list') === 'price-names') suggest(e.target.value); });

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-learn-form]');
  if (!f) return;
  e.preventDefault();
  const input = f.querySelector('input');
  act({ type: 'learn', id: f.dataset.learnForm, name: input.value.trim() });
  input.value = '';
  input.blur();
});

$('add-loot').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('add-loot-name').value.trim();
  if (!name) return;
  act({ type: 'addLoot', name, qty: Number($('add-loot-qty').value) || 1 });
  $('add-loot-name').value = ''; $('add-loot-qty').value = 1;
});

const readCost = (form) => {
  const f = new FormData(form);
  const chaos = f.get('chaos');
  return { name: String(f.get('name')).trim(), qty: Number(f.get('qty')) || 1, chaos: chaos === '' || chaos == null ? null : Number(chaos) };
};
$('add-loadout').addEventListener('submit', (e) => {
  e.preventDefault();
  api.setConfig({ loadout: [...(state.config.loadout || []), readCost(e.target)] });
  e.target.reset();
});
$('add-run-cost').addEventListener('submit', (e) => {
  e.preventDefault();
  const run = currentRun();
  if (!run) return;
  act({ type: 'addCost', runId: run.id, cost: readCost(e.target) });
  e.target.reset();
});
