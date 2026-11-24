'use strict';
// The account server (server/worker.js) run against a real SQL engine, and the app's side of
// it (src/cloud.js) talking to that server without a network in between.
const test = require('node:test');
const assert = require('node:assert');
const { Cloud, checkEntry, stretch } = require('../src/cloud');

const { server: startServer, quick, hasSql } = require('./server');

async function server() { const x = await startServer(); return { env: x.env, fetchImpl: x.fetchImpl, make: x.client }; }
let current = null;
const client = (fetchImpl, saved = null) => current.make(saved);
const aSession = (id, runIds) => ({ id, startedAt: 1000, endedAt: 2000, divine: 200, strategy: { name: 'Legion', atlasUrl: '' }, totals: { maps: runIds.length, deaths: 1, lootValue: 50, costValue: 10, net: 40, mapMs: 900 }, runs: runIds.map((r) => ({ id: r, name: 'Strand', loot: [{ name: 'Chaos Orb', qty: 3 }] })) });
const source = (sessions, pictures = {}) => ({ ids: () => Object.keys(sessions), session: (id) => sessions[id] || null, pictures: (id) => pictures[id] || null });

test('entry check names what is wrong before anything is sent', () => {
  assert.match(checkEntry('ab', 'longenough', 'longenough'), /3 to 20/);
  assert.match(checkEntry('has space', 'longenough', 'longenough'), /3 to 20/);
  assert.match(checkEntry('Divine4k', 'short', 'short'), /at least 8/);
  assert.match(checkEntry('Divine4k', 'longenough', 'different'), /not the same/);
  assert.strictEqual(checkEntry('Divine4k', 'longenough', 'longenough'), '');
});

test('the password is stretched the same way every time, and differently per name', async () => {
  const a = await stretch('Divine4k', 'correct horse');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.strictEqual(a, await stretch('divine4K', 'correct horse'));
  assert.notStrictEqual(a, await stretch('Someone', 'correct horse'));
});

test('without a server address there are no accounts', async () => {
  const c = new Cloud({ url: '', fetchImpl: () => { throw new Error('must not be called'); } });
  assert.strictEqual(c.enabled, false);
  assert.match(await c.register('Divine4k', 'longenough', 'longenough'), /not switched on/);
  await c.sync(source({ a: aSession('a', []) }));
});

const live = hasSql ? test : test.skip;

live('register, then log in from another PC; a taken name and a wrong password are refused', async () => {
  current = await server(); const { env, fetchImpl } = current;
  const a = client(fetchImpl);
  assert.strictEqual(await a.register('Divine4k', 'correct horse', 'correct horse'), '');
  assert.ok(a.signedIn);
  assert.strictEqual(a.box.saved.name, 'Divine4k');

  assert.match(await client(fetchImpl).register('divine4k', 'another password', 'another password'), /taken/);
  assert.match(await client(fetchImpl).login('Divine4k', 'wrong password'), /Wrong name or password/);
  assert.match(await client(fetchImpl).login('Nobody', 'correct horse'), /Wrong name or password/);

  const b = client(fetchImpl);
  assert.strictEqual(await b.login('DIVINE4K', 'correct horse'), '');
  assert.strictEqual(b.name, 'Divine4k');

  // Neither the password nor what was sent in its place is kept as it arrived.
  const user = await env.DB.prepare('SELECT * FROM users').first();
  assert.ok(!JSON.stringify(user).includes('correct horse'));
  assert.ok(!JSON.stringify(user).includes(await quick('Divine4k', 'correct horse')));
});

