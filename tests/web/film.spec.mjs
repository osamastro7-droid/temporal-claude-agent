// Compare with the film (GAME_SPEC §10 browser spec 11). Gated: FILM=1 (it renders film frames with the film's
// own page, read-only, through the server's /film-src/ route).
//   FILM=1 npx playwright test film.spec.mjs --project=chromium
// 1. Exact match (CPU raster) of the copied film windows: a1 tau 3.5 (frame 84), a2 tau 3.52 (387), a3 tau 3.0
//    (667): film2.html?bare=1&frame=N against the docs/map engine (dev/film.html), both as the film draws it and
//    through the game's own film-window path (SHOP.film, captions blanked; &via=shop&alpha=0), as film-compare.mjs.
// 2. SSIM >= .95 on crops: the room dark (a9 tau 4.4) and the notes close-up (a9 tau 10.5) against the game's
//    own dark room and close-up. THE GAME STATES (a9's moment: the refund is printed and written, the email is
//    next and its notebook line is still empty, a9.js beat sheet 0.83-2.83 and "the next line is still empty"):
//      - the path: name 'Zoë', the real rail chip 8 (STORY.canon(8): rows 0-3 written and checked, the receipt
//        printed), then played through the story to 0.5 s before the commit of row 4's text (the email_customer
//        line; Claude step 3 is running): the crash matrix's 's8-step3-before' moment;
//      - DARK: the real #btn-plug click there, then exactly CRASH_T.spark + (4.4 - a9 T.spark 2.833) s of game
//        time: 1.567 s after the prongs leave the socket, as a9 tau 4.4 is (phase 'dark', the notebook glowing);
//      - NOTES: #btn-plug again (plug it back in) at that moment, then exactly CRASH_T.insert[0] + (10.5 - a9
//        T.insert[0] 8.75) s: 1.75 s into the close-up, as a9 tau 10.5 is (scene 'notes').
//    Crops avoid what legitimately differs: the caption band (captions sit at the top, kit.js CAPTION), the
//    agent (a9 slumps from ONENV, the game from its own pose) and the notebook rows (a9 shows 2, the game 6).
// Chromium runs here WITHOUT the project's GPU args: the film was rendered in software, and its offscreen
// layers rasterized on the GPU differ by a channel from the CPU raster (frame 667 did, via=shop).
// Side-by-side crops (film left, game right) go to out/film-*.png for review by eye, plus the whole frames
// (out/film-dark-full.png, out/film-notes-full.png, half size); film-compare.mjs writes the full-frame sheet
// for the exact frames (out/compare-sheet.png).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { MAP, ready, startWith, railTo, advance, sync, state, stageChain, commitOf, locate, playTo } from './helpers.mjs';

test.skip(!process.env.FILM, 'set FILM=1 to compare with the film');
test.use({ launchOptions: { args: [] } });

