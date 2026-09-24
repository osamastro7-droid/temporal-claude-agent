// Keyboard only (GAME_SPEC §10 browser spec 5; keys and focus rules in §2 "Input and accessibility"): the
// whole game with real key presses only (Tab / Shift+Tab to move, typing, Enter or Space on the focused button,
// A, R, P); no mouse, no element.focus(). Focus is always visible and never falls to <body>.
// The plug is used both ways: the focused #btn-plug (Enter / Space) and the P key, each also while dark.
// Time moves through window.__game.advance (?test=1).
import { test, expect } from '@playwright/test';
import { open, problems, state, view, advance, sync, until, railTo } from './helpers.mjs';

/** Where the focus is, and whether it shows (:focus-visible with a real outline). */
const focusNow = page => page.evaluate(() => {
  const a = document.activeElement, cs = a ? getComputedStyle(a) : null;
  return { id: a ? a.id || a.tagName : null, body: !a || a === document.body || a === document.documentElement,
    visible: !!a && a.matches(':focus-visible'), outline: !!cs && ((cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none') };
});

/**
 * Move the focus to the control matching `sel` with real Tab / Shift+Tab presses (the direction from the DOM
 * order), checking at every stop that the focus shows and is not on <body>. @returns {string[]} problems seen
 */
async function tabTo(page, sel, max = 40) {
  const bad = [];
  for (let i = 0; i < max; i++) {
    const o = await page.evaluate(sel => { const a = document.activeElement, t = document.querySelector(sel);
      if (!t) return { missing: true };
      const on = !!a && a.matches(sel), back = !!a && a !== document.body && !!(t.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { on, back }; }, sel);
    if (o.missing) throw new Error(`tabTo: no ${sel}`);
    if (o.on) return bad;
    await page.keyboard.press(o.back ? 'Shift+Tab' : 'Tab');
    const f = await focusNow(page);
    if (f.body || !f.visible || !f.outline) bad.push(`tabbing to ${sel}: ${JSON.stringify(f)}`);
  }
  throw new Error(`tabTo(${sel}): not reached in ${max} presses`);
}

test('5 keyboard only: the whole game; #btn-plug and P, also while dark; focus always visible, never on <body>', async ({ page }) => {
  test.setTimeout(240000);
  const w = await open(page);
  const bad = [];
  bad.push(...await tabTo(page, '#name-input'));
  await page.keyboard.type('Zoë');
  await page.keyboard.press('Enter');                                  // submits the form (Start)
  await sync(page);
  let s = await state(page);
  expect(s).toMatchObject({ scene: 'shop', name: 'Zoë' });
  const crashes = [];                                                  // how each crash was pulled / pushed
  let keys = 0;
  for (let i = 0; i < 2400; i++) {
    s = await state(page);
    if (s.scene === 'end') break;
    const f = await focusNow(page);
    if (f.body || !f.visible || !f.outline) bad.push(`${s.beat.id} q ${s.q}: ${JSON.stringify(f)}`);
    const v = await view(page);
    const room = s.scene === 'room' && s.worker.phase === 'on' && v.plug.ok;
    // crash 1 (stage 5): Tab to the plug button, Enter pulls it; P while dark plugs it back in
    if (!crashes[0] && s.stage === 5 && room) {
      bad.push(...await tabTo(page, '#btn-plug'));
      await page.keyboard.press('Enter'); await sync(page);
      expect((await state(page)).worker.phase, 'Enter on #btn-plug pulls the plug').toBe('pulling');
      await until(page, { phase: 'dark' }, 3);
      await expect(page.locator('#btn-plug')).toHaveAttribute('aria-pressed', 'true');
      expect((await focusNow(page)).id, 'the focus stays on the plug button in the dark').toBe('btn-plug');
      await page.keyboard.press('p'); await sync(page);
      expect((await state(page)).worker.phase, 'P while dark brings the power back').toBe('pushing');
      await until(page, { phase: 'on' }, 15);
      crashes.push('button/P'); continue;
    }
    // crash 2 (stage 7): P pulls it; Tab to the plug button while dark, Space plugs it back in
    if (crashes.length === 1 && s.stage === 7 && room) {
      await page.keyboard.press('p'); await sync(page);
      expect((await state(page)).worker.phase, 'P pulls the plug').toBe('pulling');
      await until(page, { phase: 'dark' }, 3);
      bad.push(...await tabTo(page, '#btn-plug'));
      await page.keyboard.press(' '); await sync(page);
      expect((await state(page)).worker.phase, 'Space on #btn-plug while dark brings the power back').toBe('pushing');
      await until(page, { phase: 'on' }, 15);
      crashes.push('P/button'); continue;
    }
    const a = v.action;
    if (a.act && a.enabled && s.worker.phase === 'on') {
      if (a.act === 'approve') await page.keyboard.press('a');
      else { bad.push(...await tabTo(page, '#btn-action')); await page.keyboard.press('Enter'); }
      keys++; await sync(page); continue;
    }
    await advance(page, .5);
  }
  expect(s.scene, 'the game can be completed with the keyboard').toBe('end');
  expect(crashes).toEqual(['button/P', 'P/button']);
  expect(keys).toBeGreaterThanOrEqual(5);                              // buy, pay, refund, submit, approve (at least)
  expect(bad, bad.slice(0, 5).join('\n')).toEqual([]);
  expect(s.crashes.map(c => c.stage)).toEqual([5, 7]);
  expect(s.world).toMatchObject({ refunds: 1, emails: 1 });
  // the end card: focus on Play again; Enter plays again with the same name
  expect((await focusNow(page)).id).toBe('btn-again');
  await page.keyboard.press('Enter'); await sync(page);
  s = await state(page);
  expect(s).toMatchObject({ scene: 'shop', name: 'Zoë' });
  expect((await focusNow(page)).id).toBe('btn-action');
  expect(await problems(w)).toEqual([]);
});

test('5b while dark, Enter on the focused plug button and the P key both bring the power back', async ({ page }) => {
  test.setTimeout(90000);
  const w = await open(page);
  await tabTo(page, '#name-input');
  await page.keyboard.type('Zoë'); await page.keyboard.press('Enter'); await sync(page);
  await tabTo(page, '#rail button[data-k="5"]');                        // the rail chip, by keyboard
  await page.keyboard.press('Enter'); await sync(page);
  expect((await state(page)).stage).toBe(5);
  for (const how of ['button', 'key']) {
    await advance(page, .5);
    await tabTo(page, '#btn-plug');
    await page.keyboard.press('Enter'); await sync(page);
    await until(page, { phase: 'dark' }, 3);
    await expect(page.locator('#btn-plug')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#btn-plug')).toHaveAttribute('aria-disabled', 'false');
    await page.keyboard.press(how === 'button' ? 'Enter' : 'p'); await sync(page);
    expect((await state(page)).worker.phase, `${how} while dark`).toBe('pushing');
    await until(page, { phase: 'on' }, 15);
  }
  expect((await state(page)).crashes.length).toBe(2);
  expect(await problems(w)).toEqual([]);
});

test('5c R rejects at the approval; letters are ignored while the name input has focus', async ({ page }) => {
  test.setTimeout(90000);
  const w = await open(page);
  await tabTo(page, '#name-input');
  await page.keyboard.type('Rap');                                      // R, A, P typed as letters, not as keys
  await sync(page);
  await expect(page.locator('#name-input')).toHaveValue('Rap');
  let s = await state(page);
  expect(s).toMatchObject({ scene: 'start', crashes: [] });
  await page.keyboard.press('Enter'); await sync(page);
  await tabTo(page, '#rail button[data-k="6"]');
  await page.keyboard.press('Enter'); await sync(page);
  expect((await state(page)).stage).toBe(6);
  for (let i = 0; i < 120; i++) { const v = await view(page); if (v.action.act === 'approve' && v.action.enabled) break; await advance(page, .5); }
  await page.keyboard.press('r'); await sync(page);
  s = await state(page);
  expect(s.approval.decision).toBe('reject');
  expect(await problems(w)).toEqual([]);
});

/** The focused element's id and whether it shows a ring (:focus-visible), read outside any key listener. */
const focusRing = page => page.evaluate(() => { const a = document.activeElement; return { id: a ? a.id || a.tagName : null, visible: !!a && a.matches(':focus-visible') }; });
/** Advance in .5 s steps until the live action is `act` and enabled. */
async function untilAction(page, act, max = 160) {
  for (let i = 0; i < max; i++) { const v = await view(page); if (v.action.act === act && v.action.enabled) return v; await advance(page, .5); }
  throw new Error(`action ${act} never became live`);
}

// Regression for the pointer-moved ("quiet") focus (ui.js moveFocus / refocus): after a MOUSE click on Start,
// the plug or a rail chip, ui.js puts the focus on #btn-action without a ring; the player did not choose it,
// so Space pauses and Enter does not press the approval behind the dark. The end card's #btn-again is the
// player's next step, so Space there plays again. Real mouse clicks (page.locator().click()) and real keys only.
// The two key checks are soft so one run reports both (the play goes on either way).
test('5d mouse, then keys: focus ui.js moved after a click does not press what the player did not choose', async ({ page }) => {
  test.setTimeout(180000);
  const w = await open(page);
  await page.locator('#name-input').fill('Zoë');
  await page.locator('#name-start').click(); await sync(page);          // Start with the mouse
  let s = await state(page);
  expect(s).toMatchObject({ scene: 'shop', name: 'Zoë' });
  expect(await focusRing(page), 'after a mouse Start: focus on the action button, no ring').toEqual({ id: 'btn-action', visible: false });
  // Space on that focus pauses (the legend), it does not press Buy
  await untilAction(page, 'buy');
  const before = await state(page);
  await page.keyboard.press(' '); await sync(page);
  s = await state(page);
  expect(s.settings.paused, 'Space pauses').toBe(true);
  expect({ id: s.beat.id, q: s.q }, 'Space did not press Buy').toEqual({ id: before.beat.id, q: before.q });
  await page.keyboard.press(' '); await sync(page);
  expect((await state(page)).settings.paused, 'Space again plays on').toBe(false);
  // the rail chip with the mouse: back on the action button, no ring
  await railTo(page, 6);
  expect(await focusRing(page), 'after a mouse rail click').toEqual({ id: 'btn-action', visible: false });
  await untilAction(page, 'approve');
  // the plug with the mouse at the approval: Enter in the dark must not queue Approve (the player did not choose it)
  const plug = page.locator('#btn-plug');
  await plug.click(); await sync(page);
  expect(await focusRing(page), 'after a mouse plug click').toEqual({ id: 'btn-action', visible: false });
  await until(page, { phase: 'dark' }, 3);
  await page.keyboard.press('Enter'); await sync(page);
  expect.soft((await state(page)).approval.queued, 'Enter on the quiet focus in the dark queues nothing').toBeNull();
  await page.keyboard.press('a'); await sync(page);
  expect((await state(page)).approval.queued, 'A queues Approve in the dark').toBe('approve');
  // plug it back in with the mouse, then play to the end with the mouse (real clicks on any live action)
  await plug.click(); await sync(page);
  await until(page, { phase: 'on' }, 30);
  for (let i = 0; i < 800; i++) {
    s = await state(page);
    if (s.scene === 'end') break;
    const v = await view(page);
    if (v.action.act && v.action.enabled && s.worker.phase === 'on') { await page.locator('#btn-action').click(); await sync(page); continue; }
    await advance(page, .5);
  }
  expect(s.scene, 'reached the end card').toBe('end');
  expect(s).toMatchObject({ branch: 'approve', world: { refunds: 1, emails: 1 } });
  expect((await focusRing(page)).id, 'the end card focuses Play again').toBe('btn-again');
  // Space on Play again plays again (the end card's next step), even though the last input was the mouse
  await page.keyboard.press(' '); await sync(page);
  s = await state(page);
  expect.soft(s, 'Space on #btn-again plays again').toMatchObject({ scene: 'shop', name: 'Zoë' });
  expect(await problems(w)).toEqual([]);
});
