'use strict';
// These tests run on crops of two real 1920x1080 captures (map and hideout, inventory open).
const test = require('node:test');
const assert = require('node:assert/strict');

const { COLS, ROWS, gridRect, extractGrid, isEmptyCell, isInventoryOpen } = require('../src/core/inventory/grid');
const { readStack } = require('../src/core/inventory/digits');
const { fingerprint, similarity, IconIndex, compositeOnCell, encodePrint, decodePrint } = require('../src/core/inventory/icons');
const { InventoryReader } = require('../src/core/inventory/reader');
const { LootLedger } = require('../src/core/inventory/ledger');
const { parseExchange, iconUrl } = require('../src/core/prices');
const { loadFrame, TRUTH } = require('./helpers');

const frames = { inv_map: loadFrame('inv_map'), inv_hideout: loadFrame('inv_hideout') };
const each = (name, fn) => {
  const cells = extractGrid(frames[name]);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) fn(TRUTH[name][r][c], cells[r * COLS + c], r, c);
};

test('grid: open inventory is detected, closed is not', () => {
  for (const f of Object.values(frames)) assert.equal(isInventoryOpen(f), true);
  const blank = { data: Buffer.alloc(frames.inv_map.data.length), width: 1920, height: 1080 };
  assert.equal(isInventoryOpen(blank), false);
  const rect = gridRect(1920, 1080);
  assert.equal(isInventoryOpen(frames.inv_map, { ...rect, y0: rect.y0 + 20 }), false);
});

test('grid: every cell is classed empty or occupied correctly', () => {
  for (const name of Object.keys(frames)) {
    each(name, (truth, cell, r, c) => assert.equal(isEmptyCell(cell), truth === null, `${name} ${r},${c}`));
  }
});

test('digits: every stack number in both captures is read correctly', () => {
  let checked = 0;
  for (const name of Object.keys(frames)) {
    each(name, (truth, cell, r, c) => {
      if (truth === null) return;
      assert.equal(readStack(cell), truth === 'x' ? 0 : truth, `${name} ${r},${c}`);
      checked++;
    });
  }
  assert.equal(checked, 80);
});

test('icons: the same item matches across captures, different items do not', () => {
  const map = extractGrid(frames.inv_map), hide = extractGrid(frames.inv_hideout);
  const at = (cells, r, c) => fingerprint(cells[r * COLS + c]);
  // same item, same cell, different stack number
  assert.ok(similarity(at(map, 0, 0), at(hide, 0, 0)) > 0.95);
  // same item in different cells with different numbers (20 vs 8)
  assert.ok(similarity(at(map, 4, 4), at(hide, 1, 8)) > 0.95);
  // look-alike teal items are still told apart
  assert.ok(similarity(at(map, 0, 4), at(map, 1, 0)) < 0.9);
  // an item that only exists in the hideout capture matches nothing from the map capture
  const index = new IconIndex();
  each('inv_map', (truth, cell, r, c) => { if (truth !== null && truth !== 'x') index.addLearned(`item-${r}-${c}`, fingerprint(cell)); });
  assert.equal(index.match(at(hide, 4, 7)), null);
  assert.equal(index.match(at(hide, 3, 8)), null);
  assert.equal(index.match(at(hide, 0, 3)).name, 'item-0-3');
  const p = at(map, 0, 0);
  assert.deepEqual([...decodePrint(encodePrint(p))], [...p]);
});

test('icons: transparent art is placed on the cell background', () => {
  const px = Buffer.alloc(52 * 52 * 4); // fully transparent
  px[0] = 10; px[1] = 20; px[2] = 200; px[3] = 255; // one opaque BGRA pixel
  const rgb = compositeOnCell(px, { bgr: true });
  assert.deepEqual([...rgb.slice(0, 3)], [200, 20, 10]);
  assert.deepEqual([...rgb.slice(3, 6)], [4, 4, 29]);
});

