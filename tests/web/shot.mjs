// Screenshot tool for builders: look at your work.
//   node shot.mjs <url> <out.png> [--w 1920] [--h 1080] [--dpr 1] [--cpu] [--canvas] [--full] [--wait ms] [--webkit]
//   <url>     a path served by server.mjs ('/dev/room.html?state=...', '/temporal-claude-agent/map/?test=1')
//             (the server is started on a free port), or a full http(s)/file URL
//   --cpu     adds raster=cpu to the query (software canvas, exact pixels)
//   --canvas  saves the canvas' own backing pixels (toDataURL of #cv or the first canvas) instead of the page
//   --full    full-page screenshot
//   --wait    extra milliseconds after ready (default 0)
// Waits for window.__dev.ready or window.__game.ready. Prints console errors, page errors and any
// request outside the local server. Browsers must run outside the Bash sandbox.
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './server.mjs';

const args = process.argv.slice(2), flags = {}, pos = [];
for (let i = 0; i < args.length; i++) { const a = args[i]; if (a.startsWith('--')) { const k = a.slice(2); if (['cpu', 'canvas', 'full', 'webkit'].includes(k)) flags[k] = true; else flags[k] = args[++i]; } else pos.push(a); }
if (pos.length < 2) { console.error('usage: node shot.mjs <url> <out.png> [--w 1920] [--h 1080] [--dpr 1] [--cpu] [--canvas] [--full] [--wait ms] [--webkit]'); process.exit(2); }
let [url, out] = pos, srv = null;
if (url.startsWith('/')) { srv = await startServer(0); url = srv.url + url; }
if (flags.cpu) { const u = new URL(url); u.searchParams.set('raster', 'cpu'); url = u.href; }
const w = +(flags.w || 1920), h = +(flags.h || Math.round(w * 9 / 16)), dpr = +(flags.dpr || 1);
const browser = await (flags.webkit ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const base = url.startsWith('file:') ? url.slice(0, url.lastIndexOf('/') + 1) : new URL(url).origin, problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:')) problems.push('external request: ' + u); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => (window.__dev && window.__dev.ready) || (window.__game && window.__game.ready) || window.__devError, null, { timeout: 60000 });
const devErr = await page.evaluate(() => window.__devError || null); if (devErr) problems.push('dev: ' + devErr);
if (flags.wait) await page.waitForTimeout(+flags.wait);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
if (flags.canvas) {
  const b64 = await page.evaluate(() => { const c = document.getElementById('cv') || document.querySelector('canvas'); return c.toDataURL('image/png').split(',')[1]; });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
} else await page.screenshot({ path: out, fullPage: !!flags.full });
console.log(`${out}  (${Date.now() - t0} ms)${problems.length ? '\n' + problems.join('\n') : ''}`);
await browser.close(); if (srv) await srv.close();
process.exit(problems.length ? 1 : 0);
