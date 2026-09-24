'use strict';
// ============================================================
// game/runtime.js: the state G, the game clock, the main loop, the crash controller, the caption
// scheduler and the test API window.__game (GAME_SPEC §2 "Main loop", §4 "The crash sequence").
// The beat engine is generic: it runs whatever STORY.beats holds (events, commits, sfx cues, holds,
// step mode, next); the crash controller runs on ROOM.CRASH_T (room.js, the one crash timetable,
// a9-derived) and handles a crash during a recovery (see "the crash controller" below).
//
// Only this file changes G (directly, or by calling STORY functions and beat events with it).
// Frame: update(dt) -> draw() only when floor(clock * 24) changed or G.dirty (the live pointer does
// not set dirty: the shop cursor moves on the next 1/24 s drawing, GAME_SPEC §7).
// draw(): ctx.save(); resetFrame(ctx); scene renderer; resetT; the caption; vignette; ctx.restore().
//   Renderers return true when they drew the vignette themselves. A film window (S.film) also draws the
//   game's caption, routed through the act's own (blanked) caption slot, so the order stays the film's:
//   caption, then vignette (SHOP.frame o.caption).
// Canvas: getContext('2d', {alpha: false}) (+ willReadFrequently only with ?raster=cpu); never
// getImageData here. Backing width clamp(round(cssW * dpr), 960, 1920), debounced 150 ms (window
// resize and a ResizeObserver on the canvas: the layout can change its width without a window resize);
// 1920 in ?test=1.
// Clock: game seconds, dt clamped to 1/15 s; it stops while paused or while the tab is hidden.
//
// PLAYER ACTS (the one entry point act(name); ui.js and window.__game.act call it):
//   GAME_SPEC §2: start, buy, pay, refund, submit, approve, reject, plug, unplug, next, pause, sound,
//   rail:<k> (k 0..9). Also: step (toggle "Stop after each stage"), reduced (toggle G.settings.reduced; the
//   media query sets it too, and every renderer reads only G.settings.reduced, so both look the same),
//   again (Play again: keeps the name), rename (Change name: forgets the stored name, back to the
//   start card), break (Try to break it: stage 3 with the pull-the-plug hint).
//   'start' reads the name form (UI.nameValue) and only works on the start card; in tests
//   window.__game.act('start', 'Zoë') first writes that name into the form (UI.setName).
//   rail:<k> and break need a name (there is no default name, GAME_SPEC §0); window.__game.seek(k)
//   jumps without one (tests).
//   Approve/Reject while the power is off are queued (G.approval.queued) and applied once the
//   approval hold is reached again after the notes.
//
// CAPTIONS (GAME_SPEC §1.8): one at a time; a fully written caption is held max(2.5, words/3 + 1) s,
//   then fades .3 s; the next one starts >= .2 s after that. A caption interrupted by the plug fades at
//   once. Queue entries are {id, tMin, beat, tag?}; the crash controller tags ALL of its own ('crash',
//   'crashAgain', 'notes' and the outcome) with tag: 'crash', and a new plug pull drops every tagged
//   entry, so a quick re-crash never shows the previous crash's notes or outcome. Every other queued
//   caption is held back at the plug (G.worker.caps), with the frozen beat's own caption if the plug cut
//   it before it was fully written; they come back after the outcome if the frozen beat resumes, or if the
//   recovery moves on to a later stage (except a caption of a beat whose commits are all in G.book already,
//   which the outcome restates: s1b after a stage 1 crash), and stay dropped for a same-stage rerun.
//   A recovery beat's wait (stepWait) does not end in the middle of an idle blink.
//   "The outcome caption, then the recovery beat" (GAME_SPEC §4 step 8): a recovery into a new stage (or a
//   beat with captions of its own, or a resumed beat whose caption came back) waits, idling, until the
//   captions before its own have been shown (G.beat.wait, stepWait), so a stage's caption goes with its
//   action; a resumed commit (the stamp) waits until the outcome has started. A room beat also does not
//   hand over to a new stage or scene while a caption of its stage is still to be shown.
//   The crash caption is queued at the click with `after` (spark + .667 s, a9): it starts after the spark.
//   Dropped unshown: a hold beat's captions when a player decision leaves the hold (s6b after Approve /
//   Reject, also a decision queued in the dark; the one already on screen keeps its hold); story captions of an earlier stage when a later stage
//   begins; everything when the end card begins (stepBeats first waits for the captions to finish, so an
//   outcome caption after a late crash is never drawn over the end card).
//   A shop caption ('buy', 'broken') stays up while the shop shows and nothing else waits (a1 / a2 hold
//   theirs for the whole act), then fades.
//   On the end card the status region reads the card's own lines (plug count, once / no money, thanks).
//
// SOUND OBLIGATIONS (runtime calls SFX_LIVE; every call is a no-op while sound is off):
//   - beat cues: STORY.sfxOf(beat, G) entries as q crosses t -> SFX_LIVE.play(type, opts).
//   - film windows: the act's own SCENES[i].cues as the window's tau crosses cue.t -> SFX_LIVE.filmCue.
//   - beat cues of type 'ding' are NOT played from the beat: the ding is runtime's, on "once" of the s9
//     caption (its written time - .04, a9.js:343), wherever the caption queue puts that caption.
//   - notebook ink, as the indigo pencil DRAWS it (STORY.inkPlan serialises the marks): scratch(true, .35)
//     while a mark is being drawn (GAME_SPEC §8 "Notebook line | pencil scratch gate .35");
//     play('chime', {note}) when a CHECK starts to be drawn (note = checks drawn before it % 2: the first
//     check plays F5). A check drawn inside a crash's silence stays silent.
//   - captions: scratch(true, .35) while a caption is being written; scratch(false) when nothing writes
//     (and while paused: the clock, and so the pencil, stops).
//   - the cards' pencil: the gate of CARDS.scratch(scene, V)'s interval holding the card's q (1 drawing,
//     .45 on ones), when cards.js exports it.
//   - the hum: on while a room scene ('room', 'notes') shows and the worker has power; off in 'shop',
//     'mail', 'start', 'end'. 'wide' leaves it alone (a3's own hum-on cue starts it there). The crash
//     owns it in between (crash() cuts it, power() brings it back); runtime only calls hum() for
//     changes the crash did not make (a rail jump out of the dark, Sound turned on in the room).
//   - the crash: NOT at the clicks. crash() when the plug clock tc crosses ROOM.CRASH_T.spark (1/12 s
//     after the pull starts, GAME_SPEC §4 step 2); power() when the unplug clock tu crosses
//     ROOM.CRASH_T.power (the push lands, a9 f(74)). Each fires once per crash (G.worker.sparked /
//     .powered), on the game clock, so pause and ?test=1 advance() keep them in step with the drawing.
//     sfx.js plays what it is given at once (the spark at now + .008); it schedules no offsets of its own.
//   Sound test (GAME_SPEC §10 test 9): click #btn-sound for real. window.__game.act('sound') is not a
//   user gesture, so the AudioContext may stay 'suspended'.
// ============================================================
(() => {
  const DT_MAX = 1 / 15;
  /** The one marker on every caption the crash controller queues (see CAPTIONS in the header). */
  const CRASH_TAG = 'crash';
  const ROOMS = ['room', 'notes'];
  let G = null, cv = null, ctx = null, lastNow = null, drawnKey = null, hidden = false, lastPointer = null, lastView = null;
  // sound bookkeeping (not game state): what runtime last asked sfx.js for; chimed = the checks (row|s0 in
  // STORY.inkPlan) whose chime has been played (cleared with a new G: restart, jump)
  const snd = { gate: null, hum: undefined, chimed: new Set() };
  let filmAt = null;
  const caps = new Map();   // capId|lines -> makeCaption object (compiled once)

  // ---------- beats ----------
  const beatOf = () => STORY.beat(G.beat.id);
  const qOf = t0 => Math.max(0, Math.floor((G.clock - t0) * 24 + 1e-9) / 24);
  /** Queue a beat's captions: [capId] or [capId, tMin] -> {id, tMin, beat} (story.js SCHEMAS "cap"). */
  const queueCaps = (b, id) => { for (const k of b.captions ?? []) G.cap.queue.push(Array.isArray(k) ? { id: k[0], tMin: k[1] ?? 0, beat: id } : { id: k, tMin: 0, beat: id }); };
  /** Enter beat `id` at game time t0 (default now). Unknown ids are ignored (stubs). */
  function enter(id, t0 = G.clock) {
    const b = STORY.beat(id); if (!b) return false;
    // "Try to break it"'s hint belongs to the stage it was given in (stage 3): a new stage has its own "Now:"
    if (G.hint && b.stage !== G.stage) G.hint = null;
    // a story caption that has not started by the time a LATER stage begins is dropped: it would be drawn
    // over another stage's action (a held caption after a decision in the dark, a long queue after a crash)
    if (b.stage !== G.stage) G.cap.queue = G.cap.queue.filter(x => !x.beat || (STORY.beat(x.beat)?.stage ?? b.stage) >= b.stage);
    // nothing is written over the end card (its own lines are the text there): a caption still on screen
    // fades at once and the queue is cleared (stepBeats waits for the captions before it enters the end)
    if (b.scene === 'end') { interruptCaption(); G.cap.queue = []; }
    G.beat = { id, t0, fired: 0, committed: 0, cued: 0 }; G.scene = b.scene; G.stage = b.stage; G.hold = null; G.dirty = true;
    G.q = G.frozenQ === null ? qOf(t0) : 0;   // entered on the way (t0 in the past): its q is already running
    queueCaps(b, id);
    warmNext(b); if (b.scene === 'room') warmCrash(); return true;
  }
  /** A player decision moves the story on from a hold beat: that beat's captions that have not started yet
   *  are dropped (s6b after an Approve / Reject would otherwise run through stage 7 or over the end card). */
  /** Is a crash's own caption (the outcome, after the power is back) still on screen or queued? A caption
   *  already fading (cut) does not count. */
  const crashCapPending = () => (G.cap.now && G.cap.now.tag === CRASH_TAG && G.cap.now.cut === null) || G.cap.queue.some(x => x.tag === CRASH_TAG);
  const stageOfBeat = id => STORY.beat(id)?.stage;
  /** Is a story caption of `stage` still to be shown: queued, or on screen (until it has faded; one cut by
   *  the plug does not count)? In an uncrashed play every room stage's caption has faded before its stage
   *  (or scene) ends: the beats are timed for it, so this only holds a boundary after a crash moved the
   *  captions later. */
  const storyCapPending = stage => {
    const n = G.cap.now, mine = x => !x.tag && x.beat && stageOfBeat(x.beat) === stage;
    return (n && n.cut === null && mine(n)) || G.cap.queue.some(mine);
  };
  /** A caption that must go before the current beat's own: anything on screen (until it has faded) or queued
   *  that is not this beat's (the outcome, a stage's held caption re-queued after a crash). */
  const foreignCapPending = () => { const n = G.cap.now; return (n && n.cut === null && n.beat !== G.beat.id) || G.cap.queue.some(x => x.beat !== G.beat.id); };
  const dropBeatCaps = () => { G.cap.queue = G.cap.queue.filter(x => x.beat !== G.beat.id); };
  /**
   * A beat entered or resumed by a recovery may wait before it runs (GAME_SPEC §4 crash step 8: "The outcome
   * caption, then the recovery beat"): G.beat.wait = {since, q, until}. While it waits the beat stays at q
   * (its t0 slides with the clock, so nothing after q fires; an event AT q 0, such as "Claude step 1
   * scheduled", is written at the recovery, which keeps a re-crash during the wait a proper retry) and the
   * room idles (ROOM.idle: blinks).
   *   until 'done'    a new stage's beat (or one with captions of its own): until the outcome and any
   *                   caption re-queued before it have been written, held and faded, so its own caption
   *                   starts at about q 0 with the action it describes (not dropped at the next stage).
   *   until 'started' the frozen beat resumed with a commit still ahead (the stamp before its impact): until
   *                   the outcome caption has started, so the commit is not made before its caption.
   */
  function stepWait() {
    const W = G.beat.wait; if (!W || G.frozenQ !== null || G.worker.phase !== 'on') return;
    let busy = W.until === 'started' ? G.cap.queue.some(x => x.tag === CRASH_TAG) : foreignCapPending();
    // not in the middle of an idle blink (view(): ROOM.idle at G.clock - W.since): the eyes would snap open
    // with the beat's first drawing; the wait ends with the blink (at most 2/24 s later)
    if (!busy && ROOM.blinkAt(G.clock - W.since)) busy = true;
    if (busy) G.beat.t0 = G.clock - W.q; else { delete G.beat.wait; G.dirty = true; }
  }
  /**
   * Does a crash in beat `id`, recovered into the SAME beat, start it over (true) or resume it where it
   * froze (false)? A retry beat (r2.reread, r4.run, r5.resume, r7.again, r7.money, r8.*, rj.again) runs an
   * Activity or a Claude step that is unfinished until its commit, so a crash before the commit times it
   * out and it starts again from the beginning as attempt n + 1, same Activity ID (facts.md §4). The beat
   * says so with `restart: true|false`; without the flag, a beat that starts a run at q 0 (an event at 0)
   * and does not wait for the player restarts; hold beats (s6.wait), the stamp before its impact and the
   * end beats (s9.done, rj.done) resume.
   */
  function restarts(id) {
    const b = STORY.beat(id); if (!b) return false;
    if (typeof b.restart === 'boolean') return b.restart;
    return !b.hold && (b.events ?? []).some(e => e[0] === 0);
  }
  const commits = b => (b.commit ? (Array.isArray(b.commit) ? b.commit : [b.commit]) : []);
  /** Advance the current beat to G.q: events, commits, sfx cues, hold, next (several beats if needed). */
  function stepBeats() {
    for (let guard = 0; guard < 8; guard++) {
      const b = beatOf(); if (!b) return;
      const B = G.beat, q = G.frozenQ ?? G.q, dur = STORY.durOf(b, G);
      const ev = b.events ?? []; while (B.fired < ev.length && q >= ev[B.fired][0]) ev[B.fired++][1](G);
      // a commit only writes G.book / G.ink; its chime plays when the pencil DRAWS the check (sound(): inkPlan)
      const cm = commits(b); while (B.committed < cm.length && q >= cm[B.committed].t) {
        const c = cm[B.committed++];
        G.book[c.row][c.part] = 1; G.ink.push({ row: c.row, part: c.part, t0: G.clock });
      }
      // the ding is runtime's own: it lands on "once" of the s9 caption (sound()), not on a beat time
      const sf = STORY.sfxOf(b, G); while (B.cued < sf.length && q >= sf[B.cued][0]) { const [, type, opts] = sf[B.cued++]; if (type !== 'ding') SFX_LIVE.play(type, opts); }
      if (G.frozenQ !== null || q < dur) return;
      if (b.hold) { if (!G.hold) { G.hold = { t0: B.t0 + dur }; G.dirty = true; } return; }
      if (G.hold && G.hold.step) return;                                   // step mode: waits for 'next'
      const next = b.next(G); if (!next || next === B.id) return;
      const nb = STORY.beat(next); if (!nb) return;
      if (G.settings.stepMode && nb.stage !== b.stage) { G.hold = { t0: B.t0 + dur, step: true }; G.dirty = true; return; }
      // the end card waits until every caption has been shown and has faded (an outcome caption after a
      // late crash in rj.done / s9.done would otherwise be drawn over it); it then starts from its beginning
      if (nb.scene === 'end' && (G.cap.now || G.cap.queue.length)) { B.late = true; return; }
      // a new stage (or a new scene: s9.done -> the mail page) waits while a crash's outcome caption, or a
      // caption of this stage, is still to be written or held: it holds this beat's last drawing (the stamped
      // sheet after a decision queued in the dark or a stamp crash) instead of running the next stage under
      // it, which would push that stage's own caption past its end (enter() then drops it) or draw this
      // stage's caption over the next scene. The next beat then starts from its beginning. A safety net: a
      // recovery into a new stage already waits for the outcome before it runs (stepWait).
      if ((nb.stage !== b.stage || nb.scene !== b.scene) && ROOMS.includes(b.scene) && (crashCapPending() || storyCapPending(b.stage))) { B.late = true; return; }
      enter(next, B.late ? G.clock : B.t0 + dur);
    }
  }
  /** A decision made while the power was off is applied once the approval hold is reached again. */
  function applyQueued() {
    const d = G.approval.queued, b = beatOf();
    if (!d || G.worker.phase !== 'on' || !b || !b.hold || b.hold.action !== 'approve' || !G.hold) return;
    // the stamp waits until the crash's outcome caption ('Now it is stamped.') has started: it is then
    // written as the stamp falls, not over stage 7's refund (and stage 7 keeps its own caption)
    if (G.cap.queue.some(x => x.tag === CRASH_TAG)) return;
    const next = STORY.onAct(G, d); if (next) { dropBeatCaps(); enter(next); }
  }

  // ---------- precompile the next beat in idle time (GAME_SPEC §2 "Main loop", §7) ----------
  // The first drawing of a new pose blend, face or slip costs a compile (~1-3 ms each, engine.md §3); the
  // next beat's room states are drawn once into the 4x4 scratch context (ROOM.warm) on the ones grid,
  // one pose/face at a time, while the idle deadline has time left. A newer beat cancels the job.
  // WebKit (Safari, iOS) has no requestIdleCallback: a timer with a 10 ms budget stands in for it.
  const idle = typeof requestIdleCallback === 'function' ? (f, o) => requestIdleCallback(f, o)
    : f => setTimeout(() => { const t0 = performance.now(); f({ didTimeout: false, timeRemaining: () => Math.max(0, 10 - (performance.now() - t0)) }); }, 50);
  // One ROOM.warm is a whole room drawing (~4,400 strokes, plus a compile on first use): the next one starts
  // only when the deadline has room for the last one's measured cost (kept across jobs). A job that could
  // not afford one lowers the estimate, so a single slow compile never stalls the warming for good.
  let warmGen = 0, warmCost = 8;
  function warmList(list, dl) {
    let i = 0, did = false;
    while (i < list.length && dl.timeRemaining() > warmCost * 1.5) {
      const t0 = performance.now(); ROOM.warm([list[i++]]); did = true; warmCost = Math.max(4, performance.now() - t0);
    }
    if (!did) warmCost = Math.max(4, warmCost * .7);
    return i;
  }
  function warmNext(b) {
    if (BOOT.test) return;
    const gen = ++warmGen; let list = null;
    const job = dl => {
      if (gen !== warmGen) return;
      try {
        if (!list) {
          const nb = STORY.beat(b.next(G)); if (!nb || nb.scene !== 'room') return;
          const d = Math.min(STORY.durOf(nb, G), 10), seen = new Set(); list = [];
          const add = R => { const k = JSON.stringify([R.pose, R.face, R.wait && R.wait.which, R.stamp && R.stamp.word]); if (!seen.has(k)) { seen.add(k); list.push(R); } };
          for (let q = 0; q <= d + 1e-9; q += 1 / 12) add(nb.R(G, Math.floor(q * 24 + 1e-9) / 24));
          if (nb.hold) add(nb.hold.idle(G, 0));
        }
        list = list.slice(warmList(list, dl));
      } catch (e) { return; }   // warming is optional: the drawing compiles on first use anyway
      if (list.length) idle(job, { timeout: 3000 });
    };
    idle(job, { timeout: 3000 });
  }
  /** One-time warm-ups that are not "the next beat": the room itself (during the start card, so the first
   *  rail jump or "Try to break it" does not compile the whole room inside one frame), and, once a room
   *  beat is entered, the crash's own drawings (the slump, the dark and its glow, the wake and the lift)
   *  and the notes close-up. Each runs once per page, in idle time, through the same cost budget. */
  const warmed = new Set();
  function warmOnce(key, build) {
    if (BOOT.test || warmed.has(key)) return;
    warmed.add(key); let list = null;
    const job = dl => {
      try { if (!list) list = build(); list = list.slice(warmList(list, dl)); } catch (e) { return; }
      if (list.length) idle(job, { timeout: 3000 });
    };
    idle(job, { timeout: 3000 });
  }
  function warmCrash() {
    warmOnce('crash', () => {
      const T = ROOM.CRASH_T, sv = { wait: false, drawer: false, envelope: false }, R0 = { ...ROOM.BASE_R };
      const K = (phase, tc, tu, notes = null) => ROOM.crash(R0, { phase, t: 0, tc, tu, reduced: !!G.settings.reduced, when: 'any', saved: sv, rec: null, prev: null, notes });
      const list = [K('pulling', T.spark, null), K('pulling', T.slump[1], null), K('dark', T.glow[1], null)];
      for (const tu of [T.power, T.wake[1], T.lift[1]]) list.push(K('waking', tu + 3, tu));
      for (const t of [0, 1, 2, 3]) list.push(K('notes', T.insert[0] + t + 3, T.insert[0] + t, STORY.notes(G, t)));
      return list;
    });
  }

  // ---------- the crash controller (GAME_SPEC §4 "The crash sequence") ----------
  // Timing: ROOM.CRASH_T only. G.worker while crashed (story.js SCHEMAS "worker"):
  //   {phase, t0 (clock at the phase start), c0 (clock at the plug click), u0 (clock at the unplug
  //    click, null before), when, saved, rec, caps, prev, sparked, powered, hq, reads}
  //   reads = read ticks already played in the notes close-up (undefined before the notes)
  //   hq = the hold's idle time at the plug click (null when the beat was not holding): the idle stops
  //   with the story and goes on from there if the frozen beat resumes.
  // phases: pulling -(tc >= out)-> dark -(unplug)-> pushing -(tu >= power)-> waking -(tu >= look)->
  //   notes (scene 'notes' while tu in CRASH_T.insert) -(tu >= done)-> recover -> on (same update)
  // At the click: G.frozenQ, then STORY.onPlug?.(G) (if story.js has it), then when = STORY.crashWhen(G)
  // and saved = STORY.saved(G).
  // A CRASH DURING A RECOVERY ('waking', or 'notes' outside the close-up; STORY.plugState): the story
  // is still frozen, so G.frozenQ and G.beat stay; when and saved are recomputed from G; the held
  // captions are MERGED (old worker.caps + anything still queued that is not the crash's own); rec = null
  // (the next unplug decides again); prev = {phase, t, tu, rec} of the interrupted recovery, for
  // ROOM.crash (K.prev: slump from the wake inbetween, props kept as they had snapped to prev.rec).
  const clockOf = w => ({ tc: G.clock - w.c0, tu: w.u0 === null || w.u0 === undefined ? null : G.clock - w.u0 });
  /** The plug's state for the controls: STORY.plugState, refused on an unknown beat (a stub, a bad id):
   *  there is no room state to crash (foundation review issue 1). */
  const plugNow = () => (beatOf() ? STORY.plugState(G) : { ok: false, reason: 'plugMoving' });
  /** The crash caption starts after the spark, as in a9 (a9.js:36: caption t0 3.5 against the spark at
   *  f(34) = 2.833): it is queued at the click (the queue shows what comes) but waits until then. */
  const CAP_AFTER_SPARK = .667;
  function plug() {
    const w0 = G.worker, again = w0.phase === 'waking' || w0.phase === 'notes';
    if (!(w0.phase === 'on' || again) || !plugNow().ok) return;
    const b = beatOf();
    if (!again) G.frozenQ = G.hold && G.hold.step ? Math.min(G.q, STORY.durOf(b, G)) : G.q;   // a step hold shows the beat's last drawing
    // the story's one write a crash causes (stage 1: the request is already durable), made at the click
    // with G.frozenQ set, before when and saved are read; optional (an older story.js has no onPlug)
    if (typeof STORY.onPlug === 'function') STORY.onPlug(G);
    const when = STORY.crashWhen(G);
    G.crashes.push({ stage: G.stage, when }); G.hint = null;
    const nowCrashes = G.crashes.filter(c => !c.past).length;   // a rail jump starts a new story: its crashes are not "again"
    // every queued story caption is held back; it comes back only if the frozen beat is resumed. The
    // crash's own (tagged) captions are dropped: a new crash supersedes the old notes and outcome.
    // A story caption of the frozen beat that the plug cuts before it is fully written is held too (first):
    // if that beat resumes it is written again after the outcome (s9.done keeps "The refund happens once.",
    // s6.wait "Risky steps wait for a human."). A fully written one was read; it is not shown twice.
    const n = G.cap.now, nk = !again && n && n.cut === null && !n.tag && n.beat === G.beat.id && capObj(n.id);
    const unwritten = nk && G.clock - n.t0 < nk.written ? [{ id: n.id, tMin: 0, beat: n.beat }] : [];
    const held = [...(again ? w0.caps ?? [] : []), ...unwritten, ...G.cap.queue.filter(x => x.tag !== CRASH_TAG)];
    G.cap.queue = [];
    const prev = again ? { phase: w0.phase, t: G.clock - w0.t0, tu: clockOf(w0).tu, rec: w0.rec } : null;
    const hq = again ? w0.hq ?? null : G.hold && !G.hold.step ? G.clock - G.hold.t0 : null;
    G.worker = { phase: 'pulling', t0: G.clock, c0: G.clock, u0: null, when, saved: STORY.saved(G), rec: null, caps: held, prev, sparked: false, powered: false, hq };
    if (again) G.scene = 'room';
    interruptCaption();
    G.cap.queue.push({ id: nowCrashes > 1 ? 'crashAgain' : 'crash', tMin: 0, beat: null, tag: CRASH_TAG, after: G.clock + ROOM.CRASH_T.spark + CAP_AFTER_SPARK }); G.dirty = true;
  }
  function unplug() {
    if (G.worker.phase !== 'dark') return;
    // the recovery beat is decided ONCE, here, from G.book and G.world (STORY.recoverFor): from the
    // power on (tu >= CRASH_T.power), the worker's props are drawn from that beat's R (ROOM.crash K.rec).
    // The frozen beat itself: resumed at G.frozenQ, or started over (q 0) if it is a retry beat (restarts)
    const id = STORY.recoverFor(G), resume = id === G.beat.id && !restarts(id);
    G.worker = { ...G.worker, phase: 'pushing', t0: G.clock, u0: G.clock, rec: { id, q: resume ? G.frozenQ : 0 } }; G.dirty = true;
  }
  /** After the notes: the outcome caption, then the recovery beat (resumed where it froze if it is the
   *  frozen beat and not a retry beat; a retry beat starts over: its run fires again as attempt n + 1). */
  function recover() {
    const w = G.worker;
    // the outcome belongs to every crash this recovery answers (a double crash: both records)
    // (and so does the recovery beat, c.rec: story.js panel() shows the note after a recovery that moved
    // to another stage)
    const rec = w.rec ?? { id: STORY.recoverFor(G), q: 0 }, fq = G.frozenQ, frozen = G.beat.id;
    const oc = STORY.outcome(G); for (const c of G.crashes) if (!c.outcome && !c.past) { c.outcome = oc; c.rec = rec.id; }
    // the notes caption (still on screen) fades now: the outcome is written ~.5 s after the power is back,
    // not behind it (a resumed stamp would otherwise land before its "Now it is stamped.")
    if (G.cap.now && G.cap.now.id === 'notes') interruptCaption();
    G.cap.queue.push({ id: oc, tMin: 0, beat: null, tag: CRASH_TAG });
    G.frozenQ = null; G.worker = { phase: 'on', t0: G.clock }; G.dirty = true;
    const fb = STORY.beat(frozen), rb = STORY.beat(rec.id);
    if (rec.id === frozen && !restarts(frozen)) {                          // same beat: resume where it froze
      G.beat.t0 = G.clock - fq; G.q = fq; G.scene = fb?.scene ?? G.scene; G.cap.queue.push(...(w.caps ?? []));
      if (G.hold && w.hq !== null && w.hq !== undefined) G.hold.t0 = G.clock - w.hq;
      // It may wait where it froze (stepWait; a re-crash's wait is renewed): a beat whose own caption comes
      // back (s9.done's "The refund happens once.", cut unwritten by the plug) waits until the outcome has
      // been shown, so its caption goes with its action (the cheer) again; a beat with a commit still ahead
      // (the stamp before its impact) waits until the outcome caption has started ("Now it is stamped." is
      // written as the stamp falls, not after it). A hold beat never waits: its hold is open from the power-on.
      delete G.beat.wait;
      if (fb && !fb.hold && (w.caps ?? []).some(x => x.beat === frozen)) G.beat.wait = { since: G.clock, q: fq, until: 'done' };
      else if (fb && !fb.hold && G.beat.committed < commits(fb).length) G.beat.wait = { since: G.clock, q: fq, until: 'started' };
      return;
    }
    // another beat (or the frozen one started over). Moving to a LATER stage, the frozen stage's held captions
    // that were not shown yet come back after the outcome, except those of a beat whose commits are all already
    // in G.book: the outcome says the same (s1b "Temporal writes down every finished step." after a stage 1
    // crash: row 0 is written at the click, and out1 "Your request was already written down." follows), and
    // re-queued it would keep the next stage idling under it. In the same stage the outcome speaks for the
    // rerun and they all stay dropped (GAME_SPEC §4 step 8).
    const later = !!(fb && rb && rb.stage > fb.stage), before = G.cap.queue;
    const written = id => { const cm = commits(STORY.beat(id) ?? {}); return cm.length > 0 && cm.every(c => G.book[c.row][c.part]); };
    const back = later ? (w.caps ?? []).filter(x => !(x.beat && stageOfBeat(x.beat) === fb.stage && written(x.beat))) : [];
    G.cap.queue = [];
    if (!enter(rec.id)) { G.cap.queue = before; G.scene = fb?.scene ?? 'room'; return; }
    G.cap.queue = [...before, ...back, ...G.cap.queue];
    // "The outcome caption, then the recovery beat": a beat of a new stage, or one with captions of its own,
    // waits at q 0 (idling) until the captions queued before its own have been shown, so its caption starts
    // with its action (not after it, nor dropped when the next stage begins). A same-stage rerun (r2.reread,
    // r7.again, ...) has no caption of its own: it runs under the outcome caption, which describes it.
    if (rb.stage !== fb?.stage || (rb.captions ?? []).length) G.beat.wait = { since: G.clock, q: 0, until: 'done' };
  }
  function stepCrash() {
    const w = G.worker, T = ROOM.CRASH_T, { tc, tu } = clockOf(w), go = p => { G.worker = { ...G.worker, phase: p, t0: G.clock }; G.dirty = true; };
    if (!w.sparked && tc >= T.spark) { w.sparked = true; SFX_LIVE.crash(); }
    if (w.phase === 'pulling' && tc >= T.out) go('dark');
    else if (w.phase === 'pushing' && tu >= T.power) { go('waking'); G.worker.powered = true; SFX_LIVE.power(); }
    else if (w.phase === 'waking' && tu >= T.look) { go('notes'); G.cap.queue.push({ id: 'notes', tMin: 0, beat: null, tag: CRASH_TAG }); }
    else if (w.phase === 'notes') {
      const sc = tu >= T.insert[0] && tu < T.insert[1] ? 'notes' : 'room'; if (sc !== G.scene) { G.scene = sc; G.dirty = true; }
      // GAME_SPEC §8 "Notes close-up | read ticks": STORY.notes underlines line i from .3 + .3i; a9 ticks
      // .15 s into each underline (w.reads survives go(): it spreads G.worker)
      const tn = tu - T.insert[0], nl = G.book.filter(r => r.t).length; w.reads = w.reads ?? 0;
      while (w.reads < nl && tn >= .45 + w.reads * .3) SFX_LIVE.play('readTick', { k: w.reads++ });
      if (tu >= T.done) { go('recover'); recover(); }
    } else if (w.phase === 'recover') recover();
  }
  /** Is the worker's power on (the hum may run)? Off from the spark until the push lands. */
  const powered = () => { const w = G.worker; return w.phase === 'on' || (w.phase === 'pulling' ? !w.sparked : w.phase !== 'dark' && w.phase !== 'pushing'); };

  // ---------- captions (GAME_SPEC §1.8) ----------
  function capObj(id) {
    const spec = CONTENT.drawn.captions[id]; if (!spec) return null;
    const lines = spec.lines.map(l => STORY.fill(l, { name: G.drawnName })), key = id + '|' + lines.join('/');
    if (!caps.has(key)) { const words = lines.join(' ').trim().split(/\s+/).length; caps.set(key, makeCaption('game/' + key, { lines, t0: 0, hold: Math.max(2.5, words / 3 + 1), colors: spec.colors })); }
    return caps.get(key);
  }
  /** A queued caption may start: not before its `after` time (the crash caption: after the spark), and
   *  then: no beat condition, its beat is over, or q reached tMin in its beat. */
  const capReady = x => !(x.after > G.clock) && (x.beat === null || x.beat !== G.beat.id || (G.frozenQ === null && G.q >= x.tMin));
  /** A shop caption stays up for its whole sequence, as a1's and a2's do in the film (a1 until the act ends,
   *  a2 until 11.846): it holds while the shop shows and nothing else waits to be written. */
  const shopHold = () => G.scene === 'shop' && !G.cap.queue.length;
  function stepCaptions() {
    const C = G.cap;
    if (C.now && C.now.sticky && C.now.cut === null) { if (shopHold()) C.now.out = Math.max(C.now.out, G.clock); else C.now.sticky = false; }
    if (C.now && G.clock >= (C.now.cut ?? C.now.out) + .3) { C.last = (C.now.cut ?? C.now.out) + .3; C.now = null; G.dirty = true; }
    while (!C.now && C.queue.length && G.clock >= C.last + .2 && capReady(C.queue[0])) {
      const x = C.queue.shift(), k = capObj(x.id); if (!k) continue;   // an unknown id is skipped
      C.now = { id: x.id, beat: x.beat ?? null, t0: G.clock, out: G.clock + k.out, cut: null }; G.dirty = true;
      if (x.tag) C.now.tag = x.tag;
      if (x.beat && STORY.beat(x.beat)?.scene === 'shop') C.now.sticky = true;
    }
  }
  /** A caption interrupted by the plug fades at once (its text is already in the status region). */
  function interruptCaption() { const n = G.cap.now; if (n && n.cut === null) { n.cut = Math.min(n.out, G.clock); n.sticky = false; } }
  function drawCaption(c) {
    const n = G.cap.now; if (!n) return; const k = capObj(n.id); if (!k) return;
    // a held shop caption: its drawing stays at the fully written moment for the extra hold, then fades
    let tau = G.clock - n.t0; const extra = (n.out - n.t0) - k.out; if (extra > 1e-9 && tau > k.out) tau = Math.max(k.out, tau - extra);
    const a = n.cut !== null ? clamp(1 - (G.clock - n.cut) / .3, 0, 1) : 1; if (a <= 0) return;
    c.save(); c.globalAlpha *= a; k.draw(c, tau); c.restore();
  }
  /** The current caption as one line of text for the status region ('' when none). On the end card: its
   *  own lines (drawn only on the aria-hidden canvas), so a screen reader hears the ending once. */
  function captionText() {
    const n = G.cap.now, sp = n && CONTENT.drawn.captions[n.id];
    if (sp) return sp.lines.map(l => STORY.fill(l, { name: G.name })).join(' ');
    if (G.scene !== 'end') return '';
    const E = CONTENT.drawn.end, n2 = G.crashes.length, v = { name: G.name, n: n2 };
    return [n2 > 0 ? (n2 === 1 ? E.plugs1 : E.plugs) : '', G.branch === 'reject' ? E.noMoney : E.once.text, G.name ? E.thanks : '']
      .filter(Boolean).map(s => STORY.fill(s, v)).join(' ');
  }

  // ---------- sound obligations (see the header) ----------
  function sound() {
    const n = G.cap.now, k = n && n.cut === null && capObj(n.id), still = G.settings.paused || hidden;
    // the notebook as the indigo pencil DRAWS it (STORY.inkPlan: a check committed with its text is drawn
    // after it; on Reject: the strike, 'rejected', then the check): the scratch while a mark is drawn, and
    // the chime when a check starts to be drawn (note = checks drawn before it % 2: the first plays F5).
    // A check drawn inside a crash's silence stays silent (play() refuses there) and is not played later.
    const plan = STORY.inkPlan(G); let ink = false, nc = 0;
    for (const i of plan) {
      const on = G.clock >= i.s0 && G.clock < i.s0 + i.d; if (on) ink = true;
      if (i.part !== 'c') continue;
      const key = i.row + '|' + i.s0;
      if (on && !snd.chimed.has(key)) { snd.chimed.add(key); SFX_LIVE.play('chime', { note: nc % 2 }); }
      nc++;
    }
    const cap = !!k && G.clock - n.t0 < k.written;
    // the ding lands on "once" of "The refund happens once." (a9.js:36, :343: cue at the caption's written - .04),
    // wherever that caption is written (after a crash the outcome caption goes first)
    if (k && n.id === 's9' && !n.ding && G.clock - n.t0 >= k.written - .04) { n.ding = true; SFX_LIVE.play('ding'); }
    let gate = !still && (ink || cap) ? .35 : 0;
    // the cards' own pencil (title, lines, agent, desk, badge, thanks): gate 1 drawing, .45 on ones (kit.js
    // stage.scratch), if cards.js exports its intervals
    if (!still && (G.scene === 'start' || G.scene === 'end') && typeof CARDS.scratch === 'function') {
      try { const V = view(), q = V.q ?? 0; for (const [a, b, g] of CARDS.scratch(G.scene, V) ?? []) if (q >= a && q < b) gate = Math.max(gate, g); } catch (e) { /* optional */ }
    }
    if (gate !== snd.gate) { snd.gate = gate; SFX_LIVE.scratch(gate > 0, gate || undefined); }
    if (G.scene === 'wide') { snd.hum = undefined; return; }             // a3's own hum-on cue owns it here
    const want = ROOMS.includes(G.scene) && powered();
    if (want !== snd.hum) { if (G.worker.phase === 'on' || snd.hum === undefined) SFX_LIVE.hum(want); snd.hum = want; }   // else crash()/power() did it
  }
  /** Replay a film window's own cues as its tau crosses them (update() calls it with the window's
   *  {act, tau}, or null outside a film window). A window entered at tau < .1 plays its cues from 0; a
   *  jump into the middle of one (a seek) plays only what comes after. */
  function filmCues(F) {
    if (!F) { filmAt = null; return; }
    const from = filmAt && filmAt.act === F.act && F.tau >= filmAt.tau ? filmAt.tau : (F.tau < .1 ? -1e-9 : F.tau);
    filmAt = { act: F.act, tau: F.tau };
    const a = SHOP.act(F.act); if (!a || !a.cues) return;
    for (const cue of a.cues) if (cue.t > from && cue.t <= F.tau) SFX_LIVE.filmCue(cue, F.act);
  }

  // ---------- update and draw ----------
  function update(dt) {
    if (!G.settings.paused && !hidden) G.clock += Math.min(Math.max(dt, 0), DT_MAX);
    stepWait(); if (G.frozenQ === null) G.q = qOf(G.beat.t0);
    stepBeats(); if (G.worker.phase !== 'on') stepCrash(); applyQueued(); stepCaptions(); sound();
    // film cues on every update, not per drawing: ?test=1 draws once per advance(), and a cue must not be lost
    filmCues(G.scene === 'shop' || G.scene === 'wide' ? view().film : null);
  }
  /** The renderer's input for the current moment (story.js SCHEMAS R / S / C). An unknown beat draws
   *  the base state ({}: ROOM.BASE_R in a room); the crash overlay applies either way. */
  function view() {
    const b = beatOf(), w = G.worker, crashed = w.phase !== 'on';
    let V = {};
    if (b) {
      const step = G.hold && G.hold.step, q = G.frozenQ ?? (step ? Math.min(G.q, STORY.durOf(b, G)) : G.q);
      const hq = G.hold && (crashed && w.hq !== null && w.hq !== undefined ? w.hq : G.clock - G.hold.t0);
      V = G.hold && b.hold ? b.hold.idle(G, hq) : b.R(G, q);
      // a recovery beat waiting for its captions (stepWait) idles: blinks, the waiting slip's fidget
      if (G.beat.wait && !G.hold && !crashed && ROOMS.includes(G.scene) && V) V = ROOM.idle(V, G.clock - G.beat.wait.since);
    }
    if (ROOMS.includes(G.scene) && crashed) {
      const recR = r => { const rb = r && STORY.beat(r.id); return rb ? rb.R(G, r.q) : null; }, { tc, tu } = clockOf(w);
      V = ROOM.crash(V ?? {}, { phase: w.phase, t: G.clock - w.t0, tc, tu, reduced: G.settings.reduced, when: w.when, saved: w.saved,
        rec: w.phase !== 'pulling' && w.phase !== 'dark' ? recR(w.rec) : null,
        prev: w.prev ? { phase: w.prev.phase, t: w.prev.t, tu: w.prev.tu, rec: recR(w.prev.rec) } : null,
        notes: G.scene === 'notes' ? STORY.notes(G, tu - ROOM.CRASH_T.insert[0]) : null });
    }
    return V ?? {};
  }
  function draw() {
    const V = view(); let vig = false, captioned = false;
    ctx.save();
    try {
      resetFrame(ctx);
      if (G.scene === 'start') vig = CARDS.start(ctx, V);
      else if (G.scene === 'end') vig = CARDS.end(ctx, V);
      else if (ROOMS.includes(G.scene)) vig = V.notes ? ROOM.notes(ctx, V) : ROOM.frame(ctx, V);
      else { vig = SHOP.frame(ctx, V.live ? { ...V, pointer: lastPointer && SHOP.pointer(lastPointer, V.at) } : V, { caption: drawCaption }); captioned = !!V.film; }
      resetT(ctx); if (!captioned) drawCaption(ctx); if (!vig) vignette(ctx);
    } finally { ctx.restore(); }
    G.dirty = false;
    return V;
  }
  /** The view model ui.js renders (UI.sync's second argument; story.js / ui.js contracts). */
  function sync(V) {
    const a = STORY.action(G), p = plugNow(), dark = G.worker.phase === 'dark';
    let hot = [];
    if (G.scene === 'room') hot = ROOM.hotspots(V, { plug: p.ok ? (dark ? 'unplug' : 'plug') : false, approve: a.act === 'approve' && a.enabled }).map(h => ({ act: h.act, box: ROOM.boxToScreen(h.world) }));
    else if (G.scene === 'shop' && a.act && a.enabled) hot = SHOP.hotspots(V, { [a.act]: true }).map(h => ({ act: h.act, box: h.world }));
    lastView = { action: a, plug: p, panel: STORY.panel(G), hotspots: hot, caption: captionText(),
      crashes: G.crashes.map(c => ({ stage: c.stage, mark: STORY.railMark(c) })) };
    UI.sync(G, lastView);
  }
  /** The still cards (GAME_SPEC §7 "only on change"): once a card is a still picture (q >= its T.still, no
   *  caption) its drawing changes only with the start card's blink, so the key stops moving with the clock.
   *  T.still is looked up once per card beat (CARDS.times builds or reads the cached card). */
  let stillOf = { key: null, still: Infinity };
  function cardKey() {
    if ((G.scene !== 'start' && G.scene !== 'end') || G.cap.now || typeof CARDS.times !== 'function') return null;
    const V = view(), ck = G.scene + '|' + G.beat.id + '|' + G.beat.t0;
    if (stillOf.key !== ck) { let s = Infinity; try { s = CARDS.times(G.scene, V).still; } catch (e) { s = Infinity; } stillOf = { key: ck, still: Number.isFinite(s) ? s : Infinity }; }
    return (V.q ?? 0) >= stillOf.still ? G.scene + '|still|' + (G.scene === 'start' && V.blink ? 1 : 0) : null;
  }
  // the canvas off-screen (scrolled to the lower sections): the clock and update() go on, the panel is still
  // synced, but nothing is drawn; the first drawing after it comes back is forced (G.dirty)
  let onScreen = true;
  function frame(now) {
    const dt = lastNow === null ? 0 : (now - lastNow) / 1000; lastNow = now;
    update(dt);
    lastPointer = UI.pointer();   // read at draw time; no redraw of its own (at most one drawing per 1/24 s)
    const key = cardKey() ?? G.scene + '|' + Math.floor(G.clock * 24 + 1e-9);
    if (key !== drawnKey || G.dirty) {
      drawnKey = key;
      if (onScreen) sync(draw()); else { const V = view(); G.dirty = false; sync(V); }
    }
  }
  // the loop survives an exception in a renderer (reported once per message, not 60 times a second)
  const reported = new Set();
  function loop(now) {
    requestAnimationFrame(loop);
    try { frame(now); } catch (e) { const m = String(e && e.stack || e); if (!reported.has(m)) { reported.add(m); console.error(e); } }
  }

  // ---------- player actions (the one entry point; UI and window.__game call it) ----------
  function restart(who) { G = STORY.newGame(who, G.settings); snd.chimed.clear(); NAME.install(G); const next = STORY.onAct(G, 'start'); if (next) enter(next); }
  /**
   * Jump to the start of stage k (STORY.canon): the rail, "Try to break it", window.__game.seek. The crash
   * challenge survives it (GAME_SPEC §4: every crash is recorded and the rail marks it): the records are
   * kept as `past` ones: {stage, when} for the rail's words and the end card's count, without their
   * outcome, so the panel's outcome note (story.js panel) belongs only to crashes of the story now playing.
   * A crash in progress (a rail click in the dark) is kept the same way. "Play again" starts from none.
   */
  function jump(k) {
    if (!Number.isInteger(k) || k < 0 || k > 9) return false;
    const past = G.crashes.map(c => ({ stage: c.stage, when: c.when, past: true }));
    G = STORY.canon(k, G); G.crashes = past; snd.chimed.clear(); enter(G.beat.id, G.clock); return true;
  }
  function act(name) {
    const s = G.settings;
    if (name === 'pause') { s.paused = !s.paused; lastNow = null; }
    else if (name === 'sound') {
      s.sound = !s.sound; snd.gate = null; snd.hum = undefined;              // sound() re-sends the scratch gate and the hum
      if (s.sound) SFX_LIVE.enable(); else SFX_LIVE.disable();
    } else if (name === 'step') {
      s.stepMode = !s.stepMode;
      if (!s.stepMode && G.hold && G.hold.step && G.worker.phase === 'on') { const next = STORY.onAct(G, 'next'); if (next) enter(next); }
    } else if (name === 'reduced') s.reduced = !s.reduced;
    else if (name === 'plug') plug();
    else if (name === 'unplug') unplug();
    else if (name === 'start') {
      if (G.scene !== 'start') return;
      const v = UI.nameValue(), who = NAME.prepare(v.name); if (!who.ok) return;
      if (v.remember) NAME.store.save(who.name); else NAME.store.forget();
      restart(who);
    } else if (name === 'again') { if (G.name) restart(G); }
    else if (name === 'rename') { NAME.store.forget(); G = STORY.newGame({}, s); snd.chimed.clear(); }   // ui.js clears the form and focuses it on the scene change
    else if (name === 'break' || name.startsWith('rail:')) {
      if (!G.name) return;                                                    // no default name: the start card first
      if (!jump(name === 'break' ? 3 : Number(name.slice(5)))) return;
      if (name === 'break') G.hint = 'tryBreakHint';
    } else {
      const decide = !(G.hold && G.hold.step);
      const next = STORY.onAct(G, name);
      if (next) {
        // a decision leaves the hold: its unshown captions go. The one on screen ("You are the manager now.")
        // keeps its minimum hold (GAME_SPEC §1.8: only the plug interrupts a caption); the stamp beat rests
        // until it has faded (story.js stampDur), so stage 7's caption still starts at about q 0.
        if (decide) dropBeatCaps();
        enter(next);
      }
    }
    G.dirty = true;
  }

  // ---------- canvas size (GAME_SPEC §2 "Resize") ----------
  function size() {
    const w = BOOT.test ? 1920 : clamp(Math.round(cv.getBoundingClientRect().width * (window.devicePixelRatio || 1)), 960, 1920);
    // setFormat rounds the backing size to an even height (core.js:36), so OUT_W may differ from w by 1-2 px:
    // compare the requested width, not OUT_W (else every call would reallocate the canvas)
    if (w !== sizedW || cv.width !== OUT_W) { sizedW = w; setFormat({ ar: '16:9', width: w }); cv.width = OUT_W; cv.height = OUT_H; if (G) G.dirty = true; }
  }
  let resizeT = null, sizedW = null;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(size, 150); };

  // ---------- test API: window.__game ----------
  // Every load gets the part that cannot change the story: ready, state and view (deep copies) and advance,
  // which in a live load only syncs the DOM with G (no time: the rAF loop owns the clock). The live-mode
  // specs use them. Only ?test=1 (BOOT.test: no rAF) lets advance(sec) move time and adds act (act('start',
  // raw) writes the form without its maxlength) and seek (a jump with no name).
  window.__game = {
    ready: false,
    /** @returns {object} a deep copy of G */
    state: () => JSON.parse(JSON.stringify(G)),
    /** @returns {object|null} a deep copy of the last view model given to UI.sync (action, plug, panel, hotspots, caption, crashes) */
    view: () => (lastView ? JSON.parse(JSON.stringify(lastView)) : null),
    /** Live load: sync the DOM with G now (sec is ignored). */
    advance() { update(0); sync(draw()); },
  };
  if (BOOT.test) Object.assign(window.__game, {
    /** Advance game time by sec in 1/24 s steps, then draw once. @param {number} sec */
    advance(sec) { const n = Math.max(0, Math.round((+sec || 0) * 24)); for (let i = 0; i < n; i++) update(1 / 24); sync(draw()); },
    /**
     * A player action by name (the act list in the header). act('start', name) first writes `name`
     * into the name form, as if typed. @param {string} name @param {string=} arg
     */
    act(name, arg) { if (String(name) === 'start' && arg !== undefined) UI.setName(String(arg)); act(String(name)); update(0); sync(draw()); },
    /** Jump to the start of stage k (STORY.canon), with or without a name. @param {number} k 0..9 */
    seek(k) { jump(Number(k)); G.dirty = true; update(0); sync(draw()); },
  });

  function start() {
    cv = document.getElementById('cv');
    ctx = cv.getContext('2d', BOOT.raster === 'cpu' ? { alpha: false, willReadFrequently: true } : { alpha: false });
    SHOP.init(); G = STORY.newGame(); hidden = !!document.hidden;
    size(); UI.init({ act });
    addEventListener('resize', onResize);
    if (!BOOT.test && typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(cv);
    if (!BOOT.test && typeof IntersectionObserver === 'function') new IntersectionObserver(es => {
      const on = es[es.length - 1].isIntersecting; if (on && !onScreen && G) G.dirty = true; onScreen = on;
    }).observe(cv);
    document.addEventListener('visibilitychange', () => { hidden = document.hidden; lastNow = null; SFX_LIVE.visibility(hidden); });
    if (typeof matchMedia === 'function') { const mq = matchMedia('(prefers-reduced-motion: reduce)'); mq.addEventListener?.('change', () => { G.settings.reduced = mq.matches; G.dirty = true; }); }
    sync(draw());
    window.__game.ready = true;
    if (!BOOT.test) requestAnimationFrame(loop);
    warmOnce('room', () => [{ ...ROOM.BASE_R }]);   // the whole room, while the start card waits for a name
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
