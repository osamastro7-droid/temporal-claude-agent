// Copied from temporal-film (kit.js), with patches for the live game (docs/map). Search for "GAME PATCH".
// PATCHES (everything else is byte-identical to temporal-film/kit.js):
//   1. The format is always setFormat({ar:'16:9', width:1920}) at load: the `?w=` / `?ar=` read
//      (kit.js:13) is removed. game/runtime.js later calls setFormat only to change S.
//   2. pencilMarks keeps a pixel-identical stroke cache (from the stroke-cache prototype, bench8):
//      the finished Path2D buckets of a completed cel (progress >= 1) are built once per
//      (cel, widthScale) and replayed; colour, alpha and soft are applied at stroke time; progress < 1
//      takes the original code path (_pencilMarksLive). LRU limit PENCIL_CACHE_SAMPLES (400k samples).
//   3. drawLogo('temporal') caches its finished mask canvas by (size, S, res, colour) once the reveal
//      is complete (u >= .85, where the mask stops changing; the film made a new canvas per call).
//      A reveal in progress reuses one scratch mask canvas (resized, which clears it) instead of a new
//      canvas per frame, so the canvas count stays flat while a logo draws on.
//   4. glowBehind multiplies its blur by S (canvas blur is in device pixels), and where the canvas
//      has no `filter` (Safari / iOS) it blurs by drawing the layer into a small canvas and scaling
//      it back up with smoothing.
'use strict';
// ============================================================
// Film kit for "The refund that can't happen twice".
// Load after core.js, studio.js, cels.js, materials.js, font-emstech.js, logos.js.
//
// Everything here is a pure function of its inputs: a drawing is authored once,
// compiled once (stable semantic stroke ids, stable seeds) and then drawn up to a
// progress value. Holding a drawing holds its marks. No frame number reaches a seed.
// ============================================================

// The film is 16:9. Set the format before any drawing is authored, so centred
// layouts built at load time use the right frame.
// GAME PATCH 1: always 16:9 at width 1920 here; no query string is read (was kit.js:13).
setFormat({ ar: '16:9', width: 1920 });

// ---------- colour as meaning (the whole film keeps these) ----------
const COL = {
  paper: '#f3eee2',
  graphite: '#2f2b27',   // everything by default
  indigo: '#2c3ea6',     // Temporal's notebook and anything written in it
  red: '#c3321d',        // the crash and anything wrong
  green: '#23874a',      // done once
  shadow: '#6e675d',     // hatched shadows
};
const colorOf = k => COL[k] || k;

// Frame layout (16:9, logical 1920 x 1080). Captions live in the top band;
// drawings keep below CAPTION_FLOOR so text always has a quiet field around it.
// EMS Tech's real capitals are 1.354 x the nominal cap (H = 677 of 500 units): nominal 46 draws
// 62 px capitals. Baselines leave ~20 px between line 1's descenders and line 2's ascenders.
const CAPTION = { cap: 46, lines: [132, 250], one: 176, width: 3.2 };
const CAP_REAL = 677 / 500;   // real capital height per nominal cap unit
const CAPTION_FLOOR = 290;

// ---------- small authoring helpers ----------
// A stroke is {id, points, width, opacity, pressure, color, corner}. Widths are visual px.
const PRESS = {
  contour: [[0, .25], [.08, .95], [.5, 1], [.9, .85], [1, .2]],   // confident outer line, open ends
  inner:   [[0, .2], [.15, .8], [.6, .7], [1, .15]],              // lighter inner detail
  letter:  [[0, .55], [.12, 1], [.88, .95], [1, .5]],             // legible lettering
  flat:    [[0, 1], [1, 1]],
};
// Uniform Catmull-Rom (the cels.js smoother) overshoots when a short segment sits next to
// a long one. Authored points are therefore pre-smoothed with the centripetal form
// (alpha 0.5: no cusps, no overshoot), keeping turns sharper than `corner` as corners.
function smoothCentripetal(pts, corner = Math.PI, step = 6) {
  const n = pts.length; if (n < 3) return densify(pts, step);
  const sharp = pts.map((b, i) => { if (i === 0 || i === n - 1) return true; const a = pts[i - 1], d = pts[i + 1];
    let t = Math.abs(Math.atan2(d[1] - b[1], d[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])); if (t > Math.PI) t = TAU - t; return t > corner; });
  const out = [pts[0].slice()];
  for (let i = 0; i < n - 1; i++) {
    const p1 = pts[i], p2 = pts[i + 1], L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); if (L < 1e-6) continue;
    const p0 = sharp[i] ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] : pts[i - 1], p3 = sharp[i + 1] ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] : pts[i + 2];
    const tj = (a, b) => Math.pow(Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1])), .5);
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3), m = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= m; k++) {
      const t = t1 + (t2 - t1) * k / m, P = (a, b, ta, tb) => [(tb - t) / (tb - ta) * a[0] + (t - ta) / (tb - ta) * b[0], (tb - t) / (tb - ta) * a[1] + (t - ta) / (tb - ta) * b[1]];
      const A1 = P(p0, p1, t0, t1), A2 = P(p1, p2, t1, t2), A3 = P(p2, p3, t2, t3), B1 = P(A1, A2, t0, t2), B2 = P(A2, A3, t1, t3);
      out.push(P(B1, B2, t1, t2));
    }
  }
  return out;
}
function densify(pts, step = 12) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]); }
  return out;
}
function stroke(id, points, o = {}) {
  if (o.dense !== false && points.length > 1) points = smoothCentripetal(points, o.corner ?? Math.PI, o.step ?? 6);
  return { id, points, width: o.width ?? 3.2, opacity: o.opacity ?? 1, pressure: o.pressure ?? PRESS.contour,
    ...(o.color ? { color: o.color } : {}), ...(o.corner !== undefined ? { corner: o.corner } : {}), ...(o.close ? { close: true } : {}) };
}
// Points of a rounded rectangle, clockwise from the top-left straight edge.
function rrectPts(x, y, w, h, r, n = 5) {
  const p = [], arc = (cx, cy, a0) => { for (let k = 0; k <= n; k++) { const a = a0 + k / n * Math.PI / 2; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  arc(x + w - r, y + r, -Math.PI / 2); arc(x + w - r, y + h - r, 0); arc(x + r, y + h - r, Math.PI / 2); arc(x + r, y + r, Math.PI);
  return p;
}
// A closed shape drawn the way a hand draws it: one gesture that starts on an edge,
// goes round and overshoots its own start a little, leaving an open end.
function loopStroke(id, pts, o = {}) {
  const k = o.start ?? 0, n = pts.length, ring = [...pts.slice(k), ...pts.slice(0, k)];
  const a = ring[0], b = ring[1 % n], over = o.over ?? 14, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const tail = [a[0] + (b[0] - a[0]) / L * Math.min(over, L * .8), a[1] + (b[1] - a[1]) / L * Math.min(over, L * .8)];
  const lead = o.lead ?? 0; // start a touch before the corner so the joint does not show
  const head = lead ? [[a[0] - (b[0] - a[0]) / L * lead, a[1] - (b[1] - a[1]) / L * lead]] : [];
  return stroke(id, [...head, ...ring, a, tail], { corner: o.corner ?? .7, ...o });
}
function ellPoints(cx, cy, rx, ry, a0 = 0, a1 = TAU, n = 40, rot = 0) {
  const p = []; for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; p.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); }
  return p;
}
// a long straight edge is never quite straight: bow it a little
function bow(a, b, amt = 1.5, seed = 1, n = 6) {
  const p = []; for (let k = 0; k <= n; k++) { const t = k / n, s = Math.sin(t * Math.PI) * amt * (hash(seed, 3) > .5 ? 1 : -1), dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    p.push([a[0] + dx * t - dy / L * s, a[1] + dy * t + dx / L * s]); }
  return p;
}
const offsetPts = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
const scalePts = (pts, s, ox = 0, oy = 0) => pts.map(([x, y]) => [ox + x * s, oy + y * s]);

