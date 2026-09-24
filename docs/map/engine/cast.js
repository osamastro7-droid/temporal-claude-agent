// Copied from temporal-film (cast.js), unmodified.
'use strict';
// ============================================================
// The cast: objects, not people. Each function returns a raw drawing
// {strokes:[...]} in local coordinates, authored as whole drawings with
// semantic stroke ids (outer contours first, lighter inner lines after).
// Compile with compile(raw, id) once; draw with pencilMarks at a progress.
// ============================================================

// ---------- MacBook, front view, a little from above ----------
// origin = centre of the display area. dw x dh is the display.
function macDrawing(dw = 640, dh = 400, o = {}) {
  const S_ = [], bz = 20, top = 22, chin = 30, r = 22;
  const lx = -dw / 2 - bz, ly = -dh / 2 - top, lw = dw + bz * 2, lh = dh + top + chin;
  S_.push(loopStroke('lid', rrectPts(lx, ly, lw, lh, r, 6), { width: 3.6, start: 2, over: 20 }));
  S_.push(loopStroke('display', rrectPts(-dw / 2, -dh / 2, dw, dh, 5, 3), { width: 1.8, opacity: .8, pressure: PRESS.inner, start: 1, over: 10 }));
  S_.push(stroke('camera', ellPoints(0, ly + top / 2, 2.6, 2.6, 0, TAU, 10), { width: 1.4, opacity: .7 }));
  // hinge and keyboard deck: a foreshortened trapezoid with a front lip
  const y0 = ly + lh, d = 44, fx = lw / 2 + 58;
  S_.push(stroke('hinge', bow([lx + 12, y0 + 3], [lx + lw - 12, y0 + 3], 1, 4), { width: 1.6, opacity: .6, pressure: PRESS.inner }));
  S_.push(stroke('deck', [[lx - 4, y0], [-fx, y0 + d], [-fx + 6, y0 + d + 12], [fx - 6, y0 + d + 12], [fx, y0 + d], [lx + lw + 4, y0]], { width: 3.4, corner: .5 }));
  S_.push(stroke('deck/front', bow([-fx + 2, y0 + d], [fx - 2, y0 + d], 1.2, 7), { width: 2.2, opacity: .85, pressure: PRESS.inner }));
  S_.push(stroke('deck/scoop', ellPoints(0, y0 + d, 46, 6, 0, Math.PI, 12), { width: 1.4, opacity: .7, pressure: PRESS.inner }));
  if (o.port) S_.push(stroke('port', [[fx - 20, y0 + d + 4], [fx - 2, y0 + d + 4]], { width: 2, opacity: .7 }));
  // keyboard: three foreshortened rows of key tops, then the trackpad
  const kb = (t, s) => [lerp(lx + 30, -fx + 40, t) * s, y0 + d * t];
  for (let row = 0; row < 3; row++) {
    const t = .16 + row * .17, xl = lerp(lx + 34, -fx + 64, t), xr = -xl, n = 13 - (row === 2 ? 2 : 0);
    const pts = []; for (let k = 0; k < n; k++) { const a = lerp(xl, xr, k / n) + 4, b = lerp(xl, xr, (k + 1) / n) - 4; pts.push([a, y0 + d * t], [b, y0 + d * t]); }
    for (let k = 0; k < n; k++) S_.push(stroke(`key/${row}/${k}`, [pts[k * 2], pts[k * 2 + 1]], { width: 1.5, opacity: .55, pressure: PRESS.inner }));
  }
  S_.push(stroke('trackpad', [[-96, y0 + d * .72], [96, y0 + d * .72], [110, y0 + d - 4], [-110, y0 + d - 4], [-96, y0 + d * .72]], { width: 1.4, opacity: .6, corner: .4, pressure: PRESS.inner }));
  return { strokes: S_, lid: [lx, ly, lw, lh], deckY: y0, deckFront: y0 + d + 12, deckHalf: fx };
}

// A window on the Mac's display: title bar with the three dots, optional title.
function windowDrawing(x, y, w, h, o = {}) {
  const S_ = [];
  S_.push(loopStroke('win', rrectPts(x, y, w, h, 12, 3), { width: 2.2, opacity: .85, start: 1, over: 12 }));
  S_.push(stroke('win/bar', bow([x + 4, y + (o.bar ?? 46)], [x + w - 4, y + (o.bar ?? 46)], 1, 2), { width: 1.5, opacity: .7, pressure: PRESS.inner }));
  for (let k = 0; k < 3; k++) S_.push(stroke('win/dot/' + k, ellPoints(x + 22 + k * 20, y + (o.bar ?? 46) / 2, 5.5, 5.5, 0, TAU, 12), { width: 1.5, opacity: .75 }));
  return { strokes: S_ };
}

