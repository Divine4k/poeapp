'use strict';
// Troubleshooting page: record, watch a recording with what happened beside it, write a note, send.
// Only for admins and moderators (state.trouble.can). See src/troubleshoot.js for what is kept.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

let trList = [];        // the saved recordings, newest first
let trListRev = -1;     // state.trouble.rev the list was read at
let trSel = null;       // id of the recording shown
let trDetail = null;    // its facts and events
let trVideoUrl = null;
let trShown = [];       // the events in the list right now, after the filter
const trKinds = { input: true, game: true, app: true };
const trGroup = (k) => (k === 'key' || k === 'mouse' || k === 'wheel' ? 'input' : k === 'log' ? 'game' : 'app');
let noteTimer = null;

const trClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const trSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const trWhen = (ts) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// What one event says, in a line. The same wording as the README that goes up with it.
function trText(e) {
  const { t, kind, ...r } = e;
  if (kind === 'key') return `${r.dir === 'up' ? 'Released' : 'Pressed'} ${r.key}${r.by === 'app' ? ' (sent by the app)' : ''}`;
  if (kind === 'mouse') return `${r.dir === 'up' ? 'Released' : 'Clicked'} ${r.button} at ${r.x}, ${r.y}`;
  if (kind === 'wheel') return `Wheel ${r.amount} at ${r.x}, ${r.y}`;
  if (kind === 'log') return String(r.line || '').replace(/^\S+ \S+ \d+ \S+ /, '');
  if (kind === 'notice') return r.text;
  if (kind === 'hotkey') return `App key ${r.key} (${r.job})`;
  if (kind === 'action') { const { type, ...rest } = r; return `Pressed in the app: ${type}${Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ''}`; }
  if (kind === 'chat') return `Typed in game: ${r.text}`;
  if (kind === 'toast') return `Shown over the game: ${r.message && typeof r.message === 'object' ? [r.message.title, r.message.text].filter(Boolean).join(' – ') || JSON.stringify(r.message) : r.message}`;
  if (kind === 'front') return `Window in front: ${r.name || (r.game ? 'the game' : 'another program')}`;
  if (kind === 'state') return `State: ${Object.entries(r).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('; ')}`;
  if (kind === 'console') return `${r.level}: ${r.text}`;
  if (kind === 'start') return `Recording started${r.video ? ` (video: ${r.video})` : ''}`;
  if (kind === 'stop') return 'Recording stopped';
  if (kind === 'setting') return `Setting changed: ${JSON.stringify(r)}`;
  if (kind === 'account') return `Account: ${r.type}${r.error ? ` (${r.error})` : ''}`;
  return `${kind} ${JSON.stringify(r)}`;
}

function renderTrouble() {
  const tr = state.trouble;
  const can = !!(tr && (tr.can || tr.recording));
  $('nav-trouble').hidden = !can;
  // Blinking while recording; a still dot when other people's recordings came in unopened.
  $('trouble-dot').hidden = !(tr && (tr.recording || tr.unseen));
  $('trouble-dot').classList.toggle('rec', !!(tr && tr.recording));
  $('trouble-dot').title = tr && !tr.recording && tr.unseen ? `${tr.unseen} new recording${tr.unseen === 1 ? '' : 's'}` : '';
  if (!can && !$('tab-trouble').hidden) showTab('mapping');
  if (!tr || $('tab-trouble').hidden) return;
  for (const el of $('tab-trouble').querySelectorAll('[data-keyname]')) el.textContent = keyText(getPath(state.config, el.dataset.keyname));
  const rec = tr.recording;
  $('tr-rec').classList.toggle('on', rec);
  $('tr-reclabel').textContent = tr.busy === 'starting' ? 'Starting…' : tr.busy === 'stopping' ? 'Saving…' : rec ? 'Stop' : 'Record';
  $('tr-recbtn').disabled = !!tr.busy;
  const key = state.config.hotkeys.record;
  $('tr-rechint').textContent = rec
    ? `${tr.video ? 'Screen, keys and the app' : 'Keys and the app (not the screen)'}. Stops by itself after ${Math.round(tr.maxMs / 60000)} minutes.`
    : `Or press ${key ? Keys.pretty(key) : 'the record key (set it in Settings, Keys)'} in game, and again to stop.`;
  trTick();
  $('tr-remote-error').hidden = !tr.remoteError;
  $('tr-remote-error').textContent = tr.remoteError ? `Could not look for other people's recordings: ${tr.remoteError}` : '';
  if (tr.rev !== trListRev) { trListRev = tr.rev; trLoadList(); }
  trSendLine();
}
function trTick() {
  const tr = state && state.trouble;
  $('tr-rectime').textContent = tr && tr.recording && tr.startedAt ? trClock(Date.now() - tr.startedAt) : '';
}
setInterval(() => { if (!$('tab-trouble').hidden) trTick(); }, 500);

