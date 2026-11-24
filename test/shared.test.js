'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COLS, extractGrid } = require('../src/core/inventory/grid');
const { fingerprint, similarity, IconIndex, packPrint, unpackPrint } = require('../src/core/inventory/icons');
const { InventoryReader } = require('../src/core/inventory/reader');
const { SharedItems, mergeItems, parse, serialise } = require('../src/shared');
const { loadFrame } = require('./helpers');

const map = extractGrid(loadFrame('inv_map'));
const hide = extractGrid(loadFrame('inv_hideout'));
const at = (cells, r, c) => fingerprint(cells[r * COLS + c]);

test('compact encoding keeps pictures recognisable', () => {
  const p = at(map, 0, 0);
  const back = unpackPrint(packPrint(p));
  assert.ok(similarity(p, back) > 0.995);
  assert.ok(packPrint(p).length < 600);
  // a packed picture from one capture still matches the same item in the other capture
  const index = new IconIndex();
  index.setShared(parse(serialise([{ name: 'Scroll', print: p }])));
  assert.equal(index.match(at(hide, 0, 0)).name, 'Scroll');
  assert.equal(index.match(at(hide, 0, 0)).source, 'shared');
  assert.equal(index.match(at(hide, 4, 7)), null);
});

test('ignored items are skipped, suggestions list the closest art', () => {
  const index = new IconIndex();
  index.addArt('A', at(map, 0, 0)); index.addArt('B', at(map, 0, 2)); index.addArt('C', at(map, 3, 2));
  const s = index.suggest(at(hide, 0, 2), 2);
  assert.equal(s.length, 2);
  assert.equal(s[0].name, 'B');
  index.addLearned('', at(map, 0, 2)); // ignore B's picture
  assert.deepEqual(index.match(at(hide, 0, 2)), { ignored: true });
  const reader = new InventoryReader(index);
  const r = reader.read(loadFrame('inv_hideout'));
  assert.ok(r.counts.get('A') >= 25);
  assert.equal(r.counts.has('B'), false);
  assert.equal(r.unknown.some((u) => similarity(u.print, at(hide, 0, 2)) > 0.95), false);
  assert.ok(reader.prints[0]);            // filled cell keeps its fingerprint for Ctrl+C naming
  assert.equal(reader.prints[11], null);  // empty cell
});

test('merging never duplicates a picture and bad shared data is dropped', () => {
  const list = [{ name: 'A', print: at(map, 0, 0) }];
  assert.equal(mergeItems(list, [{ name: 'A again', print: at(hide, 0, 0) }, { name: 'B', print: at(map, 0, 2) }, { name: '', print: at(map, 1, 1) }]), 1);
  assert.deepEqual(list.map((e) => e.name), ['A', 'B']);
  assert.deepEqual(parse('not json'), []);
  assert.deepEqual(parse('{"a":1}'), []);
  assert.equal(parse(JSON.stringify([{ name: 5, print: 'x' }, { name: 'ok', print: packPrint(at(map, 0, 0)) }])).length, 1);
});

test('upload: reads the newest list, adds to it, retries on a conflict, needs a token', async () => {
  let remote = serialise([{ name: 'Theirs', print: at(map, 3, 2) }]);
  let sha = 1, conflictOnce = true;
  const puts = [];
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      assert.equal(opts.headers.Authorization, 'Bearer tok');
      assert.equal(body.branch, 'data');
      if (conflictOnce) { conflictOnce = false; return { ok: false, status: 409 }; }
      assert.equal(body.sha, `s${sha}`);
      remote = Buffer.from(body.content, 'base64').toString(); sha++; puts.push(body.message);
      return { ok: true, status: 200 };
    }
    assert.ok(String(url).includes('ref=data'));
    return opts.headers.Accept.includes('raw')
      ? { ok: true, status: 200, text: async () => remote }
      : { ok: true, status: 200, json: async () => ({ sha: `s${sha}` }) };
  };
  const none = new SharedItems({ fetchImpl });
  none.queue('Mine', at(map, 0, 0));
  assert.equal(await none.flush(), 0); // no token: stays queued

  const s = new SharedItems({ fetchImpl, token: 'tok' });
  await s.load();
  assert.equal(s.items.length, 1);
  s.queue('Mine', at(map, 0, 0));
  assert.equal(await s.flush(), 1);
  assert.deepEqual(parse(remote).map((e) => e.name), ['Theirs', 'Mine']);
  assert.equal(puts.length, 1);
  assert.equal(s.status.uploaded, 1);
  s.queue('Mine again', at(hide, 0, 0)); // same picture: nothing to upload
  await s.flush();
  assert.equal(puts.length, 1);
});

