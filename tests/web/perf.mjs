// Live rAF performance of the docs/map engine (stroke cache on): plays film windows in a rAF loop at
// 24 drawings/s (dev/film.html ?loop=), in real time, and reports fps, draw ms (JS) and the canvas count.
//   node perf.mjs [seconds=20] [--cpu] [--webkit]
// Loops: room = a3 4.72-13.887 (the room, agent drawn on, typing, printing); a8 = the whole of a8
// (slips, notebook with Temporal's logo, clock, stamp), a9 = the whole of a9 (room crash, glow, notes).
// a8 and a9 come from the film repo (read-only) through /film-src/, drawn by the docs/map engine.
// Chromium runs with GPU_ARGS (Metal ANGLE + GPU raster): headless Chromium's default is SwiftShader (software
// GL), where compositing alone costs ~69 ms a frame (15 fps) while the JS draw is under 1 ms. The §10.8 perf
// spec must launch Chromium with the same args (playwright.config.mjs exports them).
// WebKit accepts observe({type: 'longtask'}) but never reports entries, so '0 long tasks' there means nothing:
// the jank measure that works in both is the rAF gap (p95 and max, from an independent rAF loop).
import { chromium, webkit } from '@playwright/test';
import { startServer } from './server.mjs';
import { GPU_ARGS } from './playwright.config.mjs';

const secs = +(process.argv.find(a => /^\d+(\.\d+)?$/.test(a)) || 20), cpu = process.argv.includes('--cpu'), wk = process.argv.includes('--webkit');
const LOOPS = [['room', 'loop=a3:4.72:13.887'], ['a8', 'more=a4,a5,a6,a7,a8&loop=a8:0:15.054'], ['a9', 'more=a4,a5,a6,a7,a8,a9&loop=a9:0:18.869']];
const srv = await startServer(0);
const browser = await (wk ? webkit : chromium).launch(wk ? {} : { args: GPU_ARGS });
for (const [name, qs] of LOOPS) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }), errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => {
    window.__canvases = 0; const ce = Document.prototype.createElement;
    Document.prototype.createElement = function (t, ...a) { if (String(t).toLowerCase() === 'canvas') window.__canvases++; return ce.call(this, t, ...a); };
    window.__gaps = []; let last = null; const tick = t => { if (last !== null) window.__gaps.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    window.__long = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* no longtask API */ }
  });
  await page.goto(`${srv.url}/dev/film.html?${qs}${cpu ? '&raster=cpu' : ''}`);
  await page.waitForFunction('window.__dev && window.__dev.ready || window.__devError', null, { timeout: 120000 });
  // warm-up: one full pass so every drawing is compiled and cached (the game precompiles in idle time)
  const loopDur = +qs.split(':').at(-1) - +qs.split(':').at(-2);
  await page.waitForTimeout(Math.ceil(loopDur * 1000) + 500);
  const s0 = await page.evaluate(() => { window.__dev.times.length = 0; window.__f0 = window.__dev.frames; window.__t0 = performance.now(); window.__long0 = window.__long.length; window.__gaps.length = 0; return { canvases: window.__canvases, domCanvases: document.querySelectorAll('canvas').length }; });
  const samples = [];
  for (let t = 0; t < secs; t += 5) { await page.waitForTimeout(Math.min(5, secs - t) * 1000); samples.push(await page.evaluate(() => window.__canvases)); }
  const r = await page.evaluate(() => ({ perf: window.__dev.perf(), gaps: (() => { const a = window.__gaps.slice().sort((x, y) => x - y); return { n: a.length, p95: a[Math.floor(a.length * .95)] ?? 0, max: a.at(-1) ?? 0 }; })(), fps: (window.__dev.frames - window.__f0) / ((performance.now() - window.__t0) / 1000), long: window.__long.slice(window.__long0).map(x => +x[1].toFixed(1)), canvases: window.__canvases,
    gl: (() => { try { const g = document.createElement('canvas').getContext('webgl'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; } catch (e) { return 'n/a'; } })() }));
  const f = x => +x.toFixed(2);
  console.log(JSON.stringify({ loop: name, seconds: secs, raster: cpu ? 'cpu' : 'gpu', fps: f(r.fps), drawMs: { n: r.perf.n, mean: f(r.perf.mean), p50: f(r.perf.p50), p95: f(r.perf.p95), max: f(r.perf.max) },
    canvasesCreated: { afterWarmup: s0.canvases, every5s: samples }, domCanvases: s0.domCanvases, rafGapMs: { n: r.gaps.n, p95: f(r.gaps.p95), max: f(r.gaps.max) }, longTasksAfterWarmup: wk ? 'n/a (WebKit reports none; use rafGapMs)' : r.long, renderer: r.gl, errors: errs }));
  await page.close();
}
await browser.close(); await srv.close();
