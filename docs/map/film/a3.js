// Copied from temporal-film (scenes2/a3.js), unmodified.
'use strict';
// ============================================================
// a3: behind the scenes. Maria's refund request leaves her laptop, flies into a server
// rack, the camera pushes into the rack and we meet the agent in his room (stage D).
// He takes the request from his in-tray, reads it, looks the order up in his file
// cabinet (the drawer opens, the folder "A-1001 / 49.99 EUR" pops up, he nods), types,
// and the printer prints the refund receipt. The email (an envelope) is drawn, ready.
//
// This file also defines the room state shared by a3, a4 and a5 (window.V2G2ROOM), so the
// three acts draw the same room from the same state and join without a visible change.
//
// Beat sheet (act-local seconds, as built; film times: add the act start printed by tools/check.mjs)
//  t       what the viewer notices                         action / exposure                       sound
//  0.0     a2's last frame: "Refund requested" (stage C)   hold (pixel-identical to a2's end)      -
//  0.17    the laptop slides left and shrinks (s .75)       on twos, eased                          -
//  0.5     the pencil draws a server rack                   ones, 5000 px/s                         pencil
//  2.67    its lights blink                                 on twos                                 hum-on
//  2.75    the request slip rises out of the screen         grows on twos (letters >= 44 px)        paper
//  3.0     it flies across and drops into the rack's slot   arc on twos, slot clip                  whoosh, paper
//  4.0     the camera turns to the rack and dives in        camera on ones, drawing fades           whoosh
//  4.72    CUT: inside, the room is there (floor, wall, cabinet, desk + keyboard, lamp, socket, plug, cable)
//  5.17    the pencil comes in and draws the agent,         ones, hand speed (4200 px/s),            pencil
//          his printer and his in-tray                      >= 6 frames each, moves by distance
//  5.5     "Behind the scenes, an AI agent handles it."     caption on ones
//  7.33    the slip drops into his in-tray; he watches it   falls on twos; sideR                     paper
//  8.0     he gathers himself, reaches, takes it, reads     anticipation, reach (sideR), read (down) read
//          (held up in both hands, the words clear of his mittens)
//  9.58    he puts it back (sideR)                          rest
//  10.0    he turns to the cabinet: eyes left ('side')      2-frame dip, then his left arm reaches toward it at
//  10.25   and reaches toward it                            desk height, under the lamp's head (held 8 frames)
//  10.58   the top drawer slides out (front comes forward   2 drawings; the folder rises out of it     drawer
//          and down, the files show), the folder rises       on twos, overshoot
//  11.17   he finds it: happy face, a nod                   down-up-down-up, 2 drawings each way    nod
//  11.92   the folder sinks back, 12.17 the drawer shuts    on twos; 2 drawings                      drawer
//  12.42   he types on his keyboard (the keys dip)          typeA / typeB, 4 frames each            type
//  12.67   the pencil draws the email, ready on the desk    envelope at SD.ENV, behind the keyboard  pencil
//  12.92   the printer prints "Refund 49.99 EUR": the       rises out of the slot on twos (cut to    print
//          paper rises out of its slot; he watches (sideR)   the slot's width), LED blinks
//  13.25   he sits back; hold (this is a4's first frame)    rest, open                              -
// ============================================================