/** Luminance of a canvas region (x, y, w, h in 1920x1080 units; the canvas must be 1920 wide), base64 bytes. */
const lumaOf = (page, sel, boxes) => page.evaluate(([sel, boxes]) => {
  const c = sel === '#cv' ? document.getElementById('cv') : window.__dev ? window.__dev.canvas : document.querySelector('canvas'), x = c.getContext('2d'), k = c.width / 1920;
  return boxes.map(([bx, by, bw, bh]) => { const X = Math.round(bx * k), Y = Math.round(by * k), Wd = Math.round(bw * k), Hd = Math.round(bh * k), d = x.getImageData(X, Y, Wd, Hd).data, g = new Uint8Array(Wd * Hd);
    for (let i = 0; i < g.length; i++) g[i] = Math.round(.299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2]);
    let s = ''; for (let i = 0; i < g.length; i += 32768) s += String.fromCharCode.apply(null, g.subarray(i, i + 32768));
    return { w: Wd, h: Hd, b64: btoa(s) }; });
}, [sel, boxes]);
const bytes = r => ({ w: r.w, h: r.h, px: Buffer.from(r.b64, 'base64') });
/** Bilinear resample of a luma image to w x h. */
function resample(a, w, h) {
  if (a.w === w && a.h === h) return a;
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = (x + .5) * a.w / w - .5, sy = (y + .5) * a.h / h - .5, x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), x1 = Math.min(a.w - 1, x0 + 1), y1 = Math.min(a.h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    const v = (1 - fy) * ((1 - fx) * a.px[y0 * a.w + x0] + fx * a.px[y0 * a.w + x1]) + fy * ((1 - fx) * a.px[y1 * a.w + x0] + fx * a.px[y1 * a.w + x1]);
    px[y * w + x] = Math.round(v);
  }
  return { w, h, px };
}
/** Mean SSIM over 8x8 windows (stride 4), luma, the standard constants (L 255, K1 .01, K2 .03). */
function ssim(a, b) {
  const C1 = (.01 * 255) ** 2, C2 = (.03 * 255) ** 2; let sum = 0, n = 0;
  for (let y = 0; y + 8 <= a.h; y += 4) for (let x = 0; x + 8 <= a.w; x += 4) {
    let ma = 0, mb = 0; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * a.w + x + i; ma += a.px[k]; mb += b.px[k]; }
    ma /= 64; mb /= 64; let va = 0, vb = 0, cov = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * a.w + x + i, da = a.px[k] - ma, db = b.px[k] - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= 63; vb /= 63; cov /= 63;
    sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return sum / n;
}
/** A side-by-side of two luma crops (film left, game right) as out/film-<name>.png, drawn in the current page. */
async function sheet(page, name, a, b) {
  const png = await page.evaluate(([a, b]) => {
    const h = Math.max(a.h, b.h), w = a.w + 8 + b.w, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), put = (o, x0) => { const bin = atob(o.b64), im = g.createImageData(o.w, o.h);
      for (let i = 0; i < o.w * o.h; i++) { const v = bin.charCodeAt(i); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } g.putImageData(im, x0, 0); };
    g.fillStyle = '#f0f'; g.fillRect(0, 0, w, h); put(a, 0); put(b, a.w + 8); return c.toDataURL('image/png').split(',')[1];
  }, [a, b].map(o => ({ w: o.w, h: o.h, b64: Buffer.from(o.px).toString('base64') })));
  fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL(`./out/film-${name}.png`, import.meta.url), Buffer.from(png, 'base64'));
}
/** Every RGBA byte of the page's canvas (the film's, or dev/film.html's). */
const rawOf = (page, dev) => page.evaluate(dev => { const c = dev ? window.__dev.canvas : document.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = ''; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768)); return { w: c.width, h: c.height, b64: btoa(s) }; }, dev).then(r => ({ ...r, px: Buffer.from(r.b64, 'base64') }));

/** The film's own frame for (act, tau), drawn by film2.html. Canvas pixels are read on that page. */
async function filmFrame(page, act, tau) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/film-src/film2.html?bare=1&frame=0');
  await page.waitForFunction(() => window.__ready === true || !!window.__error, null, { timeout: 120000 });
  return page.evaluate(([act, tau]) => { let acc = 0; for (const s of SCENES) { if (s.key === act) break; acc += s.dur; }
    const i = Math.round((acc + tau) * 24); window.__drawFrame(i); return i; }, [act, tau]);
}

