// The crash matrix (GAME_SPEC §10 browser spec 2; the rules are GAME_SPEC §3 "Retries", §4 per stage and "The
// crash sequence", facts.md §4). Every case: jump with the real rail chip, play to a moment picked from STORY's
// own beat data (a commit ± 0.3 s; stage 7's t_m / t_c; the approval hold), pull the plug with the real
// #btn-plug, plug it back in with the same button, and follow the recovery through the notes to the end card.
// Asserted: the crash class and the rail's words, what the worker had saved, the recovery beat, the close-up
// rows (with the ring and the arrow), the outcome caption, the retry line in the history, and the runs and
// refunds at the end. Beat ids are never hard-coded.
import { test, expect } from '@playwright/test';
import { open, problems, state, view, advance, sync, startWith, railTo, playTo, playToEnd, crash, until,
  stageChain, locate, commitOf, sampleBeat, HISTORY_APPROVED, expectedEvents, retryLine, isRetry } from './helpers.mjs';

/** book rows from a short form: '11 10' -> [{t:1,c:1,strike:0}, {t:1,c:0,strike:0}, {0,0,0} x 4] */
const B = s => { const r = s.split(' ').filter(Boolean).map(x => ({ t: +x[0], c: +x[1], strike: 0 })); while (r.length < 6) r.push({ t: 0, c: 0, strike: 0 }); return r; };
const RAIL = { crashedBefore: 'crashed before', crashedAfter: 'crashed after' };   // GAME_SPEC §2 "Stage rail"
const W1 = { refunds: 1, refundRuns: 1, emails: 1, emailRuns: 1, lookups: 1 };
const STEP1 = retryLine('Claude step 1');
/** The caption showing now and the queued ones, in order. */
const capIds = s => [...(s.cap.now ? [s.cap.now.id] : []), ...s.cap.queue.map(x => x.id)];