async function trLoadList() {
  trList = await api.troubleList();
  setHtml($('tr-list'), trList.length ? trList.map((r) => {
    const first = (r.note || '').trim().split('\n')[0];
    // Fixed wins over everything; then new (someone else's, not opened yet); then sent.
    const tag = r.fixed ? '<span class="tag good">Fixed</span>' : r.remote ? (r.seen ? '' : '<span class="tag warn">New</span>') : r.sent ? '<span class="tag">Sent</span>' : '';
    const what = r.kind === 'note' ? `report${r.images ? `, ${r.images} picture${r.images === 1 ? '' : 's'}` : ''}` : `${trClock(r.endedAt - r.startedAt)}${r.videoBytes ? `, ${trSize(r.videoBytes)}` : ', no video'}`;
    return `<li><button type="button" class="tr-item${r.id === trSel ? ' on' : ''}${r.remote && !r.seen ? ' new' : ''}${r.fixed ? ' fixed' : ''}" data-rec="${esc(r.id)}">
      <span class="tr-item-top"><b>${esc(trWhen(r.startedAt))}</b><span class="dim">${r.remote ? `${esc(r.by || 'someone')} · ` : ''}${esc(what)}</span>${tag}</span>
      <span class="tr-item-note${first ? '' : ' dim'}">${esc(first || 'No note yet')}</span></button></li>`;
  }).join('') : '<li class="empty">Nothing yet. Press Record and show the problem in game, or write a report.</li>');
  if (trSel && !trList.some((r) => r.id === trSel)) trOpen(null);
  else if (trSel && trDetail) { const m = trList.find((r) => r.id === trSel); trDetail.sent = m.sent; trDetail.fixed = m.fixed; trSendLine(); }
}

async function trOpen(id) {
  trSel = id;
  for (const b of document.querySelectorAll('#tr-list .tr-item')) b.classList.toggle('on', b.dataset.rec === id);
  const v = $('tr-video');
  v.pause(); v.removeAttribute('src'); v.load();
  if (trVideoUrl) { URL.revokeObjectURL(trVideoUrl); trVideoUrl = null; }
  $('tr-none').hidden = !!id; $('tr-detail').hidden = !id;
  if (!id) { trDetail = null; return; }
  trDetail = await api.troubleDetails(id);
  if (!trDetail || trSel !== id) return;
  const d = trDetail;
  const note = d.kind === 'note';
  $('tr-title').textContent = `${note ? 'Report' : 'Recording'} of ${trWhen(d.startedAt)}`;
  $('tr-facts').textContent = note
    ? [d.by ? `by ${d.by}` : 'not logged in', `${(d.images || []).length} picture${(d.images || []).length === 1 ? '' : 's'}`].join(' · ')
    : [`${trClock(d.endedAt - d.startedAt)} long`, d.by ? `by ${d.by}` : 'not logged in', `${(d.events || []).length} events`, d.video ? `video ${d.video.width}x${d.video.height}, ${trSize(d.video.bytes)}` : null].filter(Boolean).join(' · ');
  $('tr-note').value = d.note || '';
  // A written report has no video and no timeline, but pictures.
  for (const el of ['tr-events-head', 'tr-events-hint', 'tr-events']) $(el).hidden = note;
  $('tr-pics').hidden = !note;
  $('tr-note-hint').textContent = note ? 'What you did, what the app did, and what you expected instead. Screenshots help.' : 'What you did, what the app did, and what you expected instead. Times from the video help.';
  $('tr-novideo').hidden = note || !!d.video;
  $('tr-novideo').textContent = note || d.video ? '' : `There is no video in this one${d.videoProblem ? `: ${String(d.videoProblem).replace(/\.$/, '')}` : ''}. The keys and what the app did are below.`;
  v.hidden = note || !d.video;
  if (note) trPics(); else trEvents();
  trSendLine();
  if (!note && d.video) {
    // One from someone else is fetched from GitHub the first time; that can take a moment.
    $('tr-novideo').hidden = false;
    $('tr-novideo').textContent = d.remote ? 'Fetching the video from GitHub…' : '';
    const bytes = await api.troubleVideo(id);
    if (trSel !== id) return;
    if (!bytes) { $('tr-novideo').textContent = 'The video could not be fetched. Open it on GitHub instead.'; return; }
    $('tr-novideo').hidden = true;
    trVideoUrl = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
    v.src = trVideoUrl;
  }
}

