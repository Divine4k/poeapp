'use strict';
// Troubleshooting recordings: one key (or the button on the Troubleshooting page) starts one,
// the same key stops it. While it runs, the game's screen goes to a video and everything else
// goes to a list: each key and click, each line the game writes to its log, and what the app
// does (its messages, the buttons pressed in it, settings changed, keys it acted on, chat lines
// it typed, what its state became). At the start and the end the app's whole state and an
// inventory report are kept as well. Afterwards the recording can be watched on the
// Troubleshooting page, given a note, and sent to the reports repository on GitHub.
//
// Each recording is a folder under recordings/ in the app's own folder:
//   meta.json  video.webm  events.json.gz  state-start.json.gz  state-end.json.gz
//   inventory-start.json.gz  inventory-end.json.gz
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Trace, keyNames, keyLabel, buttonName, stateBrief, briefChanges, readme, recordingId, ID } = require('./core/recording');
const { uploadFolder, readFile, latestTree, readBlob } = require('./github');

const { performance } = require('perf_hooks');

const MAX_MS = 5 * 60 * 1000;      // at full HD and 60 frames that is about 300 MB at most
// A video goes to GitHub in parts. Each part is sent as base64 text (a third bigger) in one
// request, and GitHub refuses big requests long before its 100 MB file limit ("input too large",
// 422), so the parts are kept small.
const PART = 20 * 1024 * 1024;
// The PC's clock to a fraction of a millisecond, the same one the recorder window times the
// video's first frame with, so a key's time is its place in the video.
const clock = () => performance.timeOrigin + performance.now();
const SYNC_MAX = 20;          // recordings fetched in one go; the rest come with the next look
const STATES = ['', 'planned', 'in progress', 'fixed', 'wontfix'];
const STATE_NAMES = { planned: 'Planned', 'in progress': 'In progress', fixed: 'Fixed', wontfix: "Won't do" };
const TYPES = ['problem', 'suggestion'];
const MAX_IMAGES = 10;        // pictures in one written report
const MAX_IMAGE = 8 * 1024 * 1024;
const IMAGE = /^image-[0-9]{1,2}\.(png|jpg|gif|webp)$/;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

class Troubleshoot {
  // dir: where recordings are kept. recorder: a ScreenRecorder. displayId(): the game's screen.
  // snapshot(): { state, inventory } of the app right now (inventory may be null).
  // who(): { name, role }. version: of the app. cloud: for the GitHub settings. fetchImpl: the web.
  // changed(): the page should redraw. say(text, bad): a message for the person.
  constructor({ dir, recorder, displayId, snapshot, who, version, cloud, fetchImpl, changed = () => {}, say = () => {}, partBytes = PART }) {
    Object.assign(this, { dir, recorder, displayId, snapshot, who, version, cloud, fetchImpl, changed, say, partBytes });
    this.trace = new Trace({ now: clock });
    this.current = null; // { id, startedAt, folder, video, timer }
    this.busy = '';      // 'starting' | 'stopping' while that is going on
    this.sending = null; // { id, step }
    this.lastBrief = null;
    this.held = new Set();
    this.names = {};
    this.ownUntil = 0; // keys and clicks seen before this time were sent by the app itself
    this.syncing = false;
    this.fixed = {};   // where each one stands, from status/<id>.json: { id: { state, type, by, at, sha } }
    this.marksLoaded = false;
    this.marking = new Set();          // ids whose mark is being changed right now
    this.markChain = Promise.resolve(); // marks are made one after another
    this.marksRev = 0;
    this.unseen = 0;   // other people's recordings fetched and not opened yet
    this.remoteError = '';
  }

  // The app is about to press keys in the game: what the keyboard helper sees in the next ms
  // milliseconds is marked as sent by the app, so a recording tells them apart from yours.
  ownKeys(ms) { this.ownUntil = Date.now() + ms; }
  by() { return Date.now() < this.ownUntil ? { by: 'app' } : {}; }

  get recording() { return !!this.current && this.busy !== 'stopping'; }
  get status() {
    return {
      recording: !!this.current, busy: this.busy, startedAt: this.current ? this.current.startedAt : 0,
      video: this.current ? !!this.current.video : false, maxMs: MAX_MS, sending: this.sending,
      unseen: this.unseen, remoteError: this.remoteError, marking: [...this.marking],
    };
  }