live('sessions and pictures go up once, land under the right person, and can be read by others', async () => {
  current = await server(); const { env, fetchImpl } = current;
  const a = client(fetchImpl);
  await a.register('Divine4k', 'correct horse', 'correct horse');
  const sessions = { s1: aSession('s1', ['r1', 'r2']), s2: aSession('s2', ['r3']) };
  const pictures = { r1: JSON.stringify({ trips: [{ trip: 1, image: 'data:image/jpeg;base64,AAAA' }] }), r3: JSON.stringify({ trips: [] }) };
  await a.sync(source(sessions, pictures));
  assert.strictEqual(a.error, null);
  assert.deepStrictEqual(a.sent, { s1: 1, s2: 1 });
  assert.strictEqual(a.waiting, 0);
  const keys = [...env.files.keys()].sort();
  assert.strictEqual(keys.length, 4);
  assert.ok(keys.every((k) => /^(sessions|pictures)\/[0-9a-f]{16}\//.test(k)));

  // A second pass sends nothing.
  let calls = 0;
  a.fetch = (...x) => { calls++; return fetchImpl(...x); };
  await a.sync(source(sessions, pictures));
  assert.strictEqual(calls, 0);

  const b = client(fetchImpl);
  await b.register('Friend', 'another password', 'another password');
  const users = await b.call('GET', 'users');
  assert.deepStrictEqual(users.data.users.map((u) => [u.name, u.sessions]), [['Divine4k', 2], ['Friend', 0]]);
  const list = await b.call('GET', 'users/divine4k/sessions');
  assert.deepStrictEqual(list.data.sessions.map((s) => s.id).sort(), ['s1', 's2']);
  assert.strictEqual(list.data.sessions[0].strategy, 'Legion');
  assert.strictEqual(list.data.sessions[0].totals.net, 40);
  const one = await b.call('GET', 'users/Divine4k/sessions/s1');
  assert.strictEqual(one.data.runs[0].loot[0].name, 'Chaos Orb');
  const pic = await b.call('GET', 'users/Divine4k/pictures/r1');
  assert.strictEqual(pic.data.trips[0].trip, 1);

  // Nobody can write into someone else's folder: the same id under another account is another file.
  await b.sync(source({ s1: aSession('s1', []) }));
  assert.strictEqual((await b.call('GET', 'users/Divine4k/sessions/s1')).data.runs.length, 2);
});

live('nothing is accepted or shown without logging in', async () => {
  current = await server(); const { env, fetchImpl } = current;
  for (const [method, route] of [['GET', 'users'], ['GET', 'me'], ['PUT', 'sessions/s1'], ['PUT', 'pictures/r1'], ['GET', 'users/x/sessions']]) {
    const res = await fetchImpl(`https://server.test/v1/${route}`, { method, body: method === 'PUT' ? '{}' : undefined });
    assert.strictEqual(res.status, 401, route);
  }
  assert.strictEqual(env.files.size, 0);
});

live('a deleted session comes off the server with its pictures', async () => {
  current = await server(); const { env, fetchImpl } = current;
  const a = client(fetchImpl);
  await a.register('Divine4k', 'correct horse', 'correct horse');
  const sessions = { s1: aSession('s1', ['r1']) };
  await a.sync(source(sessions, { r1: '{"trips":[]}' }));
  assert.strictEqual(env.files.size, 2);
  a.forget('s1', ['r1']);
  await a.sync(source({}));
  assert.strictEqual(env.files.size, 0);
  assert.deepStrictEqual(a.gone, []);
  assert.strictEqual((await a.call('GET', 'users/Divine4k/sessions')).data.sessions.length, 0);
});

live('when the server cannot be reached the rest waits, and goes up on the next try', async () => {
  current = await server(); const { env, fetchImpl } = current;
  const a = client(fetchImpl);
  await a.register('Divine4k', 'correct horse', 'correct horse');
  const sessions = { s1: aSession('s1', []), s2: aSession('s2', []) };
  let n = 0;
  a.fetch = (...x) => { if (++n === 2) throw new Error('Could not reach server.test'); return fetchImpl(...x); };
  await a.sync(source(sessions));
  assert.match(a.error, /Could not reach/);
  assert.deepStrictEqual(a.sent, { s1: 1 });
  assert.strictEqual(a.busy, false);
  a.fetch = fetchImpl;
  await a.sync(source(sessions));
  assert.strictEqual(a.error, null);
  assert.deepStrictEqual(Object.keys(a.sent), ['s1', 's2']);
  assert.strictEqual(env.files.size, 2);
});

live('logging out ends the token; deleting the account removes everything', async () => {
  current = await server(); const { env, fetchImpl } = current;
  const a = client(fetchImpl);
  await a.register('Divine4k', 'correct horse', 'correct horse');
  const token = a.token;
  await a.sync(source({ s1: aSession('s1', ['r1']) }, { r1: '{"trips":[]}' }));
  await a.logout();
  assert.strictEqual(a.signedIn, false);
  const res = await fetchImpl('https://server.test/v1/me', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  assert.strictEqual(res.status, 401);

  assert.strictEqual(await a.login('Divine4k', 'correct horse'), '');
  assert.deepStrictEqual(a.sent, { s1: 1 }); // the same person again: nothing is sent twice
  assert.match(await a.deleteAccount('wrong password'), /Wrong password/);
  assert.strictEqual(await a.deleteAccount('correct horse'), '');
  assert.strictEqual(env.files.size, 0);
  assert.match(await client(fetchImpl).login('Divine4k', 'correct horse'), /Wrong name or password/);
});

live('a token that stopped working signs this PC out instead of failing forever', async () => {
  current = await server(); const { fetchImpl } = current;
  const a = client(fetchImpl);
  await a.register('Divine4k', 'correct horse', 'correct horse');
  a.token = 'f'.repeat(64);
  await a.sync(source({ s1: aSession('s1', []) }));
  assert.strictEqual(a.signedIn, false);
  assert.match(a.error, /Log in again/);
});

live('too many wrong passwords lock the name for a while; oversized uploads are refused', async () => {
  current = await server(); const { fetchImpl } = current;
  const a = client(fetchImpl);
  await a.register('Divine4k', 'correct horse', 'correct horse');
  let last = '';
  for (let i = 0; i < 11; i++) last = await client(fetchImpl).login('Divine4k', `guess number ${i}`);
  assert.match(last, /Too many wrong passwords/);
  const big = JSON.stringify({ ...aSession('big', []), pad: 'x'.repeat(1100 * 1024) });
  const r = await a.call('PUT', 'sessions/big', { text: big });
  assert.strictEqual(r.status, 413);
  const bad = await a.call('PUT', 'sessions/s9', { text: JSON.stringify({ id: 'other', runs: [], totals: {} }) });
  assert.strictEqual(bad.status, 400);
});

live('roles: an admin lists accounts, makes a moderator, and shares the GitHub settings with admins and moderators only', async () => {
  const { account, client: newClient } = await startServer();
  const boss = await account('Divine4k', { admin: true });
  const helper = await account('Helper');
  const player = await account('Player');
  // The role is read from the server, so one given while logged in arrives without logging in again.
  assert.strictEqual(boss.role, '');
  assert.strictEqual(await boss.refresh(), true);
  assert.strictEqual(boss.role, 'admin');
  assert.strictEqual(boss.status.role, 'admin');

  const list = await boss.users();
  assert.deepStrictEqual(list.users.map((u) => [u.name, u.role]).sort(), [['Divine4k', 'admin'], ['Helper', ''], ['Player', '']]);
  assert.ok(!('role' in (await player.users()).users[0]), 'only an admin sees roles');

  assert.strictEqual(await boss.setRole('helper', 'moderator'), '');
  assert.match(await boss.setRole('Divine4k', ''), /own role/);
  assert.match(await boss.setRole('Nobody', 'moderator'), /Nobody has that name/);
  assert.match(await boss.setRole('Player', 'king'), /A role is/);
  assert.match(await player.setRole('Helper', ''), /Only an admin/);
  await helper.refresh();
  assert.strictEqual(helper.role, 'moderator');
  // Logging in again brings the role along.
  const again = newClient();
  assert.strictEqual(await again.login('Helper', 'correct horse'), '');
  assert.strictEqual(again.role, 'moderator');
  assert.strictEqual(again.box.saved.role, 'moderator');

  assert.match((await player.github()).error, /Only admins and moderators/);
  assert.match((await helper.setGithub({ token: 'x'.repeat(40) })).error, /Only an admin/);
  assert.match((await boss.setGithub({ repo: 'not a repo' })).error, /owner\/name/);
  assert.match((await boss.setGithub({ token: 'no spaces allowed here' })).error, /GitHub token/);
  const saved = await boss.setGithub({ repo: 'Divine4k/poeapp-reports', token: `github_pat_${'a'.repeat(40)}` });
  assert.deepStrictEqual([saved.repo, saved.hasToken, 'token' in saved], ['Divine4k/poeapp-reports', true, false]);
  const got = await helper.github();
  assert.strictEqual(got.repo, 'Divine4k/poeapp-reports');
  assert.strictEqual(got.token, `github_pat_${'a'.repeat(40)}`);
  // Changing only the repository keeps the token.
  await boss.setGithub({ repo: 'Divine4k/other' });
  assert.strictEqual((await boss.github()).token, got.token);

  // Taking the role away closes the door again.
  assert.strictEqual(await boss.setRole('Helper', ''), '');
  assert.strictEqual(await helper.refresh(), true);
  assert.strictEqual(helper.role, '');
  assert.match((await helper.github()).error, /Only admins and moderators/);
  await helper.logout();
  assert.strictEqual(helper.box.saved.role, '');
});