test('reports: uploaded to the data branch under reports/, only with a token', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201 }; };
  await assert.rejects(() => new SharedItems({ fetchImpl }).uploadFile('reports/x.json.gz', Buffer.from('hi'), 'm'), /no token/);
  const s = new SharedItems({ fetchImpl, token: 'tok' });
  assert.equal(await s.uploadFile('reports/snapshot-1.json.gz', Buffer.from('hi'), 'Report'), 'reports/snapshot-1.json.gz');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/contents/reports/snapshot-1.json.gz'));
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.branch, 'data');
  assert.equal(Buffer.from(body.content, 'base64').toString(), 'hi');
  const refused = new SharedItems({ fetchImpl: async () => ({ ok: false, status: 403 }), token: 'tok' });
  await assert.rejects(() => refused.uploadFile('reports/y', Buffer.from('a'), 'm'), /refused/);
});

test('look-alikes: a shared picture of a similar item does not beat the real item', () => {
  // Two real slots that look alike but are different items (similarity about 0.8).
  const real = at(map, 0, 4), alike = at(map, 1, 0);
  const lookalike = similarity(real, alike);
  assert.ok(lookalike > 0.7 && lookalike < 0.9);

  // The friend's PC: the shared list has only the look-alike, art has the real item.
  const index = new IconIndex({ learnedThreshold: 0.75 }); // bar lowered so the look-alike passes, as a closer pair would
  index.setShared([{ name: 'Eldritch Chaos Orb', print: alike }]);
  index.addArt('Chaos Orb', at(hide, 0, 4)); // the same item as `real`, from another capture
  const hit = index.match(real);
  assert.equal(hit.name, 'Chaos Orb');
  assert.equal(hit.source, 'art');

  // Scores too close to call: the cheaper item is taken when prices are known.
  const near = new IconIndex();
  near.addArt('Chaos Orb', real);
  near.setShared([{ name: 'Eldritch Chaos Orb', print: real }]);
  near.priceOf = (n) => ({ 'Chaos Orb': 1, 'Eldritch Chaos Orb': 27 }[n]);
  assert.equal(near.match(real).name, 'Chaos Orb');
  near.priceOf = (n) => ({ 'Chaos Orb': 30, 'Eldritch Chaos Orb': 27 }[n]);
  assert.equal(near.match(real).name, 'Eldritch Chaos Orb');

  // Your own named picture still wins when it is the exact item.
  const own = new IconIndex();
  own.addLearned('Chaos Orb', at(hide, 0, 4));
  own.setShared([{ name: 'Eldritch Chaos Orb', print: alike }]);
  assert.equal(own.match(real).source, 'learned');
  // An ignored picture is still ignored.
  const ign = new IconIndex();
  ign.addLearned('', real);
  assert.deepEqual(ign.match(real), { ignored: true });
});

test('a shared picture with the wrong name is overruled by the downloaded art', () => {
  const chaos = at(map, 0, 4), other = at(map, 1, 0);
  const index = new IconIndex();
  index.setShared([{ name: 'Eldritch Chaos Orb', print: chaos }]); // a Chaos Orb somebody named wrongly
  index.addArt('Chaos Orb', at(hide, 0, 4));
  index.addArt('Eldritch Chaos Orb', other);
  assert.equal(index.match(chaos).name, 'Chaos Orb');

  // No art for the shared name (an item the price site lacks): the shared name stands.
  const bare = new IconIndex();
  bare.setShared([{ name: 'Some League Item', print: chaos }]);
  bare.addArt('Chaos Orb', other);
  assert.equal(bare.match(chaos).name, 'Some League Item');
});

