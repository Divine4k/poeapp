// The server Map Companion uploads to: accounts, finished sessions and inventory pictures.
// One file with no dependencies, so it can be pasted into the Cloudflare dashboard as it is.
//
// It needs two bindings (see server/README.md):
//   DB      a D1 database with server/schema.sql run on it (accounts, the list of sessions, the item list)
//   BUCKET  an R2 bucket (the sessions themselves, the pictures, reports, and the item list as one file)
//
// Passwords never reach this server. The app stretches the password with scrypt on the PC and
// sends the result (64 hex characters); what is stored here is a salted hash of that.

const MAX_SESSION = 1024 * 1024;      // bytes of one session
const MAX_PICTURES = 8 * 1024 * 1024; // bytes of one map's pictures
const NAME = /^[A-Za-z0-9_-]{3,20}$/;
const KEY = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HOUR = 3600 * 1000;

// The item list everyone shares: pictures of items with their names. Kept as rows, and as one
// ready-made file that every copy of the app downloads.
const ITEMS_FILE = 'shared/items.json';
const MAX_ITEMS = 4000;      // entries in all
const MAX_PER_NAME = 3;      // pictures of one item
const MAX_AT_ONCE = 50;      // entries one request may add, rename or remove
const PRINT = /^[A-Za-z0-9+/=]{20,4000}$/;
const FILE_NAME = /^[A-Za-z0-9._-]{1,100}$/;
// Where the list lived before this server; read once, when the list here is still empty.
const OLD_ITEMS = 'https://raw.githubusercontent.com/Divine4k/poeappitemdata/main/items.json';

// Who may do what. Everyone with an account is a plain user. A moderator also gets the
// Troubleshooting page in the app, which records the game and sends the recording to the
// reports repository on GitHub. An admin can do that too, sees the Developer tools in
// Settings, gives and takes roles, and may change anyone's pictures in the item list.
const ROLES = ['', 'moderator', 'admin'];
const roleOf = (u) => (u.admin ? 'admin' : u.role === 'moderator' ? 'moderator' : '');
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const GH_TOKEN = /^[A-Za-z0-9_]{20,255}$/;
// Copying a token can bring along spaces, line breaks or invisible characters (zero-width
// spaces, a byte order mark). A token never holds any of those, so they are dropped.
const cleanToken = (t) => String(t || '').replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
// Why a pasted token was refused, without repeating it: its length and the first odd character.
function tokenProblem(t) {
  if (t.length < 20 || t.length > 255) return `It is ${t.length} characters long; a GitHub token has 40 to 100.`;
  const i = [...t].findIndex((c) => !/[A-Za-z0-9_]/.test(c));
  const c = [...t][i];
  return `Character ${i + 1} of ${t.length} is "${c}" (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}); a token only has letters, digits and _. Copy it again with GitHub's copy button.`;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, error) => json({ error }, status);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
// Compares two hex strings without stopping at the first difference.
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Counts an attempt under a key. Returns false once more than `max` were made in the window.
async function allow(env, key, max, windowMs, now) {
  const row = await env.DB.prepare('SELECT n, until FROM hits WHERE k = ?').bind(key).first();
  if (!row || row.until <= now) {
    await env.DB.prepare('INSERT INTO hits (k, n, until) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = 1, until = excluded.until').bind(key, now + windowMs).run();
    return true;
  }
  if (row.n >= max) return false;
  await env.DB.prepare('UPDATE hits SET n = n + 1 WHERE k = ?').bind(key).run();
  return true;
}

async function readJson(request, limit) {
  const text = await request.text();
  if (text.length > limit) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch (_) { return null; }
}

async function newToken(env, userId, now) {
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO tokens (hash, user_id, created_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, now).run();
  return token;
}

async function whoIs(request, env) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  const u = await env.DB.prepare('SELECT u.id, u.name, u.admin, u.role FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?').bind(await sha256(m[1])).first();
  if (!u) return null;
  const role = roleOf(u);
  return { id: u.id, name: u.name, role, admin: role === 'admin' };
}

// The role column came after the first accounts. A database made before it gets the column
// the first time this Worker runs, so nothing has to be run by hand. Admins stay marked by
// users.admin (as before); users.role only says moderator.
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  try {
    await env.DB.prepare("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT ''").run();
  } catch (e) {
    if (!/duplicate column/i.test(String(e && e.message))) throw e;
  }
  schemaReady = true;
}

