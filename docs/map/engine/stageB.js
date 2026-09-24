// Copied from temporal-film (stageB.js), unmodified.
'use strict';
// ============================================================
// Stage B, shared by scenes 4, 5 and 6.
// Temporal's notebook on the left (all indigo), the worker Mac on the right with the
// Claude engine (a locked box) in a window, a wall socket at the lower right.
// Positions are world units on the 1920 x 1080 sheet; drawings stay below the caption band.
// ============================================================
const SB = (() => {
  const NB = { x: 60, y: 330, w: 700, h: 700 };
  const rowY = k => NB.y + 184 + k * 84;          // entry baselines, k = 0..4
  const TX = NB.x + 80;                           // entry text x
  const MAC = { x: 1450, y: 575, dw: 560, dh: 350 };
  const WIN = { x: MAC.x - 270, y: MAC.y - 165, w: 540, h: 330, bar: 84 };
  const BOX = { x: MAC.x - 18, y: MAC.y + 52 };  // centre of the box's front face
  const SOCK = { x: 1790, y: 930, s: 1.35 };     // centre of the socket face; the rig is drawn 1.35x
  const COINS = { x: 960, y: 918 };
  const MID = { x: 945, y: 468 };                // where slips wait between box and notebook
  const RECEIPT = { x: 915, y: 590, s: 1 };      // centre of the refund receipt (full size: text >= 44 px)
  const ENTRY = ['', '', 'look_up_order', 'issue_refund', 'email_customer'];
  const ENTRY_CAP = 38, ENTRY_CD = .82, ROW_X = 70;   // nominal 38 = 51 px real capitals

  const D = {};
  function build() {
    if (D.nb) return D;
    const nbRaw = notebookDrawing(NB.w, NB.h), isNbDetail = s => /^nb\/(ring|hole|rule)\//.test(s.id);
    D.nb = compile({ strokes: nbRaw.strokes.filter(s => !isNbDetail(s)) }, 'sb/nb');
    D.nbDetail = compile({ strokes: nbRaw.strokes.filter(isNbDetail) }, 'sb/nb-detail');
    const head = textStrokes('Temporal', 150, 112, { cap: 52, id: 'sb/nbh', seed: 3 });
    D.nbHead = compile({ strokes: [...head.strokes, stroke('sb/nbh/u', bow([146, 127], [150 + head.width + 6, 123], 2, 5), { width: 2.6 })] }, 'sb/nbhead');
    D.rowText = []; D.rowCheck = []; D.checkX = [];
    for (let k = 0; k < 5; k++) {
      const y = rowY(k) - NB.y; let strokes, w;
      if (!ENTRY[k]) { const sw = k ? 360 : 430; strokes = scrawl('sb/row' + k, ROW_X, y - 2, sw, 26, 4 + k * 5, { width: 3, opacity: .9 }); w = sw; }
      else { const t = textStrokes(ENTRY[k], ROW_X, y, { cap: ENTRY_CAP, condense: ENTRY_CD, id: 'sb/row' + k, seed: 5 + k, width: 3 }); strokes = t.strokes; w = t.width; }
      D.rowText[k] = compile({ strokes }, 'sb/rowtext' + k);
      D.checkX[k] = NB.x + ROW_X + w + 26 + (ENTRY[k] ? 0 : 40);
      D.rowCheck[k] = compile({ strokes: [checkStroke('sb/chk' + k, 0, 0)] }, 'sb/rowcheck' + k);
    }
    const macRaw = macDrawing(MAC.dw, MAC.dh, { port: true }), isKey = s => s.id.startsWith('key/');
    D.mac = compile({ strokes: macRaw.strokes.filter(s => !isKey(s)) }, 'sb/mac');
    D.macKeys = compile({ strokes: macRaw.strokes.filter(isKey) }, 'sb/mac-keys');
    D.win = compile(windowDrawing(WIN.x - MAC.x, WIN.y - MAC.y, WIN.w, WIN.h, { bar: WIN.bar }), 'sb/win');
    D.title = compile({ strokes: textStrokes('Claude engine', WIN.x - MAC.x + 120, WIN.y - MAC.y + 56, { cap: 34, condense: .8, id: 'sb/title', seed: 8, width: 2.6 }).strokes }, 'sb/title');
    D.box = compile(boxDrawing(250, 140), 'sb/box');
    D.socket = compile(socketDrawing(), 'sb/socket');
    D.plug = compile(plugDrawing(), 'sb/plug');
    D.prongs = compile(prongsDrawing(), 'sb/prongs');
    D.cable = compile(cableFor(0), 'sb/cable');
    D.hand = { reach: compile(handDrawing('reach'), 'sb/hand-reach'), grip: compile(handDrawing('grip'), 'sb/hand-grip') };
    D.handFill = { reach: handFillPath('reach'), grip: handFillPath('grip') };
    D.coins = compile(coinsDrawing(), 'sb/coins');
    D.receipt = compile(receiptDrawing({}), 'sb/receipt');
    D.slipLook = compile(slipDrawing('look_up_order'), 'sb/slip-look');
    D.slipAnswer = compile(slipDrawing('49.99 EUR', { w: compile(slipDrawing('look_up_order'), 'sb/slip-look').bounds[2] }), 'sb/slip-answer');
    D.slipRefund = compile(slipDrawing('issue_refund', { w: D.slipLook.bounds[2] }), 'sb/slip-refund');
    D.stamp = compile(stampDrawing(), 'sb/stamp');
    D.approved = compile(approvedDrawing(), 'sb/approved');
    D.clock = compile(clockDrawing(30), 'sb/clock');
    D.envelope = compile(envelopeDrawing(), 'sb/envelope');
    D.spark = compile(sparkDrawing(), 'sb/spark');
    D.coin = compile(coinDrawing('sb/coin1'), 'sb/coin1');
    return D;
  }
  const slipW = () => build().slipLook.bounds[2];

  // ---- drawing helpers (world space; progress 0..1 where it applies) ----
  function notebook(c, o = {}) {
    const d = build(); c.save(); c.translate(NB.x, NB.y);
    pencilMarks(c, d.nb, { progress: o.page ?? 1, color: 'indigo' });
    const det = clamp(((o.page ?? 1) - .35) / .65, 0, 1); if (det > 0) pencilMarks(c, d.nbDetail, { progress: tw(det * 2) / 2 >= .999 ? 1 : det, color: 'indigo' });
    if ((o.logo ?? 1) > 0) drawLogo(c, 'temporal', 100, 96, 68, o.logo ?? 1, { color: 'indigo' });
    if ((o.head ?? 1) > 0) pencilMarks(c, d.nbHead, { progress: o.head ?? 1, color: 'indigo' });
    c.restore();
    notebookRows(c, o);
  }
  // rows: array of [textProgress, checkProgress] per row
  function notebookRows(c, o = {}) {
    const d = build(), rows = o.rows ?? [];
    rows.forEach((r, k) => {
      if (!r) return; const [tp, cp] = r;
      c.save(); c.translate(NB.x, NB.y); if (tp > 0) pencilMarks(c, d.rowText[k], { progress: tp, color: 'indigo', alpha: o.alpha ?? 1 }); c.restore();
      if (cp > 0) { c.save(); c.translate(d.checkX[k], rowY(k)); pencilMarks(c, d.rowCheck[k], { progress: cp, color: o.checkColor?.[k] ?? 'indigo', alpha: o.alpha ?? 1 }); c.restore(); }
    });
  }
  function mac(c, o = {}) {
    const d = build(); c.save(); c.translate(MAC.x + (o.dx ?? 0), MAC.y);
    const a = o.alpha ?? 1;
    pencilMarks(c, d.mac, { progress: o.body ?? 1, alpha: a });
    const keys = clamp(((o.body ?? 1) - .55) / .45, 0, 1); if (keys > 0) pencilMarks(c, d.macKeys, { progress: keys, alpha: a });
    if ((o.win ?? 1) > 0) pencilMarks(c, d.win, { progress: o.win ?? 1, alpha: a });
    if ((o.title ?? 1) > 0) { pencilMarks(c, d.title, { progress: o.title ?? 1, alpha: a }); }
    if ((o.spark ?? 1) > 0) { c.save(); c.globalAlpha *= a; drawLogo(c, 'claude', WIN.x - MAC.x + 92, WIN.y - MAC.y + WIN.bar / 2 + 1, 34, o.spark ?? 1); c.restore(); }
    if ((o.box ?? 1) > 0) { c.save(); c.translate(BOX.x - MAC.x, BOX.y - MAC.y); pencilMarks(c, d.box, { progress: o.box ?? 1, alpha: a }); c.restore(); }
    c.restore();
  }
  // plug pulled out by `pull` px; cable end follows the plug
  // Socket, plug, cable and hand as one rig in socket-local units (x left of the face is negative),
  // drawn SOCK.s times larger. pull = how far the plug has left the socket (local units).
  // hand = {pose, x, y, rot} relative to the plug body's centre (-75, 0 in plug space).
  function socketPlug(c, o = {}) {
    const d = build(), pull = o.pull ?? 0, a = o.alpha ?? 1, pa = o.plugAlpha ?? a, s = SOCK.s;
    // cable first (world space), ending at the plug's tail
    if (pa > 0) pencilMarks(c, pull > 1 ? cablePulled(pull) : d.cable, { progress: o.cable ?? 1, alpha: pa });
    c.save(); c.translate(SOCK.x, SOCK.y); c.scale(s, s);
    pencilMarks(c, d.socket, { progress: o.socket ?? 1, alpha: a });
    if (pa > 0) {
      if (pull > 1) { c.save(); c.translate(-pull, 0); c.beginPath(); c.rect(0, -40, Math.max(0, pull), 80); c.clip(); pencilMarks(c, d.prongs, { alpha: pa }); c.restore(); }
      c.save(); c.translate(-pull, 0); c.fillStyle = COL.paper; c.globalAlpha *= pa * Math.min(1, (o.plug ?? 1) * 1.5); c.fill(plugFillPath()); c.globalAlpha = 1; pencilMarks(c, d.plug, { progress: o.plug ?? 1, alpha: pa }); c.restore();
    }
    if (o.hand) { const h = o.hand; c.save(); c.translate(-75 - pull + (h.x ?? 0), h.y ?? 0); if (h.rot) c.rotate(h.rot);
      c.fillStyle = COL.paper; c.fill(d.handFill[h.pose]); pencilMarks(c, d.hand[h.pose], { alpha: h.alpha ?? 1 }); c.restore(); }
    if (o.spark) { c.save(); c.translate(-2, 0); pencilMarks(c, d.spark, { color: 'red', alpha: o.spark }); c.restore(); }
    c.restore();
  }
  const _cables = new Map();
  function cablePulled(pull) { const q = Math.round(pull / 5) * 5; if (!_cables.has(q)) _cables.set(q, compile(cableFor(q), 'sb/cable@' + q)); return _cables.get(q); }
  function cableFor(pull) { const a = [MAC.x + 350, MAC.y + 256], b = [SOCK.x - (150 + pull) * SOCK.s, SOCK.y]; return cableDrawing(a, b, 70, [[a[0] - 220, a[1] + 30], [b[0] - 110, b[1] - 40]]); }
  function coins(c, u = 1, o = {}) { const d = build(); c.save(); c.translate(COINS.x, COINS.y); pencilMarks(c, d.coins, { progress: u, alpha: o.alpha ?? 1 }); c.restore(); }
  function receipt(c, o = {}) {
    const d = build(), s = (o.s ?? RECEIPT.s), w = d.receipt.bounds[2], h = 400;
    c.save(); c.translate(o.x ?? RECEIPT.x, o.y ?? RECEIPT.y); c.rotate(o.rot ?? -.025); c.scale(s, s); c.translate(-w / 2, -h / 2);
    c.fillStyle = COL.paper; c.globalAlpha = o.alpha ?? 1; c.fillRect(0, 0, w, h); c.globalAlpha = 1;
    pencilMarks(c, d.receipt, { progress: o.u ?? 1, color: o.color ?? 'graphite', alpha: o.alpha ?? 1 }); c.restore();
  }
  // a slip centred at x,y, scale s, optional paper fill; which = look|answer|refund
  const _slipParts = new Map();
  function slipParts(cel, key) {
    if (!_slipParts.has(key)) { const mk = strokes => { const q = { strokes }; q.plan = makePlan(q); return q; };
      _slipParts.set(key, { body: mk(cel.strokes.filter(s => !s.id.startsWith('slip/t'))), text: mk(cel.strokes.filter(s => s.id.startsWith('slip/t'))) }); }
    return _slipParts.get(key);
  }
  function slip(c, which, x, y, o = {}) {
    const d = build(), cel = { look: d.slipLook, answer: d.slipAnswer, refund: d.slipRefund }[which], w = cel.bounds[2], a = o.alpha ?? 1, ap = o.approved ?? 0;
    c.save(); c.translate(x, y); c.rotate(o.rot ?? 0); c.scale(o.s ?? 1, o.s ?? 1);
    c.fillStyle = COL.paper; c.globalAlpha *= a; c.fillRect(-w / 2, -44, w, 88); c.globalAlpha /= a || 1;
    if (!ap || (o.u ?? 1) < 1) pencilMarks(c, cel, { progress: o.u ?? 1, alpha: a });
    else { const p = slipParts(cel, which); pencilMarks(c, p.body, { alpha: a }); pencilMarks(c, p.text, { alpha: a * lerp(1, .26, ap) }); }
    if (ap) { const bw = d.approved.bounds[2];
      c.save(); c.beginPath(); c.rect(-w / 2, -44, w, 88); c.clip();            // ink lands only on the paper
      c.translate(0, 2); c.rotate(-.05); c.beginPath(); c.rect(-bw / 2 - 6, -47, bw + 12, 94); c.clip();
      pencilMarks(c, d.approved, { progress: 1, alpha: a * ap, widthScale: 1.1 }); c.restore(); }
    c.restore();
  }
  return { cableFor, NB, MAC, WIN, BOX, SOCK, COINS, MID, RECEIPT, rowY, TX, ENTRY, build, slipW, notebook, notebookRows, mac, socketPlug, coins, receipt, slip, D };
})();

// the spark when the plug leaves the socket: short red strokes out of the gap
function sparkDrawing() {
  const S_ = [], r = rng(17);
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI / 2 + (k - 4) * .38 + (r() - .5) * .2, L0 = 14 + r() * 8, L1 = 46 + r() * 34;
    S_.push(stroke('spark/' + k, [[Math.cos(a) * L0, Math.sin(a) * L0], [Math.cos(a) * L1, Math.sin(a) * L1]], { width: 4, pressure: [[0, .5], [.3, 1], [1, .3]] }));
  }
  S_.push(stroke('spark/zig', [[-6, -16], [8, -34], [-4, -44], [12, -66]], { width: 3.6, corner: .3 }));
  S_.push(stroke('spark/zig2', [[4, 16], [-10, 34], [6, 46], [-8, 66]], { width: 3.2, corner: .3 }));
  return { strokes: S_ };
}
