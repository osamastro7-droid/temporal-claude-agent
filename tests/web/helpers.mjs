// Shared helpers for the browser specs (GAME_SPEC §10 "Browser specs"): every test collects page errors,
// console errors, CSP violations and all requests, and fails on any request outside /temporal-claude-agent/map/
// (data: URLs excepted).
export const MAP = '/temporal-claude-agent/map/';

// Playwright's own screenshot code injects a <style> (caret / animation control). The page's CSP blocks it,
// and WebKit reports that as a console error and a securitypolicyviolation (Chromium does not). It is not a
// page problem, so exactly that report is ignored WHILE w.screenshot() runs, and nowhere else.
const PW_SHOT_STYLE = /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/;
const PW_SHOT_CSP = /^style-src(-elem)? inline$/;

/**
 * Start watching a page (call before goto).
 * @returns {Promise<{errors, csp, external, requests, ignored, finish(), screenshot(opts)}>}
 *   Specs take screenshots with w.screenshot(opts) (same options as page.screenshot), never page.screenshot.
 */
export async function watch(page) {
  const w = { errors: [], csp: [], external: [], requests: [], ignored: [], shooting: 0 };
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('pageerror', e => w.errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text(); if (w.shooting && PW_SHOT_STYLE.test(t)) { w.ignored.push(t); return; }
    w.errors.push('console: ' + t);
  });
  page.on('request', r => {
    const u = r.url(); w.requests.push(u);
    if (u.startsWith('data:')) return;
    const p = new URL(u);
    if (!['127.0.0.1', 'localhost'].includes(p.hostname) || !p.pathname.startsWith(MAP)) w.external.push(u);
  });
  w.finish = async () => { try { w.csp.push(...await page.evaluate(() => window.__csp || [])); } catch (e) { /* page gone */ } return w; };
  w.screenshot = async opts => {
    w.shooting++;
    const n0 = await page.evaluate(() => (window.__csp || []).length);
    try { return await page.screenshot(opts); }
    finally {
      // let the report reach us (console events arrive before this round trip returns), then drop only the
      // violations the screenshot itself caused
      const dropped = await page.evaluate(([n, re]) => { const r = new RegExp(re), all = window.__csp || [], tail = all.splice(n);
        const keep = tail.filter(v => !r.test(v)); all.push(...keep); return tail.length - keep.length; }, [n0, PW_SHOT_CSP.source]);
      if (dropped) w.ignored.push(`${dropped} screenshot style-src violation(s)`);
      w.shooting--;
    }
  };
  return w;
}

/** Wait for runtime.js to be up. */
export async function ready(page) {
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 30000 });
}

// ================================================================================================
// Game drivers (GAME_SPEC §10 browser specs 1-10). Players act through the real controls (#btn-action,
// #btn-alt, #btn-plug, the rail chips, the name form, keys); window.__game only moves time (?test=1:
// advance) and reads state. Beat ids are never hard-coded: targets come from STORY's own beat data
// (stageChain below), so the specs follow whatever beats the story builder writes.
// ================================================================================================
import fs from 'node:fs';
import { expect } from '@playwright/test';

const fixture = f => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
export const HISTORY_APPROVED = fixture('history-approved.json');
export const HISTORY_REJECTED = fixture('history-rejected.json');
/** The fixture's events for a player slug: [{text, stage}] (<slug> filled in). */
export const expectedEvents = (fx, slug) => fx.events.map(e => ({ text: e.text.split(fx.slugPlaceholder).join(slug), stage: e.stage }));
/** A retry line (fixture 'retry.text'): what = 'Claude step 1' | 'look_up_order' | ..., n = the attempt. */
export const retryLine = (what, n = 2) => HISTORY_APPROVED.retry.text.replace('{what}', what).replace('{n}', String(n));
/** Is this event text a retry line? */
export const isRetry = t => / started again \(attempt \d+\)$/.test(t);

/** watch + goto + ready. query: '?test=1' (default) etc. */
export async function open(page, query = '?test=1') {
  const w = await watch(page);
  await page.goto(MAP + query);
  await ready(page);
  return w;
}
/** Everything a clean page must not have: errors, CSP violations, requests off /map/. */
export async function problems(w) { const r = await w.finish(); return [...r.errors, ...r.csp, ...r.external]; }

export const state = page => page.evaluate(() => window.__game.state());
export const view = page => page.evaluate(() => window.__game.view());
export const advance = (page, sec) => page.evaluate(s => window.__game.advance(s), sec);
/** Sync the DOM with G without moving time (after a real click in ?test=1, where there is no rAF). */
export const sync = page => advance(page, 0);

