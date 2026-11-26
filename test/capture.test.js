'use strict';
// The helper process that takes the screen's picture (src/capturehelper.js): how its answers
// are read, what happens when it fails, and the comparison that decides whether its pictures
// may be used for reading loot at all.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { CaptureHelper, AnswerReader, slotsSame, SCRIPT } = require('../src/capturehelper');
const { gridRect } = require('../src/core/inventory/grid');
const { InventoryReader } = require('../src/core/inventory/reader');
const { IconIndex } = require('../src/core/inventory/icons');
const { loadFrame } = require('./helpers');

function answer(w, h, ok = true, fill = 7) {
  const head = Buffer.alloc(16);
  head.write('PCAP', 0, 'latin1'); head.writeInt32LE(w, 4); head.writeInt32LE(h, 8); head.writeInt32LE(ok ? 1 : 0, 12);
  return ok ? Buffer.concat([head, Buffer.alloc(w * h * 4, fill)]) : head;
}

test('capture helper: answers are read whole, however they arrive in pieces', () => {
  const all = Buffer.concat([answer(3, 2, true, 1), answer(0, 0, false), answer(2, 2, true, 9)]);
  for (const step of [1, 5, 16, 17, 1000]) {
    const r = new AnswerReader(), got = [];
    for (let i = 0; i < all.length; i += step) got.push(...r.feed(all.subarray(i, i + step)));
    assert.equal(got.length, 3, `in pieces of ${step}`);
    assert.deepEqual([got[0].ok, got[0].width, got[0].height, got[0].data.length, got[0].data[0]], [true, 3, 2, 24, 1]);
    assert.deepEqual([got[1].ok, got[1].data], [false, null]);
    assert.deepEqual([got[2].data.length, got[2].data[15]], [16, 9]);
  }
  assert.throws(() => new AnswerReader().feed(Buffer.from('this is not an answer at all')));
});

// A stand-in for the helper process: answers each request line with reply(line).
function fakeSpawn(reply, made = []) {
  return () => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.killed = false;
    p.stdin = Object.assign(new EventEmitter(), {
      write: (line) => { p.lines.push(line.trim()); const a = reply(line.trim(), p); if (a) setImmediate(() => p.stdout.emit('data', a)); },
      end: () => {},
    });
    p.lines = [];
    p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit')); };
    made.push(p);
    return p;
  };
}
const onWindows = (fn) => async () => {
  const was = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { await fn(); } finally { Object.defineProperty(process, 'platform', was); }
};

test('capture helper: gives the pixels asked for, one request at a time', onWindows(async () => {
  const made = [];
  const h = new CaptureHelper({ spawnImpl: fakeSpawn((line) => { const [, , w, hh] = line.split(' ').map(Number); return answer(w, hh, true, w); }, made) });
  const [a, b] = await Promise.all([h.shot({ x: -1920, y: 0, width: 4, height: 2 }), h.shot({ x: 0, y: 0, width: 2, height: 2 })]);
  assert.equal(a.length, 32); assert.equal(a[0], 4);
  assert.equal(b.length, 16); assert.equal(b[0], 2);
  assert.equal(made.length, 1, 'one helper for both');
  assert.deepEqual(made[0].lines, ['-1920 0 4 2', '0 0 2 2']);
  h.stop();
}));

test('capture helper: a wrong size, a failure, silence or a dead helper give nothing, never a wrong picture', onWindows(async () => {
  let mode = 'size';
  const made = [];
  const h = new CaptureHelper({ timeoutMs: 40, spawnImpl: fakeSpawn((line, p) => {
    if (mode === 'size') return answer(1, 1);
    if (mode === 'fail') return answer(2, 2, false);
    if (mode === 'dead') { setImmediate(() => p.emit('exit')); return null; }
    return null; // silence
  }, made) });
  assert.equal(await h.shot({ x: 0, y: 0, width: 2, height: 2 }), null);
  mode = 'fail'; assert.equal(await h.shot({ x: 0, y: 0, width: 2, height: 2 }), null);
  mode = 'dead'; assert.equal(await h.shot({ x: 0, y: 0, width: 2, height: 2 }), null);
  mode = 'silent'; assert.equal(await h.shot({ x: 0, y: 0, width: 2, height: 2 }), null);
  assert.ok(made[made.length - 1].killed, 'a helper that does not answer is stopped');
  // it is started afresh for the next request, and gives up for good after failing three times
  mode = 'silent';
  assert.equal(await h.shot({ x: 0, y: 0, width: 2, height: 2 }), null);
  assert.equal(await h.shot({ x: 0, y: 0, width: 2, height: 2 }), null);
  assert.equal(h.usable, false);
  const before = made.length;
  assert.equal(await h.shot({ x: 0, y: 0, width: 2, height: 2 }), null);
  assert.equal(made.length, before, 'not started again');
}));