// A video recorded in pieces does not say how long it is, so the player cannot seek until it
// has been to the end once. It is sent there and back as soon as it loads.
$('tr-video').addEventListener('loadedmetadata', () => {
  const v = $('tr-video');
  if (v.duration !== Infinity) return;
  const back = () => { v.removeEventListener('durationchange', back); v.currentTime = 0; };
  v.addEventListener('durationchange', back);
  v.currentTime = 1e101;
});
// The line for what the video shows right now is marked as it plays.
$('tr-video').addEventListener('timeupdate', () => {
  const ms = $('tr-video').currentTime * 1000;
  let at = -1;
  for (let i = 0; i < trShown.length && trShown[i].t <= ms; i++) at = i;
  const box = $('tr-events');
  const was = box.querySelector('.now');
  if (was && Number(was.dataset.i) === at) return;
  if (was) was.classList.remove('now');
  const li = at >= 0 ? box.querySelector(`[data-i="${at}"]`) : null;
  if (li) li.classList.add('now');
});

const TR_MAX_ROWS = 3000;
function trEvents() {
  if (!trDetail) return;
  trShown = (trDetail.events || []).filter((e) => trKinds[trGroup(e.kind)]);
  const rows = trShown.slice(0, TR_MAX_ROWS);
  $('tr-events').innerHTML = rows.length
    ? rows.map((e, i) => `<li data-i="${i}" data-t="${e.t}" class="k-${trGroup(e.kind)}${e.bad ? ' bad' : ''}"><time>${trClock(e.t)}</time><span class="kind">${esc(e.kind)}</span><span class="txt">${esc(trText(e))}</span></li>`).join('')
      + (trShown.length > rows.length ? `<li class="empty">${trShown.length - rows.length} more lines are in the file that is sent.</li>` : '')
    : '<li class="empty">Nothing of this kind was recorded.</li>';
}

function trSendLine() {
  if (!trDetail || !state.trouble) return;
  // Fixed or not: shared with everyone, for what is on GitHub.
  const f = trDetail.fixed;
  $('tr-fixed').hidden = !f;
  $('tr-fixed').textContent = f ? `Fixed${f.by ? ` (marked by ${f.by}${f.at ? `, ${trWhen(f.at)}` : ''})` : ''}.` : '';
  $('tr-fixbtn').hidden = !(trDetail.remote || trDetail.sent);
  // While GitHub takes the change the button waits; a second click would only queue up.
  const busy = (state.trouble.marking || []).includes(trSel);
  $('tr-fixbtn').disabled = busy;
  $('tr-fixbtn').textContent = busy ? 'Marking…' : f ? 'Not fixed after all' : 'Mark as fixed';
  // Someone else's recording: read only, already on GitHub.
  const remote = !!trDetail.remote;
  $('tr-sendbtn').hidden = remote;
  $('tr-note').readOnly = remote;
  $('tr-picadd').hidden = remote;
  $('tr-delete').textContent = remote ? 'Remove from this list' : 'Delete';
  if (remote) {
    $('tr-sendinfo').innerHTML = `Sent by ${esc(trDetail.by || 'someone')}${trDetail.sent && trDetail.sent.at ? ` ${esc(trWhen(trDetail.sent.at))}` : ''}. <a href="${esc(trDetail.sent ? trDetail.sent.url : '')}" target="_blank" rel="noreferrer">Open on GitHub</a>`;
    return;
  }
  const s = state.trouble.sending;
  const mine = s && s.id === trSel;
  $('tr-sendbtn').disabled = !!s;
  $('tr-sendbtn').textContent = mine ? 'Sending…' : trDetail.sent ? 'Send again' : 'Send';
  const info = $('tr-sendinfo');
  if (mine) info.textContent = `${s.step}…`;
  else if (trDetail.sent) info.innerHTML = `Sent ${esc(trWhen(trDetail.sent.at))}. <a href="${esc(trDetail.sent.url)}" target="_blank" rel="noreferrer">Open on GitHub</a>`;
  else info.textContent = !state.status.cloud.signedIn ? 'Log in to send.' : trDetail.kind === 'note' ? 'Goes to the reports repository on GitHub, with the pictures.' : 'Goes to the reports repository on GitHub, with the video and everything below.';
}