/** Type a name into the real form and press the real Start button. */
export async function startWith(page, name) {
  await page.locator('#name-input').fill(name);
  await page.locator('#name-start').click();
  await sync(page);
}
/** Jump to the start of stage k with the real rail chip (needs a name: start first). */
export async function railTo(page, k) {
  await page.locator(`#rail button[data-k="${k}"]`).click();
  await sync(page);
  const s = await state(page);
  expect(s.stage, `rail chip ${k} jumps to stage ${k}`).toBe(k);
  return s;
}
/**
 * Advance in 1/24 s steps until the state matches spec, in one page.evaluate. spec keys: phase (worker.phase),
 * 'world.<k>' (>= value), 'book.<row>.<part>' (=== value), any other top-level G key (===). @returns the state
 */
export async function until(page, spec, maxSec = 10) {
  const s = await page.evaluate(([sp, max]) => {
    const g = window.__game, ok = s => Object.entries(sp).every(([k, v]) => {
      if (k === 'phase') return s.worker.phase === v;
      if (k.startsWith('world.')) return s.world[k.slice(6)] >= v;
      if (k.startsWith('book.')) { const [, r, p] = k.split('.'); return s.book[+r][p] === v; }
      return s[k] === v; });
    for (let i = 0; i <= max * 24; i++) { const s = g.state(); if (ok(s)) return s; g.advance(1 / 24); }
    return null;
  }, [spec, maxSec]);
  if (!s) throw new Error(`not reached within ${maxSec} s: ${JSON.stringify(spec)}`);
  return s;
}

/**
 * Walk STORY's beats for stage k from STORY.canon(k), on a scratch copy of G (the real game is not touched):
 * [{id, t0, dur, scene, hold, noPlug, commits: [{t, row, part, abs}], events: [{t, abs, world, logged}]}]
 * t0 / abs = seconds from the start of the stage along an uncrashed approve play (a hold counts 0 s).
 * events[].world = the world after that event when it changed it (finds t_m: world.refunds 0 -> 1).
 */
export const stageChain = (page, k) => page.evaluate(k => {
  const g = STORY.canon(k, window.__game.state()), out = []; let id = g.beat.id, t = 0;
  for (let i = 0; i < 40 && id; i++) {
    const b = STORY.beat(id); if (!b || b.stage !== k) break;
    const dur = STORY.durOf(b, g);
    const commits = (b.commit ? [].concat(b.commit) : []).map(c => ({ t: c.t, row: c.row, part: c.part, abs: t + c.t }));
    const events = [];
    for (const [et, fn] of b.events ?? []) { const w0 = JSON.stringify(g.world), n0 = g.events.length; fn(g);
      events.push({ t: et, abs: t + et, world: JSON.stringify(g.world) !== w0 ? { ...g.world } : null, logged: g.events.slice(n0).map(e => e.text) }); }
    for (const c of commits) g.book[c.row][c.part] = 1;
    out.push({ id, t0: t, dur, scene: b.scene, hold: b.hold ? b.hold.action : null, noPlug: b.noPlug ?? null, commits, events });
    if (b.hold && b.hold.action === 'approve') { g.approval.decision = 'approve'; g.branch = 'approve'; }
    t += dur; const nx = b.next(g); if (!nx || nx === id) break; id = nx;
  }
  return out;
}, k);
/** The (beat, q) at `abs` seconds into a stage chain (the last beat that has started by then). */
export function locate(chain, abs) {
  let hit = chain[0];
  for (const b of chain) if (b.t0 <= abs + 1e-9) hit = b;
  return { id: hit.id, q: Math.max(0, abs - hit.t0) };
}
/** The commit of (row, part) in a chain, or null. */
export const commitOf = (chain, row, part) => chain.flatMap(b => b.commits).find(c => c.row === row && c.part === part) ?? null;

/**
 * Play from the current beat until beat `id` reaches q (whole beats at a time, then the rest). A hold on
 * the way: 'approve' is pressed for real (DOM click on #btn-action), any other hold is an error.
 */
export async function playTo(page, id, q) {
  q = Math.ceil(q * 24 - 1e-6) / 24;                                   // q lives on the 1/24 s grid (the first drawing at or after q)
  for (let i = 0; i < 400; i++) {
    const s = await state(page);
    if (s.beat.id === id && s.q + 1e-9 >= q) return s;
    if (s.beat.id === id) { await advance(page, Math.max(1 / 24, q - s.q)); continue; }
    const v = await view(page);
    if (s.hold && v.action.act === 'approve' && v.action.enabled) { await page.locator('#btn-action').click(); await sync(page); continue; }
    if (s.hold) throw new Error(`playTo(${id}, ${q}): stuck at the hold of ${s.beat.id} (${v.action.act})`);
    const rem = await page.evaluate(s => STORY.durOf(STORY.beat(s.beat.id), s) - s.q, s);
    await advance(page, Math.max(rem, 1 / 24));
  }
  throw new Error(`playTo(${id}, ${q}): not reached`);
}

