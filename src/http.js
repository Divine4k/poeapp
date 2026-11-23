'use strict';
// All web requests go through Chromium's network stack (the same one a browser uses), so the
// Windows proxy settings and certificate store are respected. Node's built-in fetch ignores
// both and fails with a bare "fetch failed" on some machines.
const { net } = require('electron');

async function webFetch(url, options = {}) {
  try {
    return await net.fetch(url, options);
  } catch (e) {
    const cause = e && e.cause ? (e.cause.code || e.cause.message) : '';
    let host = '';
    try { host = new URL(url).host; } catch (_) { /* keep empty */ }
    throw new Error(`Could not reach ${host || 'the server'}: ${e.message || e}${cause ? ` (${cause})` : ''}`);
  }
}

module.exports = { webFetch };
