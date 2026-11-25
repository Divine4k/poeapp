'use strict';
// The Tracker page's list as GitHub issues (src/tracker.js), against a stand-in for GitHub,
// and the steps of an item (src/ui/steps.js).
const test = require('node:test');
const assert = require('node:assert');
const { parseSteps, joinSteps, progress } = require('../src/ui/steps');
const { listItems, addItem, updateItem, setParent, deleteItem, statusOf, labelsFor } = require('../src/tracker');

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
// withParent: false acts like a GitHub that leaves parent_issue_url out of its answers.
function fakeGithub(token = 'good', { withParent = true } = {}) {
  const issues = [];
  const parentOf = new Map(); // number -> parent number
  const url = (n) => `https://api.github.com/repos/Divine4k/poeapp/issues/${n}`;
  const show = (i) => {
    const kids = [...parentOf.values()].filter((p) => p === i.number).length;
    const out = { ...i, sub_issues_summary: { total: kids, completed: 0 } };
    if (withParent) out.parent_issue_url = parentOf.has(i.number) ? url(parentOf.get(i.number)) : null;
    return out;
  };
  const calls = [];
  const fetch = async (url, opt) => {
    const u = new URL(url);
    calls.push(`${opt.method} ${u.pathname}${u.search}`);
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (opt.headers.Authorization !== `Bearer ${token}`) return reply(401, { message: 'Bad credentials' });
    const body = opt.body ? JSON.parse(opt.body) : null;
    if (u.pathname === '/graphql') {
      // deleteIssue: only a token with admin rights ('admin') may.
      if (token !== 'admin' && opt.headers.Authorization !== 'Bearer admin') return reply(200, { errors: [{ message: 'Divine4k does not have the correct permissions to execute `DeleteIssue`' }] });
      const at = issues.findIndex((x) => x.node_id === body.variables.id);
      if (at < 0) return reply(200, { errors: [{ message: 'Could not resolve to a node' }] });
      const [gone] = issues.splice(at, 1);
      parentOf.delete(gone.number);
      for (const [k, v] of [...parentOf]) if (v === gone.number) parentOf.delete(k);
      return reply(200, { data: { deleteIssue: { clientMutationId: null } } });
    }
    const sub = /^\/repos\/Divine4k\/poeapp\/issues\/(\d+)\/(parent|sub_issues|sub_issue)$/.exec(u.pathname);
    if (sub) {
      const n = Number(sub[1]);
      const byId = (id) => issues.find((x) => x.id === id);
      if (sub[2] === 'parent') return parentOf.has(n) ? reply(200, show(issues.find((x) => x.number === parentOf.get(n)))) : reply(404, { message: 'Not Found' });
      if (sub[2] === 'sub_issues' && opt.method === 'GET') return reply(200, issues.filter((x) => parentOf.get(x.number) === n).map(show));
      const child = byId(body.sub_issue_id);
      if (!child) return reply(422, { message: 'No such sub-issue' });
      if (sub[2] === 'sub_issues') {
        if (parentOf.has(child.number) && !body.replace_parent) return reply(422, { message: 'Already has a parent' });
        parentOf.set(child.number, n);
      } else parentOf.delete(child.number);
      return reply(200, show(issues.find((x) => x.number === n)));
    }
    const m = /^\/repos\/Divine4k\/poeapp\/issues(?:\/(\d+))?$/.exec(u.pathname);
    if (!m) return reply(404, { message: 'Not Found' });
    const at = new Date(1700000000000 + calls.length * 1000).toISOString();
    if (!m[1] && opt.method === 'GET') {
      const state = u.searchParams.get('state');
      return reply(200, issues.filter((i) => i.state === state).map(show));
    }
    if (!m[1] && opt.method === 'POST') {
      const num = Math.max(0, ...issues.map((x) => x.number)) + 1;
      const i = { number: num, id: 9000 + num, node_id: `I_${num}`, title: body.title, body: body.body, state: 'open', state_reason: null, labels: body.labels.map((name) => ({ name })), user: { login: 'Divine4k' }, html_url: `https://github.com/Divine4k/poeapp/issues/${num}`, created_at: at, updated_at: at, closed_at: null };
      issues.push(i);
      return reply(201, show(i));
    }
    const i = issues.find((x) => x.number === Number(m[1]));
    if (!i) return reply(404, { message: 'Not Found' });
    if (opt.method === 'GET') return reply(200, show(i));
    if (body.labels) i.labels = body.labels.map((name) => ({ name }));
    for (const k of ['title', 'body', 'state', 'state_reason']) if (body[k] !== undefined) i[k] = body[k];
    i.closed_at = i.state === 'closed' ? at : null;
    i.updated_at = at;
    return reply(200, show(i));
  };
  return { fetch, issues, calls, parentOf };
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

test('items hang together as GitHub sub-issues, read back either way GitHub answers', async () => {
  for (const withParent of [true, false]) {
    const gh = fakeGithub('good', { withParent });
    const base = { fetchImpl: gh.fetch, token: 'good', repo: 'Divine4k/poeapp' };
    await addItem({ ...base, title: 'Stash tab pricing' });
    await addItem({ ...base, title: 'Read the items' });
    const c = await addItem({ ...base, title: 'Show the total', parent: 1 });
    assert.strictEqual(c.parent, 1);
    assert.strictEqual((await setParent({ ...base, number: 2, parent: 1 })).parent, 1);
    assert.strictEqual((await setParent({ ...base, number: 2, parent: 3 })).parent, 3); // moved under another
    const byNumber = (list) => Object.fromEntries(list.map((i) => [i.number, i.parent]));
    assert.deepStrictEqual(byNumber(await listItems(base)), { 1: null, 2: 3, 3: 1 });
    assert.strictEqual((await setParent({ ...base, number: 2, parent: null })).parent, null);
    assert.strictEqual((await setParent({ ...base, number: 1, parent: null })).parent, null); // had none: nothing to undo
    assert.deepStrictEqual(byNumber(await listItems(base)), { 1: null, 2: null, 3: 1 });
    // An edit keeps the link the page knew when GitHub does not say.
    const edited = await updateItem({ ...base, number: 3, patch: { title: 'Show the total value' } });
    assert.strictEqual(edited.parent, withParent ? 1 : undefined);
    await assert.rejects(setParent({ ...base, number: 2, parent: 2 }), /part of itself/);
  }
});

test('every status reads back from GitHub as it was set', async () => {
  assert.strictEqual(statusOf({ state: 'closed', state_reason: 'not_planned', labels: [] }), 'dropped');
  assert.strictEqual(statusOf({ state: 'closed', state_reason: 'completed', labels: [] }), 'done');
  assert.strictEqual(statusOf({ state: 'open', labels: ['considering', 'idea'] }), 'considering');
  assert.strictEqual(statusOf({ state: 'open', labels: ['blocked', 'on hold'] }), 'blocked');
  const gh = fakeGithub();
  const base = { fetchImpl: gh.fetch, token: 'good', repo: 'Divine4k/poeapp' };
  const a = await addItem({ ...base, title: 'Loot filter', status: 'considering', priority: 'high' });
  assert.strictEqual(a.status, 'considering');
  for (const st of ['idea', 'todo', 'doing', 'testing', 'hold', 'blocked', 'dropped', 'done', 'dropped', 'considering']) {
    const it = await updateItem({ ...base, number: a.number, patch: { status: st } });
    assert.strictEqual(it.status, st, st);
    assert.strictEqual(it.priority, 'high'); // the priority label stays
  }
  assert.deepStrictEqual(gh.issues[0].labels.map((l) => l.name).sort(), ['considering', 'priority: high']);
  assert.strictEqual(gh.issues[0].state, 'open');
  const d = await addItem({ ...base, title: 'Old idea', status: 'dropped' });
  assert.strictEqual(d.status, 'dropped');
  assert.strictEqual(gh.issues[1].state_reason, 'not_planned');
});

test('deleting needs admin rights, and then the item is gone', async () => {
  const gh = fakeGithub('admin');
  const base = { fetchImpl: gh.fetch, token: 'admin', repo: 'Divine4k/poeapp' };
  await addItem({ ...base, title: 'Parent' });
  await addItem({ ...base, title: 'Child', parent: 1 });
  await deleteItem({ ...base, number: 1 });
  assert.deepStrictEqual((await listItems(base)).map((i) => [i.number, i.parent]), [[2, null]]);
  // Without admin rights GitHub refuses, and the message says what to do.
  const plain = fakeGithub();
  const b2 = { fetchImpl: plain.fetch, token: 'good', repo: 'Divine4k/poeapp' };
  await addItem({ ...b2, title: 'Keep me' });
  await assert.rejects(deleteItem({ ...b2, number: 1 }), /Administration: Read and write.*Dropped/);
  assert.strictEqual(plain.issues.length, 1);
  await assert.rejects(deleteItem({ ...b2, number: 9 }), /does not know|Not Found/);
});
