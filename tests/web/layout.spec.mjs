// Screenshots and layout (GAME_SPEC §10 browser spec 7; §2 "Layout"): 375x812 (dpr 3), 768x1024 (dpr 2),
// 1440x900 (dpr 2) of the start card, checkout, waiting, dark, notes and the end card, into out/shots/.
// Checked in every state: no horizontal scroll, every visible button >= 44x44 css px, the name input's
// font >= 16 px; the canvas is full width at 375/768 and at most 1200 px at 1440; and in live mode (no
// ?test=1) the backing width is clamp(round(cssW * dpr), 960, 1920).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { MAP, watch, ready, open, problems, needStory, state, view, advance, sync, startWith, railTo, playToEnd, until } from './helpers.mjs';

const SIZES = [{ w: 375, h: 812, dpr: 3 }, { w: 768, h: 1024, dpr: 2 }, { w: 1440, h: 900, dpr: 2 }];
fs.mkdirSync(new URL('./out/shots/', import.meta.url), { recursive: true });

async function checkLayout(page, tag) {
  const L = await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden]'); };
    const small = [...document.querySelectorAll('button')].filter(vis).map(b => { const r = b.getBoundingClientRect(); return { id: b.id || b.className || b.textContent.slice(0, 20), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; }).filter(b => b.w < 43.5 || b.h < 43.5);
    const cv = document.getElementById('cv').getBoundingClientRect(), inp = document.getElementById('name-input');
    return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, small, cvW: cv.width, input: parseFloat(getComputedStyle(inp).fontSize), backing: document.getElementById('cv').width };
  });
  expect(L.scrollW, `${tag}: no horizontal scroll`).toBeLessThanOrEqual(L.innerW);
  expect(L.small, `${tag}: buttons under 44x44`).toEqual([]);
  expect(L.input, `${tag}: name input font`).toBeGreaterThanOrEqual(16);
  if (L.innerW <= 768) expect(L.cvW, `${tag}: the canvas is full width`).toBeGreaterThanOrEqual(L.innerW - 32 - 1);
  else expect(L.cvW, `${tag}: the canvas is at most 1200 px`).toBeLessThanOrEqual(1200);
  return L;
}

for (const sz of SIZES) {
  test.describe(`7 layout ${sz.w}x${sz.h}@${sz.dpr}`, () => {
    test.use({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: sz.dpr });

    test('live mode: the start card, backing width', async ({ page }) => {
      const w = await watch(page);
      await page.goto(MAP);
      await ready(page);
      await page.waitForTimeout(400);                                  // the 150 ms resize debounce
      const L = await checkLayout(page, 'start (live)');
      const want = Math.min(1920, Math.max(960, Math.round(L.cvW * sz.dpr)));
      expect(L.backing, 'backing width = clamp(round(cssW * dpr), 960, 1920)').toBeGreaterThanOrEqual(want - 2);
      expect(L.backing).toBeLessThanOrEqual(want + 2);
      expect(L.backing).toBeGreaterThanOrEqual(960); expect(L.backing).toBeLessThanOrEqual(1920);
      await w.screenshot({ path: `out/shots/${sz.w}-start.png`, fullPage: true });
      expect(await problems(w)).toEqual([]);
    });

    test('checkout, waiting, dark, notes, end card', async ({ page }) => {
      test.setTimeout(180000);
      const w = await open(page);
      await needStory(page);
      await startWith(page, 'Zoë');
      const shot = async name => { await checkLayout(page, name); await w.screenshot({ path: `out/shots/${sz.w}-${name}.png`, fullPage: true }); };
      // checkout: after Buy, when the name has typed itself and Pay is live
      for (let i = 0; i < 80; i++) { const v = await view(page); if (v.action.act === 'buy' && v.action.enabled) break; await advance(page, .25); }
      await page.locator('#btn-action').click(); await sync(page);
      for (let i = 0; i < 80; i++) { const v = await view(page); if (v.action.act === 'pay' && v.action.enabled) break; await advance(page, .25); }
      expect((await view(page)).action.act).toBe('pay');
      await shot('checkout');
      // waiting: the approval hold
      await railTo(page, 6);
      for (let i = 0; i < 120; i++) { const v = await view(page); if (v.action.act === 'approve' && v.action.enabled) break; await advance(page, .5); }
      await advance(page, 1);
      await shot('waiting');
      // dark, then the notes close-up
      await page.locator('#btn-plug').click(); await sync(page);
      await until(page, { phase: 'dark' }, 3); await advance(page, 1.5);
      await shot('dark');
      await page.locator('#btn-plug').click(); await sync(page);
      await until(page, { scene: 'notes' }, 8); await advance(page, 1.5);
      await shot('notes');
      await until(page, { phase: 'on' }, 8);
      const r = await playToEnd(page);
      expect(r.ok).toBe(true);
      await advance(page, 3);
      await shot('end');
      expect(await problems(w)).toEqual([]);
    });
  });
}
