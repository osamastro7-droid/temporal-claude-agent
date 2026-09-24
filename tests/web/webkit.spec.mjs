// WebKit smoke (GAME_SPEC §10 browser spec 10): a full play in Playwright's WebKit with no errors, including a
// crash (the dark glow: Safari's blur fallback, kit.js glowBehind) and the notes close-up.
//   npx playwright test --project=webkit
import { test, expect } from '@playwright/test';
import { open, problems, needStory, state, sync, startWith, playToEnd, crash, until, HISTORY_APPROVED, expectedEvents, isRetry } from './helpers.mjs';

test('10 webkit: full play with a crash, no errors', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the WebKit project runs this');
  test.setTimeout(240000);
  const w = await open(page, '?test=1&raster=cpu');
  const hasFilter = await page.evaluate(() => 'filter' in CanvasRenderingContext2D.prototype);
  test.info().annotations.push({ type: 'canvas filter', description: hasFilter ? 'present (the fallback path does not run here)' : 'absent: glowBehind uses its layer fallback' });
  await needStory(page);
  await startWith(page, 'Zoë');
  // the shop and the room through the real buttons, until stage 7's printer
  for (let i = 0; i < 800; i++) {
    const s = await state(page);
    if (s.stage === 7 && s.scene === 'room' && s.worker.phase === 'on') break;
    const v = await page.evaluate(() => window.__game.view());
    if (v.action.act && v.action.enabled) { await page.locator('#btn-action').click(); await sync(page); continue; }
    await page.evaluate(() => window.__game.advance(.5));
  }
  expect((await state(page)).stage).toBe(7);
  await page.evaluate(() => window.__game.advance(.5));
  const K = await crash(page);
  expect(K.on.worker.phase).toBe('on');
  // a frame in the dark with the glow drew real pixels (not blank) on WebKit
  const r = await playToEnd(page);
  expect(r.ok).toBe(true);
  expect(r.state.events.map(e => e.text).filter(t => !isRetry(t))).toEqual(expectedEvents(HISTORY_APPROVED, 'zoe').map(e => e.text));
  expect(r.state.world).toMatchObject({ refunds: 1, emails: 1 });
  await until(page, { scene: 'end' }, 1);
  expect(await problems(w)).toEqual([]);
});

test('10b webkit: the dark room glow draws (blur fallback), pixels read in ?raster=cpu', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the WebKit project runs this');
  const w = await open(page, '?test=1&raster=cpu');
  // ROOM.frame of a dark room with a glowing notebook: the glow must light pixels around the notebook
  const px = await page.evaluate(() => {
    const cv = document.getElementById('cv'), c = cv.getContext('2d');
    const draw = glow => { c.save(); resetFrame(c); ROOM.frame(c, { dark: 1, lamp: 0, pose: 'slump', face: 'off', visor: 1, book: { rows: [{ t: 1, c: 1, strike: 0 }, { t: 1, c: 0, strike: 0 }, {}, {}, {}, {}].map(r => ({ t: 0, c: 0, strike: 0, ...r })), k: 0, glow } }); c.restore();
      const [x, y] = ROOM.toScreen([ROOM.NB.x, ROOM.NB.y]), s = cv.width / 1920, d = c.getImageData(Math.round((x - 200) * s), Math.round((y - 150) * s), Math.round(400 * s), Math.round(260 * s)).data;
      let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; return sum / (d.length / 4); };
    return { off: draw(0), on: draw(1) };
  });
  expect(px.on, `the glow lights the notebook area (${JSON.stringify(px)})`).toBeGreaterThan(px.off + 3);
  expect(await problems(w)).toEqual([]);
});