// ---------- compiling and drawing marks ----------
// compile() wraps cels.js compileCel and adds per-stroke lengths for write-on plans.
const _compiled = new Map();
function compile(raw, id) {
  if (_compiled.has(id)) return _compiled.get(id);
  const cel = compileCel(raw, { id });
  let total = 0;
  for (const s of cel.strokes) {
    let L = 0; for (let i = 1; i < s.samples.length; i++) L += Math.hypot(s.samples[i].p[0] - s.samples[i - 1].p[0], s.samples[i].p[1] - s.samples[i - 1].p[1]);
    s.len = Math.max(L, .5); total += s.len;
  }
  // bounds for caches and hit boxes
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of cel.strokes) for (const q of s.samples) { x0 = Math.min(x0, q.p[0]); y0 = Math.min(y0, q.p[1]); x1 = Math.max(x1, q.p[0]); y1 = Math.max(y1, q.p[1]); }
  cel.bounds = [x0, y0, x1 - x0, y1 - y0];
  cel.plan = makePlan(cel);
  _compiled.set(id, cel);
  return cel;
}
// A write-on plan: strokes in authored order, with pen lifts between them. The lift
// costs time in proportion to the jump, so the pencil does not teleport.
function makePlan(cel, lift = .35) {
  const seg = []; let t = 0;
  cel.strokes.forEach((s, k) => {
    if (k) { const a = cel.strokes[k - 1].samples.at(-1).p, b = s.samples[0].p, d = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push({ lift: true, a, b, t0: t, t1: t + d * lift + 2 }); t += d * lift + 2; }
    seg.push({ k, t0: t, t1: t + s.len }); t += s.len;
  });
  return { seg, total: t };
}
// where the pencil is at plan progress u (0..1), and how much of each stroke is down
function planAt(cel, u) {
  const P = cel.plan, t = clamp(u, 0, 1) * P.total;
  let tip = cel.strokes[0].samples[0].p, lifted = false, stroke = -1, frac = 0;
  for (const g of P.seg) {
    if (t < g.t0) break;
    if (g.lift) { const f = clamp((t - g.t0) / (g.t1 - g.t0), 0, 1); tip = [lerp(g.a[0], g.b[0], f), lerp(g.a[1], g.b[1], f)]; lifted = f < 1; }
    else { stroke = g.k; frac = clamp((t - g.t0) / (g.t1 - g.t0), 0, 1); const s = cel.strokes[g.k]; tip = sampleAt(s, frac).p; lifted = false; }
  }
  return { tip, lifted, stroke, frac };
}
function sampleAt(s, f) { const n = s.samples.length - 1, x = clamp(f, 0, 1) * n, i = Math.min(n - 1, Math.floor(x)), t = x - i, a = s.samples[i], b = s.samples[i + 1]; return { p: [lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t)] }; }

