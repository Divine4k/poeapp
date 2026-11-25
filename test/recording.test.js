'use strict';
// Troubleshooting recordings: the event list, the readable timeline, sending a folder to
// GitHub as one commit (against a stand-in for GitHub), and a whole record-note-send round.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Trace, small, keyNames, keyLabel, stateBrief, briefChanges, clockOf, readme, recordingId, ID } = require('../src/core/recording');
const { uploadFolder } = require('../src/github');
const { Troubleshoot } = require('../src/troubleshoot');

test('the trace keeps times from the start and shortens what is large', () => {
  let now = 1000;
  const t = new Trace({ now: () => now });
  t.start();
  now = 1250;
  t.add('notice', { text: 'x'.repeat(5000), pic: 'data:image/png;base64,AAAA', list: Array.from({ length: 80 }, (_, i) => i) });
  const e = t.events[0];
  assert.strictEqual(e.t, 250);
  assert.strictEqual(e.kind, 'notice');
  assert.ok(e.text.length < 2100);
  assert.strictEqual(e.pic, '(picture)');
  assert.strictEqual(e.list.length, 51);
  assert.deepStrictEqual(small({ a: { b: { c: { d: { e: { f: 1 } } } } } }).a.b.c.d.e, '…');
});

test('keys and buttons get readable names', () => {
  const names = keyNames({ Tab: 15, Ctrl: 29, A: 30, Shift: 42 });
  assert.strictEqual(keyLabel({ keycode: 15 }, names), 'Tab');
  assert.strictEqual(keyLabel({ keycode: 30, ctrlKey: true, shiftKey: true }, names), 'Ctrl+Shift+A');
  // The modifier key on its own is not named twice.
  assert.strictEqual(keyLabel({ keycode: 29, ctrlKey: true }, names), 'Ctrl');
  assert.strictEqual(keyLabel({ keycode: 999 }, names), 'key 999');
});

test('the state brief notes only what changed', () => {
  const s = { status: { log: { ok: true }, inventory: { keyHook: 'ok', open: false, recognised: 3 }, hotkeys: { clipboard: true } },
    summary: { currentId: 'r1', runs: [{ id: 'r1', name: 'Strand', segmentStart: 5, deaths: 0, loot: [], lootValue: 0 }] }, notice: null, trade: { offers: [] } };
  const a = stateBrief(s);
  assert.strictEqual(a.map.name, 'Strand');
  assert.strictEqual(a.map.running, true);
  assert.strictEqual(briefChanges(a, stateBrief(s)), null);
  const later = stateBrief({ ...s, notice: { text: 'Saved: Chaos Orb.' } });
  assert.deepStrictEqual(briefChanges(a, later), { notice: 'Saved: Chaos Orb.' });
});

test('the readme has the note, the facts and one line per event', () => {
  assert.strictEqual(clockOf(65432), '01:05.432');
  const text = readme({ id: 'x', note: 'The timer did not stop in the hideout.', by: 'Divine4k', role: 'admin', version: 'abc', startedAt: 0, endedAt: 61000, video: { bytes: 2097152 }, screen: { width: 2560, height: 1440, scaleFactor: 1 } }, [
    { t: 10, kind: 'key', dir: 'down', key: 'Tab' },
    { t: 520, kind: 'log', line: '2026/11/24 17:00:00 123 abc [INFO Client 1] : You have entered Strand.' },
    { t: 900, kind: 'notice', text: 'Could not read', bad: true },
  ]);
  assert.match(text, /The timer did not stop in the hideout\./);
  assert.match(text, /Divine4k \(admin\)/);
  assert.match(text, /length 01:01\.000/);
  assert.match(text, /00:00\.010 {2}key +pressed Tab/);
  assert.match(text, /You have entered Strand/);
  assert.match(text, /\(problem\) Could not read/);
});

test('recording ids sort by time and say who made them', () => {
  const id = recordingId(new Date(2026, 10, 24, 17, 5, 9), 'Divine 4k!');
  assert.strictEqual(id, '20261124-170509-Divine4k');
  assert.ok(ID.test(id));
  assert.ok(!ID.test('../../etc'));
  assert.strictEqual(recordingId(new Date(2026, 0, 1), ''), '20260101-000000-local');
});

