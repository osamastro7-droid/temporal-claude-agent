'use strict';
// ============================================================
// game/story.js: the stage beats, the notebook model, the recovery rules and STORY.canon(k).
// Every beat of GAME_SPEC §4 (start card, P1, P2, stages 1-9, the Reject branch, the end card and the
// recovery beats a crash leads to: r2.reread, r4.run, r5.resume, r7.again, r7.money, r8.*, rj.again),
// built from the film's acting helpers re-timed (a3 track/lookAt/POSES, a5 re-read, a8 slipPose/
// stampPose/minuteAngle/wobbleAt, a9 perf/RLOOK/cheer). The contracts below are what shop.js, room.js,
// cards.js, sfx.js, ui.js and runtime.js code against.
//
// ================================================================================================
// SHARED SCHEMAS (the one copy; every other game file refers here as "story.js SCHEMAS")
// ================================================================================================
//
// UNITS AND SPACES
//   seconds       every time (t, q, t0, dur) is in seconds of GAME time: it stops while paused or
//                 hidden and in ?test=1 it only moves through window.__game.advance(sec).
//   q             beat-local time = floor((G.clock - G.beat.t0) * 24) / 24 (film ones grid). Objects
//                 still step on twos inside renderers via tw(q) (kit.js:394).
//   world         the logical 1920x1080 sheet (y down) in which drawings are authored.
//   room world    world units under cam(c, SD.CAM.x, SD.CAM.y, SD.CAM.zoom) = (1000, 522, 1.12).
//                 screen = (world - SD.CAM) * 1.12 + (960, 540)  (ROOM.toScreen).
//   screen        logical 1920x1080 after resetT(c) (captions, cards). The shop's camera is
//                 cam(c, CX, CY, 1), so shop world == screen.
//   display-local the laptop display (x -480..480, y -300..300): world = SC.toWorld(at, p).
//   css px        DOM only (ui.js). ui.js maps screen <-> css with the canvas element's rect.
//
// GAME STATE  G  (plain data, JSON-serialisable; only runtime.update() changes it, directly or by
// calling story functions / beat events with it). Fields marked + are foundation additions to the
// spec's G (GAME_SPEC §2 "State"); they are needed to keep every renderer a pure function.
//   G = {
//     name:      string   the cleaned name, exactly as the panel shows it (NAME.clean). '' before start.
//     drawnName: string   what the pencil draws: font-mapped (NAME.drawn) in 'font' mode, else = name.
//     nameMode:  'font'|'fallback'
//     slug:      string   ascii lower letters of drawnName, <= 12, else 'you' (-> '<slug>@example.com')
//     scene:     'start'|'shop'|'wide'|'room'|'notes'|'mail'|'end'   which renderer draws (= beat.scene)
//     stage:     0..9     0 = shop (and the start card), 1..9 the stages of GAME_SPEC §4
//     beat:      { id, t0 }   the current beat id (STORY.beats key) and the G.clock at which it began
//              + fired, committed, cued: how many of the beat's events / commits / sfx cues have run (runtime.js)
//     q:         number   beat-local time, floor((clock - beat.t0) * 24) / 24, frozen while frozenQ != null
//     frozenQ:   null|number   set by the crash controller at the plug click: the story stops at this q
//     book:      [ {t:0|1, c:0|1, strike:0|1} x 6 ]   what Temporal has DURABLY written, per row
//                (row 0 request, 1 look_up_order, 2 issue_refund, 3 approved|rejected,
//                 4 email_customer|done, 5 done). t = the row's text, c = its check. Set to 1 at the
//                COMMIT moment (the drawing then takes STORY.INK_DUR[part] s to write, see `ink`).
//   + ink:       [ {row, part:'t'|'c'|'strike', t0} ]   when each committed mark started to be written
//                (G.clock). Drawn progress = clamp((G.clock - t0) / STORY.INK_DUR[part], 0, 1): it
//                runs on the GAME clock, so a committed line finishes even in the dark (GAME_SPEC §1.4).
//     events:    [ {text, stage, at} ]   history lines for the panel (and the tests), text final
//                (placeholders already filled); at = G.clock when it was written. Only real history
//                events go here: the "(nothing is written while it waits for approval)" line of facts.md
//                §3 is a NOTE, not an event (CONTENT.html.panel.waitNote). tests/web/fixtures/
//                history-approved.json uses §3's wording for the refund line: "... (also the receipt
//                number)" (GAME_SPEC.md:241), not st. 7's shorter "(the receipt number)" (:356).
//     world:     { traySlip, refunds, refundRuns, emails, emailRuns, receiptOut, envelopeSent, lookups,
//                  + receiptE, + attempts }
//                the shop and the room outside the worker; survives crashes. traySlip 0|1 (request in
//                the tray), refunds/emails = how many the SHOP recorded (1 at most), *Runs = how many
//                times the Activity ran, receiptOut 0|1, envelopeSent 0|1, lookups = lookup runs.
//                receiptE 0..150 = how much receipt paper is out of the printer (a crash stops it there;
//                stage 7's rerun finishes it). attempts = {step1, lookup, step2, refund, step3, email,
//                step4}: how many times each Activity started (the retry lines' attempt numbers).
//     worker:    { phase: 'on'|'pulling'|'dark'|'pushing'|'waking'|'notes'|'recover', t0 }
//                the crash controller's phase and the G.clock at which it began (runtime.js).
//              + c0, u0, when, saved, rec, caps, prev, sparked, powered: set by runtime at the plug click
//                and kept until 'on' again: c0 = G.clock at the plug click, u0 = G.clock at the unplug
//                click (null before); ROOM.crash gets them as K.tc / K.tu (seconds since), and every
//                crash time is ROOM.CRASH_T's (room.js). when = STORY.crashWhen(G) at the click; saved =
//                STORY.saved(G) at the click {wait, drawer, envelope}; rec = {id, q} the recovery beat
//                and its start q, computed ONCE at 'pushing' (STORY.recoverFor(G); q = G.frozenQ when id
//                is the frozen beat, else 0); caps = the frozen beat's held captions, re-queued only if
//                that beat is resumed; prev = null | {phase, t, tu, rec} the recovery a re-crash
//                interrupted (see THE CRASH); sparked / powered = SFX_LIVE.crash() / power() done.
//     approval:  { waiting: bool, decision: null|'approve'|'reject', queued: null|'approve'|'reject' }
//                queued = decided while the power was off; applied after the notes (GAME_SPEC §4 st. 6).
//     branch:    'approve'|'reject'
//     crashes:   [ {stage, when: 'before'|'money'|'after'|'wait'|'any', outcome?} ]   every plug pull,
//                in order; outcome = the outcome caption id, set by runtime at 'recover' (panel note).
//                The rail shows STORY.railMark(crash): before|money|wait -> 'crashedBefore',
//                after -> 'crashedAfter', any -> 'crashedBefore' in stage 2 (step 1 starts over),
//                else 'crashedAfter' (CONTENT.html.rail keys).
//     settings:  { sound: bool, reduced: bool, stepMode: bool, paused: bool }
//   + clock:     number   game seconds since STORY.newGame (runtime.js advances it)
//   + cap:       { now: null|{id, t0, out, cut}, queue: [{id, tMin, beat}], last: number }   caption
//                scheduler (runtime.js): now.t0/out in G.clock; last = G.clock when the previous caption
//                ended (-1 at start). A queued caption waits until G.q >= tMin while its beat plays
//                (beat null = no condition; a caption whose beat has already ended shows at once).
//                Caption rule GAME_SPEC §1.8.
//   + hold:      null|{ t0, step? }   set while a hold beat waits for the player (hq = clock - hold.t0);
//                step: true = step mode stopped at a stage boundary; STORY.action offers 'next'.
//   + hint:      null|string   a CONTENT.html key shown in the panel's "Now" until the next plug pull
//                (act 'break' sets 'tryBreakHint').
//   + dirty:     bool   runtime sets it to force a redraw on the next frame (input, resize)
//   }
//
// ROOM STATE  R  (what ROOM.frame(c, R) draws; plain data built by a beat's R(G, q) or hold.idle;
// never read G inside room.js). Positions are room world. Unset fields take ROOM.BASE_R's value.
//   R = {
//     pose:    string | {from: string, to: string, t: 0..1}   pose NAMES only (AGENT.KEYS or ROOM.POSES
//              names such as 'LOWREACH', 'READ', 'RLOOK', 'NBGRAB', 'HOLDBOOK'); t is snapped to 1/12 by
//              AGENT.draw. A slump from an inbetween uses ROOM.poseKey(from, to, t) -> 'mix:a>b@t12'
//              (a finite, cache-safe name; GAME_SPEC §4 crash step 3).
//     face:    'open'|'down'|'side'|'sideR'|'closed'|'half'|'happy'|'wide'|'worried'|'off'|'pause'
//     visor:   0..1 screen darkness (>= .5 hides the face)
//     lamp:    0..1 lamp light (0 = off)
//     dark:    0..1 room darkness (SD.dark)
//     pull:    0..ROOM.PULLED (120, a9.js:69) plug pulled out, rig-local px
//     hand:    null | {pose: 'reach'|'grip', x, y, rot}   the plug hand, rig-local (SD.socketRig)
//     spark:   0..1 red spark alpha
//     drawer:  0|.5|1 cabinet drawer (a3.js:255-263)     folder: 0..1 folder risen out of the drawer
//     traySlip: 0|1 the request slip lies in the tray
//   + parts:   { agent, printer, tray, book, clock? } each 0..1 draw-on (default 1): stage 1's room build
//              (a3.js:386-391; maps to V2G2ROOM.frame s.parts; book = the a9 desk notebook, clock = the a8
//              clock). The pencil tip stays in R.pencils.
//   + slip:    null | {x, y, s, rot, clipY?, tray?}   the request in flight or falling (stage 1; a3
//              slipState 7.333-7.78, a3.js:430-434): drawn in front (V2G2ROOM s.flying), or with
//              tray: true at the tray's place, cut at clipY (s.slipAt; a3 switches at u > .8).
//     held:    null | 0..1   the request slip in his hands (a3 `held`)
//     book:    { rows: [{t, c, strike} x 6] each 0..1 DRAWN progress, k: 0..1 lift (a9 LIFT_K
//              index / 5), glow: 0..1, branch: 'approve'|'reject' (row 3/4 labels) }
//     wait:    null | { which: 'look_up_order'|'answer'|'issue_refund'|'refund_id'|'email_customer'
//              (a CONTENT.drawn.slips key), x, y (centre), s (>= .81), rot (rad), sy (0..1 flip squash,
//              a8 flipA/flipB), approved 0..1, rejected 0..1 (stamp impressions), glow 0..1 (saved,
//              in the dark), drop 0..1 (falls and fades: the worker's slip on a crash before commit),
//              wob: null|0..3 (a8 WOB drawing index), pause 0..1 (pause sign next to the slip),
//              clip: null|'badge' (only the part above his badge slot shows: rising out / sinking in) }
//     stamp:   null | { k: a8 drawing index (a8.js:164-173 stampPose: 0 high with streaks, < K_IMPACT
//              coming down, < K_LIFT on the slip, then lifting, gone), word: 'approved'|'rejected',
//              hover?: bool (drawing 0 held high while the power is off) }. ROOM draws it relative to
//              R.wait: x = wait.x, y = wait.y + (stampPose(k).y - a8 MID.y) * wait.s, scale wait.s.
//     clock:   null | { u: 0..1 draw-on, angle: minute-hand angle (rad), alpha: 0..1 }
//     receipt: { e: 0..150 paper out of the printer, check: 0..1 green check (a9.js:152/:157) }
//     envelope:{ state: 'none'|'desk'|'fly'|'drop'|'gone', u: 0..1 draw-on, fly: 0..1 (a9 flightAt
//              progress for 'fly', a4 mail() drop progress for 'drop') }
//   + dash:    null | { u: 0..1, alpha }   indigo dashed line notebook -> cabinet (stage 4, a7 style)
//     pencils: [ {x, y, color: 'graphite'|'indigo'|'red'|'green', lift: 0..1, angle?} ]   visible
//              pencil tools, room world tip positions (drawPencilTool)
//     q, q2:   0..1 the red "?" (film prop; the game keeps it 0)
//     led:     0|1 printer LED on
//   + notes:   null | N   set only in scene 'notes': the close-up (ROOM.notes) instead of the room
//              N = { rows: [{t, c, strike} x 6] (0..1), branch, under: [0..1 x 6] (indigo underline
//              per saved line), ring: null|{row, part: 't'|'c', u: 0..1}, arrow: null|{row,
//              part: 't'|'c', u: 0..1 (grows in, a9.js:326 k), pulse: 0..1 (|sin|; a9 alpha = .65 + .35 *
//              pulse)}, alpha: 0..1 }
//   }
//
// SHOP STATE  S  (what SHOP.frame(c, S) draws in scenes 'shop' and 'mail'; built by the beat's R)
//   S = { name: null | {text, mode}   the player's name ALREADY FITTED for where it is drawn: the mail
//         page's "Hi {name}," line (NAME.fit(G.drawnName, G.nameMode, NAME.BUDGET.mail)); the mail beat's
//         R fills it. The checkout field gets its name through NAME.install instead.
//         film: null | {act: 'a1'|'a2'|'a3', tau}   replay a film window (captions blanked), OR
//         at: {x, y, s} (default SC.HOME), screen: an SC.screen state (stageC.js:27-34) with
//         page 'product'|'checkout'|'ordered'|'orders'|'reason'|'requested'|'mail',
//         live: bool   the film's cursor follows the real pointer (P1/P2 holds, GAME_SPEC §1.9); runtime then
//         sets pointer: null | [x, y] display-local (SHOP.pointer of the live pointer; SHOP draws SC.cursor) }
//
// CARD STATE  C  (CARDS.start(c, C) / CARDS.end(c, C))
//   C = { q: seconds since the card began, blink: bool, drawnName, nameMode, n: plug pulls,
//         branch: 'approve'|'reject' }
//
// BEAT  (declarative; STORY.beats[id]; GAME_SPEC §2 "A beat")
//   {
//     id:       string, unique ('shop.product', 's3.pause', 'r5.resume', ...)
//     stage:    0..9
//     scene:    G.scene while this beat plays (selects the renderer)
//     dur:      number | (G) => number: seconds the beat plays before next(G) (a hold beat: when its
//               hold starts). A function for lengths that depend on G (the name typing: 14 letters/s
//               of G.drawnName). Always read through STORY.durOf(b, G).
//     R(G, q):  -> the renderer's state for this scene (R, S or C above). Pure: no Date, no random.
//     events:   [[t, fn(G)]]   fire once, in order, when q >= t. fn may change G.world, G.events,
//               G.approval, G.branch (never G.book: use commit). Use STORY.log(G, key, extra) for events.
//     commit?:  {t, row, part: 't'|'c'|'strike'} | [ ...several ]   at q >= t: G.book[row][part] = 1 and
//               G.ink.push({row, part, t0: G.clock}). The indigo pencil starts writing there.
//     hold?:    { action: 'buy'|'pay'|'refund'|'submit'|'approve'|'next'|..., idle(G, hq) -> state }
//               after dur, the beat waits for that act (approve also accepts 'reject');
//               idle keeps animating (blinks, wobble, clock hands, rack lights).
//     captions: [capId]   CONTENT.drawn.captions keys, queued at the beat's start (runtime's caption
//               scheduler enforces GAME_SPEC §1.8; an optional form [capId, tMin] waits until q >= tMin)
//     sfx?:     [[t, type, opts?]] | (G) => [[t, type, opts?]]   SFX_LIVE.play(type, opts) when q
//               crosses t (only while sound is on; one key sound per letter of the name, for example).
//               Always read through STORY.sfxOf(b, G). Film-window beats need no sfx list: runtime
//               replays the act's own cues (SFX_LIVE.filmCue, see runtime.js "Sound obligations").
//     noPlug?:  CONTENT.html.disabled key: the plug is unavailable during this beat, with that reason
//     next(G):  -> the next beat id (or null: stay)
//   }
//
// THE CRASH (runtime.js owns the phases; story.js owns the decisions; room.js owns the timetable,
// ROOM.CRASH_T, which runtime's phase switches and sound calls are derived from)
//   click plug -> runtime: G.frozenQ = G.q; G.crashes.push({stage, when: STORY.crashWhen(G)});
//   G.worker.when/saved (STORY.saved) are fixed there; queued captions of the frozen beat are held back.
//   phases 'pulling' (hand 4 drawings, pull .134 s, the spark 1/12 s after the pull starts) -> 'dark'
//   (hold until 'unplug') -> 'pushing' (G.worker.rec = STORY.recoverFor(G), ONCE; from the push's
//   landing, CRASH_T.power, ROOM.crash draws the worker's props from that beat's R: the props snap)
//   -> 'waking' -> 'notes' (look, grab, lift, close-up ~3 s = scene 'notes', put down, let go) ->
//   'recover': the outcome caption STORY.outcome(G) (also stored in every crash record it answers),
//   then the recovery beat (resumed at frozenQ if it is the frozen beat), G.frozenQ = null, phase 'on'.
//   A CRASH DURING A RECOVERY (a crash while he wakes, a double crash; GAME_SPEC §10 test 2): the plug
//   is live again in 'waking' and in 'notes' outside the close-up (STORY.plugState). The story is still
//   frozen: G.frozenQ and G.beat stay. runtime pushes a new crash record, recomputes when and saved
//   from G, MERGES the held captions (the old worker.caps are kept), sets rec = null (the next unplug
//   decides the recovery again, from the same book and world) and stores prev = {phase, t, tu, rec} of
//   the interrupted recovery; ROOM.crash (K.prev) slumps him from the wake/lift inbetween at prev.tu and
//   keeps the props as they had snapped to prev.rec. The recovery that follows answers both crashes.
//   Approve/Reject while worker.phase !== 'on' is QUEUED (G.approval.queued) and applied after the
//   notes (GAME_SPEC §4 st. 6): the Approve and Reject buttons stay enabled while it is dark.
// ================================================================================================