test('capture helper: not used where there is no Windows', async () => {
  if (process.platform === 'win32') return;
  const h = new CaptureHelper({ spawnImpl: () => { throw new Error('must not be started'); } });
  assert.equal(await h.shot({ x: 0, y: 0, width: 2, height: 2 }), null);
});

test('capture helper: the comparison only passes pictures that read the same', () => {
  const frame = loadFrame('inv_map');
  const rect = gridRect(frame.width, frame.height);
  const copy = (f) => ({ ...f, data: Buffer.from(f.data) });
  // the very same pixels: every slot
  assert.equal(slotsSame(frame, copy(frame), rect), 60);
  // the helper fills the unused fourth byte itself: no matter what it holds
  const alpha = copy(frame);
  for (let i = 3; i < alpha.data.length; i += 4) alpha.data[i] = 0;
  assert.equal(slotsSame(frame, alpha, rect), 60);
  // one shade off in one colour everywhere (a colour profile, HDR, a filter): no slot passes
  const tint = copy(frame);
  for (let i = 0; i < tint.data.length; i += 4) tint.data[i] = Math.min(255, tint.data[i] + 1);
  assert.equal(slotsSame(frame, tint, rect), 0);
  // a picture one pixel to the side (wrong rectangle, scaled screen): almost none pass
  const moved = copy(frame);
  moved.data.copyWithin(4, 0, moved.data.length - 4);
  assert.ok(slotsSame(frame, moved, rect) < 30);
  // and identical pixels read identically
  const read = (f) => JSON.stringify(new InventoryReader(new IconIndex()).read(f).cells.map((c) => [c.cell, c.status, c.qty, c.stack]));
  assert.equal(read(frame), read(alpha));
});

