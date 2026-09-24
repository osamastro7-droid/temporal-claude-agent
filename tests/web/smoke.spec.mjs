// Smoke: the page loads, draws, and stays clean (no errors, no CSP violations, no requests off /map/).
import { test, expect } from '@playwright/test';
import { watch, ready, MAP } from './helpers.mjs';

test('page loads clean and shows the start card', async ({ page }) => {
  const w = await watch(page);
  await page.goto(MAP);
  await ready(page);
  await page.waitForTimeout(500);                      // a few live frames
  const g = await page.evaluate(() => window.__game.state());
  expect(g.scene).toBe('start');
  const cv = page.locator('#cv');
  await expect(cv).toHaveAttribute('aria-hidden', 'true');
  const size = await cv.evaluate(c => [c.width, c.height]);
  expect(size[0]).toBeGreaterThanOrEqual(960); expect(size[0]).toBeLessThanOrEqual(1920);
  expect(Math.abs(size[1] - size[0] * 9 / 16)).toBeLessThanOrEqual(2);
  // the name form: Start stays disabled until the name is valid
  await expect(page.locator('#name-start')).toBeDisabled();
  await page.locator('#name-input').fill('Zoë');
  await expect(page.locator('#name-start')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const r = await w.finish();
  expect(r.errors, r.errors.join('\n')).toEqual([]);
  expect(r.csp, r.csp.join('\n')).toEqual([]);
  expect(r.external, r.external.join('\n')).toEqual([]);
  expect(r.requests.length).toBeGreaterThan(20);
});

test('test mode draws a frame (cpu raster)', async ({ page }) => {
  const w = await watch(page);
  await page.goto(MAP + '?test=1&raster=cpu');
  await ready(page);
  await page.evaluate(() => window.__game.advance(1));
  // tests may read pixels in ?raster=cpu only: the frame is paper with pencil on it, not blank
  const stats = await page.evaluate(() => {
    const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0, paper = 0; for (let i = 0; i < d.length; i += 16) { const l = d[i] + d[i + 1] + d[i + 2]; if (l < 300) dark++; else if (l > 650) paper++; }
    return { w: c.width, dark, paper };
  });
  expect(stats.w).toBe(1920);
  expect(stats.dark).toBeGreaterThan(500);
  expect(stats.paper).toBeGreaterThan(100000);
  const r = await w.finish();
  expect([...r.errors, ...r.csp, ...r.external]).toEqual([]);
});

test('ROOM.frame draws every named pose (AGENT.KEYS, ROOM.POSES, poseKey mixes, {from,to,t})', async ({ page }) => {
  const w = await watch(page);
  await page.goto(MAP + '?test=1&raster=cpu');
  await ready(page);
  const bad = await page.evaluate(() => {
    const c = document.getElementById('cv').getContext('2d'), out = [];
    const names = [...Object.keys(AGENT.KEYS), ...Object.keys(ROOM.POSES)];
    const tries = [...names.map(p => ({ pose: p })), { pose: ROOM.poseKey('point', 'slump', .42) }, { pose: ROOM.poseKey('READ', 'slump', .5) },
      { pose: { from: 'READ', to: 'LOWREACH', t: .5 } }, { pose: { from: 'rest', to: 'slump', t: .25 } }];
    for (const R of tries) { c.save(); try { resetFrame(c); ROOM.frame(c, R); } catch (e) { out.push(JSON.stringify(R.pose) + ': ' + e.message); } finally { c.restore(); } }
    return { out, n: tries.length };
  });
  expect(bad.out, bad.out.join('\n')).toEqual([]);
  expect(bad.n).toBeGreaterThan(15);
  const r = await w.finish();
  expect([...r.errors, ...r.csp, ...r.external]).toEqual([]);
});

// A stand-in shop beat (the story builder writes the real ones): lets the foundation's UI contracts be tested.
const stubShop = () => {
  STORY.beats['shop.product'] = { id: 'shop.product', stage: 0, scene: 'shop', dur: .5, captions: [], events: [], noPlug: 'plugShop',
    R: () => ({ film: null, at: SC.HOME, screen: SC.END_A1 }), hold: { action: 'buy', idle: () => ({ at: SC.HOME, screen: SC.END_A1 }) }, next: () => null };
};

test('keyboard: focus never falls to <body>; Space on the checkbox toggles it and does not pause', async ({ page }) => {
  const w = await watch(page);
  await page.goto(MAP + '?test=1');
  await ready(page);
  await page.evaluate(stubShop);
  const box = page.locator('#name-remember');
  await box.focus(); await page.keyboard.press('Space');
  expect(await box.isChecked()).toBe(true);
  expect(await page.evaluate(() => window.__game.state().settings.paused)).toBe(false);
  await box.focus(); await page.keyboard.press('Space');                         // back off (nothing stored)
  await page.locator('#name-input').fill('Zoë');
  await page.locator('#name-input').press('Enter');
  await page.evaluate(() => window.__game.advance(0));
  const s1 = await page.evaluate(() => ({ scene: window.__game.state().scene, focus: document.activeElement.id || document.activeElement.tagName }));
  expect(s1).toEqual({ scene: 'shop', focus: 'btn-action' });
  // the action button is aria-disabled while the beat plays and keeps its focus when it becomes live
  await expect(page.locator('#btn-action')).toBeDisabled();
  await page.evaluate(() => window.__game.advance(1));
  await expect(page.locator('#btn-action')).toBeEnabled();
  expect(await page.evaluate(() => document.activeElement.id)).toBe('btn-action');
  // Space on a focused button presses it (native), it does not pause
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__game.state().settings.paused)).toBe(false);
  const r = await w.finish();
  expect([...r.errors, ...r.csp, ...r.external]).toEqual([]);
});

