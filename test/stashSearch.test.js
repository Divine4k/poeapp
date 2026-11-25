'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cleanSearches, menuEntries, tooLong, menuBounds, GAME_LIMIT, MAX_SEARCHES, MENU_WIDTH } = require('../src/core/stashSearch');

test('saved searches are kept tidy, and a row being written is not lost', () => {
  assert.deepEqual(cleanSearches(null), []);
  assert.deepEqual(cleanSearches([{ name: '  Maps  16 ', text: ' "m q.*1[6-9]"\n' }, { name: '', text: '' }, null, 'x']), [
    { name: 'Maps 16', text: '"m q.*1[6-9]"' },
    { name: '', text: '' }, // just added with the Add button
  ]);
  assert.equal(cleanSearches(Array.from({ length: MAX_SEARCHES + 5 }, () => ({ name: 'a', text: 'b' }))).length, MAX_SEARCHES);
});

test('the menu lists searches with text, keeps their place in the list, and names unnamed ones by their search', () => {
  const list = [{ name: 'Currency', text: 'currency' }, { name: 'Empty', text: '' }, { name: '', text: 'gem' }, { name: 'Long', text: 'x'.repeat(GAME_LIMIT + 1) }];
  assert.deepEqual(menuEntries(list), [
    { i: 0, name: 'Currency', text: 'currency', long: false },
    { i: 2, name: 'gem', text: 'gem', long: false },
    { i: 3, name: 'Long', text: 'x'.repeat(GAME_LIMIT + 1), long: true },
  ]);
  assert.equal(tooLong('x'.repeat(GAME_LIMIT)), false);
  assert.equal(tooLong('x'.repeat(GAME_LIMIT + 1)), true);
});

test('the menu opens at the mouse and stays on the game screen', () => {
  const b = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(menuBounds(b, { x: 500, y: 400 }, 200), { x: 476, y: 382, width: MENU_WIDTH, height: 200 });
  const corner = menuBounds(b, { x: 1915, y: 1075 }, 300);
  assert.equal(corner.x + corner.width, 1920);
  assert.equal(corner.y + corner.height, 1080);
  const second = menuBounds({ x: 1920, y: 0, width: 1920, height: 1080 }, { x: 1921, y: 2 }, 100);
  assert.deepEqual([second.x, second.y], [1920, 0]);
});

test('a stash search is Ctrl+F, paste over the old search, Enter, and the clipboard comes back', async () => {
  const { typeSearch } = require('../src/chat');
  const keys = [];
  const clip = { text: 'my own copy', readText() { return this.text; }, writeText(t) { this.text = t; } };
  const hook = { UiohookKey: { Enter: 'Enter', A: 'A', F: 'F', V: 'V', Ctrl: 'Ctrl' }, uIOhook: { keyTap: (k, mods) => keys.push({ k: (mods ? 'Ctrl+' : '') + k, clip: clip.text }) } };
  assert.equal(await typeSearch(hook, clip, '  "m q.*1[6-9]"\n'), true);
  assert.deepEqual(keys.map((x) => x.k), ['Ctrl+F', 'Ctrl+A', 'Ctrl+V', 'Enter']);
  assert.equal(keys[2].clip, '"m q.*1[6-9]"');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(clip.text, 'my own copy');
  keys.length = 0;
  assert.equal(await typeSearch(hook, clip, '   '), false);
  assert.equal(keys.length, 0);
});
