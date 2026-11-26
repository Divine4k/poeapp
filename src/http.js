'use strict';
// All web requests go through Chromium's network stack (the same one a browser uses), so the
// Windows proxy settings and certificate store are respected. Node's built-in fetch ignores
// both and fails with a bare "fetch failed" on some machines.
const { net } = require('electron');
const { diag, webName } = require('./diagnose');

// Each request is timed for the Under the hood page: from asking until the answer begins.
async function webFetch(url, options = {}) {
  const { name, path } = webName(url);
  const done = diag.start(name);
  const what = `${(options && options.method) || 'GET'} ${path}`;
  // session: one of Electron's sessions to ask through (the trade site's signed-in one), so
  // its cookies go along. Without it, the app's plain network stack.
  const { session, ...init } = options || {};
  try {
    const res = await (session ? session.fetch(url, init) : net.fetch(url, init));
    // With the answer's size and, for the trade site, how close its limits are.
    const h = res.headers, size = Number(h.get('content-length')) || 0;
    const limit = h.get('x-rate-limit-ip-state') || h.get('x-rate-limit-account-state') || '';
    const retry = h.get('retry-after') || '';
    done(`${what} -> ${res.status}${size ? `, ${size >= 10240 ? `${Math.round(size / 1024)} KB` : `${size} bytes`}` : ''}${limit ? `, limits used ${limit}` : ''}${retry ? `, asked to wait ${retry} s` : ''}`, false, res.status >= 400);
    if (res.status >= 400) diag.error(name, `${what} answered ${res.status}${res.status === 429 ? ' (too many requests: the site asks the app to slow down)' : ''}`, false);
    return res;
  } catch (e) {
    done(`${what} -> failed: ${e.message || e}`, false, true);
    diag.error(name, `${what}: ${e.message || e}`, false);
    const cause = e && e.cause ? (e.cause.code || e.cause.message) : '';
    let host = '';
    try { host = new URL(url).host; } catch (_) { /* keep empty */ }
    throw new Error(`Could not reach ${host || 'the server'}: ${e.message || e}${cause ? ` (${cause})` : ''}`);
  }
}

module.exports = { webFetch };
