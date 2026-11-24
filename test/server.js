'use strict';
// The real server (server/worker.js) for tests: run in this process against a real SQL engine,
// with stand-ins for the two Cloudflare bindings, and the app's account client talking to it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Cloud } = require('../src/cloud');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (_) { /* older Node: tests that need the server are skipped */ }

function fakeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'server', 'schema.sql'), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { try { db.prepare(sql).run(...args); } catch (e) { throw new Error(`D1_ERROR: ${e.message}`); } return { success: true }; },
  });
  const files = new Map();
  let version = 0;
  return {
    db, files,
    DB: { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } },
    BUCKET: {
      put: async (key, value) => { files.set(key, { text: typeof value === 'string' ? value : await new Response(value).text(), etag: `"v${++version}"` }); },
      get: async (key) => (files.has(key) ? { body: files.get(key).text, httpEtag: files.get(key).etag } : null),
      delete: async (keys) => { for (const k of [].concat(keys)) files.delete(k); },
      list: async ({ prefix }) => ({ objects: [...files.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    },
  };
}

// old: the text of the item list as it was before the server existed (null: there was none).
// Returns the server's storage, a way to reach it, and account(name): a logged-in client.
async function server({ old = null } = {}) {
  const worker = (await import('../server/worker.js')).default;
  const env = fakeEnv();
  // The server reads the old list from the web once; in tests that is this text.
  globalThis.fetch = async () => (old === null ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => JSON.parse(old) });
  const fetchImpl = (url, o = {}) => {
    const headers = { 'cf-connecting-ip': '10.0.0.1', ...(o.headers || {}) };
    if (o.body !== undefined) headers['content-length'] = String(Buffer.byteLength(o.body));
    return worker.fetch(new Request(url, { method: o.method, headers, body: o.body }), env);
  };
  const client = (saved = null) => {
    const box = { saved };
    const c = new Cloud({ url: 'https://server.test/', fetchImpl, saved, save: (s) => { box.saved = JSON.parse(JSON.stringify(s)); }, stretchImpl: quick });
    c.box = box;
    return c;
  };
  const account = async (name, { admin = false } = {}) => {
    const c = client();
    const error = await c.register(name, 'correct horse', 'correct horse');
    if (error) throw new Error(error);
    if (admin) env.db.prepare('UPDATE users SET admin = 1 WHERE name = ?').run(name);
    return c;
  };
  return { env, fetchImpl, client, account, itemsFile: () => (env.files.get('shared/items.json') || { text: '[]' }).text };
}
// Stands in for the slow password stretching.
const quick = async (name, password) => crypto.createHash('sha256').update(`${name.toLowerCase()}:${password}`).digest('hex');

module.exports = { server, quick, hasSql: !!DatabaseSync };
