'use strict';
// The hidden window that holds the trade site's live search connections (main.js, section
// "live searches"). It shows a page of pathofexile.com in the signed-in session, so each
// connection goes out as the site's own page would make it, with the session's cookies, which
// stay inside Chromium. The main process says which connections to open and close; each one's
// news goes back as 'live-event'. Nothing is shown and nothing is given to the page itself.
const { ipcRenderer } = require('electron');

const socks = new Map();
const tell = (key, type, extra = {}) => ipcRenderer.send('live-event', { key, type, ...extra });
function close(key) {
  const ws = socks.get(key);
  if (!ws) return;
  socks.delete(key);
  try { ws.close(1000); } catch (_) { /* already gone */ }
}
ipcRenderer.on('live-open', (_e, { key, url }) => {
  close(key);
  let ws;
  try { ws = new WebSocket(url); } catch (e) { tell(key, 'error', { message: String((e && e.message) || e).slice(0, 200) }); return; }
  socks.set(key, ws);
  ws.onopen = () => tell(key, 'open');
  ws.onmessage = (m) => tell(key, 'message', { data: String(m.data).slice(0, 50000) });
  ws.onerror = () => tell(key, 'error', { message: 'connection error' });
  ws.onclose = (c) => { if (socks.get(key) === ws) socks.delete(key); tell(key, 'close', { code: c.code, reason: String(c.reason || '').slice(0, 200) }); };
});
ipcRenderer.on('live-close', (_e, { key }) => close(key));
ipcRenderer.on('live-close-all', () => { for (const key of [...socks.keys()]) close(key); });