// ---------- the room state shared by a3, a4, a5 ----------
// Room v2.1 (stageD): the printer is as wide as its receipts and they rise out of its slot; the tray
// stands in front of the printer's left end; the email lies at SD.ENV in front of him; a small keyboard
// lies on the desk under his typing hands; he looks right with the 'sideR' face (no mirrored body).
window.V2G2ROOM = (() => {
  SD.build();
  const PULLED = 110;                                           // how far the plug is out after the crash (rig-local)
  const PR = SD.PRINTER;
  const SLOT = { x: PR.x, y: PR.y - PR.slot };                  // the printer's paper slot (x +- PR.half, at its top)
  const REC_DX = 0;                                             // receipts are centred on the printer
  const REC_CLIP = [PR.x - 138, PR.x + 138];                    // rising paper is cut to the slot (x) and to the printer top (y)
  const TRAY_SLIP = { x: SD.TRAY.x - 4, y: SD.TRAY.y - 66, s: .5, rot: -.05 };   // the request lying in the in-tray
  const TRAY_LIP = SD.TRAY.y - 42;                              // the slip in the tray is drawn over the tray's own sheet and cut just above its lip
  // the email, ready on the desk at SD.ENV (a9's size and placement: s .7, centre 20 px above ENV.y, so it
  // stands on the desk): in front of him, clear of his right hand, behind his keyboard. Send path: up and right.
  const ENV = { x: SD.ENV.x, y: SD.ENV.y - 20, s: .7, rot: -.04 };
  const SEND = [[ENV.x, ENV.y - 30], [ENV.x + 120, ENV.y - 300], [ENV.x + 420, ENV.y - 420], [W + 200, 335]];
  const Q = { x: 818, y: 468 };                                 // the red question mark (origin of questionDrawing)
  const FOLDER = { x: SD.CAB.x, y0: 712, y1: 536 };             // folder centre inside the drawer -> popped up
  const LED = { x: PR.x + 122, y: PR.y - 30 };
  // the keyboard: agent-local (origin = desk top centre in front of him), x -85..93, from the desk up to y -21.
  // Its right end stops short of his resting right hand; the envelope stands behind its right half.
  const KB = { x: SD.AG.x + 4, y: SD.AG.y, hw: 89 };
  const KEYCAPS = [...[...Array(9)].map((_, i) => ({ x: -72 + i * 18, y: -17.5, l: 10 })),
    ...[-79, -61.5, -44].map(x => ({ x, y: -12.5, l: 11 })), { x: 0, y: -12.5, l: 58, space: true }, ...[44, 61.5, 79].map(x => ({ x, y: -12.5, l: 11 }))];
  const KB_OUT = [[-KB.hw, 0], [-KB.hw, -8], [-KB.hw + 6, -21], [KB.hw - 6, -21], [KB.hw, -8], [KB.hw, 0]];
  const D = {};
  function build() {
    if (D.q) return D;
    const qRaw = questionDrawing(.72);
    D.q = compile(qRaw, 'v2g2/q');
    // a second, lighter pass over the question mark's curve (the hand goes over it again)
    { const cp = qRaw.strokes[0].points, n = cp.length;
      D.q2 = compile({ strokes: [stroke('v2g2/q2', cp.map(([x, y], i) => [x + 7 + Math.sin(i / n * Math.PI * 3) * 3.5, y - 5 + Math.cos(i / n * Math.PI * 2) * 3]), { width: 9 * .72 * .45, dense: false, pressure: [[0, .3], [.1, .95], [.85, .85], [1, .15]] })] }, 'v2g2/q2'); }
    D.slipFill = polyPath([[-120, -70], [100, -70], [120, -52], [120, 70], [-120, 70]]);
    // below readable size the request is drawn without letters (a line of scrawl stands for them)
    D.reqSmall = compile({ strokes: [loopStroke('rqs', [[-120, -70], [100, -70], [120, -52], [120, 70], [-120, 70]], { width: 4.6, corner: .6, over: 8 }),
      ...scrawl('rqs/w0', -82, -2, 150, 24, 3, { width: 3.6, opacity: .85 }), ...scrawl('rqs/w1', -62, 46, 110, 22, 8, { width: 3.6, opacity: .85 })] }, 'v2g2/req-small');
    // the refund receipt the printer prints (MINI_RECEIPT's paper: as wide as the printer's slot)
    { const w = MINI_RECEIPT.w, out = MINI_RECEIPT.outline;
      const raw = seed => ({ strokes: [stroke('rc/edge', out, { width: 2.8, corner: .5 }),
        ...textStrokes('Refund', 0, 58, { cap: 33, align: 'center', condense: .86, id: 'rc/t1', seed }).strokes,
        ...textStrokes('49.99 EUR', 0, 116, { cap: 33, align: 'center', condense: .78, id: 'rc/t2', seed: seed + 1 }).strokes] });
      D.receipt = compile(raw(31), 'v2g2/receipt'); D.receiptRed = compile(raw(57), 'v2g2/receipt-red');
      D.receiptFill = polyPath(out); D.receiptW = w; }
    D.folderFill = polyPath([[-150, -90], [-40, -90], [-26, -106], [40, -106], [52, -90], [150, -90], [150, 90], [-150, 90]]);
    D.printerFill = PRINTER_FILL();
    D.kbFill = polyPath(KB_OUT);
    D.trayFill = polyPath([[-70, -40], [-48, -44], [-40, -62], [44, -60], [50, -42], [70, -40], [62, 0], [-62, 0]]);   // the tray and its sheet
    return D;
  }
  const celTip = (cel, u, x = 0, y = 0, s = 1) => { const t = u >= 1 ? cel.strokes.at(-1).samples.at(-1).p : planAt(cel, u).tip; return [x + t[0] * s, y + t[1] * s]; };

  // ---- poses. A partial move [from, to, t] becomes a pose key of its own (a named mix), so a move between
  // any two drawings is one assisted inbetween {from, to, t} of AGENT (its cache key is the name).
  const NAMED = new Map();
  function named(p, name) {
    if (typeof p === 'string' || (p && !Array.isArray(p) && NAMED.has(String(p)))) return p;
    const n = name ?? `v2g2:${String(p[0])}>${String(p[1])}@${p[2]}`;
    if (!NAMED.has(n)) NAMED.set(n, Object.assign(Array.isArray(p) ? AGENT.mixPose(p[0], p[1], p[2]) : { ...p }, { toString: () => n }));
    return NAMED.get(n);
  }
  // a pose seen in a mirror, as pose data (the drawing itself is not flipped: his antenna and badge stay put)
  const mirrorArm = A => ({ e: [-A.e[0], A.e[1]], h: [-A.h[0], A.h[1]], hr: -A.hr, point: A.point ?? 0 });
  const mirrorPose = P => ({ head: [-P.head[0], P.head[1]], tilt: -P.tilt, lean: -P.lean, L: mirrorArm(P.R), R: mirrorArm(P.L) });
  const LOWREACH = named(['rest', 'reach', .8]);                // his reach into the tray (hand to the slip, below the receipts)
  const NOD = named({ ...AGENT.mixPose('rest', 'slump', .35), tilt: .025, lean: 0 }, 'v2g2:nod');   // a yes-nod: the head drops, hardly rolls
  // reading: the slip held up in both hands, the mittens at its lower side edges, clear of the words
  const READ = named({ ...AGENT.KEYS.read, L: { e: [-160, -176], h: [-118, -146], hr: 1.3 }, R: { e: [160, -176], h: [118, -146], hr: -1.3 } }, 'v2g2:read');
  // the reach toward the file cabinet: his left arm out at desk height, under the lamp's head
  const REACH_L = named(mirrorPose({ ...AGENT.KEYS.reach, R: { e: [150, -110], h: [224, -80], hr: -1.9 } }), 'v2g2:reachL');
  const asPose = p => typeof p === 'string' ? p : (q => ({ from: q, to: q, t: 1 }))(named(p));
  // a performance track: [[time, pose, dur, ease]]; the move into each key starts at `time` and lasts `dur`
  // (dur 0 = a straight change of drawing). The agent snaps t to 1/12; callers pass q on twos.
  function track(q, keys) {
    let prev = keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t0, next, dur = .25, ease = easeIO] = keys[i];
      if (q < t0) break;
      const u = dur > 0 ? ease(clamp((q - t0) / dur, 0, 1)) : 1;
      if (u < 1) return { from: named(prev), to: named(next), t: u };
      prev = next;
    }
    return asPose(prev);
  }
  // looks: [[time, face, mirrored, eyesLeft]]. Faces follow his hands: 'sideR' = eyes to our right (tray,
  // printer, email), 'side' = eyes to our left (cabinet, lamp). mirrored (legacy, unused in v2.1) = the whole
  // drawing is mirrored; eyesLeft keeps an unmirrored face on it. blinks: times of a 2-frame 'closed'.
  function lookAt(q, keys, blinks = []) {
    let k = keys[0]; for (const e of keys) { if (q < e[0]) break; k = e; }
    const face = k[1] !== 'off' && blinks.some(b => q >= b && q < b + 2 / 24 - 1e-6) ? 'closed' : k[1];
    return { face, mirror: !!k[2], eyesLeft: !!k[3] };
  }
  const faceAt = (q, keys, blinks) => lookAt(q, keys, blinks).face;

  // ---- the agent (optionally mirrored; the badge stays unmirrored) ----
  // a.front(g, P, mirrored): things on the desk in front of his body but under his hands (the email, the
  // keyboard), drawn in world space between his arm tubes and his mittens.
  function agent(c, a) {
    // AGENT.draw computes its arm progress as (u*(nb+na) - nb) / na, which can land one ulp under 1 for a
    // finished drawing; the arms are then drawn without their paper fill and without the held prop.
    // A finished drawing is therefore asked for at u = 1 + 1e-6 (clamped inside).
    const u = a.progress ?? 1, o = { face: a.face ?? 'open', visorDark: a.visor ?? 0, progress: u >= 1 ? 1 + 1e-6 : u, badge: a.mirror ? 0 : 1 };
    const hasSlip = a.slip !== undefined && a.slip !== null, Mw = c.getTransform();
    if (a.front || hasSlip) o.hold = (g, P) => {
      if (a.front) { g.save(); g.setTransform(Mw); a.front(g, P, !!a.mirror); g.restore(); }
      if (hasSlip) heldSlip(g, P, a.slip);
    };
    const faceOver = a.mirror && a.eyesLeft && u >= 1 && o.face === 'side' && !(a.visor >= .5);
    if (faceOver) o.face = 'off';
    c.save(); if (a.mirror) { c.translate(SD.AG.x * 2, 0); c.scale(-1, 1); }
    const r = AGENT.draw(c, SD.AG.x, SD.AG.y, SD.AG.s, a.pose, o);
    c.restore();
    if (a.mirror && u >= 1) { const L = r.P.lean, s = SD.AG.s; drawLogo(c, 'claude', SD.AG.x - 164 * Math.sin(L) * s, SD.AG.y - 164 * Math.cos(L) * s, 36 * s, 1); }
    if (faceOver) faceOnMirrored(c, r.P, a.face);
    return r.tip ? (a.mirror ? [SD.AG.x * 2 - r.tip[0], r.tip[1]] : r.tip) : null;
  }
  // an unmirrored face on a mirrored head: the same agent drawn unmirrored with the mirrored head placement,
  // clipped to the inside of the visor (so only the eyes are added)
  function faceOnMirrored(c, P, face) {
    const hx = -P.head[0], hy = P.head[1], tilt = -P.tilt, s = SD.AG.s;
    const HP = named({ ...AGENT.KEYS.rest, head: [hx, hy], tilt, lean: 0 }, `v2g2:mhead:${hx.toFixed(1)},${hy.toFixed(1)},${tilt.toFixed(3)}`);
    const inset = rrectPts(-58, -39, 116, 82, 21, 3).map(([x, y]) => { const cx = x * Math.cos(tilt) - y * Math.sin(tilt), cy = x * Math.sin(tilt) + y * Math.cos(tilt); return [SD.AG.x + (cx + hx) * s, SD.AG.y + (cy + hy) * s]; });
    c.save(); c.clip(polyPath(inset));
    AGENT.draw(c, SD.AG.x, SD.AG.y, s, { from: HP, to: HP, t: 1 }, { face, badge: 0, progress: 1 + 1e-6 });
    c.restore();
  }
  // the request slip in his hands: k = 0 in the right hand (small) .. 1 held up in both hands to read.
  // Held up (s .92: capitals still >= 44 px) in the READ pose, his mittens hold its lower side edges and their
  // thumbs stay outside the words, so "Refund" and "A-1001" read whole.
  function heldSlip(g, P, k) {
    const R = P.R.h, L = P.L.h, a = [R[0] - 18, R[1] + 30], b = [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2 - 54];
    g.save(); g.translate(lerp(a[0], b[0], k), lerp(a[1], b[1], k)); g.rotate(lerp(-.1, 0, k)); const s = lerp(TRAY_SLIP.s, .92, k); g.scale(s, s);
    g.fillStyle = COL.paper; g.fill(build().slipFill); pencilMarks(g, slipCel(s)); g.restore();
  }
  const slipCel = s => s >= .85 ? SD.D.request : build().reqSmall;   // letters only at readable size (>= 44 px capitals)
  // a slip anywhere in the room (world), clipped above `clipY` when it is inside the tray
  function slip(c, p) {
    if (!p) return; const d = build();
    c.save(); if (p.clipY !== undefined) { c.beginPath(); c.rect(p.x - 400, p.clipY - 900, 800, 900); c.clip(); }
    c.translate(p.x, p.y); c.rotate(p.rot ?? 0); c.scale(p.s, p.s); c.fillStyle = COL.paper; c.fill(d.slipFill); pencilMarks(c, slipCel(p.s), { progress: p.u ?? 1 }); c.restore();
  }
  const inTray = { ...TRAY_SLIP, clipY: TRAY_LIP };

  // ---- receipts rising out of the printer's slot: e = how much has come out (0..150); `lift` pushes it up.
  // The paper is centred on the slot and cut to the slot's width and to the printer's top.
  function receipt(c, e, o = {}) {
    if (e <= 0) return;
    c.save(); c.beginPath(); c.rect(REC_CLIP[0], SLOT.y - 700, REC_CLIP[1] - REC_CLIP[0], 700); c.clip();
    c.translate(SLOT.x + REC_DX, SLOT.y - e - (o.lift ?? 0)); c.rotate(o.rot ?? 0);
    const d = build(); c.fillStyle = COL.paper; c.fill(d.receiptFill); pencilMarks(c, o.color === 'red' ? d.receiptRed : d.receipt, { color: o.color ?? 'graphite' }); c.restore();
  }
  // the email. e = {u: draw-on progress, fly: 0..1 along the send path, hop: 0..1 (lifted before it goes),
  // x, y, rot (a free position, e.g. falling back)}. Returns the pencil tip while it is drawn.
  function envPose(e) {
    if (e.x !== undefined) return { x: e.x, y: e.y, s: e.s ?? ENV.s, rot: e.rot ?? ENV.rot };
    if (e.fly > 0) { const p = bez(...SEND, e.fly); return { x: p[0], y: p[1], s: ENV.s * lerp(1, 1.05, sm(0, .3, e.fly)), rot: ENV.rot - .3 * e.fly }; }
    return { x: ENV.x, y: ENV.y - 26 * (e.hop ?? 0), s: ENV.s, rot: ENV.rot };
  }
  function envelope(c, e) {
    if (!e || (e.u ?? 1) <= 0) return null;
    const p = envPose(e), u = e.u ?? 1;
    c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(p.s, p.s);
    // paper under it hides his body behind it (faded in while the pencil draws it, so nothing pops)
    c.save(); c.globalAlpha *= clamp(u * 1.25, 0, 1); c.fillStyle = COL.paper; c.fillRect(-60, -40, 120, 80); c.restore();
    const t = pencilMarks(c, SD.D.envelope, { progress: u }); c.restore();
    return t ? [p.x + (t[0] * Math.cos(p.rot) - t[1] * Math.sin(p.rot)) * p.s, p.y + (t[0] * Math.sin(p.rot) + t[1] * Math.cos(p.rot)) * p.s] : null;
  }
  // ---- the keyboard; the keys under a pressing mitten dip (P = his pose, agent-local; null = no hands on it)
  const kbCels = new Map();
  function kbCel(dips) {
    const key = [...dips].sort((a, b) => a - b).join(',');
    if (!kbCels.has(key)) kbCels.set(key, compile({ strokes: [
      stroke('kb', KB_OUT, { width: 2.6, corner: .6 }),
      stroke('kb/edge', [[-KB.hw + 1, -8], [KB.hw - 1, -8]], { width: 1.3, opacity: .6, pressure: PRESS.inner }),
      ...KEYCAPS.map((k, i) => { const y = k.y + (dips.has(i) ? 3 : 0); return stroke('kb/key' + i, [[k.x - k.l / 2, y], [k.x + k.l / 2, y + .4]], { width: k.space ? 1.8 : 2.2, opacity: dips.has(i) ? .95 : .8, pressure: PRESS.flat }); }),
    ] }, 'v2g2/kb@' + key));
    return kbCels.get(key);
  }
  function keyboard(c, P, mirrored = false) {
    const dips = new Set();
    if (P) for (const k of ['L', 'R']) {
      const h = P[k].h, x = (mirrored ? -h[0] : h[0]) - (KB.x - SD.AG.x);
      if (h[1] > -40 && Math.abs(x) < KB.hw - 4) KEYCAPS.forEach((kc, i) => { if (!kc.space && Math.abs(kc.x - x) < 24) dips.add(i); });
    }
    c.save(); c.translate(KB.x, KB.y); c.fillStyle = COL.paper; c.fill(build().kbFill); pencilMarks(c, kbCel(dips)); c.restore();
  }
  // ---- the cabinet's top drawer pulled out (k 0..1): its front comes toward us (lower and a little larger),
  // the drawer's sides and the files standing in it show above it. Cabinet-local (origin bottom centre).
  function drawerGeom(k) {
    const sc = 1 + .1 * k, dy = 42 * k, X = x => x * sc, Y = y => -240 + (y + 240) * sc + dy;
    return { k, sc, X, Y, top: Y(-320), bot: Y(-160), hw: X(110) };
  }
  const drawerCels = new Map();
  function drawerCel(k) {
    if (drawerCels.has(k)) return drawerCels.get(k);
    const g = drawerGeom(k), S_ = [], fills = new Path2D(), BACK = -317;
    // inside: the drawer's side walls going back into the cabinet, a little shadow, the files' tabs
    S_.push(stroke('dr/sideL', [[-g.hw + 3, g.top], [-104, BACK]], { width: 2, opacity: .75, corner: .6 }));
    S_.push(stroke('dr/sideR', [[g.hw - 3, g.top], [104, BACK]], { width: 2, opacity: .75, corner: .6 }));
    for (let i = 0; i < 6; i++) { const x = -94 + i * 37; S_.push(stroke('dr/sh' + i, [[x, g.top - 1], [x + 7, BACK + 2]], { width: 1.1, opacity: .4, pressure: PRESS.inner })); }
    const tabTop = Math.max(g.Y(-346), BACK - 1);   // the files never show above the cabinet's top
    for (let i = 0; i < 4; i++) { const x0 = -80 + i * 42, pts = [[x0, g.top + 2], [x0 + 4, tabTop], [x0 + 30, tabTop], [x0 + 34, g.top + 2]];
      S_.push(stroke('dr/file' + i, pts, { width: 1.9, opacity: .8, corner: .6 })); fills.addPath(polyPath(pts)); }
    // the front, handle and label card, as the cabinet's own but nearer
    const fr = [[-g.hw, g.top], [g.hw, g.top], [g.hw, g.bot], [-g.hw, g.bot]];
    S_.push(loopStroke('dr/front', fr, { width: 3.2, corner: .6, over: 8 }));
    S_.push(loopStroke('dr/h', rrectPts(g.X(-40), g.Y(-260), 80 * g.sc, 18 * g.sc, 6, 2), { width: 2, start: 1, over: 4 }));
    S_.push(loopStroke('dr/card', rrectPts(g.X(-26), g.Y(-220), 52 * g.sc, 30 * g.sc, 3, 1), { width: 1.6, opacity: .6, pressure: PRESS.inner, over: 3 }));
    const v = { g, cel: compile({ strokes: S_ }, 'v2g2/drawer@' + k), gap: polyPath([[-g.hw, g.top], [-104, BACK], [104, BACK], [g.hw, g.top]]), files: fills, front: polyPath(fr) };
    drawerCels.set(k, v); return v;
  }
  // the drawer (k: 0 shut, .5 half out, 1 out) and the folder rising out of it (f 0..1, may overshoot)
  function drawer(c, k, f) {
    if (k <= 0) return; const d = build(), v = drawerCel(k);
    c.save(); c.translate(SD.CAB.x, SD.CAB.y); c.fillStyle = COL.paper;
    c.fill(v.gap); c.fill(v.front); c.fill(v.files); pencilMarks(c, v.cel); c.restore();
    if (f > 0) {   // the folder stands in the drawer: cut at the drawer front's top edge
      c.save(); c.beginPath(); c.rect(FOLDER.x - 300, SD.CAB.y + v.g.top - 900, 600, 900); c.clip();
      c.translate(FOLDER.x, lerp(FOLDER.y0, FOLDER.y1, f)); c.fillStyle = COL.paper; c.fill(d.folderFill); pencilMarks(c, SD.D.folder); c.restore();
    }
  }
  function question(c, u, u2 = 0) {
    const d = build(); if (u <= 0) return;
    c.save(); c.translate(Q.x, Q.y); pencilMarks(c, d.q, { progress: u, color: 'red' }); if (u2 > 0) pencilMarks(c, d.q2, { progress: u2, color: 'red', alpha: .85 }); c.restore();
  }
  function rig(c, s) {
    const pull = s.pull ?? 0;
    SD.socketRig(c, { pull, cable: 1, socket: 1, plug: 1, hand: s.hand ?? undefined, spark: s.spark ?? 0 });
  }
  // the printer and the in-tray, with paper under them (what is behind them stays hidden; the paper fades in
  // while the pencil draws them, so nothing pops)
  function printer(c, u = 1) {
    const d = build();
    if (u > 0) { c.save(); c.translate(PR.x, PR.y); c.globalAlpha *= clamp(u * 1.25, 0, 1); c.fillStyle = COL.paper; c.fill(d.printerFill); c.restore(); }
    SD.at(c, PR, SD.D.printer, { u });
  }
  function tray(c, u = 1) {
    const d = build();
    if (u > 0) { c.save(); c.translate(SD.TRAY.x, SD.TRAY.y); c.globalAlpha *= clamp(u * 1.25, 0, 1); c.fillStyle = COL.paper; c.fill(d.trayFill); c.restore(); }
    SD.at(c, SD.TRAY, SD.D.tray, { u });
  }

  // ---- the whole room from one state. Draw order: room, cabinet, lamp, receipts, printer, tray (+ request; in
  // front of the printer's left end), agent [with the email and the keyboard between his arm tubes and his
  // mittens: his hands stay in front of everything on the desk], desk, socket rig, props in motion, darkness.
  // Callers draw the pencil, then captions. `s.parts` = how far each part is drawn (a3's draw-on; default 1;
  // the agent in progress is drawn by the caller).
  const BASE = { pose: 'rest', face: 'open', visor: 0, mirror: false, lamp: 1, dark: 0, drawer: 0, folder: 0, slipAt: inTray, held: null,
    receipt1: 150, receipt2: 0, envelope: { u: 1 }, pull: 0, hand: null, spark: 0, q: 0, q2: 0, led: 0 };
  function frame(c, s) {
    const P = s.parts ?? {}, has = k => (P[k] ?? 1) >= 1, part = k => P[k] ?? 1;
    SD.room(c);
    SD.at(c, SD.CAB, SD.D.cab);
    drawer(c, s.drawer ?? 0, s.folder ?? 0);
    SD.lamp(c, s.lamp ?? 1, 1);
    receipt(c, s.receipt1 ?? 0, { lift: s.receipt2 ?? 0, rot: s.receipt2 ? -.008 * (s.receipt2 / 150) : 0 });
    receipt(c, s.receipt2 ?? 0, { color: 'red', rot: .006 });
    if (part('printer') > 0) printer(c, part('printer'));
    if (s.led) { c.save(); c.fillStyle = COL.graphite; c.globalAlpha = .85; c.beginPath(); c.arc(LED.x, LED.y, 4.2, 0, TAU); c.fill(); c.restore(); }
    if (part('tray') > 0) tray(c, part('tray'));
    if (has('tray')) slip(c, s.slipAt);
    const front = (g, Pz, mir) => { envelope(g, s.envelope); keyboard(g, Pz, mir); };
    if (has('agent')) agent(c, { pose: s.pose, face: s.face, visor: s.visor, mirror: s.mirror, eyesLeft: s.eyesLeft, slip: s.held, front });
    else front(c, null);
    SD.desk(c);
    rig(c, s);
    if (s.flying) slip(c, s.flying);
    question(c, s.q ?? 0, s.q2 ?? 0);
    SD.dark(c, s.dark ?? 0);
  }
  // a4's last frame = a5's first frame: power off, he is slumped with his screen dark, the plug is out
  const DARK = { ...BASE, pose: 'slump', face: 'off', visor: 1, lamp: 0, dark: 1, pull: PULLED };
  return { PULLED, SLOT, REC_DX, TRAY_SLIP, TRAY_LIP, inTray, ENV, SEND, Q, FOLDER, KB, BASE, DARK, LOWREACH, NOD, READ, REACH_L, build, celTip, named, mirrorPose, track, lookAt, faceAt,
    agent, slip, receipt, envelope, envPose, keyboard, drawer, question, rig, printer, tray, frame };
})();

