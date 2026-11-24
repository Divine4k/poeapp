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
const { uploadFolder, listFolder, readFile } = require('./github');

const MAX_MS = 8 * 60 * 1000; // a longer video would be too large to send in one piece
const SYNC_MAX = 20;          // recordings fetched in one go; the rest come with the next look
const MAX_IMAGES = 10;        // pictures in one written report
const MAX_IMAGE = 8 * 1024 * 1024;
const IMAGE = /^image-[0-9]{1,2}\.(png|jpg|gif|webp)$/;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

class Troubleshoot {
  // dir: where recordings are kept. recorder: a ScreenRecorder. displayId(): the game's screen.
  // snapshot(): { state, inventory } of the app right now (inventory may be null).
  // who(): { name, role }. version: of the app. cloud: for the GitHub settings. fetchImpl: the web.
  // changed(): the page should redraw. say(text, bad): a message for the person.
  constructor({ dir, recorder, displayId, snapshot, who, version, cloud, fetchImpl, changed = () => {}, say = () => {} }) {
    Object.assign(this, { dir, recorder, displayId, snapshot, who, version, cloud, fetchImpl, changed, say });
    this.trace = new Trace();
    this.current = null; // { id, startedAt, folder, video, timer }
    this.busy = '';      // 'starting' | 'stopping' while that is going on
    this.sending = null; // { id, step }
    this.lastBrief = null;
    this.held = new Set();
    this.names = {};
    this.ownUntil = 0; // keys and clicks seen before this time were sent by the app itself
    this.syncing = false;
    this.fixed = {};   // what is fixed, from status.json in the reports repository: { id: { by, at } }
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
      unseen: this.unseen, remoteError: this.remoteError,
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
    try { video = await this.recorder.start({ displayId: this.displayId(), file: path.join(folder, 'video.webm') }); } catch (e) { videoProblem = e.message || String(e); }
    this.trace.start();
    this.held.clear();
    this.lastBrief = null;
    this.current.video = video;
    this.current.videoProblem = videoProblem;
    this.current.timer = setTimeout(() => { this.say('The recording stopped by itself after 8 minutes, so it stays small enough to send.', true); this.stop(); }, MAX_MS);
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
        video: video && video.bytes ? { bytes: video.bytes, mime: cur.video.mime, width: cur.video.width, height: cur.video.height, problem: video.problem || null } : null,
        videoProblem: cur.videoProblem || (video && video.problem) || null,
        events: this.trace.events.length, dropped: this.trace.dropped, note: '', sent: null,
      });
      this.say('Recording saved. Watch it on the Troubleshooting page, add a note and send it.');
    } catch (e) {
      this.say(`The recording could not be saved: ${e.message || e}`, true);
    }
    this.current = null; this.busy = '';
    this.trace = new Trace();
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
      .map((m) => ({ id: m.id, startedAt: m.startedAt, endedAt: m.endedAt, by: m.by, note: m.note, sent: m.sent, events: m.events, videoBytes: m.video ? m.video.bytes : 0, videoProblem: m.videoProblem, remote: !!m.remote, seen: m.seen !== false, kind: m.kind || 'recording', images: (m.images || []).length, fixed: this.fixedOf(m.id) }));
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
  // facts and events (the video only when one is opened). Answers how many came in.
  async syncRemote() {
    if (this.syncing) return 0;
    this.syncing = true;
    let added = 0;
    try {
      const gh = await this.cloud.github();
      if (gh.error) throw new Error(gh.error);
      if (!gh.token || !gh.repo) throw new Error('No reports repository or token is saved in Developer tools.');
      const where = { fetchImpl: this.fetchImpl, token: gh.token, repo: gh.repo };
      await this.readFixed(where);
      const hidden = this.hidden();
      const ids = (await listFolder({ ...where, path: 'recordings' }))
        .filter((e) => e.type === 'dir' && ID.test(e.name) && !hidden.has(e.name) && !this.meta(e.name))
        .map((e) => e.name).sort().reverse().slice(0, SYNC_MAX); // newest first
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

  // ---- fixed or not, shared through status.json at the top of the reports repository ----
  fixedOf(id) {
    if (!Object.keys(this.fixed).length) { try { this.fixed = JSON.parse(fs.readFileSync(path.join(this.dir, 'status.json'), 'utf8')) || {}; } catch (_) { /* none yet */ } }
    const f = this.fixed[id];
    return f && f.fixed ? { by: f.by || '', at: f.at || 0, commit: f.commit || '' } : null;
  }
  async readFixed(where) {
    const raw = await readFile({ ...where, path: 'status.json' });
    let all = {};
    try { all = raw ? JSON.parse(raw.toString('utf8')) || {} : {}; } catch (_) { all = {}; }
    this.fixed = all;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, 'status.json'), JSON.stringify(all));
    return all;
  }
  // Marks a sent recording or report fixed (or not fixed after all), for everyone. '' when it worked.
  async setFixed(id, fixed) {
    const m = ID.test(String(id)) ? this.meta(id) : null;
    if (!m) return 'That recording is no longer here.';
    if (!m.remote && !m.sent) return 'Send it first: only what is on GitHub can be marked fixed.';
    try {
      const gh = await this.cloud.github();
      if (gh.error) throw new Error(gh.error);
      const where = { fetchImpl: this.fetchImpl, token: gh.token, repo: gh.repo };
      const all = await this.readFixed(where); // the newest, so nobody else's mark is lost
      if (fixed) all[id] = { fixed: true, by: this.who().name || '', at: Date.now() };
      else delete all[id];
      await uploadFolder({ ...where, folder: '', files: [{ path: 'status.json', data: Buffer.from(`${JSON.stringify(all, null, 1)}\n`) }], message: `${fixed ? 'Fixed' : 'Not fixed'}: ${id}` });
      this.fixed = all;
      fs.writeFileSync(path.join(this.dir, 'status.json'), JSON.stringify(all));
      return '';
    } catch (e) {
      return e.message || String(e);
    } finally {
      this.changed();
    }
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
    const data = await readFile({ fetchImpl: this.fetchImpl, token: gh.token, repo: m.repo || gh.repo, path: `recordings/${id}/video.webm` });
    if (!data) return null;
    fs.writeFileSync(path.join(this.folder(id), 'video.webm'), data);
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
    return { ...m, events, fixed: this.fixedOf(id) };
  }
  video(id) {
    if (!ID.test(String(id))) return null;
    try { return fs.readFileSync(path.join(this.folder(id), 'video.webm')); } catch (_) { return null; }
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
      files.push({ path: 'README.md', data: Buffer.from(readme({ ...m, dropped: m.dropped }, d.events)) });
      add('meta.json');
      for (const n of ['events.json.gz', 'state-start.json.gz', 'state-end.json.gz', 'inventory-start.json.gz', 'inventory-end.json.gz', 'video.webm', ...(m.images || [])]) add(n);
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

module.exports = { Troubleshoot, MAX_MS };
