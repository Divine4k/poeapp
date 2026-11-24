'use strict';
// Items the reader saw but could not name, kept until they are named, ignored or dismissed,
// so they can be looked at after they have left the inventory.

class Backlog {
  // similar(a, b): whether two picture fingerprints show the same item.
  constructor({ similar, max = 40, now = () => Date.now() }) {
    this.similar = similar;
    this.max = max;
    this.now = now;
    this.items = []; // [{ id, qty, print, at, here, ...extra }]
    this.seq = 1;
  }

  // found: what the latest reading could not name, [{ qty, print, ... }]. extra(f) gives the
  // fields to keep with a new item (its picture, name suggestions); it is only called for
  // items not in the list yet. Returns true when an item was added or dropped.
  update(found, extra = () => ({})) {
    const at = this.now();
    let changed = false;
    for (const it of this.items) it.here = false;
    for (const f of found) {
      const prev = this.items.find((o) => this.similar(o.print, f.print));
      if (prev) {
        if (!prev.here) { prev.here = true; prev.qty = f.qty; prev.at = at; } // the same item in several slots counts once
        continue;
      }
      this.items.push({ ...extra(f), id: this.seq++, qty: f.qty, print: f.print, at, here: true });
      changed = true;
    }
    // In the inventory now first, then the most recently seen. Over the limit, the oldest go.
    this.items.sort((a, b) => (b.here - a.here) || (b.at - a.at) || (a.id - b.id));
    if (this.items.length > this.max) { this.items.length = this.max; changed = true; }
    return changed;
  }

  // The item with this picture has been named or ignored.
  resolve(print) {
    const n = this.items.length;
    this.items = this.items.filter((u) => !this.similar(u.print, print));
    return this.items.length !== n;
  }

  get(id) { return this.items.find((x) => String(x.id) === String(id)) || null; }
  remove(id) { const n = this.items.length; this.items = this.items.filter((x) => String(x.id) !== String(id)); return this.items.length !== n; }
  clear() { const had = this.items.length > 0; this.items = []; return had; }

  // encode/decode turn a fingerprint into text and back, for the file on disk.
  save(encode) { return this.items.map((u) => ({ ...u, here: false, print: encode(u.print) })); }
  load(list, decode) {
    this.items = [];
    for (const u of Array.isArray(list) ? list : []) {
      try { this.items.push({ ...u, here: false, print: decode(u.print) }); } catch (_) { /* skip a broken entry */ }
    }
    this.seq = this.items.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0) + 1;
  }
}

module.exports = { Backlog };
