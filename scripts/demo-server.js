'use strict';
// Serves the main window in a normal browser with the preview data (src/ui/demo.js), and
// answers the Jewels page with the real calculators, so the page can be looked at without
// Electron:
//
//   node scripts/demo-server.js [port] [folder with downloaded jewel tables]
//
// then open http://localhost:8123/index.html. Prices on trade and pasting a jewel need the app.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JewelService } = require('../src/jewels');

const port = Number(process.argv[2]) || 8123;
const dir = process.argv[3] || path.join(os.tmpdir(), 'poeapp-jewels');
const root = path.join(__dirname, '..', 'src', 'ui');
const svc = new JewelService({ dir, fetchImpl: (url) => fetch(url) });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

async function answer(a) {
  switch (a.op) {
    case 'info': return svc.info();
    case 'timeless': return svc.timeless(a);
    case 'searchable': return svc.searchable(a.jewel);
    case 'search': return svc.search(a);
    case 'radius': return svc.radius(a);
    case 'cluster': return svc.cluster(a.base, a.skill);
    case 'paste': return null;
    default: throw new Error('Only in the app.');
  }
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__jewels') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let out;
      try { out = { result: await answer(JSON.parse(body || '{}')) }; } catch (e) { out = { error: e.message }; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}/index.html (jewel tables in ${dir})`));
