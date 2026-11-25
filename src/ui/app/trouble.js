'use strict';
// Troubleshooting page: record, watch a recording with what happened beside it, write a note, send.
// Only for admins and moderators (state.trouble.can). See src/troubleshoot.js for what is kept.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

let trList = [];        // the saved recordings, newest first
let trListRev = -1;     // state.trouble.rev the list was read at
let trSel = null;       // id of the recording shown
let trDetail = null;    // its facts and events
let trVideoUrl = null;
let trShown = [];       // the rows in the list right now, after the filter
const trKinds = { input: true, game: true, app: true };
let noteTimer = null;

const trClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// Where one stands; Fixed reads Done for a suggestion.
const TR_STATES = ['', 'planned', 'in progress', 'fixed', 'wontfix'];
const trStateName = (st, type) => ({ planned: 'Planned', 'in progress': 'In progress', fixed: type === 'suggestion' ? 'Done' : 'Fixed', wontfix: "Won't do" }[st] || 'Open');
const trSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const trWhen = (ts) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });


function renderTrouble() {
  const tr = state.trouble;
  const can = !!(tr && (tr.can || tr.recording));
  $('nav-dev').hidden = !can && !(state.trouble && state.trouble.admin);
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
    // A suggestion says so; then where it stands, or else new (someone else's, not opened) or sent.
    const kind = r.type === 'suggestion' ? '<span class="tag sug">Suggestion</span>' : '';
    const tag = kind + (r.state ? `<span class="tag st-${r.state.replace(' ', '-')}">${esc(trStateName(r.state, r.type))}</span>` : r.remote ? (r.seen ? '' : '<span class="tag warn">New</span>') : r.sent ? '<span class="tag">Sent</span>' : '');
    const what = r.kind === 'note' ? `report${r.images ? `, ${r.images} picture${r.images === 1 ? '' : 's'}` : ''}` : `${trClock(r.endedAt - r.startedAt)}${r.videoBytes ? `, ${trSize(r.videoBytes)}` : ', no video'}`;
    return `<li><button type="button" class="tr-item${r.id === trSel ? ' on' : ''}${r.remote && !r.seen ? ' new' : ''}${r.state === 'fixed' || r.state === 'wontfix' ? ' fixed' : ''}" data-rec="${esc(r.id)}">
      <span class="tr-item-top"><b>${esc(trWhen(r.startedAt))}</b><span class="dim tr-item-what">${r.remote ? `${esc(r.by || 'someone')} · ` : ''}${esc(what)}</span></span>
      <span class="tr-item-note${first ? '' : ' dim'}">${esc(first || 'No note yet')}</span>${tag ? `<span class="tr-item-tags">${tag}</span>` : ''}</button></li>`;
  }).join('') : '<li class="empty">Nothing yet. Press Record and show the problem in game, or write a report.</li>');
  if (trSel && !trList.some((r) => r.id === trSel)) trOpen(null);
  else if (trSel && trDetail) { const m = trList.find((r) => r.id === trSel); Object.assign(trDetail, { sent: m.sent, state: m.state, type: m.type, issue: m.issue, statusBy: m.statusBy, statusAt: m.statusAt }); trSendLine(); }
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
  for (const el of ['tr-events-head', 'tr-events-hint', 'tr-events', 'tr-strip']) $(el).hidden = note;
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
    trVideoUrl = URL.createObjectURL(new Blob([bytes], { type: String(d.video.mime || 'video/webm').split(';')[0] }));
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
// ---- what happened: a strip over time and a short list, both following the video ----
const TR_MAX_ROWS = 2000;
let trEvery = false;   // Everything: every event on its own line instead of the summary
let trOpenGroups = new Set();
// Minutes, seconds and milliseconds: keys come a few ms apart, so the ms matter.
const trExact = (ms) => { const w = Math.max(0, Math.floor(ms)); const s = Math.floor(w / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(w % 1000).padStart(3, '0')}`; };

function trEvents() {
  if (!trDetail) return;
  const all = trDetail.events || [];
  if (trEvery) {
    trShown = all.filter((e) => trKinds[Recording.laneOf(e.kind)]).map((e) => ({ t: e.t, end: e.t, lane: Recording.laneOf(e.kind), kind: e.kind, text: Recording.eventText(e), bad: !!e.bad }));
  } else {
    const { rows, quiet } = Recording.summarise(all);
    trShown = rows.filter((r) => trKinds[r.lane]);
    trShown.quiet = quiet;
  }
  const rows = trShown.slice(0, TR_MAX_ROWS);
  const row = (r, i) => {
    const open = r.items && trOpenGroups.has(r.t);
    const count = r.items ? `<button type="button" class="tr-count" data-open="${r.t}" aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} each one">${r.items.length}</button>` : '';
    const sub = open ? `<ol class="tr-sub">${r.items.map((it) => `<li data-t="${it.t}"><time>${trExact(it.t)}</time><span class="txt">${esc(it.text)}</span></li>`).join('')}</ol>` : '';
    return `<li data-i="${i}" data-t="${r.t}" class="ln-${r.lane}${r.bad ? ' bad' : ''}"><time>${trExact(r.t)}</time><i class="tr-lane" aria-hidden="true"></i><span class="txt">${esc(r.text)}</span>${count}${sub}</li>`;
  };
  $('tr-events').innerHTML = rows.length
    ? rows.map(row).join('')
      + (trShown.length > rows.length ? `<li class="empty">${trShown.length - rows.length} more lines are in the file that is sent.</li>` : '')
      + (trShown.quiet ? `<li class="empty">${trShown.quiet} game log and console lines left out. Everything shows them.</li>` : '')
    : '<li class="empty">Nothing of this kind was recorded.</li>';
  trNow(true);
  trStrip();
}

