'use strict';
// The Tracker page's list: ideas, things to make, work in progress and what is done, kept as
// GitHub issues in one repository (config.trackerRepo). Keeping them there means Claude can read
// and close the same list while working on the app ("Closes #12" in a commit moves it to Done).
//
// Where an item stands is told by GitHub itself:
//   closed as completed          -> Done
//   closed as not planned        -> Dropped
//   open, with one of the labels -> idea: Idea, considering: Considering, in progress: In progress,
//                                   testing: Testing, on hold: On hold, blocked: Blocked
//   open, none of them           -> To do
// Priority is a label too: "priority: high" or "priority: low" (none = normal).
// The Tracker's tabs are labels as well: "tab: Jewels" puts an item on the Jewels tab. An item
// without one is on the tab of its parent (the page works that out), or on Main.
// How items hang together (the Tracker map's lines) is GitHub's own sub-issues: an item's parent
// is the issue it is a sub-issue of. The map's box positions are not kept here (config.trackerLayout).
// Plain Node: the caller hands in how to reach the web, so this is tested against a stand-in
// for GitHub (test/tracker.test.js).

const { progress } = require('./ui/steps');

const API = 'https://api.github.com';
const STATUSES = ['idea', 'considering', 'todo', 'doing', 'testing', 'hold', 'blocked', 'done', 'dropped'];
const STATUS_LABEL = { idea: 'idea', considering: 'considering', doing: 'in progress', testing: 'testing', hold: 'on hold', blocked: 'blocked' };
const CLOSED = { done: 'completed', dropped: 'not_planned' }; // the closed statuses and GitHub's reason for each
// When an open issue carries more than one status label, the one furthest along wins.
const LABEL_ORDER = ['doing', 'testing', 'blocked', 'hold', 'considering', 'idea'];
const PRIORITY_LABEL = { high: 'priority: high', low: 'priority: low' };
const MANAGED = new Set([...Object.values(STATUS_LABEL), ...Object.values(PRIORITY_LABEL)]);
const DONE_KEPT = 40; // closed items shown in Done; older ones stay on GitHub

