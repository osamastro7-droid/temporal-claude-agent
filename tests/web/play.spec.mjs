// Play-throughs (GAME_SPEC §10 browser specs 1, 3, 6, 9): the full approve play through the real controls,
// the reject path, reduced motion and sound. Time moves through window.__game.advance (?test=1).
import { test, expect } from '@playwright/test';
import { MAP, watch, ready, open, problems, state, view, advance, sync, startWith, railTo, playToEnd, until,
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
  await startWith(page, 'Zoë');
  let s = await state(page);
  expect(s).toMatchObject({ scene: 'shop', stage: 0, name: 'Zoë', drawnName: 'Zoë', nameMode: 'font', slug: 'zoe' });
  const scenes = [], stages = [], captions = [], plugBad = [], hot = [];
  // the room is still being drawn until the notebook exists (STORY.TIMES.s1.book[1]): the plug is refused then ('plugBuild')
  const bookDrawn = await page.evaluate(() => STORY.TIMES.s1.book[1]);
  let building = 0, endStatus = null;
  for (let i = 0; i < 1600; i++) {
    // one round trip: the state, the view model and what the DOM shows
    const o = await page.evaluate(() => { const b = document.getElementById('btn-plug'), g = window.__game;
      return { s: g.state(), v: g.view(), plugOff: b.getAttribute('aria-disabled') === 'true', whyPlug: document.getElementById('why-plug').textContent,
        status: document.getElementById('status').textContent,
        hot: [...document.querySelectorAll('#hotspots .hot')].map(h => { const r = h.getBoundingClientRect(); return { act: h.dataset.act, w: r.width, h: r.height, hidden: h.getAttribute('aria-hidden'), tab: h.tabIndex }; }) }; });
    s = o.s;
    if (scenes.at(-1) !== s.scene) scenes.push(s.scene);
    if (s.scene !== 'end' && stages.at(-1) !== s.stage) stages.push(s.stage);
    if (s.scene === 'end') { endStatus = o.status; break; }   // the end card's own words (not a caption) are announced there too
    if (o.status && captions.at(-1) !== o.status) captions.push(o.status);
    hot.push(...o.hot);
    // the plug (GAME_SPEC §4, end of the crash sequence): never in the shop or the wide shot; always in the
    // room while the worker is on (stages 1-9); disabled buttons say why, in text
    if (['shop', 'wide', 'start', 'mail'].includes(s.scene) && (o.v.plug.ok || !o.plugOff)) plugBad.push(`plug live in ${s.scene} (${s.beat.id})`);
    const drawing = s.beat.id === 's1.build' && s.q < bookDrawn;
    if (drawing && !o.v.plug.ok) { building++; if (o.v.plug.reason !== 'plugBuild') plugBad.push(`plug dead while the room is drawn, reason ${o.v.plug.reason} (q ${s.q})`); }
    if (s.scene === 'room' && s.worker.phase === 'on' && s.stage >= 1 && !drawing && !o.v.plug.ok) plugBad.push(`plug dead in the room (${s.beat.id} q ${s.q})`);
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
  expect(building, 'the plug waits while the room is drawn (s1.build before the notebook)').toBeGreaterThan(0);
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
  // the drawn end card is read out by the status region: "The refund happened once." and the name (GAME_SPEC §4, §2 "Screen readers")
  expect(endStatus).toContain('The refund happened once.');
  expect(endStatus).toContain('Zoë');
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
  // the exact final answer (fixture: facts.md, the rejected run's Claude step 3), in the state and in the panel
  const answer = want.find(e => /^Claude step 3 done: "/.test(e.text)).text;
  expect(s.events.some(e => e.text === answer), answer).toBe(true);
  await expect(page.locator('#p-history li')).toHaveText(want.map(e => e.text));
  expect(s.world).toMatchObject({ refunds: 0, refundRuns: 0, emails: 0, emailRuns: 0 });
  // GAME_SPEC §4 "The Reject branch": row 2's text struck, row 3 'rejected' (text and check), row 4 'done'
  expect(s.book).toEqual([FULL, FULL, { t: 1, c: 0, strike: 1 }, FULL, FULL, { t: 0, c: 0, strike: 0 }]);
  const labels = await page.evaluate(() => STORY.rowLabels('reject'));
  expect(labels.slice(3, 5)).toEqual(['rejected', 'done']);
  expect(await problems(w)).toEqual([]);
});

// ---- 6 reduced motion (GAME_SPEC §2 "Reduced motion": no dark flicker (a plain fade), no camera push (a cut),
// instant page changes, no stamp speed lines, no shake, no glow pulse). A spy wraps ROOM.frame / ROOM.notes /
// SHOP.frame (property wrappers installed after load; runtime.js looks them up on every draw) and records what
// each real drawing was given. The play: the whole game from the shop, time in 1/24 s steps (every drawing),
// the real buttons (#btn-action, the plug), one crash in stage 5 held dark for 3 s (the glow's 1.5 s pulse), the
// approval and its stamp in stage 6. The same run in full motion is the control: every check must see motion
// there, else it proves nothing. The game has no shake to check (nothing in docs/map draws one).
const motionRun = page => page.evaluate(() => {
  const L = [], wrap = (o, k, kind) => { const f = o[k]; o[k] = function (c, V, ...r) {
    const n = V && V.notes;
    L.push({ kind, dark: V && typeof V.dark === 'number' ? V.dark : null, glow: V && V.book && typeof V.book.glow === 'number' ? V.book.glow : null,
      pulse: n && n.arrow ? n.arrow.pulse : null, stamp: V && V.stamp ? { k: V.stamp.k, hover: !!V.stamp.hover } : null,
      film: V && V.film ? { act: V.film.act, tau: V.film.tau } : null, slide: V && V.screen ? V.screen.slide ?? 0 : null });
    return f.call(this, c, V, ...r); }; return () => { o[k] = f; }; };
  const undo = [wrap(ROOM, 'frame', 'room'), wrap(ROOM, 'notes', 'notes'), wrap(SHOP, 'frame', 'shop')];
  const g = window.__game, $ = id => document.getElementById(id), step = 1 / 24;
  let crashed = false, darkAt = null, s;
  try {
    for (let i = 0; i < 24 * 600; i++) {
      s = g.state(); if (s.scene === 'end') break;
      const v = g.view(), a = v.action;
      if (!crashed && s.stage === 5 && s.scene === 'room' && s.worker.phase === 'on' && v.plug.ok && s.q > .5) { $('btn-plug').click(); g.advance(0); crashed = true; continue; }
      if (s.worker.phase === 'dark' && darkAt === null) darkAt = s.clock;
      if (s.worker.phase === 'dark' && s.clock - darkAt >= 3) { $('btn-plug').click(); g.advance(0); continue; }
      if (a.act && a.enabled && s.worker.phase === 'on' && $('btn-action').getAttribute('aria-disabled') !== 'true') { $('btn-action').click(); g.advance(0); continue; }
      g.advance(step);
    }
  } finally { undo.forEach(u => u()); }
  // the a3 camera push (shop.js a3Cut: T.push = [p0, p0 + .72], p0 = the act's second whoosh - .2)
  const wh = SCENES.find(x => x.key === 'a3').cues.filter(k => k.type === 'whoosh')[1], p0 = wh.t - .2, cut = p0 + .72;
  const turns = a => { let n = 0, d0 = 0; for (let i = 1; i < a.length; i++) { const d = Math.sign(+(a[i] - a[i - 1]).toFixed(6)); if (d && d0 && d !== d0) n++; if (d) d0 = d; } return n; };
  const room = L.filter(x => x.kind === 'room'), darkSeq = room.map(x => x.dark ?? 0), glowSeq = room.filter(x => x.dark === 1 && x.glow !== null).map(x => x.glow);
  return { end: s.scene, crashes: s.crashes.length, world: s.world, reduced: s.settings.reduced, draws: L.length,
    darkTurns: turns(darkSeq), darkMax: Math.max(...darkSeq), glowTurns: turns(glowSeq), glowN: glowSeq.length,
    pulses: [...new Set(L.filter(x => x.pulse !== null).map(x => +x.pulse.toFixed(4)))],
    streaks: [...new Set(L.filter(x => x.stamp && !x.stamp.hover && (x.stamp.k < ROOM.STAMP_K.impact || x.stamp.k >= ROOM.STAMP_K.lift + 2)).map(x => x.stamp.k))],
    stamps: L.filter(x => x.stamp).length,
    push: L.filter(x => x.film && x.film.act === 'a3' && x.film.tau > p0 + 1 / 48 && x.film.tau < cut - 1 / 48).map(x => +x.film.tau.toFixed(3)),
    a3: L.filter(x => x.film && x.film.act === 'a3').length,
    slides: L.filter(x => x.slide !== null && x.slide > 0).length, live: L.filter(x => x.slide !== null).length };
});
/** The reduced-motion checks on a motionRun result (m.reduced true) or the control (false: each must see motion). */
function checkMotion(m, reduced) {
  expect(m.end, 'reached the end card').toBe('end');
  expect(m.crashes).toBe(1);
  expect(m.world).toMatchObject({ refunds: 1, emails: 1, refundRuns: 1 });
  expect(m.reduced).toBe(reduced);
  expect(m.darkMax, 'the room went dark').toBe(1);
  expect(m.glowN, 'glow sampled in the dark').toBeGreaterThan(48);
  expect(m.pulses.length, 'the close-up arrow was drawn').toBeGreaterThan(0);
  expect(m.stamps, 'the stamp was drawn').toBeGreaterThan(0);
  expect(m.a3, 'the wide shot was drawn').toBeGreaterThan(0);
  expect(m.live, 'shop screens were drawn').toBeGreaterThan(0);
  // soft: every reduced variant is reported, not only the first one missing
  if (reduced) {
    expect.soft(m.darkTurns, `a plain fade in and out: dark only rises, then only falls`).toBe(1);
    expect.soft(m.glowTurns, `no glow pulse`).toBe(0);
    expect.soft(m.pulses, `no pulsing arrow in the close-up`).toEqual([.5]);
    expect.soft(m.streaks, `no stamp speed lines: the drawings with streaks (a8 k < impact) or trails (k >= lift + 2) are not drawn`).toEqual([]);
    expect.soft(m.push, `no camera push: the wide shot cuts over a3's push`).toEqual([]);
    expect.soft(m.slides, `instant page changes: no page slides on the drawn shop screens`).toBe(0);
  } else {
    expect(m.darkTurns, 'control: the .85/.3/1 steps and the .35/.8 flicker').toBeGreaterThan(1);
    expect(m.glowTurns, 'control: the glow pulses').toBeGreaterThan(0);
    expect(m.pulses.length, 'control: the arrow pulses').toBeGreaterThan(1);
    expect(m.streaks.length, 'control: the stamp has speed lines').toBeGreaterThan(0);
    expect(m.push.length, 'control: the camera pushes').toBeGreaterThan(0);
    expect(m.slides, 'control: the pages slide').toBeGreaterThan(0);
  }
}

test('6 reduced motion (media query): the crash overlay variants, then a whole play with the reduced variants', async ({ page }) => {
  test.setTimeout(240000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const w = await open(page);
  expect((await state(page)).settings.reduced).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-reduced', 'true');
  // ROOM.crash itself (pure): a plain .3 s fade into the dark (no .85/.3/1 steps), a plain fade back (no .35/.8
  // flicker), no glow pulse; and the full-motion variants really differ
  const d = await page.evaluate(() => {
    const T = ROOM.CRASH_T, K = (red, tc, tu) => ({ phase: tu === null ? (tc < T.out ? 'pulling' : 'dark') : tu < T.power ? 'pushing' : 'waking', t: 0, tc, tu, reduced: red, when: 'after', saved: { wait: true, drawer: true, envelope: true }, rec: null, prev: null, notes: null });
    const run = red => {
      const down = [], up = [], glow = [];
      for (let i = 0; i <= 16; i++) down.push(ROOM.crash({}, K(red, T.spark + i / 24, null)).dark);
      for (let i = 0; i <= 16; i++) up.push(ROOM.crash({}, K(red, 30, T.power + i / 24)).dark);
      for (let i = 0; i <= 72; i++) glow.push(ROOM.crash({}, K(red, T.glow[1] + i / 24, null)).book.glow);
      return { down, up, glow };
    };
    return { red: run(true), full: run(false) };
  });
  const mono = (a, dir) => a.every((x, i) => i === 0 || (dir > 0 ? x >= a[i - 1] - 1e-9 : x <= a[i - 1] + 1e-9));
  expect(mono(d.red.down, +1), `reduced: dark only rises ${d.red.down}`).toBe(true);
  expect(d.red.down.at(-1)).toBeCloseTo(1, 5);
  expect(mono(d.red.up, -1), `reduced: dark only falls ${d.red.up}`).toBe(true);
  expect(d.red.up.at(-1)).toBeCloseTo(0, 5);
  expect(new Set(d.red.glow.map(x => x.toFixed(4))).size, 'reduced: no glow pulse').toBe(1);
  expect(mono(d.full.down, +1), 'full motion: the .85/.3/1 flicker').toBe(false);
  expect(mono(d.full.up, -1), 'full motion: the .35/.8 flicker').toBe(false);
  expect(new Set(d.full.glow.map(x => x.toFixed(4))).size).toBeGreaterThan(1);
  // the play-through, every drawing
  await startWith(page, 'Zoë');
  const m = await motionRun(page);
  test.info().annotations.push({ type: 'motion', description: JSON.stringify(m) });
  checkMotion(m, true);
  expect(await problems(w)).toEqual([]);
});

test('6b reduced motion (the toggle): the Reduced motion button, then a whole play with the reduced variants', async ({ page }) => {
  test.setTimeout(240000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const w = await open(page);
  await startWith(page, 'Zoë');
  const b = page.locator('#btn-reduced');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  expect((await state(page)).settings.reduced).toBe(false);
  await b.click(); await sync(page);
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  expect((await state(page)).settings.reduced).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-reduced', 'true');
  const m = await motionRun(page);
  test.info().annotations.push({ type: 'motion', description: JSON.stringify(m) });
  checkMotion(m, true);
  await expect(b, 'the toggle survives to the end card').toHaveAttribute('aria-pressed', 'true');
  expect(await problems(w)).toEqual([]);
});

test('6c control: the same play in full motion shows every variant the reduced checks look for', async ({ page }) => {
  test.setTimeout(240000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const w = await open(page);
  await startWith(page, 'Zoë');
  const m = await motionRun(page);
  test.info().annotations.push({ type: 'motion', description: JSON.stringify(m) });
  checkMotion(m, false);
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
