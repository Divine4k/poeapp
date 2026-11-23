'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { readTarGz, planFiles } = require('../src/core/tar');

// Builds one ustar entry.
function entry(name, content, type = '0', prefix = '') {
  const h = Buffer.alloc(512);
  h.write(name, 0);
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257); h.write('00', 263);
  h.write(prefix, 345);
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  Buffer.from(content).copy(body);
  return Buffer.concat([h, body]);
}
const archive = (...parts) => zlib.gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));

test('tar: files, folders, pax headers, prefixes and long names', () => {
  const long = `poeapp-abc/src/${'d'.repeat(120)}/file.js`;
  const gz = archive(
    entry('pax_global_header', '52 comment=abc\n', 'g'),
    entry('poeapp-abc/', '', '5'),
    entry('poeapp-abc/package.json', '{"name":"poeapp"}'),
    entry('main.js', 'x'.repeat(700), '0', 'poeapp-abc/src'),
    entry('././@LongLink', `${long}\0`, 'L'),
    entry('truncated', 'long one'),
    entry('PaxHeader', `${String(long.length + 9).padStart(2, '0')} path=poeapp-abc/README.md\n`, 'x'),
    entry('ignored-name', 'readme'),
    entry('poeapp-abc/node_modules/x/index.js', 'no'),
  );
  const entries = readTarGz(gz);
  assert.deepEqual(entries.map((e) => e.path), ['poeapp-abc/', 'poeapp-abc/package.json', 'poeapp-abc/src/main.js', long, 'poeapp-abc/README.md', 'poeapp-abc/node_modules/x/index.js']);
  assert.equal(entries[2].data.length, 700);
  const files = planFiles(entries);
  assert.deepEqual(files.map((f) => f.rel), ['package.json', 'src/main.js', `src/${'d'.repeat(120)}/file.js`, 'README.md']);
  assert.equal(files[0].data.toString(), '{"name":"poeapp"}');
});

test('tar: paths that try to leave the app folder are refused', () => {
  assert.throws(() => planFiles(readTarGz(archive(entry('top/../../evil.js', 'x')))), /Unsafe path/);
  assert.throws(() => planFiles(readTarGz(archive(entry('top/C:\\evil.js', 'x')))), /Unsafe path/);
});

test('updater: apply replaces files, removes stale ones, records the version, flags dependency changes', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { Updater } = require('../src/updater');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-upd-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"dependencies":{}}');
  fs.writeFileSync(path.join(dir, 'src/main.js'), 'old');
  fs.writeFileSync(path.join(dir, 'src/gone.js'), 'stale');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine');
  const gz = archive(
    entry('poeapp-new/package.json', '{"dependencies":{"x":"1"}}'),
    entry('poeapp-new/src/main.js', 'new'),
    entry('poeapp-new/src/core/a.js', 'a'),
  );
  const realFetch = global.fetch;
  global.fetch = async (url) => (String(url).includes('/commits/')
    ? { ok: true, status: 200, headers: { get: () => '"e1"' }, json: async () => ({ sha: 'abc123', commit: { message: 'New thing\n\nbody', committer: { date: '2026-11-23' } } }) }
    : { ok: true, status: 200, arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) });
  try {
    const u = new Updater(dir);
    await u.check();
    assert.equal(u.latest.message, 'New thing');
    assert.equal(u.available, true);
    const r = await u.apply();
    assert.equal(r.depsChanged, true);
    assert.equal(fs.readFileSync(path.join(dir, 'src/main.js'), 'utf8'), 'new');
    assert.equal(fs.readFileSync(path.join(dir, 'src/core/a.js'), 'utf8'), 'a');
    assert.equal(fs.existsSync(path.join(dir, 'src/gone.js')), false);
    assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'mine');
    assert.equal(new Updater(dir).current.sha, 'abc123');
    assert.equal(u.available, false);
  } finally {
    global.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