test.describe('11 film comparison', () => {
  for (const [f, what] of [[84, 'a1 tau 3.5'], [387, 'a2 tau 3.52'], [667, 'a3 tau 3.0']]) {
    test(`exact: frame ${f} (${what})`, async ({ page }) => {
      test.setTimeout(180000);
      const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`/film-src/film2.html?bare=1&frame=${f}`);
      await page.waitForFunction(() => window.__ready === true || !!window.__error, null, { timeout: 120000 });
      const film = await rawOf(page, false);
      for (const extra of ['', '&alpha=0&via=shop']) {
        await page.goto(`/dev/film.html?frame=${f}&raster=cpu${extra}`);
        await page.waitForFunction(() => (window.__dev && window.__dev.ready) || !!window.__devError, null, { timeout: 120000 });
        const map = await rawOf(page, true);
        expect([map.w, map.h]).toEqual([film.w, film.h]);
        let diff = 0; for (let i = 0; i < film.px.length; i++) if (film.px[i] !== map.px[i]) diff++;
        expect(diff, `frame ${f}${extra || ' (as the film draws it)'}: differing RGBA channels`).toBe(0);
      }
      expect(errs).toEqual([]);
    });
  }

  // crops, 1920x1080 screen units. Room: the socket rig with the plug out, the printer with its receipt, the lamp.
  const ROOM_CROPS = { rig: [1560, 740, 360, 340], printer: [1180, 640, 330, 300], lamp: [380, 300, 360, 420] };
  // the close-up page's header (page-local x 0..700, y 0..120 of SB.notebook), a9 INS (522, 312, 1.25) vs the
  // game's ROOM.INS (575, 312, 1.1): the same page at two scales, compared after resampling
  const NOTES_FILM = [522, 312, 700 * 1.25, 120 * 1.25], NOTES_GAME = [575, 312, 700 * 1.1, 120 * 1.1];

  test('SSIM >= .95: the room dark (a9 tau 4.4) and the notes close-up (a9 tau 10.5)', async ({ page }) => {
    test.setTimeout(240000);
    // the film
    await filmFrame(page, 'a9', 4.4);
    const filmDark = (await lumaOf(page, 'canvas', Object.values(ROOM_CROPS))).map(bytes);
    const filmDarkFull = resample(bytes((await lumaOf(page, 'canvas', [[0, 0, 1920, 1080]]))[0]), 960, 540);
    await filmFrame(page, 'a9', 10.5);
    const filmNotes = bytes((await lumaOf(page, 'canvas', [NOTES_FILM]))[0]);
    const filmNotesFull = resample(bytes((await lumaOf(page, 'canvas', [[0, 0, 1920, 1080]]))[0]), 960, 540);
    // the game (the states are defined in the header)
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(MAP + '?test=1&raster=cpu');
    await ready(page);
    await startWith(page, 'Zo\u00eb');
    await railTo(page, 8);
    const chain = await stageChain(page, 8), cm = commitOf(chain, 4, 't'), tgt = locate(chain, cm.abs - .5);
    await playTo(page, tgt.id, tgt.q);
    const at = await state(page);
    expect(at.book.slice(0, 5).map(r => [r.t, r.c]), 'rows 0-3 written and checked, the email line empty').toEqual([[1, 1], [1, 1], [1, 1], [1, 1], [0, 0]]);
    expect(at.world.refunds).toBe(1);
    const T = await page.evaluate(() => ROOM.CRASH_T), A9 = { spark: 34 / 12, insert: 105 / 12 };
    await page.locator('#btn-plug').click(); await sync(page);
    await advance(page, T.spark + (4.4 - A9.spark));
    expect((await state(page)).worker.phase, 'DARK: the phase').toBe('dark');
    const gameDark = (await lumaOf(page, '#cv', Object.values(ROOM_CROPS))).map(bytes);
    const gameDarkFull = resample(bytes((await lumaOf(page, '#cv', [[0, 0, 1920, 1080]]))[0]), 960, 540);
    await page.locator('#btn-plug').click(); await sync(page);
    await advance(page, T.insert[0] + (10.5 - A9.insert));
    expect((await state(page)).scene, 'NOTES: the scene').toBe('notes');
    const gameNotes = resample(bytes((await lumaOf(page, '#cv', [NOTES_GAME]))[0]), filmNotes.w, filmNotes.h);
    const gameNotesFull = resample(bytes((await lumaOf(page, '#cv', [[0, 0, 1920, 1080]]))[0]), 960, 540);
    expect(errs).toEqual([]);
    await sheet(page, 'dark-full', filmDarkFull, gameDarkFull);
    await sheet(page, 'notes-full', filmNotesFull, gameNotesFull);
    const scores = {};
    for (const [i, k] of Object.keys(ROOM_CROPS).entries()) { scores['dark.' + k] = ssim(filmDark[i], gameDark[i]); await sheet(page, 'dark-' + k, filmDark[i], gameDark[i]); }
    scores['notes.header'] = ssim(filmNotes, gameNotes); await sheet(page, 'notes-header', filmNotes, gameNotes);
    const info = { ...scores, 'dark.fullFrame (not asserted)': ssim(filmDarkFull, gameDarkFull), 'notes.fullFrame (not asserted)': ssim(filmNotesFull, gameNotesFull) };
    test.info().annotations.push({ type: 'ssim', description: JSON.stringify(info) });
    console.log('SSIM', JSON.stringify(info, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v));
    for (const [k, v] of Object.entries(scores)) expect(v, `SSIM ${k} (${JSON.stringify(scores)})`).toBeGreaterThanOrEqual(.95);
  });
});
