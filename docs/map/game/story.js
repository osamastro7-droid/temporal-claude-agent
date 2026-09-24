'use strict';
// ============================================================
// game/story.js: the stage beats, the notebook model, the recovery rules and STORY.canon(k).
// STUB with contracts (foundation). The story builder replaces the bodies; the contracts below
// are what shop.js, room.js, cards.js, sfx.js, ui.js and runtime.js code against.
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
//     world:     { traySlip, refunds, refundRuns, emails, emailRuns, receiptOut, envelopeSent, lookups }
//                the shop and the room outside the worker; survives crashes. traySlip 0|1 (request in
//                the tray), refunds/emails = how many the SHOP recorded (1 at most), *Runs = how many
//                times the Activity ran, receiptOut 0|1, envelopeSent 0|1, lookups = lookup runs.
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
//              part: 't'|'c', pulse: 0..1}, alpha: 0..1 }
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
      world: { traySlip: 0, refunds: 0, refundRuns: 0, emails: 0, emailRuns: 0, receiptOut: 0, envelopeSent: 0, lookups: 0 },
      worker: { phase: 'on', t0: 0 },
      approval: { waiting: false, decision: null, queued: null },
      branch: 'approve', crashes: [],
      settings: { sound: false, reduced: !!(window.BOOT && BOOT.reduced), stepMode: false, paused: false, ...settings },
      clock: 0, cap: { now: null, queue: [], last: -1 }, hold: null, hint: null, dirty: true,
    };
  }

  // STUB beats: the start card holds for 'start'; the story builder adds the rest (GAME_SPEC §4).
  /** @type {Object<string, object>} every beat by id (BEAT schema above) */
  const beats = {
    start: { id: 'start', stage: 0, scene: 'start', dur: 0, captions: [], events: [], noPlug: 'plugShop',
      R: (G, q) => ({ q, blink: false, drawnName: G.drawnName, nameMode: G.nameMode, n: G.crashes.length, branch: G.branch }),
      hold: { action: 'start', idle: (G, hq) => ({ q: hq, blink: (hq % 3) >= 3 - 2 / 24, drawnName: G.drawnName, nameMode: G.nameMode, n: 0, branch: G.branch }) },
      next: () => FIRST },
  };
  /** The beat the start card leads to (P1 Buy). */
  const FIRST = 'shop.product';
  /** @param {string} id @returns {object|null} the beat, or null if unknown */
  const beat = id => beats[id] ?? null;

  /**
   * The canonical state at the START of stage k (rail jumps, window.__game.seek, "Try to break it").
   * Approve branch; book, world and events exactly as an uncrashed play leaves them at that point.
   * @param {number} k  0 (shop, P1 Buy) .. 9
   * @param {object=} G  the current state: its name fields and settings are kept
   * @returns {object} a NEW G (the caller replaces its state with it)
   */
  function canon(k, G) {
    const g = newGame(G ?? {}, G?.settings ?? {});
    g.stage = clamp(Math.round(k) || 0, 0, 9); g.scene = g.stage ? 'room' : 'shop'; g.beat = { id: FIRST, t0: 0, fired: 0, committed: 0, cued: 0 };   // STUB
    return g;
  }

  /**
   * Which recovery beat follows the notes, from G.book and G.world ONLY (GAME_SPEC §4 crash step 8):
   * a line without its check -> that tool runs again (same ID); no line for the current Claude step
   * -> that step runs again (step 1 starts over, steps 2-4 resume); otherwise the next beat.
   * @param {object} G @returns {string} beat id
   */
  function recoverFor(G) { return G.beat.id; }   // STUB

  /**
   * Classify the crash at G.frozenQ for the current beat (called by runtime at the plug click).
   * @param {object} G @returns {'before'|'money'|'after'|'wait'|'any'}
   */
  function crashWhen(G) { return 'any'; }   // STUB

  /**
   * The notebook as DRAWN now: per row, the progress 0..1 of its text, check and strike, from G.book
   * and G.ink on the game clock (a committed mark keeps writing in the dark, GAME_SPEC §1.4).
   * Beats use it for R.book.rows; ROOM never reads G. @param {object} G @returns {{t, c, strike}[]}
   */
  function bookRows(G) {
    const rows = G.book.map(() => ({ t: 0, c: 0, strike: 0 }));
    for (const i of G.ink) rows[i.row][i.part] = Math.max(rows[i.row][i.part], clamp((G.clock - i.t0) / INK_DUR[i.part], 0, 1));
    return rows;
  }
  /**
   * The notes close-up state N (story.js SCHEMAS R.notes) at t seconds into the close-up: rows from
   * bookRows(G), an indigo underline per saved line (.3 s each), a ring on the last mark written, a
   * pulsing arrow at the next empty check or line (GAME_SPEC §3). Called by runtime.js during the
   * crash controller's 'notes' phase. STUB: rows only.
   * @param {object} G @param {number} t seconds since the close-up began @returns {object} N
   */
  function notes(G, t) { return { rows: bookRows(G), branch: G.branch, under: [0, 0, 0, 0, 0, 0], ring: null, arrow: null, alpha: 1 }; }

  /** @param {object} G  after the notes @returns {string} the outcome caption id (CONTENT.drawn.captions) */
  function outcome(G) { return 'out1'; }   // STUB

  /**
   * Is the plug available now? Unavailable in the shop, the wide shot, while the plug is being pulled
   * or pushed, and during the notes CLOSE-UP (GAME_SPEC §4 end of the crash sequence). It IS available
   * while he wakes and while he lifts or puts down his notes: that is a crash during a recovery (see
   * THE CRASH above; runtime keeps the story frozen).
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

  /** A beat's length for this G (BEAT.dur may be a function). @returns {number} seconds */
  const durOf = (b, G) => (typeof b.dur === 'function' ? b.dur(G) : b.dur ?? 0);
  /** A beat's sound cues for this G (BEAT.sfx may be a function). @returns {Array} [[t, type, opts?]] */
  const sfxOf = (b, G) => (typeof b.sfx === 'function' ? b.sfx(G) : b.sfx ?? []);

  /**
   * What the worker had SAVED at the moment of the plug click (runtime stores it in G.worker.saved
   * and passes it to ROOM.crash as K.saved): wait = the waiting slip is Temporal's (it glows) rather
   * than the worker's (it drops); drawer = the lookup's result is saved (else the drawer shuts);
   * envelope = the email's result is saved (else an envelope in flight drops). STUB rule from the
   * crash class; the story builder refines it per beat from G.book.
   * @param {object} G  at the click (G.frozenQ set) @returns {{wait: boolean, drawer: boolean, envelope: boolean}}
   */
  function saved(G) {
    const w = crashWhen(G);
    return { wait: w === 'after' || w === 'wait' || w === 'any', drawer: w !== 'before', envelope: !!G.book[4].c };
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
    const P = H().panel, labels = rowLabels(G.branch), ip = P.ifPlug[G.stage] ?? {};
    const cls = G.worker.phase !== 'dark' && plugState(G).ok ? crashWhen(G) : null;   // also while he wakes (a re-crash)
    const last = G.crashes.at(-1), o = last && last.outcome && last.stage === G.stage ? P.outcome[last.outcome] : null;
    return { now: G.hint ? H()[G.hint] ?? '' : P.now[G.stage] ?? '', ifPlug: cls ? ip[cls] ?? ip.any ?? '' : '', proof: P.proof[G.stage] ?? '',
      note: o ? { text: o.text, retryNote: o.retry ? P.retryNote : '', table: o.retry ? P.retryTable : null } : null,
      notebook: G.book.map((r, k) => r.t ? labels[k] + (r.c ? ' \u2713' : '') : '').filter(Boolean),
      history: G.events.map(e => e.text) };
  }

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

  return { INK_DUR, FIRST, beats, beat, durOf, sfxOf, newGame, canon, bookRows, notes, recoverFor, crashWhen, saved, railMark, outcome, plugState, action, onAct, panel, log, fill, rowLabels };
})();
