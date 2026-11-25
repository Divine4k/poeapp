'use strict';
// The Tracker page's list as GitHub issues (src/tracker.js), against a stand-in for GitHub,
// and the steps of an item (src/ui/steps.js).
const test = require('node:test');
const assert = require('node:assert');
const { parseSteps, joinSteps, progress } = require('../src/ui/steps');
const { listItems, addItem, updateItem, statusOf, labelsFor } = require('../src/tracker');

test('steps are lifted out of the text and put back after the notes', () => {
  const body = 'Read a stash tab.\r\n\r\n- [x] Find the grid\n- [ ] Read the items\n* [X] Bundle data\nMore notes';
  const p = parseSteps(body);
  assert.strictEqual(p.notes, 'Read a stash tab.\n\nMore notes');
  assert.deepStrictEqual(p.steps, [{ text: 'Find the grid', done: true }, { text: 'Read the items', done: false }, { text: 'Bundle data', done: true }]);
  assert.deepStrictEqual(progress(body), { done: 2, total: 3 });
  assert.strictEqual(joinSteps(' Notes ', [{ text: 'a', done: true }, { text: ' ', done: false }, { text: 'b' }]), 'Notes\n\n- [x] a\n- [ ] b');
  assert.strictEqual(joinSteps('', []), '');
  assert.deepStrictEqual(progress(''), { done: 0, total: 0 });
});

test('where an item stands comes from its state and labels', () => {
  assert.strictEqual(statusOf({ state: 'closed', labels: [{ name: 'in progress' }] }), 'done');
  assert.strictEqual(statusOf({ state: 'open', labels: [{ name: 'in progress' }, { name: 'idea' }] }), 'doing');
  assert.strictEqual(statusOf({ state: 'open', labels: ['idea'] }), 'idea');
  assert.strictEqual(statusOf({ state: 'open', labels: [] }), 'todo');
  // Its own labels stay; the status and priority ones are replaced.
  assert.deepStrictEqual(labelsFor(['look', 'idea', 'priority: low'], 'doing', 'high'), ['look', 'in progress', 'priority: high']);
  assert.deepStrictEqual(labelsFor(['idea'], 'todo', 'normal'), []);
});

// Just enough of GitHub's issues API.
function fakeGithub(token = 'good') {
  const issues = [];
  const calls = [];
  const fetch = async (url, opt) => {
    const u = new URL(url);
    calls.push(`${opt.method} ${u.pathname}${u.search}`);
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (opt.headers.Authorization !== `Bearer ${token}`) return reply(401, { message: 'Bad credentials' });
    const m = /^\/repos\/Divine4k\/poeapp\/issues(?:\/(\d+))?$/.exec(u.pathname);
    if (!m) return reply(404, { message: 'Not Found' });
    const body = opt.body ? JSON.parse(opt.body) : null;
    const at = new Date(1700000000000 + calls.length * 1000).toISOString();
    if (!m[1] && opt.method === 'GET') {
      const state = u.searchParams.get('state');
      return reply(200, issues.filter((i) => i.state === state));
    }
    if (!m[1] && opt.method === 'POST') {
      const i = { number: issues.length + 1, title: body.title, body: body.body, state: 'open', state_reason: null, labels: body.labels.map((name) => ({ name })), user: { login: 'Divine4k' }, html_url: `https://github.com/Divine4k/poeapp/issues/${issues.length + 1}`, created_at: at, updated_at: at, closed_at: null };
      issues.push(i);
      return reply(201, i);
    }
    const i = issues.find((x) => x.number === Number(m[1]));
    if (!i) return reply(404, { message: 'Not Found' });
    if (opt.method === 'GET') return reply(200, i);
    if (body.labels) i.labels = body.labels.map((name) => ({ name }));
    for (const k of ['title', 'body', 'state', 'state_reason']) if (body[k] !== undefined) i[k] = body[k];
    i.closed_at = i.state === 'closed' ? at : null;
    i.updated_at = at;
    return reply(200, i);
  };
  return { fetch, issues, calls };
}

test('items are added, moved, edited and listed as GitHub issues', async () => {
  const gh = fakeGithub();
  const base = { fetchImpl: gh.fetch, token: 'good', repo: 'Divine4k/poeapp' };
  const a = await addItem({ ...base, title: '  Stash tab pricing ', status: 'todo', priority: 'high' });
  assert.strictEqual(a.title, 'Stash tab pricing');
  assert.strictEqual(a.status, 'todo');
  assert.strictEqual(a.priority, 'high');
  await addItem({ ...base, title: 'New name for the app' }); // an idea by default
  gh.issues.push({ number: 3, title: 'A pull request', state: 'open', labels: [], pull_request: {} });
  // A label added on GitHub (or by Claude) survives a move.
  gh.issues[0].labels.push({ name: 'look' });
  const moved = await updateItem({ ...base, number: 1, patch: { status: 'doing', body: '- [x] grid\n- [ ] items' } });
  assert.strictEqual(moved.status, 'doing');
  assert.deepStrictEqual(moved.labels, ['look']);
  assert.deepStrictEqual(moved.progress, { done: 1, total: 2 });
  assert.strictEqual(moved.priority, 'high');
  const done = await updateItem({ ...base, number: 1, patch: { status: 'done' } });
  assert.strictEqual(done.status, 'done');
  assert.strictEqual(gh.issues[0].state_reason, 'completed');
  assert.ok(done.closed > 0);
  const again = await updateItem({ ...base, number: 1, patch: { status: 'idea' } });
  assert.strictEqual(again.status, 'idea');
  assert.strictEqual(gh.issues[0].state, 'open');
  const list = await listItems(base);
  assert.deepStrictEqual(list.map((i) => [i.number, i.status]).sort(), [[1, 'idea'], [2, 'idea']]);
  await assert.rejects(addItem({ ...base, title: ' ' }), /title/);
  await assert.rejects(updateItem({ ...base, number: 2, patch: { title: '' } }), /empty/);
});

test('what GitHub refuses is said plainly', async () => {
  const gh = fakeGithub();
  await assert.rejects(listItems({ fetchImpl: gh.fetch, token: 'old', repo: 'Divine4k/poeapp' }), /did not accept the token/);
  await assert.rejects(listItems({ fetchImpl: gh.fetch, token: 'good', repo: 'Divine4k/other' }), /does not know the repository Divine4k\/other/);
  await assert.rejects(listItems({ fetchImpl: gh.fetch, token: 'good', repo: '' }), /No tracker repository/);
});