// A stand-in for the parts of GitHub's API that uploadFolder uses.
function fakeGithub({ empty = false, racing = 0, token = 'good' } = {}) {
  const gh = { commits: {}, ref: empty ? null : 'c0', blobs: {}, trees: {}, calls: [], files: {} };
  gh.commits.c0 = { tree: 't0', parents: [] };
  gh.trees.t0 = {};
  let n = 0;
  const answer = (status, data) => ({ ok: status < 300, status, json: async () => data });
  gh.fetch = async (url, o) => {
    const route = url.replace('https://api.github.com/repos/Divine4k/reports', '');
    const body = o.body ? JSON.parse(o.body) : null;
    gh.calls.push(`${o.method} ${route}`);
    if (o.cache !== 'no-store' || o.headers['Cache-Control'] !== 'no-cache') return answer(400, { message: 'asked without no-cache' });
    if (o.headers.Authorization !== `Bearer ${token}`) return answer(401, { message: 'Bad credentials' });
    if (o.method === 'GET' && route === '/git/ref/heads/main') return gh.ref ? answer(200, { object: { sha: gh.ref } }) : answer(409, { message: 'Git Repository is empty.' });
    if (o.method === 'PUT' && route === '/contents/README.md') { gh.commits.c1 = { tree: 't1', parents: [] }; gh.trees.t1 = { 'README.md': 'first' }; gh.ref = 'c1'; return answer(201, {}); }
    if (o.method === 'GET' && route.startsWith('/contents/')) {
      // A folder lists its entries; a file comes back as it is (raw).
      const p = decodeURIComponent(route.slice('/contents/'.length).split('?')[0]);
      const tree = gh.ref ? gh.trees[gh.commits[gh.ref].tree] : {};
      if (tree[p]) return { ok: true, status: 200, arrayBuffer: async () => gh.blobs[tree[p]] };
      const names = new Map();
      for (const k of Object.keys(tree)) if (k.startsWith(`${p}/`)) { const rest = k.slice(p.length + 1).split('/'); names.set(rest[0], rest.length > 1 ? 'dir' : 'file'); }
      return names.size ? answer(200, [...names].map(([name, type]) => ({ name, type }))) : answer(404, { message: 'Not Found' });
    }
    if (o.method === 'POST' && route === '/git/blobs') { const sha = `b${++n}`; gh.blobs[sha] = Buffer.from(body.content, 'base64'); return answer(201, { sha }); }
    if (o.method === 'GET' && route.startsWith('/git/commits/')) return answer(200, { tree: { sha: gh.commits[route.split('/').pop()].tree } });
    if (o.method === 'POST' && route === '/git/trees') {
      const sha = `t${++n}`; gh.trees[sha] = { ...gh.trees[body.base_tree] };
      for (const e of body.tree) { if (e.sha === null) { if (!(e.path in gh.trees[sha])) return answer(422, { message: 'path not found' }); delete gh.trees[sha][e.path]; } else gh.trees[sha][e.path] = e.sha; }
      return answer(201, { sha });
    }
    if (o.method === 'GET' && route.startsWith('/git/trees/')) {
      // The whole tree, folders included, as GitHub gives it with recursive=1.
      const flat = gh.trees[route.slice('/git/trees/'.length).split('?')[0]];
      const dirs = new Set();
      for (const p of Object.keys(flat)) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
      return answer(200, { tree: [...[...dirs].map((d) => ({ path: d, type: 'tree', sha: `d-${d}` })), ...Object.entries(flat).map(([p, b]) => ({ path: p, type: 'blob', sha: b }))] });
    }
    if (o.method === 'GET' && route.startsWith('/git/blobs/')) { const b = gh.blobs[route.slice('/git/blobs/'.length)]; return b ? answer(200, { content: b.toString('base64'), encoding: 'base64' }) : answer(404, {}); }
    if (o.method === 'POST' && route === '/git/commits') { const sha = `c${++n}`; gh.commits[sha] = { tree: body.tree, parents: body.parents, message: body.message }; return answer(201, { sha }); }
    if (o.method === 'PATCH' && route === '/git/refs/heads/main') {
      // Someone else's commit lands first this many times.
      if (racing > 0) { racing--; const sha = `c${++n}`; gh.commits[sha] = { tree: gh.commits[gh.ref].tree, parents: [gh.ref] }; gh.ref = sha; return answer(422, { message: 'Update is not a fast forward' }); }
      if (gh.commits[body.sha].parents[0] !== gh.ref) return answer(422, { message: 'Update is not a fast forward' });
      gh.ref = body.sha; return answer(200, {});
    }
    return answer(404, { message: 'Not Found' });
  };
  gh.tree = () => gh.trees[gh.commits[gh.ref].tree];
  return gh;
}

