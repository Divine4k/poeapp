'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SnapshotStore, SessionArchive, markCarried, MAX_TRIPS } = require('../src/core/store');
const { Session } = require('../src/core/session');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-'));
const cells = (n, qty = 1) => Array.from({ length: n }, (_, k) => ({ cell: k, status: 'item', name: 'Chaos Orb', qty }));

test('snapshots: newest reading wins in the map, the fullest one once stashing starts', () => {
  const dir = tmp();
  const s = new SnapshotStore(dir);
  assert.equal(s.record('run/1', 1, { at: 1, cells: [], image: 'a' }), false); // nothing to show
  assert.equal(s.record('run/1', 1, { at: 1, cells: cells(5), image: 'a' }), true);
  assert.equal(s.wants('run/1', 1, cells(5)), false); // the same reading again
  assert.equal(s.record('run/1', 1, { at: 2, cells: cells(4), image: 'b' }), true); // in the map: newest
  assert.equal(s.record('run/1', 1, { at: 3, cells: cells(6, 3), image: 'c' }), true);
  // back in the hideout: emptier readings are stashing, a fuller one is the arrival
  assert.equal(s.record('run/1', 1, { at: 4, cells: cells(2), image: 'd', growing: false }), false);
  assert.equal(s.record('run/1', 1, { at: 5, cells: cells(7), image: 'e', growing: false }), true);
  // a second trip into the same map keeps its own picture
  assert.equal(s.record('run/1', 2, { at: 6, cells: cells(1), image: 'f' }), true);

  const again = new SnapshotStore(dir).get('run/1'); // read back from disk
  assert.deepEqual(again.trips.map((t) => [t.trip, t.image, t.filled]), [[1, 'e', 7], [2, 'f', 1]]);
  assert.deepEqual(again.trips[1].cells, [{ cell: 0, status: 'item', name: 'Chaos Orb', qty: 1, source: null, carried: false, carriedQty: 0 }]);

  for (let t = 3; t < 12; t++) s.record('run/1', t, { at: t, cells: cells(1), image: 'x' });
  assert.equal(s.get('run/1').trips.length, MAX_TRIPS);
  s.remove('run/1');
  assert.deepEqual(new SnapshotStore(dir).get('run/1').trips, []);
  assert.deepEqual(s.get('never-read').trips, []);
});

test('sessions: a finished session is saved with its values frozen and can be read back and deleted', () => {
  const dir = tmp();
  let t = 1_000_000;
  const s = new Session({ now: () => t });
  let price = 200;
  const prices = { chaosOf: (n) => (n === 'Divine Orb' ? price : 1), get divine() { return price; } };
  const archive = new SessionArchive(dir);
  assert.deepEqual(archive.list(), []);
  assert.equal(archive.save(s.summary(prices), t), null); // no maps: nothing to save

  s.startRun({ name: 'Dunes' });
  s.nextTrip(); s.nextTrip();
  assert.equal(s.current.trip, 2);
  s.markSnapshot(s.currentId);
  s.addLoot([{ name: 'Divine Orb', qty: 2 }], 'inventory');
  t += 600_000;
  s.endRun();
  assert.equal(s.summary(prices).runs[0].snapAt, 1_000_000);
  const saved = archive.save(s.summary(prices), t, { strategyId: 'legion' });
  assert.equal(archive.list()[0].strategyId, 'legion');
  assert.equal(saved.totals.net, 400);
  assert.equal(saved.runs[0].seen, undefined);

  price = 50; // prices move afterwards; the saved session does not
  const fresh = new SessionArchive(dir);
  assert.equal(fresh.list().length, 1);
  assert.equal(fresh.list()[0].totals.net, 400);
  const full = fresh.get(saved.id);
  assert.equal(full.divine, 200);
  assert.equal(full.strategyId, 'legion');
  assert.equal(fresh.list()[0].strategyId, 'legion');
  assert.equal(full.runs[0].name, 'Dunes');
  assert.equal(full.runs[0].items[0].chaos, 400);
  assert.equal(full.endedAt, t);

  assert.deepEqual(fresh.remove(saved.id), [full.runs[0].id]);
  assert.deepEqual(fresh.list(), []);
  assert.deepEqual(new SessionArchive(dir).list(), []);
  assert.equal(fresh.get(saved.id), null);
});

test('snapshots: what was taken into the map is marked slot by slot', () => {
  const same = (a, b) => a === b;
  const base = [
    { cell: 0, name: 'Portal Scroll', qty: 20, print: 'p' },
    { cell: 1, name: 'Chaos Orb', qty: 10, print: 'c' },
    { cell: 2, name: null, qty: 0, print: 'wand' },
    { cell: 3, name: null, qty: 0, print: 'ring' },
    { cell: 4, name: 'Vaal Orb', qty: 3, print: 'v' },
  ];
  const now = [
    { cell: 0, status: 'item', name: 'Portal Scroll', qty: 19, print: 'p' }, // one used: still all carried
    { cell: 1, status: 'item', name: 'Chaos Orb', qty: 25, print: 'c' },     // grew: partly loot
    { cell: 2, status: 'skipped', name: null, qty: 0, print: 'wand' },       // same single item
    { cell: 3, status: 'skipped', name: null, qty: 0, print: 'amulet' },     // a different item in that slot
    { cell: 4, status: 'item', name: 'Exalted Orb', qty: 3, print: 'e' },    // slot now holds something else
    { cell: 5, status: 'item', name: 'Divine Orb', qty: 1, print: 'd' },     // new slot
  ];
  const out = markCarried(now, base, same);
  assert.deepEqual(out.map((c) => [c.carried, c.carriedQty]), [[true, 19], [false, 10], [true, 1], [false, 0], [false, 0], [false, 0]]);
  assert.deepEqual(markCarried(now, null, same).map((c) => c.carried), [false, false, false, false, false, false]);

  const s = new SnapshotStore(tmp());
  s.record('r', 1, { at: 1, cells: out, image: 'a' });
  assert.deepEqual(s.get('r').trips[0].cells[0], { cell: 0, status: 'item', name: 'Portal Scroll', qty: 19, source: null, carried: true, carriedQty: 19 });
});
