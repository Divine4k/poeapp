'use strict';
// The shared item list: pictures of items as they look in game, with their names, kept in the
// repository on a separate "data" branch (so adding items never triggers an app update).
// Everyone downloads it. Uploading needs a GitHub token with write access to the repository.
const { REPO } = require('./updater');
const { similarity, packPrint, unpackPrint } = require('./core/inventory/icons');

const BRANCH = 'data';
const FILE = 'items.json';
const URL_BASE = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

// Adds entries to a list unless the same picture is already there. Returns how many were added.
function mergeItems(list, additions) {
  let added = 0;
  for (const a of additions) {
    if (!a || !a.name || !a.print) continue;
    if (list.some((e) => similarity(e.print, a.print) > 0.97)) continue;
    list.push({ name: a.name, print: a.print });
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
    try { out.push({ name: r.name, print: unpackPrint(r.print) }); } catch (_) { /* skip a broken entry */ }
  }
  return out;
};
const serialise = (list) => JSON.stringify(list.map((e) => ({ name: e.name, print: packPrint(e.print) })), null, 0);

class SharedItems {
  constructor({ fetchImpl, token = '' }) {
    this.fetch = fetchImpl;
    this.token = token;
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
    const res = await this.fetch(`${URL_BASE}?ref=${BRANCH}`, { headers: this.headers({ Accept: 'application/vnd.github.raw+json' }) });
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

  queue(name, print) { this.pending.push({ name, print }); }

  // Uploads queued items. Reads the newest list first so nothing anyone else added is lost.
  async flush() {
    if (this.busy || !this.pending.length || !this.token) return 0;
    this.busy = true;
    const batch = this.pending.splice(0);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const meta = await this.fetch(`${URL_BASE}?ref=${BRANCH}`, { headers: this.headers({ Accept: 'application/vnd.github+json' }) });
        let sha;
        if (meta.ok) sha = (await meta.json()).sha;
        else if (meta.status !== 404) throw new Error(meta.status === 401 || meta.status === 403 ? 'GitHub refused the token. Check that it can write to the repository.' : `GitHub answered ${meta.status}`);
        const list = await this.download();
        const added = mergeItems(list, batch);
        if (!added) { this.items = list; break; }
        const body = { message: `Add items: ${batch.map((b) => b.name).join(', ').slice(0, 180)}`, branch: BRANCH, content: Buffer.from(serialise(list)).toString('base64') };
        if (sha) body.sha = sha;
        const put = await this.fetch(URL_BASE, { method: 'PUT', headers: this.headers({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
        if (put.ok) { this.items = list; this.status.uploaded += added; break; }
        if (put.status !== 409 && put.status !== 422) throw new Error(put.status === 401 || put.status === 403 || put.status === 404 ? 'GitHub refused the upload. The token needs "Contents: read and write" on the repository.' : `GitHub answered ${put.status}`);
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

module.exports = { SharedItems, mergeItems, parse, serialise };