test('stage 6 contract: Approve and Reject together; a decision while dark is queued', async ({ page }) => {
  const w = await watch(page);
  await page.goto(MAP + '?test=1');
  await ready(page);
  const s = await page.evaluate(() => {
    STORY.beats['t.wait'] = { id: 't.wait', stage: 6, scene: 'room', dur: .2, captions: [], events: [[0, G => { G.approval.waiting = true; }]],
      R: () => ({}), hold: { action: 'approve', idle: () => ({}) }, next: G => (G.approval.decision === 'reject' ? 't.rej' : 't.ok') };
    STORY.beats['t.ok'] = { id: 't.ok', stage: 7, scene: 'room', dur: 99, captions: [], events: [], R: () => ({}), next: () => null };
    STORY.beats['t.rej'] = { id: 't.rej', stage: 7, scene: 'room', dur: 99, captions: [], events: [], R: () => ({}), next: () => null };
    STORY.beats.start.next = () => 't.wait';
    window.__game.act('start', 'Zoë'); window.__game.advance(.5);
    return 1;
  });
  expect(s).toBe(1);
  const st = await page.evaluate(() => window.__game.state());
  expect(st.beat.id).toBe('t.wait');
  await expect(page.locator('#btn-action')).toHaveText('Approve');
  await expect(page.locator('#btn-alt')).toBeVisible();
  await expect(page.locator('#btn-alt')).toHaveText('Reject');
  // pull the plug while it waits, then decide in the dark: both buttons stay enabled; the choice is queued
  await page.evaluate(() => { window.__game.act('plug'); window.__game.advance(1); });
  expect(await page.evaluate(() => window.__game.state().worker.phase)).toBe('dark');
  await expect(page.locator('#btn-alt')).toBeEnabled();
  await page.locator('#btn-alt').click();
  const q = await page.evaluate(() => window.__game.state().approval);
  expect(q.queued).toBe('reject');
  await expect(page.locator('#why-action')).not.toBeEmpty();
  // plug it back in (the drawn plug's hotspot says 'unplug' while dark), wait out the notes: the decision lands
  expect(await page.evaluate(() => [...document.querySelectorAll('#hotspots .hot')].map(b => b.dataset.act))).toContain('unplug');
  await page.evaluate(() => { window.__game.act('unplug'); window.__game.advance(8); });
  const end = await page.evaluate(() => window.__game.state());
  expect(end.beat.id).toBe('t.rej');
  expect(end.approval.decision).toBe('reject');
  expect(end.crashes[0].outcome).toBeTruthy();
  const r = await w.finish();
  expect([...r.errors, ...r.csp, ...r.external]).toEqual([]);
});

