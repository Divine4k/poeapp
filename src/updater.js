'use strict';
// In-app updates straight from the GitHub repository this app lives in.
// "Latest" means the newest commit on the main branch, so an update shows up as soon as it is pushed.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readTarGz, planFiles } = require('./core/tar');

const REPO = 'Divine4k/poeapp';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${REPO}`;
const HEADERS = { 'User-Agent': 'poeapp-updater', Accept: 'application/vnd.github+json' };
// Folders fully owned by the app: files that no longer exist upstream are removed from these.
const OWNED = ['src', 'test'];

class Updater {
  constructor(appDir, fetchImpl) {
    this.appDir = appDir;
    this.fetch = fetchImpl || ((url, options) => fetch(url, options));
    this.versionFile = path.join(appDir, '.version');
    this.etag = null;
    this.latest = null; // { sha, message, date }
    this.current = this.readCurrent();
  }

  readCurrent() {
    try { return JSON.parse(fs.readFileSync(this.versionFile, 'utf8')); } catch (_) { return null; }
  }

  get available() { return !!this.latest && (!this.current || this.current.sha !== this.latest.sha); }

  // Asks GitHub for the newest commit. Unchanged answers (HTTP 304) do not count against
  // GitHub's hourly limit, so this can run every couple of minutes.
  async check() {
    const headers = { ...HEADERS };
    if (this.etag) headers['If-None-Match'] = this.etag;
    const res = await this.fetch(`${API}/commits/${BRANCH}`, { headers });
    if (res.status === 304) return this.latest;
    if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? 'GitHub is limiting requests right now. Try again in a few minutes.' : `GitHub answered ${res.status}`);
    const j = await res.json();
    this.etag = res.headers.get('etag');
    this.latest = { sha: j.sha, message: String((j.commit && j.commit.message) || '').split('\n')[0], date: j.commit && j.commit.committer && j.commit.committer.date };
    return this.latest;
  }

  // Downloads the given commit and replaces the app's files. Returns { depsChanged }.
  async apply(target = this.latest) {
    if (!target) throw new Error('Nothing to update to');
    const res = await this.fetch(`${API}/tarball/${target.sha}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const files = planFiles(readTarGz(Buffer.from(await res.arrayBuffer())));
    const has = (rel) => files.some((f) => f.rel === rel);
    if (!has('package.json') || !has('src/main.js')) throw new Error('The download does not look like this app. Nothing was changed.');

    const depsOf = (text) => { try { const p = JSON.parse(text); return JSON.stringify([p.dependencies, p.optionalDependencies, p.devDependencies]); } catch (_) { return ''; } };
    let before = '';
    try { before = depsOf(fs.readFileSync(path.join(this.appDir, 'package.json'), 'utf8')); } catch (_) { /* treat as changed */ }
    const after = depsOf(files.find((f) => f.rel === 'package.json').data.toString('utf8'));

    for (const f of files) {
      const dest = path.join(this.appDir, f.rel);
      if (!dest.startsWith(this.appDir + path.sep)) throw new Error(`Unsafe path in update: ${f.rel}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.data);
    }
    const keep = new Set(files.map((f) => f.rel));
    for (const dir of OWNED) this.prune(dir, keep);

    this.current = { sha: target.sha, message: target.message, date: target.date };
    fs.writeFileSync(this.versionFile, JSON.stringify(this.current));
    return { depsChanged: before !== after };
  }

  prune(relDir, keep) {
    const abs = path.join(this.appDir, relDir);
    let names;
    try { names = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) { return; }
    for (const d of names) {
      const rel = `${relDir}/${d.name}`;
      if (d.isDirectory()) this.prune(rel, keep);
      else if (!keep.has(rel)) { try { fs.unlinkSync(path.join(this.appDir, rel)); } catch (_) { /* leave it */ } }
    }
  }

  // Runs "npm install" in the app folder; needed only when the update changed the dependency list.
  installDeps() {
    return new Promise((resolve, reject) => {
      const child = spawn('npm install --no-audit --no-fund', { cwd: this.appDir, shell: true, stdio: 'ignore', windowsHide: true });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm install failed (code ${code}). Run start.bat once to finish the update.`))));
    });
  }
}

module.exports = { Updater, REPO };