// Graphite and coloured pencil: narrow interrupted passes, bucketed so a frame
// with many drawings stays fast. Same visual rules as cels.js drawCel: pressure
// shapes width, low pressure opens small gaps, a lighter second pass shares the gesture.
// GAME PATCH 2: the stroke cache. A finished cel's marks depend only on (cel, widthScale): the
// passes, tooth gaps, drift and bucket widths are all seeded from the stroke, never from the frame.
// So their Path2D buckets are built once and replayed; colour, alpha and soft are applied at stroke
// time with the same expressions (and evaluation order) as _pencilMarksLive below, so the pixels are
// identical. Entries are evicted least recently used beyond PENCIL_CACHE_SAMPLES samples.
const PENCIL_CACHE_SAMPLES = 400000;
const _marks = new Map();   // cel -> { byW: Map(widthScale -> geometry), n: samples }, in LRU order (oldest first)
let _marksN = 0;
function _marksBuild(cel, wk) {
  return cel.strokes.map(s => {
    const W = s.width * wk, m = Math.max(1, s.samples.length - 1), buckets = new Map();
    for (let pass = 0; pass < 3; pass++) {
      const spread = (pass - 1) * W * .2;
      for (let i = 1; i <= m; i++) {
        const a = s.samples[i - 1], b = s.samples[i], tooth = hash(i * 3 + pass, s.seed), r = Math.min(1, (a.w + b.w) / 2 / s.width);
        if (tooth < .05 + .12 * (1 - r)) continue;
        const wl = Math.min(3, Math.floor(r * 4)), al = Math.min(2, Math.floor(tooth * 3));
        const key = pass * 100 + wl * 10 + al; let B = buckets.get(key);
        if (!B) { B = { lw: Math.max(.35, W * (.3 + .17 * wl) * (pass === 1 ? 1 : .72)), pf: pass === 1 ? .62 : .38, af: .62 + al * .19, path: new Path2D() }; buckets.set(key, B); }
        const dA = (noise1(a.u * 5 + pass * 11, s.seed) * .18 * W / 3 + spread) * Math.sin(Math.PI * a.u);
        const dB = (noise1(b.u * 5 + pass * 11, s.seed) * .18 * W / 3 + spread) * Math.sin(Math.PI * b.u);
        B.path.moveTo(a.p[0] - a.tangent[1] * dA, a.p[1] + a.tangent[0] * dA);
        B.path.lineTo(b.p[0] - b.tangent[1] * dB, b.p[1] + b.tangent[0] * dB);
      }
    }
    const dot = s.len < W * 2.6 ? { q: s.samples[Math.floor(s.samples.length / 2)].p, r: W * 1.3 } : null;
    return { s, buckets: [...buckets.values()], dot };
  });
}
function _marksGet(cel, wk) {
  let e = _marks.get(cel);
  if (e) { _marks.delete(cel); _marks.set(cel, e); } else { e = { byW: new Map(), n: 0 }; _marks.set(cel, e); }
  let G = e.byW.get(wk);
  if (!G) {
    G = _marksBuild(cel, wk); e.byW.set(wk, G);
    let n = 0; for (const s of cel.strokes) n += s.samples.length; e.n += n; _marksN += n;
    for (const [k, v] of _marks) { if (_marksN <= PENCIL_CACHE_SAMPLES || k === cel) break; _marks.delete(k); _marksN -= v.n; }
  }
  return G;
}
function pencilMarks(c, cel, o = {}) {
  const u = o.progress ?? 1; if (u < 1) return _pencilMarksLive(c, cel, o);
  const alphaAll = (o.alpha ?? 1) * c.globalAlpha; if (alphaAll <= 0) return null;
  const wk = o.widthScale ?? 1, soft = o.soft ?? 0, base = colorOf(o.color ?? 'graphite'), G = _marksGet(cel, wk);
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  for (const g of G) {
    const s = g.s, col = colorOf(s.color ?? base), op = (s.opacity ?? 1) * alphaAll;
    c.strokeStyle = col;
    for (const B of g.buckets) { c.lineWidth = B.lw; c.globalAlpha = op * B.pf * B.af * (1 - soft * .4); c.stroke(B.path); }
    if (g.dot) { c.globalAlpha = op * .95; c.fillStyle = col; c.beginPath(); c.arc(g.dot.q[0], g.dot.q[1], g.dot.r, 0, TAU); c.fill(); }
  }
  c.restore();
  return null;
}
// The film's pencilMarks, unchanged: used while a cel is being written on (progress < 1).
function _pencilMarksLive(c, cel, o = {}) {
  const u = o.progress ?? 1; if (u <= 0) return null;
  const at = u >= 1 ? { stroke: cel.strokes.length - 1, frac: 1 } : planAt(cel, u);
  const base = colorOf(o.color ?? 'graphite'), alphaAll = (o.alpha ?? 1) * c.globalAlpha, wk = o.widthScale ?? 1, soft = o.soft ?? 0;
  if (alphaAll <= 0) return null;
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  const nk = u >= 1 ? cel.strokes.length : at.stroke + 1;
  for (let k = 0; k < nk; k++) {
    const s = cel.strokes[k], frac = (u >= 1 || k < at.stroke) ? 1 : at.frac; if (frac <= 0) continue;
    const m = Math.max(1, Math.round(frac * (s.samples.length - 1)));
    const col = colorOf(s.color ?? base), W = s.width * wk, op = (s.opacity ?? 1) * alphaAll;
    const buckets = new Map();
    for (let pass = 0; pass < 3; pass++) {
      const spread = (pass - 1) * W * .2;
      for (let i = 1; i <= m; i++) {
        const a = s.samples[i - 1], b = s.samples[i], tooth = hash(i * 3 + pass, s.seed), r = Math.min(1, (a.w + b.w) / 2 / s.width);
        if (tooth < .05 + .12 * (1 - r)) continue;
        const wl = Math.min(3, Math.floor(r * 4)), al = Math.min(2, Math.floor(tooth * 3));
        const key = pass * 100 + wl * 10 + al; let B = buckets.get(key);
        if (!B) { B = { pass, wl, al, path: new Path2D() }; buckets.set(key, B); }
        const dA = (noise1(a.u * 5 + pass * 11, s.seed) * .18 * W / 3 + spread) * Math.sin(Math.PI * a.u);
        const dB = (noise1(b.u * 5 + pass * 11, s.seed) * .18 * W / 3 + spread) * Math.sin(Math.PI * b.u);
        B.path.moveTo(a.p[0] - a.tangent[1] * dA, a.p[1] + a.tangent[0] * dA);
        B.path.lineTo(b.p[0] - b.tangent[1] * dB, b.p[1] + b.tangent[0] * dB);
      }
    }
    c.strokeStyle = col;
    for (const B of buckets.values()) {
      c.lineWidth = Math.max(.35, W * (.3 + .17 * B.wl) * (B.pass === 1 ? 1 : .72));
      c.globalAlpha = op * (B.pass === 1 ? .62 : .38) * (.62 + B.al * .19) * (1 - soft * .4);
      c.stroke(B.path);
    }
    // a very short mark (a full stop, a dot on an i) would vanish: give it a small deposit
    if (s.len < W * 2.6 && frac >= 1) { c.globalAlpha = op * .95; c.fillStyle = col; const q = s.samples[Math.floor(s.samples.length / 2)].p; c.beginPath(); c.arc(q[0], q[1], W * 1.3, 0, TAU); c.fill(); }
  }
  c.restore();
  return at.tip ?? null;
}

