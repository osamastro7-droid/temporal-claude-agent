// Keyboard only (GAME_SPEC §10 browser spec 5; keys and focus rules in §2 "Input and accessibility"): the
// whole game with real key presses (Tab, typing, Enter on the focused button, A, P); focus is always visible
// and never falls to <body>. Time moves through window.__game.advance (?test=1).
import { test, expect } from '@playwright/test';
import { open, problems, needStory, state, view, advance, sync, startWith, railTo, until } from './helpers.mjs';

/** Where the focus is, and whether it shows (:focus-visible with a real outline). */
const focusNow = page => page.evaluate(() => {
  const a = document.activeElement, cs = a ? getComputedStyle(a) : null;
  return { id: a ? a.id || a.tagName : null, body: !a || a === document.body || a === document.documentElement,
    visible: !!a && a.matches(':focus-visible'), outline: !!cs && ((cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none') };
});

test('5 keyboard only: the whole game; focus always visible, never on <body>', async ({ page }) => {
  test.setTimeout(180000);
  const w = await open(page);
  await needStory(page);
  for (let i = 0; i < 20 && (await focusNow(page)).id !== 'name-input'; i++) await page.keyboard.press('Tab');
  expect((await focusNow(page)).id, 'Tab reaches the name input').toBe('name-input');
  await page.keyboard.type('Zoë');
  await page.keyboard.press('Enter');
  await sync(page);
  let s = await state(page);
  expect(s.scene).toBe('shop');
  const bad = [];
  let crashed = false, keys = 0;
  for (let i = 0; i < 1600; i++) {
    s = await state(page);
    if (s.scene === 'end') break;
    const f = await focusNow(page);
    if (f.body || !f.visible || !f.outline) bad.push(`${s.beat.id} q ${s.q}: ${JSON.stringify(f)}`);
    const v = await view(page);
    // P pulls the plug in stage 5 and P plugs it back in while dark (this regressed once)
    if (!crashed && s.stage === 5 && s.scene === 'room' && s.worker.phase === 'on' && v.plug.ok) {
      await page.keyboard.press('p'); await sync(page);
      expect((await state(page)).worker.phase).toBe('pulling');
      await until(page, { phase: 'dark' }, 3);
      await page.keyboard.press('p'); await sync(page);
      expect((await state(page)).worker.phase, 'P while dark brings the power back').toBe('pushing');
      await until(page, { phase: 'on' }, 15);
      crashed = true; continue;
    }
    const a = v.action;
    if (a.act && a.enabled && s.worker.phase === 'on') {
      if (a.act === 'approve') await page.keyboard.press('a');
      else { expect(f.id, `focus on the action button for ${a.act}`).toBe('btn-action'); await page.keyboard.press('Enter'); }
      keys++; await sync(page); continue;
    }
    await advance(page, .5);
  }
  expect(s.scene, 'the game can be completed with the keyboard').toBe('end');
  expect(crashed).toBe(true);
  expect(keys).toBeGreaterThanOrEqual(5);                              // buy, pay, refund, submit, approve (at least)
  expect(bad, bad.slice(0, 5).join('\n')).toEqual([]);
  expect(s.world).toMatchObject({ refunds: 1, emails: 1 });
  // the end card: focus on Play again; Enter plays again with the same name
  expect((await focusNow(page)).id).toBe('btn-again');
  await page.keyboard.press('Enter'); await sync(page);
  s = await state(page);
  expect(s).toMatchObject({ scene: 'shop', name: 'Zoë' });
  expect((await focusNow(page)).id).toBe('btn-action');
  expect(await problems(w)).toEqual([]);
});

test('5b while dark, a click on the plug button and the P key both bring the power back', async ({ page }) => {
  test.setTimeout(90000);
  const w = await open(page);
  await needStory(page);
  await startWith(page, 'Zoë');
  await railTo(page, 5);
  for (const how of ['click', 'key']) {
    await advance(page, .5);
    await page.locator('#btn-plug').click(); await sync(page);
    await until(page, { phase: 'dark' }, 3);
    await expect(page.locator('#btn-plug')).toHaveAttribute('aria-pressed', 'true');
    if (how === 'click') await page.locator('#btn-plug').click(); else { await page.locator('#btn-plug').focus(); await page.keyboard.press('p'); }
    await sync(page);
    expect((await state(page)).worker.phase, `${how} while dark`).toBe('pushing');
    await until(page, { phase: 'on' }, 15);
  }
  expect((await state(page)).crashes.length).toBe(2);
  expect(await problems(w)).toEqual([]);
});

test('5c R rejects at the approval; letters are ignored while the name input has focus', async ({ page }) => {
  test.setTimeout(90000);
  const w = await open(page);
  await page.locator('#name-input').focus();
  await page.keyboard.type('Rap');                                      // R, A, P typed as letters, not as keys
  await sync(page);
  await expect(page.locator('#name-input')).toHaveValue('Rap');
  let s = await state(page);
  expect(s).toMatchObject({ scene: 'start', crashes: [] });
  await needStory(page);
  await page.keyboard.press('Enter'); await sync(page);
  await railTo(page, 6);
  for (let i = 0; i < 120; i++) { const v = await view(page); if (v.action.act === 'approve' && v.action.enabled) break; await advance(page, .5); }
  await page.keyboard.press('r'); await sync(page);
  s = await state(page);
  expect(s.approval.decision).toBe('reject');
  expect(await problems(w)).toEqual([]);
});
