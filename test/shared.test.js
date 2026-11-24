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
