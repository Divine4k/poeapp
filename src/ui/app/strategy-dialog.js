'use strict';
// Strategy dialog: new, rename, atlas tree link, delete.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- strategy dialog: new, rename, atlas tree link, delete -------------------------
const sdlg = $('strategy-dialog'), sform = $('strategy-form');
let editing = null; // id being edited, or null for a new one
function openStrategy(id) {
  const cur = id ? state.config.strategies.find((x) => x.id === id) : null;
  editing = cur ? cur.id : null;
  $('strategy-dialog-title').textContent = cur ? 'Edit strategy' : 'New strategy';
  sform.elements.name.value = cur ? cur.name : '';
  sform.elements.atlasUrl.value = cur ? cur.atlasUrl || '' : '';
  $('btn-strategy-delete').hidden = !cur || state.config.strategies.length < 2 || cur.id === state.config.activeStrategy;
  sdlg.showModal();
}
$('btn-strategy-cancel').addEventListener('click', () => sdlg.close());
$('btn-strategy-delete').addEventListener('click', () => {
  const n = (state.sessions || []).filter((x) => x.strategyId === editing).length;
  if (!window.confirm(`Delete this strategy${n ? ` and its ${n} saved ${n === 1 ? 'session' : 'sessions'}` : ''}? This cannot be undone.`)) return;
  act({ type: 'deleteStrategy', id: editing });
  sdlg.close();
});
sform.addEventListener('submit', () => {
  const id = editing || `s${Date.now().toString(36)}`;
  if (!editing) stratSel = id; // show the new one straight away
  act({ type: 'saveStrategy', id, name: sform.elements.name.value, atlasUrl: sform.elements.atlasUrl.value });
});