// ---------- lettering (EMS Tech single-line, drawn stroke by stroke) ----------
function glyphOf(ch) { return FONT_EMS_TECH.glyphs[ch] || FONT_EMS_TECH.glyphs['?']; }
// a full stop inside a number ("49.99", "28.9M") gets extra room before the next digit, so the
// point survives being scaled down to a phone screen
const dotGap = (str, i) => str[i] === '.' && /[0-9]/.test(str[i + 1] ?? '') && /[0-9]/.test(str[i - 1] ?? '') ? 110 : 0;
function measure(str, cap, tracking = 0, condense = 1) {
  const k = cap / FONT_EMS_TECH.cap, chars = [...str]; let w = 0; chars.forEach((ch, i) => { w += (glyphOf(ch).a + dotGap(chars, i) + tracking * 1000) * k * condense; }); return w - tracking * 1000 * k * condense;
}
// Returns raw strokes for a line of text with its left end at x and baseline at y.
// Small, seeded hand irregularities per glyph keep it drawn rather than typeset.
// colors: {wordIndex: colorKey} tints whole words (used for "once" in green).
function textStrokes(str, x, y, o = {}) {
  const cap = o.cap ?? CAPTION.cap, cd = o.condense ?? 1, k = cap / FONT_EMS_TECH.cap, kx = k * cd, tr = (o.tracking ?? 0) * 1000 * kx, seed = o.seed ?? 7, W = o.width ?? cap * .064;
  const align = o.align ?? 'left', total = measure(str, cap, o.tracking ?? 0, cd);
  let px = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const out = []; let word = 0, i = 0; const chars = [...str];
  for (const ch of chars) {
    if (ch === ' ') word++;
    const g = glyphOf(ch), jit = o.jitter ?? 1;
    const dy = (hash(i, seed) - .5) * cap * .05 * jit, rot = (hash(i, seed + 1) - .5) * .045 * jit, sc = 1 + (hash(i, seed + 2) - .5) * .05 * jit;
    const cx = px + g.a * kx / 2, cy = y - cap / 2;
    g.s.forEach((pl, j) => {
      const pts = pl.map(([gx, gy]) => { let X = px + gx * kx, Y = y + gy * k + dy; const ddx = (X - cx) * sc, ddy = (Y - cy) * sc; return [cx + ddx * Math.cos(rot) - ddy * Math.sin(rot), cy + ddx * Math.sin(rot) + ddy * Math.cos(rot)]; });
      const col = o.colors && o.colors[word];
      out.push(stroke(`${o.id ?? 'txt'}/${i}/${j}`, pts, { width: W, pressure: PRESS.letter, corner: .9, ...(col ? { color: col } : {}) }));
    });
    px += (g.a + dotGap(chars, i)) * kx + tr; i++;
  }
  return { strokes: out, width: total, left: align === 'center' ? x - total / 2 : align === 'right' ? x - total : x };
}
function textCel(id, lines, o = {}) {
  // lines: [{text, x, y, cap, align, colors}] -> one compiled cel, written in order
  const strokes = [];
  lines.forEach((L, n) => strokes.push(...textStrokes(L.text, L.x, L.y, { ...o, ...L, id: `${id}/l${n}`, seed: (o.seed ?? 3) + n * 17 }).strokes));
  return compile({ strokes }, id);
}