window.STORY = (() => {
  const H = () => CONTENT.html, E = () => CONTENT.html.events;
  const f = n => n / 12;                                   // the twos grid (a9.js:42)
  const g12 = n => Math.round(n * 12) / 12;                // snap a beat to the twos grid (a3.js:327)
  const lin = x => x;
  const TAU_ = Math.PI * 2;

  /** Seconds the indigo pencil takes to write each committed mark (drawn progress in R.book). */
  const INK_DUR = { t: .6, c: .2, strike: .3 };
  /** Row labels for the notebook close-up and the drawn rows, by branch. @returns {string[6]} */
  function rowLabels(branch) { const r = CONTENT.drawn.rows.slice(); if (branch === 'reject') for (const [k, v] of Object.entries(CONTENT.drawn.rowsReject)) r[+k] = v; return r; }

  /**
   * A fresh game state (scene 'start', stage 0, nothing written). Called by runtime at load and on
   * "Play again" (which passes the kept name) / "Change name".
   * @param {{name, drawnName, nameMode, slug}=} who  from NAME.prepare(); omitted -> empty name
   * @param {{sound, reduced, stepMode, paused}=} settings  kept across restarts
   * @returns {object} G (story.js SCHEMAS)
   */
  function newGame(who = {}, settings = {}) {
    return {
      name: who.name ?? '', drawnName: who.drawnName ?? '', nameMode: who.nameMode ?? 'font', slug: who.slug ?? 'you',
      scene: 'start', stage: 0, beat: { id: 'start', t0: 0, fired: 0, committed: 0, cued: 0 }, q: 0, frozenQ: null,
      book: Array.from({ length: 6 }, () => ({ t: 0, c: 0, strike: 0 })), ink: [],
      events: [],
      world: { traySlip: 0, refunds: 0, refundRuns: 0, emails: 0, emailRuns: 0, receiptOut: 0, envelopeSent: 0, lookups: 0,
        receiptE: 0, attempts: { step1: 0, lookup: 0, step2: 0, refund: 0, step3: 0, email: 0, step4: 0 } },
      worker: { phase: 'on', t0: 0 },
      approval: { waiting: false, decision: null, queued: null },
      branch: 'approve', crashes: [],
      settings: { sound: false, reduced: !!(window.BOOT && BOOT.reduced), stepMode: false, paused: false, ...settings },
      clock: 0, cap: { now: null, queue: [], last: -1 }, hold: null, hint: null, dirty: true,
    };
  }

  // =============================================================================================
  // EVENTS: the history lines (GAME_SPEC §3, facts.md §3) and the Activity runs they stand for
  // =============================================================================================
  /**
   * Fill an event text and append it to G.events. key = CONTENT.html.events key.
   * extra = placeholder values, e.g. {what: 'Claude step 1', n: 2} for 'retry'.
   * @returns {string} the final text
   */
  function log(G, key, extra = {}) {
    const text = fill(E()[key] ?? key, { slug: G.slug, name: G.name, ...extra });
    G.events.push({ text, stage: G.stage, at: G.clock }); return text;
  }
  /** Replace {name}, {slug}, {n}, ... in a CONTENT string. @returns {string} */
  const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
  /** An Activity starts (again): count the attempt in G.world (tool runs: lookups, refundRuns, emailRuns);
   *  a retry writes "<what> started again (attempt n)" (GAME_SPEC §3 "Retries"). */
  function run(G, key, retry) {
    const W = G.world, A = W.attempts ?? (W.attempts = {}), n = A[key] = (A[key] ?? 0) + 1;
    if (key === 'lookup') W.lookups = n; if (key === 'refund') W.refundRuns = n; if (key === 'email') W.emailRuns = n;
    if (retry) log(G, 'retry', { what: (H().retryWhat ?? {})[key] ?? key, n });
  }

  // =============================================================================================
  // THE NOTEBOOK (GAME_SPEC §3): what is written, drawn one mark at a time on the game clock
  // =============================================================================================
  /** The ink as the one indigo pencil writes it: a mark committed while another is still being written
   *  waits for it (row 0's text then its check; a strike, then 'rejected', then its check). */
  function inkPlan(G) {
    let busy = -Infinity; const out = [];
    for (const i of G.ink) { const d = INK_DUR[i.part] ?? .3, s0 = Math.max(i.t0, busy); out.push({ row: i.row, part: i.part, s0, d }); busy = s0 + d; }
    return out;
  }
  /**
   * The notebook as DRAWN now: per row, the progress 0..1 of its text, check and strike, from G.book
   * and G.ink on the game clock (a committed mark keeps writing in the dark, GAME_SPEC §1.4).
   * Beats use it for R.book.rows; ROOM never reads G. @param {object} G @returns {{t, c, strike}[]}
   */
  function bookRows(G) {
    const rows = G.book.map(() => ({ t: 0, c: 0, strike: 0 }));
    for (const i of inkPlan(G)) rows[i.row][i.part] = Math.max(rows[i.row][i.part], clamp((G.clock - i.s0) / i.d, 0, 1));
    return rows;
  }
  /** Where the indigo pencil's tip is on a row mark at progress u (room world). ROOM.bookTip when the room
   *  exports it (it owns the desk notebook's drawing); else a9's row(k) scrawl geometry (a9.js:102): three
   *  rows per page, rows 0-2 on the left page, 3-5 on the right. */
  function rowTip(row, part, u) {
    if (typeof ROOM.bookTip === 'function') return ROOM.bookTip(row, part, u);
    const N = ROOM.NB, cel = celOf('game/nb-row' + ({ t: 't', c: 'c', strike: 's' }[part] ?? 't') + row);   // room.js build(): d.rowT / rowC / rowS
    if (cel) return RMx().celTip(cel, clamp(u, 0, 1), N.x, N.y);
    const L = row < 3, j = L ? row : row - 3, y = -14 - j * 10, x0 = L ? -76 + j * 3 : 12 + j * 2, w = L ? 46 - j * 3 : 44 - j * 3;   // room.js deskRow
    if (part === 'c') return [N.x + x0 + w + 2 + u * 10, N.y + y + (u < .35 ? u * 10 : 3.5 - (u - .35) * 16)];
    return [N.x + x0 + u * w, N.y + y + (part === 'strike' ? -4 : 0)];
  }
  /** a compiled cel by its compile id, if it exists yet (kit.js:122 _compiled) */
  const celOf = id => (typeof _compiled !== 'undefined' && _compiled.get(id)) || null;

  // =============================================================================================
  // ROOM GEOMETRY (room world): a8's slips at room scale, the badge, the pencils' homes
  // =============================================================================================
  const RMx = () => window.V2G2ROOM;
  /** His Claude badge (agent.js:69, agent-local (0, -164) on his chest): the slot the slips rise out of
   *  (GAME_SPEC §1.2, a8's "box slot"). ROOM.BADGE when the room exports it. */
  const badge = () => ROOM.BADGE ?? { x: SD.AG.x, y: SD.AG.y - 164 * SD.AG.s };
  /** a8 slip constants (a8.js:61-62): LOW = the slip's size in the slot; it rises tilted toward his raised
   *  right arm (GAME DECISION: a8's slot has nothing above it, his face is above the badge), then flies to
   *  WAIT (room.js ROOM.WAIT, s .85 >= .81) and rests at a8's REST tilt. */
  const SL = { LOW: .45, UP: -Math.PI / 2 + .6, REST: -.03, HOP: 28 };
  const slipHL = s => (SB.slipW ? SB.slipW() : 477) * s / 2;
  const along = (p, d, h) => [p[0] + Math.cos(d) * h, p[1] + Math.sin(d) * h];
  /** just out of the badge (a8 P0) / fully inside it (a8 bottomY) */
  const slotOut = () => { const b = badge(); return along([b.x, b.y], SL.UP, slipHL(SL.LOW) + 6); };
  const slotIn = () => { const b = badge(); return along([b.x, b.y], SL.UP, -slipHL(SL.LOW) - 3); };
  const WAITP = () => [ROOM.WAIT.x, ROOM.WAIT.y];
  /** a8 fly(u, a, b) (a8.js:127): an eased move with a small hop */
  const hop = (u, a, b) => { const e = easeIO(u); return [lerp(a[0], b[0], e), lerp(a[1], b[1], e) - SL.HOP * 4 * e * (1 - e)]; };
  /** a8's fidget (a8.js:144-148): 4 drawings on twos at each start time; returns the WOB index or null */
  function wobAt(q, starts) { for (const t0 of starts) { const k = Math.round((q - t0) * 12); if (k >= 0 && k < 4) return k; } return null; }
  /** the idle fidget while a call waits: every 1.25 s from t0 (GAME_SPEC §4 st. 6, a8.js:144-148) */
  const wobEvery = (q, t0) => { if (q < t0) return null; const k = Math.round(((q - t0) % 1.25) * 12); return k < 4 ? k : null; };
  /** A waiting slip (story.js SCHEMAS R.wait) with a8's defaults. */
  const slipAt = (which, p, o = {}) => ({ which, x: p[0], y: p[1], s: ROOM.WAIT.s, rot: SL.REST, sy: 1, approved: 0, rejected: 0, glow: 0, drop: 0, wob: null, pause: 1, clip: null, ...o });
  /**
   * A tool slip going out (a8 slipPose rise/fly, a8.js:130-131, re-timed): out of his badge (clipped at
   * the slot), then an arc to WAIT, growing .45 -> .85. null before it starts.
   */
  function slipOut(which, q, rise, fly, o = {}) {
    if (q < rise[0]) return null;
    if (q < rise[1]) { const u = sm(rise[0], rise[1], q, easeOut), a = slotIn(), b = slotOut(); return slipAt(which, [lerp(a[0], b[0], u), lerp(a[1], b[1], u)], { s: SL.LOW, rot: SL.UP, clip: 'badge', pause: 0, ...o }); }
    if (q < fly[1]) { const u = sm(fly[0], fly[1], q, lin), p = hop(u, slotOut(), WAITP()); return slipAt(which, p, { s: lerp(SL.LOW, ROOM.WAIT.s, easeIO(u)), rot: lerp(SL.UP, SL.REST, easeOut(u)), pause: 0, ...o }); }
    return slipAt(which, WAITP(), o);
  }
  /** The answer going back into his badge (a8 back/sink, a8.js:136-137, re-timed). null once it is in. */
  function slipBack(which, q, back, sink, o = {}) {
    if (q < back[0]) return slipAt(which, WAITP(), o);
    if (q < back[1]) { const u = sm(back[0], back[1], q, lin), p = hop(u, WAITP(), slotOut()); return slipAt(which, p, { s: lerp(ROOM.WAIT.s, SL.LOW, easeIO(u)), rot: lerp(SL.REST, SL.UP, easeIn(u)), ...o }); }
    if (q < sink[1]) { const u = sm(sink[0], sink[1], q, easeIn), a = slotOut(), b = slotIn(); return slipAt(which, [lerp(a[0], b[0], u), lerp(a[1], b[1], u)], { s: SL.LOW, rot: SL.UP, clip: 'badge', ...o }); }
    return null;
  }
  /** A SAVED answer coming back out of the notebook into his badge (GAME_SPEC §1.3 "saved things come back
   *  out of the notebook"; st. 5 "the saved answer rises out of the notebook into his badge"): it glows. */
  function slipFromBook(which, q, rise, fly, sink, o = {}) {
    const N = ROOM.NB, from = [N.x, N.y - 20], up = [N.x + 10, N.y - 150];
    if (q < rise[0]) return null;
    if (q < rise[1]) { const u = sm(rise[0], rise[1], q, easeOut); return slipAt(which, [lerp(from[0], up[0], u), lerp(from[1], up[1], u)], { s: lerp(.25, SL.LOW, u), rot: lerp(-.2, SL.UP, u), glow: .7 * (1 - u * .4), pause: 0, ...o }); }
    if (q < fly[1]) { const u = sm(fly[0], fly[1], q, lin); return slipAt(which, hop(u, up, slotOut()), { s: SL.LOW, rot: SL.UP, glow: .42 * (1 - u), pause: 0, ...o }); }
    if (q < sink[1]) { const u = sm(sink[0], sink[1], q, easeIn), a = slotOut(), b = slotIn(); return slipAt(which, [lerp(a[0], b[0], u), lerp(a[1], b[1], u)], { s: SL.LOW, rot: SL.UP, clip: 'badge', pause: 0, ...o }); }
    return null;
  }
  /** a8 flipA/flipB (a8.js:133-134): the slip turns edge-on and shows its other side (sy 1 -> 0 -> 1). */
  const flip = (q, a, b, from, to) => (q < a[0] ? { which: from, sy: 1 } : q < a[1] ? { which: from, sy: 1 - sm(a[0], a[1], q, lin) } : q < b[1] ? { which: to, sy: sm(b[0], b[1], q, lin) } : { which: to, sy: 1 });

  // ---- pencils (room world tips; drawPencilTool). Homes are off the frame (screen = (w - CAM) * 1.12 + C).
  const HOME = { graphite: [2240, 650], indigo: [700, 1320], green: [1560, 1230] };   // a3 room home [W+320, H*.6]; a9 home [1560, 1230]
  const pencil = (p, color, lift, angle) => ({ x: p[0], y: p[1], color, lift: clamp(lift, 0, 1), ...(angle !== undefined ? { angle } : {}) });
  /** Temporal's indigo pencil: it writes each committed mark (inkPlan, on the game clock, so it keeps
   *  writing in the dark), glides in just before a commit the beat is about to make, and leaves after. */
  function inkPencil(G, b, q) {
    const plan = inkPlan(G), now = G.clock;
    let cur = null; for (const i of plan) if (i.s0 <= now) cur = i;
    if (cur) {
      const e = cur.s0 + cur.d;
      if (now < e) return pencil(rowTip(cur.row, cur.part, clamp((now - cur.s0) / cur.d, 0, 1)), 'indigo', 0);
      if (now < e + .5) { const u = (now - e) / .5, a = rowTip(cur.row, cur.part, 1); return pencil([lerp(a[0], HOME.indigo[0], easeIn(u)), lerp(a[1], HOME.indigo[1], easeIn(u))], 'indigo', u * 3); }
    }
    // coming in for the beat's next commit (only while the story runs: in the dark it has nothing to write)
    if (b && G.frozenQ === null && b.commit) {
      const cm = (Array.isArray(b.commit) ? b.commit : [b.commit]).find(c => c.t > q - 1e-9 && c.t - q <= .42);
      if (cm) { const u = 1 - (cm.t - q) / .42, a = rowTip(cm.row, cm.part === 'c' && !G.book[cm.row].t ? 't' : cm.part, 0); return pencil([lerp(HOME.indigo[0], a[0], easeOut(u)), lerp(HOME.indigo[1], a[1], easeOut(u))], 'indigo', 1 - u * .8); }
    }
    return null;
  }

  // ---- the agent's acting: named poses on twos (a3 track, a3.js:116-126), looks with blinks (a3 lookAt) ----
  const nm = (from, to, t) => ROOM.poseKey(from, to, t);   // a cache-safe named inbetween (a3 DIP / anticipation mixes)
  const DIP = () => nm('rest', 'slump', .17);              // a3.js:401 DIP = ['rest', 'slump', .17]
  const ANTIC = () => nm('rest', 'typeA', .34);            // a3.js:404 [T.antic, ['rest', 'typeA', .34], .12]
  /** [[t, poseName, dur, ease]] -> a pose NAME or {from, to, t} (a3.js:116-126, with names only). */
  function track(q, keys) {
    let prev = keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t0, next, dur = .25, ease = easeIO] = keys[i];
      if (q < t0 - 1e-9) break;
      const u = dur > 0 ? ease(clamp((q - t0) / dur, 0, 1)) : 1;
      if (u < 1) return { from: prev, to: next, t: u };
      prev = next;
    }
    return prev;
  }
  const BLINKABLE = new Set(['open', 'down', 'side', 'sideR', 'half']);
  /** [[t, face]] + blink times ('closed' for 2 frames, a9.js:185) -> the face at q. */
  function look(q, keys, blinks = []) {
    let face = keys[0][1]; for (const [t, fc] of keys) { if (q < t - 1e-9) break; face = fc; }
    return BLINKABLE.has(face) && blinks.some(b => q >= b - 1e-9 && q < b + f(1) - 1e-6) ? 'closed' : face;
  }
  /** Typing: typeA / typeB 4 frames each (a3.js:423, a9.js:183). */
  const typing = (q, t0) => (Math.floor((q - t0) * 6 + 1e-6) % 2 ? 'typeB' : 'typeA');

  /** The room at rest for this G: everything that is Temporal's or the shop's (the book, the receipt,
   *  the envelope, the tray) comes from G; the beat adds the worker's things and his acting. */
  function base(G, b, q) {
    const W = G.world, pen = inkPencil(G, b, q);
    return {
      pose: 'rest', face: 'open', visor: 0, lamp: 1, dark: 0, pull: 0, hand: null, spark: 0, drawer: 0, folder: 0,
      traySlip: W.traySlip ? 1 : 0, held: null, slip: null,
      book: { rows: bookRows(G), k: 0, glow: 0, branch: G.branch },
      wait: null, stamp: null, clock: null,
      receipt: { e: W.receiptOut ? 150 : clamp(W.receiptE ?? 0, 0, 150), check: 0 },
      envelope: W.envelopeSent ? { state: 'gone', u: 1, fly: 1 } : { state: 'desk', u: 1, fly: 0 },
      dash: null, pencils: pen ? [pen] : [], q: 0, q2: 0, led: 0, notes: null,
      parts: { agent: 1, printer: 1, tray: 1, book: 1, clock: 1 },
    };
  }
  const roomBeat = (id, o) => ({ id, scene: 'room', captions: [], events: [], ...o });

  // =============================================================================================
  // THE SHOP (stage 0): P1 Buy and P2 Broken (GAME_SPEC §4). Film windows, then the live SC.screen.
  // Times copy a1/a2's T chains (a1.js:43-62, a2.js:53-80), measured from the player's click.
  // =============================================================================================
  const SLIDE = .62;                                           // a1.js:41 / a2.js:51
  const Wn = key => (SHOP.WINDOWS && SHOP.WINDOWS[key]) || { a1: [0, 4], a2: [0, 6.2], a3: [0, 4.72] }[key];
  const winDur = key => Wn(key)[1] - Wn(key)[0];
  const AT = () => SC.AT;
  const lin2 = (a, q) => sm(a[0], a[1], q, lin);
  const loadK = (a, q) => (q >= a[0] && q < a[1] + 1 / 24 ? Math.min(.999, lin2(a, q)) : 0);   // a1.js:78
  /** the page change after a click at 0 (a1.js:52): the button is down for SC.PRESS_N drawings, then the slide */
  const slideT = () => [f(SC.PRESS_N), f(SC.PRESS_N) + SLIDE];
  const lit = (page, o = {}) => ({ light: 1, alpha: 1, chrome: 1, head: 1, addr: 1, addrPage: page, page, u: 1, dyn: {}, load: 0, ...o });
  /** a page change at q (a1.js:83-86) */
  function sliding(s, q, s1, to) {
    if (q >= s1[0]) { const k = SC.slideAt(q, s1[0], SLIDE); s.to = to; s.slide = k.slide; s.smear = k.smear; }
    if (q >= s1[1]) { s.page = to; s.to = null; s.slide = 0; s.smear = 0; }
    return s;
  }
  /** The name as the checkout field types it: letters of the fitted name (NAME.install fits it the same way). */
  const typedName = G => NAME.fit(G.drawnName || '', G.nameMode, NAME.BUDGET.field);
  const nameN = G => { const P = SC.D && SC.D.checkout && SC.D.checkout.name; return Math.max(1, (P && P.n) || [...typedName(G)].length); };   // NAME.install's letters (code points or graphemes)
  /** checkout: times after the Buy click (a1.js:52-54: toName, clickName, name at 14 letters/s, addr) */
  function Tco(n) {
    const s1 = slideT(), toName = [s1[1] + .06, s1[1] + .44], click = g12(toName[1] + .08), name = [click + .14, click + .14 + n / 14], addr = [name[1] + .14, name[1] + .76];
    return { s1, load: [.08, s1[1] - .04], toName, click, name, addr, end: addr[1] + .1 };
  }
  /** a page's check, title and note after it slid in (a1.js:56-59, a2.js:73-76) */
  function Tdone(page) {
    const s1 = slideT(), check = [g12(s1[1] + .12), g12(s1[1] + .12) + .3], title = [check[1] + .08, check[1] + .08 + SC.D[page].title.plan.total / 5200];
    return { s1, load: [.08, s1[1] - .04], check, title, note: [title[1], title[1] + .25], rest: [s1[1] + .1, s1[1] + .7] };
  }
  /** reason: times after the Request refund click (a2.js:68-71: toReason, clickReason, 14 letters at 18/s) */
  function Tre() {
    const s1 = slideT(), toReason = [s1[1] + .04, s1[1] + .39], click = g12(toReason[1] + .08), n = (SC.D.reason && SC.D.reason.typed && SC.D.reason.typed.n) || 14, type = [click + .12, click + .12 + n / 18];
    return { s1, load: [.08, s1[1] - .04], toReason, click, n, type, end: type[1] + .1 };
  }
  const shopBeat = (id, o) => ({ id, stage: 0, scene: 'shop', captions: [], events: [], noPlug: 'plugShop', ...o });
  const filmR = (key, q) => ({ film: { act: key, tau: Wn(key)[0] + clamp(q, 0, winDur(key)) } });
  /** a film act's own caption start, relative to the window (a1 .5, a2 at the crack: a2.js:60) */
  const filmCapT = (key, dflt) => { const a = SHOP.act && SHOP.act(key), k = a && a.captions && a.captions[0]; return (k && Number.isFinite(k.t0) ? k.t0 : dflt) - Wn(key)[0]; };

  /** a2's own times after its window (a2.js:53-65), rebuilt from its caption (the one number a2 exports):
   *  T.back from the caption's written time, the wake, "My orders" written at 14000 px/s, the cursor's start. */
  let _a2 = null;
  function Ta2() {
    if (_a2) return _a2;
    const a = SHOP.act && SHOP.act('a2'), k = a && a.captions && a.captions[0], w = k && Number.isFinite(k.written) ? k.written : 4.79;
    const back0 = g12(w - .12), back1 = back0 + .75, wake0 = back1 - .08, o0 = g12(wake0 + .2), o1 = o0 + SC.pageLen('orders') / 14000;
    return (_a2 = { orders: [o0, o1], toRefund: g12(o1 - .2) });
  }
  const shopBeats = [
    // P1: the a1 window (the laptop draws itself, the product page), then the live product page.
    shopBeat('shop.product', {
      dur: () => winDur('a1'), captions: [['buy', filmCapT('a1', .5)]],
      R: (G, q) => filmR('a1', q),
      // the live idle: the cursor enters and looks at the price first (a1.js:45-47: tag, hover, then Buy)
      // unless the player's pointer is on the screen (runtime puts SC.cursor at the pointer)
      hold: { action: 'buy', idle: (G, hq) => {
        const q = tw(hq), A = AT(), hover = [.64, .94], off = [1.48, 1.65];
        return { at: SC.HOME, live: true, screen: lit('product', { dyn: { product: { press: 0, hover: lin2(hover, hq), hoverA: 1 - lin2(off, hq) } },
          cursor: SC.cursorTrack(q, A.enter, [{ t: [0, .6], to: A.tag, lift: 24 }, { t: [1.4, 1.9], to: A.buy, lift: 30 }], []) }) };
      } },
      next: () => 'shop.checkout',
    }),
    // Buy: the button goes down for 3 drawings, the checkout slides in, the cursor clicks the Name field by
    // itself and the player's name types itself (14 letters/s, dyn.name = (k - .5) / n), then the address.
    shopBeat('shop.checkout', {
      dur: G => Tco(nameN(G)).end,
      R: (G, q) => checkoutAt(G, q, null),
      hold: { action: 'pay', idle: (G, hq) => checkoutAt(G, Tco(nameN(G)).end + hq, hq) },
      sfx: G => { const T = Tco(nameN(G)), n = nameN(G), out = [[0, 'click', { k: 0 }], [T.s1[0], 'swipe', { k: 0 }], [T.click, 'click', { k: 1 }]];
        for (let i = 0; i < n; i++) out.push([T.name[0] + i / 14, 'key', { k: i }]); return out; },
      next: () => 'shop.ordered',
    }),
    // Pay: the ordered page, a check, "Order A-1001"; it ends on exactly SC.END_A1 (stageC.js:478).
    shopBeat('shop.ordered', {
      dur: () => Tdone('ordered').title[1] + 1,
      R: (G, q) => {
        const T = Tdone('ordered'), q2 = tw(q), s = lit('checkout', { addrPage: q >= T.load[0] ? 'ordered' : 'checkout', load: loadK(T.load, q) });
        s.dyn = { checkout: { name: 1, addr: 1, caret: 0, press: SC.pressed(q2, 0) }, ordered: { check: lin2(T.check, q), title: lin2(T.title, q), note: lin2(T.note, q) } };
        sliding(s, q, T.s1, 'ordered');
        s.cursor = SC.cursorTrack(q2, AT().pay, [{ t: T.rest, to: AT().rest, lift: 16 }], [0]);
        return { at: SC.HOME, screen: s };
      },
      sfx: () => { const T = Tdone('ordered'); return [[0, 'click', { k: 2 }], [T.s1[0], 'swipe', { k: 1 }], [T.check[0] + .1, 'done']]; },
      next: () => 'shop.broken',
    }),
    // P2: the a2 window (parcel, crack, lean in, back to "My orders"); the caption starts at the crack.
    shopBeat('shop.broken', {
      dur: () => winDur('a2'), captions: [['broken', filmCapT('a2', 3.35)]],   // a2.js:60: at the crack
      R: (G, q) => filmR('a2', q),
      // the live idle goes on exactly as a2 would: "My orders" finishes writing itself (its button last), then
      // the cursor glides to Request refund (a2.js:57-65), unless the player's pointer is on the screen
      hold: { action: 'refund', idle: (G, hq) => { const T = Ta2(), q = tw(hq);
        return { at: SC.HOME, live: true, screen: lit('orders', { u: sm(T.orders[0], T.orders[1], Wn('a2')[1] + hq, lin), dyn: { orders: { press: 0 } },
          cursor: SC.cursorTrack(q, AT().wake, [{ t: [T.toRefund - Wn('a2')[1], T.toRefund - Wn('a2')[1] + .5], to: AT().refund, lift: 30 }], []) }) }; } },
      next: () => 'shop.reason',
    }),
    // Request refund: the reason form; "Arrived broken" types itself (18 letters/s, a2.js:70).
    shopBeat('shop.reason', {
      dur: () => Tre().end,
      R: (G, q) => reasonAt(q, null),
      hold: { action: 'submit', idle: (G, hq) => reasonAt(Tre().end + hq, hq) },
      sfx: () => { const T = Tre(), out = [[0, 'click', { k: 3 }], [T.s1[0], 'swipe', { k: 2 }], [T.click, 'click', { k: 0 }]];
        for (let i = 0; i < T.n; i++) out.push([T.type[0] + i / 18, 'key', { k: i + 3 }]); return out; },
      next: () => 'shop.requested',
    }),
    // Submit: "Refund requested"; it ends on exactly SC.END_A2 (stageC.js:479), a3's first frame.
    shopBeat('shop.requested', {
      dur: () => Tdone('requested').title[1] + .6,
      R: (G, q) => {
        const T = Tdone('requested'), q2 = tw(q), s = lit('reason', { addrPage: q >= T.load[0] ? 'requested' : 'reason', load: loadK(T.load, q) });
        s.dyn = { reason: { typed: 99, caret: 0, press: SC.pressed(q2, 0) }, requested: { check: lin2(T.check, q), title: lin2(T.title, q), note: lin2(T.note, q) } };
        sliding(s, q, T.s1, 'requested');
        s.cursor = SC.cursorTrack(q2, AT().submit, [{ t: T.rest, to: AT().restLow, lift: 16 }], [0]);
        return { at: SC.HOME, screen: s };
      },
      sfx: () => { const T = Tdone('requested'); return [[0, 'click', { k: 1 }], [T.s1[0], 'swipe', { k: 0 }], [T.check[0] + .1, 'done']]; },
      next: () => 's1.wide',
    }),
  ];
  /** the checkout page at q after the Buy click (a1.js:74-102 screenAt, from the click); hq = the pay
   *  hold's idle time (the cursor glides to Pay unless the pointer is on the screen), else null */
  function checkoutAt(G, q, hq) {
    const n = nameN(G), T = Tco(n), q2 = tw(q), A = AT();
    const s = lit('product', { addrPage: q >= T.load[0] ? 'checkout' : 'product', load: loadK(T.load, q) });
    const k = q < T.name[0] ? 0 : Math.min(n, Math.floor((q - T.name[0]) * 14 + 1e-6) + 1);
    let caret = q >= T.click ? (q >= T.name[1] + .1 ? 'addr' : 'name') : 0;
    // the caret blinks (a1.js:94-95): .2 s between the fields, .4 s after the address
    if (caret && q > T.name[1] && q < T.addr[0] && Math.floor((q - T.name[1]) / .2) % 2) caret = 0;
    if (caret && q > T.addr[1] && Math.floor((q - T.addr[1]) / .4) % 2) caret = 0;
    s.dyn = { product: { press: SC.pressed(q2, 0), hover: 0, hoverA: 1 }, checkout: { name: k >= n ? 1 : k ? (k - .5) / n : 0, addr: lin2(T.addr, q), caret, press: 0 } };
    sliding(s, q, T.s1, 'checkout');
    s.cursor = hq === null ? SC.cursorTrack(q2, A.buy, [{ t: T.toName, to: A.name, lift: 30 }], [0, T.click])
      : SC.cursorTrack(tw(hq), A.name, [{ t: [.1, .6], to: A.pay, lift: 30 }], []);
    return { at: SC.HOME, screen: s, live: hq !== null };
  }
  /** the reason page at q after the Request refund click (a2.js:105-131 screenAt, from the click) */
  function reasonAt(q, hq) {
    const T = Tre(), q2 = tw(q), A = AT();
    const s = lit('orders', { addrPage: q >= T.load[0] ? 'reason' : 'orders', load: loadK(T.load, q) });
    const blink = q < T.type[0] || q > T.type[1] ? Math.floor((q - T.click) / .2) % 2 === 0 : true;
    s.dyn = { orders: { press: SC.pressed(q2, 0) }, reason: { typed: q < T.type[0] ? 0 : Math.min(T.n, Math.floor((q - T.type[0]) * 18 + 1e-6) + 1), caret: q >= T.click && blink, press: 0 } };
    sliding(s, q, T.s1, 'reason');
    s.cursor = hq === null ? SC.cursorTrack(q2, A.refund, [{ t: T.toReason, to: A.reason, lift: 20 }], [0, T.click])
      : SC.cursorTrack(tw(hq), A.reason, [{ t: [.1, .55], to: A.submit, lift: 36 }], []);
    return { at: SC.HOME, screen: s, live: hq !== null };
  }

  // =============================================================================================
  // STAGE 1: the request comes in (a3 wide shot 0 -> 4.72, then the room is drawn, the slip lands)
  // =============================================================================================
  // the room's draw-on, timed like a3.js:386-391 (the pencil enters .45 s after the cut; each part at hand
  // speed; moves in proportion to their distance), plus the email and Temporal's notebook (indigo pencil)
  const T1 = { agent: [.45, 1.479], printer: [1.75, 2.049], tray: [2.159, 2.409], mail: [2.52, 2.94], book: [3.6, 4.02] };   // the indigo pencil comes in as the graphite one leaves
  T1.drop = [g12(T1.book[1] + .2), g12(T1.book[1] + .2) + .45];   // a3.js:392 T.drop
  T1.commit = g12(T1.drop[1] + 1);                                 // row 0 ~1 s after the slip lands (GAME_SPEC §4 st. 1)
  T1.end = T1.commit + 1;
  /** Stage 1's clock: the room's drawing, the request's fall and Temporal's pencil are not the worker's, so
   *  they run on the game clock even while the story is frozen (a crash here: the line finishes, glowing). */
  const t1 = (G, q) => (G.frozenQ !== null && G.beat.id === 's1.build' ? Math.max(q, G.clock - G.beat.t0) : q);
  /** The request is Temporal's from the moment it arrives (facts.md §3 event 1: written before any worker
   *  runs), so a crash before row 0's commit cannot lose it: at the plug click the line is written at once
   *  (after the notebook is drawn), with "Workflow started" (GAME_SPEC §4 st. 1 "Crash, any time"). */
  function requestDurable(G) {
    if (G.beat.id !== 's1.build' || G.book[0].t) return;
    const t0 = Math.max(G.clock, G.beat.t0 + T1.book[1] + .1);
    for (const part of ['t', 'c']) { G.book[0][part] = 1; G.ink.push({ row: 0, part, t0 }); }
    G.world.traySlip = 1; log(G, 'started');
  }
  const partTip = {
    agent: u => { const cel = celOf('agent/rest'); return cel ? RMx().celTip(cel, u, SD.AG.x, SD.AG.y) : [SD.AG.x - 110 + 220 * u, SD.AG.y - 300 + 180 * Math.sin(u * 9)]; },   // a3.js:383
    printer: u => RMx().celTip(SD.D.printer, u, SD.PRINTER.x, SD.PRINTER.y),
    tray: u => RMx().celTip(SD.D.tray, u, SD.TRAY.x, SD.TRAY.y),
    mail: u => { const E_ = RMx().ENV, t = RMx().celTip(SD.D.envelope, u, 0, 0), c = Math.cos(E_.rot), s = Math.sin(E_.rot); return [E_.x + (t[0] * c - t[1] * s) * E_.s, E_.y + (t[0] * s + t[1] * c) * E_.s]; },
    // the open notebook (a9.js:109-111 left page, right page, spine), traced
    book: u => { const N = ROOM.NB, cel = celOf('a9/nb-open'); if (cel) return RMx().celTip(cel, clamp(u, 0, 1), N.x, N.y); const P = [[-4, -2], [-92, 2], [-78, -50], [-4, -52], [4, -52], [78, -50], [92, 2], [4, -2]], k = clamp(u, 0, 1) * (P.length - 1), i = Math.min(P.length - 2, Math.floor(k)), t = k - i;
      return [N.x + lerp(P[i][0], P[i + 1][0], t), N.y + lerp(P[i][1], P[i + 1][1], t)]; },
  };
  /** the pencils while the room is drawn: graphite for the agent, printer, tray and email; Temporal's indigo
   *  pencil draws its own notebook. Between parts the graphite pencil glides lifted (a3's makeStage pencil). */
  function buildPencils(q) {
    const out = [], P = ['agent', 'printer', 'tray', 'mail'];
    let g = null;
    if (q < T1.agent[0]) { const u = sm(0, T1.agent[0], q, easeOut); g = pencil([lerp(HOME.graphite[0], partTip.agent(0)[0], u), lerp(HOME.graphite[1], partTip.agent(0)[1], u)], 'graphite', 1 - u); }
    else for (let i = 0; i < P.length; i++) {
      const a = T1[P[i]];
      if (q < a[1]) { g = pencil(partTip[P[i]](sm(a[0], a[1], q, lin)), 'graphite', 0); break; }
      const nx = P[i + 1];
      if (nx && q < T1[nx][0]) { const u = sm(a[1], T1[nx][0], q, easeInOutSine), A = partTip[P[i]](1), B = partTip[nx](0); g = pencil([lerp(A[0], B[0], u), lerp(A[1], B[1], u)], 'graphite', Math.sin(Math.PI * u)); break; }
      if (!nx && q < a[1] + .6) { const u = sm(a[1], a[1] + .6, q, easeIn), A = partTip[P[i]](1); g = pencil([lerp(A[0], HOME.graphite[0], u), lerp(A[1], HOME.graphite[1], u)], 'graphite', u * 2); }
    }
    if (g) out.push(g);
    const B = T1.book, r0 = rowTip(0, 't', 0);
    if (q >= B[0] - .45 && q < B[0]) { const u = sm(B[0] - .45, B[0], q, easeOut), A = partTip.book(0); out.push(pencil([lerp(HOME.indigo[0], A[0], u), lerp(HOME.indigo[1], A[1], u)], 'indigo', 1 - u)); }
    else if (q >= B[0] && q < B[1]) out.push(pencil(partTip.book(sm(B[0], B[1], q, lin)), 'indigo', 0));
    else if (q >= B[1]) { const u = sm(B[1], B[1] + .4, q, easeInOutSine), A = partTip.book(1); out.push(pencil([lerp(A[0], r0[0] - 8, u), lerp(A[1], r0[1] - 26, u)], 'indigo', .2 + .5 * u)); }   // it waits over the page for the request
    return out;
  }
  /** the request dropping into the tray (a3.js:429-434 slipState, re-timed) */
  function dropSlip(q) {
    const S = RMx().TRAY_SLIP;
    if (q < T1.drop[0] || q >= T1.drop[1]) return null;
    const u = sm(T1.drop[0], T1.drop[1], q, easeIn), p = bez([1660, -60], [1560, 260], [1260, 560], [S.x, S.y], u), at = { x: p[0], y: p[1], s: S.s, rot: lerp(.9, S.rot, u) };
    return u > .8 ? { ...at, clipY: RMx().TRAY_LIP, tray: true } : at;
  }
  const s1Beats = [
    { id: 's1.wide', stage: 1, scene: 'wide', captions: [], events: [], noPlug: 'plugWide',
      dur: () => winDur('a3'), R: (G, q) => filmR('a3', q), next: () => 's1.build' },
    // the pencil draws the room (the plug is not live until the room exists: GAME DECISION, see the report)
    // the pencil draws the room, the request drops into the tray, Temporal writes it down (row 0, text and
    // check together): "Workflow started"
    roomBeat('s1.build', { stage: 1, dur: T1.end, captions: [['s1', .75], ['s1b', T1.commit]],   // a3.js:398: t0 = agent start + .3
      commit: [{ t: T1.commit, row: 0, part: 't' }, { t: T1.commit, row: 0, part: 'c' }],
      events: [[T1.drop[1], G => { G.world.traySlip = 1; }], [T1.commit, G => log(G, 'started')]],
      cls: () => 'any', recover: () => 's2.read', outcome: () => 'out1',
      sfx: [[T1.agent[0], 'pencil', { dur: T1.mail[1] - T1.agent[0], gate: 1 }], [T1.book[0], 'pencil', { dur: T1.book[1] - T1.book[0], gate: .6 }], [T1.drop[1] - .05, 'paper', { k: 0 }]],
      R: (G, q) => {
        const R = base(G, beats['s1.build'], q), q2 = tw(q), qc = q;
        q = t1(G, q);
        R.parts = { agent: sm(T1.agent[0], T1.agent[1], q, lin), printer: sm(T1.printer[0], T1.printer[1], q, lin), tray: sm(T1.tray[0], T1.tray[1], q, lin), book: sm(T1.book[0], T1.book[1], q, lin), clock: 1 };
        R.envelope = q < T1.mail[0] ? { state: 'none', u: 0, fly: 0 } : { state: 'desk', u: sm(T1.mail[0], T1.mail[1], q, lin), fly: 0 };
        R.face = look(q2, [[0, 'open'], [g12(T1.drop[0] + f(1)), 'sideR'], [g12(T1.commit - f(3)), 'side']], [g12(T1.agent[1] + .55), g12(T1.drop[1] + .5)]);   // a3.js:420-422; he looks at the notebook as it writes
        R.slip = dropSlip(q); R.traySlip = q >= T1.drop[1] || G.world.traySlip ? 1 : 0;
        // Temporal's pencil: it draws the notebook, waits over the page, then writes the request (inkPencil)
        const ink = inkPencil(G, beats['s1.build'], qc), bp = buildPencils(q);
        R.pencils = ink ? [...bp.filter(p => p.color !== 'indigo'), ink] : q >= T1.commit + 1 ? bp.filter(p => p.color !== 'indigo') : bp;
        return R;
      },
      next: () => 's1.req' }),
    // Temporal writes the request down (row 0, text and check together): "Workflow started".
    // he waits while the caption finishes (s1b: ~5.1 s from the commit)
    roomBeat('s1.req', { stage: 1, dur: 4.25,
      cls: () => 'any', recover: () => 's2.read', outcome: () => 'out1',
      R: (G, q) => { const R = base(G, beats['s1.req'], q), q2 = tw(q); R.face = look(q2, [[0, 'side'], [.5, 'open']], [1.25, 3.5]); return R; },
      next: () => 's2.read' }),
  ];

  // =============================================================================================
  // STAGE 2: Claude step 1 reads the request (a3 8.0 -> 10.0, then 'chin'); a crash: a5's re-read
  // =============================================================================================
  /** The read: anticipation, LOWREACH, grab, READ (face down), put back, release (a3.js:393-395, :402-404,
   *  :429-437), then 'chin' for .6 s. L = the anticipation's time; pb / rl = put back / release after L
   *  (a3: 1.583 / 1.833; a5.js:40-41: 1.333 / 1.583). */
  function readPerf(q, L, pb, rl) {
    const T = { antic: L, reach: L + .25, grab: L + .54, toRead: L + .583, read: L + .96, putBack: L + pb, release: L + rl, chin: L + rl + .25, back: L + rl + 1.1 };
    const pose = track(q, [[0, 'rest'], [T.antic, ANTIC(), .12], [T.reach, 'LOWREACH', .25, easeOut], [T.toRead, 'READ', .3], [T.putBack, 'LOWREACH', .25],
      [T.release, 'rest', .17], [T.chin, 'chin', .25], [T.back, 'rest', .25]]);
    const face = look(q, [[0, 'sideR'], [T.toRead, 'down'], [T.putBack, 'sideR'], [T.chin, 'open']], [g12(T.read + .42), g12(T.chin + .5)]);
    let held = null, traySlip = 1, slip = null;
    if (q >= T.grab && q < T.putBack + .25) { held = q < T.putBack ? easeIO(clamp((q - T.toRead) / .3, 0, 1)) : 1 - easeIO(clamp((q - T.putBack) / .25, 0, 1)); traySlip = 0; }
    else if (q >= T.putBack + .25 && q < T.release) { held = 0; traySlip = 0; }
    else if (q >= T.release && q < T.release + .17) { const u = sm(T.release, T.release + .17, q, easeIn), S = RMx().TRAY_SLIP; traySlip = 0;
      slip = { x: lerp(1170, S.x, u), y: lerp(736, S.y, u), s: S.s, rot: lerp(-.1, S.rot, u), clipY: RMx().TRAY_LIP, tray: true }; }
    return { pose, face, held, traySlip, slip, T, dur: T.back + .25 };
  }
  const READ2 = { L: .5, pb: 1.583, rl: 1.833 }, REREAD = { L: f(1), pb: f(16), rl: f(19) };   // a3 / a5 (a5.js:37-41, from 'notice')
  const readBeat = (id, P, o) => roomBeat(id, { stage: 2, dur: readPerf(0, P.L, P.pb, P.rl).dur,
    cls: () => 'any', recover: () => 'r2.reread', outcome: () => 'out2',
    sfx: [[P.L + .96, 'slip', { k: 0 }]],
    R: (G, q) => { const R = base(G, beats[id], q), p = readPerf(tw(q), P.L, P.pb, P.rl); Object.assign(R, { pose: p.pose, face: p.face, held: p.held, traySlip: p.traySlip, slip: p.slip }); return R; },
    next: () => 's3.pause', ...o });
  const s2Beats = [
    readBeat('s2.read', READ2, { dur: 5.25, captions: ['s2'], events: [[0, G => { run(G, 'step1', false); log(G, 'step1Scheduled'); }]] }),
    // step 1 runs again and starts over from the request (a5 3.833-5.5 re-timed; claude_sdk.py:140-150)
    readBeat('r2.reread', REREAD, { events: [[0, G => run(G, 'step1', true)]] }),
  ];

  // =============================================================================================
  // STAGE 3: Claude pauses; the look_up_order slip rises out of his badge (a8 rise/fly); pause face
  // =============================================================================================
  // the ask: a dip (anticipation), his arm goes up toward the waiting place, the slip rises, he waits
  const ASK = o => ({ dip: o, point: o + f(1), face: o + f(4), rise: [o + f(4), o + f(4) + .55], fly: [o + f(4) + .55, o + f(4) + 1.3], down: o + f(4) + 1.42, pause: [o + f(4) + 1.42, o + f(4) + 1.67] });
  const A3 = ASK(.167), C3 = 3;
  const s3Beats = [
    roomBeat('s3.pause', { stage: 3, dur: 4.75, captions: ['s3'],
      commit: { t: C3, row: 1, part: 't' }, events: [[C3, G => log(G, 'step1Done')]],
      cls: G => (G.book[1].t ? 'after' : 'before'), recover: G => (G.book[1].t ? 's4.run' : 'r2.reread'), outcome: G => (G.book[1].t ? 'outSkip' : 'out2'),
      sfx: [[A3.rise[0], 'paper', { k: 1 }], [A3.fly[0], 'whoosh', { dir: 1 }]],
      R: (G, q) => {
        const R = base(G, beats['s3.pause'], q), q2 = tw(q);
        R.pose = track(q2, [[0, 'rest'], [A3.dip, DIP(), 0], [A3.point, 'point', .25, easeOut], [A3.down, 'rest', .25]]);
        R.face = look(q2, [[0, 'open'], [A3.point, 'sideR'], [A3.face, 'pause']], [f(1)]);
        R.wait = slipOut('look_up_order', q2, A3.rise, A3.fly, { pause: sm(A3.pause[0], A3.pause[1], q2, lin), wob: wobAt(q2, [2.5, 3.75]) });
        return R;
      },
      next: () => 's4.run' }),
  ];

  // =============================================================================================
  // STAGE 4: Temporal runs the tool; the cabinet acts by itself (a3 drawer/folder, a7 dash, a8 flip)
  // =============================================================================================
  const T4 = { dash: [f(1), f(7)], dashOut: [f(25), f(29)], drawer: f(9), folder: [f(10), f(15)], flipA: [f(18), f(20)], flipB: [f(20), f(22)], commit: 2, sink: [f(29), f(32)], shut: f(32) };
  function lookupR(G, q, id) {
    const R = base(G, beats[id], q), q2 = tw(q), fl = flip(q2, T4.flipA, T4.flipB, 'look_up_order', 'answer');
    R.face = 'pause';
    R.dash = q2 >= T4.dash[0] && q2 < T4.dashOut[1] ? { u: sm(T4.dash[0], T4.dash[1], q2, easeOut), alpha: 1 - sm(T4.dashOut[0], T4.dashOut[1], q2, lin) } : null;
    // the drawer: two drawings each way (a3.js:441), the folder rises (easeOutBack 1.4) and sinks (a3.js:442)
    R.drawer = q2 < T4.drawer ? 0 : q2 < T4.drawer + f(1) ? .5 : q2 < T4.shut ? 1 : q2 < T4.shut + f(1) ? .5 : 0;
    R.folder = q2 < T4.folder[0] ? 0 : q2 < T4.sink[0] ? easeOutBack(clamp((q2 - T4.folder[0]) / (T4.folder[1] - T4.folder[0]), 0, 1), 1.4) : 1 - sm(T4.sink[0], T4.sink[1], q2, easeIn);
    R.wait = slipAt(fl.which, WAITP(), { sy: fl.sy, wob: wobAt(q2, [2.75]) });
    return R;
  }
  const lookupBeat = (id, retry, o = {}) => roomBeat(id, { stage: 4, dur: 3.25,
    commit: { t: T4.commit, row: 1, part: 'c' },
    events: [[0, G => { run(G, 'lookup', retry); if (!retry) log(G, 'lookupScheduled'); }], [T4.commit, G => log(G, 'lookupDone')]],
    cls: G => (G.book[1].c ? 'after' : 'before'), recover: G => (G.book[1].c ? 's5.cont' : 'r4.run'), outcome: G => (G.book[1].c ? 'outSkip' : 'out4'),
    sfx: [[T4.drawer, 'drawer', { open: true }], [T4.shut, 'drawer', { open: false }]],
    R: (G, q) => lookupR(G, q, id), next: () => 's5.cont', ...o });
  const s4Beats = [lookupBeat('s4.run', false, { dur: 5.25, captions: ['s4'] }), lookupBeat('r4.run', true)];   // s4.run waits out its caption (5.2 s)

  // =============================================================================================
  // STAGE 5: the answer goes back into his badge, he reads and types, the issue_refund slip goes out
  // =============================================================================================
  // BACK: a8 back/sink re-timed (a8.js:136-137, 6 + 4 drawings); then 'chin' and 'sideR' (reads), typing
  // (typeA/typeB 4 frames each, the keys dip), then the next ask (ASK).
  const BACK = { back: [f(3), f(9)], sink: [f(9), f(13)] };
  const T5 = { chin: f(14), down: f(23), typeA: f(22), type: [f(24), f(34)], ask: ASK(f(35) - f(1)), commit: 5, end: 6.25 };
  /** his performance after an answer came back in (q from the BACK start), for steps 2 and 3-4 */
  function thinkType(q, t, faceAfter = 'sideR') {
    const pose = q >= t.type[0] && q < t.type[1] ? typing(q, t.type[0]) : track(q, [[0, 'rest'], [t.chin, 'chin', .25], [t.typeA, 'typeA', f(2)], [t.ask.point, 'point', .25, easeOut], [t.ask.down, 'rest', .25]]);
    const face = look(q, [[0, 'pause'], [BACK.sink[1], faceAfter], [t.down, 'down'], [t.type[1], 'open'], [t.ask.face, 'pause']], [g12(BACK.sink[1] + .5)]);
    return { pose, face };
  }
  /** the saved answer out of the notebook (1.25 s), for a resumed step: then the step goes on as if its
   *  answer had just gone back in (at BACK.sink[1]) */
  const INTRO = { rise: [f(3), f(7)], fly: [f(7), f(12)], sink: [f(12), f(15)], len: f(15) };
  const shiftQ = (q, intro) => (intro ? q - INTRO.len + BACK.sink[1] : q);
  function stepR(G, q, id, o) {
    const R = base(G, beats[id], q), q2 = tw(q), x = shiftQ(q2, o.intro);
    if (o.intro && q2 < INTRO.len) {
      R.pose = 'rest'; R.face = look(q2, [[0, 'side'], [INTRO.sink[0], 'open']]);
      R.wait = slipFromBook(o.answer, q2, INTRO.rise, INTRO.fly, INTRO.sink, o.answerO ?? {});
      return R;
    }
    Object.assign(R, o.perf(x));
    R.wait = x < BACK.sink[1] ? slipBack(o.answer, x, BACK.back, BACK.sink, { pause: 1 - sm(BACK.sink[0], BACK.sink[1], x, lin), ...(o.answerO ?? {}) })
      : o.ask ? slipOut(o.ask.which, x, o.ask.t.rise, o.ask.t.fly, { pause: sm(o.ask.t.pause[0], o.ask.t.pause[1], x, lin), wob: wobAt(x, o.ask.wob ?? []) }) : null;
    return R;
  }
  const off = intro => (intro ? INTRO.len - BACK.sink[1] : 0);
  const step2Beat = (id, intro, o = {}) => roomBeat(id, { stage: 5, dur: T5.end + off(intro),
    commit: { t: T5.commit + off(intro), row: 2, part: 't' },
    events: [[0, G => run(G, 'step2', intro)], [T5.commit + off(intro), G => log(G, 'step2Done')]],
    cls: G => (G.book[2].t ? 'after' : 'before'), recover: G => (G.book[2].t ? 's6.wait' : 'r5.resume'), outcome: G => (G.book[2].t ? 'outSkip' : 'out5'),
    sfx: [...(intro ? [[INTRO.rise[0], 'paper', { k: 2 }]] : []), [BACK.sink[0] + off(intro), 'paper', { k: 1 }], [T5.type[0] + off(intro), 'keys', { dur: T5.type[1] - T5.type[0], kind: 'agent' }],
      [T5.ask.rise[0] + off(intro), 'paper', { k: 2 }], [T5.ask.fly[0] + off(intro), 'whoosh', { dir: 1 }]],
    R: (G, q) => stepR(G, q, id, { intro, answer: 'answer', perf: x => thinkType(x, T5), ask: { which: 'issue_refund', t: T5.ask, wob: [5.5] } }),
    next: () => 's6.wait', ...o });
  const s5Beats = [step2Beat('s5.cont', false, { captions: ['s5'] }), step2Beat('r5.resume', true)];

  // =============================================================================================
  // STAGE 6: you approve. The a8 clock, the waiting slip's fidget, the pause face; the stamp (a8)
  // =============================================================================================
  const T6 = { clock: [f(3), f(10)], wob: 1.25, dur: 4.25 };
  /** the minute hand follows the game clock (GAME_SPEC §4 st. 6; a8.js:94 minuteAngle), on twos: one turn
   *  per 6 s. On G.clock, so it runs on across the approval and never jumps. */
  const minute = G => TAU_ * tw(G.clock) / 6;
  const wordOf = d => (d === 'reject' ? 'rejected' : 'approved');
  function waitR(G, q) {
    const R = base(G, beats['s6.wait'], q), q2 = tw(q);
    R.face = 'pause';
    R.clock = { u: sm(T6.clock[0], T6.clock[1], q2, lin), angle: minute(G), alpha: 1 };
    R.wait = slipAt('issue_refund', WAITP(), { wob: wobEvery(q2, T6.wob) });
    // decided while the power was off: the stamp hovers high (drawing 0) until the notes are done (st. 6)
    if (G.approval.queued) R.stamp = { k: 0, word: wordOf(G.approval.queued), hover: true };
    // a8's pencil draws the clock (face, then the hands), a graphite pencil around the dial
    if (q2 >= T6.clock[0] - .3 && q2 < T6.clock[1] + .5) {
      const C = ROOM.CLOCK, u = sm(T6.clock[0], T6.clock[1], q, lin), fu = clamp(u / .72, 0, 1);   // room.js drawClock: the face to .72, then the hands
      const t = u < .72 ? RMx().celTip(SB.D.clock, fu, 0, 0) : [0, -18 * clamp((u - .72) / .28, 0, 1)], at = [C.x + t[0] * C.s, C.y + t[1] * C.s];
      const p = q < T6.clock[0] ? [lerp(HOME.graphite[0], at[0], sm(T6.clock[0] - .3, T6.clock[0], q, easeOut)), lerp(HOME.graphite[1], at[1], sm(T6.clock[0] - .3, T6.clock[0], q, easeOut))]
        : q < T6.clock[1] ? at : [lerp(at[0], HOME.graphite[0], sm(T6.clock[1], T6.clock[1] + .5, q, easeIn)), lerp(at[1], HOME.graphite[1], sm(T6.clock[1], T6.clock[1] + .5, q, easeIn))];
      R.pencils = [...R.pencils, pencil(p, 'graphite', q < T6.clock[0] ? 1 - sm(T6.clock[0] - .3, T6.clock[0], q, lin) : q < T6.clock[1] ? 0 : sm(T6.clock[1], T6.clock[1] + .5, q, lin) * 2)];
    }
    return R;
  }
  // a8 stampPose by drawing index (a8.js:162-173): K_IMPACT 2, K_LIFT 6, K_END 10 drawings from the fall
  const T6s = { impact: f(2), lift: f(6), end: f(10), clockOut: [f(8), f(13)], dur: 1.25 };
  function stampR(G, q, id, word) {
    const R = base(G, beats[id], q), q2 = tw(q), k = Math.round(q2 * 12);
    R.face = 'pause';
    R.stamp = k < 10 ? { k, word } : null;
    R.clock = q2 < T6s.clockOut[1] ? { u: 1, angle: minute(G), alpha: 1 - sm(T6s.clockOut[0], T6s.clockOut[1], q2, lin) } : null;
    R.wait = slipAt('issue_refund', WAITP(), { [word]: q2 >= T6s.impact ? 1 : 0, pause: 1 - sm(T6s.impact, T6s.impact + f(6), q2, lin) });
    return R;
  }
  const stampBeat = (id, word) => roomBeat(id, { stage: 6, dur: T6s.dur,
    commit: word === 'approved' ? [{ t: T6s.impact, row: 3, part: 't' }, { t: T6s.impact, row: 3, part: 'c' }]
      : [{ t: T6s.impact, row: 2, part: 'strike' }, { t: T6s.impact, row: 3, part: 't' }, { t: T6s.impact, row: 3, part: 'c' }],
    events: [[T6s.impact, G => { G.approval.waiting = false; log(G, word); }]],
    cls: G => (G.book[3].t ? 'after' : 'wait'),
    recover: G => (G.book[3].t ? (G.branch === 'reject' ? 'rj.step3' : 's7.refund') : id),   // before the impact: it resumes and presses
    outcome: G => (G.book[3].t ? 'outSkip' : 'out6'),
    sfx: [[T6s.impact, 'stamp']],
    R: (G, q) => stampR(G, q, id, word),
    next: () => (word === 'approved' ? 's7.refund' : 'rj.step3') });
  const s6Beats = [
    roomBeat('s6.wait', { stage: 6, dur: T6.dur, captions: ['s6', 's6b'],
      events: [[0, G => { G.approval.waiting = true; }]],
      cls: () => 'wait', recover: G => G.beat.id, outcome: () => 'out6',
      sfx: [[f(1), 'lock']],
      R: (G, q) => waitR(G, q),
      hold: { action: 'approve', idle: (G, hq) => waitR(G, T6.dur + hq) },
      next: G => (G.approval.decision === 'reject' ? 's6.stampR' : 's6.stamp') }),
    stampBeat('s6.stamp', 'approved'), stampBeat('s6.stampR', 'rejected'),
  ];

  // =============================================================================================
  // STAGE 7: the refund happens once. The printer acts by itself (a9 receipt), t_m, t_c, the flip.
  // =============================================================================================
  const T7 = { dip: [f(1), f(4)], print: [f(6), f(13)], tm: f(13), tc: f(27), flipA: [f(28), f(30)], flipB: [f(30), f(32)], dur: 3.25 };
  /** mode: 'first' (it prints), 'again' (a crash before t_m: it runs again with the same number and the
   *  receipt finishes printing), 'money' (a crash between t_m and t_c: the LED blinks, no new paper) */
  function refundR(G, q, id, mode) {
    const R = base(G, beats[id], q), q2 = tw(q), fl = flip(q2, T7.flipA, T7.flipB, 'issue_refund', 'refund_id'), e0 = mode === 'again' ? clamp(G.world.receiptE ?? 0, 0, 150) : 0;
    R.face = 'pause';
    R.led = q2 >= T7.print[0] && q2 < T7.print[1] && Math.floor(q2 * 6 + 1e-6) % 2 === 0 ? 1 : 0;   // a3.js:446, a9.js:269
    if (mode !== 'money' && !G.world.receiptOut) R.receipt = { e: q < T7.print[0] ? e0 : lerp(e0, 150, sm(T7.print[0], T7.print[1], q, lin)), check: 0 };
    const dy = mode === 'first' ? 18 * sm(T7.dip[0], T7.dip[1], q2, easeIO) : 18;   // the approved slip goes to the printer side
    R.wait = slipAt(fl.which, [ROOM.WAIT.x, ROOM.WAIT.y + dy], { sy: fl.sy, approved: fl.which === 'issue_refund' ? 1 : 0, wob: wobAt(q2, [2.75]) });
    return R;
  }
  const refundBeat = (id, mode, o = {}) => {
    const ev = [[0, G => { run(G, 'refund', mode !== 'first'); if (mode === 'first') log(G, 'refundScheduled'); }]];
    // the paper that is out belongs to the shop's printer (G.world.receiptE): a crash stops it where it is
    if (mode !== 'money') for (let i = 0; i <= 14; i++) { const t = T7.print[0] + i / 24; ev.push([t, G => { if (!G.world.receiptOut) G.world.receiptE = Math.max(G.world.receiptE ?? 0, refundR(G, t, id, mode).receipt.e); }]); }
    // t_m: the shop records the refund (it keeps one per receipt number: shop.py:38-45)
    ev.push([T7.tm, G => { G.world.refunds = Math.max(G.world.refunds, 1); G.world.receiptOut = 1; G.world.receiptE = 150; }]);
    ev.push([T7.tc, G => log(G, 'refundDone')]);
    return roomBeat(id, { stage: 7, dur: T7.dur, events: ev.sort((a, b) => a[0] - b[0]),
      commit: { t: T7.tc, row: 2, part: 'c' },
      cls: G => (G.book[2].c ? 'after' : G.world.refunds ? 'money' : 'before'),
      recover: G => (G.book[2].c ? 's8.step3' : G.world.refunds ? 'r7.money' : 'r7.again'),
      outcome: G => (G.book[2].c ? 'outSkip' : G.world.refunds ? 'out7money' : 'out7before'),
      sfx: mode === 'money' ? [] : [[T7.print[0], 'print', { dur: T7.print[1] - T7.print[0] }]],
      R: (G, q) => refundR(G, q, id, mode), next: () => 's8.step3', ...o });
  };
  const s7Beats = [refundBeat('s7.refund', 'first', { dur: 5.5, captions: ['s7'] }), refundBeat('r7.again', 'again'), refundBeat('r7.money', 'money')];

  // =============================================================================================
  // STAGE 8: step 3 (a9 RLOOK + nod), the email flies by itself (a9 flightAt), step 4 types the answer
  // =============================================================================================
  const T8a = { look: f(15), nod: f(21), rest: f(27), ask: ASK(f(32)), commit: 4.75, end: 5.5 };
  function step3Perf(x) {
    const t = T8a, pose = track(x, [[0, 'rest'], [t.look, 'RLOOK', .25, easeOut], [t.nod, 'RLOOK_NOD', 0], [t.nod + f(2), 'RLOOK', 0], [t.rest, 'rest', .25],
      [t.ask.dip, DIP(), 0], [t.ask.point, 'point', .25, easeOut], [t.ask.down, 'rest', .25]]);   // a9.js:167-168 POSES2 look2/nod
    const face = look(x, [[0, 'pause'], [BACK.sink[1], 'sideR'], [t.nod, 'happy'], [t.rest, 'open'], [t.ask.face, 'pause']], [g12(t.rest + .35)]);
    return { pose, face };
  }
  const step3Beat = (id, intro, o = {}) => roomBeat(id, { stage: 8, dur: T8a.end + off(intro),
    commit: { t: T8a.commit + off(intro), row: 4, part: 't' },
    events: [[0, G => run(G, 'step3', intro)], [T8a.commit + off(intro), G => log(G, 'step3Done')]],
    cls: G => (G.book[4].t ? 'after' : 'before'), recover: G => (G.book[4].t ? 's8.email' : 'r8.step3'), outcome: G => (G.book[4].t ? 'outSkip' : 'out8step3'),
    sfx: [...(intro ? [[INTRO.rise[0], 'paper', { k: 2 }]] : []), [BACK.sink[0] + off(intro), 'paper', { k: 1 }], [T8a.nod + off(intro), 'nod'],
      [T8a.ask.rise[0] + off(intro), 'paper', { k: 2 }], [T8a.ask.fly[0] + off(intro), 'whoosh', { dir: 1 }]],
    R: (G, q) => stepR(G, q, id, { intro, answer: 'refund_id', perf: step3Perf, ask: { which: 'email_customer', t: T8a.ask, wob: [] } }),
    next: () => 's8.email', ...o });
  // the email: Temporal runs email_customer; the envelope hops and flies off by itself (a9.js:214-223)
  const T8e = { hop: [f(4), f(6)], fly: [f(6), f(6) + .92], commit: f(26), dur: 2.75 };
  T8e.tm = T8e.fly[1];
  function emailR(G, q, id) {
    const R = base(G, beats[id], q), q2 = tw(q);
    R.face = 'pause';
    R.wait = slipAt('email_customer', WAITP(), { wob: wobAt(q2, [2.25]) });
    if (!G.world.envelopeSent) R.envelope = q < T8e.hop[0] ? { state: 'desk', u: 1, fly: 0 } : q < T8e.fly[1] ? { state: 'fly', u: 1, fly: sm(T8e.hop[0], T8e.fly[1], q, lin) } : { state: 'gone', u: 1, fly: 1 };
    return R;
  }
  const emailBeat = (id, retry, o = {}) => roomBeat(id, { stage: 8, dur: T8e.dur,
    commit: { t: T8e.commit, row: 4, part: 'c' },
    // the shop keeps one email per receipt number (shop.py:48-54)
    events: [[0, G => run(G, 'email', retry)], [T8e.tm, G => { G.world.emails = Math.max(G.world.emails, 1); G.world.envelopeSent = 1; }], [T8e.commit, G => log(G, 'emailDone')]],
    cls: G => (G.book[4].c ? 'after' : 'before'), recover: G => (G.book[4].c ? 's8.step4' : 'r8.email'), outcome: G => (G.book[4].c ? 'outSkip' : 'out8email'),
    sfx: G => (G.world.envelopeSent && retry ? [] : [[T8e.hop[0] + f(1), 'whoosh', { dir: 1 }]]),
    R: (G, q) => emailR(G, q, id), next: () => 's8.step4', ...o });
  // step 4: the email's answer goes back in, he types his final answer; row 5 'done'; the workflow completes
  const T8d = { type: [f(16), f(26)], typeA: f(14), down: f(14), rest: f(27), commit: f(31), end: 3.5 };
  function step4Perf(x) {
    const t = T8d, pose = x >= t.type[0] && x < t.type[1] ? typing(x, t.type[0]) : track(x, [[0, 'rest'], [t.typeA, 'typeA', f(2)], [t.rest, 'rest', .25]]);
    const face = look(x, [[0, 'pause'], [BACK.sink[1], 'sideR'], [t.down, 'down'], [t.rest, 'open']], [g12(t.rest + .5)]);
    return { pose, face };
  }
  const step4Beat = (id, intro, o = {}) => roomBeat(id, { stage: 8, dur: T8d.end + off(intro),
    commit: [{ t: T8d.commit + off(intro), row: 5, part: 't' }, { t: T8d.commit + off(intro), row: 5, part: 'c' }],
    events: [[0, G => run(G, 'step4', intro)], [T8d.commit + off(intro), G => { log(G, 'step4Done'); log(G, 'completed'); }]],
    cls: G => (G.book[5].t ? 'after' : 'before'), recover: G => (G.book[5].t ? 's9.done' : 'r8.step4'), outcome: G => (G.book[5].t ? 'out9' : 'out8step4'),
    sfx: [...(intro ? [[INTRO.rise[0], 'paper', { k: 2 }]] : []), [BACK.sink[0] + off(intro), 'paper', { k: 1 }], [T8d.type[0] + off(intro), 'keys', { dur: T8d.type[1] - T8d.type[0], kind: 'agent' }]],
    R: (G, q) => stepR(G, q, id, { intro, answer: 'email_customer', perf: step4Perf, ask: null }),
    next: () => 's9.done', ...o });
  const s8Beats = [step3Beat('s8.step3', false, { captions: ['s8'] }), step3Beat('r8.step3', true), emailBeat('s8.email', false), emailBeat('r8.email', true),
    step4Beat('s8.step4', false), step4Beat('r8.step4', true)];

  // =============================================================================================
  // STAGE 9: done. The green check on the one receipt (a9 green), his cheer, then the refund email page
  // =============================================================================================
  const T9 = { green: [f(6), f(11)], happy: f(11), cheer: [f(12), f(16)], cheerOut: [f(29), f(33)], end: 4.25 };
  const GREEN = () => ({ x: SD.PRINTER.x + MINI_RECEIPT.w / 2 + 14, y: SD.PRINTER.y - SD.PRINTER.slot - 30 });   // a9.js:218
  const greenTip = u => { const G_ = GREEN(), cel = celOf('a9/green'); if (cel) return RMx().celTip(cel, clamp(u, 0, 1), G_.x, G_.y); const P = [[-14, 0], [-4, 10], [18, -18]].map(([x, y]) => [x * 1.8, y * 1.8]), k = clamp(u, 0, 1) * 2, i = Math.min(1, Math.floor(k)), t = k - i;
    return [G_.x + lerp(P[i][0], P[i + 1][0], t), G_.y + lerp(P[i][1], P[i + 1][1], t)]; };
  function doneR(G, q) {
    const R = base(G, beats['s9.done'], q), q2 = tw(q), gu = sm(T9.green[0], T9.green[1], q, lin);
    R.receipt = { e: 150, check: gu };
    R.pose = track(q2, [[0, 'rest'], [T9.cheer[0], 'cheer', T9.cheer[1] - T9.cheer[0], easeOut], [T9.cheerOut[0], 'rest', T9.cheerOut[1] - T9.cheerOut[0]]]);   // a9.js:169
    R.face = look(q2, [[0, 'sideR'], [T9.happy, 'happy']], [f(2)]);
    const A = greenTip(0), B = greenTip(1);
    if (q >= T9.green[0] - .4 && q < T9.green[0]) { const u = sm(T9.green[0] - .4, T9.green[0], q, easeOut); R.pencils = [...R.pencils, pencil([lerp(HOME.green[0], A[0], u), lerp(HOME.green[1], A[1], u)], 'green', 1 - u)]; }
    else if (q >= T9.green[0] && q < T9.green[1]) R.pencils = [...R.pencils, pencil(greenTip(gu), 'green', 0)];
    else if (q >= T9.green[1] && q < T9.green[1] + .5) { const u = sm(T9.green[1], T9.green[1] + .5, q, easeIn); R.pencils = [...R.pencils, pencil([lerp(B[0], HOME.green[0], u), lerp(B[1], HOME.green[1], u)], 'green', u * 2)]; }
    return R;
  }
  /** the refund email page (a new page cloned from D.requested; shop.js draws it): it wakes and writes itself */
  const T9m = { wake: [0, f(3)], page: [f(3), f(3) + .7], end: 5 };
  function mailR(G, q) {
    const q2 = tw(q), w = sm(T9m.wake[0], T9m.wake[1], q2, easeOut), u = sm(T9m.page[0], T9m.page[1], q, lin);
    return { at: SC.HOME, name: { text: NAME.fit(G.drawnName || '', G.nameMode, NAME.BUDGET.mail), mode: G.nameMode },
      screen: lit('mail', { light: w * (1 + .4 * (1 - sm(T9m.wake[1], T9m.wake[1] + .3, q2, easeOut))), alpha: sm(0, f(2), q2, lin), u,
        dyn: { mail: { title: u, note: u } }, cursor: { x: 424, y: 268, a: 1 } }) };   // a2.js:109 wake; the cursor rests clear of the note's last line
  }
  const s9Beats = [
    roomBeat('s9.done', { stage: 9, dur: T9.end, captions: ['s9'],
      cls: () => 'any', recover: G => G.beat.id, outcome: () => 'out9',
      sfx: [[T9.cheer[0], 'ding']],
      R: (G, q) => doneR(G, q), next: () => 's9.mail' }),
    { id: 's9.mail', stage: 9, scene: 'mail', dur: T9m.end, captions: [], events: [], noPlug: 'plugDone', sfx: [[f(1), 'screen']],
      R: (G, q) => mailR(G, q), next: () => 'end' },
    { id: 'end', stage: 9, scene: 'end', dur: Infinity, captions: [], events: [], noPlug: 'plugDone',
      R: (G, q) => ({ q, blink: q > 7 && (q - 7) % 3 < f(1), drawnName: G.drawnName, nameMode: G.nameMode, n: G.crashes.length, branch: G.branch }),
      next: () => null },
  ];

  // =============================================================================================
  // THE REJECT BRANCH: the "Rejected" slip goes back into his badge; step 3 answers; nothing moves
  // =============================================================================================
  const Trj = { chin: f(14), typeA: f(22), down: f(23), type: [f(24), f(34)], rest: f(35), commit: f(39), end: 4 };
  function rjPerf(x) {
    const t = Trj, pose = x >= t.type[0] && x < t.type[1] ? typing(x, t.type[0]) : track(x, [[0, 'rest'], [t.chin, 'chin', .25], [t.typeA, 'typeA', f(2)], [t.rest, 'rest', .25]]);
    const face = look(x, [[0, 'pause'], [BACK.sink[1], 'sideR'], [t.down, 'down'], [t.rest, 'open']], [g12(BACK.sink[1] + .5), g12(t.rest + .6)]);
    return { pose, face };
  }
  const rjBeat = (id, intro, o = {}) => roomBeat(id, { stage: 8, dur: Trj.end + off(intro),
    commit: [{ t: Trj.commit + off(intro), row: 4, part: 't' }, { t: Trj.commit + off(intro), row: 4, part: 'c' }],
    events: [[0, G => run(G, 'step3', intro)], [Trj.commit + off(intro), G => { log(G, 'step3Reject'); log(G, 'completed'); }]],
    cls: G => (G.book[4].t ? 'after' : 'before'), recover: G => (G.book[4].t ? 'rj.done' : 'rj.again'), outcome: G => (G.book[4].t ? 'out9' : 'out8step3'),
    sfx: [...(intro ? [[INTRO.rise[0], 'paper', { k: 2 }]] : []), [BACK.sink[0] + off(intro), 'paper', { k: 1 }], [Trj.type[0] + off(intro), 'keys', { dur: Trj.type[1] - Trj.type[0], kind: 'agent' }]],
    R: (G, q) => stepR(G, q, id, { intro, answer: 'issue_refund', answerO: { rejected: 1 }, perf: rjPerf, ask: null }),
    next: () => 'rj.done', ...o });
  const rjBeats = [rjBeat('rj.step3', false, { captions: ['reject'] }), rjBeat('rj.again', true),
    roomBeat('rj.done', { stage: 8, dur: 3,
      cls: () => 'any', recover: G => G.beat.id, outcome: () => 'out9',
      R: (G, q) => { const R = base(G, beats['rj.done'], q); R.face = look(tw(q), [[0, 'open'], [1.25, 'side'], [1.75, 'open']], [.75, 2.5]); return R; },
      next: () => 'end' })];

  // =============================================================================================
  // THE BEAT TABLE
  // =============================================================================================
  /** The beat the start card leads to (P1 Buy). */
  const FIRST = 'shop.product';
  /** @type {Object<string, object>} every beat by id (BEAT schema above) */
  const beats = {
    start: { id: 'start', stage: 0, scene: 'start', dur: 0, captions: [], events: [], noPlug: 'plugShop',
      R: (G, q) => ({ q, blink: false, drawnName: G.drawnName, nameMode: G.nameMode, n: G.crashes.length, branch: G.branch }),
      hold: { action: 'start', idle: (G, hq) => ({ q: hq, blink: (hq % 3) >= 3 - 2 / 24, drawnName: G.drawnName, nameMode: G.nameMode, n: 0, branch: G.branch }) },
      next: () => FIRST },
  };
  for (const b of [...shopBeats, ...s1Beats, ...s2Beats, ...s3Beats, ...s4Beats, ...s5Beats, ...s6Beats, ...s7Beats, ...s8Beats, ...s9Beats, ...rjBeats]) beats[b.id] = b;
  /** The first beat of each stage (the rail, STORY.canon). */
  const STAGE_FIRST = ['shop.product', 's1.wide', 's2.read', 's3.pause', 's4.run', 's5.cont', 's6.wait', 's7.refund', 's8.step3', 's9.done'];
  /** @param {string} id @returns {object|null} the beat, or null if unknown */
  const beat = id => beats[id] ?? null;
  /** Timing facts the tests (and the panel) can use: commit times per beat, stage 7's t_m / t_c. */
  const TIMES = { s1: { ...T1 }, s3: { commit: C3 }, s4: { commit: T4.commit }, s5: { commit: T5.commit }, s6: { impact: T6s.impact }, s7: { tm: T7.tm, tc: T7.tc },
    s8: { step3: T8a.commit, email: T8e.commit, emailTm: T8e.tm, step4: T8d.commit }, intro: off(true) };

  /** A beat's length for this G (BEAT.dur may be a function). @returns {number} seconds */
  const durOf = (b, G) => (typeof b.dur === 'function' ? b.dur(G) : b.dur ?? 0);
  /** A beat's sound cues for this G (BEAT.sfx may be a function). @returns {Array} [[t, type, opts?]] */
  const sfxOf = (b, G) => (typeof b.sfx === 'function' ? b.sfx(G) : b.sfx ?? []);

  /**
   * The canonical state at the START of stage k (rail jumps, window.__game.seek, "Try to break it").
   * Approve branch; book, world and events exactly as an uncrashed play leaves them at that point: the
   * beats from P1 are replayed headless (their events and commits in time order; holds answered as the
   * player would, the approval with Approve), so the history is the one a real play writes.
   * @param {number} k  0 (shop, P1 Buy) .. 9
   * @param {object=} G  the current state: its name fields, settings and clock are kept
   * @returns {object} a NEW G (the caller replaces its state with it)
   */
  function canon(k, G) {
    const g = newGame(G ?? {}, G?.settings ?? {});
    const stage = clamp(Math.round(k) || 0, 0, 9), target = STAGE_FIRST[stage];
    g.clock = G && Number.isFinite(G.clock) ? G.clock : 0;
    let id = FIRST;
    for (let guard = 0; id && id !== target && guard < 64; guard++) {
      const b = beats[id]; if (!b) break;
      g.beat = { id, t0: g.clock, fired: 0, committed: 0, cued: 0 }; g.stage = b.stage; g.scene = b.scene;
      const cm = b.commit ? (Array.isArray(b.commit) ? b.commit : [b.commit]) : [];
      const steps = [...(b.events ?? []).map((e, i) => ({ t: e[0], o: 0, i, fn: e[1] })), ...cm.map((c, i) => ({ t: c.t, o: 1, i, c }))].sort((a, b2) => a.t - b2.t || a.o - b2.o || a.i - b2.i);
      for (const s of steps) { if (s.fn) s.fn(g); else { g.book[s.c.row][s.c.part] = 1; g.ink.push({ row: s.c.row, part: s.c.part, t0: g.clock - 100 }); } }
      if (b.hold && b.hold.action === 'approve') { g.approval.decision = 'approve'; g.approval.queued = null; g.branch = 'approve'; }
      id = b.next(g);
    }
    const b = beats[target];
    g.beat = { id: target, t0: g.clock, fired: 0, committed: 0, cued: 0 }; g.stage = b.stage; g.scene = b.scene; g.q = 0;
    g.events.forEach(e => { e.at = g.clock; });
    return g;
  }

  /** The R the renderer shows at the current (or frozen) moment of G's beat. */
  function viewR(G) {
    const b = beat(G.beat.id); if (!b) return {};
    if (G.hold && b.hold && !G.hold.step) return b.hold.idle(G, G.worker && G.worker.hq != null && G.worker.phase !== 'on' ? G.worker.hq : G.clock - G.hold.t0);
    return b.R(G, G.frozenQ ?? Math.min(G.q, durOf(b, G)));
  }

  /**
   * Which recovery beat follows the notes, from G.book and G.world ONLY (GAME_SPEC §4 crash step 8):
   * a line without its check -> that tool runs again (same ID); no line for the current Claude step
   * -> that step runs again (step 1 starts over, steps 2-4 resume); otherwise the next beat. Each room
   * beat states its rule as `recover(G)` over G.book / G.world; a beat without one resumes itself.
   * @param {object} G @returns {string} beat id
   */
  function recoverFor(G) { const b = beat(G.beat.id); return b && b.recover ? b.recover(G) : G.beat.id; }

  /**
   * Classify the crash at G.frozenQ for the current beat (called by runtime at the plug click; the panel
   * calls it at the current q). Every room beat decides it from G.book / G.world (what is already
   * written), which is what the frozen q means: 'before' | 'after' its commit, 'money' (stage 7 between
   * t_m and t_c: the shop has the refund, the notebook not), 'wait' (stage 6, nothing runs), 'any'.
   * @param {object} G @returns {'before'|'money'|'after'|'wait'|'any'}
   */
  function crashWhen(G) { const b = beat(G.beat.id); return b && b.cls ? b.cls(G) : 'any'; }

  /**
   * The notes close-up state N (story.js SCHEMAS R.notes) at t seconds into the close-up (a9 insert,
   * a9.js:304-330, re-timed for 6 rows in ~3 s): rows from bookRows(G); an indigo underline per saved
   * line, .3 s each, one after the other; a ring on the last mark written; a pulsing arrow at the next
   * empty check (a line without its check) or else the next empty line (GAME_SPEC §3).
   * @param {object} G @param {number} t seconds since the close-up began @returns {object} N
   */
  function notes(G, t) {
    const rows = bookRows(G), q = tw(Math.max(0, t)) + 1e-6, under = rows.map(() => 0);
    const lines = G.book.map((r, k) => (r.t ? k : -1)).filter(k => k >= 0);
    lines.forEach((k, i) => { const t0 = .3 + i * .3; under[k] = sm(t0, t0 + .3, q, lin); });   // linear: ROOM.notes eases it (a9.js:316)
    const tr = .3 + lines.length * .3, last = G.ink.at(-1);
    const ring = last && q >= tr ? { row: last.row, part: last.part === 'c' ? 'c' : 't', u: sm(tr, tr + .35, q, lin) } : null;
    let next = null;
    for (let k = 0; k < 6 && !next; k++) { const r = G.book[k]; if (r.t && !r.c && !r.strike) next = { row: k, part: 'c' }; }
    const used = G.branch === 'reject' ? 5 : 6;
    if (!next) for (let k = 0; k < used && !next; k++) if (!G.book[k].t) next = { row: k, part: 't' };
    const ta = tr + .2, red = G.settings && G.settings.reduced;
    const arrow = next && q >= ta ? { ...next, u: sm(ta, ta + .2, q, easeOut), pulse: red ? .5 : ((q - ta) * 1.5) % 1 } : null;   // a9.js:323-326 (no pulse when reduced)
    return { rows, branch: G.branch, under, ring, arrow, alpha: 1, glow: red ? 1 : sm(0, .6, q) };
  }

  /** @param {object} G  after the notes @returns {string} the outcome caption id (CONTENT.drawn.captions) */
  function outcome(G) { const b = beat(G.beat.id); return b && b.outcome ? b.outcome(G) : 'out1'; }

  /**
   * Is the plug available now? Unavailable in the shop, the wide shot (and while the room is still being
   * drawn), while the plug is being pulled or pushed, and during the notes CLOSE-UP (GAME_SPEC §4 end of
   * the crash sequence). It IS available while he wakes and while he lifts or puts down his notes: that
   * is a crash during a recovery (see THE CRASH above; runtime keeps the story frozen).
   * @param {object} G @returns {{ok: boolean, reason: string|null}} reason = CONTENT.html.disabled key
   */
  function plugState(G) {
    const b = beat(G.beat.id), ph = G.worker.phase;
    if (ph === 'dark') return { ok: true, reason: null };   // the button reads "Plug it back in"
    if (ph === 'pulling' || ph === 'pushing') return { ok: false, reason: 'plugMoving' };
    if (G.scene === 'notes') return { ok: false, reason: 'plugNotes' };
    if (ph !== 'on' && ph !== 'waking' && ph !== 'notes') return { ok: false, reason: 'plugMoving' };   // 'recover' lasts one update
    if (b && b.noPlug) return { ok: false, reason: b.noPlug };
    if (G.scene === 'end' || G.scene === 'mail') return { ok: false, reason: 'plugDone' };
    return { ok: G.stage >= 1, reason: G.stage >= 1 ? null : 'plugShop' };
  }

  /**
   * What the worker had SAVED at the moment of the plug click (runtime stores it in G.worker.saved
   * and passes it to ROOM.crash as K.saved): wait = the waiting slip is Temporal's (it glows) rather
   * than the worker's (it drops); drawer = the lookup's result is saved (else the drawer shuts);
   * envelope = the email's result is saved (else an envelope in flight drops). Decided per slip from
   * G.book: a slip glows when the notebook line it stands for is written. In stage 1 it also writes what
   * Temporal already has: the request (requestDurable), so "the line finishes, glowing" (GAME_SPEC §4 st. 1).
   * @param {object} G  at the click (G.frozenQ set) @returns {{wait: boolean, drawer: boolean, envelope: boolean}}
   */
  function saved(G) {
    requestDurable(G);   // stage 1: Temporal already has the request (the one write a crash causes; idempotent)
    let w = null; try { const R = viewR(G); w = R && R.wait; } catch (e) { w = null; }
    const B = G.book, by = { look_up_order: B[1].t, answer: B[1].c, issue_refund: B[2].t, refund_id: B[2].c, email_customer: B[4].t };
    return { wait: !!(w && by[w.which]), drawer: !!B[1].c, envelope: !!B[4].c };
  }
  /** The rail's words for one crash record (see SCHEMAS "crashes"). @returns {'crashedBefore'|'crashedAfter'} */
  function railMark(c) {
    if (c.when === 'after') return 'crashedAfter';
    if (c.when === 'any') return c.stage === 2 ? 'crashedBefore' : 'crashedAfter';
    return 'crashedBefore';
  }

  /** Is the hold of beat b reached (the beat waits for the player)? */
  const holding = (G, b) => G.frozenQ === null && G.worker.phase === 'on' && (!!G.hold || G.q >= durOf(b, G));
  /** A hold whose decision may be made while the power is off (queued): the approval (GAME_SPEC §4 st. 6). */
  const queueable = (G, b) => b.hold.action === 'approve' && G.approval.waiting && G.approval.decision === null;
  /**
   * The control bar's actions right now: the main button (#btn-action) and the second one (#btn-alt,
   * only Reject next to Approve in stage 6).
   * @param {object} G
   * @returns {{act: string|null, label: string, enabled: boolean, reason: string|null, note: string|null,
   *   alt: null|{act: string, label: string, enabled: boolean}}}
   *   act = a window.__game.act name; label = CONTENT.html.buttons key; reason = CONTENT.html.disabled key
   *   (shown only while disabled); note = CONTENT.html.disabled key shown under the buttons while they are
   *   ENABLED (approveOff: the decision is queued until the power is back).
   */
  function action(G) {
    const b = beat(G.beat.id), a = b && b.hold ? b.hold.action : null;
    if (G.hold && G.hold.step && G.worker.phase === 'on') return { act: 'next', label: 'next', enabled: true, reason: null, note: null, alt: null };
    if (a === 'approve' && (holding(G, b) || (G.worker.phase !== 'on' && queueable(G, b)))) {
      const dark = G.worker.phase !== 'on', q = G.approval.queued;
      return { act: 'approve', label: 'approve', enabled: !q, reason: q ? 'queued' : null, note: dark ? 'approveOff' : null,
        alt: { act: 'reject', label: 'reject', enabled: !q } };
    }
    if (a && holding(G, b)) return { act: a, label: a === 'start' ? 'next' : a, enabled: true, reason: null, note: null, alt: null };
    return { act: null, label: 'next', enabled: false, reason: 'action', note: null, alt: null };
  }

  /**
   * A player act that the story handles (buy, pay, refund, submit, approve, reject, next, start).
   * Runtime calls it; plug/unplug/pause/sound/rail:<k> are runtime's own.
   * @param {object} G  mutated: approval.decision / queued, branch, ...
   * @param {string} name
   * @returns {string|null} the beat id to go to now, or null (not allowed now / queued)
   */
  function onAct(G, name) {
    const b = beat(G.beat.id);
    if (!b) return null;
    if (name === 'next' && G.hold && G.hold.step && G.worker.phase === 'on') return b.next(G);   // step mode: release
    if (!b.hold) return null;
    const decide = b.hold.action === 'approve' && (name === 'approve' || name === 'reject');
    if (decide && G.worker.phase !== 'on' && queueable(G, b)) { if (!G.approval.queued) G.approval.queued = name; return null; }   // power off: queued
    if (!holding(G, b) || !(name === b.hold.action || decide)) return null;
    if (decide) { G.approval.decision = name; G.approval.queued = null; G.branch = name === 'reject' ? 'reject' : 'approve'; }   // next(G) branches on it
    return b.next(G);
  }

  /**
   * The panel texts for the current moment (ui.js writes them with textContent).
   *   now     CONTENT.html.panel.now[stage], or the hint (G.hint) until the next plug pull
   *   ifPlug  CONTENT.html.panel.ifPlug[stage][class]: class = crashWhen(G) evaluated at the current q
   *           (the answer changes inside a stage: before / after the commit, stage 7's money window),
   *           falling back to .any
   *   note    after a crash in this stage: {text: panel.outcome[captionId], retry: bool, table:
   *           panel.retryTable when the outcome is a retry, retryNote}; else null
   * @param {object} G
   * @returns {{now: string, ifPlug: string, proof: string, note: null|{text, retryNote, table}, notebook: string[], history: string[]}}
   */
  function panel(G) {
    const P = H().panel, labels = rowLabels(G.branch), rj = G.branch === 'reject' && G.book[3].t && P.reject ? P.reject : null;   // after a rejection: panel.reject replaces the stage's texts
    const ip = rj ? rj.ifPlug ?? {} : P.ifPlug[G.stage] ?? {};
    const cls = G.worker.phase !== 'dark' && plugState(G).ok ? crashWhen(G) : null;   // also while he wakes (a re-crash)
    const last = G.crashes.at(-1), o = last && last.outcome && last.stage === G.stage ? P.outcome[last.outcome] : null;
    const v = { name: G.name, slug: G.slug }, F = t => fill(t ?? '', v);   // {name} / {slug} in panel texts (textContent only)
    return { now: F(G.hint ? H()[G.hint] : rj ? rj.now : P.now[G.stage]), ifPlug: cls ? F(ip[cls] ?? ip.any) : '', proof: F(rj ? rj.proof : P.proof[G.stage]),
      note: o ? { text: F(o.text), retryNote: o.retry ? P.retryNote : '', table: o.retry ? P.retryTable : null } : null,
      notebook: G.book.map((r, k) => r.t ? labels[k] + (r.c ? ' ✓' : '') : '').filter(Boolean),
      history: G.events.map(e => e.text) };
  }

  return { INK_DUR, FIRST, STAGE_FIRST, TIMES, beats, beat, durOf, sfxOf, newGame, canon, bookRows, inkPlan, notes, recoverFor, crashWhen, saved, railMark, outcome, plugState, action, onAct, panel, log, fill, rowLabels, viewR };
})();
