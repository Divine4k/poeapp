'use strict';
// Account dialog.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- account -------------------------------------------------------------------------
// Registering is asked for once each time the app starts, until there is an account.
const acc = $('account'), accForm = $('account-form');
let accMode = 'register', accAsked = false, accBusy = false;
const cloudOf = () => (state && state.status.cloud) || { enabled: false };
const sentAgo = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `at ${clock(ts)}`; };
function accError(text) { const e = $('account-error'); e.textContent = text || ''; e.hidden = !text; }
function accView() {
  const c = cloudOf();
  accForm.hidden = c.signedIn; $('account-me').hidden = !c.signedIn;
  if (c.signedIn) {
    $('account-name').textContent = c.name;
    $('account-status').textContent = c.error ? `Uploading stopped: ${c.error} It is tried again by itself.`
      : c.busy ? `Uploading${c.waiting ? `, ${c.waiting} ${c.waiting === 1 ? 'session' : 'sessions'} to go` : ''}…`
      : c.waiting ? `${c.waiting} ${c.waiting === 1 ? 'session is' : 'sessions are'} waiting to go up.`
      : `Everything you finished is uploaded${c.sentAt ? ` (last one ${sentAgo(c.sentAt)})` : ''}. A session goes up when you press "Start new session".`;
    return;
  }
  const reg = accMode === 'register';
  $('account-title').textContent = reg ? 'Create your account' : 'Log in';
  $('account-lead').textContent = reg ? 'Pick the name other players will see your map runs under.' : 'Use the name and password you registered with.';
  $('account-again').hidden = !reg;
  accForm.elements.again.required = reg;
  accForm.elements.password.autocomplete = reg ? 'new-password' : 'current-password';
  $('account-go').textContent = accBusy ? 'One moment…' : (reg ? 'Create account' : 'Log in');
  $('account-go').disabled = accBusy;
  $('account-switch').textContent = reg ? 'I already have an account' : 'I need an account';
}
function renderAccount() {
  const c = cloudOf();
  $('btn-account').hidden = !c.enabled;
  if (!c.enabled) return;
  $('account-label').textContent = c.signedIn ? c.name : 'Log in';
  $('account-dot').hidden = !(c.signedIn && c.error);
  if (acc.open) accView();
  else if (!c.signedIn && !accAsked) { accAsked = true; accMode = 'register'; accError(''); accView(); acc.showModal(); }
}
$('btn-account').addEventListener('click', () => { accError(''); accView(); acc.showModal(); });
$('account-later').addEventListener('click', () => acc.close());
$('account-close').addEventListener('click', () => acc.close());
$('account-switch').addEventListener('click', () => { accMode = accMode === 'register' ? 'login' : 'register'; accError(''); accView(); });
accForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (accBusy) return;
  const el = accForm.elements;
  accBusy = true; accError(''); accView();
  const r = await api.account({ type: accMode, name: el.name.value, password: el.password.value, again: el.again.value });
  accBusy = false;
  if (r.error) { accError(r.error); accView(); return; }
  el.password.value = ''; el.again.value = '';
  accView();
});
$('account-logout').addEventListener('click', async () => { accAsked = true; accMode = 'login'; await api.account({ type: 'logout' }); accView(); });
$('account-sync').addEventListener('click', () => api.account({ type: 'sync' }));
$('account-delete-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = $('account-delete-error');
  const r = await api.account({ type: 'delete', password: f.elements.password.value });
  f.elements.password.value = '';
  err.textContent = r.error || ''; err.hidden = !r.error;
  if (!r.error) { f.parentElement.open = false; accMode = 'register'; accView(); }
});

setInterval(() => TradeCard.tick($('trade-offers')), 1000);