// ---------- chat bubbles with scrawled (not legible) words ----------
// A line of handwriting that is not meant to be read: loops and humps.
function scrawl(id, x, y, w, h = 16, seed = 1, o = {}) {
  const r = rng(seed), out = [], so = { width: o.width ?? 2, opacity: o.opacity ?? .8, pressure: PRESS.inner, corner: 1.2 };
  let pts = [], px = x, word = 0;
  while (px < x + w) {
    const step = 7 + r() * 9, up = r() < .7;
    pts.push([px, y - (up ? h * (.5 + r() * .5) : h * .15)]); px += step * .5;
    pts.push([px, y + h * .08]); px += step * .5;
    if (r() < .12 && px < x + w - 30 && pts.length > 3) { out.push(stroke(`${id}/p${word++}`, pts, so)); pts = []; px += 16; }
  }
  if (pts.length > 1) out.push(stroke(`${id}/p${word++}`, pts, so));
  return out;
}
function bubble(id, x, y, w, h, tail = 'left', lines = 2, seed = 3) {
  const S_ = [loopStroke(id, rrectPts(x, y, w, h, 16, 3), { width: 2, opacity: .85, start: 1, over: 10 })];
  const tx = tail === 'left' ? x + 26 : x + w - 26, ty = y + h;
  S_.push(stroke(id + '/tail', [[tx - 10, ty - 1], [tx + (tail === 'left' ? -14 : 14), ty + 16], [tx + 12, ty - 1]], { width: 1.8, opacity: .8, corner: .6 }));
  for (let k = 0; k < lines; k++) S_.push(...scrawl(`${id}/w${k}`, x + 20, y + 32 + k * 28, (w - 40) * (k === lines - 1 ? .62 : 1), 14, seed + k));
  return S_;
}

// ---------- receipt: "Refund / 49.99 EUR" ----------
// origin top-left. Zig-zag torn bottom edge. text colour follows the drawing colour.
function receiptDrawing(o = {}) {
  const w = o.w ?? 420, h = o.h ?? 400, S_ = [];
  const zig = []; const n = 12; for (let k = 0; k <= n; k++) zig.push([w - k * w / n, h + (k % 2 ? -12 : 0)]);
  S_.push(stroke('receipt/edge', [[0, h], [0, 0], [w, 0], [w, h], ...zig.slice(1)], { width: 3.2, corner: .5 }));
  S_.push(...dashes('receipt/rule1', [26, 72], [w - 26, 72]));
  const t1 = textStrokes('Refund', w / 2, 160, { cap: 46, align: 'center', condense: .86, id: 'receipt/t1', seed: o.seed ?? 21 });
  const t2 = textStrokes('49.99 EUR', w / 2, 250, { cap: 46, align: 'center', condense: .78, id: 'receipt/t2', seed: (o.seed ?? 21) + 5 });
  S_.push(...t1.strokes, ...t2.strokes);
  S_.push(...dashes('receipt/rule2', [26, 296], [w - 26, 296]));
  S_.push(...scrawl('receipt/fine', 40, 336, w * .55, 11, (o.seed ?? 21) + 9, { width: 1.5, opacity: .55 }));
  return { strokes: S_, w, h };
}
// a dashed rule: one short stroke per dash
function dashes(id, a, b, dash = 14, gap = 10, o = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), out = [], n = Math.floor(L / (dash + gap));
  for (let k = 0; k < n; k++) { const t0 = k * (dash + gap) / L, t1 = (k * (dash + gap) + dash) / L;
    out.push(stroke(`${id}/${k}`, [[lerp(a[0], b[0], t0), lerp(a[1], b[1], t0)], [lerp(a[0], b[0], t1), lerp(a[1], b[1], t1)]], { width: o.width ?? 1.6, opacity: o.opacity ?? .55, pressure: PRESS.inner })); }
  return out;
}

