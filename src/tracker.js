'use strict';
// The Tracker page's list: ideas, things to make, work in progress and what is done, kept as
// GitHub issues in one repository (config.trackerRepo). Keeping them there means Claude can read
// and close the same list while working on the app ("Closes #12" in a commit moves it to Done).
//
// Where an item stands is told by GitHub itself:
//   closed issue                -> Done
//   open, label "in progress"   -> In progress
//   open, label "idea"          -> Ideas
//   open, neither               -> To do
// Priority is a label too: "priority: high" or "priority: low" (none = normal).
// Plain Node: the caller hands in how to reach the web, so this is tested against a stand-in
// for GitHub (test/tracker.test.js).

const { progress } = require('./ui/steps');

const API = 'https://api.github.com';
const STATUSES = ['idea', 'todo', 'doing', 'done'];
const STATUS_LABEL = { idea: 'idea', doing: 'in progress' };
const PRIORITY_LABEL = { high: 'priority: high', low: 'priority: low' };
const MANAGED = new Set([...Object.values(STATUS_LABEL), ...Object.values(PRIORITY_LABEL)]);
const DONE_KEPT = 40; // closed items shown in Done; older ones stay on GitHub

async function call(fetchImpl, token, method, route, body) {
  const res = await fetchImpl(`${API}${route}`, {
    method,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'poeapp', 'Cache-Control': 'no-cache', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* an answer without a body */ }
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

const names = (issue) => (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);

function statusOf(issue) {
  if (issue.state === 'closed') return 'done';
  const l = names(issue);
  if (l.includes(STATUS_LABEL.doing)) return 'doing';
  if (l.includes(STATUS_LABEL.idea)) return 'idea';
  return 'todo';
}
function priorityOf(issue) {
  const l = names(issue);
  return l.includes(PRIORITY_LABEL.high) ? 'high' : l.includes(PRIORITY_LABEL.low) ? 'low' : 'normal';
}

// What the page needs of one issue.
function toItem(issue) {
  return {
    number: issue.number, title: issue.title || '', body: issue.body || '',
    status: statusOf(issue), priority: priorityOf(issue),
    dropped: issue.state === 'closed' && issue.state_reason === 'not_planned',
    labels: names(issue).filter((n) => !MANAGED.has(n)),
    progress: progress(issue.body),
    url: issue.html_url || '', by: issue.user ? issue.user.login : '',
    created: Date.parse(issue.created_at) || 0, updated: Date.parse(issue.updated_at) || 0, closed: Date.parse(issue.closed_at) || 0,
  };
}

// The labels an issue gets: its own other labels kept, the status and priority ones replaced.
function labelsFor(labels, status, priority) {
  const out = (labels || []).filter((n) => !MANAGED.has(n));
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
  return [...open, ...closed.slice(0, DONE_KEPT)].map(toItem);
}

async function addItem({ fetchImpl, token, repo, title, body = '', status = 'idea', priority = 'normal' }) {
  checkRepo(repo);
  title = String(title || '').trim();
  if (!title) throw new Error('Give it a title first.');
  if (!STATUSES.includes(status)) status = 'idea';
  let issue = await call(fetchImpl, token, 'POST', `/repos/${repo}/issues`, { title, body: String(body || ''), labels: labelsFor([], status, priority) });
  if (status === 'done') issue = await call(fetchImpl, token, 'PATCH', `/repos/${repo}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
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
  const body = { labels: labelsFor(names(now), status, priority) };
  if (patch.title !== undefined) { const t = String(patch.title).trim(); if (!t) throw new Error('The title cannot be empty.'); body.title = t; }
  if (patch.body !== undefined) body.body = String(patch.body);
  if (status === 'done' && now.state !== 'closed') Object.assign(body, { state: 'closed', state_reason: 'completed' });
  if (status !== 'done' && now.state === 'closed') Object.assign(body, { state: 'open', state_reason: 'reopened' });
  return toItem(await call(fetchImpl, token, 'PATCH', `/repos/${repo}/issues/${n}`, body));
}

module.exports = { listItems, addItem, updateItem, toItem, statusOf, priorityOf, labelsFor, STATUSES, STATUS_LABEL, PRIORITY_LABEL };