// at: where the plug is pulled.
//   {row, part, d}   the commit of that mark ± d seconds (STORY beat data)
//   {abs} / {fromEnd} seconds from the start / before the end of the stage's beats (a stage with no commit)
//   {tm: d} / {money: true}   stage 7: t_m (world.refunds 0 -> 1) + d / halfway between t_m and t_c
//   {hold: s}        s seconds into the approval hold          {room: true}  the stage's first room beat
// outcome: the caption id (GAME_SPEC §4) or {not: [...]} where the spec names none.
// rec: the recovery beat's stage (or [min, max]); retry: the retry line(s) the history must gain (alternatives
// as an array of arrays); book: G.book at the close-up; arrow: GAME_SPEC §3 "a pulsing arrow at the next empty
// check or line" where that is unambiguous; saved: STORY.saved at the click; world: at the end card;
// check: what the recovery beat must show (reread: he picks up the request again, step 1 starts over;
// lookup: the drawer opens again; reprint: the receipt prints to the end; noPaper: the LED blinks, no new paper).
const CASES = [
  { id: 's1-before', stage: 1, at: { row: 0, part: 't', d: -.3 }, when: 'any', rail: 'crashedAfter', outcome: 'out1', rec: 2, book: '11', retry: [], arrow: [1, 't'] },
  { id: 's1-after', stage: 1, at: { row: 0, part: 't', d: .3 }, when: 'any', rail: 'crashedAfter', outcome: 'out1', rec: 2, book: '11', retry: [], arrow: [1, 't'] },
  { id: 's2-early', stage: 2, at: { abs: .5 }, when: 'any', rail: 'crashedBefore', outcome: 'out2', rec: 2, book: '11', retry: [STEP1], check: 'reread', arrow: [1, 't'] },
  { id: 's2-late', stage: 2, at: { fromEnd: .5 }, when: 'any', rail: 'crashedBefore', outcome: 'out2', rec: 2, book: '11', retry: [STEP1], check: 'reread', arrow: [1, 't'] },
  { id: 's3-before', stage: 3, at: { row: 1, part: 't', d: -.3 }, when: 'before', rail: 'crashedBefore', outcome: 'out2', rec: 2, book: '11', retry: [STEP1], check: 'reread', saved: { wait: false }, arrow: [1, 't'] },
  { id: 's3-after', stage: 3, at: { row: 1, part: 't', d: .3 }, when: 'after', rail: 'crashedAfter', outcome: { not: ['out2'] }, rec: 4, book: '11 10', retry: [], saved: { wait: true }, arrow: [1, 'c'] },
  { id: 's4-before', stage: 4, at: { row: 1, part: 'c', d: -.3 }, when: 'before', rail: 'crashedBefore', outcome: 'out4', rec: 4, book: '11 10', retry: [retryLine('look_up_order')], check: 'lookup', saved: { drawer: false }, world: { lookups: 2 }, arrow: [1, 'c'] },
  { id: 's4-after', stage: 4, at: { row: 1, part: 'c', d: .3 }, when: 'after', rail: 'crashedAfter', outcome: 'outSkip', rec: [4, 5], book: '11 11', retry: [], saved: { drawer: true }, arrow: [2, 't'] },
  { id: 's5-before', stage: 5, at: { row: 2, part: 't', d: -.3 }, when: 'before', rail: 'crashedBefore', outcome: 'out5', rec: 5, book: '11 11', retry: [retryLine('Claude step 2')], arrow: [2, 't'] },
  { id: 's5-after', stage: 5, at: { row: 2, part: 't', d: .3 }, when: 'after', rail: 'crashedAfter', outcome: { not: ['out5'] }, rec: 6, book: '11 11 10', retry: [], saved: { wait: true } },
  { id: 's6-wait', stage: 6, at: { hold: 1 }, when: 'wait', rail: 'crashedBefore', outcome: 'out6', rec: 6, book: '11 11 10', retry: [], saved: { wait: true } },
  { id: 's6-after', stage: 6, at: { row: 3, part: 't', d: .3 }, when: null, rail: null, outcome: { not: ['out6'] }, rec: [6, 7], book: '11 11 10 11', retry: [] },
  { id: 's7-before', stage: 7, at: { tm: -.3 }, when: 'before', rail: 'crashedBefore', outcome: 'out7before', rec: 7, book: '11 11 10 11', retry: [retryLine('issue_refund')], check: 'reprint', world: { refundRuns: 2 }, arrow: [2, 'c'] },
  { id: 's7-money', stage: 7, at: { money: true }, when: 'money', rail: 'crashedBefore', outcome: 'out7money', rec: 7, book: '11 11 10 11', retry: [retryLine('issue_refund')], check: 'noPaper', world: { refundRuns: 2 }, arrow: [2, 'c'] },
  { id: 's7-after', stage: 7, at: { row: 2, part: 'c', d: .3 }, when: 'after', rail: 'crashedAfter', outcome: 'outSkip', rec: [7, 8], book: '11 11 11 11', retry: [], arrow: [4, 't'] },
  { id: 's8-step3-before', stage: 8, at: { row: 4, part: 't', d: -.3 }, when: 'before', rail: 'crashedBefore', outcome: 'out8step3', rec: 8, book: '11 11 11 11', retry: [retryLine('Claude step 3')], arrow: [4, 't'] },
  { id: 's8-email-before', stage: 8, at: { row: 4, part: 'c', d: -.3 }, when: 'before', rail: 'crashedBefore', outcome: 'out8email', rec: 8, book: '11 11 11 11 10', retry: [retryLine('email_customer')], saved: { envelope: false }, world: { emailRuns: 2 }, arrow: [4, 'c'] },
  // after the email's check, Claude step 4 may already be the running step: it resumes (stage 5's rules) or nothing reruns
  { id: 's8-email-after', stage: 8, at: { row: 4, part: 'c', d: .3 }, when: 'after', rail: 'crashedAfter', outcome: { not: ['out8email'] }, rec: 8, book: '11 11 11 11 11', retry: [[], [retryLine('Claude step 4')]], saved: { envelope: true } },
  { id: 's8-step4-before', stage: 8, at: { row: 5, part: 't', d: -.3 }, when: 'before', rail: 'crashedBefore', outcome: 'out8step4', rec: 8, book: '11 11 11 11 11', retry: [retryLine('Claude step 4')], arrow: [5, 't'] },
  { id: 's9', stage: 9, at: { room: true }, when: 'any', rail: 'crashedAfter', outcome: 'out9', rec: 9, book: '11 11 11 11 11 11', retry: [] },
];

