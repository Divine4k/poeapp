'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { leftoverScript, restartCommand, closeLeftovers } = require('../src/leftovers');

test('leftover copies: found by program, never this copy or its helpers', () => {
  const s = leftoverScript({ pid: 4321, exe: "C:\\Users\\O'Neil\\Map Companion\\Map Companion.exe", appDir: '' });
  assert.match(s, /\$me = 4321;/);
  assert.match(s, /\$exe = 'C:\\Users\\O''Neil\\Map Companion\\Map Companion.exe'/); // a quote in the path cannot end the text early
  assert.match(s, /ProcessId -ne \$me/);
  assert.match(s, /-notmatch '--type='/);
  assert.match(s, /\$dir = ''/);
  // From a download, electron.exe is shared with other apps, so the app folder must match as well.
  assert.match(leftoverScript({ pid: 1, exe: 'C:\\poeapp\\node_modules\\electron\\dist\\electron.exe', appDir: 'C:\\poeapp' }), /\$dir = 'C:\\poeapp'/);
});

test('restart: the old copy is made to go before the new one starts', async () => {
  const cmd = restartCommand({ pid: 4321, target: '"C:\\Map Companion\\Map Companion.exe"' });
  assert.ok(cmd.indexOf('taskkill /F /PID 4321') > 0);
  assert.ok(cmd.indexOf('taskkill') < cmd.indexOf('start ""'));
  assert.ok(!/\/T\b/.test(cmd)); // not the whole tree: this very helper is a child of the old copy
  if (process.platform !== 'win32') assert.equal(await closeLeftovers(), 0);
});
