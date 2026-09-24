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
//   rail:<k> (k 0..9). Also: step (toggle "Stop after each stage"), reduced (toggle reduced motion; the
//   media query sets it too), again (Play again: keeps the name), rename (Change name: forgets the
//   stored name, back to the start card), break (Try to break it: stage 3 with the pull-the-plug hint).
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
//   caption is held back at the plug (G.worker.caps) and comes back only if the frozen beat resumes.
//
// SOUND OBLIGATIONS (runtime calls SFX_LIVE; every call is a no-op while sound is off):
//   - beat cues: STORY.sfxOf(beat, G) entries as q crosses t -> SFX_LIVE.play(type, opts).
//   - film windows: the act's own SCENES[i].cues as the window's tau crosses cue.t -> SFX_LIVE.filmCue.
//   - notebook ink: scratch(true, .35) while any G.ink mark is still being written (GAME_SPEC §8
//     "Notebook line | pencil scratch gate .35"); play('chime', {note}) when a CHECK commit starts.
//   - captions: scratch(true, .35) while a caption is being written; scratch(false) when nothing writes
//     (and while paused: the clock, and so the pencil, stops).
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
  const snd = { gate: null, hum: undefined };   // sound bookkeeping (not game state): what runtime last asked sfx.js for
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
    G.beat = { id, t0, fired: 0, committed: 0, cued: 0 }; G.scene = b.scene; G.stage = b.stage; G.hold = null; G.dirty = true;
    G.q = G.frozenQ === null ? qOf(t0) : 0;   // entered on the way (t0 in the past): its q is already running
    queueCaps(b, id);
    warmNext(b); return true;
  }
  const commits = b => (b.commit ? (Array.isArray(b.commit) ? b.commit : [b.commit]) : []);
  /** Advance the current beat to G.q: events, commits, sfx cues, hold, next (several beats if needed). */
  function stepBeats() {
    for (let guard = 0; guard < 8; guard++) {
      const b = beatOf(); if (!b) return;
      const B = G.beat, q = G.frozenQ ?? G.q, dur = STORY.durOf(b, G);
      const ev = b.events ?? []; while (B.fired < ev.length && q >= ev[B.fired][0]) ev[B.fired++][1](G);
      const cm = commits(b); while (B.committed < cm.length && q >= cm[B.committed].t) {
        const c = cm[B.committed++]; G.book[c.row][c.part] = 1; G.ink.push({ row: c.row, part: c.part, t0: G.clock });
        if (c.part === 'c') SFX_LIVE.play('chime', { note: G.book.filter(r => r.c).length % 2 });   // alternates the two chimes (score2.js SFX.chime note 0|1)
      }
      const sf = STORY.sfxOf(b, G); while (B.cued < sf.length && q >= sf[B.cued][0]) { const [, type, opts] = sf[B.cued++]; SFX_LIVE.play(type, opts); }
      if (G.frozenQ !== null || q < dur) return;
      if (b.hold) { if (!G.hold) { G.hold = { t0: B.t0 + dur }; G.dirty = true; } return; }
      if (G.hold && G.hold.step) return;                                   // step mode: waits for 'next'
      const next = b.next(G); if (!next || next === B.id) return;
      const nb = STORY.beat(next); if (!nb) return;
      if (G.settings.stepMode && nb.stage !== b.stage) { G.hold = { t0: B.t0 + dur, step: true }; G.dirty = true; return; }
      enter(next, B.t0 + dur);
    }
  }
  /** A decision made while the power was off is applied once the approval hold is reached again. */
  function applyQueued() {
    const d = G.approval.queued, b = beatOf();
    if (!d || G.worker.phase !== 'on' || !b || !b.hold || b.hold.action !== 'approve' || !G.hold) return;
    const next = STORY.onAct(G, d); if (next) enter(next);
  }

  // ---------- precompile the next beat in idle time (GAME_SPEC §2 "Main loop", §7) ----------
  // The first drawing of a new pose blend, face or slip costs a compile (~1-3 ms each, engine.md §3); the
  // next beat's room states are drawn once into the 4x4 scratch context (ROOM.warm) on the ones grid,
  // one pose/face at a time, while the idle deadline has time left. A newer beat cancels the job.
  let warmGen = 0;
  function warmNext(b) {
    if (typeof requestIdleCallback !== 'function' || BOOT.test) return;
    const gen = ++warmGen; let list = null, i = 0;
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
        while (i < list.length && dl.timeRemaining() > 4) ROOM.warm([list[i++]]);
      } catch (e) { return; }   // warming is optional: the drawing compiles on first use anyway
      if (i < list.length) requestIdleCallback(job, { timeout: 3000 });
    };
    requestIdleCallback(job, { timeout: 3000 });
  }

  // ---------- the crash controller (GAME_SPEC §4 "The crash sequence") ----------
  // Timing: ROOM.CRASH_T only. G.worker while crashed (story.js SCHEMAS "worker"):
  //   {phase, t0 (clock at the phase start), c0 (clock at the plug click), u0 (clock at the unplug
  //    click, null before), when, saved, rec, caps, prev, sparked, powered, hq}
  //   hq = the hold's idle time at the plug click (null when the beat was not holding): the idle stops
  //   with the story and goes on from there if the frozen beat resumes.
  // phases: pulling -(tc >= out)-> dark -(unplug)-> pushing -(tu >= power)-> waking -(tu >= look)->
  //   notes (scene 'notes' while tu in CRASH_T.insert) -(tu >= done)-> recover -> on (same update)
  // A CRASH DURING A RECOVERY ('waking', or 'notes' outside the close-up; STORY.plugState): the story
  // is still frozen, so G.frozenQ and G.beat stay; when and saved are recomputed from G; the held
  // captions are MERGED (old worker.caps + anything still queued that is not the crash's own); rec = null
  // (the next unplug decides again); prev = {phase, t, tu, rec} of the interrupted recovery, for
  // ROOM.crash (K.prev: slump from the wake inbetween, props kept as they had snapped to prev.rec).
  const clockOf = w => ({ tc: G.clock - w.c0, tu: w.u0 === null || w.u0 === undefined ? null : G.clock - w.u0 });
  /** The plug's state for the controls: STORY.plugState, refused on an unknown beat (a stub, a bad id):
   *  there is no room state to crash (foundation review issue 1). */
  const plugNow = () => (beatOf() ? STORY.plugState(G) : { ok: false, reason: 'plugMoving' });
  function plug() {
    const w0 = G.worker, again = w0.phase === 'waking' || w0.phase === 'notes';
    if (!(w0.phase === 'on' || again) || !plugNow().ok) return;
    const b = beatOf();
    if (!again) G.frozenQ = G.hold && G.hold.step ? Math.min(G.q, STORY.durOf(b, G)) : G.q;   // a step hold shows the beat's last drawing
    const when = STORY.crashWhen(G);
    G.crashes.push({ stage: G.stage, when }); G.hint = null;
    // every queued story caption is held back; it comes back only if the frozen beat is resumed. The
    // crash's own (tagged) captions are dropped: a new crash supersedes the old notes and outcome.
    const held = [...(again ? w0.caps ?? [] : []), ...G.cap.queue.filter(x => x.tag !== CRASH_TAG)];
    G.cap.queue = [];
    const prev = again ? { phase: w0.phase, t: G.clock - w0.t0, tu: clockOf(w0).tu, rec: w0.rec } : null;
    const hq = again ? w0.hq ?? null : G.hold && !G.hold.step ? G.clock - G.hold.t0 : null;
    G.worker = { phase: 'pulling', t0: G.clock, c0: G.clock, u0: null, when, saved: STORY.saved(G), rec: null, caps: held, prev, sparked: false, powered: false, hq };
    if (again) G.scene = 'room';
    interruptCaption();
    G.cap.queue.push({ id: G.crashes.length > 1 ? 'crashAgain' : 'crash', tMin: 0, beat: null, tag: CRASH_TAG }); G.dirty = true;
  }
  function unplug() {
    if (G.worker.phase !== 'dark') return;
    // the recovery beat is decided ONCE, here, from G.book and G.world (STORY.recoverFor): from the
    // power on (tu >= CRASH_T.power), the worker's props are drawn from that beat's R (ROOM.crash K.rec)
    const id = STORY.recoverFor(G);
    G.worker = { ...G.worker, phase: 'pushing', t0: G.clock, u0: G.clock, rec: { id, q: id === G.beat.id ? G.frozenQ : 0 } }; G.dirty = true;
  }
  /** After the notes: the outcome caption, then the recovery beat (resumed where it froze if it is the
   *  frozen beat); the story runs again. */
  function recover() {
    const w = G.worker;
    // the outcome belongs to every crash this recovery answers (a double crash: both records)
    const oc = STORY.outcome(G); for (const c of G.crashes) if (!c.outcome) c.outcome = oc;
    G.cap.queue.push({ id: oc, tMin: 0, beat: null, tag: CRASH_TAG });
    const rec = w.rec ?? { id: STORY.recoverFor(G), q: 0 }, fq = G.frozenQ, frozen = G.beat.id;
    G.frozenQ = null; G.worker = { phase: 'on', t0: G.clock }; G.dirty = true;
    if (rec.id === frozen) {                                               // same beat: resume where it froze
      G.beat.t0 = G.clock - fq; G.q = fq; G.scene = STORY.beat(frozen)?.scene ?? G.scene; G.cap.queue.push(...(w.caps ?? []));
      if (G.hold && w.hq !== null && w.hq !== undefined) G.hold.t0 = G.clock - w.hq;
    } else if (!enter(rec.id)) G.scene = STORY.beat(frozen)?.scene ?? 'room';
  }
  function stepCrash() {
    const w = G.worker, T = ROOM.CRASH_T, { tc, tu } = clockOf(w), go = p => { G.worker = { ...G.worker, phase: p, t0: G.clock }; G.dirty = true; };
    if (!w.sparked && tc >= T.spark) { w.sparked = true; SFX_LIVE.crash(); }
    if (w.phase === 'pulling' && tc >= T.out) go('dark');
    else if (w.phase === 'pushing' && tu >= T.power) { go('waking'); G.worker.powered = true; SFX_LIVE.power(); }
    else if (w.phase === 'waking' && tu >= T.look) { go('notes'); G.cap.queue.push({ id: 'notes', tMin: 0, beat: null, tag: CRASH_TAG }); }
    else if (w.phase === 'notes') {
      const sc = tu >= T.insert[0] && tu < T.insert[1] ? 'notes' : 'room'; if (sc !== G.scene) { G.scene = sc; G.dirty = true; }
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
  /** A queued caption may start: no beat condition, its beat is over, or q reached tMin in its beat. */
  const capReady = x => x.beat === null || x.beat !== G.beat.id || (G.frozenQ === null && G.q >= x.tMin);
  function stepCaptions() {
    const C = G.cap;
    if (C.now && G.clock >= (C.now.cut ?? C.now.out) + .3) { C.last = (C.now.cut ?? C.now.out) + .3; C.now = null; G.dirty = true; }
    while (!C.now && C.queue.length && G.clock >= C.last + .2 && capReady(C.queue[0])) {
      const { id } = C.queue.shift(), k = capObj(id); if (!k) continue;   // an unknown id is skipped
      C.now = { id, t0: G.clock, out: G.clock + k.out, cut: null }; G.dirty = true;
    }
  }
  /** A caption interrupted by the plug fades at once (its text is already in the status region). */
  function interruptCaption() { const n = G.cap.now; if (n && n.cut === null) n.cut = Math.min(n.out, G.clock); }
  function drawCaption(c) {
    const n = G.cap.now; if (!n) return; const k = capObj(n.id); if (!k) return;
    const tau = G.clock - n.t0, a = n.cut !== null ? clamp(1 - (G.clock - n.cut) / .3, 0, 1) : 1; if (a <= 0) return;
    c.save(); c.globalAlpha *= a; k.draw(c, tau); c.restore();
  }
  /** The current caption as one line of text for the status region ('' when none). */
  const captionText = () => { const n = G.cap.now, sp = n && CONTENT.drawn.captions[n.id]; return sp ? sp.lines.map(l => STORY.fill(l, { name: G.name })).join(' ') : ''; };

  // ---------- sound obligations (see the header) ----------
  function sound() {
    const n = G.cap.now, k = n && n.cut === null && capObj(n.id), still = G.settings.paused || hidden;
    const ink = G.ink.some(i => G.clock - i.t0 < STORY.INK_DUR[i.part]), cap = !!k && G.clock - n.t0 < k.written;
    const gate = !still && (ink || cap) ? .35 : 0;
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
    if (G.frozenQ === null) G.q = qOf(G.beat.t0);
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
  function frame(now) {
    const dt = lastNow === null ? 0 : (now - lastNow) / 1000; lastNow = now;
    update(dt);
    lastPointer = UI.pointer();   // read at draw time; no redraw of its own (at most one drawing per 1/24 s)
    const key = G.scene + '|' + Math.floor(G.clock * 24 + 1e-9);
    if (key !== drawnKey || G.dirty) { drawnKey = key; sync(draw()); }
  }
  // the loop survives an exception in a renderer (reported once per message, not 60 times a second)
  const reported = new Set();
  function loop(now) {
    requestAnimationFrame(loop);
    try { frame(now); } catch (e) { const m = String(e && e.stack || e); if (!reported.has(m)) { reported.add(m); console.error(e); } }
  }

  // ---------- player actions (the one entry point; UI and window.__game call it) ----------
  function restart(who) { G = STORY.newGame(who, G.settings); NAME.install(G); const next = STORY.onAct(G, 'start'); if (next) enter(next); }
  /** Jump to the start of stage k (STORY.canon): the rail, "Try to break it", window.__game.seek. */
  function jump(k) {
    if (!Number.isInteger(k) || k < 0 || k > 9) return false;
    G = STORY.canon(k, G); enter(G.beat.id, G.clock); return true;
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
    else if (name === 'rename') { NAME.store.forget(); G = STORY.newGame({}, s); }   // ui.js clears the form and focuses it on the scene change
    else if (name === 'break' || name.startsWith('rail:')) {
      if (!G.name) return;                                                    // no default name: the start card first
      if (!jump(name === 'break' ? 3 : Number(name.slice(5)))) return;
      if (name === 'break') G.hint = 'tryBreakHint';
    } else { const next = STORY.onAct(G, name); if (next) enter(next); }
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

  // ---------- test API (?test=1): no rAF; time moves only through advance() ----------
  window.__game = {
    ready: false,
    /** @returns {object} a deep copy of G */
    state: () => JSON.parse(JSON.stringify(G)),
    /** @returns {object|null} a deep copy of the last view model given to UI.sync (action, plug, panel, hotspots, caption, crashes) */
    view: () => (lastView ? JSON.parse(JSON.stringify(lastView)) : null),
    /** Advance game time by sec in 1/24 s steps, then draw once. @param {number} sec */
    advance(sec) { const n = Math.max(0, Math.round((+sec || 0) * 24)); for (let i = 0; i < n; i++) update(1 / 24); sync(draw()); },
    /**
     * A player action by name (the act list in the header). act('start', name) first writes `name`
     * into the name form, as if typed. @param {string} name @param {string=} arg
     */
    act(name, arg) { if (String(name) === 'start' && arg !== undefined) UI.setName(String(arg)); act(String(name)); update(0); sync(draw()); },
    /** Jump to the start of stage k (STORY.canon), with or without a name. @param {number} k 0..9 */
    seek(k) { jump(Number(k)); G.dirty = true; update(0); sync(draw()); },
  };

  function start() {
    cv = document.getElementById('cv');
    ctx = cv.getContext('2d', BOOT.raster === 'cpu' ? { alpha: false, willReadFrequently: true } : { alpha: false });
    SHOP.init(); G = STORY.newGame(); hidden = !!document.hidden;
    size(); UI.init({ act });
    addEventListener('resize', onResize);
    if (!BOOT.test && typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(cv);
    document.addEventListener('visibilitychange', () => { hidden = document.hidden; lastNow = null; SFX_LIVE.visibility(hidden); });
    if (typeof matchMedia === 'function') { const mq = matchMedia('(prefers-reduced-motion: reduce)'); mq.addEventListener?.('change', () => { G.settings.reduced = mq.matches; G.dirty = true; }); }
    sync(draw());
    window.__game.ready = true;
    if (!BOOT.test) requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