/** Where to pull the plug for a case: {id, q} in the stage's beats, plus the commit it is measured from. */
function targetOf(c, chain) {
  const total = chain.reduce((s, b) => s + b.dur, 0), at = c.at;
  if (at.row !== undefined) {
    const cm = commitOf(chain, at.row, at.part);
    if (!cm) throw new Error(`stage ${c.stage}: no commit of row ${at.row} '${at.part}' in ${chain.map(b => b.id).join(', ')}`);
    return { ...locate(chain, cm.abs + at.d), commit: cm };
  }
  if (at.abs !== undefined) return locate(chain, at.abs);
  if (at.fromEnd !== undefined) return locate(chain, total - at.fromEnd);
  if (at.room) { const b = chain.find(x => x.scene === 'room'); if (!b) throw new Error(`stage ${c.stage}: no room beat`); return { id: b.id, q: Math.min(1, b.dur / 2) }; }
  const tm = chain.flatMap(b => b.events).find(e => e.world && e.world.refunds === 1), tc = commitOf(chain, 2, 'c');
  if (!tm || !tc) throw new Error('stage 7: t_m (world.refunds = 1) or t_c (row 2 check) not found in the beat data');
  expect(tc.abs - tm.abs, 't_c comes about 1.2 s after t_m (GAME_SPEC §4 st. 7)').toBeGreaterThan(.6);
  if (at.money) return { ...locate(chain, (tm.abs + tc.abs) / 2), tm, tc };
  return { ...locate(chain, tm.abs + at.tm), tm, tc };
}

/** The history must be the fixture plus exactly the case's retry lines, each right where the crash happened. */
function checkHistory(c, final, atClick) {
  const texts = final.events.map(e => e.text), want = expectedEvents(HISTORY_APPROVED, final.slug).map(e => e.text);
  expect(texts.filter(t => !isRetry(t)), 'the history minus retry lines equals the fixture').toEqual(want);
  const retries = texts.filter(isRetry), alts = c.retry.length && Array.isArray(c.retry[0]) ? c.retry : [c.retry];
  expect(alts.map(a => JSON.stringify(a)), `retry lines ${JSON.stringify(retries)}`).toContain(JSON.stringify(retries));
  if (retries.length) expect(texts.indexOf(retries[0]), 'the retry line follows the events written before the crash').toBe(atClick.events.length);
}