// ---------- paper: one quiet texture that belongs to the sheet ----------
let _paperLayer = null, _paperS = 0;
const PAPER_PAD = 260;
function paperTexture() {
  if (_paperLayer && _paperS === S) return _paperLayer;
  const w = W + PAPER_PAD * 2, h = H + PAPER_PAD * 2, L = document.createElement('canvas');
  L.width = Math.round(w * S); L.height = Math.round(h * S); const g = L.getContext('2d'); g.setTransform(S, 0, 0, S, 0, 0);
  g.fillStyle = COL.paper; g.fillRect(0, 0, w, h);
  const r = rng(911);
  for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h, R = 80 + r() * 260, dark = r() < .55; const gr = g.createRadialGradient(x, y, 0, x, y, R);
    const c0 = dark ? 'rgba(120,100,70,' : 'rgba(255,255,250,', a0 = dark ? .016 : .05;
    gr.addColorStop(0, c0 + a0 + ')'); gr.addColorStop(.45, c0 + (a0 * .6).toFixed(4) + ')'); gr.addColorStop(1, c0 + '0)'); g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2); }
  g.fillStyle = '#5a4e3c';
  for (let i = 0; i < 16000; i++) { g.globalAlpha = .02 + r() * .045; const s = .5 + r() * 1.3; g.fillRect(r() * w, r() * h, s, s * (.5 + r())); }
  g.strokeStyle = '#6b5f4b'; g.lineWidth = .5;
  for (let i = 0; i < 260; i++) { g.globalAlpha = .025 + r() * .04; const x = r() * w, y = r() * h, a = r() * TAU, l = 6 + r() * 26; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + .6) * l * .5, y + Math.sin(a + .6) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  g.globalAlpha = 1; _paperLayer = L; _paperS = S; return L;
}
// Paper is drawn in world space so a camera push-in moves the sheet with the drawing.
function paperSheet(c) {
  const L = paperTexture(); c.save(); c.fillStyle = COL.paper; resetT(c); c.fillRect(0, 0, W, H); c.restore();
  c.drawImage(L, -PAPER_PAD, -PAPER_PAD, W + PAPER_PAD * 2, H + PAPER_PAD * 2);
}
// soft vignette on the screen (lighting, not texture), very light
function vignette(c) {
  resetT(c); const g = c.createRadialGradient(CX, CY * .95, H * .35, CX, CY, H * 1.05);
  g.addColorStop(0, 'rgba(60,45,25,0)'); g.addColorStop(1, 'rgba(60,45,25,0.10)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
}

// ---------- the pencil that draws things into existence ----------
// Tip at (0,0); the body lies along +x, rotated by `ang` (the hand is off to the lower right).
const PENCIL = (() => {
  const L = 470, w = 30, cone = 58, lead = 13;
  const body = [[cone, -w / 2], [L, -w / 2], [L, w / 2], [cone, w / 2]];
  return { L, w, cone, lead, body };
})();
function drawPencilTool(c, tip, o = {}) {
  if (!tip) return;
  const col = colorOf(o.color ?? 'graphite'), lift = o.lift ?? 0, ang = o.angle ?? .66;
  const { L, w, cone, lead } = PENCIL;
  c.save();
  // shadow on the paper: lower right of the pencil, further away when lifted
  c.save(); c.translate(tip[0] + 10 + lift * 16, tip[1] + 12 + lift * 20); c.rotate(ang);
  c.fillStyle = 'rgba(70,58,40,0.13)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(cone, -w / 2 + 2); c.lineTo(L, -w / 2 + 2); c.lineTo(L, w / 2 - 2); c.lineTo(cone, w / 2 - 2); c.closePath(); c.fill(); c.restore();
  c.translate(tip[0] - lift * 6, tip[1] - lift * 9); c.rotate(ang);
  const bodyTint = col === COL.graphite ? '#f6f1e6' : mix(col, '#f6f1e6', .78);
  // wood cone and lead
  c.fillStyle = '#efe2c8'; c.beginPath(); c.moveTo(lead * .9, -2.6); c.lineTo(cone, -w / 2); c.lineTo(cone, w / 2); c.lineTo(lead * .9, 2.6); c.closePath(); c.fill();
  c.fillStyle = col; c.beginPath(); c.moveTo(0, 0); c.lineTo(lead + 1, -3.4); c.lineTo(lead + 1, 3.4); c.closePath(); c.fill();
  // body
  c.fillStyle = bodyTint; c.fillRect(cone, -w / 2, L - cone, w);
  c.fillStyle = 'rgba(0,0,0,0.05)'; c.fillRect(cone, w / 6, L - cone, w / 3);
  // ferrule
  c.fillStyle = '#d9d3c7'; c.fillRect(L - 34, -w / 2 - 1, 34, w + 2);
  c.strokeStyle = COL.graphite; c.lineCap = 'round';
  const line = (pts, lw, al) => { c.lineWidth = lw; c.globalAlpha = al; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.stroke(); };
  line([[lead * .9, -2.6], [cone, -w / 2], [L, -w / 2]], 2.4, .85);
  line([[lead * .9, 2.6], [cone, w / 2], [L, w / 2]], 2.4, .85);
  line([[cone + 4, -w / 6], [L - 36, -w / 6]], 1.1, .45); line([[cone + 4, w / 6], [L - 36, w / 6]], 1.1, .45);
  line([[cone, -w / 2], [cone - 5, -w / 6], [cone, w / 6 - 2], [cone - 4, w / 2]], 1.4, .6);   // scalloped paint edge
  for (let k = 0; k < 4; k++) line([[L - 30 + k * 8, -w / 2 - 1], [L - 30 + k * 8, w / 2 + 1]], 1, .45);
  line([[L - 34, -w / 2 - 1], [L - 34, w / 2 + 1]], 1.6, .7);
  // coloured lead gets a coloured band so the colour reads even when small
  if (col !== COL.graphite) { c.globalAlpha = .9; c.fillStyle = col; c.fillRect(L - 60, -w / 2, 14, w); }
  c.restore();
}

// ---------- logos, drawn by hand from their real outlines ----------
const _logos = {};
function logoPrep(name) {
  if (_logos[name]) return _logos[name];
  const D = LOGO_DATA[name]; if (!D) throw new Error('No logo ' + name);
  const parts = D.parts.map(p => {
    const path = new Path2D(); for (const s of p.subs) { s.forEach((q, i) => i ? path.lineTo(q[0], q[1]) : path.moveTo(q[0], q[1])); path.closePath(); }
    const [r, g, b] = parseColor(p.fill); const lum = (.3 * r + .59 * g + .11 * b) / 255;
    return { path, subs: p.subs, rule: p.rule === 'evenodd' ? 'evenodd' : 'nonzero', tone: 1 - lum };
  });
  return (_logos[name] = { D, parts });
}
// Outline strokes of a logo at a given pixel size, in the logo's local frame (centre 0,0).
function logoOutline(name, size, o = {}) {
  const P = logoPrep(name), strokes = [];
  P.parts.forEach((p, i) => p.subs.forEach((s, j) => {
    if (s.length < 3) return;
    const pts = s.map(([x, y]) => [x * size, y * size]);
    strokes.push(stroke(`logo/${name}/${i}/${j}`, [...pts, pts[0], pts[1] ?? pts[0]], { width: o.width ?? Math.max(1.4, size * .018), pressure: PRESS.inner, corner: .5 }));
  }));
  return compile({ strokes }, `logo/${name}@${size}/${o.width ?? ''}`);
}
// Shading inside the real shape: parallel pencil hatching at the part's tone,
// laid down with a diagonal sweep so it looks filled in by hand.
function logoFill(c, name, size, u, o = {}) {
  if (u <= 0) return; const P = logoPrep(name), col = colorOf(o.color ?? 'graphite'), inherited = c.globalAlpha;
  c.save(); c.scale(size, size);
  const sweep = new Path2D(); const x = lerp(-.9, .9, u); sweep.moveTo(-1, -1); sweep.lineTo(x + .35, -1); sweep.lineTo(x - .35, 1); sweep.lineTo(-1, 1); sweep.closePath();
  c.clip(sweep);
  for (const p of P.parts) {
    const A = (o.alpha ?? 1) * inherited;
    if (o.knockout !== false) { c.fillStyle = COL.paper; c.globalAlpha = A; c.fill(p.path, p.rule); }
    const tone = o.tone ?? p.tone; if (tone < .08) continue;
    c.save(); c.clip(p.path, p.rule);
    c.globalAlpha = A * (.22 + .72 * tone); c.fillStyle = col; c.fill(p.path, p.rule);
    c.globalAlpha = A * .35 * tone; c.strokeStyle = col; c.lineWidth = 1.6 / size;
    c.beginPath(); const gap = (o.gap ?? 4) / size; for (let t = -1.2; t < 1.2; t += gap) { c.moveTo(t - .6, -.7); c.lineTo(t + .6, .7); } c.stroke();
    c.restore();
  }
  c.restore();
}
// drawLogo: outline first (the pencil traces it), then the fill. u = 0..1. Returns the pencil tip.
const _logoMasks = new Map();   // GAME PATCH 3: finished Temporal masks by (size, S, res, colour), at most 24
let _logoScratch = null;        // GAME PATCH 3: the one mask canvas for reveals in progress (setting its width clears it)
function drawLogo(c, name, x, y, size, u, o = {}) {
  if (u <= 0) return null;
  c.save(); c.translate(x, y);
  let tip = null;
  if (name === 'temporal') {
    // the mark is a thin band: reveal the real shape along its two loops
    const cel = temporalLoops(size); const f = clamp(u / .85, 0, 1);
    const at = f >= 1 ? null : planAt(cel, f);
    // mask = a thick stroke along the drawn part of the centrelines; the real shape shows through it
    // GAME PATCH 3: a finished reveal (at === null) reuses its mask; the mask depends only on these inputs
    const mkey = `${size}|${S}|${o.res ?? 1}|${colorOf(o.color ?? 'indigo')}`, cached = at ? null : _logoMasks.get(mkey);
    const mask = cached ?? (at ? (_logoScratch ??= document.createElement('canvas')) : document.createElement('canvas')); const px = Math.ceil(size * 1.3 * S * (o.res ?? 1)) + 4;
    if (!cached) { mask.width = mask.height = px;
    const g = mask.getContext('2d'); const sc = px / (size * 1.3); g.setTransform(sc, 0, 0, sc, px / 2, px / 2);
    g.lineWidth = size * .17; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#000'; g.beginPath();
    cel.strokes.forEach((s, k) => { const frac = !at || k < at.stroke ? 1 : k === at.stroke ? at.frac : 0; if (frac <= 0) return; const m = Math.round(frac * (s.samples.length - 1)); s.samples.slice(0, m + 1).forEach((q, i) => i ? g.lineTo(q.p[0], q.p[1]) : g.moveTo(q.p[0], q.p[1])); });
    g.stroke(); g.globalCompositeOperation = 'source-in';
    g.save(); g.scale(size, size); const P = logoPrep('temporal');
    g.fillStyle = colorOf(o.color ?? 'indigo'); g.globalAlpha = .92; for (const p of P.parts) g.fill(p.path, p.rule);
    g.restore();
    // pencil texture over the fill
    g.globalCompositeOperation = 'destination-out'; const r = rng(77); g.fillStyle = '#000';
    for (let i = 0; i < size * 5; i++) { g.globalAlpha = .12 + r() * .25; g.fillRect((r() - .5) * size * 1.3, (r() - .5) * size * 1.3, 1.2, 1.2); }
    if (!at) { _logoMasks.set(mkey, mask); if (_logoMasks.size > 24) _logoMasks.delete(_logoMasks.keys().next().value); } }
    c.drawImage(mask, -size * .65, -size * .65, size * 1.3, size * 1.3);
    tip = at ? at.tip : null;
    if (u > .85) { const fin = logoOutline('temporal', size, { width: Math.max(1, size * .012) }); pencilMarks(c, fin, { progress: (u - .85) / .15, color: o.color ?? 'indigo', alpha: .5 }); }
  } else if (name === 'claude') {
    const rays = claudeRays(size); const f = clamp(u / .8, 0, 1);
    tip = pencilMarks(c, rays, { progress: f, color: o.color ?? 'graphite', widthScale: 1 });
    if (u > .55) logoFill(c, 'claude', size, (u - .55) / .45, { color: o.color ?? 'graphite', tone: .8, knockout: false });
  } else {
    const out = logoOutline(name, size, o); const f = clamp(u / .62, 0, 1);
    if (u > .5) logoFill(c, name, size, (u - .5) / .5, { color: o.color ?? 'graphite', tone: o.tone, knockout: o.knockout });
    tip = pencilMarks(c, out, { progress: f, color: o.color ?? 'graphite' });
  }
  c.restore();
  return tip ? [tip[0] + x, tip[1] + y] : null;
}
// Temporal's mark is two crossed loops; these are their centrelines (from the official
// outline, in the same unit box) so the pencil can draw the mark the way it is built.
function temporalLoops(size) {
  const key = 'logo/temporal-loops@' + size; if (_compiled.has(key)) return _compiled.get(key);
  const v = [[0, -.47], [-.07, -.42], [-.12, -.3], [-.155, -.15], [-.162, 0], [-.155, .15], [-.12, .3], [-.07, .42], [0, .47], [.07, .42], [.12, .3], [.155, .15], [.162, 0], [.155, -.15], [.12, -.3], [.07, -.42], [0, -.47]];
  const h = v.map(([x, y]) => [-y, x]);
  const sc = p => p.map(([x, y]) => [x * size, y * size]);
  return compile({ strokes: [stroke('v', sc(v), { width: 2, corner: 2 }), stroke('h', sc([...h.slice(4), ...h.slice(1, 5)]), { width: 2, corner: 2 })] }, key);
}
// Claude's spark: one ray per point of the real outline, drawn from the centre out.
function claudeRays(size) {
  const key = 'logo/claude-rays@' + size; if (_compiled.has(key)) return _compiled.get(key);
  const pts = logoPrep('claude').D.parts[0].subs[0];
  let cx = 0, cy = 0; pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
  const R = pts.map(p => Math.hypot(p[0] - cx, p[1] - cy)), tips = [];
  for (let i = 0; i < pts.length; i++) { const a = R[(i - 2 + pts.length) % pts.length], b = R[(i - 1 + pts.length) % pts.length], m = R[i], d = R[(i + 1) % pts.length], e = R[(i + 2) % pts.length]; if (m > .3 && m >= b && m >= d && m >= a && m >= e) tips.push(pts[i]); }
  const dedup = []; for (const t of tips) if (!dedup.some(q => Math.hypot(q[0] - t[0], q[1] - t[1]) < .06)) dedup.push(t);
  dedup.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  const strokes = dedup.map((t, i) => stroke('ray/' + i, [[cx * size + (t[0] - cx) * size * .12, cy * size + (t[1] - cy) * size * .12], [t[0] * size, t[1] * size]], { width: Math.max(2.4, size * .05), pressure: [[0, .7], [.5, 1], [1, .45]] }));
  return compile({ strokes }, key);
}

// ---------- scene staging: items drawn on at scheduled times, one pencil ----------
// item: { id, t:[t0,t1], color, pencil (bool), ones (bool: text on ones; default twos),
//         render(c, u, o) -> tip in world coords, alpha(tau), at(tau) -> [dx,dy] }
const tw = tau => Math.floor(tau * 12 + 1e-6) / 12;   // objects on twos
// Long contour draw-ons run on ones at a steady hand speed (px of stroke per second), so the
// pencil never jumps hundreds of pixels between drawings. Use: t: [t0, t0 + drawTime(cel)], ones: true.
const DRAW_SPEED = 4200;
const drawTime = (cel, speed = DRAW_SPEED) => cel.plan.total / speed;
function progressOf(item, tau) {
  const [t0, t1] = item.t; const q = item.ones ? tau : Math.max(t0, tw(tau));
  return clamp((q - t0) / (t1 - t0), 0, 1);
}
// A cel placed at x,y (scaled by s) as a stage item
function celItem(id, cel, x, y, o = {}) {
  return { id, cel, x, y, s: o.s ?? 1, ...o,
    render(c, u, r = {}) {
      c.save(); c.translate(this.x + (r.dx ?? 0), this.y + (r.dy ?? 0)); if (this.s !== 1) c.scale(this.s, this.s); if (r.rot) c.rotate(r.rot);
      const tip = pencilMarks(c, this.cel, { progress: u, color: r.color ?? this.color, alpha: r.alpha ?? 1, widthScale: this.widthScale });
      c.restore();
      return tip ? [this.x + (r.dx ?? 0) + tip[0] * this.s, this.y + (r.dy ?? 0) + tip[1] * this.s] : null;
    } };
}
function logoItem(id, name, x, y, size, o = {}) {
  return { id, x, y, size, ...o, render(c, u, r = {}) { return drawLogo(c, name, this.x + (r.dx ?? 0), this.y + (r.dy ?? 0), this.size, u, { color: r.color ?? this.color, ...o }); } };
}
function makeStage(items) {
  const byId = Object.fromEntries(items.map(it => [it.id, it]));
  return {
    items, byId,
    // draw one item at its scheduled progress (or an override u)
    draw(c, tau, id, r = {}) {
      const it = byId[id]; if (!it) throw new Error('No stage item ' + id);
      const u = r.u ?? progressOf(it, tau); if (u <= 0) return null;
      const tip = it.render(c, u, r);
      if (it.pencil && u < 1 && tip) this._tips.set(id, tip);
      return tip;
    },
    _tips: new Map(),
    begin() { this._tips.clear(); },
    // The pencil: follows the item it is drawing; travels between items; enters and
    // leaves from the lower right. Draw it last, in world space.
    pencil(c, tau, o = {}) {
      const jobs = items.filter(it => it.pencil).sort((a, b) => a.t[0] - b.t[0]);
      if (!jobs.length) return;
      const home = o.home ?? [W + 260, H + 140];
      const qOf = j => j.ones ? tau : tw(tau), q = tw(tau);
      const active = jobs.filter(j => qOf(j) >= j.t[0] && qOf(j) < j.t[1]).pop();
      let tip = null, color = 'graphite', lift = 0;
      if (active) { tip = this._tips.get(active.id); color = active.color ?? 'graphite'; if (!tip) tip = progressOf(active, tau) >= 1 ? endTip(active) : startTip(active); }
      else {
        const prev = jobs.filter(j => j.t[1] <= qOf(j)).pop(), next = jobs.find(j => j.t[0] > qOf(j));
        const a = prev ? endTip(prev) : home, b = next ? startTip(next) : home;
        const t0 = prev ? prev.t[1] : (next.t[0] - .6), t1 = next ? next.t[0] : prev.t[1] + .7;
        let f;
        if (!prev) { f = sm(next.t[0] - (next.enter ?? .6), next.t[0], q, o.enterEase ?? easeOut); color = next.color; }   // enter
        else if (!next) { f = sm(prev.t[1], prev.t[1] + .7, q, easeIn); color = prev.color; }                     // leave
        else if (t1 - t0 > (o.rest ?? 2.2)) {                                   // long gap: rest off the sheet (colour changes there)
          const dd = Math.min(.6, (t1 - t0) / 2), di = Math.min(next.enter ?? .6, (t1 - t0) / 2), out = sm(t0, t0 + dd, q, easeIn), back = sm(t1 - di, t1, q, easeOut);
          if (q < t1 - di) { tip = [lerp(a[0], home[0], out), lerp(a[1], home[1], out)]; color = prev.color; }
          else { tip = [lerp(home[0], b[0], back), lerp(home[1], b[1], back)]; color = next.color; }
        } else { f = sm(t0, t1, q, easeIO); color = f < .5 ? prev.color : next.color; }   // a short move: the pencil changes at mid-air
        if (!tip) tip = [lerp(a[0], b[0], f), lerp(a[1], b[1], f) - Math.sin(Math.PI * f) * 40];
        lift = 1; color = color ?? 'graphite';
        if (!prev && q < next.t[0] - (next.enter ?? .6)) return; if (!next && q > prev.t[1] + .7) return;
      }
      drawPencilTool(c, tip, { color, lift, angle: o.angle ?? .62 });
      function startTip(j) { const t = j.render(scratchCtx(), 1e-4, {}) ; return t ?? [j.x ?? CX, j.y ?? CY]; }
      function endTip(j) { return j.endTip ?? (j.endTip = j.render(scratchCtx(), .9999, {}) ?? [j.x ?? CX, j.y ?? CY]); }
    },
    // intervals where the pencil is on the paper, for the score's pencil scratch
    scratch(offset = 0) { return items.filter(it => it.pencil || it.ones).map(it => [offset + it.t[0], offset + it.t[1], it.pencil ? 1 : .45]); },
  };
}
let _scratch = null;
function scratchCtx() { if (!_scratch) { const cv = document.createElement('canvas'); cv.width = cv.height = 4; _scratch = cv.getContext('2d'); } _scratch.setTransform(1, 0, 0, 1, 0, 0); return _scratch; }

// ---------- captions: handwritten, written on ones, held, then lifted off ----------
// spec: {lines:[text, text?], t0, hold (s, after fully written), speed (px of stroke per s), colors}
function makeCaption(id, spec) {
  const lines = spec.lines.length === 1 ? [{ text: spec.lines[0], x: CX, y: CAPTION.one, align: 'center', colors: spec.colors?.[0] }]
    : spec.lines.map((t, i) => ({ text: t, x: CX, y: CAPTION.lines[i], align: 'center', colors: spec.colors?.[i] }));
  const cel = textCel('cap/' + id, lines, { cap: spec.cap ?? CAPTION.cap, width: CAPTION.width, seed: spec.seed ?? 11 });
  const speed = spec.speed ?? 3600, write = clamp(cel.plan.total / speed, .7, 2.2);
  const t0 = spec.t0, written = t0 + write, out = spec.out ?? (written + spec.hold), fade = spec.fade ?? .3;
  const words = spec.lines.join(' ').trim().split(/\s+/).length;
  return { id, cel, t0, written, out, end: out + fade, words, text: spec.lines.join(' / '), need: Math.max(2.5, words / 3 + 1),
    draw(c, tau) {
      if (tau < t0 || tau >= out + fade) return;
      const u = clamp((tau - t0) / write, 0, 1), a = tau > out ? 1 - (tau - out) / fade : 1;
      resetT(c); pencilMarks(c, cel, { progress: u, color: spec.color ?? 'graphite', alpha: a });
    } };
}
// check a scene's captions against the text rule: fully written for >= max(2.5, words/3 + 1) s
function captionReport(caps, offset = 0, dur = Infinity) {
  return caps.map(k => { const out = Math.min(k.out, dur), held = out - k.written;
    return { id: k.id, text: k.text, start: +(offset + k.t0).toFixed(2), written: +(offset + k.written).toFixed(2), held: +held.toFixed(2), need: +k.need.toFixed(2), ok: held >= k.need - 1e-6 && k.end <= dur + 1e-6 }; });
}

// ---------- effects that tell the story ----------
let _fx = null, _fx2 = null;
function fxLayers() { if (!_fx || _fx.width !== OUT_W) { _fx = layer(); _fx2 = layer(); } return [_fx, _fx2]; }
// Graphite smudged by a thumb, then gone: drawFn draws in the current world transform.
function smudged(c, drawFn, amt, o = {}) {
  if (amt >= 1 && !o.residue) return;
  const [L] = fxLayers(), g = L.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, L.width, L.height);
  g.setTransform(c.getTransform()); drawFn(g);
  c.save(); resetT(c);
  const dir = o.dir ?? [1, .35], n = 7;
  for (let k = n; k >= 0; k--) {
    const f = k / n, d = amt * 60 * f;
    c.globalAlpha = k === 0 ? (1 - amt) * (1 - amt) : amt * (1 - amt) * .22 + amt * .045 * (1 - f * .5);
    c.filter = `blur(${(amt * 7 * (.4 + f)).toFixed(2)}px)`;
    c.drawImage(L, dir[0] * d, dir[1] * d, W, H);
  }
  c.filter = 'none'; c.restore();
}
// A red pencil scribble across a box: the machine is struck out. A fast hand goes back
// and forth on a slant with rounded turns, then crosses its own marks the other way.
function scribbleCel(id, box, o = {}) {
  const [x, y, w, h] = box, r = rng(o.seed ?? 5), n = o.n ?? 12, slant = o.slant ?? .22;
  const pass = (k0, dir, m, jit) => { const p = [];
    for (let i = 0; i <= m; i++) { const t = i / m, yy = y + h * (.06 + .88 * t) + (r() - .5) * h * .04, left = (i + k0) % 2 === 0;
      const xx = left ? x + w * (.03 + r() * jit) : x + w * (.97 - r() * jit); p.push([xx, yy + (left ? -1 : 1) * dir * slant * h / m * 2]); }
    return p; };
  const a = pass(0, 1, n, .1), b = pass(1, -1, Math.round(n * .6), .16).reverse();
  return compile({ strokes: [
    stroke(id + '/a', a, { width: o.width ?? 7, corner: 9, pressure: [[0, .5], [.04, 1], [.96, .95], [1, .4]] }),
    stroke(id + '/b', b, { width: (o.width ?? 7) * .8, corner: 9, pressure: [[0, .5], [.06, 1], [.94, .9], [1, .4]] }),
  ] }, id);
}
// Soft indigo glow behind lines (the notebook surviving). drawFn draws the lines in world space.
// GAME PATCH 4: the blur is in canvas pixels, so it is multiplied by S (at S = 1, the film's values).
// Without canvas filters (Safari / iOS store `filter` as a plain property and ignore it) the layer
// is drawn into a small canvas and scaled back up with smoothing: a soft glow instead of a hard copy.
const CANVAS_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const _glowSmall = [];
function softDraw(c, L, blurPx, k) {
  if (CANVAS_FILTER) { c.filter = `blur(${blurPx}px)`; c.drawImage(L, 0, 0, W, H); c.filter = 'none'; return; }
  const f = clamp(Math.round(blurPx * .8), 2, 64), w = Math.max(1, Math.round(L.width / f)), h = Math.max(1, Math.round(L.height / f));
  const sm = _glowSmall[k] ?? (_glowSmall[k] = document.createElement('canvas')); if (sm.width !== w || sm.height !== h) { sm.width = w; sm.height = h; }
  const x = sm.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(L, 0, 0, w, h);
  const was = c.imageSmoothingEnabled; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(sm, 0, 0, W, H); c.imageSmoothingEnabled = was;
}
function glowBehind(c, drawFn, g, o = {}) {
  if (g <= 0) return;
  const [, L] = fxLayers(), x = L.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, L.width, L.height);
  x.setTransform(c.getTransform()); drawFn(x);
  c.save(); resetT(c); c.globalAlpha = g * (o.strength ?? .85); softDraw(c, L, (o.blur ?? 9) * S, 0);
  c.globalAlpha = g * .5; softDraw(c, L, (o.blur ?? 9) * 2.6 * S, 1); c.filter = 'none'; c.restore();
}
// short emanata strokes around a box: a drawn glow
function emanataCel(id, box, o = {}) {
  const [x, y, w, h] = box, cx = x + w / 2, cy = y + h / 2, strokes = [], n = o.n ?? 14, r = rng(o.seed ?? 3);
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + r() * .2, ex = Math.cos(a), ey = Math.sin(a), rl = r();
    if (o.skip && o.skip(ex, ey)) continue;
    const R0 = Math.min(Math.abs((w / 2 + (o.pad ?? 26)) / (ex || 1e-6)), Math.abs((h / 2 + (o.pad ?? 26)) / (ey || 1e-6)));
    const L = (o.len ?? 34) * (.7 + rl * .6);
    strokes.push(stroke(id + '/' + i, [[cx + ex * R0, cy + ey * R0], [cx + ex * (R0 + L), cy + ey * (R0 + L)]], { width: o.width ?? 3.2, pressure: [[0, .4], [.4, 1], [1, .2]] }));
  }
  return compile({ strokes }, id);
}

// ---------- film-wide cue registry for the score ----------
const CUES = [];   // {t, type, gain?, ...} in film seconds, filled by scenes at load
function cue(t, type, extra = {}) { CUES.push({ t, type, ...extra }); }