  // Something happened. Only kept while recording.
  event(kind, data) { if (this.current && this.busy !== 'starting') this.trace.add(kind, data); }
  // The app's state was sent to the window: what changed in it is noted.
  state(s) {
    if (!this.current) return;
    const brief = stateBrief(s);
    const diff = briefChanges(this.lastBrief, brief);
    this.lastBrief = brief;
    if (diff) this.event('state', diff);
  }

  // The keyboard helper (uiohook) while recording: every key and click, as pressed.
  attachHook(lib) {
    this.names = keyNames(lib.UiohookKey);
    const h = lib.uIOhook;
    h.on('keydown', (e) => {
      if (this.held.has(e.keycode)) return; // held down: the repeats are not news
      this.held.add(e.keycode);
      this.event('key', { dir: 'down', key: keyLabel(e, this.names), ...this.by() });
    });
    h.on('keyup', (e) => { this.held.delete(e.keycode); this.event('key', { dir: 'up', key: keyLabel(e, this.names), ...this.by() }); });
    h.on('mousedown', (e) => this.event('mouse', { dir: 'down', button: buttonName(e.button), x: e.x, y: e.y }));
    h.on('mouseup', (e) => this.event('mouse', { dir: 'up', button: buttonName(e.button), x: e.x, y: e.y }));
    h.on('wheel', (e) => this.event('wheel', { amount: e.rotation, x: e.x, y: e.y }));
  }

