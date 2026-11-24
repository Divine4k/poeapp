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

test('chat lines go out fast and hand the clipboard back once', async () => {
  const { typeChat, LINE_GAP_MS } = require('../src/chat');
  const keys = [];
  const hook = { UiohookKey: { Enter: 'Enter', A: 'A', V: 'V', Ctrl: 'Ctrl' }, uIOhook: { keyTap: (k, mods) => keys.push({ k: (mods ? 'Ctrl+' : '') + k, clip: clip.text }) } };
  const clip = { text: 'my own copy', readText() { return this.text; }, writeText(t) { this.text = t; } };
  const started = Date.now();
  assert.equal(await typeChat(hook, clip, '@Buyer Thank you'), true);
  assert.equal(await typeChat(hook, clip, '/kick Buyer'), true);
  const took = Date.now() - started;
  assert.ok(took < 250, `two lines took ${took} ms`); // was about 500 ms plus pauses
  assert.ok(LINE_GAP_MS <= 50);
  assert.deepEqual(keys.map((x) => x.k), ['Enter', 'Ctrl+A', 'Ctrl+V', 'Enter', 'Enter', 'Ctrl+A', 'Ctrl+V', 'Enter']);
  // Each paste happens while the clipboard holds that line.
  assert.deepEqual(keys.filter((x) => x.k === 'Ctrl+V').map((x) => x.clip), ['@Buyer Thank you', '/kick Buyer']);
  assert.equal(clip.text, '/kick Buyer'); // not handed back between the two lines
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(clip.text, 'my own copy'); // handed back after the last one
  // Something you copied in the meantime is left alone.
  await typeChat(hook, clip, '/hideout');
  clip.text = 'copied by me just now';
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(clip.text, 'copied by me just now');
  // A whisper left open for you to finish is not sent.
  keys.length = 0;
  await typeChat(hook, clip, '@Buyer ', { send: false });
  assert.deepEqual(keys.map((x) => x.k), ['Enter', 'Ctrl+A', 'Ctrl+V']);
});

test('the copy key holds Alt over a pause, so the game sees it let go, and never leaves a key down', async () => {
  const { copyItem, COPY_STEP_MS } = require('../src/chat');
  const log = [];
  let t = 0;
  const hook = { UiohookKey: { Ctrl: 'Ctrl', Alt: 'Alt', C: 'C' }, uIOhook: { keyToggle: (k, dir) => log.push(`${t} ${k} ${dir}`) } };
  await copyItem(hook, async (ms) => { t += ms; });
  assert.deepEqual(log, ['0 Ctrl down', '0 Alt down', `${COPY_STEP_MS} C down`, `${2 * COPY_STEP_MS} C up`, `${3 * COPY_STEP_MS} Alt up`, `${3 * COPY_STEP_MS} Ctrl up`]);
  assert.ok(COPY_STEP_MS >= 20 && COPY_STEP_MS <= 50);
  // Something going wrong in the middle still lets go of Ctrl and Alt.
  log.length = 0;
  const broken = { ...hook, uIOhook: { keyToggle: (k, dir) => { if (k === 'C') throw new Error('no'); log.push(`${k} ${dir}`); } } };
  await assert.rejects(copyItem(broken, async () => {}));
  assert.deepEqual(log, ['Ctrl down', 'Alt down', 'Alt up', 'Ctrl up']);
});