test('screenshots through w.screenshot() add no errors (WebKit reports Playwright\'s own style as a CSP error)', async ({ page }) => {
  const w = await watch(page);
  await page.goto(MAP);
  await ready(page);
  for (let i = 0; i < 3; i++) await w.screenshot({ path: `test-results/smoke-shot-${i}.png` });
  const r = await w.finish();
  expect([...r.errors, ...r.csp, ...r.external], r.ignored.join('\n')).toEqual([]);
});

test('step mode holds at a stage boundary and Next releases it; [capId, tMin] waits for tMin', async ({ page }) => {
  const w = await watch(page);
  await page.goto(MAP + '?test=1');
  await ready(page);
  const r1 = await page.evaluate(() => {
    STORY.beats['t.a'] = { id: 't.a', stage: 1, scene: 'room', dur: G => 1 + G.drawnName.length / 14, captions: [['s1', .5]], events: [], R: () => ({}), next: () => 't.b' };
    STORY.beats['t.b'] = { id: 't.b', stage: 2, scene: 'room', dur: 9, captions: [], events: [], R: () => ({}), next: () => null };
    STORY.beats.start.next = () => 't.a';
    window.__game.act('step'); window.__game.act('start', 'Zoë'); window.__game.advance(.25);
    const early = window.__game.state().cap.now; window.__game.advance(.5);
    const later = window.__game.state().cap.now; window.__game.advance(1.5);
    const g = window.__game.state();
    return { early, later: later && later.id, beat: g.beat.id, hold: g.hold, paused: g.settings.paused, label: document.getElementById('btn-action').textContent };
  });
  expect(r1.early).toBeNull();                      // s1 waits for q >= .5
  expect(r1.later).toBe('s1');
  expect(r1).toMatchObject({ beat: 't.a', paused: false, label: 'Next' });   // dur(G) = 1 + 3/14 s, then the step hold
  expect(r1.hold.step).toBe(true);
  await page.locator('#btn-action').click();
  expect(await page.evaluate(() => window.__game.state().beat.id)).toBe('t.b');
  const r = await w.finish();
  expect([...r.errors, ...r.csp, ...r.external]).toEqual([]);
});

