'use strict';
// ============================================================
// game/runtime.js: the state G, the game clock, the main loop, the crash controller, the caption
// scheduler and the test API window.__game (GAME_SPEC §2 "Main loop", §4 "The crash sequence").
// STUB with contracts (foundation): the clock, the generic beat engine (events, commits, holds,
// step mode, captions, sfx cues), the draw pipeline, resize, visibility and the test API work; the
// crash controller runs on ROOM.CRASH_T (room.js, the one crash timetable, a9-derived) and handles a
// crash during a recovery (see "the crash controller" below).
//
// Only this file changes G (directly, or by calling STORY functions and beat events with it).
// Frame: update(now) -> draw() only when floor(clock * 24) changed or G.dirty (the live pointer does
// not set dirty: the shop cursor moves on the next 1/24 s drawing, GAME_SPEC §7).
// draw(): ctx.save(); resetFrame(ctx); scene renderer; resetT; the caption; vignette; ctx.restore().
//   Renderers return true when they drew the vignette themselves. A film window (S.film) also draws the
//   game's caption, routed through the act's own (blanked) caption slot, so the order stays the film's:
//   caption, then vignette (SHOP.frame o.caption).
// Canvas: getContext('2d', {alpha: false}) (+ willReadFrequently only with ?raster=cpu); never
// getImageData here. Backing width clamp(round(cssW * dpr), 960, 1920), debounced 150 ms; 1920 in ?test=1.
//
// PLAYER ACTS (the one entry point act(name); ui.js and window.__game.act call it):
//   GAME_SPEC §2: start, buy, pay, refund, submit, approve, reject, plug, unplug, next, pause, sound,
//   rail:<k> (k 0..9). Also: step (toggle "Stop after each stage"), again (Play again: keeps the name),
//   rename (Change name: forgets the stored name, back to the start card), break (Try to break it:
//   stage 3 with the pull-the-plug hint). 'start' reads the name form (UI.nameValue); in tests
//   window.__game.act('start', 'Zoë') first writes that name into the form (UI.setName).
//   Approve/Reject while the power is off are queued (G.approval.queued) and applied once the
//   approval hold is reached again after the notes.
//
// SOUND OBLIGATIONS (runtime calls SFX_LIVE; every call is a no-op while sound is off):
//   - beat cues: STORY.sfxOf(beat, G) entries as q crosses t -> SFX_LIVE.play(type, opts).
//   - film windows: the act's own SCENES[i].cues as the window's tau crosses cue.t -> SFX_LIVE.filmCue.
//   - notebook ink: scratch(true, .35) while any G.ink mark is still being written (GAME_SPEC §8
//     "Notebook line | pencil scratch gate .35"); play('chime', {note}) when a CHECK commit starts.
//   - captions: scratch(true, .35) while a caption is being written; scratch(false) when nothing writes.
//   - the hum: hum(true) on entering a room scene ('room', 'notes') and after Sound is turned on there
//     while the power is on; hum(false) on leaving for 'shop', 'mail', 'start', 'end'. The crash owns
//     it in between (crash() cuts it, power() brings it back).
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
  /** Captions the crash controller queues itself (superseded by a new crash). */
  const CRASH_CAPS = ['crash', 'crashAgain', 'notes'];
  const ROOMS = ['room', 'notes'], ROOMISH = ['room', 'notes', 'wide'];
  let G = null, cv = null, ctx = null, lastNow = null, drawnKey = null, hidden = false, lastPointer = null;
  let snd = { gate: null, scene: null }, filmAt = null;   // sound bookkeeping (not game state)
  const caps = new Map();   // capId|drawnName -> makeCaption object (compiled once)

  // ---------- beats ----------
  const beatOf = () => STORY.beat(G.beat.id);
  /** Queue a beat's captions: [capId] or [capId, tMin] -> {id, tMin, beat} (story.js SCHEMAS "cap"). */
  const queueCaps = (b, id) => { for (const k of b.captions ?? []) G.cap.queue.push(Array.isArray(k) ? { id: k[0], tMin: k[1] ?? 0, beat: id } : { id: k, tMin: 0, beat: id }); };
  /** Enter beat `id` at game time t0 (default now). Unknown ids are ignored (stubs). */
  function enter(id, t0 = G.clock) {
    const b = STORY.beat(id); if (!b) return false;
    G.beat = { id, t0, fired: 0, committed: 0, cued: 0 }; G.scene = b.scene; G.stage = b.stage; G.q = 0; G.hold = null; G.dirty = true;
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
        if (c.part === 'c') SFX_LIVE.play('chime', { note: G.book.filter(r => r.c).length % 2 });   // DRAFT note choice: the sound builder confirms
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
  function warmNext(b) {
    if (typeof requestIdleCallback !== 'function' || BOOT.test) return;
    requestIdleCallback(() => { try { const n = STORY.beat(b.next(G)); if (n && n.scene === 'room') ROOM.warm([n.R(G, 0)]); } catch (e) { /* warming is optional */ } });
  }
  /** A decision made while the power was off is applied once the approval hold is reached again. */
  function applyQueued() {
    const d = G.approval.queued, b = beatOf();
    if (!d || G.worker.phase !== 'on' || !b || !b.hold || b.hold.action !== 'approve' || !G.hold) return;
    const next = STORY.onAct(G, d); if (next) enter(next);
  }

  // ---------- the crash controller (GAME_SPEC §4 "The crash sequence") ----------
  // Timing: ROOM.CRASH_T only. G.worker while crashed (story.js SCHEMAS "worker"):
  //   {phase, t0 (clock at the phase start), c0 (clock at the plug click), u0 (clock at the unplug
  //    click, null before), when, saved, rec, caps, prev, sparked, powered}
  // phases: pulling -(tc >= out)-> dark -(unplug)-> pushing -(tu >= power)-> waking -(tu >= look)->
  //   notes (scene 'notes' while tu in CRASH_T.insert) -(tu >= done)-> recover -> on
  // A CRASH DURING A RECOVERY ('waking', or 'notes' outside the close-up; STORY.plugState): the story
  // is still frozen, so G.frozenQ and G.beat stay; when and saved are recomputed from G; the held
  // captions are MERGED (old worker.caps + anything of the frozen beat still queued); rec = null (the
  // next unplug decides again); prev = {phase, t, tu, rec} of the interrupted recovery, for ROOM.crash
  // (K.prev: slump from the wake inbetween, props kept as they had snapped to prev.rec).
  const clockOf = w => ({ tc: G.clock - w.c0, tu: w.u0 === null || w.u0 === undefined ? null : G.clock - w.u0 });
  function plug() {
    const w0 = G.worker, again = w0.phase === 'waking' || w0.phase === 'notes';
    if (!(w0.phase === 'on' || again) || !STORY.plugState(G).ok) return;
    if (!again) G.frozenQ = G.q;
    const when = STORY.crashWhen(G);
    G.crashes.push({ stage: G.stage, when }); G.hint = null;
    // the frozen beat's queued captions are held back; they come back only if that beat is resumed.
    // Queued crash-controller captions (a 'notes' not yet shown) are superseded by this crash.
    const id = G.beat.id, held = [...(again ? w0.caps ?? [] : []), ...G.cap.queue.filter(x => x.beat === id)];
    G.cap.queue = G.cap.queue.filter(x => x.beat !== id && !(x.beat === null && CRASH_CAPS.includes(x.id)));
    const prev = again ? { phase: w0.phase, t: G.clock - w0.t0, tu: clockOf(w0).tu, rec: w0.rec } : null;
    G.worker = { phase: 'pulling', t0: G.clock, c0: G.clock, u0: null, when, saved: STORY.saved(G), rec: null, caps: held, prev, sparked: false, powered: false };
    if (again) G.scene = 'room';
    interruptCaption();
    G.cap.queue.unshift({ id: G.crashes.length > 1 ? 'crashAgain' : 'crash', tMin: 0, beat: null }); G.dirty = true;
  }
  function unplug() {
    if (G.worker.phase !== 'dark') return;
    // the recovery beat is decided ONCE, here, from G.book and G.world (STORY.recoverFor): from the
    // power on (tu >= CRASH_T.power), the worker's props are drawn from that beat's R (ROOM.crash K.rec)
    const id = STORY.recoverFor(G);
    G.worker = { ...G.worker, phase: 'pushing', t0: G.clock, u0: G.clock, rec: { id, q: id === G.beat.id ? G.frozenQ : 0 } }; G.dirty = true;
  }
  function stepCrash() {
    const w = G.worker, T = ROOM.CRASH_T, { tc, tu } = clockOf(w), go = p => { G.worker = { ...G.worker, phase: p, t0: G.clock }; G.dirty = true; };
    if (!w.sparked && tc >= T.spark) { w.sparked = true; SFX_LIVE.crash(); }
    if (w.phase === 'pulling' && tc >= T.out) go('dark');
    else if (w.phase === 'pushing' && tu >= T.power) { go('waking'); G.worker.powered = true; SFX_LIVE.power(); }
    else if (w.phase === 'waking' && tu >= T.look) { go('notes'); G.cap.queue.push({ id: 'notes', tMin: 0, beat: null }); }
    else if (w.phase === 'notes') {
      const sc = tu >= T.insert[0] && tu < T.insert[1] ? 'notes' : 'room'; if (sc !== G.scene) { G.scene = sc; G.dirty = true; }
      if (tu >= T.done) go('recover');
    } else if (w.phase === 'recover') {
      // the outcome belongs to every crash this recovery answers (a double crash: both records)
      const oc = STORY.outcome(G); for (const c of G.crashes) if (!c.outcome) c.outcome = oc;
      G.cap.queue.push({ id: oc, tMin: 0, beat: null });
      const rec = w.rec ?? { id: STORY.recoverFor(G), q: 0 }, fq = G.frozenQ, frozen = G.beat.id;
      G.frozenQ = null; G.worker = { phase: 'on', t0: G.clock };
      if (rec.id === frozen) { G.beat.t0 = G.clock - fq; G.scene = STORY.beat(frozen)?.scene ?? G.scene; G.cap.queue.push(...(w.caps ?? [])); }   // same beat: resume where it froze
      else enter(rec.id);
    }
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
    if (!C.now && C.queue.length && G.clock >= C.last + .2 && capReady(C.queue[0])) {
      const { id } = C.queue.shift(), k = capObj(id); if (!k) return;
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
  const captionText = () => { const n = G.cap.now; const k = n && capObj(n.id); return k ? k.text.replace(' / ', ' ') : ''; };

  // ---------- sound obligations (see the header) ----------
  function sound() {
    const n = G.cap.now, k = n && n.cut === null && capObj(n.id);
    const ink = G.ink.some(i => G.clock - i.t0 < STORY.INK_DUR[i.part]), cap = !!k && G.clock - n.t0 < k.written;
    const gate = ink || cap ? .35 : 0;
    if (gate !== snd.gate) { snd.gate = gate; SFX_LIVE.scratch(gate > 0, gate || undefined); }
    const room = ROOMS.includes(G.scene), was = snd.scene;
    if (room && !ROOMS.includes(was) && powered()) SFX_LIVE.hum(true);
    if (!ROOMISH.includes(G.scene) && ROOMISH.includes(was)) SFX_LIVE.hum(false);
    snd.scene = G.scene;
  }
  /** Replay a film window's own cues as its tau crosses them (draw() calls it with the window drawn). */
  function filmCues(F) {
    if (!F) { filmAt = null; return; }
    const from = filmAt && filmAt.act === F.act && F.tau >= filmAt.tau ? filmAt.tau : (F.tau < .1 ? -1e-9 : F.tau);
    filmAt = { act: F.act, tau: F.tau };
    const a = SHOP.act(F.act); if (!a || !a.cues) return;
    for (const cue of a.cues) if (cue.t > from && cue.t <= F.tau) SFX_LIVE.filmCue(cue, F.act);
  }

  // ---------- update and draw ----------
  function update(dt) {
    if (!G.settings.paused && !hidden) G.clock += Math.min(dt, DT_MAX);
    if (G.frozenQ === null) G.q = Math.floor((G.clock - G.beat.t0) * 24 + 1e-9) / 24;
    stepBeats(); if (G.worker.phase !== 'on') stepCrash(); applyQueued(); stepCaptions(); sound();
  }
  /** The renderer's input for the current moment (story.js SCHEMAS R / S / C). */
  function view() {
    const b = beatOf(); if (!b) return {};
    const step = G.hold && G.hold.step, q = G.frozenQ ?? (step ? Math.min(G.q, STORY.durOf(b, G)) : G.q);
    let V = G.hold && b.hold ? b.hold.idle(G, G.clock - G.hold.t0) : b.R(G, q);
    const w = G.worker;
    if (ROOMS.includes(G.scene) && w.phase !== 'on') {
      const recR = r => { const rb = r && STORY.beat(r.id); return rb ? rb.R(G, r.q) : null; }, { tc, tu } = clockOf(w);
      V = ROOM.crash(V, { phase: w.phase, t: G.clock - w.t0, tc, tu, reduced: G.settings.reduced, when: w.when, saved: w.saved,
        rec: w.phase !== 'pulling' && w.phase !== 'dark' ? recR(w.rec) : null,
        prev: w.prev ? { phase: w.prev.phase, t: w.prev.t, tu: w.prev.tu, rec: recR(w.prev.rec) } : null,
        notes: G.scene === 'notes' ? STORY.notes(G, tu - ROOM.CRASH_T.insert[0]) : null });
    }
    return V;
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
    filmCues(G.scene === 'shop' || G.scene === 'wide' ? V.film : null);
    G.dirty = false;
    return V;
  }
  function sync(V) {
    const a = STORY.action(G), p = STORY.plugState(G), dark = G.worker.phase === 'dark';
    let hot = [];
    if (G.scene === 'room') hot = ROOM.hotspots(V, { plug: p.ok ? (dark ? 'unplug' : 'plug') : false, approve: a.act === 'approve' && a.enabled }).map(h => ({ act: h.act, box: ROOM.boxToScreen(h.world) }));
    else if (G.scene === 'shop' && a.act) hot = SHOP.hotspots(V, { [a.act]: true }).map(h => ({ act: h.act, box: h.world }));
    UI.sync(G, { action: a, plug: p, panel: STORY.panel(G), hotspots: hot, caption: captionText(),
      crashes: G.crashes.map(c => ({ stage: c.stage, mark: STORY.railMark(c) })) });
  }
  function frame(now) {
    const dt = lastNow === null ? 0 : (now - lastNow) / 1000; lastNow = now;
    update(dt);
    lastPointer = UI.pointer();   // read at draw time; no redraw of its own (at most one drawing per 1/24 s)
    const key = G.scene + '|' + Math.floor(G.clock * 24 + 1e-9);
    if (key !== drawnKey || G.dirty) { drawnKey = key; sync(draw()); }
  }
  function loop(now) { frame(now); requestAnimationFrame(loop); }

  // ---------- player actions (the one entry point; UI and window.__game call it) ----------
  function restart(who) { G = STORY.newGame(who, G.settings); NAME.install(G); const next = STORY.onAct(G, 'start'); if (next) enter(next); }
  function act(name) {
    const s = G.settings;
    if (name === 'pause') s.paused = !s.paused;
    else if (name === 'sound') {
      s.sound = !s.sound; snd.gate = null;
      if (s.sound) { SFX_LIVE.enable(); if (ROOMS.includes(G.scene) && powered()) SFX_LIVE.hum(true); } else SFX_LIVE.disable();
    } else if (name === 'step') {
      s.stepMode = !s.stepMode;
      if (!s.stepMode && G.hold && G.hold.step) { const next = STORY.onAct(G, 'next'); if (next) enter(next); }
    } else if (name === 'plug') plug();
    else if (name === 'unplug') unplug();
    else if (name === 'start') {
      const v = UI.nameValue(), who = NAME.prepare(v.name); if (!who.ok) return;
      if (v.remember) NAME.store.save(who.name); else NAME.store.forget();
      restart(who);
    } else if (name === 'again') restart(G);
    else if (name === 'rename') { NAME.store.forget(); G = STORY.newGame({}, s); }   // ui.js clears the form and focuses it on the scene change
    else if (name === 'break' || name.startsWith('rail:')) {
      const k = name === 'break' ? 3 : +name.slice(5); if (!Number.isInteger(k) || k < 0 || k > 9) return;
      G = STORY.canon(k, G); enter(G.beat.id, G.clock);
      if (name === 'break') G.hint = 'tryBreakHint';
    } else { const next = STORY.onAct(G, name); if (next) enter(next); }
    G.dirty = true;
  }

  // ---------- canvas size (GAME_SPEC §2 "Resize") ----------
  function size() {
    const w = BOOT.test ? 1920 : clamp(Math.round(cv.getBoundingClientRect().width * (window.devicePixelRatio || 1)), 960, 1920);
    if (cv.width !== Math.round(w) || OUT_W !== Math.round(w)) { setFormat({ ar: '16:9', width: w }); cv.width = OUT_W; cv.height = OUT_H; }
    G.dirty = true;
  }
  let resizeT = null;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(size, 150); };

  // ---------- test API (?test=1): no rAF; time moves only through advance() ----------
  window.__game = {
    ready: false,
    /** @returns {object} a deep copy of G */
    state: () => JSON.parse(JSON.stringify(G)),
    /** Advance game time by sec in 1/24 s steps, then draw once. @param {number} sec */
    advance(sec) { const n = Math.max(0, Math.round(sec * 24)); for (let i = 0; i < n; i++) update(1 / 24); sync(draw()); },
    /**
     * A player action by name (the act list in the header). act('start', name) first writes `name`
     * into the name form, as if typed. @param {string} name @param {string=} arg
     */
    act(name, arg) { if (String(name) === 'start' && arg !== undefined) UI.setName(String(arg)); act(String(name)); sync(draw()); },
    /** Jump to the start of stage k (STORY.canon). @param {number} k 0..9 */
    seek(k) { act('rail:' + k); sync(draw()); },
  };

  function start() {
    cv = document.getElementById('cv');
    ctx = cv.getContext('2d', BOOT.raster === 'cpu' ? { alpha: false, willReadFrequently: true } : { alpha: false });
    SHOP.init(); G = STORY.newGame();
    size(); UI.init({ act });
    addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', () => { hidden = document.hidden; lastNow = null; SFX_LIVE.visibility(hidden); });
    if (typeof matchMedia === 'function') { const mq = matchMedia('(prefers-reduced-motion: reduce)'); mq.addEventListener?.('change', () => { G.settings.reduced = mq.matches; G.dirty = true; }); }
    sync(draw());
    window.__game.ready = true;
    if (!BOOT.test) requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