async function call(fetchImpl, token, method, route, body, { missingOk = false } = {}) {
  const res = await fetchImpl(`${API}${route}`, {
    method,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'poeapp', 'Cache-Control': 'no-cache', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* an answer without a body */ }
  if (missingOk && (res.status === 404 || res.status === 410)) return null; // 410: the issue was deleted
  if (!res.ok) throw new Error(explain(res.status, data, route.split('/').slice(2, 4).join('/')));
  return data;
}

function explain(status, data, repo) {
  const msg = data && data.message ? ` (${data.message})` : '';
  if (status === 401) return `GitHub did not accept the token${msg}. An admin can save a new one in Settings, Developer tools.`;
  if (status === 403) return `The token may not change issues in ${repo}${msg}. It needs "Issues: read and write" on that repository.`;
  if (status === 404) return `GitHub does not know the repository ${repo}, or the token cannot see it${msg}.`;
  if (status === 410) return `Issues are switched off for ${repo}. Turn them on in the repository's settings on GitHub.`;
  return `GitHub answered ${status}${msg}.`;
}

const numberIn = (url) => { const m = /\/issues\/(\d+)$/.exec(String(url || '')); return m ? Number(m[1]) : null; };
const TAB = 'tab: ';
const tabOf = (labels) => { const t = labels.find((n) => n.startsWith(TAB)); return t ? t.slice(TAB.length) : ''; };
// A tab name as given, tidied: no line breaks or commas (GitHub labels), at most 40 characters.
const cleanTab = (name) => String(name || '').replace(/[\r\n,]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
const names = (issue) => (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);

function statusOf(issue) {
  if (issue.state === 'closed') return issue.state_reason === 'not_planned' ? 'dropped' : 'done';
  const l = names(issue);
  return LABEL_ORDER.find((st) => l.includes(STATUS_LABEL[st])) || 'todo';
}
function priorityOf(issue) {
  const l = names(issue);
  return l.includes(PRIORITY_LABEL.high) ? 'high' : l.includes(PRIORITY_LABEL.low) ? 'low' : 'normal';
}

// What the page needs of one issue.
function toItem(issue) {
  return {
    number: issue.number, id: issue.id, title: issue.title || '', body: issue.body || '',
    // undefined: GitHub did not say (then the page keeps what it knew)
    parent: 'parent_issue_url' in issue ? numberIn(issue.parent_issue_url) : undefined,
    status: statusOf(issue), priority: priorityOf(issue),
    dropped: issue.state === 'closed' && issue.state_reason === 'not_planned',
    labels: names(issue).filter((n) => !MANAGED.has(n) && !n.startsWith(TAB)),
    tab: tabOf(names(issue)), // its own tab ('': none of its own)
    notes: issue.comments || 0, // notes added over time (the issue's comments)
    progress: progress(issue.body),
    // Troubleshooting recordings connected to it: lines with a link to recordings/<id>.
    recordings: recordingsIn(issue.body),
    url: issue.html_url || '', by: issue.user ? issue.user.login : '',
    created: Date.parse(issue.created_at) || 0, updated: Date.parse(issue.updated_at) || 0, closed: Date.parse(issue.closed_at) || 0,
  };
}

const RECORDING = /recordings\/([0-9]{8}-[0-9]{6}-[A-Za-z0-9_-]{1,20})/g;
function recordingsIn(body) {
  const out = [];
  for (const m of String(body || '').matchAll(RECORDING)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
// The line a connected recording gets in an item's text.
const recordingLine = (rec) => `- ${rec.type === 'suggestion' ? 'Suggestion' : 'Recording'} from ${rec.by || 'someone'}: [${rec.title || rec.id}](${rec.url})`;

// Connects a troubleshooting recording to an item: a line in its text, kept below the notes
// (GitHub shows it as a link). Nothing changes when it is there already.
async function addRecording({ fetchImpl, token, repo, number, rec }) {
  checkRepo(repo);
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw new Error('Unknown item.');
  const now = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${n}`);
  if (recordingsIn(now.body).includes(rec.id)) return toItem(now);
  const body = `${String(now.body || '').replace(/\s+$/, '')}${now.body && now.body.trim() ? '\n\n' : ''}${recordingLine(rec)}\n`;
  return toItem(await call(fetchImpl, token, 'PATCH', `/repos/${repo}/issues/${n}`, { body }));
}

// Takes a connected recording's line out of an item's text again.
async function removeRecording({ fetchImpl, token, repo, number, id }) {
  checkRepo(repo);
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw new Error('Unknown item.');
  const now = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${n}`, null, { missingOk: true });
  if (!now) return { number: n, gone: true }; // the box was deleted: nothing left to take the line out of
  if (!recordingsIn(now.body).includes(id)) return toItem(now);
  const body = String(now.body || '').split('\n').filter((l) => !l.includes(`recordings/${id}`)).join('\n').replace(/\n{3,}/g, '\n\n');
  return toItem(await call(fetchImpl, token, 'PATCH', `/repos/${repo}/issues/${n}`, { body }));
}

// The labels an issue gets: its own other labels kept, the status and priority ones replaced.
// tab: undefined keeps the item's tab label as it is; '' or 'Main' takes it off.
function labelsFor(labels, status, priority, tab) {
  let out = (labels || []).filter((n) => !MANAGED.has(n));
  if (tab !== undefined) {
    out = out.filter((n) => !n.startsWith(TAB));
    const t = cleanTab(tab);
    if (t && t !== 'Main') out.push(TAB + t);
  }
  if (STATUS_LABEL[status]) out.push(STATUS_LABEL[status]);
  if (PRIORITY_LABEL[priority]) out.push(PRIORITY_LABEL[priority]);
  return out;
}

function checkRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo || ''))) throw new Error('No tracker repository is set. Set it in Settings, Developer tools.');
}

