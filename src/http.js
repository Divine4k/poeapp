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
  try {
    const res = await net.fetch(url, options);
    done(`${what} -> ${res.status}`);
    if (res.status >= 400) diag.error(name, `${what} answered ${res.status}${res.status === 429 ? ' (too many requests: the site asks the app to slow down)' : ''}`);
    return res;
  } catch (e) {
    done(`${what} -> failed`);
    diag.error(name, `${what}: ${e.message || e}`);
    const cause = e && e.cause ? (e.cause.code || e.cause.message) : '';
    let host = '';
    try { host = new URL(url).host; } catch (_) { /* keep empty */ }
    throw new Error(`Could not reach ${host || 'the server'}: ${e.message || e}${cause ? ` (${cause})` : ''}`);
  }
}

module.exports = { webFetch };