// The strip: three lanes (keys and clicks, game, app), a mark per event, and where the video is.
function trStrip() {
  const c = $('tr-strip');
  if (c.hidden || !trDetail) return;
  const w = c.clientWidth;
  if (!w) return;
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(54 * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, 54);
  const css = getComputedStyle(document.documentElement);
  const col = (v, fb) => (css.getPropertyValue(v).trim() || fb);
  const lanes = { input: [6, col('--portal', '#62afd0')], game: [22, col('--moss', '#86bb72')], app: [38, col('--gold', '#d1ad62')] };
  const v = $('tr-video');
  const span = Math.max(1, (v.duration && Number.isFinite(v.duration) ? v.duration * 1000 : 0), trDetail.endedAt - trDetail.startedAt, ...(trDetail.events || []).map((e) => e.t));
  g.fillStyle = col('--seam', '#353e49');
  for (const [y] of Object.values(lanes)) g.fillRect(0, y + 4, w, 1);
  for (const e of trDetail.events || []) {
    const lane = Recording.laneOf(e.kind);
    if (!trKinds[lane] || (e.dir === 'up')) continue;
    const [y, colour] = lanes[lane];
    g.fillStyle = e.bad ? col('--blood', '#e0655a') : colour;
    g.fillRect(Math.round((e.t / span) * (w - 2)), y, 2, 10);
  }
  if (v.src && !v.hidden) {
    g.fillStyle = col('--bone', '#e9e2d3');
    g.fillRect(Math.round((v.currentTime * 1000 / span) * (w - 2)), 0, 2, 54);
  }
  c.dataset.span = span;
}
$('tr-strip').addEventListener('click', (e) => {
  const v = $('tr-video');
  const c = e.currentTarget;
  if (!v.src || v.hidden) return;
  v.currentTime = Math.max(0, (e.offsetX / c.clientWidth) * Number(c.dataset.span || 0) / 1000);
});
window.addEventListener('resize', () => { if (!$('tab-trouble').hidden) trStrip(); });

// The line for what the video shows now is marked, and kept in view while it plays.
function trNow(force) {
  const v = $('tr-video');
  if (!trShown.length || !v.src) return;
  const ms = v.currentTime * 1000;
  let lo = 0, hi = Math.min(trShown.length, TR_MAX_ROWS) - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (trShown[mid].t <= ms) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  const box = $('tr-events');
  const was = box.querySelector(':scope > .now');
  if (!force && was && Number(was.dataset.i) === at) return;
  if (was) was.classList.remove('now');
  const li = at >= 0 ? box.querySelector(`:scope > [data-i="${at}"]`) : null;
  if (!li) return;
  li.classList.add('now');
  if (!v.paused) {
    const top = li.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - li.offsetHeight) box.scrollTop = top - box.clientHeight / 3;
  }
}
// Smooth while playing: once a frame, not only on the video's few timeupdate calls a second.
let trRaf = 0;
function trFollow() {
  // Off this page or with the window hidden, the video stops and so does this loop.
  if ($('tab-trouble').hidden || document.hidden) { $('tr-video').pause(); trRaf = 0; return; }
  trNow(false); trStrip();
  trRaf = $('tr-video').paused ? 0 : requestAnimationFrame(trFollow);
}
$('tr-video').addEventListener('play', () => { if (!trRaf) trRaf = requestAnimationFrame(trFollow); });
$('tr-video').addEventListener('seeked', () => { trNow(true); trStrip(); });
$('tr-video').addEventListener('loadedmetadata', () => trStrip());

