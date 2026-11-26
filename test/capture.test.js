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