test('capture helper: the script is plain enough for the PowerShell that comes with Windows', () => {
  assert.ok(Buffer.from(SCRIPT, 'utf16le').toString('base64').length < 30000, 'fits on a command line');
  assert.ok(!/\$"|=>|\?\.|out (IntPtr|int|var) \w+\)/.test(SCRIPT), 'no newer C# than version 5');
  assert.match(SCRIPT, /^'@$/m);
});

test('helpers are started on a thread of their own and still talk both ways', async () => {
  if (process.platform === 'win32') return; // uses sh
  const { spawnAside } = require('../src/aside');
  let startedMs = -1;
  const p = spawnAside('sh', ['-c', 'echo ready; while read line; do echo "got $line"; done; echo bye'], { stdio: ['pipe', 'pipe', 'ignore'] }, (ms) => { startedMs = ms; });
  let out = '';
  p.stdout.on('data', (d) => { assert.ok(Buffer.isBuffer(d)); out += d; });
  const until = async (what) => { for (let i = 0; i < 200 && !out.includes(what); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(out.includes(what), `"${what}" in "${out}"`); };
  await until('ready');
  assert.ok(startedMs >= 0);
  p.stdin.write('one\n'); await until('got one');
  p.stdin.write('two\n'); await until('got two');
  const exited = new Promise((r) => p.on('exit', r));
  p.stdin.end(); await until('bye');
  await exited;
  // a program that does not exist is an error, not a crash; and kill ends one that would run on
  const bad = spawnAside('no-such-program-here', [], {});
  await new Promise((r) => bad.on('error', r));
  const long = spawnAside('sh', ['-c', 'sleep 30'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const gone = new Promise((r) => long.on('exit', r));
  setTimeout(() => long.kill(), 100);
  await gone;
  // large output arrives whole
  const big = spawnAside('sh', ['-c', 'head -c 3000000 /dev/zero'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let n = 0; big.stdout.on('data', (d) => { n += d.length; });
  await new Promise((r) => big.on('exit', r));
  assert.equal(n, 3000000);
});

test('capture: an app window only counts as in the way when it is over the inventory', () => {
  const { overReadArea } = require('../src/capturehelper');
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const over = (win, d = display, w = 1920, h = 1080) => overReadArea(win, d, w, h);
  assert.equal(over({ x: 0, y: 800, width: 400, height: 200 }), false, 'trade offers at the bottom left');
  assert.equal(over({ x: 700, y: 0, width: 500, height: 60 }), false, 'a message at the top');
  assert.equal(over({ x: 1500, y: 100, width: 400, height: 300 }), false, 'top right, above the grid');
  assert.equal(over({ x: 1500, y: 700, width: 300, height: 200 }), true, 'on the grid');
  assert.equal(over({ x: 900, y: 500, width: 400, height: 400 }), true, 'reaching into the grid from the left');
  assert.equal(over({ x: 800, y: 500, width: 380, height: 400 }), false, 'beside it, a slot away');
  assert.equal(over({ x: 0, y: 0, width: 1920, height: 1080 }), true, 'layout mode, the whole screen');
  // on another screen, and on a scaled screen
  assert.equal(over({ x: 1920 + 1500, y: 700, width: 300, height: 200 }), false);
  const left = { bounds: { x: -1280, y: 0, width: 1280, height: 720 } };
  assert.equal(over({ x: -300, y: 450, width: 200, height: 150 }, left, 1920, 1080), true);
  assert.equal(over({ x: -1280, y: 0, width: 300, height: 100 }, left, 1920, 1080), false);
});

test('capture trial: only clear comparisons count, a real difference is caught, off is not for ever', () => {
  const { Trial } = require('../src/capturehelper');
  let now = 1e12;
  const t = new Trial({ now: () => now });
  assert.equal(t.state, 'trial');
  // matches gain trust; an unclear one (inventory closed in between, a tooltip opened) neither gains nor loses
  assert.equal(t.compared(59, 60, true), 'match');
  assert.equal(t.compared(11, 60, false), 'unclear');
  assert.equal(t.compared(45, 60, true), 'unclear');
  assert.equal(t.compared(57, 60, true), 'match');
  assert.equal(t.compared(60, 60, true), 'trusted');
  assert.equal(t.state, 'trusted');
  // what happened on RaQner's PC: two comparisons of 11 of 60 with the scene changed in between
  assert.equal(t.compared(11, 60, false), 'unclear');
  assert.equal(t.compared(11, 60, false), 'unclear');
  assert.equal(t.state, 'trusted');
  // a real difference while trusted: the old way at once, until it has matched three times again
  assert.equal(t.compared(0, 60, true), 'back on trial');
  assert.equal(t.state, 'trial');
  assert.equal(t.compared(60, 60, true), 'match');
  assert.equal(t.compared(60, 60, true), 'match');
  assert.equal(t.state, 'trial');
  assert.equal(t.compared(60, 60, true), 'trusted');
  // three real differences in a row: off
  assert.equal(t.compared(3, 60, true), 'back on trial');
  assert.equal(t.compared(3, 60, true), 'different');
  assert.equal(t.compared(3, 60, true), 'off');
  assert.equal(t.state, 'off');
  assert.equal(t.compared(60, 60, true), 'off');
  // tried again after ten minutes, three times at most
  assert.equal(t.again(), false);
  now += 10 * 60 * 1000 + 1;
  assert.equal(t.again(), true);
  assert.equal(t.state, 'trial');
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) t.compared(0, 60, true);
    assert.equal(t.state, 'off');
    now += 10 * 60 * 1000 + 1;
    assert.equal(t.again(), i < 2, `try ${i + 2}`);
  }
  assert.equal(t.state, 'off');
  assert.match(t.fact, /^the old way \(its pictures differed 3 times in a row/);
  // a helper that cannot be started is never tried again; and nothing is tried off Windows
  const dead = new Trial({ now: () => now });
  dead.off('the helper could not be started', true);
  now += 60 * 60 * 1000;
  assert.equal(dead.again(), false);
  assert.equal(new Trial({ on: false }).again(), false);
  // the fact says what was seen
  const f = new Trial({ now: () => now });
  f.compared(59, 60, true); f.compared(20, 60, false);
  assert.match(f.fact, /being compared \(1 of 3 matched\); comparisons: 1 matched, 0 differed, 1 not counted; the last at \d\d:\d\d:\d\d: 20 of 60, not counted/);
});
