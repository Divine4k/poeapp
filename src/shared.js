'use strict';
// The item database everyone shares: pictures of items as they look in game, each with its
// name and who gave it that name. It lives in a repository of its own (poeappitemdata), apart
// from the app's code, so a token that may write the data can never change the app.
// Everyone downloads it. Uploading needs a GitHub token with write access to that repository.
const { REPO } = require('./updater');
const { similarity, packPrint, unpackPrint } = require('./core/inventory/icons');

const DATA_REPO = `${REPO.split('/')[0]}/poeappitemdata`;
const FILE = 'items.json';
const URL_BASE = `https://api.github.com/repos/${DATA_REPO}/contents/${FILE}`;

// The list cannot grow without end: an item always looks the same, so a few pictures per item
// are all there is to know. With every stackable item of the game in it, at these limits, the
// file stays under about 3 MB.
const MAX_PER_NAME = 3;     // pictures of one item, named by players
const MAX_ITEMS = 4000;     // entries in all

// Adds entries to a list unless the same picture is already there. Returns how many were added.
// An entry marked auto (learned by an app by itself, not named by a person) is only added when
// the list has no picture of that item yet.
function mergeItems(list, additions) {
  let added = 0;
  for (const a of additions) {
    if (!a || !a.name || !a.print) continue;
    if (list.length >= MAX_ITEMS) break;
    if (list.some((e) => similarity(e.print, a.print) > 0.97)) continue;
    const same = list.filter((e) => e.name === a.name).length;
    if (same >= (a.auto ? 1 : MAX_PER_NAME)) continue;
    list.push({ name: a.name, print: a.print, by: a.by || '', auto: !!a.auto, at: a.at || Date.now() });
    added++;
  }
  return added;
}

const parse = (text) => {
  let raw;
  try { raw = JSON.parse(text); } catch (_) { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r || typeof r.name !== 'string' || typeof r.print !== 'string' || r.name.length > 120) continue;
    // by: who named it. auto: an app learned it by itself (nobody typed the name). at: when.
    try { out.push({ name: r.name, print: unpackPrint(r.print), by: typeof r.by === 'string' ? r.by.slice(0, 40) : '', auto: !!r.auto, at: Number(r.at) || 0 }); } catch (_) { /* skip a broken entry */ }
  }
  return out;
};
const serialise = (list) => JSON.stringify(list.map((e) => {
  const o = { name: e.name, print: packPrint(e.print) };
  if (e.by) o.by = e.by;
  if (e.auto) o.auto = 1;
  if (e.at) o.at = e.at;
  return o;
}), null, 0);

class SharedItems {
  constructor({ fetchImpl, token = '' }) {
    this.fetch = fetchImpl;
    this.token = token;
    this.by = '';          // the name this PC's additions are signed with
    this.items = [];
    this.pending = [];
    this.busy = false;
    this.status = { count: 0, loadedAt: 0, error: null, uploaded: 0 };
  }

