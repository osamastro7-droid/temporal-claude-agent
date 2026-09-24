'use strict';
// ============================================================
// game/room.js: the agent's room, drawn from a room state R (story.js SCHEMAS "ROOM STATE").
// The a9 room (scenes2/a9.js:260-300): lamp at x 640, his open notebook at (780, 808) drawn through
// AGENT.draw's `hold` (his mittens stay in front of it), printer (receipts rise out of its slot), tray
// after the printer, the email at SD.ENV, the keyboard (V2G2ROOM.keyboard, a3.js:221), the socket rig,
// the cabinet with its drawer and folder (a3.js:255-263). a8's props come in at room scale under the
// room camera (GAME_SPEC §1.7): the tool slips (a8.js:125-156), the pause sign (a8.js:73), the clock
// (a8.js:112-122) and the stamp (a8.js:157-183, plus a Rejected impression cloned from cast.js:216).
// The crash (a9.js:226-246 re-timed as CRASH_T), the glow (a9.js:287-295), the notes close-up
// (a9 insert(), a9.js:306-330, parametrised) and the idles (blink, wobble, clock).
//
// Rules: pure functions of R (no G, no Date, no random, no state kept between frames besides caches);
// pose names only (cache-safe keys, agent.js:149); a slip's scale >= .81 (capitals >= 44 px); stage B's
// Mac, box and big page never come into the room.
// Called by runtime.js (draw), ui.js (hotspots) and story.js (ROOM.BASE_R, ROOM.WAIT, ...).
//
// PENCILS: R.pencils null/absent (the default) = the room draws them itself: the graphite pencil at the
// tip of any part being drawn on (R.parts, the envelope's u, the clock's u), Temporal's indigo pencil at
// the tip of a notebook mark being written (R.book.rows between 0 and 1), the green pencil on the green
// check. The graphite and green pencils only while the scene is not dark (R.dark <= 0): a part frozen
// half drawn by the crash has no hand drawing it; Temporal's indigo pencil keeps writing in the dark
// (GAME_SPEC §1.4). An array = exactly those pencils (drawPencilTool), nothing automatic. A caller building its own
// array takes the tips from ROOM.bookTip(row, part, u), ROOM.bookOpenTip(u) and ROOM.greenTip(u) (the same
// cels the room draws; never the room's compile ids).
// ============================================================
window.ROOM = (() => {
  const RM = window.V2G2ROOM;
  SD.build(); SB.build(); RM.build();
  const f = n => n / 12;
  const AGX = SD.AG.x, AGY = SD.AG.y;
  /** How far the plug is out when the power is off (rig-local px): a9's value (a9.js:69). R.pull runs 0..PULLED. */
  const PULLED = 120;
  /** Where a waiting slip rests (room world, centre) and its scale (GAME_SPEC §4 intro). */
  const WAIT = { x: 1330, y: 520, s: .85 };
  /** The a8 clock's place next to the waiting slip: WAIT + (36, 146) * .85 (from a8.js:71 CLK). */
  const CLOCK = { x: WAIT.x + 36 * WAIT.s, y: WAIT.y + 146 * WAIT.s, s: 1.35 * WAIT.s };
  /** The open desk notebook (a9.js:61 NB) and the lamp's x (a9.js:66 LAMPX). */
  const NB = { x: 780, y: 808 }, LAMPX = 640;
  const BW = 92, FW = 78, BH = 50, NBL = { x: NB.x - AGX, y: NB.y - AGY };   // from a9.js:62-63
  /** His Claude badge (a8's "box slot", a8.js:130/:137): agent-local (0, -164) turned by his lean (agent.js:69). */
  const BADGE = { x: AGX, y: AGY - 164 };
  const PR = SD.PRINTER, SLOT_Y = PR.y - PR.slot;                           // from a9.js:65
  /** The lift, one value per drawing: flat, raised, edge-on, cover (a9.js:70). R.book.k = index / 5. */
  const LIFT_K = [0, 1 / 12, 4 / 12, 7 / 12, 10 / 12, 1];
  const GREEN = { x: PR.x + MINI_RECEIPT.w / 2 + 14, y: SLOT_Y - 30 };       // from a9.js:152
  /** The notes close-up: page top-left on screen and scale (a9.js:68 INS; 1.1 so 6 rows fit: 575 = 960 - 770 / 2). */
  const INS = { x: 575, y: 312, s: 1.1 };
  /** The close-up rows sit one ruled line lower than stageB's (a9.js:303 draws its rows at SB.rowY(k + 1), UP 84):
   *  a blank line under the header, the film's pitch (84 page px); the 6th row runs down to the page's foot. */
  const NOTE_DY = 84;
  /** a8's wobble, four drawings on twos (a8.js:144): R.wait.wob indexes it. */
  const WOB = { rot: [.035, -.024, .012, 0], dy: [-4, 1, 0, 0] };
  /** a8's stamp drawings by index (a8.js:161-173): 0 high, < impact coming down, < lift on the slip, lift, gone at end. */
  const STAMP_K = { impact: 2, lift: 6, end: 10 };
  const PAUSE = { h: 58, gap: 26, dx: 294, dy: 0 };
  /** His badge slot (a8's box slot, cast.js:184, at room scale): lips at +-lip px, the slip cut at +cut px (a8.js:153
   *  clips at the slot + 2 of its +-4 lips), the slot over x the slip's width long. */
  const BSLOT = { lip: 3, cut: 1.5, over: 1.4 };   // a8.js:65; beside the slip's right end (dx at slip scale 1)
  const DASH = { from: [NB.x - 58, NB.y - 34], to: [SD.CAB.x + 118, SD.CAB.y - 262] };   // notebook -> cabinet drawer (a7.js:151 style)

  /**
   * THE CRASH TIMETABLE (GAME_SPEC §4 "The crash sequence"): the one copy. room.js draws from it,
   * runtime.js derives its phase switches from it (and plays SFX_LIVE.crash()/power() at `spark` /
   * `power`), the sound builder schedules nothing of its own. Seconds, on the game clock, f(n) = n/12.
   * Two clocks (runtime passes both in K, see ROOM.crash):
   *   tc = seconds since the PLUG click   (a9 f(23) = tc 0: the hand starts to come in)
   *   tu = seconds since the UNPLUG click (a9 f(65) = tu 0: the hand comes back), null before it
   * Every sub-event of a9 (a9.js:43-54 T, :172-196 LOOKS/perf, :226-246 darkAt/pullAt/handAt) keeps
   * its a9 offset from its clock, except the reach in, shortened from a9's 8 drawings (f(23)-f(31)) to 4
   * (GAME_SPEC §4 crash step 2), and the close-up, ~3 s (GAME_SPEC §4 step 7; a9's own is 2.75 s).
   * Phase switches (runtime.js): pulling -> dark at tc >= out; pushing -> waking at tu >= power;
   * waking -> notes at tu >= look; scene 'notes' while insert[0] <= tu < insert[1]; notes -> recover
   * at tu >= done. Drawing tracks run on tc/tu and DO cross phase boundaries (the hand still leaves
   * and he still slumps after 'dark' began; the flicker and his wake run on while 'waking' begins).
   */
  const CRASH_T = (() => {
    const T = {
      // ---- tc: the pull (a9.js:47-48 handIn/grip/pull/spark/slump/release/handOut, re-timed) ----
      handIn: [0, f(4)],              // reach, 4 drawings on twos (a9: f(23)-f(31), 8)
      grip: f(4),                     // the grip drawing; the pull starts on it
      pull: [f(4), f(4) + .134],      // pull on ones, u^2 to ROOM.PULLED (a9.js:233, .134 s as a9)
      spark: f(5),                    // 1/12 after the pull starts (a9 f(33) -> f(34)): the prongs leave; red spark,
                                      // lamp off, face 'wide', visor .45, SFX_LIVE.crash()
      sparkFade: [.15, .25],          // spark alpha 1 -> 0 between spark + .15 and spark + .25 (a9.js:281)
      darkSteps: [[0, .85], [f(1), .3], [f(2), 1]],   // dark level from spark + t (a9.js:227-228 a4 blackout)
      wide: f(1),                     // face 'wide' for 1 drawing from the spark, then 'off' (a9.js:170 LOOKS)
      visorSteps: [[0, .45], [f(1), 1]],              // from the spark (a9.js:177 perf visor)
      slump: [f(6), f(10)],           // slump over 4 drawings, easeIn, from ANY pose (a9 f(35)-f(39); poseKey)
      release: f(8),                  // the hand lets go of the plug (a9 f(37) = spark + f(3))
      handOut: [f(9), f(16)],         // and leaves, easeIn (a9 f(38)-f(45))
      glow: [f(7), f(5) + 1],         // notebook glow .6 -> 1 of dark between these (a9.js:289), pulse 1.5 s
      rays: [f(7), f(5) + .67],       // the glow's rays draw on (a9.js:294)
      out: f(4) + .134,               // the plug is out: phase 'dark' ("Plug it back in" is live)
      fade: .3,                       // reduced motion: dark is a plain .3 s fade from the spark (GAME_SPEC §2)
      // ---- tu: plug back in, wake, notes (a9 f(65) = tu 0; a9.js:48-50, :172-196, :229) ----
      plugIn: [0, f(6)],              // the hand comes back, reach 6 drawings (a9 f(65)-f(71))
      regrip: f(6),                   // a9 f(71)
      push: [f(7), f(9)],             // pushed home on ones, easeOut (a9 f(72)-f(74), a9.js:234)
      power: f(9),                    // lands: flicker, lamp on, the props snap to K.rec, SFX_LIVE.power() (a9 f(74))
      flickerSteps: [[0, .35], [f(1), .8]],           // dark from power + t, then .8 -> 0 over .3 s easeOut from
      flickerFade: [f(2), f(2) + .3],                 // power + f(2) (a9.js:229 a5 flicker); reduced: 1 -> 0 over .3 s
      release2: f(10),                // a9 f(75)
      plugOut: [f(11), f(18)],        // the hand leaves (a9 f(76)-f(83))
      visor: f(12),                   // visor .6 for 1 drawing, .3 for 1, then 0 (a9 f(77), a9.js:177)
      half: f(13),                    // face 'half' from visor + f(1) (a9.js:171 LOOKS)
      wake: [f(13), f(19)],           // slump -> wake, 6 drawings, easeInOutSine (a9 f(78)-f(84))
      blink: f(21),                   // 'closed' for 1 drawing (a9 f(86) BLINKS)
      rest: [f(23), f(26)],           // wake -> rest, face 'open' at its start (a9 f(88)-f(91))
      look: f(26),                    // face 'side' toward the notebook; phase 'notes'; caption 'notes' (a9 f(91))
      grab: [f(27), f(30)],           // rest -> NBGRAB, easeOut (a9 f(92)-f(95))
      lift: [f(31), f(37)],           // NBGRAB -> HOLDBOOK by LIFT_K, one value per drawing (a9 f(96), a9.js:182)
      down: f(33),                    // face 'down' at lift + f(2) (a9.js:171)
      insert: [f(40), f(40) + 3],     // the close-up, scene 'notes' (a9 f(105); ~3 s, GAME_SPEC §4 step 7)
    };
    T.put = [T.insert[1] + f(2), T.insert[1] + f(8)];   // LIFT_K reversed, 6 drawings, face 'happy' (a9 f(140) = insert end + f(2))
    T.letgo = [T.put[1], T.put[1] + f(3)];               // NBGRAB -> rest (a9 f(146)-f(149))
    T.done = T.letgo[1];                                 // phase 'recover': outcome caption, recovery beat
    return Object.freeze(T);
  })();
  /**
   * The room darkness 0..1 at crash times (tc, tu), a9 darkAt re-timed (a9.js:226-229): the blackout
   * steps from the spark, the flicker from the power; a plain .3 s fade each way when reduced.
   * @param {{tc: number, tu: number|null, reduced: boolean}} K @returns {number}
   */
  function darkOf(K) {
    const T = CRASH_T, stepAt = (steps, t) => { let v = 0; for (const [t0, d] of steps) if (t >= t0) v = d; return v; };
    if (K.tu === null || K.tu === undefined || K.tu < T.power) {
      const s = K.tc - T.spark; if (s < 0) return 0;
      return K.reduced ? clamp(s / T.fade, 0, 1) : stepAt(T.darkSteps, s);
    }
    const p = K.tu - T.power;
    if (K.reduced) return 1 - clamp(p / T.fade, 0, 1);
    return p < T.flickerFade[0] ? stepAt(T.flickerSteps, p) : .8 * (1 - sm(T.flickerFade[0], T.flickerFade[1], p, easeOut));
  }

  // ---------------------------------------------------------------- poses
  const KY = AGENT.KEYS, nm = (name, p) => RM.named(p, name);
  // a9 (a9.js:76-84), with a9's own names (the AGENT cache keys, so the drawings are the film's)
  const RAISE = nm('a9:raise', { ...KY.typeA, head: [4, -330], tilt: .03, L: KY.rest.L, R: { e: [142, -150], h: [98, -104], hr: -1.4 } });
  const ONENV = nm('a9:onenv', { head: [6, -328], tilt: .04, lean: .01, L: KY.rest.L, R: { e: [134, -114], h: [58, -44], hr: -1.2 } });
  const ONENV_UP = nm('a9:onenv-up', { ...ONENV, R: { e: [138, -126], h: [60, -58], hr: -1.3 } });
  const FLICK = nm('a9:flick', { head: [8, -336], tilt: -.04, lean: .01, L: KY.rest.L, R: { e: [168, -210], h: [236, -286], hr: -.8, point: 1 } });
  const RLOOK = nm('a9:rlook', AGENT.mixPose('rest', 'reach', .55));
  const RLOOK_NOD = nm('a9:rlook-nod', { ...RLOOK, head: [RLOOK.head[0], RLOOK.head[1] + 12], tilt: RLOOK.tilt + .03 });
  const NBGRAB = nm('a9:nbgrab', { head: [-22, -324], tilt: -.08, lean: -.045, L: { e: [-212, -110], h: [NBL.x - BW + 4, -24], hr: .5 }, R: { e: [30, -104], h: [NBL.x + BW - 4, -24], hr: -.5 } });
  const HOLDBOOK = nm('a9:holdbook', { ...KY.book, L: { e: [-156, -174], h: [-136, -126], hr: 1.4 }, R: { e: [156, -174], h: [136, -126], hr: -1.4 } });
  // a5 (a5.js:47-50): the stage 2 crash replays a5's re-read
  const COCK = RM.named(['rest', 'wake', .67]);
  const COCK_R = RM.named(RM.mirrorPose(COCK), 'v2g2:cockR');
  const GLANCE = RM.named({ ...KY.rest, head: [8, -319], tilt: .08, lean: .01 }, 'v2g2:glance');
  const ENV_IN_HAND = [-8, 16];                                                  // a9.js:79
  /**
   * Named poses R.pose may use, besides AGENT.KEYS (rest, typeA, typeB, read, book, point, reach, chin,
   * cheer, slump, wake). Values are cache-safe pose objects (V2G2ROOM.named, a3.js:98-103):
   *   a3 (a3.js:107-112): LOWREACH, NOD, READ, REACH_L
   *   a9 (a9.js:76-84):   RAISE, ONENV, ONENV_UP, FLICK, RLOOK, RLOOK_NOD, NBGRAB, HOLDBOOK
   *   a5 (a5.js:47-50):   COCK, COCK_R, GLANCE
   * plus the 'mix:<from>><to>@<t12>' names that poseKey registers at run time.
   * @type {Object<string, object>}
   */
  const POSES = { LOWREACH: RM.LOWREACH, NOD: RM.NOD, READ: RM.READ, REACH_L: RM.REACH_L,
    RAISE, ONENV, ONENV_UP, FLICK, RLOOK, RLOOK_NOD, NBGRAB, HOLDBOOK, COCK, COCK_R, GLANCE };
  /** @param {string} name @returns {string|object} the pose key (AGENT.KEYS) or the named pose object */
  const poseOf = name => (AGENT.KEYS[name] ? name : POSES[name] ?? (() => { throw new Error('room pose ' + name); })());
  /**
   * A cache-safe NAME for an inbetween, for moves that start mid-move (the slump from any pose,
   * GAME_SPEC §4 crash step 3): registers POSES['mix:<from>><to>@<t12>'] = AGENT.mixPose(from, to, t12/12).
   * @param {string} from @param {string} to  pose names @param {number} t 0..1 (snapped to 1/12)
   * @returns {string} the new pose name
   */
  function poseKey(from, to, t) {
    const t12 = Math.round(clamp(t, 0, 1) * 12);
    if (t12 === 0) return from; if (t12 === 12) return to;
    const n = `mix:${from}>${to}@${t12}`;
    if (!POSES[n]) POSES[n] = RM.named(AGENT.mixPose(poseOf(from), poseOf(to), t12 / 12), n);
    return n;
  }
  /** A pose value (name or {from, to, t} of names) -> one NAME (poseKey for an inbetween). */
  const poseName = p => (typeof p === 'string' ? p : poseKey(p.from, p.to, p.t));
  /**
   * R.pose -> what AGENT.draw takes: a string key of AGENT.KEYS, or {from, to, t}. A named pose object
   * alone is not a valid AGENT.draw pose (it reads pose.from), so it is wrapped the way a3 does it
   * (a3.js:114 asPose): {from: n, to: n, t: 1}. Same AGENT cache key as the film ('a9:nbgrab>a9:nbgrab@1.000').
   */
  const poseArg = p => {
    if (typeof p === 'string') { const n = poseOf(p); return typeof n === 'string' ? n : { from: n, to: n, t: 1 }; }
    return { from: poseOf(p.from), to: poseOf(p.to), t: p.t };
  };
  /** The pose data (head, lean, arms) AGENT draws for an AGENT.draw pose (agent.js:146-149, t snapped). */
  const poseData = a => (typeof a === 'string' ? KY[a] : AGENT.mixPose(a.from, a.to, Math.round(a.t * 12) / 12));
  const rot2 = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
  /** His badge in room world for a pose NAME / {from, to, t}: {x, y, lean} (agent.js:69, :169). */
  function badgeOf(pose) { const P = poseData(poseArg(pose ?? 'rest')), b = rot2([0, -164], P.lean); return { x: AGX + b[0], y: AGY + b[1], lean: P.lean }; }
  // a performance track: [[time, pose, dur, ease]] (a9.js:87-97), pose NAMES in, names or {from, to, t} out
  function track(q, keys) {
    let prev = keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t0, next, dur = .25, ease = easeIO] = keys[i];
      if (q < t0) break;
      const u = dur > 0 ? ease(clamp((q - t0) / dur, 0, 1)) : 1;
      if (u < 1) return { from: prev, to: next, t: u };
      prev = next;
    }
    return prev;
  }

  /** The room at rest, as R (the a3 BASE, a3.js:290, in R's fields). pencils null = automatic (see header). */
  const BASE_R = {
    pose: 'rest', face: 'open', visor: 0, lamp: 1, dark: 0, pull: 0, hand: null, spark: 0, drawer: 0, folder: 0,
    traySlip: 1, held: null, book: { rows: Array.from({ length: 6 }, () => ({ t: 0, c: 0, strike: 0 })), k: 0, glow: 0, rays: 0, branch: 'approve' },
    wait: null, stamp: null, clock: null, receipt: { e: 0, check: 0 }, envelope: { state: 'desk', u: 1, fly: 0 },
    dash: null, pencils: null, q: 0, q2: 0, led: 0, notes: null,
    parts: { agent: 1, printer: 1, tray: 1, book: 1, clock: 1 }, slip: null,
  };
  /**
   * The fields of R that belong to the WORKER (its props in progress). On a crash they follow the
   * crash rules (drop, close, stop), and from the power-on flicker they snap to the recovery beat's R
   * (K.rec). Everything else (book, receipt, traySlip, world things) stays as the frozen R.
   */
  const WORKER_FIELDS = ['wait', 'drawer', 'folder', 'held', 'envelope', 'dash', 'stamp', 'clock', 'slip'];
  /**
   * THE snap (one rule for the lit branch and for a re-crash): R with its WORKER_FIELDS taken from the
   * recovery beat's R `rec`; a field rec leaves out takes BASE_R's value (what the room then draws).
   * rec null -> R unchanged. @param {object} R @param {object|null} rec @returns {object} a new R
   */
  function snap(R, rec) {
    const o = { ...R }; if (!rec) return o;
    for (const k of WORKER_FIELDS) o[k] = k in rec ? rec[k] : BASE_R[k];
    return o;
  }

  // ---------------------------------------------------------------- drawings (built once, lazily)
  let D = null;
  const at = (c, P, fn) => { c.save(); c.translate(P.x, P.y); if (P.s) c.scale(P.s, P.s); const r = fn(); c.restore(); return r; };   // a9.js:159
  const sc = (strokes, sx, sy) => strokes.map(s => ({ ...s, points: s.points.map(([x, y]) => [x * sx, y * sy]) }));                  // a9.js:111
  const rowLabels = branch => { const r = CONTENT.drawn.rows.slice(); if (branch === 'reject') for (const [k, v] of Object.entries(CONTENT.drawn.rowsReject)) r[+k] = v; return r; };
  function build() {
    if (D) return D;
    // the desk notebook's rows: a9's row(k) (a9.js:102) split into text and check; rows 0-2 on the left
    // page exactly as a9, rows 3-5 the same scrawls on the right page (3 rows per page, GAME_SPEC §3)
    const deskRow = k => {
      const L = k < 3, j = L ? k : k - 3, y = -14 - j * 10, x0 = L ? -76 + j * 3 : 12 + j * 2, w = L ? 46 - j * 3 : 44 - j * 3;
      return { x0, y, w, text: scrawl((L ? 'a9/nbrow' : 'game/nbrow') + k, x0, y, w, 6, 40 + k * 7, { width: 1.8, opacity: .95 }),
        chk: checkStroke((L ? 'a9/nbchk' : 'game/nbchk') + k, x0 + w + 6, y + 1, .3, { width: 1.8 }),
        strike: stroke('game/nbstrike' + k, [[x0 - 3, y - 3], [x0 + w + 3, y - 5]], { width: 1.6, pressure: PRESS.flat }) };
    };
    const rows = [0, 1, 2, 3, 4, 5].map(deskRow);
    const openRaw = { strokes: [   // a9.js:103-108
      stroke('a9/nb/l', [[-4, -2], [-BW, 2], [-FW, -BH], [-4, -BH - 2]], { width: 2.8, corner: .5 }),
      stroke('a9/nb/r', [[4, -2], [BW, 2], [FW, -BH], [4, -BH - 2]], { width: 2.8, corner: .5 }),
      stroke('a9/nb/spine', [[0, -BH - 4], [0, 0]], { width: 1.8, opacity: .8 }),
      ...[0, 1, 2].map(k => stroke('a9/nb/rule/' + k, [[10, -14 - k * 10], [74 - k * 3, -13 - k * 10]], { width: 1, opacity: .35, pressure: PRESS.inner })),
    ] };
    const bookOut = [[-BW, 2], [-FW, -BH], [FW, -BH], [BW, 2]];
    const hands = k => { const P = AGENT.mixPose(NBGRAB, HOLDBOOK, k); return { D: P.R.h[0] - P.L.h[0] }; };
    // the cover (a9.js:113-124): logo + the cover word above his hands
    const word = CONTENT.drawn.bookCover, TW = measure(word, 32, 0, .72), GW = 48 + 10 + TW;
    const coverRaw = (w, sy, sx, id) => ({ strokes: [
      loopStroke(id + '/c', [[-w / 2, -124 * sy], [w / 2, -124 * sy], [w / 2, 26 * sy], [-w / 2, 26 * sy]], { width: 3.4, corner: .5, over: 10 }),
      stroke(id + '/sp', [[-w / 2 + 12, -112 * sy], [w / 2 - 12, -112 * sy]], { width: 1.6, opacity: .7, pressure: PRESS.inner }),
      ...sc(textStrokes(word, -GW / 2 + 58, -46, { cap: 32, condense: .72, id: id + '/t', seed: 5 }).strokes, sx, sy),
    ] });
    const covers = new Map();
    for (const k of LIFT_K.filter(k => k > .45)) { const w = Math.round(hands(k).D + 8 + 28 * k), sy = +lerp(.5, 1, (k - .45) / .55).toFixed(3), sx = +Math.min(1, (w - 40) / GW).toFixed(3);
      const id = `a9/cover@${w}x${sy}` + (word === 'Temporal' ? '' : '/' + word);
      covers.set(k, { w, sy, sx, logo: { x: (-GW / 2 + 24) * sx, y: -68 * sy }, cel: compile(coverRaw(w, sy, sx, id), id), fill: polyPath([[-w / 2, -124 * sy], [w / 2, -124 * sy], [w / 2, 26 * sy], [-w / 2, 26 * sy]]) }); }
    const ew = Math.round(hands(4 / 12).D + 16), FLAT = { sx: +((hands(1 / 12).D + 8) / (2 * BW)).toFixed(3), sy: .75 };
    // a8's stamp fill (a8.js:88-89), pause sign (a8.js:73-75), clock hands (a8.js:76-77), impact and speed lines (a8.js:79-85)
    const sf = new Path2D(); sf.ellipse(0, -150, 30, 26, 0, 0, TAU); sf.moveTo(-12, -126); sf.lineTo(-16, -80); sf.lineTo(16, -80); sf.lineTo(12, -126); sf.closePath();
    sf.rect(-STAMP_HALF - 8, -80, STAMP_HALF * 2 + 16, 54); sf.rect(-STAMP_HALF, -26, STAMP_HALF * 2, 20);
    const pb = PAUSE.h / 2, bar = (id, x) => stroke(id, [[x, -pb], [x + 1, pb]], { width: 11, pressure: [[0, .75], [.12, 1], [.88, 1], [1, .75]] });
    // the Rejected impression: approvedDrawing (cast.js:216) with the new word, its own ids
    const rej = (() => { const t = textStrokes(CONTENT.drawn.stamp.rejected, 0, 12, { cap: 38, align: 'center', condense: .9, id: 'game/rej/t', seed: 41, width: 4, jitter: .6 });
      const w = t.width + 48; return { strokes: [loopStroke('game/rej/box', rrectPts(-w / 2, -46, w, 92, 8, 2), { width: 3.4, start: 1, over: 6 }), ...t.strokes], w }; })();
    const slipBox = [WAIT.x - SB.slipW() * WAIT.s / 2, WAIT.y - 44 * WAIT.s, SB.slipW() * WAIT.s, 88 * WAIT.s];
    D = {
      open: compile(openRaw, 'a9/nb-open'), openFill: polyPath(bookOut), openRaw,
      rowT: rows.map((r, k) => compile({ strokes: r.text }, 'game/nb-rowt' + k)),
      rowC: rows.map((r, k) => compile({ strokes: [r.chk] }, 'game/nb-rowc' + k)),
      rowS: rows.map((r, k) => compile({ strokes: [r.strike] }, 'game/nb-rows' + k)), rows,
      flats: new Map(), FLAT, flatFill: polyPath(bookOut.map(([x, y]) => [x * FLAT.sx, y * FLAT.sy])),
      edge: compile({ strokes: [loopStroke('a9/nb-edge', [[-ew / 2, -7], [ew / 2, -7], [ew / 2, 7], [-ew / 2, 7]], { width: 3, corner: .5, over: 8 }),
        stroke('a9/nb-edge/p', [[-ew / 2 + 8, 0], [ew / 2 - 8, 0]], { width: 1.2, opacity: .6, pressure: PRESS.inner })] }, 'a9/nb-edge'),
      edgeFill: polyPath([[-ew / 2, -7], [ew / 2, -7], [ew / 2, 7], [-ew / 2, 7]]),
      covers,
      ring: compile({ strokes: [stroke('a9/ring', ellPoints(0, 0, 40, 34, -2.2, -2.2 + TAU * 1.08, 30), { width: 3.2, corner: 2 })] }, 'a9/ring'),
      green: compile({ strokes: [checkStroke('a9/green', 0, 0, 1.8, { width: 7.5 })] }, 'a9/green'),
      rays: emanataCel('a9/rays', [NB.x - BW, NB.y - BH, 2 * BW, BH + 2], { n: 12, pad: 12, len: 22, width: 2.6, seed: 7, skip: (ex, ey) => ey > .6 }),
      slipRays: emanataCel('game/slip-rays', slipBox, { n: 16, pad: 14, len: 24, width: 2.6, seed: 11 }),
      // his mitten hands at the close-up page's edges (a9.js:138-139 at the 1.1 page: 770 wide)
      mitts: compile({ strokes: [[-8, 0], [778, 0]].flatMap(([x, y], i) => [stroke('game/mitt/' + i, ellPoints(x, y, 34, 32, 0, TAU, 18), { width: 3.2, corner: 2 }),
        stroke('game/thumb/' + i, [[x + (i ? -34 : 34) * .2, y - 30], [x + (i ? -38 : 38), y - 26], [x + (i ? -36 : 36), y - 8]], { width: 2.6, corner: 2 })]) }, 'game/mitts'),
      pause: compile({ strokes: [bar('a8/pause/a', -PAUSE.gap / 2), bar('a8/pause/b', PAUSE.gap / 2)] }, 'a8/pause'),
      hour: compile({ strokes: [stroke('a8/clk/h', [[0, 2], [0, -15]], { width: 2.8, pressure: [[0, .8], [1, .5]] })] }, 'a8/clk-hour'),
      minute: compile({ strokes: [stroke('a8/clk/m', [[0, 2], [0, -23]], { width: 2.2, pressure: [[0, .8], [1, .4]] })] }, 'a8/clk-min'),
      impact: compile({ strokes: [[-1, 1], [1, 1], [-1, 2], [1, 2]].map(([sx, k], i) => {
        const a = [[118, 10], [60, 18]][k - 1], b = [[150, 30], [72, 46]][k - 1];
        return stroke('a8/imp/' + i, [[sx * a[0], a[1]], [sx * b[0], b[1]]], { width: 2.8, pressure: [[0, .4], [.4, 1], [1, .2]] }); }) }, 'a8/impact'),
      streakDown: compile({ strokes: [[-96, 40], [-48, 50], [48, 46], [96, 36]].map(([x, L], i) => stroke('a8/sd/' + i, [[x, -104 - L], [x, -104]], { width: 2.4, opacity: .8, pressure: [[0, .1], [.7, .9], [1, .5]] })) }, 'a8/streak-down2'),
      streakUp: compile({ strokes: [[-96, 44], [-48, 56], [0, 40], [48, 54], [96, 42]].map(([x, L], i) => stroke('a8/su/' + i, [[x, -40], [x, -40 - L]], { width: 2.4, opacity: .8, pressure: [[0, .1], [.6, .9], [1, .3]] })) }, 'a8/streak-up2'),
      stampFill: sf, rejected: compile(rej, 'game/rejected'),
      slips: new Map(), parts: new Map(), notes: new Map(), slots: new Map(),
    };
    return D;
  }
  const celTip = RM.celTip;

  // ---------------------------------------------------------------- the desk notebook
  const mark = (v, k, p) => (v && v[k] ? v[k][p] ?? 0 : 0);
  /** The open book, agent-local or world at NB; only finished marks (marks being written are drawn on top, a9.js:296). */
  function openBook(g, rows, a = 1, u = 1) {
    const d = build(); g.save(); g.globalAlpha *= a * clamp(u * 1.25, 0, 1); g.fillStyle = COL.paper; g.fill(d.openFill); g.restore();
    pencilMarks(g, d.open, { color: 'indigo', alpha: a, progress: u });
    if (u < 1) return;
    for (let k = 0; k < 6; k++) {
      if (mark(rows, k, 't') >= 1) pencilMarks(g, d.rowT[k], { color: 'indigo', alpha: a });
      if (mark(rows, k, 'c') >= 1) pencilMarks(g, d.rowC[k], { color: 'indigo', alpha: a });
      if (mark(rows, k, 'strike') >= 1) pencilMarks(g, d.rowS[k], { color: 'indigo', alpha: a });
    }
  }
  /** The finished marks of the desk notebook as one number (bit k: row k's text, 6 + k: its check, 12 + k: its strike). */
  function doneMarks(rows) {
    let m = 0;
    for (let k = 0; k < 6; k++) m |= (mark(rows, k, 't') >= 1 ? 1 : 0) << k | (mark(rows, k, 'c') >= 1 ? 1 : 0) << (6 + k) | (mark(rows, k, 'strike') >= 1 ? 1 : 0) << (12 + k);
    return m;
  }
  /** The lift's first drawing (a9.js:131): the open book squashed, with its finished marks (a cel per set of marks). */
  function flatCel(rows) {
    const d = build(), m = doneMarks(rows);
    if (!d.flats.has(m)) { const s = [...d.openRaw.strokes];
      d.rows.forEach((r, k) => { if (m >> k & 1) s.push(...r.text); if (m >> (6 + k) & 1) s.push(r.chk); if (m >> (12 + k) & 1) s.push(r.strike); });
      d.flats.set(m, compile({ strokes: sc(s, d.FLAT.sx, d.FLAT.sy) }, 'game/nb-flat@' + m)); }
    return d.flats.get(m);
  }
  /** The notebook through `hold` (agent-local; a9.js:196-206): k = LIFT_K value (0 = on the desk). */
  function book(g, P, lk, rows, u) {
    const d = build();
    if (lk <= 0 || !P) { g.save(); g.translate(NBL.x, NBL.y); openBook(g, rows, 1, u); g.restore(); return; }
    const L = P.L.h, R = P.R.h, mx = (L[0] + R[0]) / 2, my = (L[1] + R[1]) / 2;
    g.save(); g.fillStyle = COL.paper;
    if (lk < .2) { g.translate(mx, my + 15); g.fill(d.flatFill); pencilMarks(g, flatCel(rows), { color: 'indigo' }); }
    else if (lk < .45) { g.translate(mx, my); g.fill(d.edgeFill); pencilMarks(g, d.edge, { color: 'indigo' }); }
    else { const cv = d.covers.get(lk); g.translate(mx, my); g.fill(cv.fill); pencilMarks(g, cv.cel, { color: 'indigo' });
      g.save(); g.translate(cv.logo.x, cv.logo.y); g.scale(cv.sx, cv.sy); drawLogo(g, 'temporal', 0, 0, 48, 1, { color: 'indigo' }); g.restore(); }
    g.restore();
  }
  const ROW_CELS = { t: 'rowT', c: 'rowC', strike: 'rowS' };
  /**
   * Where Temporal's indigo pencil tip is while it writes a desk-notebook mark (room world): the tip of
   * the very cel the room draws for row `row`'s `part` at progress u (the same point inkRows returns).
   * story.js buildPencils uses it instead of reading the room's compile ids.
   * @param {number} row 0..5 @param {'t'|'c'|'strike'} part @param {number} u 0..1 @returns {[number, number]}
   */
  function bookTip(row, part, u) {
    const d = build(), cels = d[ROW_CELS[part] ?? 'rowT'];
    return celTip(cels[clamp(Math.round(row) || 0, 0, 5)], clamp(u, 0, 1), NB.x, NB.y);
  }
  /** The indigo tip while the open desk notebook itself is drawn on (R.parts.book = u, a9.js:103-108), room world. */
  const bookOpenTip = u => celTip(build().open, clamp(u, 0, 1), NB.x, NB.y);
  /** The green pencil's tip on the receipt's green check at progress u (a9.js:152), room world. */
  const greenTip = u => celTip(build().green, clamp(u, 0, 1), GREEN.x, GREEN.y);
  /** The marks being written right now (0 < progress < 1), world, over everything (a9.js:296-297). Returns the indigo tip. */
  function inkRows(c, rows) {
    const d = build(); let tip = null;
    for (let k = 0; k < 6; k++) for (const [p, cels] of [['t', d.rowT], ['c', d.rowC], ['strike', d.rowS]]) {
      const u = mark(rows, k, p); if (u <= 0 || u >= 1) continue;
      at(c, NB, () => pencilMarks(c, cels[k], { progress: u, color: 'indigo' })); tip = bookTip(k, p, u);
    }
    return tip;
  }
  // the area of his left mitten (world), from AGENT's mitten geometry, a little grown (a9.js:248-253)
  function mittenPts(P, s) {
    const A = P[s], [cx, cy] = A.h, hr = A.hr, pt = A.point ?? 0, cs = Math.cos(hr), sn = Math.sin(hr);
    const w = ([x, y]) => [AGX + cx + x * cs - y * sn, AGY + cy + x * sn + y * cs], out = [];
    for (let i = 0; i <= 14; i++) { const a = -Math.PI * .95 + i / 14 * Math.PI * 1.9, rr = 22 + Math.max(0, Math.cos(a)) * 22 * pt + 3; out.push(w([Math.cos(a) * rr, Math.sin(a) * rr * .92])); }
    return out;
  }
  const mittenPath = (P, s) => polyPath(mittenPts(P, s));
  /** The same area as mittenPath's clip, as a world box [x0, y0, x1, y1] under a9's rect (a9.js:291). */
  function mittenBox(P, s) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of mittenPts(P, s)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [Math.max(x0, AGX - 400), Math.max(y0, AGY - 400), Math.min(x1, AGX + 400), Math.min(y1, AGY - 2)];
  }

  // ---------------------------------------------------------------- in front of the light, in the dark
  // Things that must stay in front of a glowing thing are drawn again after it, with the dark over them.
  // The dark is the layer SD.dark(c, dk) built this drawing (fx layer 0: glowBehind uses layer 1 and
  // nothing else in the room draws into layer 0), laid again over a small device box only, never a
  // second SD.dark (which would clear and re-hatch the whole frame for the same pixels).
  /** World box [x0, y0, x1, y1] -> the device box [px, py, pw, ph] around it under c's transform (2 px margin),
   *  or null when c's transform turns (the room camera never does) or the box is empty. */
  function devBox(c, b) {
    const M = c.getTransform(); if (M.b || M.c || !(b[2] > b[0] && b[3] > b[1])) return null;
    const xa = M.a * b[0] + M.e, xb = M.a * b[2] + M.e, ya = M.d * b[1] + M.f, yb = M.d * b[3] + M.f;
    const px = Math.floor(Math.min(xa, xb)) - 2, py = Math.floor(Math.min(ya, yb)) - 2;
    return [px, py, Math.ceil(Math.max(xa, xb)) + 2 - px, Math.ceil(Math.max(ya, yb)) + 2 - py];
  }
  /** Lay the dark layer again, alpha dk, over device box q only (c's clip applies). The mapping is SD.dark's own
   *  (resetT, the layer drawn at 0, 0, W, H), so the pixels are the ones a second SD.dark(c, dk) gives.
   *  off = [px, py]: c is a small canvas whose pixel (0, 0) is device pixel (px, py). */
  function darkAgain(c, dk, q, off = null) {
    const [L] = fxLayers(), kx = L.width / W, ky = L.height / H;
    const sx = clamp(Math.floor(q[0] * kx / S), 0, L.width), sy = clamp(Math.floor(q[1] * ky / S), 0, L.height);
    const sw = Math.min(L.width - sx, Math.ceil(q[2] * kx / S) + 2), sh = Math.min(L.height - sy, Math.ceil(q[3] * ky / S) + 2);
    if (sw <= 0 || sh <= 0) return;
    c.save(); resetT(c); if (off) c.translate(-off[0] / S, -off[1] / S); c.globalAlpha *= dk; c.drawImage(L, sx, sy, sw, sh, sx / kx, sy / ky, sw / kx, sh / ky); c.restore();
  }
  // small canvases for the redraws: the cached mitten redraws (a few poses) and one scratch
  const _dkPool = { mitts: new Map(), max: 3, scratch: null };
  const sizeCv = (cv, w, h) => { cv = cv ?? document.createElement('canvas'); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h); return cv; };
  /** Draw draw(g) (world transform) into device box q of a small canvas cv, clipped by clip(g) when given. */
  function renderBit(c, q, cv, draw, clip) {
    const M = c.getTransform(), g = sizeCv(cv, q[2], q[3]).getContext('2d');
    g.setTransform(M.a, 0, 0, M.d, M.e - q[0], M.f - q[1]);
    if (clip) { g.save(); clip(g); } draw(g); if (clip) g.restore();
    return g.canvas;
  }
  const blitDev = (c, cv, q) => { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(cv, 0, 0, q[2], q[3], q[0], q[1], q[2], q[3]); c.restore(); };
  /**
   * His left mitten in front of the glowing notebook (a9.js:291): the whole agent (with `front`) redrawn inside
   * the mitten's area, then the dark over that area. His pose holds still for the whole dark, so the redraw
   * (without the dark) is rendered once per (camera, key) into a small canvas and laid back with one
   * drawImage: the same pixels up to rounding (source-over only; the cards.js figure() rule). The dark goes
   * on after it, through the same clip, as a9's second SD.dark did.
   * @param {string} key everything the redraw depends on besides the camera (pose, face, visor, held slip,
   *   the finished notebook marks, the email)
   */
  function mittenInDark(c, dk, P, key, draw) {
    const b = mittenBox(P, 'L'), q = devBox(c, b), clip = g => { g.beginPath(); g.rect(AGX - 400, AGY - 400, 800, 398); g.clip(); g.clip(mittenPath(P, 'L')); };
    if (!q) { c.save(); clip(c); draw(c); SD.dark(c, dk); c.restore(); return; }
    const M = c.getTransform(), k = `${M.a},${M.d},${M.e},${M.f}|${q}|${key}`, pool = _dkPool.mitts;
    let cv = pool.get(k);
    if (cv) { pool.delete(k); pool.set(k, cv); }   // most recent last
    else {
      let old = null; if (pool.size >= _dkPool.max) { const [ok, ov] = pool.entries().next().value; pool.delete(ok); old = ov; }
      cv = renderBit(c, q, old, draw, clip); pool.set(k, cv);
    }
    blitDev(c, cv, q);
    c.save(); clip(c); darkAgain(c, dk, q); c.restore();
  }
  /** Something small drawn again in front of a glow, with only its own pixels darkened: draw(g) into a
   *  scratch canvas, the dark layer laid on it 'source-atop' (so it lands where draw painted, as the dark
   *  lies over it in the room), then the scratch onto c. b = the world box that holds the drawing. */
  function inDark(c, dk, b, draw) {
    const q = devBox(c, b); if (!q) return;
    const cv = renderBit(c, q, _dkPool.scratch, draw), g = cv.getContext('2d'); _dkPool.scratch = cv;
    g.globalCompositeOperation = 'source-atop'; darkAgain(g, dk, q, q); g.globalCompositeOperation = 'source-over';
    blitDev(c, cv, q);
  }

  // ---------------------------------------------------------------- a8's props at room scale
  /** The cel for a slip `which` (CONTENT.drawn.slips key): a8's own for its three texts, else slipDrawing (cast.js:198). */
  function slipCel(which) {
    const d = build(), text = CONTENT.drawn.slips[which] ?? which;
    if (!d.slips.has(which)) {
      const own = { look_up_order: ['look_up_order', SB.D.slipLook], answer: ['49.99 EUR', SB.D.slipAnswer], issue_refund: ['issue_refund', SB.D.slipRefund] }[which];
      const cel = own && own[0] === text ? own[1] : compile(slipDrawing(text, { w: Math.max(SB.slipW(), Math.round(measure(text, 36, 0, .82) + 64)) }), 'game/slip/' + which + '/' + text);
      const mk = strokes => { const q = { strokes }; q.plan = makePlan(q); return q; };   // body / text split (stageB.js:128-131)
      d.slips.set(which, { cel, w: cel.bounds[2], body: mk(cel.strokes.filter(s => !s.id.startsWith('slip/t'))), text: mk(cel.strokes.filter(s => s.id.startsWith('slip/t'))) });
    }
    return d.slips.get(which);
  }
  /** Where a slip is drawn after its wobble and drop (a8.js:132, :144-148; the drop falls and fades, a4.js:51-60). */
  function slipPlace(w) {
    let x = w.x ?? WAIT.x, y = w.y ?? WAIT.y, rot = w.rot ?? 0, a = 1;
    const s = Math.max(w.s ?? WAIT.s, .01), wob = w.wob ?? null;
    if (wob !== null && wob >= 0 && wob < 4) { rot += WOB.rot[wob]; y += WOB.dy[wob] * s; }
    const dr = w.drop ?? 0; if (dr > 0) { const u = easeIn(clamp(dr, 0, 1)); y += 170 * u; x += 30 * u; rot += .5 * u; a = 1 - clamp(dr * 1.1, 0, 1); }
    return { x, y, rot, s, a };
  }
  /** A tool slip (a8 drawSlip, a8.js:149-156 + SB.slip, stageB.js:133-143), with Approved / Rejected impressions. */
  function drawSlip(c, w, o = {}) {
    const p = slipPlace(w), a = p.a * (o.alpha ?? 1); if (a <= 0) return;
    const S = slipCel(w.which), d = build(), ap = clamp(w.approved ?? 0, 0, 1), rj = clamp(w.rejected ?? 0, 0, 1), im = Math.max(ap, rj);
    c.save();
    if (w.clip === 'badge') {   // only what is out of the slot shows (a8.js:153): the cut runs along the slot, across the slip
      const b = o.badge ?? BADGE, t = p.rot + Math.PI / 2;
      c.translate(b.x, b.y); c.rotate(t); c.beginPath(); c.rect(-3000, -3000, 6000, 3000 + BSLOT.cut); c.clip(); c.rotate(-t); c.translate(-b.x, -b.y);
    }
    c.translate(p.x, p.y); c.rotate(p.rot); c.scale(p.s, p.s * Math.max(.07, w.sy ?? 1));
    if (!o.color) { c.save(); c.globalAlpha *= a; c.fillStyle = COL.paper; c.fillRect(-S.w / 2, -44, S.w, 88); c.restore(); }
    const col = o.color ?? 'graphite';
    if (!im) pencilMarks(c, S.cel, { alpha: a, color: col });
    else { pencilMarks(c, S.body, { alpha: a, color: col }); pencilMarks(c, S.text, { alpha: a * lerp(1, .26, im), color: col }); }
    for (const [v, cel] of [[ap, SB.D.approved], [rj, d.rejected]]) {
      if (!v) continue; const bw = cel.bounds[2];
      c.save(); c.beginPath(); c.rect(-S.w / 2, -44, S.w, 88); c.clip();            // ink lands only on the paper
      c.translate(0, 2); c.rotate(-.05); c.beginPath(); c.rect(-bw / 2 - 6, -47, bw + 12, 94); c.clip();
      pencilMarks(c, cel, { progress: 1, alpha: a * v, widthScale: 1.1, color: col }); c.restore();
    }
    c.restore();
  }
  /** The slot in his badge a slip rises out of / sinks into while R.wait.clip is 'badge': a8's box slot
   *  (cast.js:182-184 boxDrawing 'box/slot': a thin loop, the near lip a little right; paper inside), BSLOT.over x the slip's
   *  width long, across the slip's way through badge point b. Drawn before the slip: the slip covers the far lip
   *  and is cut just past the middle (BSLOT.cut), so the near lip shows over its cut edge, as in a8 (frame 1887). */
  function drawSlot(c, w, b) {
    const p = slipPlace(w), L = Math.round(88 * p.s * BSLOT.over), d = build(), h = BSLOT.lip;
    const pts = [[-L / 2, -h], [L / 2, -h], [L / 2 + 2, h], [-L / 2 + 2, h]];
    if (!d.slots.has(L)) d.slots.set(L, { fill: polyPath(pts), cel: compile({ strokes: [loopStroke('game/badge-slot/' + L, pts, { width: 2.4, corner: .5, over: 6 })] }, 'game/badge-slot/' + L) });
    const sl = d.slots.get(L);   // paper inside the slit (the spark does not show through it), then its lips
    c.save(); c.translate(b.x, b.y); c.rotate(p.rot + Math.PI / 2); c.save(); c.globalAlpha *= p.a; c.fillStyle = COL.paper; c.fill(sl.fill); c.restore(); pencilMarks(c, sl.cel, { alpha: p.a }); c.restore();
  }
  /** Claude's pause sign beside the waiting slip (a8.js:73, :226-228): alpha = R.wait.pause. */
  function drawPause(c, w) {
    const pa = clamp(w.pause ?? 0, 0, 1) * (1 - clamp(w.drop ?? 0, 0, 1)); if (pa <= 0) return;
    const s = w.s ?? WAIT.s, x = (w.x ?? WAIT.x) + PAUSE.dx * s, y = (w.y ?? WAIT.y) + PAUSE.dy * s;
    c.save(); c.translate(x, y); c.scale(s, s); pencilMarks(c, build().pause, { alpha: pa }); c.restore();
  }
  /** a8 drawClock (a8.js:112-122) at CLOCK: face, hour hand, minute hand; angle = the minute hand. Returns the tip. */
  function drawClock(c, u, angle, alpha) {
    const d = build(), fu = clamp(u / .72, 0, 1), h = clamp((u - .72) / .12, 0, 1), m = clamp((u - .84) / .16, 0, 1);
    const ma = angle ?? 0, ha = TAU * 10 / 12 + ma / 12;                          // a8.js:95 hourAngle
    c.save(); c.translate(CLOCK.x, CLOCK.y); c.scale(CLOCK.s, CLOCK.s); c.globalAlpha *= alpha;
    pencilMarks(c, SB.D.clock, { progress: fu });
    if (h > 0) { c.save(); c.rotate(ha); pencilMarks(c, d.hour, { progress: h }); c.restore(); }
    if (m > 0) { c.save(); c.rotate(ma); pencilMarks(c, d.minute, { progress: m }); c.restore(); }
    c.restore();
    if (u >= 1) return null;
    const local = m > 0 ? rot2(celTip(d.minute, m), ma) : h > 0 ? rot2(celTip(d.hour, h), ha) : celTip(SB.D.clock, fu);
    return [CLOCK.x + local[0] * CLOCK.s, CLOCK.y + local[1] * CLOCK.s];
  }
  /** a8 stampPose by drawing index (a8.js:164-173), relative to a8's MID; hover = drawing 0 held high. */
  const STAMP_S = 1.05, IMPACT = 50, HI = 30, REST = -.03;
  function stampPose(k, hover) {
    if (hover) return { y: IMPACT - HI, rot: REST - .02, streak: 0 };
    if (k < 0 || k >= STAMP_K.end) return null;
    if (k === 0) return { y: IMPACT - HI, rot: REST - .02, streak: 1 };
    if (k < STAMP_K.impact) return { y: IMPACT - 10, rot: REST, streak: .55 };
    if (k < STAMP_K.lift) return { y: IMPACT, rot: REST, impact: k < STAMP_K.impact + 2 ? 1 : 0 };
    if (k === STAMP_K.lift) return { y: IMPACT - 12, rot: REST - .04 };
    if (k === STAMP_K.lift + 1) return { y: IMPACT - HI, rot: REST - .08 };
    return { gone: true, y: IMPACT - HI, rot: REST - .08, trail: k === STAMP_K.lift + 2 ? .9 : .45 };
  }
  /** a8 drawStamp (a8.js:174-183) at the waiting slip, scaled with it. Reduced motion (no speed lines) is
   *  story.js stampR's job: it holds drawing 0 as `hover` before the impact and drops the trail drawings
   *  (k >= STAMP_K.lift + 2), which play.spec.mjs checks; the room draws whatever drawing it is given. */
  function stampPlace(st, w) {
    const p = stampPose(Math.round(st.k ?? 0), !!st.hover); if (!p) return null;
    const s = (w && w.s) || WAIT.s, dr = w ? (w.rot ?? REST) - REST : 0;
    return { p, x: w ? w.x ?? WAIT.x : WAIT.x, y: (w ? w.y ?? WAIT.y : WAIT.y) + p.y * s, rot: p.rot + dr, k: STAMP_S * s };
  }
  /** The world box [x0, y0, x1, y1] that holds drawStamp's marks (all its cels, turned and scaled, + 8 px). */
  function stampBox(st, w) {
    const P = stampPlace(st, w); if (!P) return [0, 0, 0, 0];
    const d = build(), cs = Math.cos(P.rot) * P.k, sn = Math.sin(P.rot) * P.k; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const cel of [SB.D.stamp, d.impact, d.streakDown, d.streakUp]) {
      const [bx, by, bw, bh] = cel.bounds;
      for (const [u, v] of [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]) {
        const X = P.x + u * cs - v * sn, Y = P.y + u * sn + v * cs; x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
      }
    }
    return [x0 - 8, y0 - 8, x1 + 8, y1 + 8];
  }
  function drawStamp(c, st, w) {
    const P = stampPlace(st, w); if (!P) return;
    const d = build(), p = P.p;
    c.save(); c.translate(P.x, P.y); c.rotate(P.rot); c.scale(P.k, P.k);
    if (p.impact) pencilMarks(c, d.impact);
    if (p.streak) pencilMarks(c, d.streakDown, { alpha: p.streak });
    if (p.trail) pencilMarks(c, d.streakUp, { alpha: p.trail });
    if (!p.gone) { c.fillStyle = COL.paper; c.fill(d.stampFill); pencilMarks(c, SB.D.stamp); }
    c.restore();
  }

  // ---------------------------------------------------------------- the email, the receipt, the dash
  let _path = null;
  /** a9 flightAt (a9.js:214-223): an even-speed Bezier up and right; it starts from the email on the desk (it flies by itself). */
  function flightAt(u) {
    if (!_path || _path.W !== W) {
      const P = [[RM.ENV.x, RM.ENV.y], [1060, 560], [1260, 400], [W + 200, 335]], pts = [], len = [0];
      for (let i = 0; i <= 120; i++) { pts.push(bez(...P, i / 120)); if (i) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
      _path = { W, pts, len };
    }
    const { pts, len } = _path, L = clamp(u, 0, 1) * len.at(-1); let i = 1; while (i < len.length - 1 && len[i] < L) i++;
    const t = (L - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]);
    return [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t)];
  }
  function envelopeAt(c, x, y, s, r) {   // a9.js:207-209
    c.save(); c.translate(x, y); c.rotate(r); c.scale(s, s); c.fillStyle = COL.paper; c.fillRect(-60, -40, 120, 80); pencilMarks(c, SD.D.envelope); c.restore();
  }
  /** The email off the desk: 'fly' along flightAt (a9.js:283-284); 'drop' = a4 mail() (a4.js:51-60): it freezes
   *  where it was (e.from, the flight progress at the crash) for 2 drawings, falls back to the desk, bounces, rocks. */
  function envelopeOff(c, e) {
    const s0 = RM.ENV.s, r0 = RM.ENV.rot;
    if (e.state === 'fly') { const u = clamp(e.fly ?? 0, 0, 1), p = flightAt(u); envelopeAt(c, p[0], p[1], s0 * lerp(1, 1.5, sm(0, .3, u)), r0 - .3 * u); return; }
    if (e.state !== 'drop') return;
    const u0 = clamp(e.from ?? .2, 0, 1), top = flightAt(u0), ts = s0 * lerp(1, 1.5, sm(0, .3, u0)), tr = r0 - .3 * u0, t = tw(clamp(e.fly ?? 0, 0, 1) * f(8)) + 1e-6;
    let x = top[0], y = top[1], s = ts, r = tr;
    if (t >= f(2) && t < f(5)) { const k = sm(f(2), f(5), t, easeIn); x = lerp(top[0], RM.ENV.x, k); y = lerp(top[1], RM.ENV.y, k); s = lerp(ts, s0, k); r = lerp(tr, r0 + .06, k); }
    else if (t >= f(5) && t < f(6)) { x = RM.ENV.x; y = RM.ENV.y - 6; s = s0; r = r0 + .03; }
    else if (t >= f(6) && t < f(7)) { x = RM.ENV.x; y = RM.ENV.y - 1; s = s0; r = r0 - .018; }
    else if (t >= f(7)) { x = RM.ENV.x; y = RM.ENV.y; s = s0; r = r0; }
    envelopeAt(c, x, y, s, r);
  }
  /** Is the email on the desk (drawn under his hands)? */
  const envOnDesk = e => !!e && (e.state === 'desk' || (e.state === 'drop' && tw(clamp(e.fly ?? 0, 0, 1) * f(8)) + 1e-6 >= f(7)));
  /** The refund receipt rising out of the printer's slot (a9 receipt(), a9.js:254-259): e = 0..150 out. */
  function receipt(c, e) {
    if (e <= 0) return;
    c.save(); c.beginPath(); c.rect(PR.x - 138, SLOT_Y - 400, 276, 400); c.clip();
    c.translate(PR.x, SLOT_Y - Math.min(e, MINI_RECEIPT.h)); c.fillStyle = COL.paper; c.fill(polyPath(MINI_RECEIPT.outline)); pencilMarks(c, SD.D.miniReceipt); c.restore();
  }
  /** Temporal schedules the tool: an indigo dashed line from the notebook toward the cabinet (a7 attempt(), a7.js:158-167). */
  function dash(c, dsh) {
    const u = clamp(dsh.u ?? 0, 0, 1), a = clamp(dsh.alpha ?? 1, 0, 1); if (u <= 0 || a <= 0) return;
    const [x0, y0] = DASH.from, tip = [lerp(x0, DASH.to[0], u), lerp(y0, DASH.to[1], u)];
    c.save(); c.strokeStyle = COL.indigo; c.globalAlpha *= .9 * a; c.lineWidth = 4; c.lineCap = 'round'; c.setLineDash([16, 11]); c.lineDashOffset = -u * 330;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(...tip); c.stroke(); c.restore();
    const r = 7 * clamp(u * 6, 0, 1);
    c.save(); c.globalAlpha *= .8 * a; c.fillStyle = COL.indigo; c.beginPath(); c.arc(x0, y0, r, 0, TAU); c.fill(); c.restore();
  }

  // ---------------------------------------------------------------- the room
  /**
   * The still back of the room, a9.js:262-264: the paper, the room, the cabinet with its drawer and folder, the
   * lamp. It only changes with the drawer, the folder and the lamp (0 or 1), so it is rendered once per
   * (canvas size, camera, drawer, folder, lamp) into a full-frame canvas (a pool of BG_POOL, most recent kept)
   * and laid back with one drawImage: the same pixels up to rounding (source-over only, the cards.js figure()
   * rule), about 1,300 fewer strokes per drawing. Only the folder's rise and sink (stage 4) misses.
   */
  const BG_POOL = 2, _bg = new Map();
  function background(c, drawer, folder, lamp) {
    const draw = g => {
      paperSheet(g); SD.room(g); SD.at(g, SD.CAB, SD.D.cab);
      RM.drawer(g, drawer, folder);
      g.save(); g.translate(LAMPX - SD.LAMP.x, 0); SD.lamp(g, lamp); g.restore();
    };
    const M = c.getTransform(), cw = c.canvas.width, ch = c.canvas.height;
    if (M.b || M.c) { draw(c); return; }
    const k = `${cw}x${ch}|${S}|${M.a},${M.d},${M.e},${M.f}|${drawer}|${folder}|${lamp}`;
    let cv = _bg.get(k);
    if (cv) { _bg.delete(k); _bg.set(k, cv); }   // most recent last
    else {
      let old = null; if (_bg.size >= BG_POOL) { const [ok, ov] = _bg.entries().next().value; _bg.delete(ok); old = ov; }
      cv = sizeCv(old, cw, ch); const g = cv.getContext('2d'); g.setTransform(M); draw(g); _bg.set(k, cv);
    }
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(cv, 0, 0); c.restore();
  }
  /** R.slip -> an a3 slip placement {x, y, s, rot, clipY?} (RM.slip, a3.js:180-184). */
  const slipOf = p => { const o = { x: p.x, y: p.y, s: p.s, rot: p.rot ?? 0 }; if (p.clipY !== undefined && p.clipY !== null) o.clipY = p.clipY; return o; };
  /**
   * Draw the whole room for R: sets the room camera cam(c, SD.CAM.x, SD.CAM.y, SD.CAM.zoom), the
   * paper, then everything in R in a9's draw order (a9.js:260-300): room, cabinet + drawer, lamp at x 640
   * (one cached layer, see background), receipt, printer, LED, tray (+ request), him (the notebook, the email
   * and the keyboard through `hold`, the request in his hands), desk, socket rig, the things in the air (the
   * request, the email, the tool slip with its pause sign and, while it is in his badge, the badge slot, the
   * clock, the stamp, the dashed line), him while he is being drawn on (a3's order), the dark, the glow (his
   * mitten and a hovering stamp drawn again in front of it, dark), then the marks Temporal is writing and the pencils. The caller did resetFrame(ctx) before and does resetT +
   * captions + vignette after.
   * @param {CanvasRenderingContext2D} c @param {object} R  story.js SCHEMAS "ROOM STATE"
   * @returns {boolean} false (the caller draws the vignette; see SHOP.frame)
   */
  function frame(c, R) {
    const r = { ...BASE_R, ...R }, d = build(), parts = { ...BASE_R.parts, ...(R && R.parts) }, part = k => clamp(parts[k] ?? 1, 0, 1);
    const bk = { ...BASE_R.book, ...r.book }, rows = bk.rows ?? BASE_R.book.rows, lk = LIFT_K[clamp(Math.round((bk.k ?? 0) * 5), 0, 5)];
    const env = r.envelope ?? { state: 'none' }, sl = r.slip, tips = {}, pa = poseArg(r.pose), P = poseData(pa);
    cam(c, SD.CAM.x, SD.CAM.y, SD.CAM.zoom);
    background(c, r.drawer ?? 0, r.folder ?? 0, r.lamp ?? 1);
    receipt(c, r.receipt ? r.receipt.e ?? 0 : 0);
    if (part('printer') > 0) { RM.printer(c, part('printer')); if (part('printer') < 1) tips.graphite = celTip(SD.D.printer, part('printer'), PR.x, PR.y); }
    if (r.led) { c.save(); c.fillStyle = COL.graphite; c.globalAlpha = .85; c.beginPath(); c.arc(PR.x + 122, PR.y - 30, 4.2, 0, TAU); c.fill(); c.restore(); }   // a9.js:269
    if (part('tray') > 0) { RM.tray(c, part('tray')); if (part('tray') < 1) tips.graphite = celTip(SD.D.tray, part('tray'), SD.TRAY.x, SD.TRAY.y); }
    if (part('tray') >= 1) RM.slip(c, sl && sl.tray ? slipOf(sl) : r.traySlip ? RM.inTray : null);
    // desk things under his hands (a9.js:273-278): the notebook, the email, the keyboard
    const ub = part('book'), eu = envOnDesk(env) ? clamp(env.state === 'desk' ? env.u ?? 1 : 1, 0, 1) : 0;
    const front = (g, Pz) => {
      if (ub > 0) { g.save(); g.translate(AGX, AGY); book(g, Pz, Pz ? lk : 0, rows, ub); g.restore(); }
      if (eu > 0) { const t = RM.envelope(g, { u: eu }); if (t && eu < 1) tips.graphite = t; }
      RM.keyboard(g, Pz);
    };
    if (ub > 0 && ub < 1) tips.indigoBook = bookOpenTip(ub);
    const ua = part('agent');
    if (ua >= 1) RM.agent(c, { pose: pa, face: r.face, visor: r.visor, slip: r.held, front });
    else front(c, null);   // a3.js:307; the agent being drawn on comes after the room (below)
    SD.desk(c);
    SD.socketRig(c, { pull: r.pull ?? 0, hand: r.hand ?? undefined, spark: r.spark ?? 0 });
    if (sl && !sl.tray) RM.slip(c, slipOf(sl));
    // the things in the air, in front of him
    const ck = r.receipt ? r.receipt.check ?? 0 : 0;
    if (ck > 0) { at(c, GREEN, () => pencilMarks(c, d.green, { progress: ck, color: 'green' })); if (ck < 1) tips.green = greenTip(ck); }
    if (!envOnDesk(env)) envelopeOff(c, env);
    if (r.dash) dash(c, r.dash);
    if (r.clock && part('clock') > 0) { const cu = Math.min(clamp(r.clock.u ?? 1, 0, 1), part('clock')), t = drawClock(c, cu, r.clock.angle ?? 0, clamp(r.clock.alpha ?? 1, 0, 1)); if (t) tips.graphite = t; }
    const w = r.wait, wb = w && w.clip === 'badge' ? badgeOf(r.pose) : null;
    if (w) { drawPause(c, w); if (wb) drawSlot(c, w, wb); drawSlip(c, w, { badge: wb }); }
    if (r.stamp) drawStamp(c, r.stamp, w);
    RM.question(c, r.q ?? 0, r.q2 ?? 0);
    // the agent being drawn on: a3's stRoom item, drawn over the finished room (a3.js:457, :505), always
    // pose 'rest', face 'open' (the pencil's tip follows the 'agent/rest' cel: story.js partTip.agent)
    if (ua > 0 && ua < 1) tips.graphite = RM.agent(c, { pose: 'rest', face: 'open', progress: ua }) ?? tips.graphite;
    // the dark; only what Temporal wrote down glows in it (a9.js:286-295)
    const dk = clamp(r.dark ?? 0, 0, 1); SD.dark(c, dk);
    const gl = dk > 0 ? bk.glow ?? 0 : 0;
    if (gl > 0 && lk <= 0 && ub >= 1) {
      glowBehind(c, g2 => at(g2, NB, () => openBook(g2, rows)), gl, { blur: 7, strength: 1 });
      at(c, NB, () => openBook(c, rows, Math.min(1, gl)));
      // his left mitten rests on it: redraw the mitten (and only it) in the dark, in front of the light
      if (ua >= 1) mittenInDark(c, dk, P, JSON.stringify([r.pose, r.face, r.visor, r.held ?? null, doneMarks(rows), eu]),
        g => RM.agent(g, { pose: pa, face: r.face, visor: r.visor, slip: r.held, front }));
      pencilMarks(c, d.rays, { progress: clamp(bk.rays ?? 1, 0, 1), color: 'indigo', alpha: Math.min(1, gl) });
    }
    const wg = w && dk > 0 ? w.glow ?? 0 : 0;
    if (wg > 0) {   // a saved waiting slip glows too (GAME_SPEC §1.3): an indigo halo, the slip, rays
      glowBehind(c, g2 => drawSlip(g2, w, { badge: wb, color: 'indigo' }), wg, { blur: 7, strength: 1 });
      drawSlip(c, w, { alpha: Math.min(1, wg), badge: wb });
      if (!w.clip && Math.abs((w.x ?? WAIT.x) - WAIT.x) < 1 && Math.abs((w.y ?? WAIT.y) - WAIT.y) < 1) pencilMarks(c, d.slipRays, { progress: clamp(bk.rays ?? 1, 0, 1), color: 'indigo', alpha: Math.min(1, wg) });
      // a stamp decided in the dark hovers in front of the slip (a8 drawing 0): drawn again over the glowing slip, dark
      if (r.stamp) inDark(c, dk, stampBox(r.stamp, w), g => drawStamp(g, r.stamp, w));
    }
    // Temporal's pencil keeps writing, even in the dark (GAME_SPEC §1.4)
    if (lk <= 0 && ub >= 1) { const t = inkRows(c, rows); if (t) tips.indigo = t; }
    if (r.pencils) for (const p of r.pencils) drawPencilTool(c, [p.x, p.y], { color: p.color, lift: p.lift, angle: p.angle ?? .62 });
    else {
      // no hand draws in the dark: a part the crash froze half drawn keeps no graphite/green pencil
      if (tips.graphite && dk <= 0) drawPencilTool(c, tips.graphite, { color: 'graphite', lift: 0, angle: .62 });
      if (tips.indigo || tips.indigoBook) drawPencilTool(c, tips.indigo ?? tips.indigoBook, { color: 'indigo', lift: 0, angle: .62 });
      if (tips.green && dk <= 0) drawPencilTool(c, tips.green, { color: 'green', lift: 0, angle: .62 });
    }
    return false;
  }

  // ---------------------------------------------------------------- the notes close-up
  /** A close-up row's cels (stageB rows, stageB.js:31-38: cap 38, condense .82, x 70; unique compile ids). */
  function noteRow(k, label) {
    const d = build(), key = k + '/' + label;
    if (!d.notes.has(key)) {
      const y = SB.rowY(k) - SB.NB.y, t = textStrokes(label, 70, y, { cap: 38, condense: .82, id: 'game/nb/' + key, seed: 5 + k, width: 3 }), w = t.width;
      const cx = SB.NB.x + 70 + w / 2;
      d.notes.set(key, { w, text: compile({ strokes: t.strokes }, 'game/nb/' + key), checkX: SB.NB.x + 70 + w + 26,
        check: compile({ strokes: [checkStroke('game/nbchk/' + k, 0, 0)] }, 'game/nbchk/' + k),
        strike: compile({ strokes: [stroke('game/nbstrike/' + key, [[62, y - 17], [70 + w + 10, y - 20]], { width: 4.2, pressure: PRESS.flat })] }, 'game/nbstrike/' + key),
        ring: compile({ strokes: [stroke('game/ring/' + key, ellPoints(0, 0, w / 2 + 30, 40, -2.2, -2.2 + TAU * 1.06, 40), { width: 3.2, corner: 2 })] }, 'game/ring/' + key), cx });
    }
    return d.notes.get(key);
  }
  function noteRows(c, rows, labels) {
    for (let k = 0; k < 6; k++) {
      const n = noteRow(k, labels[k]), tp = mark(rows, k, 't'), cp = mark(rows, k, 'c'), sp = mark(rows, k, 'strike');
      if (tp > 0) { c.save(); c.translate(SB.NB.x, SB.NB.y); pencilMarks(c, n.text, { progress: tp, color: 'indigo' }); if (sp > 0) pencilMarks(c, n.strike, { progress: sp, color: 'indigo' }); c.restore(); }
      if (cp > 0) { c.save(); c.translate(n.checkX, SB.rowY(k)); pencilMarks(c, n.check, { progress: cp, color: 'indigo' }); c.restore(); }
    }
  }
  /**
   * The notes close-up (scene 'notes'): a9 insert() (a9.js:306-330) with R.notes = N = {rows, branch,
   * under, ring, arrow, alpha, glow?}; the page at INS (top-left 575, 312, scale 1.1: centred, 6 stageB rows, NOTE_DY lower).
   *   under[k]  0..1 LINEAR progress of row k's indigo underline (eased here, a9.js:316); an earlier
   *             underline fades to .3 while the next one draws (a9.js:317 `past`)
   *   ring      {row, part 't'|'c', u 0..1}: circled mark (a9.js:321; 't' circles the whole line)
   *   arrow     {row, part 't'|'c', pulse}: the next empty line ('t', a9.js:325) or check ('c', pointing
   *             left at the empty check place); pulse = phase 0..1 (a9: ((t - t0) * 1.5) % 1), alpha
   *             .65 + .35 |sin(pi pulse)|; reduced motion: pass .5
   *   glow      optional 0..1 halo of the rows (a9 .55 * sm(0, .6, t)), default 1
   * Sets its own camera. @param {CanvasRenderingContext2D} c @param {object} R  with R.notes set
   * @returns {boolean} false (the caller draws the vignette)
   */
  function notes(c, R) {
    const N = (R && R.notes) || {}, rows = N.rows ?? BASE_R.book.rows, labels = rowLabels(N.branch), d = build(), NBx = SB.NB.x;
    cam(c, CX, CY, 1); paperSheet(c);
    c.save(); c.globalAlpha *= clamp(N.alpha ?? 1, 0, 1);
    c.save(); c.translate(INS.x - SB.NB.x * INS.s, INS.y - SB.NB.y * INS.s); c.scale(INS.s, INS.s);
    glowBehind(c, g2 => { g2.save(); g2.translate(0, NOTE_DY); noteRows(g2, rows, labels); g2.restore(); }, .55 * clamp(N.glow ?? 1, 0, 1), { blur: 8, strength: .8 });
    SB.notebook(c, { rows: [] });
    c.translate(0, NOTE_DY);   // the rows, their underlines, the ring and the arrow: one ruled line down (a9.js:311)
    noteRows(c, rows, labels);
    const under = N.under ?? [];
    for (let k = 0; k < 6; k++) {   // reading: each saved line underlined in turn (a9.js:315-319)
      const ul = easeOut(clamp(under[k] ?? 0, 0, 1)); if (ul <= 0) continue;
      let nx = -1; for (let j = k + 1; j < 6; j++) if ((under[j] ?? 0) > 0) { nx = j; break; }
      const past = nx < 0 ? 0 : sm(0, .67, under[nx]), n = noteRow(k, labels[k]);
      const x0 = NBx + 62, x1 = n.checkX + 44, y = SB.rowY(k) + 12;
      c.save(); c.strokeStyle = COL.indigo; c.lineCap = 'round'; c.lineWidth = 4; c.globalAlpha *= .8 - past * .5; c.beginPath(); c.moveTo(x0, y); c.lineTo(lerp(x0, x1, ul), y + 1.5); c.stroke(); c.restore();
    }
    const rg = N.ring;
    if (rg && (rg.u ?? 1) > 0 && rg.row >= 0 && rg.row < 6) {   // a9.js:320-321
      const n = noteRow(rg.row, labels[rg.row]), u = easeOut(clamp(rg.u ?? 1, 0, 1));
      c.save(); if (rg.part === 't') { c.translate(n.cx, SB.rowY(rg.row) - 18); pencilMarks(c, n.ring, { progress: u, color: 'indigo' }); }
      else { c.translate(n.checkX + 20, SB.rowY(rg.row) - 20); pencilMarks(c, d.ring, { progress: u, color: 'indigo' }); }
      c.restore();
    }
    const ar = N.arrow;
    if (ar && ar.row >= 0 && ar.row < 6) {   // a9.js:323-325
      const a = .65 + .35 * Math.abs(Math.sin((ar.pulse ?? .5) * Math.PI)), ay = SB.rowY(ar.row) - 16;
      c.save(); c.globalAlpha *= a; c.strokeStyle = COL.indigo; c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
      if (ar.part === 'c') { const ax = noteRow(ar.row, labels[ar.row]).checkX + 58; c.moveTo(ax + 70, ay); c.lineTo(ax, ay); c.moveTo(ax + 17, ay - 16); c.lineTo(ax, ay); c.lineTo(ax + 17, ay + 16); }
      else { const ax = NBx + 150; c.moveTo(ax - 70, ay); c.lineTo(ax, ay); c.moveTo(ax - 17, ay - 16); c.lineTo(ax, ay); c.lineTo(ax - 17, ay + 16); }
      c.stroke(); c.restore();
    }
    c.restore();
    // his mitten hands hold the page at the sides (a9.js:329)
    c.save(); c.translate(INS.x, 930); c.fillStyle = COL.paper; c.beginPath(); c.ellipse(-8, 0, 34, 32, 0, 0, TAU); c.ellipse(778, 0, 34, 32, 0, 0, TAU); c.fill(); pencilMarks(c, d.mitts); c.restore();
    c.restore();
    return false;
  }

  // ---------------------------------------------------------------- the crash
  /**
   * His recovery performance at tu (seconds since the unplug click), a9 perf() re-timed (a9.js:162-187):
   * slump -> wake (6 drawings) -> blink -> rest -> look 'side' -> grab (NBGRAB) -> lift by LIFT_K (face
   * 'down') -> held up (the close-up) -> put down ('happy') -> let go -> rest. Used by the lit branch of
   * ROOM.crash AND as the pose a re-crash slumps from (K.prev.tu): the same drawing, no pop.
   * @param {number} tu @returns {{pose: string|{from: string, to: string, t: number}, face: string, visor: number, k: number}}
   *   k = the notebook lift, LIFT_K index / 5 (R.book.k)
   */
  const WAKE_LOOKS = [[0, 'off'], [CRASH_T.half, 'half'], [CRASH_T.rest[0], 'open'], [CRASH_T.look, 'side'], [CRASH_T.down, 'down'], [CRASH_T.put[0], 'happy']];
  const WAKE_POSES = [[0, 'slump'], [CRASH_T.wake[0], 'wake', CRASH_T.wake[1] - CRASH_T.wake[0], easeInOutSine], [CRASH_T.rest[0], 'rest', CRASH_T.rest[1] - CRASH_T.rest[0]],
    [CRASH_T.grab[0], 'NBGRAB', CRASH_T.grab[1] - CRASH_T.grab[0], easeOut]];
  const liftPose = i => (LIFT_K[i] >= 1 ? 'HOLDBOOK' : LIFT_K[i] <= 0 ? 'NBGRAB' : { from: 'NBGRAB', to: 'HOLDBOOK', t: LIFT_K[i] });
  function wakeAt(tu) {
    const T = CRASH_T, q = tw(Math.max(0, tu)) + 1e-6;
    let face = 'off'; for (const [t, fc] of WAKE_LOOKS) if (q >= t) face = fc;
    if (['open', 'down', 'half', 'side', 'sideR'].includes(face) && q >= T.blink && q < T.blink + f(1) - 1e-6) face = 'closed';
    const visor = q < T.visor ? 1 : q < T.visor + f(1) ? .6 : q < T.visor + f(2) ? .3 : 0;
    let pose, i = 0;
    if (q < T.lift[0]) pose = track(q, WAKE_POSES);
    else if (q < T.put[0]) { i = clamp(Math.floor((q - T.lift[0]) * 12 + 1e-6), 0, 5); pose = liftPose(i); }
    else if (q < T.put[1]) { i = 5 - clamp(Math.floor((q - T.put[0]) * 12 + 1e-6), 0, 5); pose = liftPose(i); }
    else pose = track(q, [[0, 'NBGRAB'], [T.letgo[0], 'rest', T.letgo[1] - T.letgo[0]]]);
    return { pose, face, visor, k: i / 5 };
  }
  /** The plug hand (rig-local, relative to the plug), a9 handAt (a9.js:237-246) on the crash clocks. */
  function handOf(tc, tu, pull) {
    const T = CRASH_T;
    const act = (tau, i0, grip, rel, out, yk) => {
      const q = tw(tau) + 1e-6;
      if (q < grip) { const u = sm(i0, grip, q, easeOut); return { pose: 'reach', x: lerp(150, 6, u), y: lerp(260, 4, u), rot: lerp(.3, .04, u) }; }
      if (tau < rel) return { pose: 'grip', x: 0, y: pull * .06, rot: .02 - pull * yk };
      if (q > out[1]) return null;
      const u = sm(out[0], out[1], q, easeIn); return { pose: 'reach', x: 10 + u * 190, y: 10 + u * 300, rot: .06 + u * .3 };
    };
    if (tu !== null && tu >= T.plugIn[0]) return act(tu, T.plugIn[0], T.regrip, T.release2, T.plugOut, .0006);
    return act(tc, T.handIn[0], T.grip, T.release, T.handOut, 0);
  }
  /** The plug out 0..PULLED (a9 pullAt, a9.js:231-235): pulled on ones (u^2), pushed home on ones (easeOut). */
  function pullOf(tc, tu) {
    const T = CRASH_T;
    if (tu !== null && tu >= T.push[0]) return lerp(PULLED, 0, easeOut(clamp((tu - T.push[0]) / (T.push[1] - T.push[0]), 0, 1)));
    if (tc < T.pull[0]) return 0;
    const u = clamp((tc - T.pull[0]) / (T.pull[1] - T.pull[0]), 0, 1); return PULLED * u * u;
  }
  /**
   * The crash overlay (GAME_SPEC §4 crash steps 2-7) applied to the frozen room state R, drawn on the
   * two crash clocks K.tc / K.tu against ROOM.CRASH_T: the hand (4 drawings in, grip, pull on ones in
   * .134 s), the spark 1/12 s after the pull starts, dark .85 -> .3 -> 1 (a .3 s fade when reduced), the
   * lamp off, face 'wide' 1 drawing then 'off', visor .45 -> 1, the slump over 4 drawings from ANY pose
   * (poseKey), the glow (pulse 1.5 s on twos, none when reduced) on the notebook and a saved waiting
   * slip, the in-progress props drop, then the push, the flicker, the wake and the notebook grab / lift /
   * put down (ROOM.wakeAt) and, when K.notes is set, R.notes for the close-up. Tracks are continuous
   * across phase switches (tc/tu, never K.t). Pure.
   *
   * ROOM.crash OWNS these per-crash decisions, from K only (never G):
   *   - the waiting slip: K.saved.wait -> it glows in the dark (wait.glow); else it was the worker's
   *     and drops (wait.drop 0..1 over 4 drawings from 1 drawing after the spark; a4.js:51-60).
   *   - the drawer: K.saved.drawer false -> the folder sinks and the drawer shuts (a3's 2 drawings).
   *   - the envelope: K.saved.envelope false and it is in flight -> it drops ('drop', from = where it was).
   *   - the request in his hands goes back to his right hand as he slumps (held -> 0).
   *   - the printer LED goes out; the notebook glows while dark (book.glow, book.rays).
   *   - the props snap: from the power (K.tu >= CRASH_T.power), the WORKER_FIELDS come from K.rec via
   *     ROOM.snap (GAME_SPEC §4 crash step 8).
   *   - A CRASH DURING A RECOVERY (K.prev set): the WORKER_FIELDS start from ROOM.snap(R, K.prev.rec)
   *     (the props as they had snapped) and the crash rules apply to them; pose, face, visor and the
   *     notebook lift start from ROOM.wakeAt(K.prev.tu) (what was on screen); the slump starts from that
   *     pose (a poseKey name for an inbetween); a lifted notebook comes down one drawing per 1/12 s, in
   *     his hands (the pose is the lift drawing of that k until the slump takes over).
   * @param {object} R  the room state at G.frozenQ (the frozen beat's R)
   * @param {{phase: string, t: number, tc: number, tu: number|null, reduced: boolean, when: string,
   *   saved: {wait: boolean, drawer: boolean, envelope: boolean}, rec: object|null,
   *   prev: null|{phase: string, t: number, tu: number, rec: object|null}, notes: object|null}} K
   *   (story.js SCHEMAS "THE CRASH"; runtime.js view())
   * @returns {object} a new R
   */
  function crash(R, K) {
    const T = CRASH_T, sv = K.saved ?? {}, tc = K.tc ?? 0, tu = K.tu ?? null, lit = tu !== null && tu >= T.power;
    const base = K.prev && K.prev.rec ? snap(R, K.prev.rec) : { ...R }, r = { ...BASE_R, ...base }, bk0 = { ...BASE_R.book, ...r.book };
    const out = { ...base, notes: K.notes ?? null }, dk = darkOf(K), q = tw(tc) + 1e-6, s = tc - T.spark;
    const w0 = K.prev ? wakeAt(K.prev.tu ?? 0) : null;   // what was on screen at this plug click (a re-crash)
    const pose0 = w0 ? w0.pose : r.pose, k0 = w0 ? w0.k : bk0.k ?? 0;
    out.dark = dk; out.lamp = dk < .5 ? 1 : 0;   // a9.js:264
    // the glow (a9.js:288-289, :294): on the notebook while it lies on the desk; runs on tc through the flicker
    const pulse = K.reduced ? 1 : 1 + .1 * Math.sin((q - T.spark) * TAU / 1.5);
    const glow = dk > 0 && s >= 0 ? dk * (.6 + .4 * sm(T.glow[0], T.glow[1], tc)) * pulse : 0, rays = sm(T.rays[0], T.rays[1], tc, easeOut);
    if (lit) {
      const Wk = wakeAt(tu);
      Object.assign(out, snap(out, K.rec), { pose: Wk.pose, face: Wk.face, visor: Wk.visor, pull: pullOf(tc, tu), hand: handOf(tc, tu, 0), spark: 0 });
      out.book = { ...bk0, k: Wk.k, glow: Wk.k <= 0 ? glow : 0, rays };
      if (out.wait && sv.wait) out.wait = { ...out.wait, glow };
      return out;
    }
    const pull = pullOf(tc, tu);
    out.pull = pull; out.hand = handOf(tc, tu, pull);
    out.spark = s >= 0 && s < T.sparkFade[1] ? 1 - sm(T.spark + T.sparkFade[0], T.spark + T.sparkFade[1], tc) : 0;
    if (s < 0) {   // the hand is on its way: the room is still as it was
      if (w0) Object.assign(out, { pose: w0.pose, face: w0.face, visor: w0.visor, book: { ...bk0, k: w0.k } });
      return out;
    }
    const ki = Math.max(0, Math.round(k0 * 5) - Math.floor((q - T.spark) * 12));
    // a re-crash with the notebook up: his hands bring it down with it (the lift drawing of its k), then he slumps from there
    const poseNow = w0 && Math.round(k0 * 5) > 0 ? liftPose(ki) : pose0, from = poseName(poseNow);
    out.face = q < T.spark + T.wide ? 'wide' : 'off';
    out.visor = q < T.spark + T.visorSteps[1][0] ? .45 : 1;
    // the slump's inbetween, snapped to AGENT's 1/12 so its ends reuse the key drawings' cache (no 'x>slump@0.000' twin)
    const st = Math.round(12 * (q < T.slump[0] ? 0 : q < T.slump[1] ? easeIn((q - T.slump[0]) / (T.slump[1] - T.slump[0])) : 1)) / 12;
    out.pose = st <= 0 ? poseNow : st >= 1 ? 'slump' : { from, to: 'slump', t: st };
    out.book = { ...bk0, k: ki / 5, glow: ki <= 0 ? glow : 0, rays };
    out.led = 0;
    const w = r.wait;
    if (w) out.wait = sv.wait ? { ...w, glow } : { ...w, drop: tw(clamp((tc - T.spark - f(1)) / f(4), 0, 1) * f(4)) * 3 };
    if (!sv.drawer && ((r.drawer ?? 0) > 0 || (r.folder ?? 0) > 0)) {   // the folder sinks, the drawer shuts (a3 shut, 2 drawings)
      out.folder = (r.folder ?? 0) * (1 - clamp(Math.floor(s * 12 + 1e-6) / 2, 0, 1));
      out.drawer = q < T.spark + f(2) ? r.drawer : q < T.spark + f(3) ? Math.min(r.drawer, .5) : 0;
    }
    const e = r.envelope;
    if (!sv.envelope && e && e.state === 'fly') out.envelope = { ...e, state: 'drop', from: e.fly ?? 0, fly: clamp(s / f(8), 0, 1) };
    if (typeof r.held === 'number' && r.held > 0) out.held = r.held * (1 - (q < T.slump[0] ? 0 : q < T.slump[1] ? (q - T.slump[0]) / (T.slump[1] - T.slump[0]) : 1));
    return out;
  }

  // ---------------------------------------------------------------- idles (GAME_SPEC §1.5)
  /** A blink ('closed' for 2 frames, 2/24 s) every 2-4 s, deterministic from t (SPEC2 acting rules). */
  function blinkAt(t, seed = 0) {
    let b = 1.2 + 2 * hash(0, seed);
    for (let n = 1; b <= t; n++) { if (t < b + 2 / 24 - 1e-9) return true; b += 2 + 2 * hash(n, seed); }
    return false;
  }
  /** The waiting slip's fidget: a8 WOB index (4 drawings on twos) every 1.25 s from t .5 (a8.js:144-148), else null. */
  function wobAt(t) { if (t < .5) return null; const k = Math.floor(((t - .5) % 1.25) * 12 + 1e-6); return k < 4 ? k : null; }
  /** The minute hand while it waits: follows the game clock, one turn per 6 s, stepped on twos (a8.js:94 re-driven). */
  const clockAngle = t => TAU * tw(Math.max(0, t)) / 6;
  /**
   * The hold idle for a room R at hq seconds into the hold: blinks (eyes faces only), the waiting slip's
   * wobble, the clock's minute hand. Pure; a beat's hold.idle may call it: idle(R(G, dur), hq).
   * @param {object} R @param {number} hq @returns {object} a new R
   */
  function idle(R, hq) {
    const o = { ...R }, face = R.face ?? 'open';
    if (['open', 'down', 'side', 'sideR', 'half'].includes(face) && blinkAt(hq)) o.face = 'closed';
    if (R.wait && !R.wait.clip && !(R.wait.drop > 0)) o.wait = { ...R.wait, wob: wobAt(hq) };
    if (R.clock) o.clock = { ...R.clock, angle: (R.clock.angle ?? 0) + clockAngle(hq) };
    return o;
  }

  // ---------------------------------------------------------------- screen boxes, warm-up
  /** room world -> screen (logical 1920x1080): (p - SD.CAM) * zoom + (CX, CY). @returns {[number, number]} */
  const toScreen = p => [(p[0] - SD.CAM.x) * SD.CAM.zoom + CX, (p[1] - SD.CAM.y) * SD.CAM.zoom + CY];
  /** A room-world box [x, y, w, h] -> a screen box. */
  const boxToScreen = b => { const a = toScreen([b[0], b[1]]); return [a[0], a[1], b[2] * SD.CAM.zoom, b[3] * SD.CAM.zoom]; };
  /** The drawn plug (and, while it is out, the gap up to the socket) in room world (cast.js:100 PLUG_OUTLINE, stageD.js:78). */
  function plugBox(pull, toSocket) {
    const s = SD.SOCK.s, x0 = SD.SOCK.x + (-165 - pull) * s, x1 = SD.SOCK.x + (toSocket ? 36 : 12) * s;
    return [x0, SD.SOCK.y - 46 * s, x1 - x0, 92 * s];
  }
  /** The waiting slip as drawn (its scale; rotation ignored: at most .04 rad), room world. */
  function waitBox(w) { const S = slipCel(w.which ?? 'issue_refund'), s = w.s ?? WAIT.s, x = w.x ?? WAIT.x, y = w.y ?? WAIT.y; return [x - S.w * s / 2, y - 44 * s, S.w * s, 88 * s]; }
  /**
   * Clickable drawn things for ui.js hotspots (GAME_SPEC §2 "Hotspots"), in ROOM WORLD boxes
   * [x, y, w, h]; runtime converts with boxToScreen, ui.js enforces >= 44x44 CSS px.
   * acts: on.plug ('plug' pulls it: the plug; 'unplug' plugs it back in: the pulled plug and the socket),
   * 'approve' (the waiting issue_refund slip = the stamp's target, while approval.waiting).
   * @param {object} R @param {{plug: 'plug'|'unplug'|false, approve: boolean}} on  which ones are live now
   * @returns {{act: string, world: number[]}[]}
   */
  function hotspots(R, on = {}) {
    const out = [];
    if (on.plug) out.push({ act: on.plug === 'unplug' ? 'unplug' : 'plug', world: plugBox((R && R.pull) ?? 0, on.plug === 'unplug') });
    if (on.approve && R && R.wait) out.push({ act: 'approve', world: waitBox(R.wait) });
    return out;
  }
  /**
   * Precompile the drawings a list of room states will need (agent pose blends, faces, slips), so a
   * new beat's first frame does not stall. runtime.js calls it from requestIdleCallback for the next
   * beat. Draws into the 4x4 scratch context. @param {object[]} list  R objects
   */
  function warm(list) { const g = scratchCtx(); for (const R of list) { g.save(); try { if (R && R.notes) notes(g, R); else frame(g, R); } finally { g.restore(); } } }

  return { PULLED, WAIT, CLOCK, NB, LAMPX, BADGE, INS, LIFT_K, WOB, STAMP_K, CRASH_T, POSES, WORKER_FIELDS, poseOf, poseKey, poseArg, badgeOf, BASE_R,
    frame, notes, crash, darkOf, bookTip, bookOpenTip, greenTip, wakeAt, snap, idle, blinkAt, wobAt, clockAngle, flightAt, toScreen, boxToScreen, hotspots, warm };
})();