// ---------- wall socket (side view), plug and cable ----------
// origin = centre of the socket face (where the plug meets it). The wall is to the right.
function socketDrawing() {
  const S_ = [];
  S_.push(stroke('wall', bow([34, -120], [34, 120], 1.5, 9), { width: 3.4 }));
  S_.push(loopStroke('socket', rrectPts(0, -54, 34, 108, 8, 2), { width: 3, start: 1, over: 8 }));
  S_.push(stroke('socket/face', [[6, -34], [6, 34]], { width: 1.5, opacity: .6, pressure: PRESS.inner }));
  // hatched shadow under the socket on the wall
  for (let k = 0; k < 6; k++) S_.push(stroke('socket/shadow/' + k, [[10 + k * 4, 58 + k * 2], [30, 62 + k * 7]], { width: 1.3, opacity: .45, pressure: PRESS.inner }));
  return { strokes: S_ };
}
// plug body with the cable end at its left; prongs point right into the socket
const PLUG_OUTLINE = [[-6, -30], [-120, -30], [-132, -18], [-150, -9], [-150, 9], [-132, 18], [-120, 30], [-6, 30], [0, 22], [0, -22]];
function plugFillPath() { return polyPath(PLUG_OUTLINE); }
function plugDrawing() {
  const S_ = [];
  S_.push(loopStroke('plug', PLUG_OUTLINE, { width: 3.4, start: 0, corner: .5, over: 10 }));
  for (let k = 0; k < 3; k++) S_.push(stroke('plug/grip/' + k, bow([-96 + k * 16, -24], [-96 + k * 16, 24], 1, 3 + k), { width: 1.4, opacity: .6, pressure: PRESS.inner }));
  S_.push(stroke('plug/ring', bow([-30, -30], [-30, 30], 1, 11), { width: 1.4, opacity: .55, pressure: PRESS.inner }));
  return { strokes: S_ };
}
function prongsDrawing() {
  return { strokes: [
    loopStroke('prong/a', [[0, -20], [40, -20], [44, -16], [40, -12], [0, -12]], { width: 2.2, corner: .5, over: 4 }),
    loopStroke('prong/b', [[0, 12], [40, 12], [44, 16], [40, 20], [0, 20]], { width: 2.2, corner: .5, over: 4 }),
  ] };
}
// the cable from the laptop's right side to the plug's tail, as one curve
function cableDrawing(a, b, sag = 60, ctrl = null) {
  const [m1, m2] = ctrl ?? [[a[0] + (b[0] - a[0]) * .1, a[1] + sag * 1.4], [b[0] - Math.max(60, Math.abs(b[0] - a[0]) * .45), b[1] + 4]];
  const pts = []; for (let k = 0; k <= 16; k++) pts.push(bez(a, m1, m2, b, k / 16));
  return { strokes: [stroke('cable', pts, { width: 3.2 }), stroke('cable/2', offsetPts(pts.slice(1, -1), 0, 5), { width: 1.4, opacity: .45, pressure: PRESS.inner })] };
}

// ---------- the hand that pulls the plug ----------
// origin = centre of the plug body it grips (plug body spans -150..0 in plug space,
// so pass the plug origin + [-75, 0]). Fist around the plug, wrist down-right to a cuff.
function handDrawing(pose = 'grip') {
  const S_ = [], open = pose === 'reach';
  const knuckles = open
    ? [[-66, -40], [-60, -62], [-48, -70], [-38, -64], [-30, -74], [-18, -76], [-8, -70], [2, -76], [14, -74], [22, -66], [30, -70], [40, -62], [46, -48]]
    : [[-62, -38], [-58, -54], [-48, -60], [-40, -56], [-32, -63], [-22, -65], [-13, -60], [-5, -65], [6, -64], [14, -58], [22, -61], [32, -55], [38, -42]];
  const fist = [
    [-26, 118], [-40, 76], [-58, 46], [-70, 18], [-72, -10], ...knuckles,
    [44, -24], [46, -2], [42, 18], [36, 34], [44, 62], [58, 92], [74, 118],
  ];
  S_.push(stroke('hand/outline', fist, { width: 3.4, corner: 1.1 }));
  // finger divisions and the curled fingertips on the near face of the plug
  const fx = open ? [-36, -6, 22] : [-36, -9, 18];
  fx.forEach((x, k) => S_.push(stroke('hand/finger/' + k, [[x - 2, open ? -66 : -58], [x - 4, -34], [x - 1, -8]], { width: 1.8, opacity: .75, pressure: PRESS.inner })));
  if (!open) for (let k = 0; k < 4; k++) { const x0 = -64 + k * 27; S_.push(stroke('hand/tip/' + k, [[x0, -6], [x0 + 6, 2], [x0 + 18, 3], [x0 + 24, -4]], { width: 1.9, opacity: .8, pressure: PRESS.inner })); }
  // thumb across the lower half of the plug, pointing left
  S_.push(stroke('hand/thumb', open
    ? [[20, 46], [-8, 34], [-40, 26], [-66, 26], [-80, 36], [-70, 48], [-40, 50], [-8, 58], [14, 70]]
    : [[22, 40], [-6, 26], [-36, 18], [-60, 16], [-74, 24], [-66, 38], [-38, 42], [-8, 50], [16, 64]], { width: 3, corner: 1.1 }));
  S_.push(stroke('hand/nail', open ? [[-62, 30], [-72, 34], [-66, 42]] : [[-58, 20], [-68, 24], [-62, 32]], { width: 1.4, opacity: .7, pressure: PRESS.inner }));
  // cuff and sleeve
  S_.push(stroke('hand/cuff', [[-34, 112], [-40, 130], [84, 130], [80, 112]], { width: 3, corner: .6 }));
  S_.push(stroke('hand/sleeve', [[-40, 130], [-56, 260]], { width: 3.2 }));
  S_.push(stroke('hand/sleeve2', [[84, 130], [108, 260]], { width: 3.2 }));
  for (let k = 0; k < 5; k++) S_.push(stroke('hand/sleeve/hatch/' + k, [[70 + k * 3, 148 + k * 20], [90 + k * 3, 160 + k * 20]], { width: 1.2, opacity: .4, pressure: PRESS.inner }));
  return { strokes: S_ };
}
// paper-coloured fill under the hand so it covers what it holds
function handFillPath(pose = 'grip') {
  const d = handDrawing(pose), o = d.strokes[0].points, p = new Path2D();
  o.forEach((q, i) => i ? p.lineTo(...q) : p.moveTo(...q)); p.lineTo(84, 130); p.lineTo(108, 262); p.lineTo(-56, 262); p.lineTo(-40, 130); p.closePath();
  return p;
}

