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

// Teaches an index every distinct picture in the map capture under a made-up name.
function taughtIndex() {
  const index = new IconIndex();
  const names = [];
  each('inv_map', (truth, cell, r, c) => {
    if (truth === null || truth === 'x') return;
    const print = fingerprint(cell);
    if (!names.find((n) => similarity(n.print, print) > 0.95)) { names.push({ print }); index.addLearned(`item-${r}-${c}`, print); }
  });
  return index;
}
const asReading = (r) => ({ counts: r.counts, cells: r.cells.filter((c) => c.name).map((c) => ({ cell: c.cell, name: c.name, qty: c.qty })), empties: r.empties });

test('reader + ledger: a full map-to-hideout pass counts exactly what was gained', () => {
  const reader = new InventoryReader(taughtIndex());
  const ledger = new LootLedger();

  ledger.enterMap();
  const first = reader.read(frames.inv_map);
  assert.equal(first.counts.get('item-0-0'), 26);
  assert.equal(first.counts.get('item-3-2'), 20 + 20 + 20 + 8); // four stacks of one item
  assert.equal(first.empties.length, 60 - 36);
  assert.deepEqual(ledger.reading(asReading(first)), []); // first reading is the baseline

  ledger.leaveMap();
  const second = reader.read(frames.inv_hideout);
  const gains = new Map(ledger.reading(asReading(second)).map((g) => [g.name, g.qty]));
  assert.equal(gains.get('item-0-2'), 3);   // 4 -> 7
  assert.equal(gains.get('item-2-2'), 12);  // 6 -> 18
  assert.equal(gains.get('item-1-3'), 20);  // a second stack of 20 appeared
  assert.equal(gains.has('item-0-0'), false); // 26 -> 25 is not loot
  assert.ok(second.unknown.length >= 1);    // new items with a stack number are offered for naming
  // already credited: reading the same inventory again adds nothing
  assert.deepEqual(ledger.reading(asReading(second)), []);
  assert.equal(reader.read({ data: Buffer.alloc(1920 * 1080 * 4), width: 1920, height: 1080 }), null);
});

test('reader: slots near the mouse keep what was known, slots counted by hand stay counted', () => {
  const reader = new InventoryReader(taughtIndex());
  const clean = reader.read(frames.inv_map);
  const total = clean.counts.get('item-0-0');

  // Black out the top two rows as a tooltip would, with the mouse on row 3 (index 2).
  const covered = { ...frames.inv_map, data: Buffer.from(frames.inv_map.data) };
  const rect = gridRect(1920, 1080);
  for (let y = Math.floor(rect.y0); y < rect.y0 + rect.cell * 2; y++) covered.data.fill(0, (y * 1920 + Math.floor(rect.x0)) * 4, (y * 1920 + 1903) * 4);
  const hover = reader.read(covered, { cursor: { row: 2, col: 3 } });
  assert.equal(hover.counts.get('item-0-0'), total);            // still counted from memory
  assert.equal(hover.empties.some((k) => k < 24), false);        // nothing in the covered rows is called empty
  assert.equal(hover.unknown.length, 0);
  // Without the mouse there, the same picture means those slots really are empty now.
  const gone = reader.read(covered);
  assert.equal(gone.counts.has('item-0-0'), false);
  assert.ok(gone.empties.includes(0));

  // A slot counted by hand: the unrecognised single item at row 2, column 1 of the map capture.
  const r2 = new InventoryReader(taughtIndex());
  r2.index.forget('item-1-0');
  const before = r2.read(frames.inv_map);
  assert.equal(before.cells.find((c) => c.cell === 12).status, 'skipped');
  assert.equal(r2.pin(12, 'Strand Map (T16)', 1), true);
  const after = r2.read(frames.inv_map);
  assert.equal(after.counts.get('Strand Map (T16)'), 1);
  assert.equal(after.cells.find((c) => c.cell === 12).source, 'pinned');
  assert.equal(r2.pin(59, 'Nothing', 1), false);                 // empty slot: nothing to count
  // the slot's content changes: the hand count is dropped
  const other = r2.read(frames.inv_hideout);
  assert.equal(other.counts.get('Strand Map (T16)'), 1);         // same item still there in the second capture
  r2.pins[12].print = fingerprint(extractGrid(frames.inv_map)[0]);
  assert.equal(r2.read(frames.inv_hideout).counts.has('Strand Map (T16)'), false);
});

// Builds a reading from { name: qty } with every item in its own fixed slot.
const SLOT = { portal: 0, chaos: 1, divine: 2, alt: 3, scarab: 4, thread: 5 };
function obs(items, hidden = []) {
  const counts = new Map(Object.entries(items));
  const cells = Object.entries(items).map(([name, qty]) => ({ cell: SLOT[name], name, qty }));
  const used = new Set([...cells.map((c) => c.cell), ...hidden.map((n) => SLOT[n])]);
  const empties = [];
  for (let k = 0; k < 60; k++) if (!used.has(k)) empties.push(k);
  return { counts, cells, empties };
}

test('ledger: in a map only the highest count is credited', () => {
  const l = new LootLedger();
  assert.deepEqual(l.reading(obs({ scarab: 4 })), []);           // hideout: starting point
  l.enterMap();
  assert.deepEqual(l.reading(obs({ chaos: 5 })), [{ name: 'chaos', qty: 5 }]);
  assert.deepEqual(l.reading(obs({ chaos: 2 })), []);             // briefly hidden stack
  assert.deepEqual(l.reading(obs({ chaos: 8 })), [{ name: 'chaos', qty: 3 }]);
});

