'use strict';
// The Jewels page's side in the main process: the tree and jewel lists for the page, and the
// timeless jewel work, which runs in a worker (src/core/jewels/worker.js) so the window stays
// responsive. Radius and cluster jewels are quick and are worked out here.
const path = require('path');
const { Worker } = require('worker_threads');
const D = require('./core/jewels/data');
const T = require('./core/jewels/timeless');
const R = require('./core/jewels/radius');
const { Tables } = require('./core/jewels/tables');
const B = require('./core/jewels/build');
const G = require('./core/jewels/goals');
const { BASICS, GUIDE, verdict } = require('./core/jewels/guide');

const POE = 'https://www.pathofexile.com/character-window';

// How much of the tree around the socket is drawn: a bit more than the largest reach.
const VIEW = { timeless: 2050, small: 1150, medium: 1650, large: 2050, veryLarge: 2600, massive: 3050 };

class JewelService {
  // fetchImpl: the app's webFetch (Chromium's network, so proxies work); tables are downloaded here.
  constructor({ dir, fetchImpl, onProgress, onEvent } = {}) {
    this.dir = dir;
    this.onProgress = onProgress || (() => {});
    this.onEvent = onEvent || (() => {});
    this.data = null;
    this.worker = null;
    this.jobs = new Map();
    this.nextId = 1;
    this.fetch = fetchImpl || ((url) => fetch(url));
    this.tables = new Tables({ dir, fetchImpl, onProgress: (p) => this.onProgress(p) }); // downloads; the worker reads
  }

  load() { if (!this.data) this.data = D.load(); return this.data; }

  // Everything the page needs once: lists, the tree overview for picking a socket.
  info() {
    const d = this.load();
    const keystoneOf = (j, c) => d.timeless.nodes.find((n) => n.id === `${j.faction}_keystone_${c.id}`);
    const keystoneName = (j, c) => { const e = keystoneOf(j, c); return e ? e.name : ''; };
    const keystoneLines = (j, c) => { const e = keystoneOf(j, c); return e ? e.sd : []; };
    return {
      tree: d.version,
      basics: BASICS,
      timeless: T.JEWELS.map((j) => ({
        key: j.key, name: j.name, type: j.type, min: j.min, max: j.max, step: j.step || 1,
        conquerors: j.conquerors.filter((c) => !c.old).map((c) => ({ name: c.name, keystone: keystoneName(j, c), lines: keystoneLines(j, c) })),
        guide: GUIDE[j.key],
        downloaded: this.tables.isDownloaded(j.type),
      })),
      sockets: d.sockets,
      keystones: d.raw.tree.nodes.filter((n) => n.kind === 'keystone').map((n) => ({ id: n.id, name: n.name, x: n.x, y: n.y })).sort((a, b) => a.name.localeCompare(b.name)),
      radius: R.RADIUS_JEWELS,
      rings: Object.entries(R.RING_NAMES).map(([key, name]) => ({ key, name })),
      // With the notable names per enchant, so the page can say which enchants give a notable.
      cluster: R.clusterBases(d).map((b) => ({ ...b, skills: b.skills.map((s) => ({ ...s, notables: R.clusterNotables(d, b.base, s.key).notables.map((n) => n.name) })) })),
      overview: D.overview(d),
    };
  }

  startWorker() {
    if (this.worker) return this.worker;
    const w = new Worker(path.join(__dirname, 'core', 'jewels', 'worker.js'), { workerData: { dir: this.dir } });
    w.on('message', (m) => {
      const job = this.jobs.get(m.id);
      if (!job) return;
      this.jobs.delete(m.id);
      if (m.error) job.reject(new Error(m.error)); else job.resolve(m.result);
    });
    const fail = (err) => {
      for (const job of this.jobs.values()) job.reject(err);
      this.jobs.clear();
      this.worker = null;
    };
    w.on('error', (e) => { this.onEvent('worker-error', e.message); fail(e); });
    w.on('exit', (code) => { if (code) fail(new Error('The jewel calculator stopped. Try again.')); else this.worker = null; });
    this.worker = w;
    return w;
  }