function trSendLine() {
  if (!trDetail || !state.trouble) return;
  // Where it stands and what it is: shared with everyone, for what is on GitHub. Before sending
  // only the type can be chosen (the buttons above the note).
  const onGithub = !!(trDetail.remote || trDetail.sent);
  const busy = (state.trouble.marking || []).includes(trSel);
  const type = trDetail.type || 'problem';
  $('tr-state-box').hidden = !onGithub;
  $('tr-type-box').hidden = !onGithub;
  $('tr-kind').hidden = onGithub;
  for (const b of $('tr-kind').querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b.dataset.kind === type));
  setHtml($('tr-state'), TR_STATES.map((st) => `<option value="${st}"${st === (trDetail.state || '') ? ' selected' : ''}>${esc(st ? trStateName(st, type) : 'Open')}</option>`).join(''));
  $('tr-state').value = trDetail.state || '';
  $('tr-type').value = type;
  $('tr-state').disabled = busy; $('tr-type').disabled = busy;
  $('tr-fixed').hidden = !trDetail.state && !busy;
  $('tr-fixed').className = `tr-fixed st-${(trDetail.state || '').replace(' ', '-')}`;
  $('tr-fixed').textContent = busy ? 'Saving…' : trDetail.state ? `${trStateName(trDetail.state, type)}${trDetail.statusBy && trDetail.statusAt ? ` (set by ${trDetail.statusBy}, ${trWhen(trDetail.statusAt)})` : ''}.` : '';
  // The tracker (admins): connect it to a box, or show the box it is in.
  const admin = !!state.trouble.admin;
  const canTrack = admin && onGithub && trDetail.sent && !trDetail.issue;
  $('tr-trackbtn').hidden = !canTrack;
  $('tr-planbtn').hidden = !canTrack;
  $('tr-tracked').hidden = !trDetail.issue;
  $('tr-tracklink').textContent = trDetail.issue ? `#${trDetail.issue}` : '';
  $('tr-untrack').hidden = !admin;
  const sug = type === 'suggestion';
  $('tr-note-title').textContent = sug ? 'What is the idea?' : 'What went wrong?';
  $('tr-note-hint').textContent = sug ? 'What it should do, and why it would help. Pictures or a video help.'
    : trDetail.kind === 'note' ? 'What you did, what the app did, and what you expected instead. Screenshots help.'
      : 'What you did, what the app did, and what you expected instead. Times from the video help.';
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
$('tr-state').addEventListener('change', (e) => { if (trSel) act({ type: 'troubleStatus', id: trSel, state: e.target.value }); });
$('tr-type').addEventListener('change', (e) => { if (trSel) act({ type: 'troubleStatus', id: trSel, kind: e.target.value }); });
$('tr-kind').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]');
  if (!b || !trDetail) return;
  trDetail.type = b.dataset.kind;
  trSendLine();
  act({ type: 'troubleType', id: trSel, kind: b.dataset.kind });
});

$('tr-list').addEventListener('click', (e) => { const b = e.target.closest('[data-rec]'); if (b) trOpen(b.dataset.rec); });
$('tr-events').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) {
    const t = Number(open.dataset.open);
    if (trOpenGroups.has(t)) trOpenGroups.delete(t); else trOpenGroups.add(t);
    trEvents();
    return;
  }
  const li = e.target.closest('[data-t]');
  const v = $('tr-video');
  if (!li || v.hidden || !v.src) return;
  v.currentTime = Math.max(0, Number(li.dataset.t) / 1000 - 0.5); // half a second before, to see it happen
});
$('tr-every').addEventListener('click', (e) => {
  trEvery = !trEvery;
  e.currentTarget.setAttribute('aria-pressed', String(trEvery));
  trEvents();
});
$('tr-filter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kinds]');
  if (b) trOpenGroups = new Set();
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

