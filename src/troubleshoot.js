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
const { uploadFolder } = require('./github');

const MAX_MS = 8 * 60 * 1000; // a longer video would be too large to send in one piece

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
      .map((m) => ({ id: m.id, startedAt: m.startedAt, endedAt: m.endedAt, by: m.by, note: m.note, sent: m.sent, events: m.events, videoBytes: m.video ? m.video.bytes : 0, videoProblem: m.videoProblem }));
  }

  // One recording for the preview: its facts and its events (the video comes separately).
  details(id) {
    if (!ID.test(String(id))) return null;
    const m = this.meta(id);
    if (!m) return null;
    let events = [];
    try { events = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(this.folder(id), 'events.json.gz')))).events; } catch (_) { /* none kept */ }
    return { ...m, events };
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

  remove(id) {
    if (!ID.test(String(id)) || (this.current && this.current.id === id)) return false;
    fs.rmSync(this.folder(id), { recursive: true, force: true });
    return true;
  }

  // Sends one recording to the reports repository as one commit. '' when it worked.
  async send(id, note) {
    const m = ID.test(String(id)) ? this.meta(id) : null;
    if (!m) return 'That recording is no longer here.';
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
      for (const n of ['events.json.gz', 'state-start.json.gz', 'state-end.json.gz', 'inventory-start.json.gz', 'inventory-end.json.gz', 'video.webm']) add(n);
      const first = m.note.trim().split('\n')[0].slice(0, 70);
      const r = await uploadFolder({
        fetchImpl: this.fetchImpl, token: gh.token, repo: gh.repo, folder: `recordings/${id}`, files,
        message: `Recording ${id}: ${first}\n\n${m.note.trim()}`,
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
