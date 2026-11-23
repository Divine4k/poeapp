'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkMessage } = require('../src/core/checkMessage');

test('check key message: prices', () => {
  const at = 5000;
  assert.deepEqual(checkMessage({ priceCheck: { at, name: 'Chaos Orb', qty: 40, found: true, each: 1, total: 40 } }, 4000),
    { title: 'Chaos Orb ×40: 40c (1c each)', detail: '', bad: false });
  assert.deepEqual(checkMessage({ priceCheck: { at, name: 'Mageblood', qty: 1, found: true, each: 38200, total: 38200 }, divine: 191 }, 4000),
    { title: 'Mageblood: 200.0 div', detail: '', bad: false });
  assert.equal(checkMessage({ priceCheck: { at, name: 'Odd Thing', qty: 1, found: false, each: 0, total: 0 } }, 4000).title, 'Odd Thing: no price found');
  assert.equal(checkMessage({ priceCheck: { at, name: 'Odd Thing', qty: 1, found: false } }, 4000).bad, true);
  const err = checkMessage({ priceCheck: { at, error: 'The clipboard does not hold a Path of Exile item.' } }, 4000);
  assert.deepEqual([err.title, err.bad], ['No item read', true]);
  // What the app did with the slot rides along as the second line.
  const counted = checkMessage({ priceCheck: { at, name: 'The Nurse', qty: 1, found: true, each: 78, total: 78 }, notice: { at, text: 'Counting The Nurse in that slot: 78c.', bad: false } }, 4000);
  assert.deepEqual(counted, { title: 'The Nurse: 78c', detail: 'Counting The Nurse in that slot: 78c.', bad: false });
});

test('check key message: maps, nothing under the mouse, and stale results', () => {
  const at = 5000;
  const safe = checkMessage({ mapCheck: { at, name: 'Strand Map', tier: 16, dangerCount: 0, mods: [{ mod: 'Area contains many Totems', dangerous: false }] } }, 4000);
  assert.deepEqual(safe, { title: 'Strand Map (T16): safe to run', detail: '', bad: false });
  const danger = checkMessage({ mapCheck: { at, name: 'Strand Map', tier: 16, dangerCount: 1, mods: [{ mod: 'Monsters reflect 18% of Physical Damage', dangerous: true }, { mod: 'x', dangerous: false }] } }, 4000);
  assert.deepEqual(danger, { title: 'Strand Map (T16): do not run: 1 dangerous mod', detail: 'Monsters reflect 18% of Physical Damage', bad: true });
  assert.equal(checkMessage({ mapCheck: { at, name: 'Strand Map', unidentified: true, mods: [] } }, 4000).bad, true);
  const none = checkMessage({ notice: { at, text: 'No item under the mouse in game. Hover an item and press the key again.', bad: true }, priceCheck: { at: 100, name: 'Old', qty: 1, found: true, each: 1, total: 1 } }, 4000);
  assert.deepEqual([none.title, none.bad], ['Nothing read', true]);
  // Results from an earlier press say nothing about this one.
  assert.equal(checkMessage({ priceCheck: { at: 100, name: 'Old', qty: 1, found: true, each: 1, total: 1 }, notice: { at: 200, text: 'old', bad: false } }, 4000), null);
  assert.equal(checkMessage({}, 0), null);
});
