'use strict';
// These tests run on crops of two real 1920x1080 captures (map and hideout, inventory open).
const test = require('node:test');
const assert = require('node:assert/strict');

const { COLS, ROWS, gridRect, extractGrid, isEmptyCell, isInventoryOpen, coveredCells } = require('../src/core/inventory/grid');
const { readStack } = require('../src/core/inventory/digits');
const { fingerprint, similarity, IconIndex, compositeOnCell, encodePrint, decodePrint } = require('../src/core/inventory/icons');
const { InventoryReader } = require('../src/core/inventory/reader');
const { LootLedger } = require('../src/core/inventory/ledger');
const { parseExchange, iconUrl } = require('../src/core/prices');
const { loadFrame, TRUTH } = require('./helpers');

const frames = { inv_map: loadFrame('inv_map'), inv_hideout: loadFrame('inv_hideout') };
const tooltipFrame = loadFrame('inv_tooltip'); // a later capture: sixteen map tiers, and a tooltip over the left half
const { readMapTier } = require('../src/core/inventory/maps');
const each = (name, fn) => {
  const cells = extractGrid(frames[name]);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) fn(TRUTH[name][r][c], cells[r * COLS + c], r, c);
};

test('grid: open inventory is detected, closed is not', () => {
  for (const f of Object.values(frames)) assert.equal(isInventoryOpen(f), true);
  assert.equal(isInventoryOpen(tooltipFrame), true); // a tooltip covers half of the frame bar
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
  // Without the mouse there it is the same: black grid lines are something lying over the
  // slots, not empty slots (those keep their lit lines).
  const still = reader.read(covered);
  assert.equal(still.counts.get('item-0-0'), total);
  assert.equal(still.empties.some((k) => k < 24), false);
  assert.equal(still.hidden, 24);

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

test('reader: a covered slot that still holds its item keeps its clean picture, not the tooltip', () => {
  const reader = new InventoryReader(taughtIndex());
  const clean = reader.read(frames.inv_map);
  const before = new Map(clean.cells.filter((c) => c.status === 'item').map((c) => [c.cell, c]));
  // A tooltip over the top two rows (blacked out), and tooltip text over one slot of row 3.
  const covered = { ...frames.inv_map, data: Buffer.from(frames.inv_map.data) };
  const rect = gridRect(1920, 1080);
  for (let y = Math.floor(rect.y0); y < rect.y0 + rect.cell * 2; y++) covered.data.fill(0, (y * 1920 + Math.floor(rect.x0)) * 4, (y * 1920 + 1903) * 4);
  const texted = [...before.keys()].find((k) => k >= 24 && k < 36);
  if (texted !== undefined) {
    const x0 = Math.floor(rect.x0 + (texted % COLS) * rect.cell), y0 = Math.floor(rect.y0 + 2 * rect.cell);
    for (let y = y0 + 8; y < y0 + rect.cell - 8; y += 3) covered.data.fill(255, (y * 1920 + x0) * 4, (y * 1920 + x0 + Math.floor(rect.cell)) * 4);
  }
  const hover = reader.read(covered, { cursor: { row: 2, col: 11 } });
  let checked = 0;
  for (const c of hover.cells) {
    const was = before.get(c.cell);
    if (!was || c.cell >= 24 && c.cell !== texted) continue;
    if (c.cell === texted && c.name !== was.name) continue; // the text hid it too much to be named: fine either way
    assert.equal(Buffer.compare(c.rgb, was.rgb), 0, `slot ${c.cell} shows the clean picture`);
    assert.equal(c.print, was.print);
    checked++;
  }
  assert.ok(checked > 0);
  // Read clearly again: the pictures are the ones on screen.
  const again = reader.read(frames.inv_map);
  for (const c of again.cells) if (before.has(c.cell)) assert.equal(c.cleanView, undefined);
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

test('ledger: loot that looked carried in can be counted after all', () => {
  // Trip 1 finds 10 chaos. The inventory is stashed but never seen empty, so trip 2 starts
  // from the old baseline and its 6 chaos look like the same 10.
  const l = new LootLedger();
  l.reading(obs({ portal: 40 }));
  l.enterMap();
  assert.deepEqual(l.reading(obs({ portal: 40, chaos: 10 })), [{ name: 'chaos', qty: 10 }]);
  l.leaveMap();
  l.enterMap(); // no hideout reading in between
  assert.deepEqual(l.reading(obs({ portal: 39, chaos: 6 })), []);
  l.markLoot('chaos', 6); // added by hand
  assert.deepEqual(l.reading(obs({ portal: 39, chaos: 6 })), []);
  assert.deepEqual(l.reading(obs({ portal: 39, chaos: 14 })), [{ name: 'chaos', qty: 8 }]);
  // Back in the hideout the same works on what was first seen there.
  l.leaveMap();
  assert.deepEqual(l.reading(obs({ portal: 39, chaos: 14 })), []);
  l.markLoot('portal', 39); // a mistake on purpose: all 39 were really taken in
  assert.deepEqual(l.reading(obs({ portal: 39, chaos: 14 })), []);

  // A stack really brought in, marked as loot: it no longer holds back what grows on it.
  const m = new LootLedger();
  m.reading(obs({ chaos: 10 }));
  m.enterMap();
  assert.deepEqual(m.reading(obs({ chaos: 13 })), [{ name: 'chaos', qty: 3 }]);
  m.markLoot('chaos', 10);
  assert.deepEqual(m.reading(obs({ chaos: 20 })), [{ name: 'chaos', qty: 7 }]);
  // Before any reading of the map there is nothing to go by.
  const f = new LootLedger();
  f.markLoot('chaos', 3);
  assert.equal(f.baseline, null);
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

test('maps: every tier is read from its picture, nothing else is mistaken for a map', () => {
  const cells = extractGrid(tooltipFrame);
  const tiers = { '4,8': 1, '0,9': 2, '1,9': 3, '2,9': 4, '3,9': 5, '4,9': 6, '0,10': 7, '1,10': 8, '2,10': 9, '3,10': 10, '4,10': 11, '0,11': 12, '1,11': 13, '2,11': 14, '3,11': 15, '4,11': 16 };
  for (const [k, tier] of Object.entries(tiers)) {
    const [r, c] = k.split(',').map(Number);
    assert.equal(readMapTier(cells[r * COLS + c]).tier, tier, k);
  }
  // the hovered tier 16 map (highlighted slot), and a tier 16 map in a capture taken hours earlier
  assert.equal(readMapTier(cells[4 * COLS]).tier, 16);
  assert.equal(readMapTier(extractGrid(frames.inv_hideout)[4 * COLS + 7]).tier, 16);
  // every other filled slot in all three captures
  let checked = 0;
  const others = (list, skip) => list.forEach((cell, k) => { if (skip.has(k) || isEmptyCell(cell)) return; assert.equal(readMapTier(cell), null, `slot ${k}`); checked++; });
  others(cells, new Set([...Object.keys(tiers).map((k) => { const [r, c] = k.split(',').map(Number); return r * COLS + c; }), 48]));
  others(extractGrid(frames.inv_hideout), new Set([55]));
  others(extractGrid(frames.inv_map), new Set());
  assert.ok(checked > 100);
});

test('reader: a single item with no stack number counts as one when its picture is known', () => {
  // Row 2, column 1 of the map capture holds one item without a number (cell 12).
  const cells = extractGrid(frames.inv_map);
  const single = fingerprint(cells[12]);
  const none = new InventoryReader(new IconIndex()).read(frames.inv_map);
  assert.equal(none.cells.find((c) => c.cell === 12).status, 'skipped'); // no picture for it: left out
  // Its picture among the downloaded art (a perfect likeness here): it is one of that item.
  const index = new IconIndex();
  index.addArt('Timeless Maraketh Emblem', single);
  const seen = new InventoryReader(index).read(frames.inv_map);
  const cell = seen.cells.find((c) => c.cell === 12);
  assert.deepEqual([cell.status, cell.name, cell.qty, cell.source], ['item', 'Timeless Maraketh Emblem', 1, 'art']);
  assert.equal(seen.counts.get('Timeless Maraketh Emblem'), 1);
  // A numbered cell matches art from 0.82, but a single needs 0.88: gear can resemble a picture.
  const { SINGLE_ART_SCORE } = require('../src/core/inventory/reader');
  assert.ok(SINGLE_ART_SCORE > new IconIndex().artThreshold);
  const vague = new IconIndex({ artThreshold: 0, artMargin: -1 });
  vague.addArt('Lookalike', fingerprint(cells[0])); // a different item's picture
  const loose = new InventoryReader(vague).read(frames.inv_map).cells.find((c) => c.cell === 12);
  assert.equal(loose.status, 'skipped');
});

test('reader: a real tooltip capture, mouse on the bottom-left slot', () => {
  const reader = new InventoryReader(new IconIndex());
  const r = reader.read(tooltipFrame, { cursor: { row: 4, col: 0 } });
  assert.ok(r);
  for (let t = 1; t <= 15; t++) assert.equal(r.counts.get(`Map (Tier ${t})`), 1, `tier ${t}`);
  assert.equal(r.counts.get('Map (Tier 16)'), 2);               // including the hovered, highlighted one
  // Nothing is reported from the slots under the tooltip (columns 1 to 6 of the top four rows);
  // the stacks plainly visible beside it are.
  const under = coveredCells(tooltipFrame);
  for (let r0 = 0; r0 < 4; r0++) for (let c = 0; c < 6; c++) assert.ok(under.has(r0 * COLS + c), `slot ${r0 * COLS + c} is covered`);
  for (let r0 = 0; r0 < 4; r0++) for (let c = 7; c < COLS; c++) assert.ok(!under.has(r0 * COLS + c), `slot ${r0 * COLS + c} is clear`);
  assert.equal(r.unknown.some((u) => under.has(u.cell)), false);
  assert.ok(r.unknown.some((u) => u.cell === 7 && u.qty === 40));
  assert.equal(r.empties.length, 0);
});

test('maps: a special map with its own picture is told apart from the plain tier', () => {
  const cells = require('./fixtures/report_cells.json'); // slots from a report sent by the app
  const at = (k) => Buffer.from(cells[k], 'base64');
  assert.equal(readMapTier(at('3,0')).name, 'Originator Map (Tier 16)');
  assert.equal(readMapTier(at('4,0')).name, 'Map (Tier 16)');
  assert.equal(readMapTier(at('4,11')).name, 'Map (Tier 16)');
  assert.equal(readMapTier(at('3,1')).name, 'Map (Tier 12)');
  assert.equal(readMapTier(at('3,11')).name, 'Map (Tier 15)');
  assert.equal(readMapTier(at('2,5')), null);
  assert.equal(readMapTier(at('3,5')), null);
});

test('items that take several slots are found by their picture running across slot edges', () => {
  const { multiSlotCells, isEmptyCell, COLS } = require('../src/core/inventory/grid');
  const { readStack } = require('../src/core/inventory/digits');
  const plain = (grid) => grid.map((rgb) => (isEmptyCell(rgb) || readStack(rgb) ? null : rgb));
  // The map capture holds a body armour in columns 7 and 8, rows 1 to 3.
  const armour = [0, 1, 2].flatMap((r) => [r * COLS + 6, r * COLS + 7]);
  for (const name of ['inv_map', 'inv_hideout']) {
    const found = [...multiSlotCells(plain(extractGrid(frames[name])))].sort((a, b) => a - b);
    assert.deepEqual(found, armour, name);
  }
  // No item of one slot is taken for a piece: not the maps standing side by side, not anything else.
  const tip = extractGrid(loadFrame('inv_tooltip'));
  const pieces = multiSlotCells(plain(tip));
  for (let r = 0; r < 5; r++) for (let c = 6; c < COLS; c++) assert.ok(!pieces.has(r * COLS + c), `slot ${r},${c}`);
});

test('a piece of a larger item is never read as an item of its own', () => {
  const { fingerprint, IconIndex } = require('../src/core/inventory/icons');
  const { InventoryReader } = require('../src/core/inventory/reader');
  const { COLS } = require('../src/core/inventory/grid');
  // Worst case: the app has "learned" every piece of the armour as an item.
  const grid = extractGrid(frames.inv_map);
  const index = new IconIndex();
  const armour = [0, 1, 2].flatMap((r) => [r * COLS + 6, r * COLS + 7]);
  for (const k of armour) index.addLearned(`Piece ${k}`, fingerprint(grid[k]));
  const out = new InventoryReader(index).read(frames.inv_map);
  const by = new Map(out.cells.map((c) => [c.cell, c]));
  for (const k of armour) { assert.equal(by.get(k).status, 'skipped'); assert.equal(by.get(k).part, true); }
  assert.ok(![...out.counts.keys()].some((n) => n.startsWith('Piece')));
});

test('a thin limb crossing a slot edge at a slant still joins the two slots', () => {
  const { sameItemAcross, CANON } = require('../src/core/inventory/grid');
  // Two slots side by side on the blue backdrop, with a bright line of the given thickness
  // drawn through both: y = y0 + slope * x over the 104 pixels of the pair.
  const pair = (slope, thick, y0) => {
    const mk = () => { const c = new Uint8Array(CANON * CANON * 3); for (let p = 0; p < CANON * CANON; p++) { c[p * 3] = 4; c[p * 3 + 1] = 4; c[p * 3 + 2] = 29; } return c; };
    const a = mk(), b = mk();
    for (let x = 0; x < CANON * 2; x++) {
      for (let t = 0; t < thick; t++) {
        const y = Math.round(y0 + slope * x) + t;
        if (y < 0 || y >= CANON) continue;
        const cell = x < CANON ? a : b, o = (y * CANON + (x % CANON)) * 3;
        cell[o] = 210; cell[o + 1] = 200; cell[o + 2] = 120;
      }
    }
    return [a, b];
  };
  for (const [slope, thick] of [[0, 5], [0.5, 4], [1, 4], [2, 5], [-1.5, 3]]) {
    const [a, b] = pair(slope, thick, slope >= 0 ? 26 - slope * 52 : 26 - slope * 52);
    assert.equal(sameItemAcross(a, 'r', b, 'l'), true, `slope ${slope}`);
  }
  // Plain backdrop on both sides, or a line that stops short of the edge: two separate slots.
  const [p, q] = pair(0, 0, 0);
  assert.equal(sameItemAcross(p, 'r', q, 'l'), false);
  const [u, v] = pair(1, 4, -26); // crosses the first slot only at its far side... and never reaches the shared edge in view
  assert.equal(sameItemAcross(u, 'b', v, 't'), false);
});

test('reader: a slot whose picture did not change is not matched again, until the item lists change', () => {
  const index = new IconIndex();
  const first = new InventoryReader(new IconIndex()).read(frames.inv_map);
  // teach the index every numbered slot of the capture under a made-up name
  first.cells.filter((c) => c.stack > 0).forEach((c, n) => index.addLearned(`Item ${n % 5}`, c.print));
  const reader = new InventoryReader(index);
  let matches = 0;
  const match = index.match.bind(index);
  index.match = (...a) => { matches++; return match(...a); };
  const brief = (r) => JSON.stringify([[...r.counts], r.recognised, r.empties, r.cells.map((c) => [c.cell, c.status, c.name, c.qty, c.score, c.source, c.how, c.near]), r.unknown.map((u) => [u.cell, u.qty])]);
  const a = reader.read(frames.inv_map);
  const cold = matches;
  assert.ok(cold > 0);
  const b = reader.read(frames.inv_map);
  assert.equal(matches, cold, 'the same picture is not matched twice');
  assert.equal(brief(b), brief(a), 'and the reading is the same');
  // a reader that kept nothing gives the same answer
  assert.equal(brief(new InventoryReader(index).read(frames.inv_map)), brief(a));
  // a change to the lists: everything is matched again, and the new name is seen
  const some = a.cells.find((c) => c.status === 'item');
  const beforeForget = matches;
  index.forget(some.name);
  const c = reader.read(frames.inv_map);
  assert.ok(matches >= beforeForget + cold, 'matched again after the lists changed');
  assert.ok(!c.cells.some((x) => x.status === 'item' && x.name === some.name && x.source === 'learned'));
  // another capture: changed slots are read anew, as a fresh reader would
  assert.equal(brief(reader.read(frames.inv_hideout)).length > 0, true);
  const again = new InventoryReader(index);
  again.read(frames.inv_map);
  const fresh = new InventoryReader(index);
  fresh.memory = again.memory.slice(); fresh.prints = again.prints.slice();
  assert.equal(brief(again.read(frames.inv_hideout)), brief(fresh.read(frames.inv_hideout)));
});
