// Copied from temporal-film (agent.js), with one patch for the live game (docs/map):
//   1. faceRaw has a new face 'pause' (two short vertical bars on his screen, drawn like a8's pause
//      sign: scenes2/a8.js:73, same pressure curve, scaled to the visor). He shows it while Temporal
//      runs a tool for him (GAME_SPEC §1.2). This is the only drawing edit; every other face, pose
//      and stroke is byte-identical to the film's, so the film's frames still match.
'use strict';
// ============================================================
// The agent: a friendly pencil robot clerk who works behind the scenes.
// Front view only. Whole drawings are generated from pose keys; every drawing
// of the body shares one topology (same stroke ids and point counts), so keys
// and their assisted inbetweens are drawn with the same marks language.
// Expressions live on the face screen and are separate replacement drawings.
//
// Local frame: origin = the middle of the desk's top edge in front of him;
// he sits behind the desk (y < 0 is up). Neutral height ~450 px above the desk.
// ============================================================
const AGENT = (() => {
  const NECK = [0, -262];
  const N_ARM = 11;                        // centreline samples per arm (fixed topology)

  // ---- pose keys: head placement, lean, and each arm as shoulder -> elbow -> hand ----
  // hand: [x, y], elbow: [x, y], hr: mitten rotation (radians), open: 0 fist .. 1 open palm
  const KEYS = {
    rest:   { head: [0, -334], tilt: 0, lean: 0,   L: { e: [-128, -128], h: [-118, -20], hr: .2 },  R: { e: [128, -128], h: [118, -20], hr: -.2 } },
    typeA:  { head: [0, -330], tilt: .02, lean: 0, L: { e: [-122, -112], h: [-62, -34], hr: .9 },   R: { e: [122, -118], h: [66, -50], hr: -.9 } },
    typeB:  { head: [0, -330], tilt: -.02, lean: 0, L: { e: [-122, -118], h: [-66, -50], hr: .9 },  R: { e: [122, -112], h: [62, -34], hr: -.9 } },
    read:   { head: [0, -326], tilt: .04, lean: 0, L: { e: [-146, -178], h: [-104, -150], hr: 1.3 }, R: { e: [146, -178], h: [104, -150], hr: -1.3 } },
    book:   { head: [0, -330], tilt: 0, lean: 0,   L: { e: [-160, -168], h: [-150, -122], hr: 1.4 }, R: { e: [160, -168], h: [150, -122], hr: -1.4 } },
    point:  { head: [4, -334], tilt: -.05, lean: 0, L: { e: [-128, -128], h: [-118, -20], hr: .2 }, R: { e: [168, -210], h: [236, -286], hr: -2.3, point: 1 } },
    reach:  { head: [8, -332], tilt: -.04, lean: .02, L: { e: [-128, -128], h: [-118, -20], hr: .2 }, R: { e: [170, -150], h: [252, -120], hr: -1.9 } },
    chin:   { head: [-4, -330], tilt: .06, lean: 0, L: { e: [-128, -128], h: [-118, -20], hr: .2 }, R: { e: [120, -150], h: [44, -250], hr: -2.6 } },
    cheer:  { head: [0, -342], tilt: 0, lean: 0,   L: { e: [-150, -290], h: [-170, -392], hr: 2.9 }, R: { e: [150, -290], h: [170, -392], hr: -2.9 } },
    slump:  { head: [18, -294], tilt: .3, lean: .05, L: { e: [-126, -96], h: [-128, -8], hr: .1 },  R: { e: [136, -92], h: [142, -6], hr: -.1 } },
    wake:   { head: [6, -318], tilt: .12, lean: .02, L: { e: [-126, -110], h: [-122, -16], hr: .15 }, R: { e: [132, -110], h: [126, -14], hr: -.15 } },
  };

  // ---- geometry helpers ----
  const rot = (p, a, o = [0, 0]) => { const x = p[0] - o[0], y = p[1] - o[1]; return [o[0] + x * Math.cos(a) - y * Math.sin(a), o[1] + x * Math.sin(a) + y * Math.cos(a)]; };
  function headFrame(P) { return p => { const q = rot(p, P.tilt, [0, 0]); return [q[0] + P.head[0], q[1] + P.head[1]]; }; }   // head-local -> agent
  const HEAD = { w: 164, h: 128, r: 40 }, VISOR = { w: 128, h: 90, r: 26, y: 2 };
  // arm centreline: quadratic through shoulder, elbow, hand (passes the elbow at t = .5)
  function armLine(S, E, Hh) {
    const C = [2 * E[0] - (S[0] + Hh[0]) / 2, 2 * E[1] - (S[1] + Hh[1]) / 2], pts = [];
    for (let i = 0; i < N_ARM; i++) { const t = i / (N_ARM - 1), u = 1 - t; pts.push([u * u * S[0] + 2 * u * t * C[0] + t * t * Hh[0], u * u * S[1] + 2 * u * t * C[1] + t * t * Hh[1]]); }
    return pts;
  }
  function tube(line, w0, w1) {
    const A = [], B = [];
    line.forEach((p, i) => { const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, w = lerp(w0, w1, i / (line.length - 1)) / 2;
      A.push([p[0] - dy / L * w, p[1] + dx / L * w]); B.push([p[0] + dy / L * w, p[1] - dx / L * w]); });
    return { A, B };
  }
  // mitten hand around centre c, rotated by hr; `point` stretches one finger out
  function mitten(c, hr, side, point = 0) {
    const pts = []; const n = 14;
    for (let i = 0; i <= n; i++) { const a = -Math.PI * .95 + i / n * Math.PI * 1.9, r = 22 + (point ? Math.max(0, Math.cos(a)) * 22 * point : 0);
      pts.push(rot([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r * .92], hr, c)); }
    const thumb = [rot([c[0] - 6, c[1] - 20 * side], hr, c), rot([c[0] + 6, c[1] - 30 * side], hr, c), rot([c[0] + 16, c[1] - 22 * side], hr, c)];
    return { outline: pts, thumb };
  }

  // ---- one whole drawing of the body in a pose (no face) ----
  function bodyRaw(P, id) {
    const S_ = [], H = headFrame(P), lean = P.lean;
    const bodyPts = [[-106, 0], [-102, -150], [-96, -222], [-64, -256], [64, -256], [96, -222], [102, -150], [106, 0]].map(p => rot(p, lean, [0, 0]));
    // body first (the arms are drawn over it), then the head
    S_.push(stroke('body', bodyPts, { width: 3.6, corner: 1.1 }));
    S_.push(stroke('body/seam', [[-70, -60], [0, -52], [70, -60]].map(p => rot(p, lean, [0, 0])), { width: 1.4, opacity: .5, pressure: PRESS.inner }));
    S_.push(stroke('badge', ellPoints(0, -164, 30, 30, -Math.PI / 2, Math.PI * 1.55, 20).map(p => rot(p, lean, [0, 0])), { width: 2, opacity: .75, corner: 2 }));
    S_.push(stroke('neck/l', [[-16, -256], [-14, -268]].map(p => rot(p, lean, [0, 0])), { width: 2.4 }));
    S_.push(stroke('neck/r', [[16, -256], [14, -268]].map(p => rot(p, lean, [0, 0])), { width: 2.4 }));
    const hx = HEAD.w / 2, hy = HEAD.h / 2;
    S_.push(loopStroke('head', rrectPts(-hx, -hy, HEAD.w, HEAD.h, HEAD.r, 5).map(H), { width: 3.6, start: 1, over: 16 }));
    S_.push(loopStroke('visor', rrectPts(-VISOR.w / 2, -VISOR.h / 2 + VISOR.y, VISOR.w, VISOR.h, VISOR.r, 4).map(H), { width: 2, opacity: .8, pressure: PRESS.inner, start: 1, over: 8 }));
    S_.push(stroke('ear/l', rrectPts(-hx - 12, -18, 12, 36, 5, 2).concat([[-hx - 12, -12]]).map(H), { width: 2.4, corner: 1 }));
    S_.push(stroke('ear/r', rrectPts(hx, -18, 12, 36, 5, 2).concat([[hx, -12]]).map(H), { width: 2.4, corner: 1 }));
    S_.push(stroke('antenna', [[0, -hy], [4, -hy - 18], [10, -hy - 32]].map(H), { width: 2.6 }));
    S_.push(stroke('antenna/ball', ellPoints(12, -hy - 42, 10, 10, 0, TAU, 14).map(H), { width: 2.6, corner: 2 }));
    // arms (tube + mitten) — each one outline so the paper fill can hide what is behind it
    for (const [k, side, sx] of [['L', -1, -88], ['R', 1, 88]]) {
      const A = P[k], Sh = rot([sx, -226], lean, [0, 0]), line = armLine(Sh, A.e, A.h), t = tube(line, 30, 24), m = mitten(A.h, A.hr, side, A.point ?? 0);
      S_.push(stroke(`arm/${k}/a`, t.A, { width: 3.2, corner: 2 }));
      S_.push(stroke(`arm/${k}/b`, t.B, { width: 3.2, corner: 2 }));
      S_.push(stroke(`hand/${k}`, m.outline, { width: 3.2, corner: 2 }));
      S_.push(stroke(`thumb/${k}`, m.thumb, { width: 2.4, corner: 2 }));
      S_.push(stroke(`cuff/${k}`, [t.A[N_ARM - 2], t.B[N_ARM - 2]], { width: 1.6, opacity: .6, pressure: PRESS.inner }));
      S_.push(stroke(`elbow/${k}`, [t.A[5], lerpP(t.A[5], t.B[5], .35)], { width: 1.3, opacity: .45, pressure: PRESS.inner }));
    }
    return { strokes: S_ };
  }
  const lerpP = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  // paper fills: body, head and arms hide the lines behind them
  function fills(P) {
    const H = headFrame(P), lean = P.lean, f = { body: new Path2D(), head: new Path2D(), arms: [] };
    const bodyPts = [[-106, 0], [-102, -150], [-96, -222], [-64, -256], [64, -256], [96, -222], [102, -150], [106, 0]].map(p => rot(p, lean, [0, 0]));
    f.body = polyPath(bodyPts);
    f.head = polyPath(rrectPts(-HEAD.w / 2, -HEAD.h / 2, HEAD.w, HEAD.h, HEAD.r, 5).map(H));
    f.visor = polyPath(rrectPts(-VISOR.w / 2, -VISOR.h / 2 + VISOR.y, VISOR.w, VISOR.h, VISOR.r, 4).map(H));
    for (const [k, side, sx] of [['L', -1, -88], ['R', 1, 88]]) {
      const A = P[k], Sh = rot([sx, -226], lean, [0, 0]), line = armLine(Sh, A.e, A.h), t = tube(line, 30, 24), m = mitten(A.h, A.hr, side, A.point ?? 0);
      f.arms.push({ k, path: polyPath([...t.A, ...t.B.slice().reverse()]), hand: polyPath(m.outline) });
    }
    return f;
  }

  // ---- faces (replacement drawings on the screen) ----
  function faceRaw(expr, P) {
    const H = headFrame(P), S_ = [], v = VISOR.y;
    const eye = (id, x, y, rx, ry) => S_.push(stroke(id, ellPoints(x, y + v, rx, ry, 0, TAU, 14).map(H), { width: 2.6, corner: 2 }));
    const arcE = (id, x, y, up) => S_.push(stroke(id, [[x - 12, y + v], [x, y + v + (up ? -10 : 8)], [x + 12, y + v]].map(H), { width: 3, corner: 2 }));
    switch (expr) {
      case 'open': eye('eye/l', -28, -6, 9, 14); eye('eye/r', 28, -6, 9, 14); S_.push(stroke('mouth', [[-12, 24 + v], [0, 29 + v], [12, 24 + v]].map(H), { width: 2.4, corner: 2 })); break;
      case 'down': eye('eye/l', -28, 8, 9, 10); eye('eye/r', 28, 8, 9, 10); break;
      case 'side': eye('eye/l', -40, -4, 9, 14); eye('eye/r', 14, -4, 9, 14); break;
      case 'sideR': eye('eye/l', -14, -4, 9, 14); eye('eye/r', 40, -4, 9, 14); break;
      case 'closed': arcE('eye/l', -28, -2, false); arcE('eye/r', 28, -2, false); break;
      case 'half': S_.push(stroke('lid/l', [[-38, -2 + v], [-18, -2 + v]].map(H), { width: 2.6 })); S_.push(stroke('lid/r', [[18, -2 + v], [38, -2 + v]].map(H), { width: 2.6 }));
        eye('eye/l', -28, 4, 8, 6); eye('eye/r', 28, 4, 8, 6); break;
      case 'happy': arcE('eye/l', -28, -2, true); arcE('eye/r', 28, -2, true); S_.push(stroke('mouth', [[-16, 20 + v], [0, 30 + v], [16, 20 + v]].map(H), { width: 2.6, corner: 2 })); break;
      case 'wide': eye('eye/l', -28, -6, 12, 17); eye('eye/r', 28, -6, 12, 17); S_.push(stroke('brow/l', [[-40, -34 + v], [-18, -38 + v]].map(H), { width: 2.2 })); S_.push(stroke('brow/r', [[18, -38 + v], [40, -34 + v]].map(H), { width: 2.2 })); break;
      case 'worried': eye('eye/l', -28, -2, 8, 12); eye('eye/r', 28, -2, 8, 12); S_.push(stroke('brow/l', [[-40, -24 + v], [-18, -30 + v]].map(H), { width: 2.2 })); S_.push(stroke('brow/r', [[18, -30 + v], [40, -24 + v]].map(H), { width: 2.2 }));
        S_.push(stroke('mouth', [[-10, 28 + v], [0, 24 + v], [10, 28 + v]].map(H), { width: 2.2, corner: 2 })); break;
      // GAME PATCH: the pause face, two bars like a8's pause sign (scenes2/a8.js:73: bar(id, x) = stroke from
      // [x, -h/2] to [x + 1, h/2], pressure [[0,.75],[.12,1],[.88,1],[1,.75]]), at visor size: h 36, gap 26, width 7.
      case 'pause': { const pb = 18, bar = (id, x) => S_.push(stroke(id, [[x, -pb - 4 + v], [x + 1, pb - 4 + v]].map(H), { width: 7, pressure: [[0, .75], [.12, 1], [.88, 1], [1, .75]] }));
        bar('pause/l', -13); bar('pause/r', 13); break; }
      case 'off': break;
      default: throw new Error('agent face ' + expr);
    }
    return { strokes: S_ };
  }
  const filledEyes = new Set(['open', 'down', 'side', 'sideR', 'half', 'wide', 'worried']);
  function eyeFills(expr, P) {
    if (!filledEyes.has(expr)) return null;
    const H = headFrame(P), v = VISOR.y, p = new Path2D(), add = (x, y, rx, ry) => { const q = ellPoints(x, y + v, rx * .82, ry * .82, 0, TAU, 14).map(H); q.forEach((a, i) => i ? p.lineTo(...a) : p.moveTo(...a)); p.closePath(); };
    const E = { open: [[-28, -6, 9, 14], [28, -6, 9, 14]], down: [[-28, 8, 9, 10], [28, 8, 9, 10]], side: [[-40, -4, 9, 14], [14, -4, 9, 14]], sideR: [[-14, -4, 9, 14], [40, -4, 9, 14]], half: [[-28, 4, 8, 6], [28, 4, 8, 6]], wide: [[-28, -6, 12, 17], [28, -6, 12, 17]], worried: [[-28, -2, 8, 12], [28, -2, 8, 12]] }[expr];
    E.forEach(e => add(...e)); return p;
  }

  // ---- pose interpolation (assisted inbetweens for moves; keys are the authored drawings) ----
  function mixPose(a, b, t) {
    const A = KEYS[a] ?? a, B = KEYS[b] ?? b, l = (x, y) => lerp(x, y, t), lp = (p, q) => [l(p[0], q[0]), l(p[1], q[1])];
    const arm = (x, y) => ({ e: lp(x.e, y.e), h: lp(x.h, y.h), hr: l(x.hr, y.hr), point: l(x.point ?? 0, y.point ?? 0) });
    return { head: lp(A.head, B.head), tilt: l(A.tilt, B.tilt), lean: l(A.lean, B.lean), L: arm(A.L, B.L), R: arm(A.R, B.R) };
  }
  const cache = new Map();
  function prep(pose, key) {
    if (cache.has(key)) return cache.get(key);
    const P = typeof pose === 'string' ? KEYS[pose] : pose;
    const v = { P, body: compile(bodyRaw(P, key), 'agent/' + key), fills: fills(P), faces: {} };
    cache.set(key, v); return v;
  }
  // draw the agent at x, y (desk origin), scale s. pose: key name or {from, to, t}.
  // o: { face, alpha, progress (draw-on 0..1), visorDark (0..1), badge (0..1), hold: fn(c, P) draws a held prop between arms and hands }
  function draw(c, x, y, s, pose, o = {}) {
    let key, P;
    if (typeof pose === 'string') { key = pose; }
    else { const t = Math.round(pose.t * 12) / 12; key = `${pose.from}>${pose.to}@${t.toFixed(3)}`; P = mixPose(pose.from, pose.to, t); }
    const d = prep(P ?? pose, key), a = o.alpha ?? 1, u = o.progress ?? 1, face = o.face ?? 'open';
    c.save(); c.translate(x, y); c.scale(s, s); c.globalAlpha *= a;
    if (u >= 1) {
      c.fillStyle = COL.paper; c.fill(d.fills.body); c.fill(d.fills.head);
    }
    if (o.behind) o.behind(c, d.P);
    // body + head strokes first (everything except arms/hands), then the arms over them
    const bodyOnly = splitCel(d.body, key, s => !/^(arm|hand|thumb|cuff|elbow)\//.test(s.id));
    const torso = splitCel(d.body, key + '/torso', s => /^(body|badge|neck)/.test(s.id)), headS = splitCel(d.body, key + '/head', s => /^(head|visor|ear|antenna)/.test(s.id));
    const armsOnly = splitCel(d.body, key + '/arms', s => /^(arm|hand|thumb|cuff|elbow)\//.test(s.id));
    const nb = bodyOnly.plan.total, na = armsOnly.plan.total, ub = u >= 1 ? 1 : clamp(u * (nb + na) / nb, 0, 1), ua = u >= 1 ? 1 : clamp((u * (nb + na) - nb) / na, 0, 1);   // exact 1 when finished (fills + prop)
    let tip = null;
    if (ub >= 1) { pencilMarks(c, torso, {}); c.fillStyle = COL.paper; c.fill(d.fills.head); pencilMarks(c, headS, {}); }   // head in front of the shoulders
    else tip = pencilMarks(c, bodyOnly, { progress: ub });
    // screen: dark when off
    if ((o.visorDark ?? 0) > 0 && u >= 1) { c.save(); c.globalAlpha *= o.visorDark * .78; c.fillStyle = COL.graphite; c.fill(d.fills.visor); c.clip(d.fills.visor);
      c.strokeStyle = '#000'; c.globalAlpha *= .4; c.lineWidth = 1.2; c.beginPath(); for (let k = -120; k < 120; k += 7) { c.moveTo(k - 40, -500); c.lineTo(k + 60, 0); } c.stroke(); c.restore(); }
    if (u >= 1 && (o.badge ?? 1) > 0) { c.save(); c.translate(...rot([0, -164], d.P.lean, [0, 0])); drawLogo(c, 'claude', 0, 0, 36, o.badge ?? 1); c.restore(); }
    // face (replacement drawing), only when the screen is on
    if (u >= 1 && face !== 'off' && (o.visorDark ?? 0) < .5) {
      const fk = key + '/face/' + face; if (!d.faces[face]) d.faces[face] = { cel: compile(faceRaw(face, d.P), 'agent/' + fk), fill: eyeFills(face, d.P) };
      const F = d.faces[face]; if (F.fill) { c.save(); c.fillStyle = COL.graphite; c.globalAlpha *= .86; c.fill(F.fill); c.restore(); }
      pencilMarks(c, F.cel, {});
    }
    // arm tubes, then the held prop, then the hands in front of it
    const tubes = splitCel(d.body, key + '/tubes', s => /^(arm|cuff|elbow)\//.test(s.id));
    const hands = splitCel(d.body, key + '/hands', s => /^(hand|thumb)\//.test(s.id));
    if (ua >= 1) {
      c.fillStyle = COL.paper; for (const A of d.fills.arms) c.fill(A.path);
      pencilMarks(c, tubes, {});
      if (o.hold) o.hold(c, d.P);
      c.fillStyle = COL.paper; for (const A of d.fills.arms) c.fill(A.hand);
      pencilMarks(c, hands, {});
    } else if (ua > 0) tip = pencilMarks(c, armsOnly, { progress: ua }) ?? tip;
    c.restore();
    // world position of the pencil tip while he is being drawn (null when complete)
    return { P: d.P, tip: u < 1 && tip ? [x + tip[0] * s, y + tip[1] * s] : null };
  }
  const splits = new Map();
  function splitCel(cel, key, f) { if (!splits.has(key + cel.id)) { const q = { strokes: cel.strokes.filter(f) }; q.plan = makePlan(q); splits.set(key + cel.id, q); } return splits.get(key + cel.id); }
  // where a hand is (agent-local), for props that follow it
  function hand(pose, side) { const P = typeof pose === 'string' ? KEYS[pose] : mixPose(pose.from, pose.to, Math.round(pose.t * 12) / 12); return P[side].h; }
  return { KEYS, draw, hand, mixPose };
})();

// ---------- the agent's desk (origin = middle of the top edge) ----------
function deskDrawing(w = 620, h = 150) {
  const S_ = [];
  S_.push(stroke('desk/top', bow([-w / 2 - 20, 0], [w / 2 + 20, 0], 1.5, 3), { width: 3.6 }));
  S_.push(stroke('desk/front', [[-w / 2, 0], [-w / 2 + 6, 22], [w / 2 - 6, 22], [w / 2, 0]], { width: 2.8, corner: .6 }));
  S_.push(stroke('desk/legL', [[-w / 2 + 30, 22], [-w / 2 + 34, h]], { width: 3 }));
  S_.push(stroke('desk/legR', [[w / 2 - 30, 22], [w / 2 - 34, h]], { width: 3 }));
  S_.push(stroke('desk/drawer', rrectPts(w / 2 - 190, 34, 130, 48, 6, 2), { width: 2, opacity: .7, pressure: PRESS.inner, corner: .6 }));
  S_.push(stroke('desk/knob', [[w / 2 - 136, 58], [w / 2 - 114, 58]], { width: 2, opacity: .7 }));
  for (let k = 0; k < 9; k++) S_.push(stroke('desk/shadow/' + k, [[-w / 2 + 50 + k * 16, h + 6], [-w / 2 + 64 + k * 16, h - 2]], { width: 1.2, opacity: .35, pressure: PRESS.inner }));
  return { strokes: S_ };
}