// ---- written reports: pictures ----
const trPicUrls = [];
async function trPics() {
  const d = trDetail;
  for (const u of trPicUrls.splice(0)) URL.revokeObjectURL(u);
  const id = d.id;
  const cells = [];
  for (const name of d.images || []) {
    const bytes = await api.troubleImage(id, name);
    if (trSel !== id) return;
    if (!bytes) continue;
    const ext = name.split('.').pop();
    const url = URL.createObjectURL(new Blob([bytes], { type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` }));
    trPicUrls.push(url);
    cells.push(`<figure class="tr-pic"><a href="#" data-pic="${esc(url)}" title="Open full size"><img src="${esc(url)}" alt="${esc(name)}"></a>${d.remote ? '' : `<button type="button" class="link" data-unpic="${esc(name)}">Remove</button>`}</figure>`);
  }
  $('tr-picgrid').innerHTML = cells.join('') || '<p class="dim">No pictures yet.</p>';
}
// Adds picture files (from the picker or pasted), then shows the report again.
async function trAddPics(files) {
  if (!trDetail || trDetail.remote || trDetail.kind !== 'note') return;
  const id = trDetail.id;
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue;
    const err = await api.troubleAddImage(id, new Uint8Array(await f.arrayBuffer()), f.type);
    if (err) { window.alert(err); break; }
  }
  if (trSel === id) trOpen(id);
}
$('tr-picbtn').addEventListener('click', () => $('tr-picfile').click());
$('tr-picfile').addEventListener('change', (e) => { trAddPics([...e.target.files]); e.target.value = ''; });
// A screenshot pasted anywhere on the page while a written report is open goes into it.
document.addEventListener('paste', (e) => {
  if ($('tab-trouble').hidden || !trDetail || trDetail.kind !== 'note' || trDetail.remote) return;
  const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => /^image\//.test(f.type));
  if (!files.length) return;
  e.preventDefault();
  trAddPics(files);
});
$('tr-picgrid').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-unpic]');
  if (rm) { act({ type: 'troubleImageRemove', id: trSel, name: rm.dataset.unpic }).then(() => trOpen(trSel)); return; }
  const a = e.target.closest('[data-pic]');
  if (a) { e.preventDefault(); trBig(a.dataset.pic); }
});
// Full size, over the page; a click closes it.
function trBig(url) {
  const dlg = document.createElement('dialog');
  dlg.className = 'tr-bigpic';
  dlg.innerHTML = `<img src="${esc(url)}" alt="Picture">`;
  dlg.addEventListener('click', () => { dlg.close(); dlg.remove(); });
  document.body.appendChild(dlg);
  dlg.showModal();
}

$('tr-write').addEventListener('click', async () => {
  const id = await api.troubleNew();
  if (!id) return;
  trListRev = -1;
  await trLoadList();
  await trOpen(id);
  $('tr-note').focus();
});
$('tr-refresh').addEventListener('click', () => act({ type: 'troubleSync' }));
$('tr-fixbtn').addEventListener('click', () => {
  if (!trSel || !trDetail) return;
  act({ type: 'troubleFixed', id: trSel, fixed: !trDetail.fixed });
});

$('tr-list').addEventListener('click', (e) => { const b = e.target.closest('[data-rec]'); if (b) trOpen(b.dataset.rec); });
$('tr-events').addEventListener('click', (e) => {
  const li = e.target.closest('[data-t]');
  const v = $('tr-video');
  if (!li || v.hidden || !v.src) return;
  v.currentTime = Math.max(0, Number(li.dataset.t) / 1000 - 1); // a moment before, to see it happen
});
$('tr-filter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kinds]');
  if (!b) return;
  trKinds[b.dataset.kinds] = !trKinds[b.dataset.kinds];
  b.setAttribute('aria-pressed', String(trKinds[b.dataset.kinds]));
  trEvents();
});
$('tr-note').addEventListener('input', () => {
  clearTimeout(noteTimer);
  const id = trSel, note = $('tr-note').value;
  noteTimer = setTimeout(() => act({ type: 'troubleNote', id, note }), 600);
});
$('tr-sendbtn').addEventListener('click', () => {
  if (!trSel) return;
  clearTimeout(noteTimer);
  act({ type: 'troubleSend', id: trSel, note: $('tr-note').value });
});
$('tr-delete').addEventListener('click', () => {
  const remote = trDetail && trDetail.remote;
  if (!trSel || !window.confirm(remote ? 'Remove this recording from your list? It stays on GitHub.' : 'Delete this recording from this PC? What was already sent stays on GitHub.')) return;
  act({ type: 'troubleRemove', id: trSel });
});

// Called when the page is opened.
// Also looks on GitHub right away for recordings sent since the last look.
function troubleShown() { trListRev = -1; renderTrouble(); if (state.trouble && state.trouble.can) act({ type: 'troubleSync', quiet: true }); }