test('a folder goes up as one commit, also into an empty repository and when someone else committed meanwhile', async () => {
  const files = [{ path: 'README.md', data: Buffer.from('hello') }, { path: 'video.webm', data: Buffer.from([1, 2, 3]) }];
  for (const opts of [{}, { empty: true }, { racing: 1 }]) {
    const gh = fakeGithub(opts);
    const steps = [];
    const r = await uploadFolder({ fetchImpl: gh.fetch, token: 'good', repo: 'Divine4k/reports', folder: 'recordings/x', files, message: 'Recording x', onStep: (s) => steps.push(s) });
    assert.strictEqual(r.url, 'https://github.com/Divine4k/reports/tree/main/recordings/x');
    const tree = gh.tree();
    assert.deepStrictEqual(gh.blobs[tree['recordings/x/video.webm']], Buffer.from([1, 2, 3]));
    assert.strictEqual(gh.blobs[tree['recordings/x/README.md']].toString(), 'hello');
    assert.strictEqual(gh.commits[gh.ref].message, 'Recording x');
    assert.ok(steps.some((s) => /video\.webm/.test(s)));
    if (opts.empty) assert.strictEqual(tree['README.md'], 'first');
  }
});

test('GitHub refusing is told in plain words', async () => {
  const gh = fakeGithub();
  const files = [{ path: 'a.txt', data: Buffer.from('a') }];
  await assert.rejects(uploadFolder({ fetchImpl: gh.fetch, token: 'bad', repo: 'Divine4k/reports', folder: 'f', files, message: 'm' }), /did not accept the token/);
  await assert.rejects(uploadFolder({ fetchImpl: gh.fetch, token: '', repo: 'Divine4k/reports', folder: 'f', files, message: 'm' }), /No GitHub token/);
  await assert.rejects(uploadFolder({ fetchImpl: gh.fetch, token: 'good', repo: 'nothing', folder: 'f', files, message: 'm' }), /No reports repository/);
  await assert.rejects(uploadFolder({ fetchImpl: gh.fetch, token: 'good', repo: 'Divine4k/reports', folder: 'f', files: [{ path: 'big', data: { length: 200 * 1024 * 1024 } }], message: 'm' }), /more than GitHub takes/);
});

