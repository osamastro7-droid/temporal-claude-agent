'use strict';
// Dev harness for sfx.html (see the comment there). Not published.
(() => {
  const SR = 48000, info = document.getElementById('info');
  const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  // stats of a rendered buffer over [a, b) seconds: sample peak, 4x-interpolated peak (linear is enough to
  // flag overs), RMS, and the end of the sound (last sample above -70 dBFS)
  function stats(buf, a = 0, b = buf.duration) {
    const i0 = Math.max(0, Math.floor(a * SR)), i1 = Math.min(buf.length, Math.ceil(b * SR)); let pk = 0, ss = 0, last = -1, n = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = i0; i < i1; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; ss += d[i] * d[i]; n++; if (v > 3.16e-4 && i > last) last = i; }
    }
    return { peakDb: +db(pk).toFixed(2), rmsDb: +db(Math.sqrt(ss / Math.max(1, n))).toFixed(1), len: last < 0 ? 0 : +((last - i0) / SR).toFixed(3) };
  }
  let used = false;
  function ctx(len) { const c = new OfflineAudioContext(2, Math.ceil(SR * len), SR); SFX_LIVE.__useContext(c); used = true; return c; }
  // steps [t, fn]: fn runs when the render reaches t (the compressor settles in its first ~.2 s, so events start at .5 s)
  async function render(len, steps) {
    const c = ctx(len);
    for (const [t, fn] of steps) c.suspend(t).then(() => { fn(); c.resume(); });
    return c.startRendering();
  }
  const EVENTS = [
    ['click', {}], ['swipe', {}], ['screen', {}], ['key', {}], ['key', { space: true }], ['keys', { dur: 2, kind: 'laptop' }], ['keys', { dur: 2, kind: 'agent' }],
    ['tick', {}], ['done', {}], ['box', {}], ['sour', {}], ['whoosh', {}], ['dive', {}], ['slip', {}], ['paper', {}], ['drawer', { open: true }], ['drawer', { open: false }],
    ['nod', {}], ['print', { dur: .58 }], ['chime', { note: 0 }], ['chime', { note: 1 }], ['readTick', {}], ['stamp', {}], ['lock', {}], ['ding', {}], ['pencil', { dur: .9, gate: 1 }], ['question', {}],
  ];
  async function renderOne(type, opts = {}, len = 5) {
    const t0 = .5, special = { crash: () => SFX_LIVE.crash(), power: () => SFX_LIVE.power(), hum: () => SFX_LIVE.hum(true), scratch: () => SFX_LIVE.scratch(true, opts.gate ?? .35),
      keyStroke: () => SFX_LIVE.keyStroke('a') };
    const buf = await render(len, [[t0, special[type] || (() => SFX_LIVE.play(type, opts))], ...(type === 'scratch' ? [[t0 + 3, () => SFX_LIVE.scratch(false)]] : [])]);
    return { type, opts, ...stats(buf, t0) };
  }
  async function perSound() {
    const out = [];
    for (const [t, o] of EVENTS) out.push(await renderOne(t, o, t === 'ding' || t === 'sour' || t === 'chime' ? 7 : 4));
    for (const t of ['crash', 'power', 'hum', 'scratch', 'keyStroke']) out.push(await renderOne(t, {}, 4.5));
    return out;
  }
  // the scripted sequence: every event type in a row, the hum and scratch on, a crash in the middle of busy
  // sound, the silence window measured, power back, then a film cue list (a3's) replayed through filmCue
  async function renderSeq() {
    let t = .1; const steps = [], at = (dt, fn) => { t += dt; steps.push([+t.toFixed(3), fn]); };
    at(0, () => SFX_LIVE.hum(true));
    for (const [ty, o] of EVENTS) at(.45, () => SFX_LIVE.play(ty, o));
    at(.3, () => SFX_LIVE.scratch(true, .35)); at(.1, () => SFX_LIVE.play('keys', { dur: 1.5, kind: 'agent' })); at(.4, () => SFX_LIVE.play('ding'));
    const tCrash = t + .3; at(.3, () => SFX_LIVE.crash());
    at(.2, () => SFX_LIVE.play('stamp'));                  // played inside the silence: must stay silent
    at(1.5, () => SFX_LIVE.power()); at(.6, () => SFX_LIVE.scratch(false));
    const tFilm = t + .3; const a3 = (window.SCENES || []).find(s => s.key === 'a3');
    const cues = [{ t: 0, type: 'hum-on' }, { t: .2, type: 'paper' }, { t: .5, type: 'whoosh' }, { t: 1.2, type: 'whoosh' }, { t: 2, type: 'read' }, { t: 2.5, type: 'drawer' }, { t: 3.2, type: 'nod' }, { t: 3.8, type: 'drawer' }, { t: 4.5, type: 'type', dur: 1.2 }, { t: 6, type: 'print', dur: .58 }, { t: 7, type: 'pencil' }];
    window.SCENES = [{ key: 'a3', cues }]; if (a3) void 0;
    for (const q of cues) steps.push([+(tFilm + q.t).toFixed(3), () => SFX_LIVE.filmCue(q, 'a3')]);
    const len = tFilm + 10, buf = await render(len, steps.sort((a, b) => a[0] - b[0]));
    const spark = tCrash + .008;
    return {
      len, crashAt: +tCrash.toFixed(3),
      whole: stats(buf),
      spark: stats(buf, spark, spark + .22),
      silence: stats(buf, spark + .22 + .01, spark + .22 + .5),     // must be digital silence (< -60 dBFS)
      back: stats(buf, spark + .72 + .3, spark + .72 + 1.3),
      film: stats(buf, tFilm, len),
    };
  }
  document.getElementById('on').addEventListener('click', () => { SFX_LIVE.enable(); });
  window.__dev = { ready: true, contexts: () => window.__acCount, renderOne, perSound, renderSeq, get usedOffline() { return used; } };
  info.textContent = 'sfx harness ready; contexts: ' + window.__acCount + ', state: ' + SFX_LIVE.state();
})();
