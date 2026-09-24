'use strict';
// ============================================================
// game/sfx.js: the film's sound effects played live (GAME_SPEC §8; research: sound.md §6).
// The kernels and recipes are copied from temporal-film/score2.js (cited per block, trimmed to the sounds
// the game uses); the live engine (graph, one-shot player, key strokes, crash, power, hum, scratch) is new.
// The helpers lerp/clamp/rng/hash/noise1 are core.js globals (engine/core.js, loaded first).
//
// Graph (GAME_SPEC §8): every sound -> world gain -> master; the spark on its own unducked path -> master;
// sends -> a convolver (reverbIR, normalize off) -> .5 return -> world; master -> DynamicsCompressor
// (-3, 1, 20, .001, .12) -> trim dB(-1.71) (cancels the compressor's makeup gain, score2.js:648-649) ->
// destination. Loudest moments (spark, ding) about -3 dBFS, no clipping.
// NO AudioContext exists before the player presses Sound: enable() creates it inside that gesture and
// only builds the graph there; every effect buffer is generated later, a few per idle callback, so the
// tap that turns sound on never stalls a frame (a sound asked for before its buffer is ready is built on
// the spot: the one-shots cost 1-15 ms, sound.md §3).
// Called by runtime.js (beat sfx cues, film cues, ink and caption scratch, hum, the crash controller,
// visibility; see runtime.js "Sound obligations") and, through runtime's act('sound'), the Sound button.
// ============================================================
window.SFX_LIVE = (() => {
  // ---------- constants and levels: from score2.js:64-94 ----------
  const PI2 = Math.PI * 2;
  const dB = x => Math.pow(10, x / 20);
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const LIFT = 6.6;
  const MIX = { bed: dB(-13 + LIFT), rev: .5, scratch: dB(-20 + LIFT), hum: dB(-48 + LIFT) };
  const PEAK = { spark: -3.1, ding: -3.3, ...Object.fromEntries(Object.entries({
    stamp: -11, lock: -15, paper: -22, whoosh: -21, tick: -24, read: -31, chime: -17,
    click: -23, key: -26, print: -22, box: -15, crack: -21, drawer: -19, nod: -24, wake: -19, lampOn: -20, question: -24, screen: -25,
    swipe: -26, slip: -24, dive: -21,
  }).map(([k, v]) => [k, v + LIFT])) };
  const SPARK_LEN = .22;   // score2.js:80: the spark's own length; the silence runs to its end + .5 s

  // ---------- JS synthesis kernels: from score2.js:96-162 (unchanged) ----------
  function partial(out, sr, f, amp, dFast, dSlow, mixFast, phase, from = 0) {
    if (!(f > 0) || f >= sr * .45 || amp <= 0) return;
    const w = PI2 * f / sr, cw = Math.cos(w), sw = Math.sin(w), k1 = Math.exp(-1 / (dFast * sr)), k2 = Math.exp(-1 / (dSlow * sr)), floor = amp * 1e-5;
    let re = Math.cos(phase), im = Math.sin(phase), e1 = amp * mixFast, e2 = amp * (1 - mixFast);
    for (let i = from; i < out.length; i++) {
      out[i] += im * (e1 + e2);
      const nr = re * cw - im * sw; im = re * sw + im * cw; re = nr; e1 *= k1; e2 *= k2;
      if ((i & 2047) === 0) { if (e1 + e2 < floor) break; const n = 1 / Math.sqrt(re * re + im * im); re *= n; im *= n; }
    }
  }
  function biquad(x, type, f, q, sr, gainDb = 0) {
    const w = PI2 * Math.min(f, sr * .45) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y; }
    return x;
  }
  function sweepBP(x, fc, q, sr) {
    let ic1 = 0, ic2 = 0; const k = 1 / q;
    for (let i = 0; i < x.length; i++) {
      const g = Math.tan(Math.PI * Math.min(fc(i / sr), sr * .45) / sr), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      const v3 = x[i] - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3; ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; x[i] = k * v1;
    }
    return x;
  }
  function noise(n, seed) { const r = rng(seed), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; return x; }
  function panInto(L, R, x, pan, gain = 1, off = 0) {
    const a = (clamp(pan, -1, 1) + 1) * Math.PI / 4, gl = Math.cos(a) * gain, gr = Math.sin(a) * gain, n = Math.min(x.length, L.length - off);
    for (let i = Math.max(0, -off); i < n; i++) { L[off + i] += x[i] * gl; R[off + i] += x[i] * gr; }
  }
  const TP_K = [.25, .5, .75].map(f => Array.from({ length: 16 }, (_, j) => { const x = f - (j - 7); const w = .5 + .5 * Math.cos(Math.PI * x / 8.5); return (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w; }));
  function truePeak(c) {
    let p = 0;
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]); if (a > p) p = a;
      if (i >= 7 && i + 8 < c.length && a > p * .5) for (const k of TP_K) { let y = 0; for (let j = 0; j < 16; j++) y += c[i - 7 + j] * k[j]; if (Math.abs(y) > p) p = Math.abs(y); }
    }
    return p;
  }
  function normPeak(chs, peakDb) { let p = 0; for (const c of chs) p = Math.max(p, truePeak(c)); const g = p > 0 ? dB(peakDb) / p : 0; for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= g; }
  function fadeEdges(chs, sr, atk = .001, rel = .02) {
    const n = chs[0].length, a = Math.max(1, Math.round(atk * sr)), r = Math.max(1, Math.round(rel * sr));
    for (const c of chs) { for (let i = 0; i < a && i < n; i++) c[i] *= .5 - .5 * Math.cos(Math.PI * i / a); for (let i = 0; i < r && i < n; i++) c[n - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / r); }
  }
  function normTo(x, v) { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); if (p > 0) for (let i = 0; i < x.length; i++) x[i] *= v / p; return x; }
  function addAt(out, y, off, amp = 1) { for (let i = Math.max(0, -off); i < y.length && off + i < out.length; i++) out[off + i] += y[i] * amp; return out; }
  function decay(x, sr, tau) { for (let i = 0; i < x.length; i++) x[i] *= Math.exp(-i / (sr * tau)); return x; }
  function stereo(sr, x, pan, peak) { fadeEdges([x], sr, .0003, .02); const L = new Float32Array(x.length), R = new Float32Array(x.length); panInto(L, R, x, pan); normPeak([L, R], peak); return [L, R]; }
  function glide(sr, len, f, e, harm = [[1, 1]]) {
    const n = Math.round(sr * len), y = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; ph += PI2 * f(t) / sr; let v = 0; for (const [r, a] of harm) v += a * Math.sin(ph * r); y[i] = v * e(t); }
    return y;
  }

  // ---------- buffer cache: from score2.js:165-166 (the cache holds AudioBuffers, keyed by sample rate) ----------
  // The fixed recipes (clicks, keys, chimes, piano notes, the IR...) are a small closed set and stay for good.
  // Recipes keyed by a duration or gate (typing, print, pencil, loop) are capped: the least recently used one is
  // dropped past VAR_MAX (48 is well above the warm set's own; a dropped one is rebuilt on its next use).
  const CACHE = new Map(), VAR = new Set(), VAR_MAX = 48;
  const isVar = key => /^(type\||print|pencil\||loop\|)/.test(key);
  function toBuffer(ac, chs) { const b = ac.createBuffer(chs.length, chs[0].length, ac.sampleRate); chs.forEach((c, i) => b.getChannelData(i).set(c)); return b; }
  function cached(ac, key, make) {
    const k = ac.sampleRate + '|' + key;
    if (CACHE.has(k)) { if (VAR.delete(k)) VAR.add(k); return CACHE.get(k); }   // a hit moves a variable key to the end
    CACHE.set(k, toBuffer(ac, make()));
    if (isVar(key)) { VAR.add(k); if (VAR.size > VAR_MAX) { const old = VAR.values().next().value; VAR.delete(old); CACHE.delete(old); } }
    return CACHE.get(k);
  }
  const has = (ac, key) => CACHE.has(ac.sampleRate + '|' + key);

  // ---------- instruments: from score2.js:170-188 (pianoData), :204-212 (bellData), :214-222 (keyStroke) ----------
  function pianoData(sr, m, bright) {
    const f0 = hz(m), T = clamp(6.4 - (m - 36) * .085, 1.4, 6.4), n = Math.round(sr * clamp(T * .9 + 1, 2.2, 6.4));
    const out = new Float32Array(n), B = 1.1e-4 * Math.pow(2, (m - 60) / 20), K = Math.max(3, Math.min(16, Math.floor(7200 / f0)));
    for (let k = 1; k <= K; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k), strike = .22 + .78 * Math.abs(Math.sin(Math.PI * k / 7.3));
      const a = strike * Math.pow(k, -(1.1 + (1 - bright) * .7)), dSlow = T / (1 + .42 * (k - 1)), dFast = Math.min(.45, dSlow * .15), cents = .5 + 1.3 * hash(k, m);
      partial(out, sr, fk * (1 + cents / 3462), a * .58, dFast, dSlow, .5, hash(k, m + 101) * PI2);
      partial(out, sr, fk * (1 - cents / 3462), a * .42, dFast, dSlow * 1.12, .5, hash(k, m + 202) * PI2);
    }
    const hl = Math.round(sr * .02), hn = noise(hl, m * 7 + 3);
    for (let i = 0; i < hl; i++) hn[i] *= Math.exp(-i / (sr * .003));
    biquad(hn, 'lp', Math.min(3500, f0 * 5), .7, sr);
    for (let i = 0; i < hl; i++) out[i] += hn[i] * .12;
    const tail = Math.round(n * .3); for (let i = 0; i < tail; i++) out[n - 1 - i] *= Math.sin(Math.PI / 2 * i / tail);
    fadeEdges([out], sr, .003, .001);
    normPeak([out], 0);
    const comp = clamp(1 + (60 - m) * .009, .78, 1.22); for (let i = 0; i < n; i++) out[i] *= comp;
    return out;
  }
  function bellData(sr, f0, parts, len, strike, seed) {
    const n = Math.round(sr * len), L = new Float32Array(n), R = new Float32Array(n);
    parts.forEach(([r, a, d, mf = .28, df = d * .22], k) => { const x = new Float32Array(n); partial(x, sr, f0 * r, a, df, d, mf, hash(k, seed) * PI2); panInto(L, R, x, k % 2 ? .14 : -.1); });
    const s = noise(Math.round(sr * .006), seed); for (let i = 0; i < s.length; i++) s[i] *= Math.exp(-i / (sr * .0012)); biquad(s, 'hp', 3500, .7, sr);
    panInto(L, R, s, 0, strike);
    fadeEdges([L, R], sr, .0015, .15);
    return [L, R];
  }
  function keyStroke(sr, s, kind, space) {
    const n = Math.round(sr * .07), y = new Float32Array(n), heavy = kind === 'agent';
    const c = decay(noise(Math.round(sr * .0015), 700 + s), sr, .00035); biquad(c, 'hp', 3200, .7, sr); normTo(c, heavy ? .55 : .75);
    const b = decay(noise(Math.round(sr * .035), 1700 + s), sr, heavy ? .0065 : .0042);
    biquad(b, 'bp', (heavy ? 820 : kind === 'screen' ? 2500 : 1500) * (1 + .25 * (hash(s, 3) - .5)) * (space ? .62 : 1), 2.2, sr); normTo(b, 1);
    const th = new Float32Array(Math.round(sr * .05)); partial(th, sr, (space ? 150 : heavy ? 195 : 270) * (1 + .2 * hash(s, 4)), 1, .002, .011, .5, 0); normTo(th, heavy ? .6 : .32);
    const up = decay(noise(Math.round(sr * .0012), 2700 + s), sr, .0003); biquad(up, 'hp', 2500, .7, sr); normTo(up, .22);
    addAt(y, c, 0); addAt(y, b, 0); addAt(y, th, Math.round(sr * .0015)); addAt(y, up, Math.round(sr * (.028 + .014 * hash(s, 5))));
    fadeEdges([y], sr, .0002, .01); return y;
  }

  // ---------- the effect recipes the game uses: from score2.js:225-566 (unchanged bodies) ----------
  const SFX = {
    // from score2.js:229-251
    spark(sr) {
      const n = Math.round(sr * SPARK_LEN), L = new Float32Array(n), R = new Float32Array(n), r = rng(515);
      const th = new Float32Array(n); let ph = 0;
      for (let i = 0; i < n; i++) { const t = i / sr; ph += PI2 * (42 + 78 * Math.exp(-t / .022)) / sr; th[i] = Math.sin(ph) * (1 - Math.exp(-t / .0012)) * Math.exp(-t / .05); }
      panInto(L, R, th, .2, .45);
      const fl = rng(516), arc = t => t < .085 ? 1 : Math.exp(-(t - .085) / .035);
      for (const [sd, pan] of [[11, .1], [12, .75]]) {
        const b = noise(n, sd); let fv = 1, fc = 0;
        for (let i = 0; i < n; i++) { const t = i / sr; if (--fc <= 0) { fv = .55 + .45 * fl(); fc = Math.round(sr * (.004 + .008 * fl())); } b[i] *= (1 - Math.exp(-t / .0005)) * (.35 * Math.exp(-t / .012) + .65 * arc(t) * fv); }
        biquad(b, 'hp', 1600, .7, sr); biquad(b, 'pk', 4200, 1, sr, 5); panInto(L, R, b, pan, .8);
      }
      for (let k = 0; k < 50; k++) {
        const t = .004 + .17 * Math.pow(r(), 1.3), gl = Math.round(sr * (.0006 + r() * .0022)), g = noise(gl, 40 + k);
        for (let i = 0; i < gl; i++) g[i] *= Math.exp(-i / (gl * .35));
        biquad(g, 'bp', 2500 + r() * 4500, 1.2, sr); panInto(L, R, g, .15 + (r() - .5) * .9, (.4 + .6 * r()) * 1.6 * Math.exp(-t / .12), Math.round(t * sr));
      }
      const z = new Float32Array(Math.round(sr * .12)); for (let i = 0; i < z.length; i++) { const t = i / sr; z[i] = Math.sign(Math.sin(PI2 * 100 * t)) * Math.exp(-t / .05); }
      biquad(z, 'bp', 1400, .9, sr); panInto(L, R, z, .4, .6);
      const fo = Math.round(sr * .05); for (let i = 0; i < fo; i++) { const g = Math.sin(Math.PI / 2 * i / fo); L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
      normPeak([L, R], 0); for (const c of [L, R]) { for (let i = 0; i < n; i++) c[i] = Math.tanh(5 * c[i]); biquad(c, 'lp', 9000, .7, sr); biquad(c, 'lp', 9000, .7, sr); biquad(c, 'lp', 7000, .7, sr); }
      normPeak([L, R], PEAK.spark); return [L, R];
    },
    // from score2.js:255-259
    ding(sr) {
      const [L, R] = bellData(sr, hz(89), [[.5, .22, 2.2, .3, .3], [1, 1, 2.6, .8, .09], [1.0007, .22, 2.3, .3, .2], [2, .28, 1.0, .6, .06], [2.76, .5, .7, .72, .035],
        [4.07, .32, .35, .72, .025], [5.4, .26, .25, .75, .018], [6.8, .13, .18, .75, .014], [8.2, .08, .12, .75, .01]], 4.2, .55, 89);
      normPeak([L, R], PEAK.ding); return [L, R];
    },
    // from score2.js:261-265
    chime(sr, note) {
      const [L, R] = bellData(sr, hz(note ? 84 : 77), [[1, 1, 2.0], [1.0015, .35, 1.8], [2, .3, .9], [3, .07, .45], [4.07, .09, .35], [5.2, .035, .25]], 3.2, .12, 77 + note);
      for (let i = 0; i < L.length; i++) { const l = L[i]; L[i] = l * 1.15 + R[i] * .1; R[i] = R[i] * .75 + l * .1; }
      normPeak([L, R], PEAK.chime); return [L, R];
    },
    // from score2.js:277-287
    lock(sr) {
      const n = Math.round(sr * .2), L = new Float32Array(n), R = new Float32Array(n);
      for (const [off, amp, body] of [[0, .7, 210], [.048, 1, 150]]) {
        const x = new Float32Array(Math.round(sr * .12)), g = noise(Math.round(sr * .0014), 90 + body);
        biquad(g, 'bp', 2800, 3, sr); for (let i = 0; i < g.length; i++) x[i] += g[i] * 3;
        partial(x, sr, 3300, .35, .008, .025, .5, 0); partial(x, sr, 5150, .2, .006, .016, .5, 1);
        partial(x, sr, body, .6, .012, .035, .5, 0);
        fadeEdges([x], sr, .0003, .02); panInto(L, R, x, .3, amp, Math.round(off * sr));
      }
      normPeak([L, R], PEAK.lock); return [L, R];
    },
    // from score2.js:289-298
    stamp(sr) {
      const n = Math.round(sr * .42), x = new Float32Array(n); let ph = 0;
      for (let i = 0; i < n; i++) { const t = i / sr; ph += PI2 * (48 + 45 * Math.exp(-t / .03)) / sr; x[i] = Math.sin(ph) * (1 - Math.exp(-t / .002)) * Math.exp(-t / .08); }
      const k = noise(n, 61); for (let i = 0; i < n; i++) k[i] *= Math.exp(-i / (sr * .03)); biquad(k, 'lp', 650, .7, sr); biquad(k, 'lp', 650, .7, sr);
      const s = noise(n, 62); for (let i = 0; i < n; i++) s[i] *= Math.exp(-i / (sr * .018)); biquad(s, 'bp', 380, 1.5, sr);
      const p = noise(n, 63); for (let i = 0; i < n; i++) p[i] *= Math.exp(-i / (sr * .012)); biquad(p, 'hp', 2500, .7, sr);
      for (let i = 0; i < n; i++) x[i] = x[i] + k[i] * 2.4 + s[i] * 2 + p[i] * .25;
      fadeEdges([x], sr, .0005, .05); const L = new Float32Array(n), R = new Float32Array(n); panInto(L, R, x, 0);
      normPeak([L, R], PEAK.stamp); return [L, R];
    },
    // from score2.js:300-308
    paper(sr, k) {
      const n = Math.round(sr * .42), x = noise(n, 120 + k), r = rng(130 + k); let gr = 0;
      for (let i = 0; i < n; i++) { const t = i / sr, e = t < .34 ? Math.pow(Math.sin(Math.PI * t / .34), 1.3) : 0; gr += .02 * ((r() * 2 - 1) - gr); x[i] *= e * (.6 + 5 * Math.abs(gr)); }
      sweepBP(x, t => 1300 + 1500 * Math.min(1, t / .34), 1.1, sr);
      const tap = noise(Math.round(sr * .03), 140 + k); for (let i = 0; i < tap.length; i++) tap[i] *= Math.exp(-i / (sr * .005)); biquad(tap, 'lp', 1300, .7, sr);
      const L = new Float32Array(n), R = new Float32Array(n); panInto(L, R, x, .05); panInto(L, R, tap, .05, 1.6, Math.round(sr * .33));
      fadeEdges([L, R], sr, .002, .03); normPeak([L, R], PEAK.paper); return [L, R];
    },
    // from score2.js:310-317
    whoosh(sr, dir = 1) {
      const n = Math.round(sr * .55), x = noise(n, 150), sh = t => Math.exp(-Math.pow((t - .36) / (t < .36 ? .13 : .06), 2));
      for (let i = 0; i < n; i++) x[i] *= sh(i / sr);
      sweepBP(x, t => 500 + 1900 * sh(t), .8, sr);
      const L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i++) { const a = (clamp(dir * (.25 + .5 * i / n), -1, 1) + 1) * Math.PI / 4; L[i] = x[i] * Math.cos(a); R[i] = x[i] * Math.sin(a); }
      fadeEdges([L, R], sr, .01, .05); normPeak([L, R], PEAK.whoosh); return [L, R];
    },
    // from score2.js:319-328
    tick(sr, k, peak = PEAK.tick, blip = 0, pan = -.2) {
      const n = Math.round(sr * (blip ? .3 : .08)), x = new Float32Array(n), c = noise(Math.round(sr * .0009), 160 + k);
      biquad(c, 'hp', 2500, .7, sr); for (let i = 0; i < c.length; i++) x[i] += c[i];
      partial(x, sr, 4200, .35, .003, .007, .5, 0);
      const s = noise(Math.round(sr * .03), 170 + k); for (let i = 0; i < s.length; i++) s[i] *= Math.exp(-i / (sr * .008)); biquad(s, 'bp', 3000, 1, sr);
      for (let i = 0; i < s.length; i++) x[i] += s[i] * .5;
      if (blip) partial(x, sr, blip, .5, .05, .16, .3, 0);
      fadeEdges([x], sr, .0002, .01); const L = new Float32Array(n), R = new Float32Array(n); panInto(L, R, x, pan);
      normPeak([L, R], peak); return [L, R];
    },
    // from score2.js:377-387
    click(sr, k) {
      const n = Math.round(sr * .15), x = new Float32Array(n);
      for (const [off, amp, s, f] of [[0, 1, 0, 1], [.062 + .014 * hash(k, 5), .45, 1, 1.18]]) {
        const y = new Float32Array(Math.round(sr * .05)), c = decay(noise(Math.round(sr * .0025), 300 + k * 4 + s), sr, .0004);
        biquad(c, 'hp', 2400, .7, sr); normTo(c, 1); addAt(y, c, 0);
        const b = new Float32Array(y.length); partial(b, sr, 2300 * f * (1 + .05 * (hash(k, 6 + s) - .5)), .3, .0015, .005, .5, 0); partial(b, sr, 540 * f, .6, .003, .01, .5, 0); normTo(b, .5);
        addAt(y, b, 0); addAt(x, y, Math.round(off * sr), amp);
      }
      return stereo(sr, x, .04, PEAK.click);
    },
    // from score2.js:389-402
    keys(sr, dur, seed, kind) {
      const n = Math.round(sr * (dur + .12)), L = new Float32Array(n), R = new Float32Array(n), r = rng(600 + seed * 13), hits = [];
      if (kind === 'agent') {
        for (let k = 0, t = .012; t < dur - .02; k++, t += 1 / 6) {
          hits.push([t, .82 + .18 * r(), k % 2 ? .1 : -.14, false]);
          if (r() < .65 && t + .09 < dur) hits.push([t + 1 / 12 + (r() - .5) * .025, .45 + .2 * r(), k % 2 ? -.14 : .1, false]);
        }
      } else {
        let t = .012; while (t < dur - .02) { const sp = kind !== 'screen' && r() < .12; hits.push([t, sp ? .75 : .55 + .45 * r(), (r() - .5) * .16, sp]); t += kind === 'screen' ? .05 + .035 * r() : .07 + .075 * r(); }
      }
      hits.forEach(([t, a, p, sp], j) => panInto(L, R, keyStroke(sr, seed * 97 + j, kind, sp), p, a, Math.round(t * sr)));
      fadeEdges([L, R], sr, .0003, .03); normPeak([L, R], PEAK.key); return [L, R];
    },
    // from score2.js:404-418
    print(sr, dur) {
      const n = Math.round(sr * (dur + .16)), x = new Float32Array(n), r = rng(811), period = .084, onF = .74;
      const p = new Float32Array(n);
      for (let t = .008; t < dur - .01; t += 1 / 232) { if ((t % period) / period > onF) continue; p[Math.round(t * sr)] += .7 + .3 * r(); }
      const a = biquad(Float32Array.from(p), 'bp', 1180, 5, sr), b = biquad(Float32Array.from(p), 'bp', 2900, 4, sr), c = biquad(Float32Array.from(p), 'hp', 5000, .7, sr);
      normTo(a, .7); normTo(b, .45); normTo(c, .25);
      const f = noise(n, 812); for (let i = 0; i < n; i++) { const t = i / sr, u = (t % period) / period; f[i] *= t < dur ? (u < onF ? 1 : .35) : 0; } biquad(f, 'bp', 4200, 1.2, sr); normTo(f, .22);
      const m = new Float32Array(n); partial(m, sr, 118, 1, 1e5, 1e5, 0, 0); partial(m, sr, 236, .6, 1e5, 1e5, 0, 1); partial(m, sr, 354, .35, 1e5, 1e5, 0, 2); normTo(m, .18);
      for (let i = 0; i < n; i++) { const t = i / sr, e = t < dur ? Math.min(1, t / .012, (dur - t) / .02) : 0; x[i] = a[i] + b[i] + c[i] + (f[i] + m[i]) * e; }
      for (const [off, amp, sd] of [[dur + .012, .8, 1], [dur + .055, .6, 2]]) {
        const y = new Float32Array(Math.round(sr * .05)), k = decay(noise(Math.round(sr * .006), 820 + sd), sr, .0012); biquad(k, 'hp', 1800, .7, sr); normTo(k, 1); addAt(y, k, 0);
        partial(y, sr, 1750 + 300 * sd, .35, .002, .008, .5, 0); addAt(x, y, Math.round(off * sr), amp);
      }
      return stereo(sr, x, .22, PEAK.print);
    },
    // from score2.js:420-430
    box(sr) {
      const n = Math.round(sr * .45), x = new Float32Array(n);
      const th = glide(sr, .3, t => 62 + 60 * Math.exp(-t / .018), t => (1 - Math.exp(-t / .0015)) * Math.exp(-t / .06)); normTo(th, .9); addAt(x, th, 0);
      const body = decay(noise(Math.round(sr * .2), 41), sr, .035); biquad(body, 'lp', 1000, .7, sr); biquad(body, 'lp', 1000, .7, sr); normTo(body, .6); addAt(x, body, 0);
      for (const [off, s] of [[.055, 1], [.125, 2]]) {
        const y = noise(Math.round(sr * .05), 42 + s); for (let i = 0; i < y.length; i++) { const t = i / sr; y[i] *= Math.pow(Math.sin(Math.PI * Math.min(1, t / .045)), 2); }
        sweepBP(y, t => 700 + 1400 * t / .045, 1.4, sr); normTo(y, .5); addAt(x, y, Math.round(off * sr));
      }
      const pop = glide(sr, .18, t => 420 + 280 * Math.min(1, t / .06), t => Math.min(1, t / .004) * Math.exp(-t / .06), [[1, 1], [2, .15]]); normTo(pop, .3); addAt(x, pop, Math.round(.1 * sr));
      return stereo(sr, x, .25, PEAK.box);
    },
    // from score2.js:432-443
    crack(sr, len = .26) {
      const n = Math.round(sr * (len + .42)), x = new Float32Array(n), r = rng(333);
      const tk = new Float32Array(Math.round(sr * .4)); partial(tk, sr, 2960, 1, .02, .15, .5, 0); partial(tk, sr, 4410, .45, .01, .08, .6, 1); partial(tk, sr, 6230, .2, .006, .04, .7, 2);
      normTo(tk, .6); addAt(x, tk, 0);
      for (let k = 0; k < 11; k++) {
        const t = .015 + len * (k / 10) * (.85 + .15 * r()), a = (.35 + .65 * Math.sin(Math.PI * (k + .5) / 11)) * (.6 + .4 * r());
        const y = new Float32Array(Math.round(sr * .05)), c = noise(Math.max(4, Math.round(sr * (.0004 + .0009 * r()))), 340 + k); biquad(c, 'hp', 2800, .7, sr); normTo(c, 1); addAt(y, c, 0);
        const ring = new Float32Array(y.length); partial(ring, sr, 2200 + 3300 * r(), 1, .004, .012 + .02 * r(), .6, r() * PI2); normTo(ring, .6); addAt(y, ring, 0);
        addAt(x, y, Math.round(t * sr), a);
      }
      return stereo(sr, x, 0, PEAK.crack);
    },
    // from score2.js:445-456
    drawer(sr, open) {
      const sl = open ? .25 : .2, n = Math.round(sr * (sl + .35)), x = new Float32Array(n), r = rng(open ? 51 : 52);
      const roll = noise(n, open ? 53 : 54); let bump = 1, bc = 0;
      for (let i = 0; i < n; i++) { const t = i / sr; if (t > sl) { roll[i] = 0; continue; } if (--bc <= 0) { bump = .45 + .55 * r(); bc = Math.round(sr * (.016 + .02 * r())); } roll[i] *= Math.min(1, t / .03) * bump; }
      sweepBP(roll, t => open ? 420 + 320 * Math.min(1, t / sl) : 760 - 300 * Math.min(1, t / sl), 1.1, sr); normTo(roll, .45); addAt(x, roll, 0);
      const stop = new Float32Array(Math.round(sr * .3));
      partial(stop, sr, open ? 165 : 112, 1, .02, open ? .05 : .09, .5, 0); partial(stop, sr, 980, .22, .01, .07, .5, 1); partial(stop, sr, 1530, .12, .008, .05, .5, 2);
      const k = decay(noise(Math.round(sr * .004), open ? 55 : 56), sr, .0008); biquad(k, 'hp', 1800, .7, sr); normTo(k, .5); addAt(stop, k, 0);
      normTo(stop, open ? .6 : 1); addAt(x, stop, Math.round(sl * sr));
      if (!open) { const l = decay(noise(Math.round(sr * .003), 57), sr, .0006); biquad(l, 'hp', 3000, .7, sr); normTo(l, .45); addAt(x, l, Math.round((sl + .035) * sr)); }
      return stereo(sr, x, -.43, PEAK.drawer);
    },
    // from score2.js:458-466
    nod(sr) {
      const n = Math.round(sr * .6), x = new Float32Array(n);
      for (const [off, f0, f1, a] of [[0, 880, 1175, 1], [1 / 3, 1047, 1397, .85]]) {
        const y = glide(sr, .22, t => f0 + (f1 - f0) * Math.min(1, t / .045), t => (1 - Math.exp(-t / .004)) * Math.exp(-t / .06), [[1, 1], [2, .18]]); normTo(y, 1);
        const w = noise(Math.round(sr * .05), 60 + Math.round(off * 9)); for (let i = 0; i < w.length; i++) w[i] *= Math.sin(Math.PI * i / w.length); biquad(w, 'bp', 1900, 3, sr); normTo(w, .12); addAt(y, w, 0);
        addAt(x, y, Math.round(off * sr), a);
      }
      return stereo(sr, x, -.03, PEAK.nod);
    },
    // from score2.js:470-477
    wake(sr, b1 = .3, b2 = .42) {
      const n = Math.round(sr * Math.max(.8, b2 + .4)), x = new Float32Array(n);
      const up = glide(sr, .36, t => 110 * Math.pow(560 / 110, Math.min(1, t / .3)), t => Math.pow(Math.sin(Math.PI / 2 * Math.min(1, t / .27)), 2) * (t < .27 ? 1 : Math.exp(-(t - .27) / .03)), [[1, 1], [2, .35], [3, .12]]);
      normTo(up, .7); addAt(x, up, 0);
      for (const [off, a] of [[b1, 1], [b2, .6]]) { const y = new Float32Array(Math.round(sr * .25)); partial(y, sr, 880, 1, .03, .09, .4, 0); partial(y, sr, 1760, .2, .01, .04, .6, 1); fadeEdges([y], sr, .003, .02); normTo(y, .6); addAt(x, y, Math.round(off * sr), a); }
      return stereo(sr, x, -.03, PEAK.wake);
    },
    // from score2.js:480-490
    lampOn(sr, pat) {
      const bursts = pat ? [...pat.flash.map(([a, b]) => [a, Math.max(.02, b - a - .004), .5]), [pat.lit, .06, .7]] : [[.06, .03, .55], [.145, .02, .4], [.21, .06, .7]];
      const tink = pat ? pat.lit + .01 : .22, n = Math.round(sr * Math.max(.55, tink + .3)), x = new Float32Array(n);
      const k = new Float32Array(Math.round(sr * .15)); partial(k, sr, 78, 1, .01, .04, .5, 0); const c = decay(noise(Math.round(sr * .002), 71), sr, .0004); biquad(c, 'hp', 2000, .7, sr); normTo(c, .6); addAt(k, c, 0); normTo(k, .8); addAt(x, k, 0);
      for (const [off, len, a] of bursts) {
        const y = new Float32Array(Math.round(sr * (len + .02))); for (let i = 0; i < y.length; i++) { const t = i / sr; y[i] = Math.sign(Math.sin(PI2 * 100 * t)) * Math.min(1, t / .002, Math.max(0, (len - t) / .006)); }
        biquad(y, 'bp', 700, .8, sr); normTo(y, a * .6); addAt(x, y, Math.round(off * sr));
      }
      const g = new Float32Array(Math.round(sr * .2)); partial(g, sr, 3350, 1, .01, .07, .5, 0); normTo(g, .22); addAt(x, g, Math.round(tink * sr));
      return stereo(sr, x, -.21, PEAK.lampOn);
    },
    // from score2.js:499-505 (the red '?' after power back; offered as play('question'), sound.md §6)
    question(sr) {
      const n = Math.round(sr * .75), x = new Float32Array(n), tri = [[1, 1], [3, .11], [5, .04]];
      const hm = glide(sr, .14, () => 587, t => Math.min(1, t / .008) * Math.exp(-t / .07), tri); normTo(hm, .6); addAt(x, hm, 0);
      const q = glide(sr, .58, t => 659 * Math.pow(880 / 659, Math.min(1, t / .22)) * (1 + .008 * Math.sin(PI2 * 6.5 * Math.max(0, t - .22))),
        t => Math.min(1, t / .015) * (t < .3 ? 1 : Math.exp(-(t - .3) / .09)), tri); normTo(q, 1); addAt(x, q, Math.round(.13 * sr));
      return stereo(sr, x, 0, PEAK.question);
    },
    // from score2.js:507-515
    screen(sr) {
      const n = Math.round(sr * 1.1), x = new Float32Array(n);
      const a = noise(n, 91), sh = t => Math.exp(-Math.pow((t - .12) / (t < .12 ? .08 : .16), 2)); for (let i = 0; i < n; i++) a[i] *= sh(i / sr);
      sweepBP(a, t => 1800 + 3400 * Math.min(1, t / .35), 1.2, sr); normTo(a, .35); addAt(x, a, 0);
      const g = new Float32Array(n); partial(g, sr, 1047, 1, .12, .6, .3, 0); partial(g, sr, 1568, .45, .1, .45, .3, 1); partial(g, sr, 2094, .15, .05, .2, .5, 2);
      const na = Math.round(sr * .012); for (let i = 0; i < na; i++) g[i] *= i / na;
      normTo(g, .6); addAt(x, g, Math.round(.005 * sr));
      return stereo(sr, x, 0, PEAK.screen);
    },
    // from score2.js:517-524
    swipe(sr, k) {
      const n = Math.round(sr * .5), x = noise(n, 250 + k), sh = t => Math.exp(-Math.pow((t - .25) / (t < .25 ? .1 : .11), 2));
      for (let i = 0; i < n; i++) x[i] *= sh(i / sr);
      sweepBP(x, t => 800 + 1700 * sh(t), .9, sr);
      const L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i++) { const a = (.3 - .6 * i / n + 1) * Math.PI / 4; L[i] = x[i] * Math.cos(a); R[i] = x[i] * Math.sin(a); }
      fadeEdges([L, R], sr, .005, .05); normPeak([L, R], PEAK.swipe); return [L, R];
    },
    // from score2.js:526-532
    dive(sr) {
      const n = Math.round(sr * .75), x = noise(n, 155), sh = t => Math.exp(-Math.pow((t - .52) / (t < .52 ? .22 : .07), 2));
      for (let i = 0; i < n; i++) x[i] *= sh(i / sr);
      sweepBP(x, t => 260 + 1300 * sh(t), .75, sr);
      const L = new Float32Array(n), R = new Float32Array(n); panInto(L, R, x, .15);
      fadeEdges([L, R], sr, .01, .04); normPeak([L, R], PEAK.dive); return [L, R];
    },
    // from score2.js:559-565
    slip(sr, k) {
      const n = Math.round(sr * .5), x = new Float32Array(n), r = rng(260 + k);
      const ru = noise(Math.round(sr * .2), 261 + k); let gr = 0; for (let i = 0; i < ru.length; i++) { const t = i / sr; gr += .03 * ((r() * 2 - 1) - gr); ru[i] *= Math.pow(Math.sin(Math.PI * t / .2), 1.5) * (.5 + 4 * Math.abs(gr)); }
      sweepBP(ru, t => 1500 + 2000 * t / .2, 1.1, sr); normTo(ru, .8); addAt(x, ru, 0);
      const bl = new Float32Array(Math.round(sr * .25)); partial(bl, sr, hz(96), 1, .05, .16, .3, 0); normTo(bl, .35); addAt(x, bl, Math.round(.24 * sr));
      return stereo(sr, x, .1, PEAK.slip);
    },
  };

  // pencil scratch: from score2.js:962-998 as scratchBuf (sound.md §6): one interval [lead, lead + len] at
  // gate, the film's stroke envelope (drawing = long pulls, writing = short letter strokes, lifts between),
  // paper-grain AM and tooth, the same filters and pan wander. seed replaces the film's fixed rng(4242)/rng(777)
  // so captions do not all sound the same. Unit gain (the caller applies MIX.scratch).
  function scratchBuf(sr, len, gate, seed, lead = 0, tail = 0) {
    const A0 = 0, B0 = lead + len + tail, CR = 1000, nc = Math.ceil((B0 - A0) * CR) + 2, gt = new Float32Array(nc), env = new Float32Array(nc), r = rng(4242 + seed);
    for (let j = Math.floor(lead * CR), j1 = Math.min(nc, Math.ceil((lead + len) * CR)); j < j1; j++) gt[j] = gate;
    for (let j = 0; j < nc;) {
      if (gt[j] <= 0) { j++; continue; }
      const draw = gt[j] > .7, L = Math.round(draw ? 110 + r() * 360 : 45 + r() * 120), gap = Math.round(draw ? 20 + r() * 80 : 15 + r() * 55), pk = .55 + r() * .45, sk = .2 + r() * .5;
      for (let k = 0; k < L && j + k < nc; k++) { const x = k / L, sh = x < sk ? Math.sin(x / sk * Math.PI / 2) : Math.cos((x - sk) / (1 - sk) * Math.PI / 2); env[j + k] = pk * Math.pow(Math.max(0, sh), .6) * gt[j + k]; }
      j += L + gap;
    }
    for (let j = 1, y = 0; j < nc; j++) { y += (env[j] > y ? .07 : .03) * (env[j] - y); env[j] = y; }
    const n = Math.ceil((B0 - A0) * sr), x = new Float32Array(n), rn = rng(777 + seed), gc = 1 - Math.exp(-PI2 * 260 / sr);
    let gr = 0;
    for (let i = 0; i < n; i++) {
      const c = i * CR / sr, j = c | 0, e = env[j] + (env[j + 1] - env[j]) * (c - j);
      gr += gc * ((rn() * 2 - 1) - gr);
      let s = rn() * 2 - 1; if (rn() < 55 / sr) s *= 5;
      x[i] = e > 1e-4 ? s * e * clamp(.55 + .45 * gr / .076, .08, 1.7) : 0;
    }
    biquad(x, 'hp', 1100, .7, sr); biquad(x, 'pk', 3400, .9, sr, 5); biquad(x, 'lp', 8500, .7, sr);
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = (.2 * noise1((A0 + i / sr) * .35 + seed * 7, 9) + 1) * Math.PI / 4; L[i] = x[i] * Math.cos(a); R[i] = x[i] * Math.sin(a); }
    fadeEdges([L, R], sr, .004, .02);
    return [L, R];
  }

  // small room reverb: from score2.js:1014-1023 (unchanged)
  function reverbIR(sr, len = 2.2, rt60 = 1.8) {
    const n = Math.round(sr * len), pre = Math.round(sr * .012), chs = [new Float32Array(n), new Float32Array(n)];
    chs.forEach((d, ch) => {
      const r = rng(900 + ch); let lp = 0;
      for (let i = pre; i < n; i++) { const t = (i - pre) / sr, c = .7 * Math.exp(-t / .5) + .1; lp += c * ((r() * 2 - 1) - lp); d[i] = lp * Math.exp(-6.91 * t / rt60) * (i > n * .9 ? (n - i) / (n * .1) : 1); }
      for (const [ms, a] of [[7, .5], [13, -.35], [21, .3], [29, -.22], [37, .18]]) d[pre + Math.round(sr * (ms + ch * 1.7) / 1000)] += a * (ch ? -1 : 1) * .3;
      let E = 0; for (let i = 0; i < n; i++) E += d[i] * d[i]; const k = 1 / Math.sqrt(E || 1); for (let i = 0; i < n; i++) d[i] *= k;
    });
    return chs;
  }

  // ============================================================ the live engine (new)
  let ac = null, master = null, world = null, sparkBus = null, conv = null, revRet = null, humEnv = null, on = false;
  let humWant = false, scr = { want: false, gate: 1, node: null, g: null }, silentUntil = -1;
  let tracer = null;   // tests only (__trace): told about every buffer started, loop start/stop and hum ramp
  const trace = (what, key, at) => { if (tracer) try { tracer(what, key, at); } catch (e) { /* a test hook never breaks sound */ } };
  const count = {};   // variant rotation per type when opts.k is not given
  const nth = t => (count[t] = (count[t] ?? -1) + 1);
  const POWER_PAT = { flash: [[0, 1 / 12]], lit: 3 / 12 };   // score2.js:91-94 (a5/a9 POWER), GAME_SPEC §8
  const KEY_VARS = 8, KEY_SPACE = 2;   // sound.md §6: about 8 normal and 2 space key variants
  const LOOP = 4;                      // seconds of pre-rendered scratch loop per gate

  // ---------- recipes by cache key: [key, make(sr), send] (the film's sends, score2.js:853-927) ----------
  const REC = {
    click: k => ['click' + (k % 4), sr => SFX.click(sr, k % 4), .03],
    swipe: k => ['swipe' + (k % 3), sr => SFX.swipe(sr, k % 3), .04],
    paper: k => ['paper' + (k % 3), sr => SFX.paper(sr, k % 3), .05],
    tick: k => ['tick' + (k % 3), sr => SFX.tick(sr, k % 3), 0],
    readTick: k => ['read' + (k % 4), sr => SFX.tick(sr, 10 + k % 4, PEAK.read, hz(96), -.25), .1],
    slip: k => ['slip' + (k % 2), sr => SFX.slip(sr, k % 2), .06],
    screen: () => ['screen', sr => SFX.screen(sr), .2],
    box: () => ['box', sr => SFX.box(sr), .08],
    crack: () => ['crack', sr => SFX.crack(sr), .15],
    whoosh: dir => ['whoosh' + dir, sr => SFX.whoosh(sr, dir), .08],
    dive: () => ['dive', sr => SFX.dive(sr), .1],
    drawer: open => ['drawer' + open, sr => SFX.drawer(sr, open), .06],
    nod: () => ['nod', sr => SFX.nod(sr), .12],
    chime: nt => ['chime' + nt, sr => SFX.chime(sr, nt), .45],
    stamp: () => ['stamp', sr => SFX.stamp(sr), .1],
    lock: () => ['lock', sr => SFX.lock(sr), .08],
    ding: () => ['ding', sr => SFX.ding(sr), .22],
    question: () => ['question', sr => SFX.question(sr), .15],
    spark: () => ['spark', sr => SFX.spark(sr), 0],
    lampOn: () => ['lampOn|game', sr => SFX.lampOn(sr, POWER_PAT), .06],
    wake: () => ['wake|game', sr => SFX.wake(sr, .25, 5 / 12), .12],
    // one typed key (sound.md §6): keyStroke 'laptop' at PEAK.key, a small random level and pan per variant
    key: (k, space) => space ? ['keysp' + (k % KEY_SPACE), sr => keyVar(sr, 50 + k % KEY_SPACE, true), .04] : ['key' + (k % KEY_VARS), sr => keyVar(sr, k % KEY_VARS, false), .04],
    keys: (dur, kind, seed) => { const d = clamp(dur ?? .8, .1, 8); return [`type|${kind}|${d.toFixed(3)}|${seed}`, sr => SFX.keys(sr, d, seed, kind), .04]; },
    print: dur => { const d = clamp(dur ?? .7, .2, 4); return ['print' + d.toFixed(3), sr => SFX.print(sr, d), .06]; },
    pencil: (dur, gate, k) => { const d = Math.round(clamp(dur ?? .9, .1, 6) * 100) / 100; return [`pencil|${d.toFixed(2)}|${gate}|${k}`, sr => scratchBuf(sr, d, gate, k + 1, 0, .2), .05]; },
    piano: (m, bright) => ['p' + m + '|' + bright, sr => [pianoData(sr, m, bright)], 0],
    loop: gate => ['loop|' + gate, sr => scratchBuf(sr, LOOP, gate, Math.round(gate * 100)), 0],
  };
  // the film windows' pencil cues (score2.js:964-965): a cue inside a stage pencil interval (or up to .3 s before
  // it) is not played itself; the stage's interval is. pencilSpan returns that interval, merged with the ones that
  // touch it (the film takes the max gate where scratch intervals overlap), as {dur, gate, delay from the cue}.
  const ACT_K = { a1: 0, a2: 1, a3: 2 };   // one scratch seed per act window
  const actOf = key => (window.SCENES || []).find(x => x.key === key) || null;
  function pencilSpan(act, t) {
    let ivs = [];
    try { ivs = act && act.stage && typeof act.stage.scratch === 'function' ? act.stage.scratch(0) : []; } catch (e) { ivs = []; }
    ivs = ivs.filter(v => v && v[1] > v[0]);
    const hit = ivs.find(([a, b]) => t >= a - .3 && t <= b);
    if (!hit) return { dur: .9, gate: 1, delay: 0 };
    let [a, b, g] = [hit[0], hit[1], hit[2] ?? 1], grew = true;
    while (grew) { grew = false; for (const [a2, b2, g2 = 1] of ivs) if (a2 <= b + .02 && b2 >= a - .02 && (a2 < a || b2 > b)) { a = Math.min(a, a2); b = Math.max(b, b2); g = Math.max(g, g2); grew = true; } }
    const from = Math.max(a, t);
    return { dur: b - from, gate: g, delay: from - t };
  }
  function keyVar(sr, s, space) { const r = rng(4100 + s), a = r(), p = r(); return stereo(sr, keyStroke(sr, s, 'laptop', space), (p - .5) * .16, PEAK.key + 20 * Math.log10(.55 + .45 * a)); }
  const IR = ['ir', sr => reverbIR(sr)];
  const buf = ([key, make]) => cached(ac, key, () => make(ac.sampleRate));

  // ---------- idle warm-up: a few buffers per idle callback after enable (sound.md §6 "Cost") ----------
  const WARM = () => [
    IR, ['@conv'], REC.spark(), REC.lampOn(), REC.wake(), REC.loop(.35),
    ...[0, 1, 2, 3].map(k => REC.click(k)), ...[0, 1, 2].map(k => REC.swipe(k)), REC.screen(),
    ...Array.from({ length: KEY_VARS }, (_, k) => REC.key(k, false)), ...Array.from({ length: KEY_SPACE }, (_, k) => REC.key(k, true)),
    ...[0, 1, 2].map(k => REC.tick(k)), REC.piano(81, .5), REC.piano(84, .5), REC.box(), REC.crack(),
    REC.piano(72, .35), REC.piano(73, .35), REC.piano(70, .35), REC.piano(69, .35), REC.whoosh(1), REC.dive(),
    ...[0, 1].map(k => REC.slip(k)), ...[0, 1, 2].map(k => REC.paper(k)), REC.drawer(true), REC.drawer(false), REC.nod(),
    REC.chime(0), REC.chime(1), REC.stamp(), REC.lock(), REC.ding(), REC.question(), ...[0, 1, 2, 3].map(k => REC.readTick(k)),
    REC.loop(1), REC.loop(.45), REC.pencil(.9, 1, 0),
    ...['a1', 'a2', 'a3'].flatMap(key => { const a = actOf(key); return (a && a.cues ? a.cues : []).filter(q => q.type === 'pencil').map(q => { const p = pencilSpan(a, q.t); return REC.pencil(p.dur, p.gate, ACT_K[key]); }); }),
  ];
  let warmQ = [], warming = false;
  const idle = fn => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 400 }) : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 40));
  function warmStep(dl) {
    let n = 0;
    while (warmQ.length && ac && (n === 0 || dl.timeRemaining() > 30)) {   // one recipe costs at most ~26 ms
      const r = warmQ.shift();
      if (r[0] === '@conv') { if (!conv.buffer) conv.buffer = buf(IR); n++; continue; }   // the convolver's own setup, a step of its own
      if (has(ac, r[0])) continue;
      buf(r); n++;
      if (r[0] === 'loop|' + scr.gate && scr.want && !scr.node) startLoop();
    }
    if (warmQ.length && ac) idle(warmStep); else warming = false;
  }
  function warm(list) { warmQ.push(...list); if (!warming) { warming = true; idle(warmStep); } }

  // ---------- the graph (GAME_SPEC §8) ----------
  function build(ctx) {
    ac = ctx;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -3; comp.knee.value = 1; comp.ratio.value = 20; comp.attack.value = .001; comp.release.value = .12;
    const trim = ac.createGain(); trim.gain.value = dB(-1.71);   // score2.js:649: dB(-.6 * (3 - 3 / 20))
    master = ac.createGain(); world = ac.createGain(); sparkBus = ac.createGain();
    world.connect(master); sparkBus.connect(master); master.connect(comp); comp.connect(trim); trim.connect(ac.destination);
    conv = ac.createConvolver(); conv.normalize = false;
    revRet = ac.createGain(); revRet.gain.value = MIX.rev; conv.connect(revRet); revRet.connect(world);
    // the room hum: live oscillators, from score2.js:949-952 (env starts at 0; hum() ramps it)
    humEnv = ac.createGain(); humEnv.gain.value = 0;
    const wob = ac.createGain(), lfo = ac.createOscillator(), lfoG = ac.createGain();
    humEnv.connect(wob); wob.connect(world);
    lfo.frequency.value = .23; lfoG.gain.value = .12; lfo.connect(lfoG); lfoG.connect(wob.gain); lfo.start();
    for (const [f, a] of [[50, -9], [100, 0], [150, -8], [200, -13], [300, -20], [400, -26]]) {
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.value = MIX.hum * dB(a); o.connect(g); g.connect(humEnv); o.start();
    }
    warm(WARM());
  }

  /**
   * Turn sound on. MUST run inside a user gesture (click/keydown): creates or resumes the
   * AudioContext, builds the graph once, starts the hum oscillators at gain 0, then fills effect
   * buffers in idle callbacks. On iOS sets navigator.audioSession.type = 'playback' if it exists.
   * @returns {Promise<void>} resolves when the context is running
   */
  async function enable() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; build(new AC()); }
    on = true;
    const t = ac.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(0, t); master.gain.linearRampToValueAtTime(1, t + .05);
    humTo(humWant, .05);
    try { if (ac.state !== 'running') await ac.resume(); } catch (e) { /* resumed on the next gesture */ }
  }
  /** Turn sound off: fade the master, then suspend the context. @returns {Promise<void>} */
  async function disable() {
    on = false; if (!ac) return;
    const t = ac.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + .05);
    stopLoop(.02); cutShots(t, t + .05);   // nothing left over resumes when Sound comes back
    // a crash silence still pending ends now, under the master fade, instead of running on after Sound on
    if (silentUntil > t) { const g = world.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1, t + .05); silentUntil = -1; }
    await new Promise(r => setTimeout(r, 70));
    if (!on) freshReverb();   // under the faded master: the reverb's tail is not frozen with the context
    if (!on && ac.state === 'running') { try { await ac.suspend(); } catch (e) { /* already closed */ } }
  }
  // a new convolver with the same IR (its state starts empty); the old one's tail goes with it
  function freshReverb() {
    const old = conv; conv = ac.createConvolver(); conv.normalize = false;
    if (old.buffer) conv.buffer = old.buffer;   // an IR not built yet is set by the warm-up ('@conv') as before
    conv.connect(revRet); old.disconnect();
  }
  /** Tab hidden/shown (runtime.js on visibilitychange): suspend / resume if sound is on. */
  function visibility(hidden) { if (!ac) return; if (hidden) ac.suspend().catch(() => {}); else if (on) ac.resume().catch(() => {}); }

  /**
   * THE TYPE TABLE: every name play() takes -> the score2.js recipe it plays (sound.md §3; score2.js
   * line refs). opts in parentheses. This is the one list builders code against; the sound builder
   * fills the recipes, never the names. GAME_SPEC §8 "Event -> sound" rows in [brackets].
   */
  const TYPES = {
    click: 'SFX.click(sr, k) :377, 4 variants (k = i % 4)            [Buy / Pay / Refund / Submit]',
    swipe: 'SFX.swipe(sr, k) :517, k = i % 3                          [page change]',
    screen: 'SFX.screen :507                                          [laptop wakes]',
    key: "keyStroke(sr, s, 'laptop') :214, one key (k, space)         [name and reason typing: one per letter]",
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
    question: "SFX.question :499                                       [the '?' after power back (optional)]",
  };

  // one buffer at t (default now) through world (or the spark path), with the recipe's reverb send
  function fire(rec, gain = 1, t = 0, o = {}) {
    const b = buf(rec), src = ac.createBufferSource(), g = ac.createGain(), at = ac.currentTime + t;
    src.buffer = b; g.gain.value = gain; src.connect(g);
    if (o.pan !== undefined && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = o.pan; g.connect(p); p.connect(o.bus || world); if (rec[2]) { const s = ac.createGain(); s.gain.value = rec[2]; p.connect(s); s.connect(conv); } }
    else { g.connect(o.bus || world); if (rec[2]) { const s = ac.createGain(); s.gain.value = rec[2]; g.connect(s); s.connect(conv); } }
    if (o.until !== undefined) { g.gain.setValueAtTime(gain, ac.currentTime + o.until); g.gain.setTargetAtTime(0, ac.currentTime + o.until, .08); }
    src.start(at); src.stop(at + b.duration + .01); trace('fire', rec[0], at);
    if (!o.bus) { const e = { src, g, end: at + b.duration }; shots.add(e); src.onended = () => shots.delete(e); }
    return src;
  }
  // every world one-shot still sounding or still to start; a crash or Sound off cuts them for good, as the film
  // cuts a sound that runs into a silence window and never brings it back (score2.js:678-690, piano :697-711)
  const shots = new Set();
  function cutShots(t, at) {
    for (const e of shots) {
      if (e.end <= t) continue;
      const G = e.g.gain; G.cancelScheduledValues(t); G.setValueAtTime(G.value, t); G.linearRampToValueAtTime(0, at);   // g also feeds the reverb send
      try { e.src.stop(at + .005); } catch (x) { /* already stopped */ }
    }
    shots.clear(); pen = { from: -1, end: -1, gate: 0 };
    if (scr.g) loopLevel(scr.g, false);   // the loop no longer waits under a cut pencil one-shot
  }
  // a piano note as score2.js:697-711 plays it: vel * MIX.bed, pan by pitch, its own send
  function piano(t, m, vel, bright, send, until) {
    fire([...REC.piano(m, bright).slice(0, 2), send], vel * MIX.bed, t, { pan: clamp((m - 62) / 50, -.5, .5), until });
  }

  /**
   * Play one effect now (GAME_SPEC §8 "Event -> sound" table). No-op while sound is off.
   * @param {string} type  a TYPES key (unknown names are ignored)
   * @param {object=} opts  e.g. {open: true} (drawer), {dur: .58} (print, keys, pencil), {note: 0|1} (chime),
   *   {kind: 'laptop'|'agent'} (keys), {k: variant}, {dir: -1|1} (whoosh), {gate} (pencil), {space} (key)
   */
  function play(type, opts = {}) {
    if (!on || !ac || !TYPES[type] || ac.currentTime < silentUntil) return;   // nothing starts inside a crash's silence (score2.js:682)
    const o = opts || {}, k = Number.isInteger(o.k) && o.k >= 0 ? o.k : nth(type);
    switch (type) {
      case 'click': case 'swipe': case 'paper': case 'tick': case 'readTick': case 'slip': return void fire(REC[type](k));
      case 'key': return void fire(REC.key(k, !!o.space));
      case 'keys': { const kind = o.kind === 'laptop' || o.kind === 'screen' ? o.kind : 'agent'; return void fire(REC.keys(o.dur, kind, k % 5), kind === 'screen' ? .8 : 1); }
      case 'print': return void fire(REC.print(o.dur));
      case 'whoosh': return void fire(REC.whoosh(o.dir === -1 ? -1 : 1));
      case 'drawer': return void fire(REC.drawer(o.open !== false));
      case 'chime': return void fire(REC.chime((o.note ?? k) % 2 ? 1 : 0));
      case 'pencil': { const gate = clamp(+(o.gate ?? 1) || 1, .1, 1); return void pencilShot(REC.pencil(o.dur, gate, k % 3), gate, 0); }
      case 'done':   // score2.js:874-876: the tick, then a small "done" A5-C6
        fire(REC.tick(k)); piano(.06, 81, .2, .5, .25); piano(.22, 84, .22, .5, .25); return;
      case 'sour':   // score2.js:905-910: the ceramic, a sour C5 + Db5, a sigh Bb4 -> A4
        fire(REC.crack()); piano(.03, 72, .26, .35, .3); piano(.05, 73, .24, .35, .3);
        piano(.75, 70, .24, .35, .25, 1.8); piano(1.2, 69, .22, .35, .25, 2.6); return;
      default: return void fire(REC[type]());   // screen box dive nod stamp lock ding question
    }
  }

  // a one-shot pencil scratch; while it sounds, the scratch loop (a lower gate: captions, ink) is held silent,
  // as the film's max-gate merge of overlapping scratch intervals keeps only the louder one (score2.js:977)
  let pen = { from: -1, end: -1, gate: 0 };
  function pencilShot(rec, gate, delay) {
    const b = buf(rec), t0 = ac.currentTime + delay, t1 = t0 + b.duration - .2, live = pen.end > ac.currentTime;   // .2 = scratchBuf tail
    pen = { from: live ? Math.min(pen.from, t0) : t0, end: Math.max(live ? pen.end : -1, t1), gate: live ? Math.max(pen.gate, gate) : gate };
    fire(rec, MIX.scratch, delay);
    if (scr.g) loopLevel(scr.g, false);
  }
  // (re)schedule the scratch loop's level from now: MIX.scratch, or 0 under a pencil one-shot of a gate >= its own
  function loopLevel(g, start) {
    const G = g.gain, t = ac.currentTime, up = MIX.scratch, v = start ? 0 : G.value;
    G.cancelScheduledValues(t); G.setValueAtTime(v, t);
    if (pen.gate >= scr.gate && pen.end > t) {
      const a = Math.max(t, pen.from);
      if (a > t + .012) { if (start) G.linearRampToValueAtTime(up, t + .012); G.setValueAtTime(start ? up : v, a); }
      G.linearRampToValueAtTime(0, a + .03); G.setValueAtTime(0, pen.end); G.linearRampToValueAtTime(up, pen.end + .15);
    } else G.linearRampToValueAtTime(up, t + .012);
  }

  // one key per typed letter (the name and reason fields): play('key') with the space variant
  function typeKey(ch) { play('key', { space: ch === ' ' }); }

  /**
   * Replay one of a film act's own cues (SCENES[i].cues, {t, type, dur?}) as live sounds. runtime.js
   * calls it for film-window beats as the act's tau crosses cue.t. The film's cue names are not play()
   * types; this maps them (sound.md §3):
   *   boot -> screen; click -> click (k = nth % 4); paper -> swipe in a1/a2, else paper (k = nth % 3);
   *   pencil -> the act's stage.scratch() interval that holds the cue (merged with the ones touching it, max
   *   gate; score2.js:964-965 skips the cue itself then), else {dur: .9, gate: 1}; tick -> done in a1/a2, else tick; type -> keys {dur, kind:
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
      case 'pencil': {   // the film plays the stage's own pencil interval here, not the cue's .9 s (score2.js:964-965)
        if (ac.currentTime < silentUntil) return;
        const p = pencilSpan(act, cue.t); return void pencilShot(REC.pencil(p.dur, p.gate, ACT_K[actKey] ?? 0), p.gate, p.delay);
      }
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

  // the hum envelope: up over .35 s, down over .15 s, or .006 s at a spark (score2.js:955-958)
  function humTo(onOff, dur) {
    if (!ac) return;
    const t = ac.currentTime, g = humEnv.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(onOff ? 1 : 0, t + dur);
    trace('hum', onOff ? 'on' : 'off', t);
  }

  /** The spark: world to 0 over 8 ms, the spark (unducked) at now + .008, hum off in .006 s; world held
   *  silent until spark + .22 + .5 s, then back over .3 s. runtime.js calls it AT the spark (ROOM.CRASH_T
   *  .spark after the plug click, on the game clock), not at the click: play at once, schedule no offset. */
  function crash() {
    humWant = false;
    if (!ac) return;
    humTo(false, .006);
    if (!on) return;
    const t = ac.currentTime, s = t + .008, g = world.gain;
    silentUntil = s + SPARK_LEN + .5;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, s);
    g.setValueAtTime(0, silentUntil); g.linearRampToValueAtTime(1, silentUntil + .3);
    cutShots(t, s);   // a chime, the ding or a pencil one-shot does not come back in the dark
    fire(REC.spark(), 1, .008, { bus: sparkBus });
  }
  /** Power back: lampOn({flash: [[0, 1/12]], lit: 3/12}) + wake(.25, 5/12) + hum on, all now. runtime.js
   *  calls it when the push lands (ROOM.CRASH_T.power after the unplug click), not at the click. */
  function power() {
    humWant = true;
    if (!ac) return;
    if (!on) { humTo(true, .35); return; }
    const t = ac.currentTime;
    if (t < silentUntil + .3) {   // plugged back in before the silence ended: the power brings the room back now
      const g = world.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1, t + .02); silentUntil = -1;
    }
    fire(REC.lampOn()); fire(REC.wake()); humTo(true, .35);
  }
  /** The room hum (live oscillators, score2.js:949-958), ramped on/off. @param {boolean} onOff */
  function hum(onOff) { humWant = !!onOff; if (!ac) return; humTo(humWant, humWant ? .35 : .15); }

  // the scratch loop: a pre-rendered LOOP-second scratch per gate, gated by a GainNode (sound.md §6)
  function startLoop() {
    const rec = REC.loop(scr.gate); if (!has(ac, rec[0])) { warm([rec]); return; }
    const src = ac.createBufferSource(), g = ac.createGain(), s = ac.createGain(), b = buf(rec), t = ac.currentTime;
    src.buffer = b; src.loop = true; loopLevel(g, true);
    s.gain.value = .05; src.connect(g); g.connect(world); g.connect(s); s.connect(conv);
    src.start(t, rng(Math.floor(t * 1000))() * LOOP);   // a fresh place in the loop each time
    scr.node = src; scr.g = g; trace('loop', rec[0], t);
  }
  function stopLoop(rel = .04) {
    if (!scr.node) return;
    const t = ac.currentTime, src = scr.node, g = scr.g; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + rel);
    src.stop(t + rel + .01); scr.node = scr.g = null; trace('loopStop', '', t);
  }
  /** The pencil scratch while a pencil is on the paper: gate 1 drawing, .45 on ones, .35 captions.
   *  @param {boolean} onOff @param {number=} gate */
  function scratch(onOff, gate = 1) {
    const gt = Math.round(clamp(+gate || 1, .1, 1) * 100) / 100;
    if (onOff && scr.want && scr.gate === gt && scr.node) return;
    scr.want = !!onOff; if (!ac || !on) return;
    stopLoop(); scr.gate = gt;
    if (scr.want) startLoop();
  }
  /** For tests: 'none' before enable() ever ran, else the AudioContext state. */
  const state = () => (ac ? ac.state : 'none');
  /** Tests only (tests/web/dev/sfx.html): run the engine on a given (Offline)AudioContext, all buffers built now. */
  function __useContext(ctx) {
    warmQ = []; silentUntil = -1; pen = { from: -1, end: -1, gate: 0 }; shots.clear(); scr = { want: false, gate: 1, node: null, g: null };
    for (const k in count) delete count[k];   // each render starts from a clean engine, whatever ran before
    build(ctx); for (const r of WARM()) if (r[0] !== '@conv') buf(r); conv.buffer = buf(IR); on = true;
  }
  /** Tests only: fn(what, key, at) is told about every sound the engine starts ('fire' with the buffer's cache key,
   *  'loop' / 'loopStop' for the scratch loop, 'hum' with 'on' / 'off'); null removes it. */
  function __trace(fn) { tracer = typeof fn === 'function' ? fn : null; }
  return { TYPES, enable, disable, visibility, play, keyStroke: typeKey, filmCue, crash, power, hum, scratch, state, __useContext, __trace, get enabled() { return on; } };
})();