test.describe('2 crash matrix', () => {
  for (const c of CASES) {
    test(`${c.id}: stage ${c.stage}${c.outcome && typeof c.outcome === 'string' ? ' -> ' + c.outcome : ''}`, async ({ page }) => {
      test.setTimeout(120000);
      const w = await open(page);
      await startWith(page, 'Zoë');
      await railTo(page, c.stage);
      const chain = await stageChain(page, c.stage);
      // ---- to the moment ----
      let tgt = null;
      if (c.at.hold !== undefined) {
        for (let i = 0; i < 120; i++) { const v = await view(page); if (v.action.act === 'approve' && v.action.enabled) break; await advance(page, .5); }
        expect((await view(page)).action.act, 'the approval hold').toBe('approve');
        await advance(page, c.at.hold);
      } else {
        tgt = targetOf(c, chain);
        const total = chain.reduce((s, b) => s + b.dur, 0);
        if (c.id === 's6-after') test.skip(!tgt.commit || tgt.commit.abs + .3 > total, 'stage 6 ends at its commit: no "after" moment inside stage 6');
        await playTo(page, tgt.id, tgt.q);
      }
      const before = await state(page);
      if (c.at.row !== undefined) expect(before.book[c.at.row][c.at.part], `aimed ${c.at.d < 0 ? 'before' : 'after'} the commit`).toBe(c.at.d < 0 ? 0 : 1);
      if (c.at.money) expect([before.world.refunds, before.book[2].c], 'between t_m and t_c: money moved, not written').toEqual([1, 0]);
      if (c.at.tm !== undefined) expect(before.world.refunds, 'before t_m: no money moved').toBe(0);

      // ---- the crash, through the real plug button ----
      const K = await crash(page);
      const click = K.atClick;
      expect(click.crashes.length).toBe(1);
      expect(click.crashes[0].stage).toBe(c.stage);
      if (c.when) expect(click.crashes[0].when).toBe(c.when);
      expect(click.frozenQ).toBe(before.q);
      expect(capIds(click)).toContain('crash');                    // "The server crashes."
      for (const [k, v] of Object.entries(c.saved ?? {})) expect(click.worker.saved[k], `saved.${k}`).toBe(v);
      if (c.rail) await expect(page.locator(`#rail button[data-k="${c.stage}"] .chip-crash`)).toHaveText(RAIL[c.rail]);
      // the recovery beat, decided once at the unplug from the book and the world
      const rec = K.pushing.worker.rec;
      expect(rec && rec.id, 'worker.rec at the unplug').toBeTruthy();
      const recStage = await page.evaluate(id => STORY.beat(id)?.stage ?? null, rec.id);
      if (Array.isArray(c.rec)) { expect(recStage).toBeGreaterThanOrEqual(c.rec[0]); expect(recStage).toBeLessThanOrEqual(c.rec[1]); } else expect(recStage, `recovery beat ${rec.id}`).toBe(c.rec);
      // the close-up: the book, the drawn rows, one underline per saved line, the ring, the arrow
      expect(K.notes.book, 'the notebook at the close-up').toEqual(B(c.book));
      const N = K.N, bk = B(c.book);
      bk.forEach((r, k) => { expect(N.rows[k].t, `row ${k} text drawn`).toBeCloseTo(r.t, 5); expect(N.rows[k].c, `row ${k} check drawn`).toBeCloseTo(r.c, 5); });
      bk.forEach((r, k) => expect(N.under[k] > 0, `underline row ${k}`).toBe(!!r.t));
      const ink = K.notes.ink.at(-1);
      if (ink) expect(N.ring && [N.ring.row, N.ring.part], 'the ring on the last mark written').toEqual([ink.row, ink.part]);
      if (c.arrow) expect(N.arrow && [N.arrow.row, N.arrow.part], 'the arrow at the next empty mark').toEqual(c.arrow);
      // the outcome, then the story runs again
      const on = K.on;
      expect(on.frozenQ).toBeNull();
      const oc = on.crashes[0].outcome;
      if (typeof c.outcome === 'string') expect(oc).toBe(c.outcome); else { expect(oc).toMatch(/^out/); expect(c.outcome.not).not.toContain(oc); }
      expect(capIds(on), 'the outcome caption is shown next').toContain(oc);
      if (c.stage === 6 && c.at.hold !== undefined) {
        const v = await view(page);
        expect(v.action.act, 'the approval still waits').toBe('approve');
        expect(on.events.some(e => /^Approved by/.test(e.text))).toBe(false);
      }
      // a retry: the panel explains the real timeouts (GAME_SPEC §3 "Retries")
      const flat = c.retry.length && !Array.isArray(c.retry[0]) ? c.retry : [];
      if (flat.length && recStage === c.stage) {
        await expect(page.locator('#p-retry')).toBeVisible();
        for (const s of ['5 s', '2 min', '10 s', '1 min']) await expect(page.locator('#p-retry')).toContainText(s);
      }
      // what the recovery beat shows
      if (c.check) {
        const S = await sampleBeat(page, rec.id);
        expect(S.length).toBeGreaterThan(0);
        if (c.check === 'reread') expect(S.some(x => (x.held ?? 0) > 0 || ['READ', 'LOWREACH'].includes(x.pose)), 'step 1 starts over from the request: he takes the request again').toBe(true);
        if (c.check === 'lookup') expect(Math.max(...S.map(x => x.drawer ?? 0)), 'the drawer opens again').toBe(1);
        if (c.check === 'reprint') { const e = S.map(x => x.e ?? 0); expect(Math.min(...e)).toBeLessThan(150); expect(Math.max(...e), 'the receipt finishes printing').toBe(150); }
        if (c.check === 'noPaper') { expect(S.some(x => x.led === 1), 'the LED blinks').toBe(true); expect(new Set(S.map(x => x.e)).size, 'no new paper comes out').toBe(1); }
      }
      // ---- to the end card ----
      const r = await playToEnd(page);
      expect(r.ok, `reached the end card (stuck at ${r.state.beat.id})`).toBe(true);
      checkHistory(c, r.state, click);
      expect(r.state.world).toMatchObject({ ...W1, ...(c.world ?? {}) });
      expect(r.state.book).toEqual(B('11 11 11 11 11 11'));
      expect(r.state.crashes.length).toBe(1);
      expect(await problems(w)).toEqual([]);
    });
  }

  test('a crash while he wakes (stage 4, before the lookup is written): one recovery answers both', async ({ page }) => {
    test.setTimeout(120000);
    const w = await open(page);
    await startWith(page, 'Zoë');
    await railTo(page, 4);
    const chain = await stageChain(page, 4), cm = commitOf(chain, 1, 'c'), tgt = locate(chain, cm.abs - .3);
    await playTo(page, tgt.id, tgt.q);
    const K = await crash(page, { replugWhileWaking: true });
    expect(K.rewake.crashes.length).toBe(2);
    expect(K.rewake.frozenQ, 'the story stays frozen at the first click').toBe(K.atClick.frozenQ);
    expect(K.rewake.beat.id).toBe(K.atClick.beat.id);
    expect(capIds(K.rewake), '"The server crashes again."').toContain('crashAgain');
    expect(K.notes.book).toEqual(B('11 10'));
    expect(K.on.crashes.map(x => x.outcome)).toEqual(['out4', 'out4']);
    const r = await playToEnd(page);
    expect(r.ok).toBe(true);
    const texts = r.state.events.map(e => e.text);
    expect(texts.filter(isRetry), 'the lookup ran twice, not three times').toEqual([retryLine('look_up_order')]);
    expect(r.state.world).toMatchObject({ ...W1, lookups: 2 });
    expect(await problems(w)).toEqual([]);
  });

  test('a double crash in stage 7 (before t_m, then between t_m and t_c of the rerun): still one refund', async ({ page }) => {
    test.setTimeout(150000);
    const w = await open(page);
    await startWith(page, 'Zoë');
    await railTo(page, 7);
    const chain = await stageChain(page, 7), tgt = targetOf({ stage: 7, at: { tm: -.3 } }, chain);
    await playTo(page, tgt.id, tgt.q);
    const K1 = await crash(page);
    expect(K1.on.crashes[0].outcome).toBe('out7before');
    // the rerun: pull the plug again as soon as the shop has the money and the check is not written yet
    const m = await until(page, { 'world.refunds': 1 }, 20);
    expect(m.book[2].c, 'the rerun is caught between t_m and t_c').toBe(0);
    const K2 = await crash(page);
    expect(K2.atClick.crashes.map(x => x.when)).toEqual(['before', 'money']);
    expect(capIds(K2.atClick), '"The server crashes again."').toContain('crashAgain');
    expect(K2.on.crashes[1].outcome).toBe('out7money');
    const r = await playToEnd(page);
    expect(r.ok).toBe(true);
    const texts = r.state.events.map(e => e.text);
    expect(texts.filter(t => !isRetry(t))).toEqual(expectedEvents(HISTORY_APPROVED, 'zoe').map(e => e.text));
    // one ACTIVITY_TASK_STARTED line per Activity, with the last attempt (facts.md §3 "After a retry, only the last attempt shows")
    expect(K2.atClick.events.map(e => e.text).filter(isRetry), 'after the first recovery: attempt 2').toEqual([retryLine('issue_refund', 2)]);
    expect(texts.filter(isRetry), 'after the second: the attempt 2 line is replaced by attempt 3').toEqual([retryLine('issue_refund', 3)]);
    expect(r.state.world).toMatchObject({ refunds: 1, refundRuns: 3, emails: 1, emailRuns: 1 });
    expect(await problems(w)).toEqual([]);
  });

  // A crash inside a retry (facts.md §3): the Activity is still the same unfinished one, so the history keeps ONE retry
  // line for it, with the newest attempt, where the latest crash happened. Both crashes land 0.3 s before the commit;
  // the second one's commit is found by walking STORY's beats from the recovery beat (no beat ids hard-coded).
  const DOUBLE = [
    { name: 'stage 3 (step 1 before its line is written)', stage: 3, row: 1, part: 't', outcome: 'out2', what: 'Claude step 1', key: 'step1', world: {} },
    { name: 'stage 4 (the lookup before its check), then inside its retry', stage: 4, row: 1, part: 'c', outcome: 'out4', what: 'look_up_order', key: 'lookup', world: { lookups: 3 }, inRetry: true },
  ];
  for (const d of DOUBLE) {
    test(`a double crash in ${d.name}: one retry line, attempt 3`, async ({ page }) => {
      test.setTimeout(150000);
      const w = await open(page);
      await startWith(page, 'Zoë');
      await railTo(page, d.stage);
      const chain = await stageChain(page, d.stage), cm = commitOf(chain, d.row, d.part), tgt = locate(chain, cm.abs - .3);
      await playTo(page, tgt.id, tgt.q);
      const K1 = await crash(page);
      expect(K1.atClick.crashes[0].when).toBe('before');
      expect(K1.on.crashes[0].outcome).toBe(d.outcome);
      expect(K1.on.beat.id, 'the story runs again from the recovery beat').toBe(K1.pushing.worker.rec.id);
      // the same commit, reached again along the recovery path
      const nx = await page.evaluate(([row, part]) => {
        const g = JSON.parse(JSON.stringify(window.__game.state())); let id = g.beat.id;
        for (let i = 0; i < 20 && id; i++) { const b = STORY.beat(id); if (!b) return null;
          const c = [].concat(b.commit ?? []).find(x => x.row === row && x.part === part); if (c) return { id, t: c.t };
          const n = b.next(g); if (!n || n === id) return null; id = n; }
        return null;
      }, [d.row, d.part]);
      expect(nx, `the commit of row ${d.row} '${d.part}' after ${K1.on.beat.id}`).toBeTruthy();
      await playTo(page, nx.id, nx.t - .3);
      const before = await state(page);
      expect(before.book[d.row][d.part], 'aimed before the commit again').toBe(0);
      expect(before.events.map(e => e.text).filter(isRetry), 'after the first recovery: attempt 2').toEqual([retryLine(d.what, 2)]);
      if (d.inRetry) expect(before.beat.id, 'the second crash is inside the retry beat itself').toBe(K1.pushing.worker.rec.id);
      const K2 = await crash(page);
      expect(K2.atClick.crashes.map(x => x.when)).toEqual(['before', 'before']);
      expect(capIds(K2.atClick), '"The server crashes again."').toContain('crashAgain');
      expect(K2.on.crashes[1].outcome).toBe(d.outcome);
      const r = await playToEnd(page);
      expect(r.ok, `reached the end card (stuck at ${r.state.beat.id})`).toBe(true);
      const texts = r.state.events.map(e => e.text);
      expect(texts.filter(t => !isRetry(t)), 'the history minus retry lines equals the fixture').toEqual(expectedEvents(HISTORY_APPROVED, 'zoe').map(e => e.text));
      expect(texts.filter(isRetry), 'one line for the Activity, the last attempt').toEqual([retryLine(d.what, 3)]);
      // where the latest crash happened: the attempt 2 line is dropped and attempt 3 takes the end of the history
      expect(texts.indexOf(retryLine(d.what, 3))).toBe(K2.atClick.events.length - 1);
      expect(r.state.world).toMatchObject({ ...W1, ...d.world });
      expect(r.state.world.attempts?.[d.key], `${d.key} ran three times`).toBe(3);
      expect(r.state.crashes.length).toBe(2);
      expect(await problems(w)).toEqual([]);
    });
  }

  test('approve while dark: the stamp waits for the power and the notes; the event comes after', async ({ page }) => {
    test.setTimeout(120000);
    const w = await open(page);
    await startWith(page, 'Zoë');
    await railTo(page, 6);
    for (let i = 0; i < 120; i++) { const v = await view(page); if (v.action.act === 'approve' && v.action.enabled) break; await advance(page, .5); }
    const plug = page.locator('#btn-plug');
    await plug.click(); await sync(page);
    await until(page, { phase: 'dark' }, 3);
    // Approve and Reject stay live in the dark; the choice is queued with a note
    await expect(page.locator('#btn-action')).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('#btn-alt')).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('#why-action')).not.toBeEmpty();
    await page.locator('#btn-action').click(); await sync(page);
    let s = await state(page);
    expect(s.approval.queued).toBe('approve');
    expect(s.approval.decision).toBeNull();
    await expect(page.locator('#btn-action'), 'a queued decision cannot be made twice').toHaveAttribute('aria-disabled', 'true');
    await plug.click(); await sync(page);
    s = await until(page, { scene: 'notes' }, 8);
    expect(s.events.some(e => /^Approved by/.test(e.text)), 'nothing is written in the dark or during the notes').toBe(false);
    expect(s.book[3]).toEqual({ t: 0, c: 0, strike: 0 });
    const on = await until(page, { phase: 'on' }, 8);
    const s2 = await until(page, { 'book.3.t': 1 }, 20);
    const ev = s2.events.find(e => /^Approved by/.test(e.text));
    expect(ev, 'the approval is written once the power is back').toBeTruthy();
    expect(ev.at).toBeGreaterThanOrEqual(on.clock - 1e-9);
    const r = await playToEnd(page);
    expect(r.ok).toBe(true);
    expect(r.state.events.map(e => e.text)).toEqual(expectedEvents(HISTORY_APPROVED, 'zoe').map(e => e.text));
    expect(r.state.world).toMatchObject(W1);
    expect(await problems(w)).toEqual([]);
  });
});