/**
 * Play on to the end card through the real controls: whenever the action button is live it is pressed
 * (a DOM click on #btn-action, or #btn-alt for Reject at the approval). One page.evaluate, so a whole play
 * costs one round trip. @returns {{ok, steps, state}}
 */
export const playToEnd = (page, decide = 'approve', maxSec = 400) => page.evaluate(([decide, maxSec]) => {
  const g = window.__game, $ = id => document.getElementById(id);
  for (let i = 0; i < maxSec * 2; i++) {
    const s = g.state(); if (s.scene === 'end') return { ok: true, steps: i, state: s };
    const a = g.view().action;
    if (a.act && a.enabled && s.worker.phase === 'on') {
      const b = a.act === 'approve' && decide === 'reject' ? $('btn-alt') : $('btn-action');
      if (b.getAttribute('aria-disabled') !== 'true') { b.click(); g.advance(0); continue; }
    }
    g.advance(.5);
  }
  return { ok: false, steps: maxSec * 2, state: g.state() };
}, [decide, maxSec]);

/**
 * One crash through the real plug button: click #btn-plug, wait for the dark, click it again (Plug it
 * back in), follow the recovery through the notes close-up until the worker is on again.
 * opts.unplug: 'click' (default) | 'key' (press P while dark); opts.replugWhileWaking: a second crash while he wakes;
 * opts.darkSec: a slow re-plug, the room stays dark this many seconds (1/24 s steps, each one drawn) first.
 * @returns {{atClick, dark, pushing, notes, N, on, T}}  G copies at each point; N = STORY.notes near the
 *   end of the close-up (rows, under, ring, arrow); T = ROOM.CRASH_T
 */
export async function crash(page, opts = {}) {
  const T = await page.evaluate(() => ROOM.CRASH_T);
  const plug = page.locator('#btn-plug');
  await expect(plug, 'the plug is live before the crash').toHaveAttribute('aria-disabled', 'false');
  await plug.click(); await sync(page);
  const atClick = await state(page);
  const dark = await until(page, { phase: 'dark' }, 3);
  await expect(plug).toHaveText(await page.evaluate(() => CONTENT.html.buttons.unplug));
  await expect(plug).toHaveAttribute('aria-disabled', 'false');
  if (opts.darkSec) {
    await page.evaluate(sec => { for (let i = 0; i < Math.round(sec * 24); i++) window.__game.advance(1 / 24); }, opts.darkSec);
    expect((await state(page)).worker.phase, 'the room stays dark until it is plugged back in').toBe('dark');
    await expect(plug).toHaveAttribute('aria-disabled', 'false');
  }
  if (opts.unplug === 'key') await page.keyboard.press('p'); else await plug.click();
  await sync(page);
  const pushing = await state(page);
  let rewake = null;
  if (opts.replugWhileWaking) {
    await until(page, { phase: 'waking' }, T.power + 1);
    await expect(plug, 'the plug is live while he wakes').toHaveAttribute('aria-disabled', 'false');
    await plug.click(); await sync(page);
    rewake = await state(page);
    await until(page, { phase: 'dark' }, 3);
    await plug.click(); await sync(page);
  }
  const notes = await until(page, { scene: 'notes' }, T.insert[0] + 2);
  await expect(plug, 'no plug during the close-up').toHaveAttribute('aria-disabled', 'true');
  const N = await page.evaluate(([s, t]) => STORY.notes(s, t), [notes, T.insert[1] - T.insert[0] - .1]);
  const on = await until(page, { phase: 'on' }, T.done + 2);
  return { atClick, dark, pushing, rewake, notes, N, on, T };
}

/** Sample a beat's R over its length (every 1/12 s) with the current G: [{q, pose, held, drawer, folder, e, led, wait}] */
export const sampleBeat = (page, id) => page.evaluate(id => {
  const s = window.__game.state(), b = STORY.beat(id); if (!b) return [];
  const out = [], d = Math.min(STORY.durOf(b, s), 30);
  for (let q = 0; q <= d + 1e-9; q += 1 / 12) { const R = b.R(s, Math.floor(q * 24 + 1e-9) / 24) ?? {};
    out.push({ q, pose: typeof R.pose === 'string' ? R.pose : R.pose ? `${R.pose.from}>${R.pose.to}` : null, held: R.held ?? null, drawer: R.drawer ?? null, folder: R.folder ?? null,
      e: R.receipt ? R.receipt.e : null, led: R.led ?? null, wait: R.wait ? R.wait.which : null }); }
  return out;
}, id);
