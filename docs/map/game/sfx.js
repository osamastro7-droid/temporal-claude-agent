'use strict';
// ============================================================
// game/sfx.js: the film's sound effects played live (GAME_SPEC §8; research: sound.md §6).
// STUB with contracts (foundation): enable/disable manage a real AudioContext and the master chain;
// play/crash/power/hum/scratch are silent no-ops. The sound builder copies from score2.js
// :64-166 (constants, kernels, cached, toBuffer), :170-223 (pianoData etc., only what the cues use),
// :225-566 (the SFX recipes that are used), :979-998 (scratch builder -> scratchBuf) and
// :1014-1023 (reverbIR), citing each block (// from score2.js:NN-MM).
//
// Graph (GAME_SPEC §8): world gain -> master; the spark on an unducked path -> master; a convolver
// (reverbIR) with a .5 return; master -> DynamicsCompressor(-3, 1, 20, .001, .12) -> trim dB(-1.71)
// -> destination. Loudest moments about -3 dBFS, no clipping.
// NO AudioContext exists before the player presses Sound (enable() is called inside that gesture).
// Called by runtime.js (beat sfx cues, film cues, ink and caption scratch, hum, the crash controller,
// visibility; see runtime.js "Sound obligations") and, through runtime's act('sound'), the Sound button.
// ============================================================
window.SFX_LIVE = (() => {
  let ac = null, master = null, world = null, on = false;
  const dB = x => Math.pow(10, x / 20);

  /**
   * Turn sound on. MUST run inside a user gesture (click/keydown): creates or resumes the
   * AudioContext, builds the graph once, starts the hum oscillators at gain 0, then fills effect
   * buffers in idle callbacks. On iOS sets navigator.audioSession.type = 'playback' if it exists.
   * @returns {Promise<void>} resolves when the context is running
   */
  async function enable() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = new AC();
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -3; comp.knee.value = 1; comp.ratio.value = 20; comp.attack.value = .001; comp.release.value = .12;
      const trim = ac.createGain(); trim.gain.value = dB(-1.71);
      master = ac.createGain(); world = ac.createGain(); world.connect(master); master.connect(comp); comp.connect(trim); trim.connect(ac.destination);
    }
    on = true; if (ac.state !== 'running') await ac.resume();
  }
  /** Turn sound off: fade the master, then suspend the context. @returns {Promise<void>} */
  async function disable() { on = false; if (ac && ac.state === 'running') await ac.suspend(); }
  /** Tab hidden/shown (runtime.js on visibilitychange): suspend / resume if sound is on. */
  function visibility(hidden) { if (!ac) return; if (hidden) ac.suspend(); else if (on) ac.resume(); }
  /**
   * THE TYPE TABLE: every name play() takes -> the score2.js recipe it plays (sound.md §3; score2.js
   * line refs). opts in parentheses. This is the one list builders code against; the sound builder
   * fills the recipes, never the names. GAME_SPEC §8 "Event -> sound" rows in [brackets].
   */
  const TYPES = {
    click: 'SFX.click(sr, k) :377, 4 variants (k = i % 4)            [Buy / Pay / Refund / Submit]',
    swipe: 'SFX.swipe(sr, k) :517, k = i % 3                          [page change]',
    screen: 'SFX.screen :507                                          [laptop wakes]',
    key: "keyStroke(sr, s, 'laptop') :214, one key (k)                [name and reason typing: one per letter]",
    keys: "SFX.keys(sr, dur, seed, kind) :389 (dur, kind 'laptop'|'agent')   [agent typing; film 'type' cues]",
    tick: 'SFX.tick(sr, k) :319, k = i % 3                            [a tick]',
    done: 'SFX.tick + piano A5 81 at +.06, C6 84 at +.22 (:876)       [order done]',
    box: 'SFX.box :420                                                [parcel]',
    sour: 'SFX.crack :432 + piano C5 72, Db5 73 at +.03/+.05, Bb4 70 at +.75, A4 69 at +1.2 (:906-910)   [crack]',
    whoosh: 'SFX.whoosh(sr, dir) :310 (dir)                           [slip flight]',
    dive: 'SFX.dive :526                                              [push into the server]',
    slip: 'SFX.slip(sr, k) :559                                       [he reads]',
    paper: 'SFX.paper(sr, k) :300, k = i % 3                          [a slip lands; film paper cues outside a1/a2]',
    drawer: 'SFX.drawer(sr, open) :445 (open: bool)                   [drawer open / shut]',
    nod: 'SFX.nod :458                                                [nod]',
    print: 'SFX.print(sr, dur) :404 (dur, .58 in stage 7)             [printer]',
    chime: 'SFX.chime(sr, note) :261 (note 0|1)                       [a check is written]',
    readTick: 'SFX.tick(sr, 10 + i % 4, -24.4, hz(96), -.25), send .1 [notes close-up: read ticks]',
    stamp: 'SFX.stamp :289                                            [stamp]',
    lock: 'SFX.lock :277                                              [waiting, once]',
    ding: 'SFX.ding :255                                              [once]',
    pencil: 'scratchBuf (:962-1001) for dur s at gate (dur .9, gate 1) [a film pencil cue]',
  };
  /**
   * Play one effect now (GAME_SPEC §8 "Event -> sound" table). No-op while sound is off.
   * @param {string} type  a TYPES key (unknown names are ignored)
   * @param {object=} opts  e.g. {open: true} (drawer), {dur: .58} (print, keys, pencil), {note: 0|1} (chime),
   *   {kind: 'laptop'|'agent'} (keys), {k: variant}, {dir: -1|1} (whoosh), {gate} (pencil)
   */
  function play(type, opts = {}) { if (!on || !ac || !TYPES[type]) return; }   // STUB
  /**
   * Replay one of a film act's own cues (SCENES[i].cues, {t, type, dur?}) as live sounds. runtime.js
   * calls it for film-window beats as the act's tau crosses cue.t. The film's cue names are not play()
   * types; this maps them (sound.md §3):
   *   boot -> screen; click -> click (k = nth % 4); paper -> swipe in a1/a2, else paper (k = nth % 3);
   *   pencil -> pencil {dur: .9, gate: 1}; tick -> done in a1/a2, else tick; type -> keys {dur, kind:
   *   'laptop' in a1/a2, else 'agent'}; read -> slip in a3/a5, else readTick; whoosh -> whoosh, except
   *   a3's second whoosh (the push) -> dive; drawer -> drawer {open: nth even}; crack -> sour;
   *   hum-on -> hum(true); box, nod, print -> the same name.
   * nth = how many cues of the same type come before this one in the act's list.
   * @param {{t: number, type: string, dur?: number}} cue @param {string} actKey 'a1'|'a2'|'a3'
   */
  function filmCue(cue, actKey) {
    if (!on || !ac || !cue) return;
    const act = (window.SCENES || []).find(x => x.key === actKey), list = act && act.cues ? act.cues : [];
    const nth = Math.max(0, list.filter(x => x.type === cue.type).indexOf(cue)), shop = actKey === 'a1' || actKey === 'a2';
    switch (cue.type) {
      case 'boot': return play('screen');
      case 'click': return play('click', { k: nth % 4 });
      case 'paper': return play(shop ? 'swipe' : 'paper', { k: nth % 3 });
      case 'pencil': return play('pencil', { dur: .9, gate: 1 });
      case 'tick': return play(shop ? 'done' : 'tick', { k: nth % 3 });
      case 'type': return play('keys', { dur: cue.dur, kind: shop ? 'laptop' : 'agent' });
      case 'read': return play(actKey === 'a3' || actKey === 'a5' ? 'slip' : 'readTick', { k: nth });
      case 'whoosh': return play(actKey === 'a3' && nth === 1 ? 'dive' : 'whoosh');
      case 'drawer': return play('drawer', { open: nth % 2 === 0 });
      case 'crack': return play('sour');
      case 'hum-on': return hum(true);
      default: return play(cue.type, cue.dur ? { dur: cue.dur } : {});
    }
  }
  /** The spark: world to 0 over 8 ms, the spark (unducked) at now + .008, hum off in .006 s; world held
   *  silent until spark + .22 + .5 s, then back over .3 s. runtime.js calls it AT the spark (ROOM.CRASH_T
   *  .spark after the plug click, on the game clock), not at the click: play at once, schedule no offset. */
  function crash() { if (!on || !ac) return; }   // STUB
  /** Power back: lampOn({flash: [[0, 1/12]], lit: 3/12}) + wake(.25, 5/12) + hum on, all now. runtime.js
   *  calls it when the push lands (ROOM.CRASH_T.power after the unplug click), not at the click. */
  function power() { if (!on || !ac) return; }   // STUB
  /** The room hum (live oscillators, score2.js:949-958), ramped on/off. @param {boolean} onOff */
  function hum(onOff) { if (!on || !ac) return; }   // STUB
  /** The pencil scratch while a pencil is on the paper: gate 1 drawing, .45 on ones, .35 captions.
   *  @param {boolean} onOff @param {number=} gate */
  function scratch(onOff, gate = 1) { if (!on || !ac) return; }   // STUB
  /** For tests: 'none' before enable() ever ran, else the AudioContext state. */
  const state = () => (ac ? ac.state : 'none');
  return { TYPES, enable, disable, visibility, play, filmCue, crash, power, hum, scratch, state, get enabled() { return on; } };
})();