// Every open item, and the most recently closed ones.
async function listItems({ fetchImpl, token, repo }) {
  checkRepo(repo);
  const get = async (state, pages) => {
    const out = [];
    for (let page = 1; page <= pages; page++) {
      const batch = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues?state=${state}&per_page=100&page=${page}&sort=updated&direction=desc`);
      out.push(...(batch || []));
      if (!batch || batch.length < 100) break;
    }
    return out.filter((i) => !i.pull_request); // GitHub lists pull requests among issues
  };
  const [open, closed] = await Promise.all([get('open', 5), get('closed', 1)]);
  const raw = [...open, ...closed.slice(0, DONE_KEPT)];
  const items = raw.map(toItem);
  // Issues say who their parent is (parent_issue_url). Where GitHub leaves that out of the
  // list, the parents' own sub-issue lists are asked instead.
  if (!raw.some((i) => 'parent_issue_url' in i)) {
    const byNumber = new Map(items.map((i) => [i.number, i]));
    const parents = raw.filter((i) => i.sub_issues_summary && i.sub_issues_summary.total > 0).slice(0, 60);
    await Promise.all(parents.map(async (p) => {
      const subs = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${p.number}/sub_issues?per_page=100`, null, { missingOk: true });
      for (const s of subs || []) { const it = byNumber.get(s.number); if (it) it.parent = p.number; }
    }));
  }
  for (const i of items) if (i.parent === undefined) i.parent = null;
  return items;
}

// Makes item `number` part of `parent` (a sub-issue of it), or of nothing when parent is null.
async function setParent({ fetchImpl, token, repo, number, parent }) {
  checkRepo(repo);
  const n = Number(number), p = parent == null ? null : Number(parent);
  if (!Number.isInteger(n) || n < 1 || (p !== null && (!Number.isInteger(p) || p < 1))) throw new Error('Unknown item.');
  if (n === p) throw new Error('An item cannot be part of itself.');
  const issue = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${n}`);
  if (p === null) {
    const was = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${n}/parent`, null, { missingOk: true });
    if (was) await call(fetchImpl, token, 'DELETE', `/repos/${repo}/issues/${was.number}/sub_issue`, { sub_issue_id: issue.id });
  } else {
    await call(fetchImpl, token, 'POST', `/repos/${repo}/issues/${p}/sub_issues`, { sub_issue_id: issue.id, replace_parent: true });
  }
  return { ...toItem(issue), parent: p };
}

async function addItem({ fetchImpl, token, repo, title, body = '', status = 'idea', priority = 'normal', parent = null, tab }) {
  checkRepo(repo);
  title = String(title || '').trim();
  if (!title) throw new Error('Give it a title first.');
  if (!STATUSES.includes(status)) status = 'idea';
  let issue = await call(fetchImpl, token, 'POST', `/repos/${repo}/issues`, { title, body: String(body || ''), labels: labelsFor([], status, priority, tab || undefined) });
  if (CLOSED[status]) issue = await call(fetchImpl, token, 'PATCH', `/repos/${repo}/issues/${issue.number}`, { state: 'closed', state_reason: CLOSED[status] });
  if (parent != null) return setParent({ fetchImpl, token, repo, number: issue.number, parent });
  return toItem(issue);
}