async function register(request, env, now) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const body = await readJson(request, 2000);
  const name = body && String(body.name || '').trim();
  if (!body || !NAME.test(name)) return fail(400, 'A name is 3 to 20 characters: letters, numbers, - and _.');
  if (!KEY.test(String(body.key || ''))) return fail(400, 'The password did not arrive in the form this server expects. Update the app.');
  if (!(await allow(env, `reg:${ip}`, 5, 24 * HOUR, now))) return fail(429, 'Too many accounts were made from this connection today. Try again tomorrow.');
  const salt = randomHex(16);
  const id = randomHex(8);
  try {
    await env.DB.prepare('INSERT INTO users (id, name, name_key, salt, pass, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, name.toLowerCase(), salt, await sha256(salt + body.key), now).run();
  } catch (e) {
    if (/unique/i.test(String(e && e.message))) return fail(409, 'That name is taken. Pick another one.');
    throw e;
  }
  return json({ name, role: '', token: await newToken(env, id, now) }, 201);
}

async function login(request, env, now) {
  const body = await readJson(request, 2000);
  const name = body && String(body.name || '').trim();
  if (!body || !NAME.test(name) || !KEY.test(String(body.key || ''))) return fail(400, 'Give your name and password.');
  if (!(await allow(env, `login:${name.toLowerCase()}`, 10, HOUR / 4, now))) return fail(429, 'Too many wrong passwords for this name. Wait 15 minutes and try again.');
  const user = await env.DB.prepare('SELECT id, name, salt, pass, admin, role FROM users WHERE name_key = ?').bind(name.toLowerCase()).first();
  // The same answer whether the name or the password is wrong, so names cannot be probed here.
  if (!user || !same(user.pass, await sha256(user.salt + body.key))) return fail(401, 'Wrong name or password.');
  await env.DB.prepare('DELETE FROM hits WHERE k = ?').bind(`login:${name.toLowerCase()}`).run();
  return json({ name: user.name, role: roleOf(user), token: await newToken(env, user.id, now) });
}

