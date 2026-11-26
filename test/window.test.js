'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { placeWindow } = require('../src/core/windowPlace');

const left = { id: 1, workArea: { x: 0, y: 0, width: 2560, height: 1400 } };
const right = { id: 2, workArea: { x: 2560, y: 0, width: 1920, height: 1040 } };

test('first start: second screen, maximised', () => {
  const p = placeWindow(null, [left, right], 1);
  assert.equal(p.maximized, true);
  assert.ok(p.x >= right.workArea.x);
});

test('first start with one screen: not maximised, on it', () => {
  const p = placeWindow(null, [left], 1);
  assert.equal(p.maximized, false);
  assert.equal(p.x, 40);
});

test('opens where it was, also on the first screen and maximised', () => {
  const saved = { bounds: { x: 100, y: 80, width: 1400, height: 900 }, maximized: true };
  const p = placeWindow(saved, [left, right], 1);
  assert.deepEqual([p.x, p.y, p.width, p.height, p.maximized], [100, 80, 1400, 900, true]);
  assert.equal(p.from, 'where it was');
});

test('a screen left of the first one (negative x) counts', () => {
  const far = { id: 3, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
  const p = placeWindow({ bounds: { x: -1800, y: 50, width: 1200, height: 800 } }, [left, far], 1);
  assert.equal(p.x, -1800);
});

test('saved screen is gone: back to the first start place', () => {
  const p = placeWindow({ bounds: { x: 3000, y: 100, width: 1200, height: 800 } }, [left], 1);
  assert.equal(p.x, 40);
  assert.match(p.from, /gone/);
});

test('broken or tiny saved place is not used', () => {
  assert.match(placeWindow({ bounds: { x: 'a' } }, [left], 1).from, /^first start$/);
  assert.match(placeWindow({ bounds: { x: 0, y: 0, width: 50, height: 20 } }, [left], 1).from, /too small/);
});
