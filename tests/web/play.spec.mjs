// Play-throughs (GAME_SPEC §10 browser specs 1, 3, 6, 9): the full approve play through the real controls,
// the reject path, reduced motion and sound. Time moves through window.__game.advance (?test=1).
import { test, expect } from '@playwright/test';
import { MAP, watch, ready, open, problems, needStory, state, view, advance, sync, startWith, railTo, playToEnd, until,
  HISTORY_APPROVED, HISTORY_REJECTED, expectedEvents } from './helpers.mjs';

// The spec's captions for the approve path, in order, as the role=status region repeats them (GAME_SPEC §4:
// the exact texts are given there; the status region joins a caption's two lines with a space).
const CAPTIONS_APPROVE = [
  'You order a teapot online.',
  'It arrives broken. You ask for a refund.',
  'Behind the scenes, an AI agent handles it.',
  'Temporal writes down every finished step.',
  'He reads your request: Claude step 1.',
  'Claude pauses at every tool call.',
  'Temporal runs it, and writes it down.',
  'He reads the answer and asks for a refund.',
  'Risky steps wait for a human.',
  'You are the manager now.',
  'The refund gets a fixed receipt number.',
  'Then the email, and his final answer.',
  'The refund happens once.',
];
const FULL = { t: 1, c: 1, strike: 0 };

