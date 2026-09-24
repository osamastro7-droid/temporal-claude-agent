// Exact frame comparison: the film's own page (film2.html ?bare=1&frame=N, CPU raster, read-only film repo)
// against the same frame drawn by the docs/map engine (dev/film.html ?frame=N&raster=cpu).
//   node film-compare.mjs [frame ...]      default: a1 tau 3.5 (84), a2 tau 3.52 (387), a3 tau 3.0 (667)
// Each frame is drawn by docs/map three ways: the film's canvas (alpha:true), the game's canvas (&alpha=0), and
// the game's film-window path (&alpha=0&via=shop: captions blanked, routed back through SHOP.film's hook).
// Writes out/compare-<frame>-{film,map,game}.png and out/compare-sheet.png; prints differing channels per frame.
// Exit code 1 if any frame differs. Browsers must run outside the Bash sandbox.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { startServer } from './server.mjs';

const frames = process.argv.slice(2).map(Number).filter(Number.isInteger);
const list = frames.length ? frames : [84, 387, 667];
const srv = await startServer(0), browser = await chromium.launch();
fs.mkdirSync('out', { recursive: true });
async function grab(url, ready, pick) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }), errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(url); await page.waitForFunction(ready, null, { timeout: 120000 });
  const r = await page.evaluate(pick); await page.close(); if (errs.length) console.log('  errors:', errs.join(' | '));
  return { raw: Buffer.from(r.raw, 'base64'), png: r.png, info: r.info };
}
const pick = `(() => { const c = PICK_CANVAS, x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data; let s = ''; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768));
  return { raw: btoa(s), png: c.toDataURL('image/png'), info: INFO }; })()`;
const rows = []; let bad = 0;
const VARIANTS = [['map', ''], ['alpha0', '&alpha=0'], ['game', '&alpha=0&via=shop']];
for (const f of list) {
  const film = await grab(`${srv.url}/film-src/film2.html?bare=1&frame=${f}`, 'window.__ready === true || !!window.__error',
    pick.replace('PICK_CANVAS', 'cv').replace('INFO', `{ size: [cv.width, cv.height] }`));
  for (const [variant, extra] of VARIANTS) {
    const map = await grab(`${srv.url}/dev/film.html?frame=${f}&raster=cpu${extra}`, 'window.__dev && window.__dev.ready || !!window.__devError',
      pick.replace('PICK_CANVAS', 'window.__dev.canvas').replace('INFO', `{ size: [window.__dev.canvas.width, window.__dev.canvas.height], at: window.__dev.tauOf(${f}) }`));
    let diff = 0, max = 0, px = 0, box = [1e9, 1e9, -1, -1];
    const n = Math.min(film.raw.length, map.raw.length), w = film.info.size[0];
    for (let i = 0; i < n; i += 4) { let d = 0; for (let k = 0; k < 4; k++) { const q = Math.abs(film.raw[i + k] - map.raw[i + k]); if (q) { diff++; d = Math.max(d, q); } }
      if (d) { px++; max = Math.max(max, d); const p = i / 4, x = p % w, y = (p - x) / w; box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]; } }
    if (film.raw.length !== map.raw.length) diff = -1;
    if (diff) bad++;
    if (variant === 'map') fs.writeFileSync(`out/compare-${f}-film.png`, Buffer.from(film.png.split(',')[1], 'base64'));
    fs.writeFileSync(`out/compare-${f}-${variant}.png`, Buffer.from(map.png.split(',')[1], 'base64'));
    const row = { frame: f, variant, act: map.info.at, size: map.info.size, differingChannels: diff, differingPixels: px, maxDelta: max, box: px ? box : null };
    rows.push({ ...row, film: film.png, map: map.png }); console.log(JSON.stringify(row));
  }
}
// side-by-side sheet for review by eye
const page = await browser.newPage({ viewport: { width: 1600, height: 460 * rows.length + 20 } });
const html = '<body style="margin:0;background:#222;color:#ddd;font:14px monospace">' + rows.map(r => `<div style="display:flex;gap:10px;padding:8px"><div><div>film2.html frame ${r.frame}</div><img src="${r.film}" width="760"></div><div><div>docs/map ${r.variant} ${r.act.act} tau ${r.act.tau.toFixed(4)}: ${r.differingChannels} differing channels</div><img src="${r.map}" width="760"></div></div>`).join('') + '</body>';
await page.setContent(html); await page.screenshot({ path: 'out/compare-sheet.png', fullPage: true });
await browser.close(); await srv.close();
process.exit(bad ? 1 : 0);