test('record, stop, write a note and send: the folder lands in the repository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-rec-'));
  const gh = fakeGithub();
  const said = [];
  // The screen recorder writes a few bytes of "video".
  const recorder = {
    async start({ dir }) { this.file = path.join(dir, 'video.webm'); return { width: 1600, height: 900, mime: 'video/webm;codecs=vp9', screen: { width: 2560, height: 1440, scaleFactor: 1 } }; },
    async stop() { fs.writeFileSync(this.file, Buffer.from('webm!')); return { bytes: 5 }; },
  };
  let role = 'moderator';
  const cloud = { github: async () => (role ? { repo: 'Divine4k/reports', token: 'good' } : { error: 'Only admins and moderators can send recordings.' }) };
  const t = new Troubleshoot({
    dir, recorder, displayId: () => null, version: '0.25.0', cloud, fetchImpl: gh.fetch,
    snapshot: async () => ({ state: { status: { log: { ok: true } }, summary: { runs: [] } }, inventory: { open: false } }),
    who: () => ({ name: 'Helper', role }), say: (text, bad) => said.push([text, !!bad]),
  });
  t.event('key', { dir: 'down', key: 'A' }); // not recording: not kept
  await t.start();
  assert.ok(t.recording);
  // The keyboard helper as the recorder sees it.
  const handlers = {};
  t.attachHook({ UiohookKey: { Tab: 15 }, uIOhook: { on: (ev, fn) => { handlers[ev] = fn; } } });
  handlers.keydown({ keycode: 15 }); handlers.keydown({ keycode: 15 }); handlers.keyup({ keycode: 15 });
  t.ownKeys(1000); handlers.keydown({ keycode: 15 }); t.ownUntil = 0; handlers.keyup({ keycode: 15 });
  handlers.mousedown({ button: 1, x: 10, y: 20 });
  t.event('log', { line: 'You have entered Strand.' });
  t.state({ status: { log: { ok: false, error: 'gone' } }, summary: { runs: [] } });
  const id = await t.stop();
  assert.ok(!t.recording);
  assert.match(said.pop()[0], /Recording saved/);

  const list = t.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, id);
  assert.strictEqual(list[0].videoBytes, 5);
  const d = t.details(id);
  const kinds = d.events.map((e) => (e.kind === 'key' ? `key ${e.dir}` : e.kind));
  // The held key's repeat is left out.
  assert.deepStrictEqual(kinds, ['start', 'state', 'key down', 'key up', 'key down', 'key up', 'mouse', 'log', 'state', 'stop']);
  // Keys the app sends are marked as such.
  assert.deepStrictEqual(d.events.filter((e) => e.kind === 'key').map((e) => e.by || 'you'), ['you', 'you', 'app', 'you']);
  assert.strictEqual(t.video(id).toString(), 'webm!');
  assert.strictEqual(t.video('../x'), null);

  assert.match(await t.send(id, '  '), /Write a note first/);
  role = '';
  assert.match(await t.send(id, 'The map timer kept running in my hideout.'), /Only admins and moderators/);
  role = 'moderator';
  assert.strictEqual(await t.send(id), '');
  const tree = gh.tree();
  const sent = Object.keys(tree).filter((k) => k.startsWith(`recordings/${id}/`)).map((k) => k.split('/').pop()).sort();
  assert.deepStrictEqual(sent, ['README.md', 'events.json.gz', 'inventory-end.json.gz', 'inventory-start.json.gz', 'meta.json', 'state-end.json.gz', 'state-start.json.gz', 'video.webm']);
  assert.match(gh.blobs[tree[`recordings/${id}/README.md`]].toString(), /The map timer kept running in my hideout\./);
  assert.strictEqual(JSON.parse(zlib.gunzipSync(gh.blobs[tree[`recordings/${id}/events.json.gz`]])).events.length, 10);
  assert.match(gh.commits[gh.ref].message, /^Recording .*: The map timer kept running/);
  assert.ok(t.list()[0].sent.url.endsWith(`recordings/${id}`));

  assert.ok(t.remove(id));
  assert.deepStrictEqual(t.list(), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without the screen, keys and app events are still recorded', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-rec-'));
  const said = [];
  const t = new Troubleshoot({
    dir, recorder: { start: async () => { throw new Error('no screen here'); }, stop: async () => ({ bytes: 0 }) },
    displayId: () => null, version: 'x', cloud: {}, fetchImpl: null,
    snapshot: async () => { throw new Error('no inventory'); }, who: () => ({ name: '', role: '' }), say: (text, bad) => said.push([text, !!bad]),
  });
  await t.start();
  assert.deepStrictEqual(said[0], ['Recording keys and what the app does, but not the screen: no screen here', true]);
  t.event('notice', { text: 'hello' });
  const id = await t.stop();
  const d = t.details(id);
  assert.strictEqual(d.video, null);
  assert.match(d.videoProblem, /no screen here/);
  assert.ok(/-local$/.test(id));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('admins and moderators get everyone else\'s recordings from GitHub, and can remove them from their list', async () => {
  const gh = fakeGithub();
  const cloud = { github: async () => ({ repo: 'Divine4k/reports', token: 'good' }) };
  const make = (dir, name) => new Troubleshoot({
    dir, recorder: {
      async start({ dir }) { this.file = path.join(dir, 'video.webm'); return { width: 1600, height: 900, mime: 'video/webm', screen: { width: 1920, height: 1080, scaleFactor: 1 } }; },
      async stop() { fs.writeFileSync(this.file, Buffer.from(`video of ${name}`)); return { bytes: 13 }; },
    },
    displayId: () => null, version: 'x', cloud, fetchImpl: gh.fetch,
    snapshot: async () => ({ state: { status: {} }, inventory: null }), who: () => ({ name, role: 'moderator' }),
  });
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-b-'));
  const a = make(dirA, 'Helper');
  const b = make(dirB, 'Divine');
  await a.start(); a.event('notice', { text: 'hi' }); const id = await a.stop();
  assert.strictEqual(await a.send(id, 'The overlay flickers.'), '');

  assert.strictEqual(await b.syncRemote(), 1);
  assert.strictEqual(b.unseen, 1);
  const [r] = b.list();
  assert.deepStrictEqual([r.id, r.remote, r.seen, r.by, r.note], [id, true, false, 'Helper', 'The overlay flickers.']);
  assert.strictEqual(await b.syncRemote(), 0); // nothing new the second time
  const d = b.details(id);
  assert.ok(d.events.some((e) => e.kind === 'notice'));
  assert.strictEqual(b.unseen, 0);
  assert.strictEqual(b.video(id), null); // not fetched until watched
  assert.strictEqual((await b.videoFor(id)).toString(), 'video of Helper');
  assert.strictEqual(b.video(id).toString(), 'video of Helper');
  assert.match(await b.send(id, 'x'), /came from GitHub/);
  // The sender's own copy is not fetched back.
  assert.strictEqual(await a.syncRemote(), 0);
  // Removed from the list: it stays on GitHub and does not come back.
  assert.ok(b.remove(id));
  assert.strictEqual(await b.syncRemote(), 0);
  assert.deepStrictEqual(b.list(), []);

  // A broken token is told, not thrown.
  const c = make(fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-c-')), 'X');
  c.cloud = { github: async () => ({ repo: 'Divine4k/reports', token: 'bad' }) };
  assert.strictEqual(await c.syncRemote(), 0);
  assert.match(c.remoteError, /did not accept the token/);
  for (const dir of [dirA, dirB, c.dir]) fs.rmSync(dir, { recursive: true, force: true });
});

test('a written report goes up with its pictures, and fixed marks are shared through the repository', async () => {
  const gh = fakeGithub();
  const cloud = { github: async () => ({ repo: 'Divine4k/reports', token: 'good' }) };
  const make = (name) => new Troubleshoot({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-n-')), recorder: {}, displayId: () => null, version: 'x', cloud, fetchImpl: gh.fetch,
    snapshot: async () => ({ state: { status: { log: { ok: true } } }, inventory: null }), who: () => ({ name, role: 'moderator' }),
  });
  const a = make('Helper');
  const b = make('Divine');
  const id = await a.newReport();
  assert.strictEqual(a.list()[0].kind, 'note');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  assert.strictEqual(a.addImage(id, png, 'image/png'), '');
  assert.strictEqual(a.addImage(id, Buffer.from('x'), 'image/jpeg'), '');
  assert.match(a.addImage(id, Buffer.from('x'), 'text/plain'), /Only PNG/);
  assert.match(a.addImage(id, Buffer.alloc(9 * 1024 * 1024), 'image/png'), /up to 8 MB/);
  assert.ok(a.removeImage(id, 'image-2.jpg'));
  assert.strictEqual(a.addImage(id, Buffer.from('y'), 'image/jpeg'), ''); // the free number is used again
  assert.deepStrictEqual(a.meta(id).images, ['image-1.png', 'image-2.jpg']);
  assert.ok(a.image(id, 'image-1.png').equals(png));
  assert.strictEqual(a.image(id, '../meta.json'), null);
  assert.match(await a.setStatus(id, { state: 'fixed' }), /Send it first/);
  assert.strictEqual(await a.send(id, 'The Items page shows the wrong league.'), '');

  const tree = gh.tree();
  const readme = gh.blobs[tree[`recordings/${id}/README.md`]].toString();
  assert.match(readme, /^# Report /);
  assert.match(readme, /!\[image-1\.png\]\(image-1\.png\)/);
  assert.ok(gh.blobs[tree[`recordings/${id}/image-1.png`]].equals(png));
  assert.match(gh.commits[gh.ref].message, /^Report /);

  // Someone else gets it, pictures included, and marks it fixed; the sender then sees that too.
  assert.strictEqual(await b.syncRemote(), 1);
  const [r] = b.list();
  assert.deepStrictEqual([r.kind, r.images, r.state, r.type], ['note', 2, '', 'problem']);
  assert.ok(b.image(id, 'image-1.png').equals(png));
  assert.match(b.addImage(id, png, 'image/png'), /written report/); // not to someone else's
  assert.strictEqual(await b.setStatus(id, { state: 'fixed' }), '');
  assert.deepStrictEqual(JSON.parse(gh.blobs[gh.tree()[`status/${id}.json`]].toString()).by, 'Divine');
  await a.syncRemote();
  assert.deepStrictEqual([a.list()[0].state, a.list()[0].statusBy, a.list()[0].by], ['fixed', 'Divine', 'Helper']);
  assert.strictEqual(a.details(id).state, 'fixed');
  // And back.
  assert.strictEqual(await a.setStatus(id, { state: '' }), '');
  await b.syncRemote();
  assert.strictEqual(b.list()[0].state, '');
  assert.ok(!(`status/${id}.json` in gh.tree()), 'back to open leaves no file');
  for (const t of [a, b]) fs.rmSync(t.dir, { recursive: true, force: true });
});

test('quick marks one after another all stick, the old single list is taken over, and a look meanwhile undoes nothing', async () => {
  const gh = fakeGithub();
  const cloud = { github: async () => ({ repo: 'Divine4k/reports', token: 'good' }) };
  const t = new Troubleshoot({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-f-')), recorder: {}, displayId: () => null, version: 'x', cloud, fetchImpl: gh.fetch,
    snapshot: async () => ({ state: {} }), who: () => ({ name: 'Divine', role: 'admin' }),
  });
  // Three reports on GitHub, and the list of marks as version 0.28.1 kept it.
  const ids = [];
  for (let i = 0; i < 3; i++) { const id = await t.newReport(); ids.push(id); await t.send(id, `report ${i}`); await new Promise((r) => setTimeout(r, 1100)); }
  await uploadFolder({ fetchImpl: gh.fetch, token: 'good', repo: 'Divine4k/reports', folder: '', files: [{ path: 'status.json', data: Buffer.from(JSON.stringify({ [ids[0]]: { fixed: true, by: 'Old', at: 1 } })) }], message: 'old list' });
  await t.syncRemote();
  assert.strictEqual(t.statusOf(ids[0]).by, 'Old');

  // Clicked quickly: the second and third start before the first is done.
  const looking = t.syncRemote();
  const done = await Promise.all([t.setStatus(ids[1], { state: 'fixed' }), t.setStatus(ids[2], { state: 'in progress' }), t.setStatus(ids[1], { state: '' })]);
  await looking;
  assert.deepStrictEqual(done, ['', '', '']);
  assert.deepStrictEqual(t.marking.size, 0);
  const tree = gh.tree();
  assert.ok(!('status.json' in tree), 'the old list is gone');
  assert.ok(`status/${ids[0]}.json` in tree, 'its mark lives on as a file');
  assert.ok(!(`status/${ids[1]}.json` in tree));
  assert.ok(`status/${ids[2]}.json` in tree);
  assert.deepStrictEqual(ids.map((id) => (t.statusOf(id) || {}).state || ''), ['fixed', '', 'in progress']);
  // A later look agrees.
  await t.syncRemote();
  assert.deepStrictEqual(ids.map((id) => (t.statusOf(id) || {}).state || ''), ['fixed', '', 'in progress']);
  assert.strictEqual(t.statusOf(ids[0]).by, 'Old');
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test('times count from the video\'s first frame, and a big video goes up in parts and comes back whole', async () => {
  const { performance } = require('perf_hooks');
  const gh = fakeGithub();
  const cloud = { github: async () => ({ repo: 'Divine4k/reports', token: 'good' }) };
  const make = (name) => new Troubleshoot({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-p-')), partBytes: 4, displayId: () => null, version: 'x', cloud, fetchImpl: gh.fetch,
    recorder: {
      // The first frame was taken 250 ms before the recorder answered.
      async start({ dir }) { this.file = path.join(dir, 'video.mp4'); return { width: 1920, height: 1080, fps: 60, mime: 'video/mp4;codecs=avc1', file: 'video.mp4', at: performance.timeOrigin + performance.now() - 250, screen: { width: 2560, height: 1440, scaleFactor: 1 } }; },
      async stop() { fs.writeFileSync(this.file, Buffer.from('0123456789')); return { bytes: 10 }; },
    },
    snapshot: async () => ({ state: {} }), who: () => ({ name, role: 'moderator' }),
  });
  const a = make('Helper');
  await a.start();
  a.event('notice', { text: 'now' });
  const id = await a.stop();
  const d = a.details(id);
  const notice = d.events.find((e) => e.kind === 'notice');
  assert.ok(notice.t >= 250 && notice.t < 2000, `a notice right after the start is ${notice.t} ms into the video`);
  assert.strictEqual(Math.round(notice.t * 10) / 10, notice.t);
  assert.deepStrictEqual([d.video.file, d.video.fps], ['video.mp4', 60]);
  assert.strictEqual(a.video(id).toString(), '0123456789');

  assert.strictEqual(await a.send(id, 'Parts test'), '');
  const tree = gh.tree();
  const parts = Object.keys(tree).filter((k) => k.startsWith(`recordings/${id}/video.mp4.part`)).sort();
  assert.strictEqual(parts.length, 3);
  assert.ok(!(`recordings/${id}/video.mp4` in tree));
  assert.match(gh.blobs[tree[`recordings/${id}/README.md`]].toString(), /in 3 parts/);

  const b = make('Divine');
  await b.syncRemote();
  assert.strictEqual((await b.videoFor(id)).toString(), '0123456789');
  for (const t of [a, b]) fs.rmSync(t.dir, { recursive: true, force: true });
});

test('the short version folds presses, runs of keys and log noise into a few rows', () => {
  const { summarise } = require('../src/core/recording');
  const ev = [
    { t: 0, kind: 'start' },
    { t: 100.4, kind: 'key', dir: 'down', key: 'W' }, { t: 180.9, kind: 'key', dir: 'up', key: 'W' },
    { t: 300, kind: 'key', dir: 'down', key: 'W' }, { t: 350, kind: 'key', dir: 'up', key: 'W' },
    { t: 500, kind: 'mouse', dir: 'down', button: 'left', x: 5, y: 6 }, { t: 620, kind: 'mouse', dir: 'up', button: 'left', x: 5, y: 6 },
    { t: 900, kind: 'log', line: '2026/11/24 17:05:11 123456 abc [INFO Client 1234] : You have entered Strand.' },
    { t: 950, kind: 'log', line: '2026/11/24 17:05:11 1 abc [DEBUG Client 1] Got Instance Details' },
    { t: 960, kind: 'console', level: 'log', text: 'chatty' },
    { t: 970, kind: 'state', notice: 'Saved.' },
    { t: 5000, kind: 'key', dir: 'down', key: 'Ctrl+Alt+C', by: 'app' },
    { t: 9000, kind: 'mouse', dir: 'down', button: 'right', x: 1, y: 2 },
  ];
  const { rows, quiet } = summarise(ev);
  assert.deepStrictEqual(rows.map((r) => [r.t, r.lane, r.text]), [
    [0, 'app', 'Recording started'],
    [100.4, 'input', 'W ×2, left click'],
    [900, 'game', 'You have entered Strand.'],
    [5000, 'input', 'Pressed Ctrl+Alt+C (sent by the app)'],
    [9000, 'input', 'Clicked right at 1, 2'],
  ]);
  assert.deepStrictEqual(rows[1].items.map((i) => i.text), ['Pressed W, held 81 ms', 'Pressed W, held 50 ms', 'Clicked left at 5, 6, held 120 ms']);
  assert.strictEqual(quiet, 2);
  // Everything keeps the noise.
  assert.strictEqual(summarise(ev, { everything: true }).quiet, 0);
});

test('a suggestion is chosen before sending; status and type are shared, and the fixed marks of 0.28 to 0.45 still count', async () => {
  const gh = fakeGithub();
  const cloud = { github: async () => ({ repo: 'Divine4k/reports', token: 'good' }) };
  const make = (name) => new Troubleshoot({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-s-')), recorder: {}, displayId: () => null, version: 'x', cloud, fetchImpl: gh.fetch,
    snapshot: async () => ({ state: {} }), who: () => ({ name, role: 'moderator' }),
  });
  const a = make('Helper');
  const b = make('Divine');
  const idea = await a.newReport();
  assert.ok(a.setType(idea, 'suggestion'));
  assert.ok(!a.setType(idea, 'rant'));
  assert.strictEqual(await a.send(idea, 'Save regexes for the stash search.'), '');
  assert.match(gh.blobs[gh.tree()[`recordings/${idea}/README.md`]].toString(), /- Type: suggestion/);
  const bug = await a.newReport();
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(await a.send(bug, 'Timer runs on.'), '');
  // A mark as 0.28.2 to 0.45 made it.
  await uploadFolder({ fetchImpl: gh.fetch, token: 'good', repo: 'Divine4k/reports', folder: '', files: [{ path: `fixed/${bug}.json`, data: Buffer.from(JSON.stringify({ fixed: true, by: 'Old', at: 1 })) }], message: 'old mark' });

  await b.syncRemote();
  const byId = (t) => Object.fromEntries(t.list().map((r) => [r.id, r]));
  assert.deepStrictEqual([byId(b)[idea].type, byId(b)[idea].state], ['suggestion', '']);
  assert.deepStrictEqual([byId(b)[bug].type, byId(b)[bug].state, byId(b)[bug].statusBy], ['problem', 'fixed', 'Old']);
  assert.ok(!b.setType(bug, 'suggestion'), 'someone else\'s type is changed through the status, not before sending');

  assert.strictEqual(await b.setStatus(idea, { state: 'planned' }), '');
  // Put in the tracker: the box is remembered, and back to open keeps it while it is there.
  assert.strictEqual(await b.setStatus(idea, { issue: 12, state: '' }), '');
  assert.deepStrictEqual(JSON.parse(gh.blobs[gh.tree()[`status/${idea}.json`]].toString()).issue, 12);
  assert.match(await b.setStatus(idea, { issue: -1 }), /Unknown tracker item/);
  assert.strictEqual(await b.setStatus(idea, { issue: null, state: 'planned' }), '');
  assert.ok(!('issue' in JSON.parse(gh.blobs[gh.tree()[`status/${idea}.json`]].toString())));
  assert.strictEqual(await b.setStatus(bug, { type: 'suggestion' }), '');
  assert.match(await b.setStatus(bug, { state: 'maybe' }), /Unknown status/);
  const tree = gh.tree();
  assert.ok(!(`fixed/${bug}.json` in tree), 'the old mark moved');
  assert.deepStrictEqual(JSON.parse(gh.blobs[tree[`status/${bug}.json`]].toString()).state, 'fixed');
  await a.syncRemote();
  assert.deepStrictEqual([byId(a)[idea].state, byId(a)[idea].issue, byId(a)[bug].type, byId(a)[bug].state], ['planned', null, 'suggestion', 'fixed']);
  for (const t of [a, b]) fs.rmSync(t.dir, { recursive: true, force: true });
});