// ---------- Temporal's notebook: spiral top, one page ----------
// origin top-left of the page. All in indigo when drawn.
function notebookDrawing(w = 700, h = 700) {
  const S_ = [];
  S_.push(stroke('nb/back', [[w + 4, 30], [w + 12, 40], [w + 12, h + 10], [24, h + 10], [12, h + 2]], { width: 2.2, opacity: .7, corner: .6 }));
  S_.push(loopStroke('nb/page', rrectPts(0, 0, w, h, 10, 3), { width: 3.4, start: 1, over: 18 }));
  const n = 16; for (let k = 0; k < n; k++) { const x = 40 + k * (w - 80) / (n - 1); S_.push(stroke('nb/ring/' + k, [[x - 5, 16], [x - 7, -4], [x, -14], [x + 7, -6], [x + 5, 14]], { width: 2, opacity: .85, corner: 1.2 })); }
  for (let k = 0; k < n; k++) { const x = 40 + k * (w - 80) / (n - 1); S_.push(stroke('nb/hole/' + k, ellPoints(x, 20, 4, 3, 0, TAU, 8), { width: 1.2, opacity: .6, pressure: PRESS.inner })); }
  S_.push(stroke('nb/margin', bow([56, 40], [56, h - 20], 1, 13), { width: 1.3, opacity: .45, pressure: PRESS.inner }));
  for (let k = 0; k < 6; k++) { const y = 196 + k * 84; S_.push(stroke('nb/rule/' + k, bow([20, y], [w - 20, y], 1, 20 + k), { width: 1.1, opacity: .32, pressure: PRESS.inner })); }
  return { strokes: S_, w, h, rowY: k => 184 + k * 84 };
}
// a check mark (✓) as one stroke, bottom-left origin
function checkStroke(id, x, y, s = 1, o = {}) {
  return stroke(id, [[x, y - 18 * s], [x + 12 * s, y], [x + 40 * s, y - 42 * s]], { width: o.width ?? 4, corner: .5, pressure: [[0, .5], [.3, 1], [1, .35]], ...(o.color ? { color: o.color } : {}) });
}