test('1 full play, approve: events equal the fixture; refunds 1, emails 1, refundRuns 1', async ({ page }) => {
  test.setTimeout(180000);
  const w = await open(page);
  await needStory(page);
  await startWith(page, 'Zoë');
  let s = await state(page);
  expect(s).toMatchObject({ scene: 'shop', stage: 0, name: 'Zoë', drawnName: 'Zoë', nameMode: 'font', slug: 'zoe' });
  const scenes = [], stages = [], captions = [], plugBad = [], hot = [];
  for (let i = 0; i < 1600; i++) {
    // one round trip: the state, the view model and what the DOM shows
    const o = await page.evaluate(() => { const b = document.getElementById('btn-plug'), g = window.__game;
      return { s: g.state(), v: g.view(), plugOff: b.getAttribute('aria-disabled') === 'true', whyPlug: document.getElementById('why-plug').textContent,
        status: document.getElementById('status').textContent,
        hot: [...document.querySelectorAll('#hotspots .hot')].map(h => { const r = h.getBoundingClientRect(); return { act: h.dataset.act, w: r.width, h: r.height, hidden: h.getAttribute('aria-hidden'), tab: h.tabIndex }; }) }; });
    s = o.s;
    if (scenes.at(-1) !== s.scene) scenes.push(s.scene);
    if (s.scene !== 'end' && stages.at(-1) !== s.stage) stages.push(s.stage);
    if (o.status && captions.at(-1) !== o.status) captions.push(o.status);
    hot.push(...o.hot);
    if (s.scene === 'end') break;
    // the plug (GAME_SPEC §4, end of the crash sequence): never in the shop or the wide shot; always in the
    // room while the worker is on (stages 1-9); disabled buttons say why, in text
    if (['shop', 'wide', 'start', 'mail'].includes(s.scene) && (o.v.plug.ok || !o.plugOff)) plugBad.push(`plug live in ${s.scene} (${s.beat.id})`);
    if (s.scene === 'room' && s.worker.phase === 'on' && s.stage >= 1 && !o.v.plug.ok) plugBad.push(`plug dead in the room (${s.beat.id} q ${s.q})`);
    if (o.plugOff && !o.whyPlug.trim()) plugBad.push(`disabled plug without a reason (${s.beat.id})`);
    const a = o.v.action;
    if (a.act && a.enabled) {
      const buyHot = page.locator('#hotspots .hot[data-act="buy"]');
      if (a.act === 'buy' && await buyHot.count()) await buyHot.click();           // the drawn Buy button, with the mouse
      else await page.locator('#btn-action').click();
      await sync(page);
      continue;
    }
    await advance(page, .5);
  }
  expect(s.scene, 'reached the end card').toBe('end');
  expect(plugBad, plugBad.join('\n')).toEqual([]);
  // the history (the fixture is the independent truth: facts.md §3)
  expect(s.events.map(e => ({ text: e.text, stage: e.stage }))).toEqual(expectedEvents(HISTORY_APPROVED, 'zoe'));
  await expect(page.locator('#p-history li')).toHaveText(expectedEvents(HISTORY_APPROVED, 'zoe').map(e => e.text));
  expect(s.world).toMatchObject({ refunds: 1, refundRuns: 1, emails: 1, emailRuns: 1, lookups: 1 });
  expect(s.book).toEqual([FULL, FULL, FULL, FULL, FULL, FULL]);
  expect(s.crashes).toEqual([]);
  // the path: start -> shop -> wide -> room -> mail -> end; stages 0..9 in order
  expect(scenes).toEqual(['shop', 'wide', 'room', 'mail', 'end']);
  expect(stages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(captions).toEqual(CAPTIONS_APPROVE);
  // hotspots: aria-hidden, out of the tab order, >= 44x44 css px (GAME_SPEC §2)
  expect(hot.length).toBeGreaterThan(0);
  expect(hot.filter(h => h.hidden !== 'true' || h.tab !== -1 || h.w < 43.5 || h.h < 43.5)).toEqual([]);
  // the end card's HTML buttons
  await expect(page.locator('#endbar')).toBeVisible();
  await expect(page.locator('#controls')).toBeHidden();
  expect(await problems(w)).toEqual([]);
});

test('1b Play again keeps the name and resets the rest', async ({ page }) => {
  test.setTimeout(120000);
  const w = await open(page);
  await needStory(page);
  await startWith(page, 'Zoë');
  await railTo(page, 9);
  const r = await playToEnd(page);
  expect(r.ok).toBe(true);
  await page.locator('#btn-again').click(); await sync(page);
  const s = await state(page);
  expect(s).toMatchObject({ scene: 'shop', stage: 0, name: 'Zoë', slug: 'zoe', events: [], crashes: [] });
  expect(s.world).toMatchObject({ refunds: 0, refundRuns: 0, emails: 0, emailRuns: 0, lookups: 0 });
  expect(await problems(w)).toEqual([]);
});

test('3 reject path: rows, refunds 0, emails 0, the exact final answer', async ({ page }) => {
  test.setTimeout(120000);
  const w = await open(page);
  await needStory(page);
  await startWith(page, 'Zoë');
  await railTo(page, 6);
  // wait for the approval, then press the real Reject button
  for (let i = 0; i < 60; i++) { const v = await view(page); if (v.action.act === 'approve' && v.action.enabled) break; await advance(page, .5); }
  await expect(page.locator('#btn-alt')).toBeVisible();
  await expect(page.locator('#btn-alt')).toHaveText('Reject');
  await page.locator('#btn-alt').click(); await sync(page);
  let s = await state(page);
  expect(s.approval.decision).toBe('reject');
  expect(s.branch).toBe('reject');
  const r = await playToEnd(page, 'reject');
  expect(r.ok, 'reached the end card').toBe(true);
  s = r.state;
  const want = expectedEvents(HISTORY_REJECTED, 'zoe');
  expect(s.events.map(e => e.text)).toEqual(want.map(e => e.text));
  want.forEach((e, i) => { if (e.stage !== null) expect(s.events[i].stage, e.text).toBe(e.stage); });
  expect(s.world).toMatchObject({ refunds: 0, refundRuns: 0, emails: 0, emailRuns: 0 });
  // GAME_SPEC §4 "The Reject branch": row 2's text struck, row 3 'rejected' (text and check), row 4 'done'
  expect(s.book).toEqual([FULL, FULL, { t: 1, c: 0, strike: 1 }, FULL, FULL, { t: 0, c: 0, strike: 0 }]);
  const labels = await page.evaluate(() => STORY.rowLabels('reject'));
  expect(labels.slice(3, 5)).toEqual(['rejected', 'done']);
  expect(await problems(w)).toEqual([]);
});

test('6 reduced motion: the media query sets it; plain fades, no glow pulse; a play-through with a crash', async ({ page }) => {
  test.setTimeout(180000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const w = await open(page);
  expect((await state(page)).settings.reduced).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-reduced', 'true');
  // the crash overlay's reduced variants (GAME_SPEC §2 "Reduced motion"): a plain .3 s fade into the dark
  // (no .85/.3/1 steps), a plain fade back (no .35/.8 flicker), no glow pulse
  const d = await page.evaluate(() => {
    const T = ROOM.CRASH_T, K = (red, tc, tu) => ({ phase: tu === null ? (tc < T.out ? 'pulling' : 'dark') : tu < T.power ? 'pushing' : 'waking', t: 0, tc, tu, reduced: red, when: 'after', saved: { wait: true, drawer: true, envelope: true }, rec: null, prev: null, notes: null });
    const run = red => {
      const down = [], up = [], glow = [];
      for (let i = 0; i <= 16; i++) down.push(ROOM.crash({}, K(red, T.spark + i / 24, null)).dark);
      for (let i = 0; i <= 16; i++) up.push(ROOM.crash({}, K(red, 30, T.power + i / 24)).dark);
      for (let i = 0; i <= 72; i++) glow.push(ROOM.crash({}, K(red, T.glow[1] + i / 24, null)).book.glow);
      return { down, up, glow };
    };
    return { red: run(true), full: run(false), fade: T.fade };
  });
  const mono = (a, dir) => a.every((x, i) => i === 0 || (dir > 0 ? x >= a[i - 1] - 1e-9 : x <= a[i - 1] + 1e-9));
  expect(mono(d.red.down, +1), `reduced: dark only rises ${d.red.down}`).toBe(true);
  expect(d.red.down.at(-1)).toBeCloseTo(1, 5);
  expect(mono(d.red.up, -1), `reduced: dark only falls ${d.red.up}`).toBe(true);
  expect(d.red.up.at(-1)).toBeCloseTo(0, 5);
  expect(new Set(d.red.glow.map(x => x.toFixed(4))).size, 'reduced: no glow pulse').toBe(1);
  // the full-motion variants really are different (else this test proves nothing)
  expect(mono(d.full.down, +1), 'full motion: the .85/.3/1 flicker').toBe(false);
  expect(mono(d.full.up, -1), 'full motion: the .35/.8 flicker').toBe(false);
  expect(new Set(d.full.glow.map(x => x.toFixed(4))).size).toBeGreaterThan(1);
  // a play-through: rail to stage 5, a crash through the drawn plug (hotspot) and back, then to the end
  await needStory(page);
  await startWith(page, 'Zoë');
  await railTo(page, 5);
  await advance(page, 1);
  const hotPlug = page.locator('#hotspots .hot[data-act="plug"]');
  await expect(hotPlug).toHaveCount(1);
  await hotPlug.click(); await sync(page);
  expect((await state(page)).crashes.length).toBe(1);
  await until(page, { phase: 'dark' }, 3);
  await page.locator('#hotspots .hot[data-act="unplug"]').click(); await sync(page);
  await until(page, { phase: 'on' }, 15);
  const r = await playToEnd(page);
  expect(r.ok).toBe(true);
  expect(r.state.world).toMatchObject({ refunds: 1, emails: 1, refundRuns: 1 });
  expect(r.state.settings.reduced).toBe(true);
  expect(await problems(w)).toEqual([]);
});

test('6b the Reduced motion toggle', async ({ page }) => {
  const w = await open(page);
  await startWith(page, 'Zoë');
  const b = page.locator('#btn-reduced');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await b.click(); await sync(page);
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  expect((await state(page)).settings.reduced).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-reduced', 'true');
  expect(await problems(w)).toEqual([]);
});

test('9 sound: no AudioContext before the Sound toggle; running after it', async ({ page }) => {
  await page.addInitScript(() => {
    window.__acs = []; window.__offline = 0;
    for (const k of ['AudioContext', 'webkitAudioContext']) { const C = window[k]; if (!C) continue;
      window[k] = class extends C { constructor(...a) { super(...a); window.__acs.push(this); } }; }
    const O = window.OfflineAudioContext; if (O) window.OfflineAudioContext = class extends O { constructor(...a) { super(...a); window.__offline++; } };
  });
  const w = await watch(page);
  await page.goto(MAP);                                   // live mode: rAF runs, the shop plays its sounds (silently)
  await ready(page);
  await startWith(page, 'Zoë');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => [window.__acs.length, window.__offline])).toEqual([0, 0]);
  const b = page.locator('#btn-sound');
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__acs.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__acs[0].state), { timeout: 5000 }).toBe('running');
  await page.waitForTimeout(500);
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__acs.length), 'one context, reused').toBe(1);
  expect(await problems(w)).toEqual([]);
});