// patch: any of { title, body, status, priority }. The labels are read fresh from GitHub first,
// so labels added there (or by Claude) are not lost.
async function updateItem({ fetchImpl, token, repo, number, patch }) {
  checkRepo(repo);
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw new Error('Unknown item.');
  const now = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${n}`);
  const status = STATUSES.includes(patch.status) ? patch.status : statusOf(now);
  const priority = ['high', 'normal', 'low'].includes(patch.priority) ? patch.priority : priorityOf(now);
  // Tags: the owner's own labels; given, they replace the ones there (status, priority and tab stay).
  let had = names(now);
  if (Array.isArray(patch.tags)) had = [...had.filter((n) => MANAGED.has(n) || n.startsWith(TAB)), ...cleanTags(patch.tags)];
  const body = { labels: labelsFor(had, status, priority, patch.tab) };
  if (patch.title !== undefined) { const t = String(patch.title).trim(); if (!t) throw new Error('The title cannot be empty.'); body.title = t; }
  if (patch.body !== undefined) body.body = String(patch.body);
  // Done and Dropped are GitHub's two ways of closing; every other status is an open issue.
  if (CLOSED[status] && (now.state !== 'closed' || now.state_reason !== CLOSED[status])) Object.assign(body, { state: 'closed', state_reason: CLOSED[status] });
  if (!CLOSED[status] && now.state === 'closed') Object.assign(body, { state: 'open', state_reason: 'reopened' });
  return toItem(await call(fetchImpl, token, 'PATCH', `/repos/${repo}/issues/${n}`, body));
}

// Deletes an issue for good. GitHub's REST API has no way to do it, only GraphQL, and only for
// someone with admin rights on the repository: a fine-grained token needs "Administration: read
// and write" there. Items under it lose their parent and hang straight under the app.
async function deleteItem({ fetchImpl, token, repo, number }) {
  checkRepo(repo);
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw new Error('Unknown item.');
  const issue = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${n}`);
  const res = await fetchImpl(`${API}/graphql`, {
    method: 'POST',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'poeapp', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify({ query: 'mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }', variables: { id: issue.node_id } }),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* an answer without a body */ }
  const problem = !res.ok ? (data && data.message) || `GitHub answered ${res.status}` : data && data.errors && data.errors.length ? data.errors.map((e) => e.message).join(' ') : '';
  if (problem) throw new Error(`GitHub would not delete #${n} (${problem}). Deleting needs admin rights: give the token "Administration: Read and write" on ${repo}, or set the item to Dropped instead.`);
  return { number: n, recordings: recordingsIn(issue.body) };
}

// A box's own tags, tidied: no tab or status names, no doubles, at most 10 of 30 characters.
function cleanTags(tags) {
  const out = [];
  for (const t of tags || []) {
    const n = String(t || '').replace(/[\r\n,]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (n && !MANAGED.has(n) && !n.startsWith(TAB) && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out.slice(0, 10);
}

// Notes over time: the issue's comments, oldest first.
async function listNotes({ fetchImpl, token, repo, number }) {
  checkRepo(repo);
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw new Error('Unknown item.');
  const list = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${n}/comments?per_page=100`);
  return (list || []).map((c) => ({ id: c.id, by: c.user ? c.user.login : '', at: Date.parse(c.created_at) || 0, text: c.body || '', url: c.html_url || '' }));
}
async function addNote({ fetchImpl, token, repo, number, text }) {
  checkRepo(repo);
  const n = Number(number), body = String(text || '').trim();
  if (!Number.isInteger(n) || n < 1) throw new Error('Unknown item.');
  if (!body) throw new Error('Write something first.');
  const c = await call(fetchImpl, token, 'POST', `/repos/${repo}/issues/${n}/comments`, { body: body.slice(0, 20000) });
  return { id: c.id, by: c.user ? c.user.login : '', at: Date.parse(c.created_at) || Date.now(), text: c.body || body, url: c.html_url || '' };
}

// Renames a tab: one change to its label, and every item with it follows. A tab nobody has a
// box on yet has no label; then there is nothing to do here.
async function renameTab({ fetchImpl, token, repo, from, to }) {
  checkRepo(repo);
  const a = cleanTab(from), b = cleanTab(to);
  if (!a || !b || a === 'Main' || b === 'Main') throw new Error('Give the tab a name (Main cannot be renamed).');
  await call(fetchImpl, token, 'PATCH', `/repos/${repo}/labels/${encodeURIComponent(TAB + a)}`, { new_name: TAB + b }, { missingOk: true });
  return { from: a, to: b };
}
// Removes a tab: its label goes, so its boxes are back on Main (nothing is deleted).
async function removeTab({ fetchImpl, token, repo, name }) {
  checkRepo(repo);
  const a = cleanTab(name);
  if (!a || a === 'Main') throw new Error('Main cannot be removed.');
  await call(fetchImpl, token, 'DELETE', `/repos/${repo}/labels/${encodeURIComponent(TAB + a)}`, null, { missingOk: true });
  return { name: a };
}

module.exports = { listNotes, addNote, cleanTags, renameTab, removeTab, cleanTab, listItems, addItem, updateItem, setParent, deleteItem, addRecording, removeRecording, recordingsIn, recordingLine, toItem, statusOf, priorityOf, labelsFor, STATUSES, STATUS_LABEL, PRIORITY_LABEL };