test('ledger: on arrival each slot counts the first time it is seen, even while stashing', () => {
  const l = new LootLedger();
  l.reading(obs({ portal: 40 }));
  l.enterMap();                                                    // inventory never opened in the map
  l.leaveMap();
  // first look: the tooltip hides the divine slot
  assert.deepEqual(l.reading(obs({ portal: 39, chaos: 12 }, ['divine'])), [{ name: 'chaos', qty: 12 }]);
  // chaos already stashed, divine now visible: it still counts
  assert.deepEqual(l.reading(obs({ portal: 39, divine: 1 })), [{ name: 'divine', qty: 1 }]);
  // everything stashed
  assert.deepEqual(l.reading(obs({ portal: 39 })), []);
  // threads taken out of the stash into a slot that was seen empty: not loot
  assert.deepEqual(l.reading(obs({ portal: 39, thread: 6 })), []);
  // chaos taken back out into its old slot: not loot either
  assert.deepEqual(l.reading(obs({ portal: 39, thread: 6, chaos: 3 })), []);
  l.enterMap();                                                    // next map starts from what is there now
  assert.deepEqual(l.reading(obs({ portal: 39, thread: 6, chaos: 9 })), [{ name: 'chaos', qty: 6 }]);
});

test('ledger: several maps on one inventory, and repeat trips to one map', () => {
  const l = new LootLedger();
  l.reading(obs({}));
  l.enterMap();
  l.leaveMap();
  assert.deepEqual(l.reading(obs({ chaos: 5 })), [{ name: 'chaos', qty: 5 }]); // map A, kept in the inventory
  l.enterMap();                                                    // map B without stashing
  assert.deepEqual(l.reading(obs({ chaos: 9 })), [{ name: 'chaos', qty: 4 }]);
  l.leaveMap();
  assert.deepEqual(l.reading(obs({ chaos: 9, alt: 2 })), [{ name: 'alt', qty: 2 }]);
  assert.deepEqual(l.reading(obs({})), []);                        // stashed
  l.enterMap();                                                    // back into the same map
  assert.deepEqual(l.reading(obs({ chaos: 6 })), [{ name: 'chaos', qty: 6 }]);
  // never opened the inventory in the hideout: the next map still only counts what is new
  l.leaveMap();
  l.enterMap();
  assert.deepEqual(l.reading(obs({ chaos: 8 })), [{ name: 'chaos', qty: 2 }]);
});

test('ledger: survives a restart, also in the middle of a map', () => {
  const l = new LootLedger();
  l.reading(obs({ portal: 40 }));
  l.enterMap();
  l.leaveMap();
  const l2 = new LootLedger();
  l2.restore(JSON.parse(JSON.stringify(l)));                       // app restarted (for example an update)
  assert.deepEqual(l2.reading(obs({ portal: 39, chaos: 12, divine: 1 })), [{ name: 'chaos', qty: 12 }, { name: 'divine', qty: 1 }]);
  const l3 = new LootLedger();
  l3.reading(obs({}));
  l3.enterMap();
  const l4 = new LootLedger();
  l4.restore(JSON.parse(JSON.stringify(l3)));                      // closed mid-map
  assert.deepEqual(l4.reading(obs({ chaos: 3 })), [{ name: 'chaos', qty: 3 }]);
  const fresh = new LootLedger();
  fresh.restore(null);
  assert.deepEqual(fresh.reading(obs({ chaos: 3 })), []);          // nothing saved: only a starting point
});

test('prices: item art URLs are carried through', () => {
  assert.equal(iconUrl('/gen/image/abc.png'), 'https://web.poecdn.com/gen/image/abc.png');
  assert.equal(iconUrl('https://web.poecdn.com/x.png'), 'https://web.poecdn.com/x.png');
  assert.equal(iconUrl(undefined), null);
  const ex = parseExchange({ core: { primary: 'chaos', items: [{ id: 'a', name: 'Orb', image: '/i.png' }] }, lines: [{ id: 'a', primaryValue: 2 }] }, 'Currency');
  assert.equal(ex[0].icon, 'https://web.poecdn.com/i.png');
});

test('digits: numbers on bright icons are still read', () => {
  const fs = require('fs'), path = require('path');
  // a "2" on an Exalted Orb, cut from a capture where the first version of the reader saw no number
  assert.equal(readStack(fs.readFileSync(path.join(__dirname, 'fixtures', 'stack2_on_gold.rgb'))), 2);
  // every real cell again, with everything except the digits and a thin outline painted bright
  const C = 52;
  const brighten = (cell) => {
    const out = Buffer.from(cell);
    const min = (i, j) => Math.min(cell[(j * C + i) * 3], cell[(j * C + i) * 3 + 1], cell[(j * C + i) * 3 + 2]);
    for (let j = 0; j < 26; j++) for (let i = 0; i < C; i++) {
      let near = false;
      for (let dj = -2; dj <= 2 && !near; dj++) for (let di = -2; di <= 2; di++) {
        const x = i + di, y = j + dj;
        if (x >= 0 && y >= 0 && x < C && y < C && min(x, y) > 150) { near = true; break; }
      }
      if (!near) { const p = (j * C + i) * 3; out[p] = 235; out[p + 1] = 215; out[p + 2] = 190; }
    }
    return out;
  };
  let checked = 0;
  for (const name of Object.keys(frames)) {
    each(name, (truth, cell, r, c) => {
      if (truth === null || truth === 'x' || truth === 0) return;
      assert.equal(readStack(brighten(cell)), truth, `${name} ${r},${c}`);
      checked++;
    });
  }
  assert.equal(checked, 62);
});
