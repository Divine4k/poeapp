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
    if (o.method === 'POST' && route === '/git/trees') { const sha = `t${++n}`; gh.trees[sha] = { ...gh.trees[body.base_tree] }; for (const e of body.tree) gh.trees[sha][e.path] = e.sha; return answer(201, { sha }); }
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
    async start({ file }) { this.file = file; return { width: 1600, height: 900, mime: 'video/webm;codecs=vp9', screen: { width: 2560, height: 1440, scaleFactor: 1 } }; },
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
      async start({ file }) { this.file = file; return { width: 1600, height: 900, mime: 'video/webm', screen: { width: 1920, height: 1080, scaleFactor: 1 } }; },
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