// ---- putting a recording in the tracker (admins) ----
let trBoxes = [];
let trBoxPick = null; // the box chosen in the dialog; 'root' = straight under the app
function trBoxesDraw() {
  const make = $('tr-trackform').elements.how.value === 'make';
  const q = $('tr-trackfind').value.trim().toLowerCase();
  const byNo = new Map(trBoxes.map((i) => [i.number, i]));
  // Each box with the path above it, so two boxes with the same name can be told apart.
  const path = (i) => { const out = []; let p = i.parent, n = 0; while (p != null && byNo.has(p) && n++ < 8) { out.unshift(byNo.get(p).title); p = byNo.get(p).parent; } return out.join(' › '); };
  const open = trBoxes.filter((i) => i.status !== 'done' && i.status !== 'dropped')
    .filter((i) => !q || `#${i.number} ${i.title}`.toLowerCase().includes(q)).slice(0, 200);
  const rows = (make ? [{ number: 'root', title: 'Straight under the app' }] : []).concat(open);
  if (trBoxPick != null && !rows.some((r) => String(r.number) === String(trBoxPick))) trBoxPick = null;
  setHtml($('tr-trackboxes'), rows.length ? rows.map((i) => {
    const p = i.number === 'root' ? '' : path(i);
    return `<li><label class="tr-trackbox${String(trBoxPick) === String(i.number) ? ' on' : ''}"><input type="radio" name="box" value="${i.number}"${String(trBoxPick) === String(i.number) ? ' checked' : ''}>
      <span><b>${i.number === 'root' ? '' : `#${i.number} `}${esc(i.title)}</b>${p ? `<small class="dim">${esc(p)}</small>` : ''}</span></label></li>`;
  }).join('') : '<li class="empty">No box by that name.</li>');
  $('tr-trackok').disabled = trBoxPick == null;
  $('tr-tracktitle').hidden = !make;
  $('tr-trackstatus').hidden = !make;
}
// Make into plan: a new box for it, under the box chosen. Attach: to a box that is there.
async function trTrackOpen(make) {
  if (!trDetail) return;
  const f = $('tr-trackform');
  f.elements.how.value = make ? 'make' : 'attach';
  f.elements.title.value = String(trDetail.note || '').trim().split('\n')[0].slice(0, 120);
  f.elements.status.value = trDetail.type === 'suggestion' ? 'idea' : 'todo';
  $('tr-trackhead').textContent = make ? 'Make into plan' : 'Attach to a box';
  $('tr-tracklead').textContent = make
    ? 'A new box in the tracker, with the note as its text and a link to this recording. Choose the box it goes under.'
    : 'A link to this recording goes into the box you choose, and the box shows it.';
  $('tr-trackunder').textContent = make ? 'Under which box?' : 'Which box?';
  $('tr-trackok').textContent = make ? 'Make the box' : 'Attach';
  $('tr-trackfind').value = '';
  trBoxPick = make ? 'root' : null;
  $('tr-trackerr').hidden = true;
  setHtml($('tr-trackboxes'), '<li class="empty">Loading the tracker…</li>');
  $('tr-trackok').disabled = true;
  $('tr-trackdlg').showModal();
  const r = await api.tracker({ type: 'list' });
  if (r.error) { $('tr-trackerr').textContent = r.error; $('tr-trackerr').hidden = false; setHtml($('tr-trackboxes'), ''); return; }
  trBoxes = r.items || [];
  trBoxesDraw();
}
$('tr-planbtn').addEventListener('click', () => trTrackOpen(true));
$('tr-trackbtn').addEventListener('click', () => trTrackOpen(false));
$('tr-trackform').addEventListener('change', (e) => {
  if (e.target.name === 'box') trBoxPick = e.target.value;
  trBoxesDraw();
});
$('tr-trackfind').addEventListener('input', trBoxesDraw);
$('tr-trackcancel').addEventListener('click', () => $('tr-trackdlg').close());
$('tr-trackform').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!trSel || trBoxPick == null) return;
  const f = e.currentTarget;
  const make = f.elements.how.value === 'make';
  act(make
    ? { type: 'troubleTrack', id: trSel, make: true, title: f.elements.title.value, status: f.elements.status.value, parent: trBoxPick === 'root' ? null : Number(trBoxPick) }
    : { type: 'troubleTrack', id: trSel, issue: Number(trBoxPick) });
  $('tr-trackdlg').close();
});
$('tr-untrack').addEventListener('click', () => {
  if (trSel && window.confirm('Take this recording out of its box in the tracker? The box stays.')) act({ type: 'troubleUntrack', id: trSel });
});
// The box it is in: the tracker opens on it.
$('tr-tracklink').addEventListener('click', (e) => {
  e.preventDefault();
  if (trDetail && trDetail.issue) trackerOpenItem(trDetail.issue);
});