// ---------- the act ----------
(() => {
  const RM = window.V2G2ROOM; RM.build(); SD.build();
  const g12 = n => Math.round(n * 12) / 12;           // snap a beat to the twos grid

  // ---- the wide shot: the laptop (left) and the server rack (right) ----
  // Maria's laptop: a2 ends on it full size (stage C); it slides left and shrinks to make room for the
  // rack, staying at s >= .75 so its "Refund requested" (nominal cap 44) keeps >= 44 px capitals.
  // Without stage C (a2 not built) a small laptop of our own stands in, already in the wide position.
  const HAS_SC = typeof SC !== 'undefined' && !!SC.END_A2;
  const WIDE = { x: 545, y: 606, s: .75 };
  const LAP = { x: 560, y: 596, dw: 600, dh: 375 };
  const RACK = { x: 1450, y: 936, fw: 310, fh: 560, dx: 50, dy: -36 };
  const SLOT_R = [RACK.x + RACK.dx / 2, RACK.y - RACK.fh + RACK.dy / 2];   // intake slot on the rack's top face (world)
  const UNITS = 5, unitY = k => -RACK.fh + 26 + k * 104;                   // rack-local top of each unit
  function rackRaw() {
    const { fw, fh, dx, dy } = RACK, x0 = -fw / 2, x1 = fw / 2, y0 = -fh, S_ = [];
    S_.push(loopStroke('rack/front', [[x0, y0], [x1, y0], [x1, 0], [x0, 0]], { width: 3.6, corner: .5, over: 14 }));
    S_.push(stroke('rack/top', [[x0, y0], [x0 + dx, y0 + dy], [x1 + dx, y0 + dy], [x1, y0]], { width: 3.2, corner: .5 }));
    S_.push(stroke('rack/side', [[x1 + dx, y0 + dy], [x1 + dx, dy], [x1, 0]], { width: 3.2, corner: .5 }));
    const sx = dx / 2, sy = y0 + dy / 2;
    S_.push(loopStroke('rack/slot', [[sx - 130, sy - 4], [sx + 126, sy - 4], [sx + 130, sy + 4], [sx - 126, sy + 4]], { width: 2.6, corner: .5, over: 6 }));
    for (let k = 0; k < UNITS; k++) {
      const y = unitY(k);
      S_.push(loopStroke('rack/u' + k, rrectPts(x0 + 18, y, fw - 36, 70, 6, 2), { width: 2.3, opacity: .85, start: 1, over: 6 }));
      for (let j = 0; j < 2; j++) S_.push(stroke(`rack/v${k}/${j}`, [[x0 + 40, y + 28 + j * 14], [x0 + 120, y + 28 + j * 14]], { width: 1.3, opacity: .5, pressure: PRESS.inner }));
      for (let j = 0; j < 2; j++) S_.push(stroke(`rack/led${k}/${j}`, ellPoints(x1 - 66 + j * 28, y + 35, 7, 7, 0, TAU, 10), { width: 1.9, corner: 2 }));
    }
    { const t = .5; S_.push(stroke('rack/sh/1', [[x1 + dx * t + 2, y0 + dy * t + 12], [x1 + dx * t + 2, dy * t - 8]], { width: 1.2, opacity: .4, pressure: PRESS.inner })); }
    for (let k = 0; k < 10; k++) { const x = x0 + 16 + k * (fw + dx - 20) / 10; S_.push(stroke('rack/shadow/' + k, [[x, 12], [x + 16, 6]], { width: 1.2, opacity: .38, pressure: PRESS.inner })); }
    return { strokes: S_ };
  }
  // the laptop still showing the page from a2: "Refund requested" with a graphite check
  function pageRaw() {
    const S_ = [...windowDrawing(-284, -174, 568, 348, { bar: 46 }).strokes.map(s => ({ ...s, id: 'pg/' + s.id }))];
    S_.push(loopStroke('pg/addr', rrectPts(-190, -163, 452, 26, 13, 3), { width: 1.5, opacity: .7, pressure: PRESS.inner, start: 1, over: 8 }));
    S_.push(...scrawl('pg/url', -172, -145, 170, 9, 5, { width: 1.4, opacity: .6 }));
    S_.push(checkStroke('pg/check', -34, -6, 1.7, { width: 6 }));
    S_.push(...textStrokes('Refund requested', 0, 86, { cap: 36, align: 'center', condense: .84, id: 'pg/t', seed: 19 }).strokes);
    return { strokes: S_ };
  }
  let D = null;
  function build() {
    if (D) return D;
    const mac = macDrawing(LAP.dw, LAP.dh, { port: false });
    D = { lap: compile(mac, 'a3/lap'), page: compile(pageRaw(), 'a3/page'), rack: compile(rackRaw(), 'a3/rack') };
    return D;
  }
  build();

  // ---- timing ----
  // Inside the rack the room (floor, wall, file cabinet, desk, lamp, socket, plug, cable) is already there
  // at the cut (and his keyboard on the desk); the pencil comes in and draws the agent, his printer and his
  // in-tray (in front of the printer's left end) at hand speed.
  const agentLen = (() => { const g = document.createElement('canvas').getContext('2d'); AGENT.draw(g, 0, 0, 1, 'rest', { progress: .5 }); return _compiled.get('agent/rest').plan.total; })();
  const T = { slide: HAS_SC ? [.17, .83] : [0, 0] };
  T.rack = HAS_SC ? [.5, .5 + drawTime(D.rack, 5000)] : [.2, .2 + drawTime(D.rack, 5000)];   // near hand speed
  T.lights = g12(T.rack[1] + .05); T.slipOut = [g12(T.lights + .08), g12(T.lights + .08) + .25]; T.slipFly = [T.slipOut[1], T.slipOut[1] + .62]; T.slipIn = [T.slipFly[1], T.slipFly[1] + .25];
  T.busy = [T.slipIn[1] - .05, T.slipIn[1] + .45]; T.push = [g12(T.slipIn[1] + .12), g12(T.slipIn[1] + .12) + .72]; T.cut = T.push[1];
  const lapAt = q => !HAS_SC ? null : q < T.slide[0] ? SC.HOME : q >= T.slide[1] ? WIDE : (u => ({ x: lerp(SC.HOME.x, WIDE.x, u), y: lerp(SC.HOME.y, WIDE.y, u), s: lerp(SC.HOME.s, WIDE.s, u) }))(sm(T.slide[0], T.slide[1], q, easeIO));
  // where the request leaves the screen (world): the middle of the page
  const slipFrom = HAS_SC ? SC.toWorld(WIDE, [0, -20]) : [LAP.x, LAP.y];
  // the pencil's jobs in the room, at hand speed (DRAW_SPEED), at least 6 frames each; each pencil move
  // takes time in proportion to its distance (>= 0.1 s, >= 0.2 s for 300 px)
  const tipAt = (id, u) => ({ agent: u => u < 1 ? RM.celTip(_compiled.get('agent/rest'), u, SD.AG.x, SD.AG.y) : [SD.AG.x + 118, SD.AG.y - 20],
    tray: u => RM.celTip(SD.D.tray, u, SD.TRAY.x, SD.TRAY.y), printer: u => RM.celTip(SD.D.printer, u, SD.PRINTER.x, SD.PRINTER.y) })[id](u);
  const ROOM_PARTS = [['agent', agentLen], ['printer', SD.D.printer.plan.total], ['tray', SD.D.tray.plan.total]];
  { let t = T.cut + .45, prev = null;   // .45 s: the pencil enters from off-frame after the cut
    for (const [k, len] of ROOM_PARTS) {
      if (prev) { const a = tipAt(prev, 1), b = tipAt(k, 0); t += Math.max(.1, Math.hypot(b[0] - a[0], b[1] - a[1]) / 1500); }
      T[k] = [t, t + Math.max(.25, len / DRAW_SPEED)]; t = T[k][1]; prev = k;
    }
    T.roomDone = t; }
  T.drop = [g12(T.roomDone + .2), g12(T.roomDone + .2) + .45];
  const L0 = g12(T.drop[1] + .25);                    // the acting starts here
  // take the request, read it, put it back
  T.antic = L0; T.reach = g12(L0 + .25); T.grab = L0 + .54; T.toRead = g12(L0 + .62); T.read = L0 + .96; T.putBack = g12(L0 + 1.58); T.release = g12(L0 + 1.83);
  // look up the order: he turns to the cabinet, dips, reaches toward it (under the lamp); the drawer answers:
  // it slides out (2 drawings), the folder rises out of it; later the folder sinks and the drawer shuts (2 drawings)
  T.toRest1 = T.release; T.look = g12(T.toRest1 + .17); T.dip = g12(T.look + .17); T.toPoint = g12(T.dip + 1 / 12); T.accent = g12(T.toPoint + .25);
  T.drawer = [T.accent + 1 / 12, T.accent + 1 / 12 + 1 / 6]; T.folder = [T.drawer[1], T.drawer[1] + .42]; T.lower = g12(T.accent + .33);
  T.found = g12(T.folder[1]); T.nod = g12(T.found + 1 / 12);
  T.back = [g12(T.nod + .67), g12(T.nod + .67) + .25]; T.shut = [T.back[1], T.back[1] + 1 / 6];
  // type, the email is drawn, the receipt prints, he sits back
  T.toType = g12(T.shut[0] + .08); T.type = [T.toType + .17, T.toType + .17 + .83];
  T.mail = [g12(T.type[0] + .25), g12(T.type[0] + .25) + .42];      // the email he is writing: drawn by the pencil (0.42 s)
  T.print = [g12(T.type[0] + .5), g12(T.type[0] + .5) + .67]; T.sitBack = g12(T.type[1]);
  const cap = [makeCaption('a3a', { lines: ['Behind the scenes,', 'an AI agent handles it.'], t0: g12(T.agent[0] + .3), hold: 3.9 })];
  // ends once he has sat back, the receipt is out and the pencil has left the frame
  const DUR = +(Math.max(T.sitBack + .5, T.print[1] + .3, T.mail[1] + .72, cap[0].end + .2)).toFixed(3);

  // ---- the agent's performance (pose keys on twos) ----
  const DIP = ['rest', 'slump', .17];
  const POSES = [[0, 'rest'],
    [T.antic, ['rest', 'typeA', .34], .12], [T.reach, RM.LOWREACH, .25, easeOut], [T.toRead, RM.READ, .3], [T.putBack, RM.LOWREACH, .25],
    [T.toRest1, 'rest', .17], [T.dip, DIP, 0], [T.toPoint, RM.REACH_L, .25, easeOut], [T.lower, 'rest', .25],
    // the nod: down, up, down, up; two drawings each way, on twos
    [T.nod, RM.NOD, 1 / 6], [T.nod + 1 / 6, 'rest', 1 / 6], [T.nod + 2 / 6, RM.NOD, 1 / 6], [T.nod + 3 / 6, 'rest', 1 / 6],
    [T.toType, 'typeA', .16]];
  // looks: [time, face]; his eyes follow his hands: 'sideR' for the tray and the printer (our right), 'side' for
  // the cabinet (our left), 'down' to read and to type
  const LOOKS = [[0, 'open'], [g12(T.drop[0] + 1 / 12), 'sideR'], [T.toRead, 'down'], [T.putBack, 'sideR'],
    [T.look, 'side'], [T.found, 'happy'], [T.toType, 'down'], [g12(T.print[0] + 1 / 6), 'sideR'], [T.sitBack + 1 / 12, 'open']];
  const BLINKS = [g12(T.agent[1] + .55), g12(T.read + .42), g12(T.back[0] + .08), g12(T.sitBack + .42)];
  function pose(q) {
    if (q >= T.type[0] && q < T.type[1]) return Math.floor((q - T.type[0]) * 6) % 2 ? 'typeB' : 'typeA';   // 4 frames each
    if (q >= T.type[1]) return RM.track(q, [[0, 'typeA'], [T.sitBack, 'rest', .25]]);
    return RM.track(q, POSES);
  }
  // the request: dropping into the tray, in his hands, back into the tray
  function slipState(q) {
    if (q < T.drop[0]) return { slipAt: null, flying: null, held: null };
    if (q < T.drop[1]) { const u = sm(T.drop[0], T.drop[1], q, easeIn), S = RM.TRAY_SLIP;
      const p = bez([1660, -60], [1560, 260], [1260, 560], [S.x, S.y], u), at = { x: p[0], y: p[1], s: S.s, rot: lerp(.9, S.rot, u) };
      return u > .8 ? { slipAt: { ...at, clipY: RM.TRAY_LIP }, flying: null, held: null } : { slipAt: null, flying: at, held: null }; }
    if (q < T.grab) return { slipAt: RM.inTray, held: null };
    if (q < T.putBack + .25) return { slipAt: null, held: q < T.putBack ? easeIO(clamp((q - T.toRead) / .3, 0, 1)) : 1 - easeIO(clamp((q - T.putBack) / .25, 0, 1)) };   // the slip moves with his hands (same easing)
    if (q < T.release) return { slipAt: null, held: 0 };
    if (q < T.release + .17) { const u = sm(T.release, T.release + .17, q, easeIn), S = RM.TRAY_SLIP; return { slipAt: { x: lerp(1170, S.x, u), y: lerp(736, S.y, u), s: S.s, rot: lerp(-.1, S.rot, u), clipY: RM.TRAY_LIP }, held: null }; }
    return { slipAt: RM.inTray, held: null };
  }
  function roomState(tau) {
    const q = tw(tau);
    const drawerK = q < T.drawer[0] ? 0 : q < T.drawer[0] + 1 / 12 ? .5 : q < T.shut[0] ? 1 : q < T.shut[0] + 1 / 12 ? .5 : 0;   // two drawings each way
    const folder = q < T.folder[0] ? 0 : q < T.back[0] ? easeOutBack(clamp((q - T.folder[0]) / (T.folder[1] - T.folder[0]), 0, 1), 1.4) : 1 - sm(T.back[0], T.back[1], q, easeIn);
    const printing = q >= T.print[0] && q < T.print[1];
    return { ...RM.BASE, pose: pose(q), ...RM.lookAt(q, LOOKS, BLINKS), ...slipState(q),
      drawer: drawerK, folder, receipt1: q < T.print[0] ? 0 : 150 * sm(T.print[0], T.print[1], q, x => x),
      envelope: null, led: printing && Math.floor(q * 6) % 2 === 0 ? 1 : 0 };
  }

  // ---- the pencil's jobs ----
  const stWide = makeStage([
    { id: 'rack', t: T.rack, pencil: true, ones: true, color: 'graphite', enter: .3, render(c, u) { c.save(); c.translate(RACK.x, RACK.y); pencilMarks(c, D.rack, { progress: u }); c.restore(); return RM.celTip(D.rack, u, RACK.x, RACK.y); } },
  ]);
  const partItem = (id, render) => ({ id, t: T[id], pencil: true, ones: true, color: 'graphite', enter: .45, render });
  const stRoom = makeStage([
    partItem('agent', (c, u) => RM.agent(c, { pose: 'rest', face: 'open', progress: u }) ?? [SD.AG.x, SD.AG.y - 300]),
    // the printer and the tray are drawn by the room at their place in the draw order (behind his hands);
    // these items only tell the pencil where the drawing is
    partItem('tray', (c, u) => tipAt('tray', u)),
    partItem('printer', (c, u) => tipAt('printer', u)),
    // the email is drawn by the room (standing behind the keyboard, under his typing hands); this item only
    // tells the pencil where the drawing is (it renders into the scratch context)
    { id: 'mail', t: T.mail, pencil: true, ones: true, color: 'graphite', enter: .45, render(c, u) { return RM.envelope(scratchCtx(), { u }); } },
  ]);
  const stage = { scratch: off => [...stWide.scratch(off), ...stRoom.scratch(off)] };

  // ---- the wide shot ----
  function wide(c, tau) {
    const q = tw(tau);
    // the push: the camera turns to the rack first (pan leads), then dives into its slot (zoom lags)
    const pu = clamp((tau - T.push[0]) / (T.push[1] - T.push[0]), 0, 1), pan = easeInOutSine(clamp(pu / .7, 0, 1)), zoom = Math.exp(lerp(0, Math.log(4.4), easeIn(pu)));
    cam(c, lerp(CX, SLOT_R[0], pan), lerp(CY, SLOT_R[1] + 60, pan), zoom);
    paperSheet(c);
    const fade = 1 - sm(T.push[0] + .45, T.push[1] - .02, tau, easeIn);
    c.save(); c.globalAlpha = fade;
    if (HAS_SC) { const at = lapAt(q); SC.body(c, { at }); SC.screen(c, SC.END_A2, { at }); }
    else { c.save(); c.translate(LAP.x, LAP.y); pencilMarks(c, D.lap); pencilMarks(c, D.page); c.restore(); }
    stWide.begin(); stWide.draw(c, tau, 'rack');
    // blinking lights (on twos); a busy flurry while the request goes in
    if (q >= T.lights) for (let k = 0; k < UNITS; k++) for (let j = 0; j < 2; j++) {
      const busy = q >= T.busy[0] && q < T.busy[1], beat = Math.floor(q * 12 / (busy ? 1 : 3));
      if (hash(k * 7 + j * 3 + beat * 13, 5) > (busy ? .35 : .55)) { c.save(); c.fillStyle = COL.graphite; c.globalAlpha *= .8; c.beginPath(); c.arc(RACK.x + RACK.fw / 2 - 66 + j * 28, RACK.y + unitY(k) + 35, 4.6, 0, TAU); c.fill(); c.restore(); }
    }
    // the request slip: out of the screen, across, into the slot
    if (q >= T.slipOut[0] && q < T.slipIn[1]) {
      let x, y, s, rot = 0, clip = null;
      if (q < T.slipOut[1]) { const u = sm(T.slipOut[0], T.slipOut[1], q, easeOut); x = slipFrom[0]; y = lerp(slipFrom[1] + 10, slipFrom[1] - 60, u); s = lerp(.3, 1, u); }
      else if (q < T.slipFly[1]) { const u = sm(T.slipFly[0], T.slipFly[1], q, easeIO), p = arc([slipFrom[0], slipFrom[1] - 60], [SLOT_R[0], SLOT_R[1] - 80], u, 170); x = p[0]; y = p[1]; s = 1; rot = Math.sin(u * Math.PI) * .1; }
      else { const u = sm(T.slipIn[0], T.slipIn[1], q, easeIn); x = SLOT_R[0]; y = lerp(SLOT_R[1] - 80, SLOT_R[1] + 76, u); s = 1; clip = SLOT_R[1]; }
      RM.slip(c, { x, y, s, rot, clipY: clip ?? undefined });
    }
    c.restore();
    if (tau < T.push[0]) stWide.pencil(c, tau, { rest: .6 });
  }
  // ---- the room ----
  function room(c, tau) {
    cam(c, SD.CAM.x, SD.CAM.y, SD.CAM.zoom); paperSheet(c);
    const s = roomState(tau);
    stRoom.begin();
    const done = k => progressOf(stRoom.byId[k], tau) >= 1, parts = {};
    for (const [k] of ROOM_PARTS) parts[k] = k === 'agent' ? (done(k) ? 1 : 0) : progressOf(stRoom.byId[k], tau);
    const uMail = progressOf(stRoom.byId.mail, tau);
    RM.frame(c, { ...s, parts, envelope: uMail > 0 ? { u: uMail } : null });
    // parts being drawn right now (over the finished room)
    for (const [k] of ROOM_PARTS) if (!done(k)) stRoom.draw(c, tau, k);
    if (!done('mail')) stRoom.draw(c, tau, 'mail');
    stRoom.pencil(c, tau, { rest: .6, home: [W + 320, H * .6] });
  }
  function scene(c, tau) {
    if (tau < T.cut) wide(c, tau); else room(c, tau);
    resetT(c); for (const k of cap) k.draw(c, tau);
    vignette(c);
  }
  SCENES.push({ key: 'a3', name: 'behind the scenes', dur: DUR, fn: scene, captions: cap, stage,
    cues: [
      { t: T.rack[0], type: 'pencil' }, { t: T.lights, type: 'hum-on' }, { t: T.slipOut[0], type: 'paper' }, { t: T.slipFly[0], type: 'whoosh' },
      { t: T.slipIn[0] + .1, type: 'paper' }, { t: T.push[0] + .2, type: 'whoosh' }, { t: T.agent[0], type: 'pencil' },
      { t: T.drop[1] - .05, type: 'paper' }, { t: T.read, type: 'read' }, { t: T.drawer[0], type: 'drawer' }, { t: T.nod, type: 'nod' }, { t: T.shut[0], type: 'drawer' },
      { t: T.type[0], type: 'type', dur: +(T.type[1] - T.type[0]).toFixed(3) }, { t: T.mail[0], type: 'pencil' }, { t: T.print[0], type: 'print', dur: +(T.print[1] - T.print[0]).toFixed(3) },
    ] });
})();