  // Makes sure the jewel's table is on disk (one download at a time per jewel), then runs.
  async run(op, args) {
    const jewel = T.jewelByKey(args.jewel);
    if (!jewel) throw new Error('Unknown jewel');
    if (!this.tables.isDownloaded(jewel.type)) {
      if (!this.downloads) this.downloads = new Map();
      if (!this.downloads.has(jewel.type)) {
        const job = this.tables.download(jewel.type)
          .catch((e) => { throw new Error(`Could not download the ${jewel.name} data. ${e.message}`); })
          .finally(() => this.downloads.delete(jewel.type));
        this.downloads.set(jewel.type, job);
      }
      await this.downloads.get(jewel.type);
    }
    const w = this.startWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      w.postMessage({ id, op, args });
    });
  }

  // One timeless jewel in one socket, with the tree around it for drawing.
  async timeless(args) {
    const d = this.load();
    const r = await this.run('describe', args);
    const socket = d.byId.get(args.socket);
    return { ...r, center: { x: socket.x, y: socket.y }, radius: D.RADIUS.large, area: D.area(d, socket, VIEW.timeless) };
  }

  search(args) { return this.run('search', { ...args, limit: Math.min(Number(args.limit) || 60, 200) }); }

  searchable(key) { return T.searchable(this.load(), key); }

  radius(args) {
    const d = this.load();
    const r = R.reach(d, args);
    const view = r.jewel === 'thread' ? VIEW[args.ring] : VIEW[R.RADIUS_JEWELS.find((j) => j.key === r.jewel).radius];
    const gain = T.totals(R.radiusGain(r, args.taken || []));
    return { ...r, gain, area: D.area(d, r.center, view) };
  }

  // Goals for one jewel, each with the lines it searches for.
  goals(key) {
    const lines = T.searchable(this.load(), key);
    return G.goalsFor(lines).map((g) => ({ ...g, want: G.goalWant(lines, g.key) }));
  }

  rank(args) { return this.run('rank', args); }

  // The one-line verdict on a seed: how it ranks for what is wanted, and warnings for the build.
  // args: jewel, seed, conqueror, socket, want, goals (names), nodes (the build's passives, or none).
  async verdict(args) {
    const build = args.nodes && args.nodes.length ? { nodes: args.nodes } : null;
    const want = args.want || [];
    const [r, result] = await Promise.all([
      want.length ? this.run('rank', { jewel: args.jewel, want, socket: args.socket, seed: args.seed, smalls: build ? true : !!args.smalls, onlyNodes: build ? build.nodes : null }) : null,
      this.run('describe', { jewel: args.jewel, seed: args.seed, conqueror: args.conqueror, socket: args.socket }),
    ]);
    return verdict({ r, result, build, goals: args.goals || [], jewelKey: args.jewel });
  }

  // A build from a Path of Building code, or a pobb.in / pastebin link to one.
  async buildFromText(text) {
    const src = B.buildSource(text);
    if (src.error) throw new Error(src.error);
    let code = src.code;
    if (src.url) {
      const res = await this.fetch(src.url);
      if (!res.ok) throw new Error(`Could not open that link (${res.status}).`);
      code = (await res.text()).trim();
    }
    return this.withExtras(B.readPob(B.decodePob(code), this.load()));
  }

  // The characters of an account whose profile is public on pathofexile.com.
  async characters(account) {
    const name = String(account || '').trim();
    if (!name) throw new Error('Type your account name, as on pathofexile.com (with the #1234 if it has one).');
    const res = await this.fetch(`${POE}/get-characters?accountName=${encodeURIComponent(name)}&realm=pc`);
    if (res.status === 403) throw new Error('That account\'s characters are private. Make them public on pathofexile.com (My Account, Privacy Settings), or paste a Path of Building code instead.');
    if (res.status === 404) throw new Error('No account with that name. Use the name from pathofexile.com, with the #1234 if it has one.');
    if (!res.ok) throw new Error(`pathofexile.com did not answer (${res.status}). Try again in a minute.`);
    const list = await res.json();
    return (Array.isArray(list) ? list : []).map((c) => ({ name: c.name, league: c.league, level: c.level, class: c.class })).sort((a, b) => b.level - a.level);
  }

  async character(account, name) {
    const chars = await this.characters(account);
    const c = chars.find((x) => x.name === name);
    if (!c) throw new Error('That character was not found.');
    const res = await this.fetch(`${POE}/get-passive-skills?accountName=${encodeURIComponent(String(account).trim())}&character=${encodeURIComponent(name)}&realm=pc`);
    if (!res.ok) throw new Error(`Could not read that character's passives (${res.status}).`);
    return this.withExtras(B.readCharacter(await res.json(), c, this.load()));
  }

  // What the page shows with a build: what it cares about and how far each socket is.
  withExtras(build) {
    const d = this.load();
    return { ...build, interests: G.interests(d, build), distances: D.distances(d, new Set(build.nodes)) };
  }

  cluster(base, skill) { return R.clusterNotables(this.load(), base, skill); }

  stop() { if (this.worker) this.worker.terminate(); this.worker = null; }
}

module.exports = { JewelService };
