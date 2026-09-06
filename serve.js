const http = require('http'), fs = require('fs'), p = require('path');
const root = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.css': 'text/css', '.json': 'application/json' };

http.createServer((req, res) => {
  let f = decodeURIComponent(req.url.split('?')[0]);
  if (f === '/') f = '/porkguy.html';
  const full = p.join(root, f);
  if (!full.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (e, b) => {
    if (e) { res.writeHead(404); return res.end('not found: ' + f); }
    res.writeHead(200, { 'Content-Type': MIME[p.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    res.end(b);
  });
}).listen(8123, () => console.log('http://localhost:8123'));