test('reader + ledger: a full map-to-hideout pass counts exactly what was gained', () => {
  // Teach the reader the items in the map capture, one name per distinct picture.
  const index = new IconIndex();
  const names = [];
  each('inv_map', (truth, cell, r, c) => {
    if (truth === null || truth === 'x') return;
    const print = fingerprint(cell);
    const known = names.find((n) => similarity(n.print, print) > 0.95);
    if (!known) { names.push({ name: `item-${r}-${c}`, print }); index.addLearned(`item-${r}-${c}`, print); }
  });
  const reader = new InventoryReader(index);
  const ledger = new LootLedger();

  ledger.enterMap(true);
  const first = reader.read(frames.inv_map);
  assert.equal(first.counts.get('item-0-0'), 26);
  assert.equal(first.counts.get('item-3-2'), 20 + 20 + 20 + 8); // four stacks of one item
  assert.deepEqual(ledger.reading(first.counts), []); // first reading is the baseline

  ledger.leaveMap();
  const second = reader.read(frames.inv_hideout);
  const gains = new Map(ledger.reading(second.counts).map((g) => [g.name, g.qty]));
  assert.equal(gains.get('item-0-2'), 3);   // 4 -> 7
  assert.equal(gains.get('item-2-2'), 12);  // 6 -> 18
  assert.equal(gains.get('item-1-3'), 20);  // a second stack of 20 appeared
  assert.equal(gains.has('item-0-0'), false); // 26 -> 25 is not loot
  assert.ok(second.unknown.length >= 1);    // new items with a stack number are offered for naming
  // already credited: reading the same inventory again adds nothing
  assert.deepEqual(ledger.reading(second.counts), []);
  assert.equal(reader.read({ data: Buffer.alloc(1920 * 1080 * 4), width: 1920, height: 1080 }), null);
});

test('ledger: hideout changes are not loot, repeat trips to one map add up, dips do not double count', () => {
  const m = (o) => new Map(Object.entries(o));
  const l = new LootLedger();
  assert.deepEqual(l.reading(m({ scarab: 4 })), []);            // hideout baseline
  l.enterMap(true);
  assert.deepEqual(l.reading(m({ chaos: 5 })), [{ name: 'chaos', qty: 5 }]);
  assert.deepEqual(l.reading(m({ chaos: 2 })), []);              // briefly hidden stack
  assert.deepEqual(l.reading(m({ chaos: 8 })), [{ name: 'chaos', qty: 3 }]);
  l.leaveMap();
  assert.deepEqual(l.reading(m({ chaos: 9 })), [{ name: 'chaos', qty: 1 }]); // arrival reading still counts
  assert.deepEqual(l.reading(m({ chaos: 9, alt: 2 })), [{ name: 'alt', qty: 2 }]); // a later, cleaner reading still counts
  assert.deepEqual(l.reading(m({})), []);                        // stashed everything: arrival is over
  assert.deepEqual(l.reading(m({ scarab: 4 })), []);             // took scarabs out: not loot
  l.enterMap(false);                                             // back into the same map
  assert.deepEqual(l.reading(m({ scarab: 4, chaos: 6 })), [{ name: 'chaos', qty: 6 }]);
});

test('ledger: a whole map without opening the inventory is counted on arrival, also after a restart', () => {
  const m = (o) => new Map(Object.entries(o));
  const l = new LootLedger();
  l.reading(m({ portal: 40 }));                                  // hideout, before the map
  l.enterMap(true);                                              // map run, inventory never opened
  l.leaveMap();
  const saved = JSON.parse(JSON.stringify(l));                   // app restarted (for example an update)
  const l2 = new LootLedger();
  l2.restore(saved);
  assert.deepEqual(l2.reading(m({ portal: 39, chaos: 12, divine: 1 })), [{ name: 'chaos', qty: 12 }, { name: 'divine', qty: 1 }]);
  // closed in the middle of a map: the next hideout reading still belongs to that map
  const l3 = new LootLedger();
  l3.reading(m({}));
  l3.enterMap(true);
  const l4 = new LootLedger();
  l4.restore(JSON.parse(JSON.stringify(l3)));
  assert.deepEqual(l4.reading(m({ chaos: 3 })), [{ name: 'chaos', qty: 3 }]);
  // nothing saved yet: the first reading can only be a starting point
  const fresh = new LootLedger();
  fresh.restore(null);
  assert.deepEqual(fresh.reading(m({ chaos: 3 })), []);
});

test('prices: item art URLs are carried through', () => {
  assert.equal(iconUrl('/gen/image/abc.png'), 'https://web.poecdn.com/gen/image/abc.png');
  assert.equal(iconUrl('https://web.poecdn.com/x.png'), 'https://web.poecdn.com/x.png');
  assert.equal(iconUrl(undefined), null);
  const ex = parseExchange({ core: { primary: 'chaos', items: [{ id: 'a', name: 'Orb', image: '/i.png' }] }, lines: [{ id: 'a', primaryValue: 2 }] }, 'Currency');
  assert.equal(ex[0].icon, 'https://web.poecdn.com/i.png');
});
