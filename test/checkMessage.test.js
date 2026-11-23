'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkMessage, noteMessage } = require('../src/core/checkMessage');

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
  // Over the inventory, whether the item was learned or counted is the headline.
  const price = { at, name: 'Vaal Orb', qty: 3, found: true, each: 0.6, total: 1.8 };
  assert.deepEqual(checkMessage({ priceCheck: price, notice: { at, text: 'Saved: Vaal Orb.', bad: false } }, 4000),
    { title: 'Saved: Vaal Orb', detail: 'Vaal Orb ×3 is worth 1.8c (0.6c each).', bad: false });
  assert.deepEqual(checkMessage({ priceCheck: price, notice: { at, text: 'Vaal Orb is already recognised.', bad: false } }, 4000),
    { title: 'Vaal Orb is already recognised', detail: 'Vaal Orb ×3 is worth 1.8c (0.6c each).', bad: false });
  const blind = checkMessage({ priceCheck: price, notice: { at, text: 'Could not count Vaal Orb: the app has not had a clear view of that slot yet. Move the mouse off the inventory for a second, then try again.', bad: true } }, 4000);
  assert.deepEqual(blind, { title: 'Could not count Vaal Orb', detail: 'The app has not had a clear view of that slot yet. Move the mouse off the inventory for a second, then try again. Vaal Orb ×3 is worth 1.8c (0.6c each).', bad: true });
  const counted = checkMessage({ priceCheck: { at, name: 'The Nurse', qty: 1, found: true, each: 78, total: 78 }, notice: { at, text: 'Counting The Nurse in that slot: 78c. It shows up in the loot at the next inventory read.', bad: false } }, 4000);
  assert.equal(counted.title, 'Counting The Nurse in that slot: 78c');
  const unpriced = checkMessage({ priceCheck: { at, name: 'Odd Thing', qty: 1, found: false }, notice: { at, text: 'Odd Thing has no known price, so it is not counted.', bad: true } }, 4000);
  assert.deepEqual(unpriced, { title: 'Odd Thing has no known price, so it is not counted', detail: 'No price found for Odd Thing.', bad: true });
});

test('check key message: maps, nothing under the mouse, and stale results', () => {
  const at = 5000;
  const safe = checkMessage({ mapCheck: { at, name: 'Strand Map', tier: 16, dangerCount: 0, mods: [{ mod: 'Area contains many Totems', dangerous: false }] } }, 4000);
  assert.deepEqual(safe, { title: 'Strand Map (T16): safe to run', detail: '', bad: false });
  const danger = checkMessage({ mapCheck: { at, name: 'Strand Map', tier: 16, dangerCount: 1, mods: [{ mod: 'Monsters reflect 18% of Physical Damage', dangerous: true }, { mod: 'x', dangerous: false }] } }, 4000);
  assert.deepEqual(danger, { title: 'Strand Map (T16): do not run: 1 dangerous mod', detail: 'Monsters reflect 18% of Physical Damage', bad: true });
  assert.equal(checkMessage({ mapCheck: { at, name: 'Strand Map', unidentified: true, mods: [] } }, 4000).bad, true);
  const none = checkMessage({ notice: { at, text: 'No item under the mouse in game. Hover an item and press the key again.', bad: true }, priceCheck: { at: 100, name: 'Old', qty: 1, found: true, each: 1, total: 1 } }, 4000);
  assert.deepEqual(none, { title: 'No item under the mouse in game', detail: 'Hover an item and press the key again.', bad: true });
  // A name waiting for a clear look at its slot is good news, not a failure.
  const waiting = checkMessage({ priceCheck: { at, name: 'Timeless Maraketh Splinter', qty: 99, found: true, each: 0.22, total: 21.8 }, notice: { at, text: 'Noted: Timeless Maraketh Splinter. It is saved at the next clear look at that slot. Move the mouse off the inventory for a second; nothing else to press.', bad: false } }, 4000);
  assert.deepEqual([waiting.title, waiting.bad], ['Noted: Timeless Maraketh Splinter', false]);
  assert.match(waiting.detail, /^It is saved at the next clear look at that slot\./);
  assert.deepEqual(noteMessage({ text: 'Saved: Timeless Maraketh Splinter.', bad: false }), { title: 'Saved: Timeless Maraketh Splinter', detail: '', bad: false });
  assert.equal(noteMessage(null), null);
  // Results from an earlier press say nothing about this one.
  assert.equal(checkMessage({ priceCheck: { at: 100, name: 'Old', qty: 1, found: true, each: 1, total: 1 }, notice: { at: 200, text: 'old', bad: false } }, 4000), null);
  assert.equal(checkMessage({}, 0), null);
});
