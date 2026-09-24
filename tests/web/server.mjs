// A tiny static server for the pencil game's tests and dev tools (no dependencies).
//   /temporal-claude-agent/...  -> docs/          (so the page lives at /temporal-claude-agent/map/, as on GitHub Pages)
//   /dev/...                    -> tests/web/dev/ (harness pages that load the docs/map scripts)
//   /film-src/...               -> the film repo, read-only (FILM_SRC, default ~/code/temporal-film): the
//                                  film's own pages and acts, for frame comparisons and the a8/a9 perf loops
// Usage: node server.mjs [port]      (default 8765; PORT env also works)
//        import { startServer } from './server.mjs'; const srv = await startServer(0); srv.url
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
export const ROOTS = {
  '/temporal-claude-agent/': path.join(REPO, 'docs'),
  '/dev/': path.join(HERE, 'dev'),
  '/film-src/': process.env.FILM_SRC || path.join(os.homedir(), 'code', 'temporal-film'),
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };

function resolve(urlPath) {
  for (const [prefix, root] of Object.entries(ROOTS)) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = decodeURIComponent(urlPath.slice(prefix.length));
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) return null;   // no traversal
    return file;
  }
  return null;
}

export function startServer(port = +(process.env.PORT || 8765)) {
  const server = http.createServer((req, res) => {
    let file = resolve(new URL(req.url, 'http://x').pathname);
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file || !fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => {
    const p = server.address().port; ok({ server, port: p, url: `http://127.0.0.1:${p}`, close: () => new Promise(r => server.close(r)) });
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startServer(+(process.argv[2] || process.env.PORT || 8765));
  console.log(`serving ${s.url}/temporal-claude-agent/map/  (dev pages: ${s.url}/dev/)`);
}