  headers(extra = {}) {
    const h = { 'User-Agent': 'poeapp', 'Cache-Control': 'no-cache', ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async download() {
    const res = await this.fetch(URL_BASE, { headers: this.headers({ Accept: 'application/vnd.github.raw+json' }) });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return parse(await res.text());
  }

  async load() {
    try {
      this.items = await this.download();
      this.status.count = this.items.length;
      this.status.loadedAt = Date.now();
      this.status.error = null;
    } catch (e) {
      this.status.error = e.message || String(e);
    }
    return this.items;
  }

  // auto: learned by the app itself. Those are only worth uploading for items the list lacks.
  queue(name, print, { auto = false } = {}) {
    if (auto && this.items.some((e) => e.name === name)) return;
    if (this.pending.some((p) => similarity(p.print, print) > 0.97)) return;
    this.pending.push({ name, print, auto, by: this.by, at: Date.now() });
  }

  // Uploads one new file to the data branch (used for troubleshooting reports). Needs the token.
  async uploadFile(repoPath, buffer, message) {
    if (!this.token) throw new Error('no token');
    const url = `https://api.github.com/repos/${DATA_REPO}/contents/${repoPath.split('/').map(encodeURIComponent).join('/')}`;
    const res = await this.fetch(url, {
      method: 'PUT',
      headers: this.headers({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, content: Buffer.from(buffer).toString('base64') }),
    });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 || res.status === 404 ? 'GitHub refused the upload. The token needs "Contents: read and write" on the item data repository (poeappitemdata).' : `GitHub answered ${res.status}`);
    return repoPath;
  }

  // Renames a picture in the shared list that was uploaded under the wrong name. Needs the token.
  // Returns how many entries were renamed.
  async correct(print, name) {
    if (!this.token || !name || this.busy) return 0;
    this.busy = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const meta = await this.fetch(URL_BASE, { headers: this.headers({ Accept: 'application/vnd.github+json' }) });
        if (!meta.ok) throw new Error(meta.status === 401 || meta.status === 403 ? 'GitHub refused the token. Check that it can write to the repository.' : `GitHub answered ${meta.status}`);
        const sha = (await meta.json()).sha;
        const list = await this.download();
        const wrong = list.filter((e) => e.name !== name && similarity(e.print, print) > 0.97);
        if (!wrong.length) { this.items = list; return 0; }
        const was = wrong.map((e) => e.name).join(', ');
        for (const e of wrong) { e.name = name; e.by = this.by; e.auto = false; e.at = Date.now(); }
        const body = { message: `Rename item: ${was} -> ${name}`.slice(0, 200), sha, content: Buffer.from(serialise(list)).toString('base64') };
        const put = await this.fetch(URL_BASE, { method: 'PUT', headers: this.headers({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
        if (put.ok) { this.items = list; this.status.error = null; return wrong.length; }
        if (put.status !== 409 && put.status !== 422) throw new Error(put.status === 401 || put.status === 403 || put.status === 404 ? 'GitHub refused the upload. The token needs "Contents: read and write" on the item data repository (poeappitemdata).' : `GitHub answered ${put.status}`);
      }
      return 0;
    } catch (e) {
      this.status.error = e.message || String(e);
      return 0;
    } finally {
      this.busy = false;
    }
  }

  // Takes a picture out of the database for everyone. Needs the token. Returns how many went.
  async remove(print) {
    if (!this.token || this.busy) return 0;
    this.busy = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const meta = await this.fetch(URL_BASE, { headers: this.headers({ Accept: 'application/vnd.github+json' }) });
        if (!meta.ok) throw new Error(meta.status === 401 || meta.status === 403 ? 'GitHub refused the token. Check that it can write to the repository.' : `GitHub answered ${meta.status}`);
        const sha = (await meta.json()).sha;
        const list = await this.download();
        const gone = list.filter((e) => similarity(e.print, print) > 0.97);
        if (!gone.length) { this.items = list; return 0; }
        const keep = list.filter((e) => !gone.includes(e));
        const body = { message: `Remove item: ${gone.map((e) => e.name).join(', ')}`.slice(0, 200), sha, content: Buffer.from(serialise(keep)).toString('base64') };
        const put = await this.fetch(URL_BASE, { method: 'PUT', headers: this.headers({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
        if (put.ok) { this.items = keep; this.status.count = keep.length; this.status.error = null; return gone.length; }
        if (put.status !== 409 && put.status !== 422) throw new Error(put.status === 401 || put.status === 403 || put.status === 404 ? 'GitHub refused the upload. The token needs "Contents: read and write" on the item data repository.' : `GitHub answered ${put.status}`);
      }
      return 0;
    } catch (e) {
      this.status.error = e.message || String(e);
      return 0;
    } finally {
      this.busy = false;
    }
  }

  // Uploads queued items. Reads the newest list first so nothing anyone else added is lost.
  async flush() {
    if (this.busy || !this.pending.length || !this.token) return 0;
    this.busy = true;
    const batch = this.pending.splice(0);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const meta = await this.fetch(URL_BASE, { headers: this.headers({ Accept: 'application/vnd.github+json' }) });
        let sha;
        if (meta.ok) sha = (await meta.json()).sha;
        else if (meta.status !== 404) throw new Error(meta.status === 401 || meta.status === 403 ? 'GitHub refused the token. Check that it can write to the repository.' : `GitHub answered ${meta.status}`);
        const list = await this.download();
        const added = mergeItems(list, batch);
        if (!added) { this.items = list; break; }
        const body = { message: `Add items: ${batch.map((b) => b.name).join(', ').slice(0, 180)}`, content: Buffer.from(serialise(list)).toString('base64') };
        if (sha) body.sha = sha;
        const put = await this.fetch(URL_BASE, { method: 'PUT', headers: this.headers({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
        if (put.ok) { this.items = list; this.status.uploaded += added; break; }
        if (put.status !== 409 && put.status !== 422) throw new Error(put.status === 401 || put.status === 403 || put.status === 404 ? 'GitHub refused the upload. The token needs "Contents: read and write" on the item data repository (poeappitemdata).' : `GitHub answered ${put.status}`);
        // someone else changed the file in between: read again and retry
      }
      this.status.count = this.items.length;
      this.status.error = null;
      return batch.length;
    } catch (e) {
      this.pending.unshift(...batch);
      this.status.error = e.message || String(e);
      return 0;
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { SharedItems, mergeItems, parse, serialise, MAX_PER_NAME, MAX_ITEMS, DATA_REPO };
