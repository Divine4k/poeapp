'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Backlog } = require('../src/core/inventory/backlog');

test('backlog: unrecognised items stay after they leave the inventory, until named or dismissed', () => {
  let t = 100;
  const b = new Backlog({ similar: (x, y) => x === y, max: 3, now: () => t });
  const extra = (f) => ({ image: `img-${f.print}` });

  assert.equal(b.update([{ qty: 3, print: 'a' }, { qty: 9, print: 'a' }, { qty: 1, print: 'b' }], extra), true);
  assert.deepEqual(b.items.map((u) => [u.id, u.print, u.qty, u.here, u.image]), [[1, 'a', 3, true, 'img-a'], [2, 'b', 1, true, 'img-b']]);

  t = 200; // stashed: nothing unknown in the inventory any more
  assert.equal(b.update([], extra), false);
  assert.deepEqual(b.items.map((u) => [u.print, u.here, u.at]), [['a', false, 100], ['b', false, 100]]);

  t = 300; // b is picked up again with a bigger stack, c is new
  assert.equal(b.update([{ qty: 5, print: 'b' }, { qty: 2, print: 'c' }], extra), true);
  assert.deepEqual(b.items.map((u) => [u.id, u.print, u.qty, u.here]), [[2, 'b', 5, true], [3, 'c', 2, true], [1, 'a', 3, false]]);

  t = 400; // over the limit the oldest one that is gone is dropped
  assert.equal(b.update([{ qty: 1, print: 'd' }, { qty: 1, print: 'b' }, { qty: 1, print: 'c' }], extra), true);
  assert.deepEqual(b.items.map((u) => u.print).sort(), ['b', 'c', 'd']);

  assert.equal(b.resolve('c'), true); // named
  assert.equal(b.resolve('c'), false);
  assert.equal(b.get(2).print, 'b');
  assert.equal(b.remove(2), true); // dismissed
  assert.deepEqual(b.items.map((u) => u.print), ['d']);

  // survives a restart, and new ids carry on after the saved ones
  const saved = JSON.parse(JSON.stringify(b.save((p) => `enc:${p}`)));
  const again = new Backlog({ similar: (x, y) => x === y, now: () => 500 });
  again.load([...saved, { id: 9, print: null }], (p) => { if (!p) throw new Error('broken'); return p.slice(4); });
  assert.deepEqual(again.items.map((u) => [u.id, u.print, u.here]), [[4, 'd', false]]);
  again.update([{ qty: 1, print: 'e' }]);
  assert.equal(again.get(5).print, 'e');
  assert.equal(again.clear(), true);
  assert.equal(again.clear(), false);
});