const sessionKey = (userId, id) => `sessions/${userId}/${id}.json`;
const pictureKey = (userId, runId) => `pictures/${userId}/${runId}.json`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function putSession(request, env, me, id, now) {
  if (Number(request.headers.get('content-length') || 0) > MAX_SESSION) return fail(413, 'This session is too large to upload.');
  const text = await request.text();
  if (text.length > MAX_SESSION) return fail(413, 'This session is too large to upload.');
  let s = null;
  try { s = JSON.parse(text); } catch (_) { /* answered below */ }
  if (!s || typeof s !== 'object' || s.id !== id || !Array.isArray(s.runs) || !s.totals || typeof s.totals !== 'object') return fail(400, 'That is not a saved session.');
  const t = s.totals;
  const totals = { maps: num(t.maps), deaths: num(t.deaths), lootValue: num(t.lootValue), costValue: num(t.costValue), net: num(t.net), mapMs: num(t.mapMs) };
  const strategy = String((s.strategy && s.strategy.name) || '').slice(0, 40);
  await env.BUCKET.put(sessionKey(me.id, id), text, { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare(`INSERT INTO sessions (user_id, id, started_at, ended_at, divine, strategy, totals, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET started_at = excluded.started_at, ended_at = excluded.ended_at, divine = excluded.divine, strategy = excluded.strategy, totals = excluded.totals, updated_at = excluded.updated_at`)
    .bind(me.id, id, num(s.startedAt), num(s.endedAt), num(s.divine), strategy, JSON.stringify(totals), now).run();
  return json({ ok: true });
}

async function putPictures(request, env, me, runId) {
  const length = Number(request.headers.get('content-length') || 0);
  if (!length) return fail(411, 'The upload has to say how large it is.');
  if (length > MAX_PICTURES) return fail(413, 'These pictures are too large to upload.');
  // Not read here: the pictures go straight into storage.
  await env.BUCKET.put(pictureKey(me.id, runId), request.body, { httpMetadata: { contentType: 'application/json' } });
  return json({ ok: true });
}

async function removeAll(env, prefix) {
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor });
    if (page.objects.length) await env.BUCKET.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function stored(env, key) {
  const obj = await env.BUCKET.get(key);
  if (!obj) return fail(404, 'Nothing is saved under that.');
  return new Response(obj.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

// ---- the shared item list ---------------------------------------------------------
const itemId = async (print) => (await sha256(print)).slice(0, 32);
const itemJson = (e) => JSON.stringify({ id: e.id, name: e.name, print: e.print, by: e.by || undefined, auto: e.auto ? 1 : undefined, at: e.at });
const insertItem = (env, e) => env.DB.prepare('INSERT OR IGNORE INTO items (id, name, by_name, json, at) VALUES (?, ?, ?, ?, ?)').bind(e.id, e.name, e.by || '', itemJson(e), e.at);
const validItem = (r) => r && typeof r.name === 'string' && r.name.trim() && r.name.length <= 120 && typeof r.print === 'string' && PRINT.test(r.print);

// Writes the list as the one file the apps download. Each row holds its entry ready-made, so
// this is joining text, however long the list gets.
async function publishItems(env) {
  const rows = await env.DB.prepare('SELECT json FROM items ORDER BY at, id').all();
  const text = `[${rows.results.map((r) => r.json).join(',')}]`;
  await env.BUCKET.put(ITEMS_FILE, text, { httpMetadata: { contentType: 'application/json' } });
  return text;
}

// The first time, the list is taken over from where it used to live. Returns false when that
// could not be read, so it is tried again later instead of starting empty for good.
async function takeOverItems(env, now) {
  if (await env.DB.prepare("SELECT v FROM meta WHERE k = 'items'").first()) return true;
  let old;
  try {
    const res = await fetch(OLD_ITEMS);
    if (res.status === 404) old = [];
    else if (res.ok) old = await res.json();
  } catch (_) { /* answered below */ }
  if (!Array.isArray(old)) return false;
  const rows = [];
  for (const r of old.filter(validItem).slice(0, MAX_ITEMS)) {
    rows.push(insertItem(env, { id: await itemId(r.print), name: r.name, print: r.print, by: typeof r.by === 'string' ? r.by.slice(0, 40) : '', auto: !!r.auto, at: num(r.at) || now }));
  }
  rows.push(env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('items', ?)").bind(String(now)));
  await env.DB.batch(rows);
  return true;
}

// Anyone may read the list, logged in or not, as before.
async function getItems(request, env, now) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' };
  const file = await env.BUCKET.get(ITEMS_FILE);
  if (!file) {
    if (!(await takeOverItems(env, now))) return new Response('[]', { headers });
    return new Response(await publishItems(env), { headers });
  }
  // The network in between may mark the tag as weak (W/) on its way out.
  if ((request.headers.get('if-none-match') || '').replace(/^W\//, '') === file.httpEtag) return new Response(null, { status: 304, headers: { etag: file.httpEtag } });
  return new Response(file.body, { headers: { ...headers, etag: file.httpEtag } });
}

async function addItems(request, env, me, now) {
  const body = await readJson(request, 400 * 1024);
  const list = body && Array.isArray(body.add) ? body.add.filter(validItem) : null;
  if (!list || !list.length || list.length > MAX_AT_ONCE) return fail(400, `Send 1 to ${MAX_AT_ONCE} items at a time.`);
  if (!(await allow(env, `items:${me.id}`, 300, 24 * HOUR, now))) return fail(429, 'You have added a lot to the item list today. The rest is kept on this PC and can go up tomorrow.');
  if (!(await takeOverItems(env, now))) return fail(503, 'The item list is not ready yet. Try again in a moment.');
  const names = [...new Set(list.map((e) => e.name.trim()))];
  const counted = await env.DB.prepare(`SELECT name, COUNT(*) AS n FROM items WHERE name IN (${names.map(() => '?').join(',')}) GROUP BY name`).bind(...names).all();
  const have = new Map(counted.results.map((r) => [r.name, r.n]));
  const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first()).n;
  const rows = [];
  for (const e of list) {
    const name = e.name.trim(), n = have.get(name) || 0;
    // What an app learned by itself is only wanted for items the list has no picture of.
    if (n >= (e.auto ? 1 : MAX_PER_NAME) || before + rows.length >= MAX_ITEMS) continue;
    have.set(name, n + 1);
    rows.push(insertItem(env, { id: await itemId(e.print), name, print: e.print, by: me.name, auto: !!e.auto, at: now }));
  }
  if (!rows.length) return json({ added: 0 });
  await env.DB.batch(rows);
  const after = (await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first()).n;
  if (after !== before) await publishItems(env);
  return json({ added: after - before });
}

// Renaming or removing a picture for everyone: the person who added it may, and so may an
// owner of the list (users.admin). Answers how many were changed and how many were refused.
async function changeItems(request, env, me, now, what) {
  const body = await readJson(request, 20000);
  const ids = body && Array.isArray(body.ids) ? [...new Set(body.ids.filter((x) => typeof x === 'string' && /^[0-9a-f]{32}$/.test(x)))] : [];
  const name = what === 'rename' ? String((body && body.name) || '').trim() : '';
  if (!ids.length || ids.length > MAX_AT_ONCE || (what === 'rename' && (!name || name.length > 120))) return fail(400, 'That is not a change to the item list.');
  const found = await env.DB.prepare(`SELECT id, by_name, json FROM items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const mine = found.results.filter((r) => me.admin || r.by_name.toLowerCase() === me.name.toLowerCase());
  const refused = found.results.length - mine.length;
  if (mine.length) {
    await env.DB.batch(mine.map((r) => {
      if (what === 'remove') return env.DB.prepare('DELETE FROM items WHERE id = ?').bind(r.id);
      const e = JSON.parse(r.json);
      return env.DB.prepare('UPDATE items SET name = ?, by_name = ?, json = ? WHERE id = ?').bind(name, me.name, itemJson({ ...e, name, by: me.name, auto: false, at: now }), r.id);
    }));
    await publishItems(env);
  }
  return json({ changed: mine.length, refused });
}

async function putReport(request, env, me, name) {
  const length = Number(request.headers.get('content-length') || 0);
  if (!length) return fail(411, 'The upload has to say how large it is.');
  if (length > MAX_PICTURES) return fail(413, 'This report is too large to upload.');
  await env.BUCKET.put(`reports/${me.id}/${name}`, request.body);
  return json({ ok: true });
}

// ---- roles and the GitHub token (Developer tools in the app) ----------------------------
// The token lets the app put recordings into the reports repository. It is kept here so every
// admin and moderator can send without setting it up on their own PC; only an admin can change it.
async function githubSettings(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'github'").first();
  try { const v = row ? JSON.parse(row.v) : null; return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
}
async function putGithub(request, env, me, now) {
  const body = await readJson(request, 2000);
  if (!body) return fail(400, 'That is not a change to the GitHub settings.');
  const was = await githubSettings(env);
  const next = { ...was };
  if (body.repo !== undefined) {
    const repo = String(body.repo || '').trim();
    if (!REPO.test(repo)) return fail(400, 'Give the repository as owner/name, for example Divine4k/poeapp-reports.');
    next.repo = repo;
  }
  if (body.token !== undefined) {
    const token = cleanToken(body.token);
    if (token && !GH_TOKEN.test(token)) return fail(400, `That does not look like a GitHub token. ${tokenProblem(token)}`);
    next.token = token;
  }
  next.by = me.name; next.at = now;
  await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('github', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(next)).run();
  return json({ repo: next.repo || '', hasToken: !!next.token, by: next.by, at: next.at });
}
async function putRole(request, env, me, name) {
  const body = await readJson(request, 500);
  const role = body ? String(body.role == null ? '' : body.role) : null;
  if (role === null || !ROLES.includes(role)) return fail(400, 'A role is admin, moderator or nothing.');
  const user = await env.DB.prepare('SELECT id, name, admin, role FROM users WHERE name_key = ?').bind(name.toLowerCase()).first();
  if (!user) return fail(404, 'Nobody has that name.');
  // So an admin cannot lock themselves out by a slip of the mouse.
  if (user.id === me.id) return fail(400, 'You cannot change your own role. Ask another admin.');
  await env.DB.prepare('UPDATE users SET admin = ?, role = ? WHERE id = ?').bind(role === 'admin' ? 1 : 0, role === 'moderator' ? 'moderator' : '', user.id).run();
  return json({ name: user.name, role });
}

const brief = (r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at, divine: r.divine, strategy: r.strategy, totals: JSON.parse(r.totals) });

async function handle(request, env, now) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const method = request.method;
  if (parts[0] !== 'v1') return parts.length ? fail(404, 'Not found.') : json({ ok: true, service: 'Map Companion' });
  const route = `${method} ${parts.slice(1).map((p, i) => (i % 2 ? ':' : p)).join('/')}`;

  await ensureSchema(env);
  if (route === 'POST register') return register(request, env, now);
  if (route === 'POST login') return login(request, env, now);
  if (route === 'GET items') return getItems(request, env, now);

  const me = await whoIs(request, env);
  if (!me) return fail(401, 'Log in again.');
  const arg = (i) => decodeURIComponent(parts[i] || '');

  if (route === 'GET me') return json({ name: me.name, role: me.role });
  if (route === 'POST logout') {
    const token = (request.headers.get('authorization') || '').slice(7);
    await env.DB.prepare('DELETE FROM tokens WHERE hash = ?').bind(await sha256(token)).run();
    return json({ ok: true });
  }
  // Removes the account and everything uploaded under it. Asks for the password again.
  if (route === 'POST account/:' && arg(2) === 'delete') {
    const body = await readJson(request, 2000);
    const user = await env.DB.prepare('SELECT salt, pass FROM users WHERE id = ?').bind(me.id).first();
    if (!body || !KEY.test(String(body.key || '')) || !user || !same(user.pass, await sha256(user.salt + body.key))) return fail(401, 'Wrong password.');
    await removeAll(env, `sessions/${me.id}/`);
    await removeAll(env, `pictures/${me.id}/`);
    await removeAll(env, `reports/${me.id}/`);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id),
      env.DB.prepare('DELETE FROM tokens WHERE user_id = ?').bind(me.id),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me.id),
    ]);
    return json({ ok: true });
  }

  if (parts[1] === 'sessions' && parts.length === 3) {
    const id = arg(2);
    if (!ID.test(id)) return fail(400, 'That is not a session.');
    if (method === 'PUT') return putSession(request, env, me, id, now);
    if (method === 'DELETE') {
      await env.BUCKET.delete(sessionKey(me.id, id));
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?').bind(me.id, id).run();
      return json({ ok: true });
    }
  }
  if (parts[1] === 'pictures' && parts.length === 3) {
    const runId = arg(2);
    if (!ID.test(runId)) return fail(400, 'That is not a map.');
    if (method === 'PUT') return putPictures(request, env, me, runId);
    if (method === 'DELETE') { await env.BUCKET.delete(pictureKey(me.id, runId)); return json({ ok: true }); }
  }

  if (route === 'POST items') return addItems(request, env, me, now);
  if (route === 'POST items/:' && (arg(2) === 'rename' || arg(2) === 'remove')) return changeItems(request, env, me, now, arg(2));
  if (route === 'PUT reports/:') return FILE_NAME.test(arg(2)) ? putReport(request, env, me, arg(2)) : fail(400, 'That is not a report.');

  // Looking at what people uploaded. Anyone with an account can.
  // An admin also sees each account's role and when it was made, for the Developer tools.
  if (route === 'GET users') {
    const rows = await env.DB.prepare(`SELECT u.name, u.admin, u.role, u.created_at, COUNT(s.id) AS sessions, MAX(s.ended_at) AS last FROM users u LEFT JOIN sessions s ON s.user_id = u.id
      GROUP BY u.id ORDER BY last DESC, u.created_at DESC LIMIT 500`).all();
    return json({ users: rows.results.map((r) => ({ name: r.name, sessions: r.sessions, last: r.last || 0, ...(me.admin ? { role: roleOf(r), created: r.created_at } : {}) })) });
  }
  if (route === 'PUT users/:/role') return me.admin ? putRole(request, env, me, arg(2)) : fail(403, 'Only an admin can change roles.');
  if (route === 'GET dev/:' && arg(2) === 'github') {
    if (!me.role) return fail(403, 'Only admins and moderators can send recordings.');
    const g = await githubSettings(env);
    return json({ repo: g.repo || '', token: g.token || '', by: g.by || '', at: g.at || 0 });
  }
  if (route === 'PUT dev/:' && arg(2) === 'github') return me.admin ? putGithub(request, env, me, now) : fail(403, 'Only an admin can change this.');
  if (method === 'GET' && parts[1] === 'users' && parts.length >= 4) {
    const owner = await env.DB.prepare('SELECT id, name FROM users WHERE name_key = ?').bind(arg(2).toLowerCase()).first();
    if (!owner) return fail(404, 'Nobody has that name.');
    if (parts[3] === 'sessions' && parts.length === 4) {
      const rows = await env.DB.prepare('SELECT id, started_at, ended_at, divine, strategy, totals FROM sessions WHERE user_id = ? ORDER BY ended_at DESC LIMIT 500').bind(owner.id).all();
      return json({ name: owner.name, sessions: rows.results.map(brief) });
    }
    if (parts.length === 5 && ID.test(arg(4))) {
      if (parts[3] === 'sessions') return stored(env, sessionKey(owner.id, arg(4)));
      if (parts[3] === 'pictures') return stored(env, pictureKey(owner.id, arg(4)));
    }
  }
  return fail(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env, Date.now());
    } catch (e) {
      console.error(e && e.stack ? e.stack : e);
      return fail(500, 'The server ran into a problem. Try again in a moment.');
    }
  },
};