test('re-check: old maps get the names known now, and their loot follows', () => {
  const { recheckCells } = require('../src/core/store');
  const { Session } = require('../src/core/session');
  const cells = [
    { cell: 0, status: 'item', name: 'Eldritch Chaos Orb', qty: 8, carriedQty: 0 },
    { cell: 1, status: 'item', name: 'Eldritch Chaos Orb', qty: 5, carriedQty: 2 },   // 2 were brought in
    { cell: 2, status: 'unknown', name: null, qty: 3 },
    { cell: 3, status: 'item', name: 'The Doctor', qty: 1, source: 'pinned' },        // named by hand
    { cell: 4, status: 'item', name: 'House of Mirrors', qty: 1 },                    // old picture, no source kept
    { cell: 5, status: 'skipped', name: null, qty: 0 },
    { cell: 6, status: 'item', name: 'Divine Orb', qty: 1 },
  ];
  const now = { 0: 'Chaos Orb', 1: 'Chaos Orb', 2: 'Orb of Alteration', 3: 'Chaos Orb', 4: 'Chaos Orb', 5: 'Chaos Orb', 6: 'Divine Orb' };
  const changes = recheckCells(cells, (c) => ({ name: now[c.cell], source: 'shared' }), (name) => name !== 'House of Mirrors');
  assert.deepEqual(changes, [
    { cell: 0, from: 'Eldritch Chaos Orb', to: 'Chaos Orb', qty: 8 },
    { cell: 1, from: 'Eldritch Chaos Orb', to: 'Chaos Orb', qty: 3 },
    { cell: 2, from: null, to: 'Orb of Alteration', qty: 3 },
  ]);
  assert.equal(cells[2].status, 'item');
  assert.equal(cells[3].name, 'The Doctor');
  assert.equal(cells[4].name, 'House of Mirrors');

  const s = new Session();
  s.startRun({ name: 'Jungle Valley' });
  const id = s.currentId;
  s.addLoot([{ name: 'Eldritch Chaos Orb', qty: 6 }], 'inventory');
  s.addLoot([{ name: 'Eldritch Chaos Orb', qty: 7 }], 'inventory');
  s.addLoot([{ name: 'Eldritch Chaos Orb', qty: 1 }], 'manual'); // added by hand: stays
  for (const ch of changes) s.moveLoot(id, ch.from, ch.to, ch.qty);
  const items = Object.fromEntries(s.summary(null).runs[0].items.map((i) => [i.name, i.qty]));
  assert.deepEqual(items, { 'Chaos Orb': 11, 'Eldritch Chaos Orb': 3, 'Orb of Alteration': 3 });
  assert.equal(s.moveLoot(id, 'Nothing Here', 'Chaos Orb', 4), 0);
});

test('your own name for a picture beats the shared list', () => {
  const p = at(map, 0, 4);
  const index = new IconIndex();
  index.setShared([{ name: 'Cheap Thing', print: p }]);
  index.addLearned('Dear Thing', p);
  index.priceOf = (n) => ({ 'Cheap Thing': 1, 'Dear Thing': 50 }[n]);
  const hit = index.match(p);
  assert.equal(hit.name, 'Dear Thing');
  assert.equal(hit.source, 'learned');
});

test('a fingerprint can be shown as a small picture', () => {
  const { printPixels, SIDE } = require('../src/core/inventory/icons');
  const px = printPixels(at(map, 0, 4));
  assert.equal(px.length, SIDE * SIDE * 3);
  assert.deepEqual([...px.subarray(0, 3)], [18, 18, 18]); // the stack number corner stays dark
  const rest = [...px.subarray((SIDE * SIDE - 20) * 3)];
  assert.ok(Math.max(...px) > 200 && new Set(rest).size > 5);
  // The picture still looks like the item: its own fingerprint pattern survives.
  const zero = printPixels(new Float32Array(at(map, 0, 4).length));
  assert.ok(zero.every((v) => v === 18 || v === 120));
});

test('shared list: a wrongly named picture is renamed for everyone, with a token', async () => {
  const chaos = at(map, 0, 4);
  let remote = serialise([{ name: 'Eldritch Chaos Orb', print: chaos }, { name: 'Other', print: at(map, 3, 2) }]);
  const puts = [];
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'PUT') { const body = JSON.parse(opts.body); remote = Buffer.from(body.content, 'base64').toString(); puts.push(body); return { ok: true, status: 200 }; }
    return opts.headers.Accept.includes('raw') ? { ok: true, status: 200, text: async () => remote } : { ok: true, status: 200, json: async () => ({ sha: 's1' }) };
  };
  assert.equal(await new SharedItems({ fetchImpl }).correct(chaos, 'Chaos Orb'), 0); // no token
  const s = new SharedItems({ fetchImpl, token: 'tok' });
  assert.equal(await s.correct(at(hide, 0, 4), 'Chaos Orb'), 1); // the same item from another capture
  assert.deepEqual(parse(remote).map((e) => e.name), ['Chaos Orb', 'Other']);
  assert.equal(puts[0].sha, 's1');
  assert.match(puts[0].message, /Eldritch Chaos Orb -> Chaos Orb/);
  assert.equal(await s.correct(chaos, 'Chaos Orb'), 0); // already right: nothing uploaded
  assert.equal(puts.length, 1);
});

