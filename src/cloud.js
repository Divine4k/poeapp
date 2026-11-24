'use strict';
// Your account on the Map Companion server, and the uploading of what you ran: finished
// sessions (their maps, loot and costs) and the inventory picture kept for each map.
// Settings stay on this PC. Plain Node, no Electron: the caller hands in how to reach the web
// and how to keep the little this needs to remember.
const crypto = require('crypto');

// Where the server lives (see server/README.md). With an empty address the app has no accounts
// and asks nobody to register.
const SERVER = 'https://poeapp.divine4k.workers.dev';

const NAME = /^[A-Za-z0-9_-]{3,20}$/;
const MIN_PASSWORD = 8;

// Turns the password into what is sent instead of it. The slow part of password hashing is
// done here on the PC, so the password itself never leaves it and the server has nothing
// worth guessing at.
function stretch(name, password) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), `poeapp:${String(name).toLowerCase()}`, 32, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
  });
}

// What is wrong with a name and password before anything is sent, or '' when they are fine.
const cleanRole = (r) => (r === 'admin' || r === 'moderator' ? r : '');

function checkEntry(name, password, again) {
  if (!NAME.test(String(name || '').trim())) return 'A name is 3 to 20 characters: letters, numbers, - and _.';
  if (String(password || '').length < MIN_PASSWORD) return `The password needs at least ${MIN_PASSWORD} characters.`;
  if (again !== undefined && again !== password) return 'The two passwords are not the same.';
  return '';
}

