'use strict';
// Settings, Developer tools: where recordings go on GitHub, and every user with their role.
// Only admins see it (state.trouble.admin); the server checks again on every request.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

let devUsers = [];
let devLoaded = false;
const ROLE_NAMES = { '': 'User', moderator: 'Moderator', admin: 'Admin' };

function renderDev() {
  const admin = !!(state.trouble && state.trouble.admin);
  $('set-nav-dev').hidden = !admin;
  if (!admin) { devLoaded = false; if (!$('set-dev').hidden) showSettings('general'); }
}

function devError(text) { $('dev-error').textContent = text || ''; $('dev-error').hidden = !text; }

async function devLoad() {
  devError('');
  const [g, u] = await Promise.all([api.dev({ type: 'github' }), api.dev({ type: 'users' })]);
  if (g.error) $('dev-github-status').textContent = g.error;
  else {
    const f = $('dev-github');
    if (document.activeElement !== f.elements.repo) f.elements.repo.value = g.repo || '';
    $('dev-github-status').textContent = g.hasToken
      ? `A token ending in …${g.tokenEnd} is saved${g.by ? ` (by ${g.by}${g.at ? `, ${new Date(g.at).toLocaleDateString()}` : ''})` : ''}.`
      : 'No token is saved yet, so recordings cannot be sent.';
    $('dev-token-clear').hidden = !g.hasToken;
  }
  if (u.error) { devError(u.error); devUsers = []; } else devUsers = u.users;
  devLoaded = true;
  devTable();
}

function devTable() {
  const q = $('dev-filter').value.trim().toLowerCase();
  const me = state.status.cloud.name;
  const rows = devUsers.filter((u) => !q || u.name.toLowerCase().includes(q));
  const day = (ts) => (ts ? new Date(ts).toLocaleDateString() : '–');
  $('dev-users').innerHTML = rows.length ? rows.map((u) => {
    const self = u.name.toLowerCase() === String(me).toLowerCase();
    const opts = Object.entries(ROLE_NAMES).map(([v, label]) => `<option value="${v}"${(u.role || '') === v ? ' selected' : ''}>${label}</option>`).join('');
    return `<tr><td>${esc(u.name)}${self ? ' <span class="dim">(you)</span>' : ''}</td>
      <td><select data-role-of="${esc(u.name)}" aria-label="Role of ${esc(u.name)}"${self ? ' disabled title="You cannot change your own role."' : ''}>${opts}</select></td>
      <td class="num">${u.sessions || 0}</td><td>${day(u.last)}</td><td>${day(u.created)}</td></tr>`;
  }).join('') : `<tr><td colspan="5" class="empty">${devLoaded ? 'No one by that name.' : 'Loading…'}</td></tr>`;
}

$('set-nav').addEventListener('click', (e) => { if (e.target.closest('[data-set="dev"]')) devLoad(); });
$('dev-refresh').addEventListener('click', devLoad);
$('dev-filter').addEventListener('input', devTable);
$('dev-users').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-role-of]');
  if (!sel) return;
  const name = sel.dataset.roleOf, role = sel.value;
  if (role === 'admin' && !window.confirm(`Make ${name} an admin? Admins can change everyone's roles and the GitHub token.`)) { devTable(); return; }
  sel.disabled = true;
  const r = await api.dev({ type: 'setRole', name, role });
  if (r.error) devError(r.error);
  await devLoad();
});
$('dev-github').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const patch = { type: 'setGithub', repo: f.elements.repo.value };
  if (f.elements.token.value.trim()) patch.token = f.elements.token.value;
  const r = await api.dev(patch);
  if (r.error) { $('dev-github-status').textContent = r.error; return; }
  f.elements.token.value = '';
  await devLoad();
  $('dev-github-status').textContent = `Saved. ${$('dev-github-status').textContent}`;
});
$('dev-token-clear').addEventListener('click', async () => {
  if (!window.confirm('Remove the saved token? Nobody can send recordings until a new one is saved.')) return;
  const r = await api.dev({ type: 'setGithub', token: '' });
  if (r.error) $('dev-github-status').textContent = r.error;
  else devLoad();
});
