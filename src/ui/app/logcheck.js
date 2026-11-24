'use strict';
// Game log check dialog.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- game log check -----------------------------------------------------------------
// Shows whether the log file is being written to, the area lines that arrived and what the
// tracker did with each, so "the map does not start" can be told apart into its causes.
const logDlg = $('logcheck');
let logTimer = null;
let logText = '';
const since = (ms) => (ms < 90000 ? `${Math.round(ms / 1000)} seconds ago` : ms < 5400000 ? `${Math.round(ms / 60000)} minutes ago` : `${Math.round(ms / 3600000)} hours ago`);
async function renderLogCheck() {
  const d = await api.logCheck();
  const s = d.stats;
  const areaLines = d.trace.filter((t) => t.type === 'area');
  let verdict, bad = true;
  if (!d.path) verdict = 'No game log file was found. Pick Client.txt in Settings, under General.';
  else if (!d.ok || !s) verdict = `The file cannot be read: ${d.error || 'unknown reason'}.`;
  else if (!s.lastGrowthAt) verdict = 'Nothing has been added to this file since the app started. Either the game is not running, or this is not the file the game writes to (an old or second install).';
  else if (!areaLines.length) verdict = 'The game is writing to this file, but no area line has arrived yet. Go through a door or portal in game and watch this window.';
  else if (areaLines[0].did && areaLines[0].did.startsWith('Nothing: the area name')) verdict = 'Area lines arrive, but the last area was not treated as a map. The table shows its internal name.';
  else { verdict = 'The log is being read and area lines are being acted on.'; bad = false; }
  $('logcheck-verdict').textContent = verdict;
  $('logcheck-verdict').className = `verdict ${bad ? 'danger' : 'safe'}`;
  const facts = [
    ['File', d.path || 'none'],
    ['File size', s ? `${(s.size / 1048576).toFixed(1)} MB` : 'n/a'],
    ['Last written to by the game', s && s.modifiedAt ? `${since(d.now - s.modifiedAt)}` : 'n/a'],
    ['Read by the app since it started', s ? `${s.lines} lines${s.lastGrowthAt ? `, last ${since(d.now - s.lastGrowthAt)}` : ''}` : 'n/a'],
    ['The tracker thinks you are', d.inMap ? `in a map (${d.mapName || 'unnamed'})` : `not in a map${d.location && d.location.code ? ` (last area: ${d.location.name || d.location.code}, kind: ${d.location.kind})` : ''}`],
  ];
  $('logcheck-facts').innerHTML = facts.map(([k, v]) => `<li><span>${esc(k)}</span><span></span><span class="val">${esc(v)}</span></li>`).join('');
  $('logcheck-rows').innerHTML = d.trace.length
    ? d.trace.map((t) => `<tr><td class="dim">${new Date(t.at).toLocaleTimeString()}</td><td class="mono">${esc(t.raw)}</td><td>${esc(t.did || '')}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">No area lines yet.</td></tr>';
  logText = `Map Companion game log check\n${verdict}\n${facts.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${d.trace.map((t) => `${new Date(t.at).toLocaleTimeString()} | ${t.raw} | ${t.did || ''}`).join('\n')}`;
}
$('btn-logcheck').addEventListener('click', () => {
  logDlg.showModal();
  renderLogCheck();
  clearInterval(logTimer);
  logTimer = setInterval(renderLogCheck, 1000);
});
logDlg.addEventListener('close', () => clearInterval(logTimer));
$('btn-logcheck-close').addEventListener('click', () => logDlg.close());
$('btn-logcheck-copy').addEventListener('click', () => act({ type: 'copyText', text: logText }));
