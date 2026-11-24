'use strict';
// Puts a folder of files into a GitHub repository as one commit, through GitHub's own web API
// (the Git data calls: blobs, a tree, a commit, then the branch moves to it). Used to send
// troubleshooting recordings to the reports repository. Plain Node: the caller hands in how to
// reach the web, so this is tested against a stand-in for GitHub (test/recording.test.js).

const API = 'https://api.github.com';
const MAX_FILE = 95 * 1024 * 1024; // GitHub refuses single files from 100 MB

async function call(fetchImpl, token, method, route, body) {
  const res = await fetchImpl(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'poeapp', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* an answer without a body */ }
  return { ok: res.ok, status: res.status, data };
}

// What to tell the person when GitHub said no.
function explain(r, repo) {
  const msg = r.data && r.data.message ? ` (${r.data.message})` : '';
  if (r.status === 401) return `GitHub did not accept the token${msg}. An admin can save a new one in Settings, Developer tools.`;
  if (r.status === 403) return `The token may not write to ${repo}${msg}. It needs "Contents: read and write" on that repository.`;
  if (r.status === 404) return `GitHub does not know the repository ${repo}, or the token cannot see it${msg}.`;
  return `GitHub answered ${r.status}${msg}.`;
}

// files: [{ path, data: Buffer }] put under folder/. Returns { commit, url } or throws with a
// message meant for the person. onStep(text): what is happening, for a progress line.
async function uploadFolder({ fetchImpl, token, repo, branch = 'main', folder, files, message, onStep = () => {} }) {
  if (!token) throw new Error('No GitHub token is saved. An admin sets it in Settings, Developer tools.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo || ''))) throw new Error('No reports repository is set. An admin sets it in Settings, Developer tools.');
  for (const f of files) if (f.data.length > MAX_FILE) throw new Error(`${f.path} is ${(f.data.length / 1048576).toFixed(0)} MB, more than GitHub takes in one file. Make a shorter recording.`);
  const get = (method, route, body) => call(fetchImpl, token, method, `/repos/${repo}${route}`, body);

  // A repository without any commit yet has no branch to build on: it gets a first file.
  let ref = await get('GET', `/git/ref/heads/${branch}`);
  if (ref.status === 404 || ref.status === 409) {
    const first = await get('PUT', '/contents/README.md', { message: 'Start the reports repository', content: Buffer.from('# Map Companion troubleshooting recordings\n\nSent from the app\'s Troubleshooting page, one folder per recording.\n').toString('base64'), branch });
    if (!first.ok) throw new Error(explain(first, repo));
    ref = await get('GET', `/git/ref/heads/${branch}`);
  }
  if (!ref.ok) throw new Error(explain(ref, repo));

  const tree = [];
  let n = 0;
  for (const f of files) {
    onStep(`Sending ${f.path} (${++n} of ${files.length})`);
    const blob = await get('POST', '/git/blobs', { content: f.data.toString('base64'), encoding: 'base64' });
    if (!blob.ok) throw new Error(explain(blob, repo));
    tree.push({ path: folder ? `${folder}/${f.path}` : f.path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }
  onStep('Making the commit');
  // Someone else may send at the same moment: then the branch moved, and this tries once more on top of it.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) { ref = await get('GET', `/git/ref/heads/${branch}`); if (!ref.ok) throw new Error(explain(ref, repo)); }
    const parent = ref.data.object.sha;
    const base = await get('GET', `/git/commits/${parent}`);
    if (!base.ok) throw new Error(explain(base, repo));
    const t = await get('POST', '/git/trees', { base_tree: base.data.tree.sha, tree });
    if (!t.ok) throw new Error(explain(t, repo));
    const c = await get('POST', '/git/commits', { message, tree: t.data.sha, parents: [parent] });
    if (!c.ok) throw new Error(explain(c, repo));
    const moved = await get('PATCH', `/git/refs/heads/${branch}`, { sha: c.data.sha, force: false });
    if (moved.ok) return { commit: c.data.sha, url: `https://github.com/${repo}/tree/${branch}${folder ? `/${folder}` : ''}` };
    if (moved.status !== 422) throw new Error(explain(moved, repo));
  }
  throw new Error('GitHub kept changing while sending. Try again in a moment.');
}

// Reading back what was sent, for the admins' list of everyone's recordings.
// The names in a folder: [{ name, type: 'dir' | 'file' }]. A folder not there yet gives [].
async function listFolder({ fetchImpl, token, repo, path, branch = 'main' }) {
  const r = await call(fetchImpl, token, 'GET', `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(explain(r, repo));
  return Array.isArray(r.data) ? r.data.map((e) => ({ name: e.name, type: e.type })) : [];
}
// One file as it is (a video included, up to GitHub's 100 MB). null when it is not there.
async function readFile({ fetchImpl, token, repo, path, branch = 'main' }) {
  const res = await fetchImpl(`${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'poeapp' },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    throw new Error(explain({ status: res.status, data }, repo));
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { uploadFolder, listFolder, readFile, MAX_FILE };