test('crash contract: timing from ROOM.CRASH_T; a crash while he wakes; a double crash; no plug in the close-up', async ({ page }) => {
  const w = await watch(page);
  await page.goto(MAP + '?test=1');
  await ready(page);
  const r = await page.evaluate(() => {
    const T = ROOM.CRASH_T, g = () => window.__game.state(), G = window.__game;
    const log = [], calls = [], orig = { crash: SFX_LIVE.crash, power: SFX_LIVE.power };
    SFX_LIVE.crash = () => calls.push(['crash', g().clock]); SFX_LIVE.power = () => calls.push(['power', g().clock]);
    STORY.beats['t.s5'] = { id: 't.s5', stage: 5, scene: 'room', dur: 9, captions: [['s5cap', 8]], events: [], R: () => ({ pose: 'typeA' }), next: () => null };
    STORY.beats.start.next = () => 't.s5';
    G.act('start', 'Zoë'); G.advance(1);
    const snap = tag => { const s = g(); log.push({ tag, phase: s.worker.phase, scene: s.scene, beat: s.beat.id, frozenQ: s.frozenQ, crashes: s.crashes.length,
      ok: STORY.plugState(s).ok, reason: STORY.plugState(s).reason, dis: document.getElementById('btn-plug').getAttribute('aria-disabled'),
      pressed: document.getElementById('btn-plug').getAttribute('aria-pressed'), caps: (s.worker.caps || []).map(c => c.id), prev: s.worker.prev, queue: s.cap.queue.map(c => c.id) }); };
    const c0 = g().clock; G.act('plug'); const fq = g().frozenQ; snap('plug');
    G.advance(T.out + 1 / 24); snap('dark1');
    G.act('unplug'); const u0 = g().clock; G.advance(T.power - 1 / 24); snap('pushing');
    G.advance(2 / 24); snap('waking');
    G.act('plug'); snap('replug');                     // a crash while he wakes
    G.advance(1); snap('dark2');
    G.act('unplug'); G.advance(T.insert[0] + .5); snap('closeup');
    G.act('plug'); snap('closeupPlug');                // refused in the close-up
    G.advance(T.insert[1] - T.insert[0]); snap('putdown');
    G.act('plug'); snap('replug2');                    // a crash while he puts his notes down: a double crash again
    G.advance(1); G.act('unplug'); G.advance(T.done + .2); snap('on');
    const end = g(); SFX_LIVE.crash = orig.crash; SFX_LIVE.power = orig.power;
    return { T, fq, c0, u0, log, calls, crashes: end.crashes, queue: end.cap.queue.map(c => c.id), t0: end.beat.t0, clock: end.clock };
  });
  const L = Object.fromEntries(r.log.map(x => [x.tag, x]));
  expect(L.plug).toMatchObject({ phase: 'pulling', ok: false, reason: 'plugMoving', dis: 'true', pressed: 'true' });
  expect(L.dark1).toMatchObject({ phase: 'dark', ok: true });
  expect(L.pushing).toMatchObject({ phase: 'pushing', ok: false, reason: 'plugMoving' });
  expect(L.waking).toMatchObject({ phase: 'waking', ok: true, dis: 'false', pressed: 'false', crashes: 1 });
  // the re-crash: story still frozen at the same q, same beat; captions merged; prev kept
  expect(L.replug).toMatchObject({ phase: 'pulling', beat: 't.s5', frozenQ: r.fq, crashes: 2, caps: ['s5cap'] });
  expect(L.replug.prev.phase).toBe('waking');
  expect(L.replug.prev.tu).toBeGreaterThanOrEqual(r.T.power);
  expect(L.replug.prev.rec).toEqual({ id: 't.s5', q: r.fq });
  expect(L.replug.queue[0]).toBe('crashAgain');
  expect(L.dark2).toMatchObject({ phase: 'dark', crashes: 2 });
  expect(L.closeup).toMatchObject({ phase: 'notes', scene: 'notes', ok: false, reason: 'plugNotes' });
  expect(L.closeupPlug).toMatchObject({ phase: 'notes', crashes: 2 });
  expect(L.putdown).toMatchObject({ phase: 'notes', scene: 'room', ok: true });
  expect(L.replug2).toMatchObject({ phase: 'pulling', crashes: 3, caps: ['s5cap'], frozenQ: r.fq });
  expect(L.replug2.queue).not.toContain('notes');
  expect(L.on).toMatchObject({ phase: 'on', beat: 't.s5', frozenQ: null });
  expect(r.crashes.every(c => c.outcome)).toBe(true);
  expect(r.queue).toContain('s5cap');                 // the held caption came back with the resumed beat
  // sound on the game clock: crash() at the spark (not the click), power() when the push lands, once per crash
  expect(r.calls.map(c => c[0])).toEqual(['crash', 'power', 'crash', 'power', 'crash', 'power']);
  expect(r.calls[0][1] - r.c0).toBeGreaterThanOrEqual(r.T.spark - 1e-9);
  expect(r.calls[0][1] - r.c0).toBeLessThan(r.T.spark + 1 / 24 + 1e-9);
  expect(r.calls[1][1] - r.u0).toBeGreaterThanOrEqual(r.T.power - 1e-9);
  expect(r.calls[1][1] - r.u0).toBeLessThan(r.T.power + 1 / 24 + 1e-9);
  const res = await w.finish();
  expect([...res.errors, ...res.csp, ...res.external]).toEqual([]);
});
