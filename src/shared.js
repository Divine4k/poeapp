'use strict';
// The item database everyone shares: pictures of items as they look in game, each with its
// name and who gave it that name. It lives on the Map Companion server. Everyone downloads it;
// adding to it needs an account (see cloud.js), and what you add is signed with your name.
const { similarity, packPrint, unpackPrint } = require('./core/inventory/icons');

// The list cannot grow without end: an item always looks the same, so a few pictures per item
// are all there is to know. With every stackable item of the game in it, at these limits, the
// file stays under about 3 MB. The server holds the same limits.
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
    // id: what the server calls this entry, for renaming and removing it.
    try { out.push({ id: typeof r.id === 'string' ? r.id : '', name: r.name, print: unpackPrint(r.print), by: typeof r.by === 'string' ? r.by.slice(0, 40) : '', auto: !!r.auto, at: Number(r.at) || 0 }); } catch (_) { /* skip a broken entry */ }
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

const AT_ONCE = 50; // entries the server takes in one request
const NOT_YOURS = 'Only the person who added a picture, or the owner of the item list, can change it for everyone.';

class SharedItems {
  // cloud: the account (cloud.js). Reading the list needs no login; changing it does.
  constructor({ cloud }) {
    this.cloud = cloud;
    this.items = [];
    this.pending = [];
    this.busy = false;
    this.etag = null;
    this.status = { count: 0, loadedAt: 0, error: null, uploaded: 0 };
  }

  get canUpload() { return !!this.cloud && this.cloud.signedIn; }
  // The name your additions are signed with: the server puts your account name on them.
  get by() { return this.canUpload ? this.cloud.name : ''; }

  // The newest list. An unchanged list (HTTP 304) costs next to nothing, so this is cheap to repeat.
  async download() {
    if (!this.cloud || !this.cloud.enabled) return this.items;
    const headers = this.etag ? { 'If-None-Match': this.etag } : {};
    const res = await this.cloud.fetch(`${this.cloud.url}/v1/items`, { headers });
    if (res.status === 304) return this.items;
    if (!res.ok) throw new Error(`The item database answered ${res.status}`);
    const list = parse(await res.text());
    this.etag = res.headers && res.headers.get ? res.headers.get('etag') : null;
    return list;
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
    this.pending.push({ name, print, auto, at: Date.now() });
  }

  // Sends one file for troubleshooting (a report of what the app saw). Needs an account.
  async uploadFile(name, buffer) {
    if (!this.canUpload) throw new Error('not logged in');
    const res = await this.cloud.fetch(`${this.cloud.url}/v1/reports/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${this.cloud.token}`, 'Content-Type': 'application/octet-stream' }, body: buffer,
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Log in again to send reports.' : `The server answered ${res.status}`);
    return name;
  }

  async post(route, body) {
    const r = await this.cloud.call('POST', route, { body });
    if (r.status === 401) { this.cloud.settled(r); throw new Error('Log in again: this PC is no longer signed in.'); }
    if (!r.ok) throw new Error(r.error);
    return r.data || {};
  }

  // Renames or removes the entries of the newest list that pick() chooses, for everyone.
  // Returns how many were changed. this.refused says how many were not yours to change.
  async change(what, pick, extra = {}) {
    this.refused = 0;
    if (!this.canUpload || this.busy) return 0;
    this.busy = true;
    try {
      const list = await this.download();
      this.items = list;
      const ids = pick(list).map((e) => e.id).filter(Boolean).slice(0, AT_ONCE);
      if (!ids.length) return 0;
      const done = await this.post(`items/${what}`, { ids, ...extra });
      this.refused = done.refused || 0;
      if (done.changed) { this.items = await this.download(); this.status.count = this.items.length; }
      this.status.error = this.refused && !done.changed ? NOT_YOURS : null;
      return done.changed || 0;
    } catch (e) {
      this.status.error = e.message || String(e);
      return 0;
    } finally {
      this.busy = false;
    }
  }

  // Renames a picture in the shared list that was uploaded under the wrong name.
  correct(print, name) {
    if (!name) return Promise.resolve(0);
    return this.change('rename', (list) => list.filter((e) => e.name !== name && similarity(e.print, print) > 0.97), { name });
  }

  // Takes pictures out of the database for everyone.
  remove(print) { return this.removeMany([print]); }
  removeMany(prints) {
    if (!prints.length) return Promise.resolve(0);
    return this.change('remove', (list) => list.filter((e) => prints.some((p) => similarity(e.print, p) > 0.97)));
  }

  // Uploads queued items. Reads the newest list first, so a picture someone else already
  // added is not sent again. Returns how many of the queue were dealt with.
  async flush() {
    if (this.busy || !this.pending.length || !this.canUpload) return 0;
    this.busy = true;
    const batch = this.pending.splice(0);
    try {
      const list = await this.download();
      const known = list.length;
      mergeItems(list, batch);
      const fresh = list.slice(known);
      let added = 0;
      for (let i = 0; i < fresh.length; i += AT_ONCE) {
        const part = fresh.slice(i, i + AT_ONCE).map((e) => ({ name: e.name, print: packPrint(e.print), auto: e.auto ? 1 : undefined }));
        added += (await this.post('items', { add: part })).added || 0;
      }
      this.items = added ? await this.download() : list.slice(0, known);
      this.status.uploaded += added;
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

module.exports = { SharedItems, mergeItems, parse, serialise, MAX_PER_NAME, MAX_ITEMS };