  folder(id) { return path.join(this.dir, id); }
  write(id, name, value) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    fs.writeFileSync(path.join(this.folder(id), name), name.endsWith('.gz') ? zlib.gzipSync(data) : data);
  }
  meta(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.folder(id), 'meta.json'), 'utf8')); } catch (_) { return null; }
  }
  saveMeta(m) { this.write(m.id, 'meta.json', m); }

  async toggle() { return this.current ? this.stop() : this.start(); }

  async start() {
    if (this.current || this.busy) return;
    this.busy = 'starting';
    this.changed();
    const me = this.who();
    const startedAt = Date.now();
    const id = recordingId(startedAt, me.name);
    const folder = this.folder(id);
    fs.mkdirSync(folder, { recursive: true });
    this.current = { id, startedAt, folder, video: null, timer: null };
    let snap = null;
    try { snap = await this.snapshot(); } catch (e) { snap = { problem: e.message || String(e) }; }
    try { this.write(id, 'state-start.json.gz', snap.state || snap); if (snap.inventory) this.write(id, 'inventory-start.json.gz', snap.inventory); } catch (_) { /* the rest still records */ }
    let video = null, videoProblem = '';
    try { video = await this.recorder.start({ displayId: this.displayId(), dir: folder }); } catch (e) { videoProblem = e.message || String(e); }
    // Times count from the video's first frame (or from now, without a video).
    this.trace.start(video && video.at ? video.at : undefined);
    this.held.clear();
    this.lastBrief = null;
    this.current.video = video;
    this.current.videoProblem = videoProblem;
    this.current.timer = setTimeout(() => { this.say('The recording stopped by itself after 5 minutes, so it stays small enough to send.', true); this.stop(); }, MAX_MS);
    this.busy = '';
    this.trace.add('start', { version: this.version, by: me.name || '', video: video ? `${video.width}x${video.height} ${video.mime}` : `none: ${videoProblem}` });
    if (snap && snap.state) this.state(snap.state);
    this.say(video ? 'Recording. Press the record key again, or Stop on the Troubleshooting page, when you are done.' : `Recording keys and what the app does, but not the screen: ${videoProblem}`, !video);
    this.changed();
  }

  async stop() {
    const cur = this.current;
    if (!cur || this.busy) return null;
    this.busy = 'stopping';
    clearTimeout(cur.timer);
    this.trace.add('stop', {});
    this.changed();
    const endedAt = Date.now();
    const video = cur.video ? await this.recorder.stop() : null;
    let snap = null;
    try { snap = await this.snapshot(); } catch (e) { snap = { problem: e.message || String(e) }; }
    const me = this.who();
    try {
      this.write(cur.id, 'state-end.json.gz', snap.state || snap);
      if (snap.inventory) this.write(cur.id, 'inventory-end.json.gz', snap.inventory);
      this.write(cur.id, 'events.json.gz', this.trace.toJSON());
      this.saveMeta({
        id: cur.id, startedAt: cur.startedAt, endedAt, by: me.name || '', role: me.role || '', version: this.version,
        screen: cur.video ? cur.video.screen : null,
        video: video && video.bytes ? { bytes: video.bytes, mime: cur.video.mime, file: cur.video.file || 'video.webm', width: cur.video.width, height: cur.video.height, fps: cur.video.fps || null, problem: video.problem || null } : null,
        videoProblem: cur.videoProblem || (video && video.problem) || null,
        events: this.trace.events.length, dropped: this.trace.dropped, note: '', sent: null,
      });
      this.say('Recording saved. Watch it on the Troubleshooting page, add a note and send it.');
    } catch (e) {
      this.say(`The recording could not be saved: ${e.message || e}`, true);
    }
    this.current = null; this.busy = '';
    this.trace = new Trace({ now: clock });
    this.changed();
    return cur.id;
  }

  // Every saved recording, newest first.
  list() {
    let names = [];
    try { names = fs.readdirSync(this.dir).filter((n) => ID.test(n)); } catch (_) { return []; }
    return names.map((id) => this.meta(id)).filter(Boolean)
      .filter((m) => !this.current || m.id !== this.current.id)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((m) => ({ id: m.id, startedAt: m.startedAt, endedAt: m.endedAt, by: m.by, note: m.note, sent: m.sent, events: m.events, videoBytes: m.video ? m.video.bytes : 0, videoProblem: m.videoProblem, remote: !!m.remote, seen: m.seen !== false, kind: m.kind || 'recording', images: (m.images || []).length, ...this.standing(m) }));
  }

  // ---- everyone's recordings, for admins and moderators ----
  // Recordings removed from this PC's list, so the next look at GitHub does not bring them back.
  hiddenFile() { return path.join(this.dir, 'hidden.json'); }
  hidden() { try { return new Set(JSON.parse(fs.readFileSync(this.hiddenFile(), 'utf8'))); } catch (_) { return new Set(); } }
  hide(id) {
    const h = this.hidden(); h.add(id);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.hiddenFile(), JSON.stringify([...h]));
  }
  countUnseen() { this.unseen = this.list().filter((r) => r.remote && !r.seen).length; }

  // Looks in the reports repository for recordings this PC does not have yet, and fetches their
  // facts and events (the video only when one is opened). Also reads where each one stands.
  // Answers how many came in.
  async syncRemote() {
    if (this.syncing) return 0;
    this.syncing = true;
    let added = 0;
    const marksAt = this.marksRev; // a mark made while this runs wins over what this reads
    try {
      const gh = await this.cloud.github();
      if (gh.error) throw new Error(gh.error);
      if (!gh.token || !gh.repo) throw new Error('No reports repository or token is saved in Developer tools.');
      const where = { fetchImpl: this.fetchImpl, token: gh.token, repo: gh.repo };
      // The whole repository as it is right now, in one answer: recordings and their status.
      const tree = await latestTree(where);
      const marks = await this.marksFrom(where, tree);
      if (marksAt === this.marksRev) this.keepMarks(marks);
      const hidden = this.hidden();
      const ids = tree.filter((e) => e.type === 'tree' && /^recordings\/[^/]+$/.test(e.path)).map((e) => e.path.slice('recordings/'.length))
        .filter((id) => ID.test(id) && !hidden.has(id) && !this.meta(id))
        .sort().reverse().slice(0, SYNC_MAX); // newest first
      for (const id of ids) {
        const raw = await readFile({ ...where, path: `recordings/${id}/meta.json` });
        if (!raw) continue;
        let m;
        try { m = JSON.parse(raw.toString('utf8')); } catch (_) { continue; }
        const events = await readFile({ ...where, path: `recordings/${id}/events.json.gz` });
        fs.mkdirSync(this.folder(id), { recursive: true });
        if (events) fs.writeFileSync(path.join(this.folder(id), 'events.json.gz'), events);
        this.saveMeta({ ...m, id, remote: true, seen: false, repo: gh.repo, sent: m.sent || { at: m.endedAt, url: `https://github.com/${gh.repo}/tree/main/recordings/${id}` } });
        // A written report's pictures are small: they come along now.
        for (const n of (m.images || []).filter((x) => IMAGE.test(x))) {
          const img = await readFile({ ...where, path: `recordings/${id}/${n}` });
          if (img) fs.writeFileSync(path.join(this.folder(id), n), img);
        }
        added++;
      }
      this.remoteError = '';
    } catch (e) {
      this.remoteError = e.message || String(e);
    } finally {
      this.syncing = false;
    }
    this.countUnseen();
    this.changed();
    return added;
  }

  // ---- where each one stands: one small file per recording, status/<id>.json ----
  // { state, type, by, at }. state: '' (open), 'planned', 'in progress', 'fixed' (Done for a
  // suggestion), 'wontfix'. type: 'problem' or 'suggestion' when changed after sending (the
  // one chosen before sending is in meta.json). One file each, so two people changing things
  // at once (or one person clicking quickly) can never undo each other, as one list could.
  // Read too: fixed/<id>.json (0.28.2 to 0.45: fixed) and status.json (0.28.1: one list).
  statusOf(id) {
    if (!this.marksLoaded) {
      this.marksLoaded = true;
      try { this.fixed = JSON.parse(fs.readFileSync(path.join(this.dir, 'status-marks.json'), 'utf8')) || {}; } catch (_) { /* none yet */ }
    }
    const f = this.fixed[id];
    return f ? { state: f.state || '', type: f.type || '', by: f.by || '', at: f.at || 0 } : null;
  }
  // What the list and the page show: the type, and the state when it is not open.
  standing(m) {
    const st = this.statusOf(m.id);
    const type = (st && st.type) || m.type || 'problem';
    return { type, state: st ? st.state : '', statusBy: st ? st.by : '', statusAt: st ? st.at : 0 };
  }
  keepMarks(all) {
    this.fixed = all; this.marksLoaded = true;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, 'status-marks.json'), JSON.stringify(all));
  }
  // The marks in a tree from latestTree. Each file is read once and then known by its content id.
  async marksFrom(where, tree) {
    const known = {};
    for (const [id, f] of Object.entries(this.fixed || {})) if (f && f.sha) known[f.sha] = { id, f };
    const all = {};
    const read = async (sha) => { try { return JSON.parse((await readBlob({ ...where, sha })).toString('utf8')) || {}; } catch (_) { return {}; } };
    const old = tree.find((e) => e.path === 'status.json' && e.type === 'blob');
    if (old) {
      for (const [id, f] of Object.entries(await read(old.sha))) if (f && f.fixed && ID.test(id)) all[id] = { state: 'fixed', by: f.by || '', at: f.at || 0, old: 'status.json' };
    }
    // The older fixed/ files first, so a status/ file for the same one wins.
    for (const folder of ['fixed', 'status']) {
      for (const e of tree) {
        const m = e.type === 'blob' && e.path.startsWith(`${folder}/`) && /^[^/]+\/(.+)\.json$/.exec(e.path);
        if (!m || !ID.test(m[1])) continue;
        if (known[e.sha] && known[e.sha].id === m[1]) { all[m[1]] = known[e.sha].f; continue; }
        const f = await read(e.sha);
        const state = folder === 'fixed' ? 'fixed' : STATES.includes(f.state) ? f.state : '';
        all[m[1]] = { state, type: TYPES.includes(f.type) ? f.type : '', by: f.by || '', at: f.at || 0, sha: e.sha, ...(folder === 'fixed' ? { old: e.path } : {}) };
      }
    }
    return all;
  }
  // Changes where a sent recording or report stands, for everyone: { state?, type? }. '' when it
  // worked. Changes wait for each other, so they are made one at a time, in order.
  setStatus(id, change) {
    this.marking.add(id);
    this.changed();
    const run = this.markChain.then(() => this.markNow(id, change || {}));
    this.markChain = run.catch(() => {});
    return run;
  }
  async markNow(id, change) {
    const m = ID.test(String(id)) ? this.meta(id) : null;
    try {
      if (!m) return 'That recording is no longer here.';
      if (!m.remote && !m.sent) return 'Send it first: only what is on GitHub can be marked.';
      if (change.state !== undefined && !STATES.includes(change.state)) return 'Unknown status.';
      if (change.type !== undefined && !TYPES.includes(change.type)) return 'Unknown type.';
      const gh = await this.cloud.github();
      if (gh.error) throw new Error(gh.error);
      const where = { fetchImpl: this.fetchImpl, token: gh.token, repo: gh.repo };
      const tree = await latestTree(where);
      const all = await this.marksFrom(where, tree);
      const files = [];
      const has = (p) => tree.some((e) => e.path === p);
      const write = (mid, f) => files.push({ path: `status/${mid}.json`, data: Buffer.from(`${JSON.stringify({ state: f.state || '', ...(f.type ? { type: f.type } : {}), by: f.by, at: f.at })}\n`) });
      // Older marks move into status/ in the same commit.
      if (has('status.json')) files.push({ path: 'status.json', remove: true });
      for (const [mid, f] of Object.entries(all)) {
        if (!f.old) continue;
        if (f.old !== 'status.json' && has(f.old)) files.push({ path: f.old, remove: true });
        if (mid !== id) write(mid, f);
      }
      const was = all[id] || { state: '', type: '' };
      const next = { state: change.state !== undefined ? change.state : was.state || '', type: change.type !== undefined ? change.type : was.type || '', by: this.who().name || '', at: Date.now() };
      // Back to open, with the type it was sent with: nothing left to keep.
      if (!next.state && (!next.type || next.type === (m.type || 'problem'))) {
        if (has(`status/${id}.json`)) files.push({ path: `status/${id}.json`, remove: true });
        delete all[id];
      } else {
        write(id, next);
        all[id] = next;
      }
      if (files.length) await uploadFolder({ ...where, folder: '', files, message: `${next.state ? STATE_NAMES[next.state] : 'Open'}${next.type ? ` (${next.type})` : ''}: ${id}` });
      for (const f of Object.values(all)) delete f.old;
      this.marksRev++;
      this.keepMarks(all);
      return '';
    } catch (e) {
      return e.message || String(e);
    } finally {
      this.marking.delete(id);
      this.changed();
    }
  }
  // The type chosen before sending (problem or suggestion), kept in meta.json and sent with it.
  setType(id, type) {
    const m = ID.test(String(id)) ? this.meta(id) : null;
    if (!m || m.remote || !TYPES.includes(type)) return false;
    m.type = type;
    this.saveMeta(m);
    this.changed();
    return true;
  }

  // ---- written reports: a note and pictures, no recording ----
  async newReport() {
    const me = this.who();
    const at = Date.now();
    let id = recordingId(at, me.name);
    if (this.meta(id)) id = recordingId(at + 1000, me.name);
    fs.mkdirSync(this.folder(id), { recursive: true });
    let snap = null;
    try { snap = await this.snapshot(); } catch (e) { snap = { problem: e.message || String(e) }; }
    try { this.write(id, 'state-start.json.gz', (snap && snap.state) || snap); } catch (_) { /* the report works without it */ }
    this.saveMeta({ id, kind: 'note', startedAt: at, endedAt: at, by: me.name || '', role: me.role || '', version: this.version, events: 0, dropped: 0, note: '', images: [], sent: null, video: null });
    this.changed();
    return id;
  }
  // bytes: the picture, type: its MIME type. '' when it was added.
  addImage(id, bytes, type) {
    const m = ID.test(String(id)) ? this.meta(id) : null;
    if (!m || m.kind !== 'note' || m.remote) return 'Pictures go in a written report.';
    const ext = EXT[String(type || '').toLowerCase()];
    if (!ext) return 'Only PNG, JPG, GIF and WebP pictures can be added.';
    const data = Buffer.from(bytes || []);
    if (!data.length || data.length > MAX_IMAGE) return 'A picture can be up to 8 MB.';
    m.images = m.images || [];
    if (m.images.length >= MAX_IMAGES) return `A report holds up to ${MAX_IMAGES} pictures.`;
    let n = 1;
    while (m.images.some((x) => x.startsWith(`image-${n}.`))) n++;
    const name = `image-${n}.${ext}`;
    fs.writeFileSync(path.join(this.folder(id), name), data);
    m.images.push(name);
    this.saveMeta(m);
    this.changed();
    return '';
  }
  removeImage(id, name) {
    const m = ID.test(String(id)) ? this.meta(id) : null;
    if (!m || m.remote || !IMAGE.test(String(name))) return false;
    m.images = (m.images || []).filter((x) => x !== name);
    fs.rmSync(path.join(this.folder(id), name), { force: true });
    this.saveMeta(m);
    this.changed();
    return true;
  }
  image(id, name) {
    if (!ID.test(String(id)) || !IMAGE.test(String(name))) return null;
    try { return fs.readFileSync(path.join(this.folder(id), name)); } catch (_) { return null; }
  }

  // The video of a recording; one fetched from GitHub is downloaded the first time it is watched.
  async videoFor(id) {
    const have = this.video(id);
    if (have) return have;
    const m = ID.test(String(id)) ? this.meta(id) : null;
    if (!m || !m.remote || !m.video) return null;
    const gh = await this.cloud.github();
    if (gh.error) throw new Error(gh.error);
    const where = { fetchImpl: this.fetchImpl, token: gh.token, repo: m.repo || gh.repo };
    const file = m.video.file || 'video.webm';
    // A big video was sent in parts: they are put back together here.
    const names = m.video.parts ? Array.from({ length: m.video.parts }, (_, i) => `${file}.part${i + 1}`) : [file];
    const pieces = [];
    for (const n of names) {
      const piece = await readFile({ ...where, path: `recordings/${id}/${n}` });
      if (!piece) return null;
      pieces.push(piece);
    }
    const data = Buffer.concat(pieces);
    fs.writeFileSync(path.join(this.folder(id), file), data);
    return data;
  }

  // One recording for the preview: its facts and its events (the video comes separately).
  details(id) {
    if (!ID.test(String(id))) return null;
    const m = this.meta(id);
    if (!m) return null;
    let events = [];
    try { events = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(this.folder(id), 'events.json.gz')))).events; } catch (_) { /* none kept */ }
    if (m.remote && m.seen === false) { m.seen = true; this.saveMeta(m); this.countUnseen(); this.changed(); }
    return { ...m, events, ...this.standing(m) };
  }
  video(id) {
    if (!ID.test(String(id))) return null;
    const m = this.meta(id);
    const file = m && m.video && /^video\.(webm|mp4)$/.test(m.video.file || '') ? m.video.file : 'video.webm';
    try { return fs.readFileSync(path.join(this.folder(id), file)); } catch (_) { return null; }
  }

  setNote(id, note) {
    const m = ID.test(String(id)) ? this.meta(id) : null;
    if (!m) return false;
    m.note = String(note || '').slice(0, 5000);
    this.saveMeta(m);
    return true;
  }

  // Off this PC. One that is on GitHub stays there, and is not fetched again.
  remove(id) {
    if (!ID.test(String(id)) || (this.current && this.current.id === id)) return false;
    const m = this.meta(id);
    if (m && (m.remote || m.sent)) this.hide(id);
    fs.rmSync(this.folder(id), { recursive: true, force: true });
    this.countUnseen();
    return true;
  }

  // Sends one recording to the reports repository as one commit. '' when it worked.
  async send(id, note) {
    const m = ID.test(String(id)) ? this.meta(id) : null;
    if (!m) return 'That recording is no longer here.';
    if (m.remote) return 'This one came from GitHub; it is there already.';
    if (this.sending) return 'Another recording is being sent. Wait until it is done.';
    if (note !== undefined) { m.note = String(note || '').slice(0, 5000); this.saveMeta(m); }
    if (!m.note.trim()) return 'Write a note first: what went wrong, and what you expected instead.';
    this.sending = { id, step: 'Asking the server for the GitHub settings' };
    this.changed();
    try {
      const gh = await this.cloud.github();
      if (gh.error) throw new Error(gh.error);
      const folder = this.folder(id);
      const files = [];
      const add = (name) => { try { files.push({ path: name, data: fs.readFileSync(path.join(folder, name)) }); } catch (_) { /* not made for this one */ } };
      const d = this.details(id);
      // The video, cut into parts when it is more than GitHub takes in one file.
      const video = m.video ? this.video(id) : null;
      if (video) {
        const file = m.video.file || 'video.webm';
        if (video.length > this.partBytes) {
          const size = this.partBytes;
          m.video.parts = Math.ceil(video.length / size);
          for (let i = 0; i < m.video.parts; i++) files.push({ path: `${file}.part${i + 1}`, data: video.subarray(i * size, (i + 1) * size) });
        } else {
          delete m.video.parts;
          files.push({ path: file, data: video });
        }
        this.saveMeta(m);
      }
      files.push({ path: 'README.md', data: Buffer.from(readme({ ...m, dropped: m.dropped }, d.events)) });
      add('meta.json');
      for (const n of ['events.json.gz', 'state-start.json.gz', 'state-end.json.gz', 'inventory-start.json.gz', 'inventory-end.json.gz', ...(m.images || [])]) add(n);
      const first = m.note.trim().split('\n')[0].slice(0, 70);
      const r = await uploadFolder({
        fetchImpl: this.fetchImpl, token: gh.token, repo: gh.repo, folder: `recordings/${id}`, files,
        message: `${m.kind === 'note' ? 'Report' : 'Recording'} ${id}: ${first}\n\n${m.note.trim()}`,
        onStep: (step) => { this.sending = { id, step }; this.changed(); },
      });
      m.sent = { at: Date.now(), url: r.url, commit: r.commit };
      this.saveMeta(m);
      return '';
    } catch (e) {
      return e.message || String(e);
    } finally {
      this.sending = null;
      this.changed();
    }
  }
}

module.exports = { Troubleshoot, MAX_MS, STATES, TYPES };