test('sharp second look: look-alikes are told apart on sharp pictures of the same kind', () => {
  const { sharpPrint, sharpShifts } = require('../src/core/inventory/icons');
  const A = map[0 * COLS + 4], B = map[1 * COLS + 0];           // two different items that look alike
  const A2 = hide[0 * COLS + 4], B2 = hide[1 * COLS + 0];       // the same two in another capture
  const sharp = (rgb) => () => sharpShifts(rgb);
  // The same item scores almost exactly on the sharp print, a look-alike clearly lower than on the blur.
  assert.ok(similarity(sharpPrint(A), sharpPrint(A2)) > 0.95);
  assert.ok(similarity(sharpPrint(A), sharpPrint(B2)) < similarity(fingerprint(A), fingerprint(B2)) - 0.05);

  // Both pass the (lowered) bar on the blur; without sharp pictures the cheaper one is taken.
  const index = new IconIndex({ learnedThreshold: 0.75 });
  index.lookalike = 0.3;
  index.priceOf = (n) => ({ Alpha: 50, Beta: 1 }[n]);
  index.addLearned('Alpha', fingerprint(A2), { sharp: sharpPrint(A2), auto: true });
  index.addLearned('Beta', fingerprint(B2), { sharp: sharpPrint(B2), auto: true });
  const a = index.match(fingerprint(A), sharp(A)), b = index.match(fingerprint(B), sharp(B));
  assert.equal(a.name, 'Alpha'); assert.equal(a.sharp, true);
  assert.equal(b.name, 'Beta'); assert.equal(b.sharp, true);

  // Downloaded art settles it when the in-game pictures cannot: the learned picture is of the
  // look-alike, the art of the real item only came close to its bar.
  const art = new IconIndex({ artThreshold: 0.99 });
  art.lookalike = 0.3;
  art.addLearned('Beta', fingerprint(A2), { auto: true });       // learned under the wrong name, no sharp picture
  art.addArt('Alpha', fingerprint(A2), sharpPrint(A2));
  art.addArt('Beta', fingerprint(B2), sharpPrint(B2));
  art.artThreshold = 1.02;                                         // Alpha's art does not pass by itself
  const hit = art.match(fingerprint(A), sharp(A));
  assert.equal(hit.name, 'Alpha'); assert.equal(hit.source, 'art'); assert.equal(hit.sharp, true);

  // A picture you named by hand and that fits exactly is not overruled by downloaded art.
  const own = new IconIndex();
  own.lookalike = 0.3;
  own.addLearned('My Name', fingerprint(A2));
  own.addArt('Alpha', fingerprint(A2), sharpPrint(A2));
  own.addArt('Beta', fingerprint(B2), sharpPrint(B2));
  assert.equal(own.match(fingerprint(A), sharp(A)).name, 'My Name');

  // nearest: the closest names with where they come from.
  const near = own.nearest(fingerprint(A), 2);
  assert.equal(near.length, 2);
  assert.ok(near[0].score >= near[1].score && near[0].source);
});

test('learning by itself: clear reads through downloaded art are saved as they look in game', () => {
  const { sharpPrint } = require('../src/core/inventory/icons');
  const { learnable } = require('../src/core/inventory/reader');
  const { isEmptyCell } = require('../src/core/inventory/grid');
  // "Downloaded art": the hideout capture's slots, each under its own name.
  const index = new IconIndex({ artThreshold: 0.9 });
  hide.forEach((rgb, i) => { if (!isEmptyCell(rgb)) index.addArt(`Item ${i}`, fingerprint(rgb), sharpPrint(rgb)); });
  const reader = new InventoryReader(index);
  const first = reader.read(loadFrame('inv_map'));
  const fresh = learnable(first.cells);
  assert.ok(fresh.length >= 10, `only ${fresh.length} learnable`);
  assert.ok(fresh.every((c) => c.source === 'art' && c.stack > 0 && c.clear));
  for (const c of fresh) index.addLearned(c.name, c.print, { sharp: sharpPrint(c.rgb), auto: true });
  // The next read matches those through the in-game picture, and nothing is learned twice.
  const second = reader.read(loadFrame('inv_map'));
  const again = new Map(second.cells.map((c) => [c.cell, c]));
  for (const c of fresh) { assert.equal(again.get(c.cell).source, 'learned'); assert.equal(again.get(c.cell).name, c.name); assert.ok(again.get(c.cell).score > 0.99); }
  assert.equal(learnable(second.cells).filter((c) => fresh.some((f) => f.cell === c.cell)).length, 0);
  // Every unclear slot keeps its closest names for the hover text.
  assert.ok(first.cells.filter((c) => c.status === 'unknown').every((c) => Array.isArray(c.near)));
});