class Cloud {
  // saved: what save() was last given, or null. save(state): keep it for next time.
  // stretchImpl: for tests, where the real stretching would only be slow.
  constructor({ url = SERVER, fetchImpl, saved = null, save = () => {}, stretchImpl = stretch }) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.save = save;
    this.stretch = stretchImpl;
    const s = saved || {};
    this.name = s.token ? String(s.name || '') : '';
    this.token = this.name ? String(s.token || '') : '';
    // '' (everyone), 'moderator' or 'admin'. Given by the server at login and asked again at
    // each start (refresh), so a role given or taken away reaches the app without logging in again.
    this.role = this.token ? cleanRole(s.role) : '';
    this.sent = { ...(s.sent || {}) };             // session id -> 1, once it and its pictures are up
    this.gone = Array.isArray(s.gone) ? s.gone.slice() : []; // [{ session } | { picture }] still to be taken down
    this.busy = false;
    this.error = null;
    this.sentAt = 0;
    this.waiting = 0;
  }

  get enabled() { return !!this.url; }
  get signedIn() { return this.enabled && !!this.token; }
  get status() {
    return { enabled: this.enabled, signedIn: this.signedIn, name: this.name, role: this.signedIn ? this.role : '', waiting: this.waiting, busy: this.busy, error: this.error, sentAt: this.sentAt };
  }
  keep() { this.save({ name: this.name, token: this.token, role: this.role, sent: this.sent, gone: this.gone }); }

  async call(method, route, { body, text, auth = true } = {}) {
    const headers = {};
    if (auth) headers.Authorization = `Bearer ${this.token}`;
    const payload = text !== undefined ? text : (body !== undefined ? JSON.stringify(body) : undefined);
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetch(`${this.url}/v1/${route}`, { method, headers, body: payload });
    let data = null;
    try { data = await res.json(); } catch (_) { /* an answer without a body */ }
    return { ok: res.ok, status: res.status, data, error: (data && data.error) || (res.ok ? null : `The server answered ${res.status}.`) };
  }

  // Both return '' when it worked, or what to tell the person.
  register(name, password, again) { return this.enter('register', name, password, again); }
  login(name, password) { return this.enter('login', name, password); }
  async enter(route, name, password, again) {
    if (!this.enabled) return 'Accounts are not switched on in this version.';
    name = String(name || '').trim();
    const wrong = route === 'register' ? checkEntry(name, password, again) : (name && password ? '' : 'Give your name and password.');
    if (wrong) return wrong;
    let r;
    try { r = await this.call('POST', route, { auth: false, body: { name, key: await this.stretch(name, password) } }); } catch (e) { return e.message || String(e); }
    if (!r.ok || !r.data || !r.data.token) return r.error || 'The server gave no answer that makes sense.';
    // Another account on this PC starts with nothing sent: what is here has to go up under it too.
    if (r.data.name !== this.name) { this.sent = {}; this.gone = []; }
    this.name = r.data.name; this.token = r.data.token; this.role = cleanRole(r.data.role); this.error = null;
    this.keep();
    return '';
  }

  // Asks the server who this PC is logged in as, for the role. True when something changed.
  async refresh() {
    if (!this.signedIn) return false;
    let r;
    try { r = await this.call('GET', 'me'); } catch (_) { return false; } // offline: keep what is known
    if (r.status === 401) { this.token = ''; this.role = ''; this.keep(); this.error = 'Log in again: this PC is no longer signed in.'; return true; }
    if (!r.ok || !r.data) return false;
    const role = cleanRole(r.data.role);
    if (role === this.role) return false;
    this.role = role; this.keep();
    return true;
  }

  // For admins: every account with its role. { users: [{ name, role, sessions, last, created }] } or { error }.
  async users() {
    if (!this.signedIn) return { error: 'You are not logged in.' };
    try { const r = await this.call('GET', 'users'); return r.ok && r.data ? { users: r.data.users || [] } : { error: r.error }; } catch (e) { return { error: e.message || String(e) }; }
  }
  // For admins. '' when it worked.
  async setRole(name, role) {
    if (!this.signedIn) return 'You are not logged in.';
    try { const r = await this.call('PUT', `users/${encodeURIComponent(name)}/role`, { body: { role } }); return r.ok ? '' : r.error; } catch (e) { return e.message || String(e); }
  }
  // Where recordings go on GitHub, and the token to put them there. Admins and moderators may
  // read it; only admins may change it. { repo, token, by, at } or { error }.
  async github() {
    if (!this.signedIn) return { error: 'Log in first.' };
    try { const r = await this.call('GET', 'dev/github'); return r.ok && r.data ? r.data : { error: r.error }; } catch (e) { return { error: e.message || String(e) }; }
  }
  async setGithub(patch) {
    if (!this.signedIn) return { error: 'Log in first.' };
    try { const r = await this.call('PUT', 'dev/github', { body: patch }); return r.ok && r.data ? r.data : { error: r.error }; } catch (e) { return { error: e.message || String(e) }; }
  }

  async logout() {
    if (this.signedIn) { try { await this.call('POST', 'logout'); } catch (_) { /* the token is dropped here either way */ } }
    this.token = ''; this.role = ''; this.error = null; this.waiting = 0;
    this.keep();
  }

  // Takes the account and everything uploaded under it off the server. '' when it worked.
  async deleteAccount(password) {
    if (!this.signedIn) return 'You are not logged in.';
    if (!password) return 'Give your password to delete the account.';
    let r;
    try { r = await this.call('POST', 'account/delete', { body: { key: await this.stretch(this.name, password) } }); } catch (e) { return e.message || String(e); }
    if (!r.ok) return r.error;
    this.name = ''; this.token = ''; this.role = ''; this.sent = {}; this.gone = []; this.waiting = 0; this.error = null;
    this.keep();
    return '';
  }

  // A session deleted on this PC comes off the server too, with the pictures of its maps.
  forget(sessionId, runIds = []) {
    if (!this.sent[sessionId]) return; // never went up
    delete this.sent[sessionId];
    this.gone.push({ session: String(sessionId) }, ...runIds.map((id) => ({ picture: String(id) })));
    this.keep();
  }

  // Sends what the server does not have yet. source:
  //   ids()         ids of the saved sessions on this PC
  //   session(id)   one saved session as it should be uploaded, or null
  //   pictures(id)  the text of the pictures file of one map, or null when there is none
  // Stops at the first thing that fails and leaves the rest for the next call.
  async sync(source) {
    if (!this.signedIn || this.busy) return;
    this.busy = true;
    try {
      while (this.gone.length) {
        const g = this.gone[0];
        const r = await this.call('DELETE', g.session ? `sessions/${encodeURIComponent(g.session)}` : `pictures/${encodeURIComponent(g.picture)}`);
        if (!this.settled(r)) return;
        this.gone.shift(); this.keep();
      }
      const todo = source.ids().filter((id) => !this.sent[id]);
      this.waiting = todo.length;
      for (const id of todo) {
        const s = source.session(id);
        if (s && Array.isArray(s.runs)) {
          for (const run of s.runs) {
            const text = source.pictures(run.id);
            if (!text) continue;
            if (!this.settled(await this.call('PUT', `pictures/${encodeURIComponent(run.id)}`, { text }))) return;
          }
          if (!this.settled(await this.call('PUT', `sessions/${encodeURIComponent(id)}`, { text: JSON.stringify(s) }))) return;
        }
        this.sent[id] = 1; this.waiting--; this.sentAt = Date.now();
        this.keep();
      }
      this.error = null;
    } catch (e) {
      this.error = e.message || String(e);
    } finally {
      this.busy = false;
    }
  }

  // Whether to carry on after this answer. Something the server will never take (too large,
  // not a session) is passed over, so one bad file does not hold up the rest.
  settled(r) {
    if (r.ok || r.status === 400 || r.status === 404 || r.status === 413) return true;
    if (r.status === 401) { this.token = ''; this.keep(); this.error = 'Log in again: this PC is no longer signed in.'; return false; }
    this.error = r.error;
    return false;
  }
}

module.exports = { Cloud, stretch, checkEntry, SERVER };
