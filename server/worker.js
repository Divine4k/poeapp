// The server Map Companion uploads to: accounts, finished sessions and inventory pictures.
// One file with no dependencies, so it can be pasted into the Cloudflare dashboard as it is.
//
// It needs two bindings (see server/README.md):
//   DB      a D1 database with server/schema.sql run on it (accounts and the list of sessions)
//   BUCKET  an R2 bucket (the sessions themselves and the pictures)
//
// Passwords never reach this server. The app stretches the password with scrypt on the PC and
// sends the result (64 hex characters); what is stored here is a salted hash of that.

const MAX_SESSION = 1024 * 1024;      // bytes of one session
const MAX_PICTURES = 8 * 1024 * 1024; // bytes of one map's pictures
const NAME = /^[A-Za-z0-9_-]{3,20}$/;
const KEY = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HOUR = 3600 * 1000;

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
  return env.DB.prepare('SELECT u.id, u.name FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?').bind(await sha256(m[1])).first();
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
  return json({ name, token: await newToken(env, id, now) }, 201);
}

async function login(request, env, now) {
  const body = await readJson(request, 2000);
  const name = body && String(body.name || '').trim();
  if (!body || !NAME.test(name) || !KEY.test(String(body.key || ''))) return fail(400, 'Give your name and password.');
  if (!(await allow(env, `login:${name.toLowerCase()}`, 10, HOUR / 4, now))) return fail(429, 'Too many wrong passwords for this name. Wait 15 minutes and try again.');
  const user = await env.DB.prepare('SELECT id, name, salt, pass FROM users WHERE name_key = ?').bind(name.toLowerCase()).first();
  // The same answer whether the name or the password is wrong, so names cannot be probed here.
  if (!user || !same(user.pass, await sha256(user.salt + body.key))) return fail(401, 'Wrong name or password.');
  await env.DB.prepare('DELETE FROM hits WHERE k = ?').bind(`login:${name.toLowerCase()}`).run();
  return json({ name: user.name, token: await newToken(env, user.id, now) });
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

const brief = (r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at, divine: r.divine, strategy: r.strategy, totals: JSON.parse(r.totals) });

async function handle(request, env, now) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const method = request.method;
  if (parts[0] !== 'v1') return parts.length ? fail(404, 'Not found.') : json({ ok: true, service: 'Map Companion' });
  const route = `${method} ${parts.slice(1).map((p, i) => (i % 2 ? ':' : p)).join('/')}`;

  if (route === 'POST register') return register(request, env, now);
  if (route === 'POST login') return login(request, env, now);

  const me = await whoIs(request, env);
  if (!me) return fail(401, 'Log in again.');
  const arg = (i) => decodeURIComponent(parts[i] || '');

  if (route === 'GET me') return json({ name: me.name });
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

  // Looking at what people uploaded. Anyone with an account can.
  if (route === 'GET users') {
    const rows = await env.DB.prepare(`SELECT u.name, COUNT(s.id) AS sessions, MAX(s.ended_at) AS last FROM users u LEFT JOIN sessions s ON s.user_id = u.id
      GROUP BY u.id ORDER BY last DESC LIMIT 500`).all();
    return json({ users: rows.results.map((r) => ({ name: r.name, sessions: r.sessions, last: r.last || 0 })) });
  }
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
