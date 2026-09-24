'use strict';
// ============================================================
// game/room.js: the agent's room, drawn from a room state R (story.js SCHEMAS "ROOM STATE").
// STUB with contracts (foundation). ROOM.frame already draws a correct room for the fields
// V2G2ROOM.frame understands (the a3 room: a3.js:290-312); the room builder adds the a9 layout
// (lamp at x 640, open notebook at (780, 808), a9.js:66), the tool slips, pause sign, clock and stamp
// at room scale (a8), the crash rig re-timed (a9.js:226-246), the glow (a9.js:287-295), the notes
// close-up (a9 insert, a9.js:306-330) and the idles.
//
// Rules: pure functions of R (no G, no Date, no random, no state kept between frames besides caches);
// pose names only (cache-safe keys, agent.js:149); a slip's scale >= .81 (capitals >= 44 px); a8's
// props come in at room scale under the room camera; stage B's Mac, box and big page never do.
// Called by runtime.js (draw), ui.js (hotspots) and story.js (ROOM.BASE_R, ROOM.WAIT, ...).
// ============================================================
window.ROOM = (() => {
  const RM = window.V2G2ROOM;
  /** How far the plug is out when the power is off (rig-local px). The room uses a9's layout, so
   *  a9's value: 120 (a9.js:69), not a3's 110 (a3.js:49). R.pull runs 0..PULLED. */
  const PULLED = 120;
  /** Where a waiting slip rests (room world, centre) and its scale (GAME_SPEC §4 intro). */
  const WAIT = { x: 1330, y: 520, s: .85 };
  /** The a8 clock's place next to the waiting slip: WAIT + (36, 146) * .85 (from a8.js:112 CLK). */
  const CLOCK = { x: WAIT.x + 36 * WAIT.s, y: WAIT.y + 146 * WAIT.s, s: 1.35 * WAIT.s };
  /** The open desk notebook (a9.js NB) and the lamp's x (a9.js:66 LAMPX). */
  const NB = { x: 780, y: 808 }, LAMPX = 640;

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
  const f = n => n / 12;
  const CRASH_T = (() => {
    const T = {
      // ---- tc: the pull (a9.js:47-48 handIn/grip/pull/spark/slump/release/handOut, re-timed) ----
      handIn: [0, f(4)],              // reach, 4 drawings on twos (a9: f(23)-f(31), 8)
      grip: f(4),                     // the grip drawing; the pull starts on it
      pull: [f(4), f(4) + .134],      // pull on ones, u^2 to ROOM.PULLED (a9.js:233, .134 s as a9)
      spark: f(5),                    // 1/12 after the pull starts (a9 f(33) -> f(34)): the prongs leave; red spark,
                                      // lamp off, face 'wide', visor .45, SFX_LIVE.crash()
      sparkFade: [.15, .25],          // spark alpha 1 -> 0 between spark + .15 and spark + .25 (a9.js:284)
      darkSteps: [[0, .85], [f(1), .3], [f(2), 1]],   // dark level from spark + t (a9.js:227-228 a4 blackout)
      wide: f(1),                     // face 'wide' for 1 drawing from the spark, then 'off' (a9.js:176 LOOKS)
      visorSteps: [[0, .45], [f(1), 1]],              // from the spark (a9.js:180 perf visor)
      slump: [f(6), f(10)],           // slump over 4 drawings, easeIn, from ANY pose (a9 f(35)-f(39); poseKey)
      release: f(8),                  // the hand lets go of the plug (a9 f(37) = spark + f(3))
      handOut: [f(9), f(16)],         // and leaves, easeIn (a9 f(38)-f(45))
      glow: [f(7), f(5) + 1],         // notebook glow .6 -> 1 of dark between these (a9.js:288), pulse 1.5 s
      rays: [f(7), f(5) + .67],       // the glow's rays draw on (a9.js:292)
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
      visor: f(12),                   // visor .6 for 1 drawing, .3 for 1, then 0 (a9 f(77), a9.js:180)
      half: f(13),                    // face 'half' from visor + f(1) (a9.js:177 LOOKS)
      wake: [f(13), f(19)],           // slump -> wake, 6 drawings, easeInOutSine (a9 f(78)-f(84))
      blink: f(21),                   // 'closed' for 1 drawing (a9 f(86) BLINKS)
      rest: [f(23), f(26)],           // wake -> rest, face 'open' at its start (a9 f(88)-f(91))
      look: f(26),                    // face 'side' toward the notebook; phase 'notes'; caption 'notes' (a9 f(91))
      grab: [f(27), f(30)],           // rest -> NBGRAB, easeOut (a9 f(92)-f(95))
      lift: [f(31), f(37)],           // NBGRAB -> HOLDBOOK by LIFT_K, one value per drawing (a9 f(96), a9.js:193)
      down: f(33),                    // face 'down' at lift + f(2) (a9.js:177)
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

  /**
   * Named poses R.pose may use, besides AGENT.KEYS (rest, typeA, typeB, read, book, point, reach, chin,
   * cheer, slump, wake). Values are cache-safe pose objects (V2G2ROOM.named, a3.js:98-103).
   * The room builder MUST add exactly these keys (copied with their definitions, cited):
   *   a9 (a9.js:76-84): RAISE, ONENV, ONENV_UP, FLICK, RLOOK, RLOOK_NOD, NBGRAB, HOLDBOOK
   *   a5 (a5.js:47-50): COCK, COCK_R, GLANCE   (the stage 2 crash replays a5's re-read, GAME_SPEC §4 st. 2)
   * plus the 'mix:<from>><to>@<t12>' names that poseKey registers at run time.
   * @type {Object<string, object>}
   */
  const POSES = { LOWREACH: RM.LOWREACH, NOD: RM.NOD, READ: RM.READ, REACH_L: RM.REACH_L };
  /** @param {string} name @returns {string|object} the pose key (AGENT.KEYS) or the named pose object */
  const poseOf = name => (AGENT.KEYS[name] ? name : POSES[name] ?? (() => { throw new Error('room pose ' + name); })());
  /**
   * A cache-safe NAME for an inbetween, for moves that start mid-move (the slump from any pose,
   * GAME_SPEC §4 crash step 3): registers POSES['mix:<from>><to>@<t12>'] = AGENT.mixPose(from, to, t12/12).
   * @param {string} from @param {string} to  pose names @param {number} t 0..1 (snapped to 1/12)
   * @returns {string} the new pose name
   */
  function poseKey(from, to, t) {
    const t12 = Math.round(clamp(t, 0, 1) * 12), n = `mix:${from}>${to}@${t12}`;
    if (!POSES[n]) POSES[n] = RM.named(AGENT.mixPose(poseOf(from), poseOf(to), t12 / 12), n);
    return n;
  }
  /**
   * R.pose -> what AGENT.draw takes: a string key of AGENT.KEYS, or {from, to, t}. A named pose object
   * alone is not a valid AGENT.draw pose (it reads pose.from), so it is wrapped the way a3 does it
   * (a3.js:114 asPose): {from: n, to: n, t: 1}. Same AGENT cache key as the film ('v2g2:read>v2g2:read@1.000'),
   * so the pixels equal a3's.
   */
  const poseArg = p => {
    if (typeof p === 'string') { const n = poseOf(p); return typeof n === 'string' ? n : { from: n, to: n, t: 1 }; }
    return { from: poseOf(p.from), to: poseOf(p.to), t: p.t };
  };

  /** The room at rest, as R (the a3 BASE, a3.js:290, in R's fields). */
  const BASE_R = {
    pose: 'rest', face: 'open', visor: 0, lamp: 1, dark: 0, pull: 0, hand: null, spark: 0, drawer: 0, folder: 0,
    traySlip: 1, held: null, book: { rows: Array.from({ length: 6 }, () => ({ t: 0, c: 0, strike: 0 })), k: 0, glow: 0, branch: 'approve' },
    wait: null, stamp: null, clock: null, receipt: { e: 0, check: 0 }, envelope: { state: 'desk', u: 1, fly: 0 },
    dash: null, pencils: [], q: 0, q2: 0, led: 0, notes: null,
    parts: { agent: 1, printer: 1, tray: 1, book: 1, clock: 1 }, slip: null,
  };
  /**
   * The fields of R that belong to the WORKER (its props in progress). On a crash they follow the
   * crash rules (drop, close, stop), and from the power-on flicker they snap to the recovery beat's R
   * (K.rec). Everything else (book, receipt, traySlip, world things) stays as the frozen R.
   */
  const WORKER_FIELDS = ['wait', 'drawer', 'folder', 'held', 'envelope', 'dash', 'stamp', 'clock', 'slip'];

  /**
   * Draw the whole room for R: sets the room camera cam(c, SD.CAM.x, SD.CAM.y, SD.CAM.zoom), the
   * paper, then everything in R (draw order as V2G2ROOM.frame, a3.js:292-312, plus the a8 props and
   * the glow). The caller did resetFrame(ctx) before and does resetT + captions + vignette after.
   * @param {CanvasRenderingContext2D} c @param {object} R  story.js SCHEMAS "ROOM STATE"
   * @returns {boolean} false (the caller draws the vignette; see SHOP.frame)
   */
  /** R.slip -> an a3 slip placement {x, y, s, rot, clipY?} (RM.slip, a3.js:180-184). */
  const slipOf = p => { const o = { x: p.x, y: p.y, s: p.s, rot: p.rot ?? 0 }; if (p.clipY !== undefined && p.clipY !== null) o.clipY = p.clipY; return o; };
  function frame(c, R) {
    const r = { ...BASE_R, ...R };
    cam(c, SD.CAM.x, SD.CAM.y, SD.CAM.zoom); paperSheet(c);
    // STUB: the a3 room via V2G2ROOM.frame (no notebook, slips, clock, stamp, glow yet).
    // parts -> RM.frame s.parts (a3.js:289-294: printer and tray draw their own progress; the agent is
    // left out until it is finished and drawn here in progress, as a3's room() does, a3.js:499-507).
    // slip -> the request in flight (s.flying, drawn in front) or, with slip.tray, landing in the tray
    // (s.slipAt, drawn at the tray's place; a3 slipState, a3.js:430-434).
    const parts = { ...BASE_R.parts, ...(R && R.parts) }, sl = r.slip;
    RM.frame(c, { ...RM.BASE, pose: poseArg(r.pose), face: r.face, visor: r.visor, lamp: r.lamp, dark: r.dark, pull: r.pull, hand: r.hand, spark: r.spark,
      drawer: r.drawer, folder: r.folder, slipAt: sl && sl.tray ? slipOf(sl) : r.traySlip ? RM.inTray : null, held: r.held, receipt1: r.receipt.e, receipt2: 0,
      envelope: r.envelope.state === 'desk' ? { u: r.envelope.u } : null, q: r.q, q2: r.q2, led: r.led,
      parts: { agent: parts.agent >= 1 ? 1 : 0, printer: parts.printer, tray: parts.tray }, flying: sl && !sl.tray ? slipOf(sl) : null });
    if (parts.agent > 0 && parts.agent < 1) RM.agent(c, { pose: 'rest', face: 'open', progress: parts.agent });   // from a3.js:470 partItem('agent')
    for (const p of r.pencils) drawPencilTool(c, [p.x, p.y], { color: p.color, lift: p.lift, angle: p.angle ?? .62 });
    return false;
  }

  /**
   * The notes close-up (scene 'notes'): a9 insert() (a9.js:306-330) with R.notes = {rows, branch,
   * under, ring, arrow, alpha}; page scale 1.1 centred at x 575 (GAME_SPEC §3). Sets its own camera.
   * STUB: the page only.
   * @param {CanvasRenderingContext2D} c @param {object} R  with R.notes set
   * @returns {boolean} false (the caller draws the vignette)
   */
  function notes(c, R) {
    cam(c, CX, CY, 1); paperSheet(c);
    c.save(); c.translate(575 - 350 * 1.1, 70); c.scale(1.1, 1.1); c.translate(-SB.NB.x, -SB.NB.y + 60); SB.notebook(c, {}); c.restore();
    return false;
  }

  /**
   * The crash overlay (GAME_SPEC §4 crash steps 2-7) applied to the frozen room state R, drawn on the
   * two crash clocks K.tc / K.tu against ROOM.CRASH_T (every sub-event and its a9 source is listed
   * there): the hand (4 drawings in, grip, pull on ones in .134 s), the spark 1/12 s after the pull
   * starts, dark .85 -> .3 -> 1 (a .3 s fade when reduced), the lamp off, face 'wide' 1 drawing then
   * 'off', visor .45 -> 1, the slump over 4 drawings from ANY pose (poseKey), the glow on the notebook
   * and a saved waiting slip, the push, the flicker, the wake over 6 drawings, the notebook grab/lift
   * (a9 NBGRAB, HOLDBOOK, LIFT_K) and, when K.notes is set, R.notes for the close-up. Re-timed from
   * a9.js:226-246 (handAt/pullAt/darkAt). Tracks are continuous across phase switches: draw from
   * tc/tu, not from K.t (K.t restarts at every phase switch). Pure.
   *
   * ROOM.crash OWNS these per-crash decisions, from K only (never G):
   *   - the waiting slip: K.saved.wait -> it glows in the dark (wait.glow); else it was the worker's
   *     and drops (wait.drop 0..1 from the plug click on; GAME_SPEC §4 st. 3, a4.js:51-60).
   *   - the drawer: K.saved.drawer false -> it shuts (drawer 0, folder sinks; st. 4 before commit).
   *   - the envelope: K.saved.envelope false and it is in flight -> it drops (envelope.state 'drop').
   *   - the notebook glows while dark (book.glow).
   *   - the props snap: from the power (K.tu >= CRASH_T.power: the flicker frames), the WORKER_FIELDS
   *     come from K.rec (the recovery beat's R) instead of R, so the worker's own props show the saved
   *     state (GAME_SPEC §4 crash step 8).
   *   - A CRASH DURING A RECOVERY (K.prev set: he was waking, or lifting / putting down his notes):
   *     the story is still frozen, so R is still the frozen beat's R, but what was on screen is the
   *     interrupted recovery. So (1) the WORKER_FIELDS start from K.prev.rec (the props as they had
   *     snapped), not from R, and the crash rules above apply to them; (2) the pose to slump from is
   *     the interrupted recovery's pose at K.prev.tu (the wake / rest / grab / lift track evaluated
   *     at that tu, named with ROOM.poseKey(from, to, t) when it is an inbetween); face, visor and the
   *     notebook lift (book.k) start from there too. The dark comes back from the lit room.
   * @param {object} R  the room state at G.frozenQ (the frozen beat's R)
   * @param {{phase: 'pulling'|'dark'|'pushing'|'waking'|'notes'|'recover', t: number, tc: number,
   *   tu: number|null, reduced: boolean, when: 'before'|'money'|'after'|'wait'|'any',
   *   saved: {wait: boolean, drawer: boolean, envelope: boolean}, rec: object|null,
   *   prev: null|{phase: 'waking'|'notes', t: number, tu: number, rec: object|null}, notes: object|null}} K
   *   t = seconds since the phase began (phase-local; do not animate on it); tc = seconds since the
   *   plug click; tu = seconds since the unplug click (null until then); when = G.worker.when
   *   (STORY.crashWhen at the click); saved = G.worker.saved (STORY.saved at the click); rec = the
   *   recovery beat's R (STORY.beat(G.worker.rec.id).R(G, G.worker.rec.q), set from 'pushing' on, else
   *   null); prev = the recovery this crash interrupted (G.worker.prev: its phase, its phase-local t
   *   and its tu at this plug click, and its recovery beat's R), null for a first crash;
   *   notes = STORY.notes(G, K.tu - CRASH_T.insert[0]) in the close-up, else null
   * @returns {object} a new R
   */
  function crash(R, K) {   // STUB: dark/lamp/props/pose in their simplest form on CRASH_T; the room builder adds hands, spark, glow pulse, lift
    const T = CRASH_T, sv = K.saved ?? {}, tu = K.tu ?? null, lit = tu !== null && tu >= T.power;
    const base = K.prev && K.prev.rec ? { ...R, ...pick(K.prev.rec) } : R, r = { ...BASE_R, ...base };
    const out = { ...base, notes: K.notes ?? null }, dk = darkOf(K);
    out.dark = dk; out.lamp = dk < .5 ? 1 : 0;   // a9.js:258
    if (!lit) {
      const pl = K.tc < T.pull[0] ? 0 : K.tc < T.pull[1] ? PULLED * ((K.tc - T.pull[0]) / (T.pull[1] - T.pull[0])) ** 2 : PULLED;   // a9.js:231-233
      out.pull = tu === null || tu < T.push[0] ? pl : lerp(PULLED, 0, easeOut(clamp((tu - T.push[0]) / (T.push[1] - T.push[0]), 0, 1)));   // a9.js:234
      if (K.tc >= T.spark) {
        const s = K.tc - T.spark;
        Object.assign(out, { face: s < T.wide ? 'wide' : 'off', visor: s < T.visorSteps[1][0] ? .45 : 1, book: { ...r.book, glow: dk } });
        out.pose = K.tc >= T.slump[1] ? 'slump' : K.tc >= T.slump[0] ? { from: slumpFrom(R, K), to: 'slump', t: easeIn((K.tc - T.slump[0]) / (T.slump[1] - T.slump[0])) } : out.pose;
        if (r.wait) out.wait = sv.wait ? { ...r.wait, glow: dk } : { ...r.wait, drop: 1 };
        if (!sv.drawer) Object.assign(out, { drawer: 0, folder: 0 });
        if (!sv.envelope && r.envelope && r.envelope.state === 'fly') out.envelope = { ...r.envelope, state: 'drop', fly: 1 };
      }
    } else {
      Object.assign(out, { pull: 0, face: tu < T.half ? 'off' : tu < T.rest[0] ? 'half' : 'open', visor: tu < T.visor ? 1 : tu < T.visor + f(1) ? .6 : tu < T.visor + f(2) ? .3 : 0 });
      out.pose = tu < T.wake[0] ? 'slump' : tu < T.wake[1] ? { from: 'slump', to: 'wake', t: (tu - T.wake[0]) / (T.wake[1] - T.wake[0]) } : tu < T.rest[0] ? 'wake' : 'rest';
      if (K.rec) for (const k of WORKER_FIELDS) if (k in K.rec) out[k] = K.rec[k]; else delete out[k];
    }
    return out;
  }
  /** The WORKER_FIELDS of an R (the props the worker owns). */
  const pick = R => { const o = {}; for (const k of WORKER_FIELDS) if (k in R) o[k] = R[k]; return o; };
  /** The pose NAME the slump starts from: R.pose, or a poseKey mix for an inbetween (STUB: the room
   *  builder evaluates K.prev's recovery track at K.prev.tu when K.prev is set). */
  const slumpFrom = (R, K) => { const p = (K.prev ? null : R.pose) ?? 'rest'; return typeof p === 'string' ? p : poseKey(p.from, p.to, p.t); };

  /** room world -> screen (logical 1920x1080): (p - SD.CAM) * zoom + (CX, CY). @returns {[number, number]} */
  const toScreen = p => [(p[0] - SD.CAM.x) * SD.CAM.zoom + CX, (p[1] - SD.CAM.y) * SD.CAM.zoom + CY];
  /** A room-world box [x, y, w, h] -> a screen box. */
  const boxToScreen = b => { const a = toScreen([b[0], b[1]]); return [a[0], a[1], b[2] * SD.CAM.zoom, b[3] * SD.CAM.zoom]; };
  /**
   * Clickable drawn things for ui.js hotspots (GAME_SPEC §2 "Hotspots"), in ROOM WORLD boxes
   * [x, y, w, h]; ui.js converts with toScreen and enforces >= 44x44 CSS px.
   * acts: on.plug ('plug' to pull it, 'unplug' to plug it back in while dark; runtime decides from
   * G.worker.phase), 'approve' (the waiting issue_refund slip while approval.waiting).
   * @param {object} R @param {{plug: 'plug'|'unplug'|false, approve: boolean}} on  which ones are live now
   * @returns {{act: string, world: number[]}[]}
   */
  function hotspots(R, on = {}) {
    const out = [];
    if (on.plug) out.push({ act: on.plug === 'unplug' ? 'unplug' : 'plug', world: [SD.SOCK.x - 150 - (R.pull ?? 0) * 1.2, SD.SOCK.y - 60, 170, 120] });   // STUB box
    if (on.approve && R.wait) out.push({ act: 'approve', world: [R.wait.x - 477 * R.wait.s / 2, R.wait.y - 44 * R.wait.s, 477 * R.wait.s, 88 * R.wait.s] });
    return out;
  }
  /**
   * Precompile the drawings a list of room states will need (agent pose blends, faces, slips), so a
   * new beat's first frame does not stall. runtime.js calls it from requestIdleCallback for the next
   * beat. Draws into the 4x4 scratch context. @param {object[]} list  R objects
   */
  function warm(list) { const g = scratchCtx(); for (const R of list) { g.save(); try { frame(g, R); } finally { g.restore(); } } }

  return { PULLED, WAIT, CLOCK, NB, LAMPX, CRASH_T, POSES, WORKER_FIELDS, poseOf, poseKey, poseArg, BASE_R, frame, notes, crash, darkOf, toScreen, boxToScreen, hotspots, warm };
})();