// ---------- the Claude engine: a closed box with a lock and a mail slot ----------
// origin = centre of the front face. Hatching only here (and in shadows).
function boxDrawing(fw = 250, fh = 140, dx = 64, dy = -46) {
  const S_ = [], x0 = -fw / 2, y0 = -fh / 2, x1 = fw / 2, y1 = fh / 2;
  S_.push(loopStroke('box/front', [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { width: 3.6, corner: .5, start: 0, over: 16 }));
  S_.push(stroke('box/top', [[x0, y0], [x0 + dx, y0 + dy], [x1 + dx, y0 + dy], [x1, y0]], { width: 3.4, corner: .5 }));
  S_.push(stroke('box/side', [[x1 + dx, y0 + dy], [x1 + dx, y1 + dy], [x1, y1]], { width: 3.4, corner: .5 }));
  // mail slot on the top face, parallel to the front edge
  const sx0 = x0 + fw * .28 + dx * .5, sx1 = x1 - fw * .28 + dx * .5, sy = y0 + dy * .5;
  S_.push(loopStroke('box/slot', [[sx0, sy - 4], [sx1, sy - 4], [sx1 + 3, sy + 4], [sx0 + 3, sy + 4]], { width: 2.4, corner: .5, over: 6 }));
  // padlock on the front face
  S_.push(stroke('lock/shackle', [[-17, -6], [-17, -24], [-10, -36], [0, -39], [10, -36], [17, -24], [17, -6]], { width: 3.2, corner: 1.3 }));
  S_.push(loopStroke('lock/body', rrectPts(-26, -8, 52, 44, 7, 2), { width: 3.4, start: 1, over: 8 }));
  S_.push(stroke('lock/key', [...ellPoints(0, 8, 5, 5, -Math.PI * .6, Math.PI * 1.6, 10), [3, 12], [3, 24], [-3, 24], [-3, 12]], { width: 1.8, corner: .6 }));
  // hatching: the side face (denser) and the top face (lighter), following the planes
  for (let k = 1; k < 13; k++) { const t = k / 13; S_.push(stroke('box/hatch/side/' + k, [[x1 + dx * t + 3, y0 + dy * t + 8], [x1 + dx * t + 3, y1 + dy * t - 6]], { width: 1.4, opacity: .5, pressure: PRESS.inner })); }
  for (let k = 1; k < 9; k++) { const t = k / 9; S_.push(stroke('box/hatch/top/' + k, [[lerp(x0, x1, t) + dx * .15, y0 + dy * .15], [lerp(x0, x1, t) + dx * .85 - 10, y0 + dy * .85]], { width: 1.1, opacity: .32, pressure: PRESS.inner })); }
  // shadow under the box
  for (let k = 0; k < 10; k++) { const x = x0 + 20 + k * (fw + dx - 30) / 10; S_.push(stroke('box/shadow/' + k, [[x, y1 + 8], [x + 16, y1 + 4]], { width: 1.2, opacity: .38, pressure: PRESS.inner })); }
  return { strokes: S_, slot: [(sx0 + sx1) / 2, sy], fw, fh, dx, dy };
}

// ---------- paper slip (a tool call), text centred ----------
function slipDrawing(text, o = {}) {
  const cap = o.cap ?? 36, cd = o.condense ?? .82, tw_ = measure(text, cap, 0, cd), w = o.w ?? Math.round(tw_ + 64), h = o.h ?? 88;
  const S_ = [loopStroke('slip', [[-w / 2, -h / 2], [w / 2 - 16, -h / 2], [w / 2, -h / 2 + 14], [w / 2, h / 2], [-w / 2, h / 2]], { width: 2.8, corner: .5, over: 12 })];
  S_.push(stroke('slip/fold', [[w / 2 - 16, -h / 2], [w / 2 - 14, -h / 2 + 12], [w / 2, -h / 2 + 14]], { width: 1.4, opacity: .6, corner: .5, pressure: PRESS.inner }));
  S_.push(...textStrokes(text, 0, 12, { cap, align: 'center', condense: cd, id: 'slip/t', seed: o.seed ?? 31 }).strokes);
  return { strokes: S_, w, h };
}

// ---------- rubber stamp (manager approval) and its impression ----------
const STAMP_HALF = 172;   // half-width of the rubber face (matches the Approved impression)
function stampDrawing() {
  const S_ = [];
  S_.push(stroke('stamp/knob', [...ellPoints(0, -150, 30, 26, Math.PI * .75, Math.PI * 2.25, 18)], { width: 3.2 }));
  S_.push(stroke('stamp/neck', [[-12, -126], [-16, -80], [16, -80], [12, -126]], { width: 3, corner: .6 }));
  S_.push(loopStroke('stamp/block', rrectPts(-STAMP_HALF - 8, -80, STAMP_HALF * 2 + 16, 54, 6, 2), { width: 3.4, start: 1, over: 10 }));
  S_.push(stroke('stamp/rubber', [[-STAMP_HALF, -26], [-STAMP_HALF, -6], [STAMP_HALF, -6], [STAMP_HALF, -26]], { width: 2.6, corner: .6 }));
  return { strokes: S_ };
}
function approvedDrawing() {
  const t = textStrokes('Approved', 0, 12, { cap: 38, align: 'center', condense: .9, id: 'appr/t', seed: 41, width: 4, jitter: .6 });
  const w = t.width + 48;
  return { strokes: [loopStroke('appr/box', rrectPts(-w / 2, -46, w, 92, 8, 2), { width: 3.4, start: 1, over: 6 }), ...t.strokes], w };
}

// ---------- coins (the bank), envelope (email), clock (waiting) ----------
function coinsDrawing(n = 6, rx = 70, ry = 20, step = 13) {
  const S_ = [];
  for (let k = n - 1; k >= 1; k--) S_.push(stroke('coin/edge/' + k, ellPoints(0, k * step, rx, ry, 0, Math.PI, 18), { width: 2.8 }));
  S_.push(stroke('coin/sideL', [[-rx, 0], [-rx, (n - 1) * step]], { width: 2.8 }));
  S_.push(stroke('coin/sideR', [[rx, 0], [rx, (n - 1) * step]], { width: 2.8 }));
  S_.push(loopStroke('coin/top', ellPoints(0, 0, rx, ry, 0, TAU, 28).slice(0, -1), { width: 3.2, corner: 2, over: 8 }));
  S_.push(stroke('coin/rim', ellPoints(0, 0, rx - 12, ry - 4, 0, TAU, 24), { width: 1.4, opacity: .55, pressure: PRESS.inner }));
  S_.push(...textStrokes('€', -12, 12, { cap: 30, id: 'coin/eur', seed: 5, width: 2.4 }).strokes.map(s => ({ ...s, points: s.points.map(([x, y]) => [x, y * .5 - 4]) })));
  for (let k = 0; k < 7; k++) S_.push(stroke('coin/shadow/' + k, [[rx + 6 + k * 3, (n - 1) * step + 10 - k * 4], [rx + 16 + k * 3, (n - 1) * step + 16 - k * 4]], { width: 1.2, opacity: .4, pressure: PRESS.inner }));
  return { strokes: S_ };
}
function coinDrawing(id = 'c') {
  return { strokes: [loopStroke(id + '/o', ellPoints(0, 0, 30, 30, 0, TAU, 20).slice(0, -1), { width: 2.6, corner: 2, over: 6 }), stroke(id + '/in', ellPoints(0, 0, 21, 21, 0, TAU, 16), { width: 1.2, opacity: .5, pressure: PRESS.inner })] };
}
function envelopeDrawing(w = 150, h = 100) {
  return { strokes: [
    loopStroke('env', [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], { width: 3, corner: .5, over: 10 }),
    stroke('env/flap', [[-w / 2 + 3, -h / 2 + 3], [0, 6], [w / 2 - 3, -h / 2 + 3]], { width: 2.2, corner: .5 }),
    stroke('env/l', [[-w / 2 + 4, h / 2 - 4], [-18, -4]], { width: 1.3, opacity: .55, pressure: PRESS.inner }),
    stroke('env/r', [[w / 2 - 4, h / 2 - 4], [18, -4]], { width: 1.3, opacity: .55, pressure: PRESS.inner }),
  ] };
}
function clockDrawing(r = 34) {
  return { strokes: [loopStroke('clock', ellPoints(0, 0, r, r, -Math.PI / 2, Math.PI * 1.5, 24).slice(0, -1), { width: 2.8, corner: 2, over: 8 }),
    ...[0, 1, 2, 3].map(k => { const a = k * Math.PI / 2; return stroke('clock/tick/' + k, [[Math.cos(a) * r * .78, Math.sin(a) * r * .78], [Math.cos(a) * r * .9, Math.sin(a) * r * .9]], { width: 1.8, opacity: .7 }); })] };
}

// ---------- big question mark (drawn, not typed) ----------
function questionDrawing(s = 1) {
  const pts = [[-70, -96], [-58, -150], [-10, -178], [44, -170], [74, -130], [66, -84], [28, -52], [2, -24], [0, 22]].map(([x, y]) => [x * s, y * s]);
  return { strokes: [stroke('q/curve', pts, { width: 9 * s, corner: 2, pressure: [[0, .5], [.1, 1], [.85, .9], [1, .5]] }), stroke('q/dot', ellPoints(0, 70 * s, 5 * s, 5 * s, 0, TAU, 10), { width: 9 * s, pressure: PRESS.flat })] };
}
