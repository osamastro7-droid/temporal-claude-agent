// Performance (GAME_SPEC §10 browser spec 8, targets in §7): 20 s in real time over the heavy part (stages 7-8:
// printer, receipt, slips, the notebook with Temporal's logo; then a crash with the glow), live rAF on the GPU
// (the chromium project's GPU_ARGS). p95 of the frame callback (update + draw) < 8 ms, the canvas count flat,
// no long tasks (> 50 ms) after the warm-up. Skipped unless PERF=1: the CPU is shared by other work now.
//   PERF=1 npx playwright test perf.spec.mjs --project=chromium
import { test, expect } from '@playwright/test';
import { MAP, watch, ready, problems, startWith } from './helpers.mjs';

test('8 performance: p95 frame < 8 ms, canvases flat, no long tasks', async ({ page, browserName }) => {
  test.skip(!process.env.PERF, 'set PERF=1 (the machine is shared; no perf numbers by default)');
  test.skip(browserName !== 'chromium', 'chromium only (WebKit reports no longtask entries)');
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const P = window.__perf = { frames: [], long: [], canvases: 0, on: false };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(t => { const s = performance.now(); try { cb(t); } finally { if (P.on) P.frames.push(performance.now() - s); } });
    const ce = document.createElement.bind(document);
    document.createElement = (tag, o) => { if (String(tag).toLowerCase() === 'canvas') P.canvases++; return ce(tag, o); };
    if (window.OffscreenCanvas) { const O = window.OffscreenCanvas; window.OffscreenCanvas = class extends O { constructor(...a) { super(...a); P.canvases++; } }; }
    try { new PerformanceObserver(l => { if (P.on) for (const e of l.getEntries()) P.long.push(+e.duration.toFixed(1)); }).observe({ type: 'longtask', buffered: false }); } catch (e) { /* no longtask */ }
  });
  const w = await watch(page);
  await page.goto(MAP);
  await ready(page);
  const needs = await page.evaluate(() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(k => !Object.values(STORY.beats).some(b => b.stage === k)));
  test.fixme(needs.length > 0, `needs game/story.js beats for stage(s) ${needs.join(',')} (story builder)`);
  await startWith(page, 'Zoë');
  await page.locator('#rail button[data-k="7"]').click();
  await page.waitForTimeout(4000);                                     // warm-up: first compiles of the stage
  const c0 = await page.evaluate(() => { window.__perf.on = true; return window.__perf.canvases; });
  await page.waitForTimeout(12000);
  await page.locator('#btn-plug').click();                             // the dark: glow, slump
  await page.waitForTimeout(8000);
  const r = await page.evaluate(() => { const P = window.__perf; P.on = false; const a = P.frames.slice().sort((x, y) => x - y);
    return { n: a.length, p95: a[Math.floor(a.length * .95)] ?? 0, max: a.at(-1) ?? 0, long: P.long, canvases: P.canvases }; });
  test.info().annotations.push({ type: 'perf', description: JSON.stringify(r) });
  expect(r.n, 'frames measured').toBeGreaterThan(20 * 30);
  expect(r.p95, `p95 frame ms (${JSON.stringify(r)})`).toBeLessThan(8);
  expect(r.canvases, 'no canvas created after the warm-up').toBe(c0);
  expect(r.long, 'long tasks after the warm-up').toEqual([]);
  expect(await problems(w)).toEqual([]);
});
