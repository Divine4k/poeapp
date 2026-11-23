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
