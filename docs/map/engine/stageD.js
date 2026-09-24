// Copied from temporal-film (stageD.js), unmodified.
'use strict';
// ============================================================
// Stage D: the agent's room, inside the server. Shared by the v2 scenes where the
// agent works (behind the scenes, the crash, no memory, the fix, the crash again).
// World units on the 1920 x 1080 sheet; everything stays below the caption band.
//
//   file cabinet | lamp  [ desk with the agent ]  in-tray  printer |      wall + socket
//   (look_up_order)       (his notebook lies left)  (requests) (receipts)   (power)
// ============================================================
const SD = (() => {
  const DESK = { x: 1050, y: 812, w: 880 };         // top edge centre (610..1490); the agent sits behind it at AG
  const AG = { x: 960, y: 812, s: 1 };              // agent origin (= desk top centre)
  const LAMP = { x: 700, y: 812 };                  // base centre, on the desk
  const TRAY = { x: 1150, y: 812 };                 // in-tray, on the desk (drawn after the printer, in front of its left end)
  const PRINTER = { x: 1340, y: 812, slot: 64, half: 136 };   // receipt printer (as wide as its receipts); slot at y - slot, x +- half
  const CAB = { x: 380, y: 968 };                   // file cabinet, standing on the floor (bottom centre)
  const FLOOR = 968;
  const WALL = 1800;                                // the right wall (the socket is on it)
  const SOCK = { x: 1766, y: 900, s: 1.2 };         // socket rig, drawn 1.2x, plug to the left
  const NOTE = { x: 800, y: 804 };                  // his notebook, closed, on the desk
  const ENV = { x: 1010, y: 804 };                 // the ready email: in front of him, clear of his right hand
  const CAM = { x: 1000, y: 522, zoom: 1.12 };      // room shots: cam(c, CAM.x, CAM.y, CAM.zoom) keeps the agent below the caption band
  const D = {};
  function build() {
    if (D.desk) return D;
    D.desk = compile(deskDrawing(DESK.w, FLOOR - DESK.y), 'sd/desk');
    D.room = compile(roomDrawing(), 'sd/room');
    D.lamp = compile(lampDrawing(), 'sd/lamp');
    D.rays = compile(raysDrawing(), 'sd/rays');
    D.tray = compile(trayDrawing(), 'sd/tray');
    D.printer = compile(printerDrawing(), 'sd/printer');
    D.cab = compile(cabinetDrawing(), 'sd/cab');
    D.drawer = compile(drawerOutDrawing(), 'sd/drawer');
    D.folder = compile(folderDrawing(), 'sd/folder');
    D.socket = compile(socketDrawing(), 'sd/socket');
    D.plug = compile(plugDrawing(), 'sd/plug');
    D.prongs = compile(prongsDrawing(), 'sd/prongs');
    D.hand = { reach: compile(handDrawing('reach'), 'sd/hand-reach'), grip: compile(handDrawing('grip'), 'sd/hand-grip') };
    D.handFill = { reach: handFillPath('reach'), grip: handFillPath('grip') };
    D.spark = compile(sparkDrawing(), 'sd/spark');
    D.nbClosed = compile(notebookClosedDrawing(), 'sd/nb-closed');
    D.request = compile(requestSlipDrawing(), 'sd/request');
    D.miniReceipt = compile(miniReceiptDrawing(), 'sd/mini-receipt');
    D.envelope = compile(envelopeDrawing(120, 80), 'sd/envelope');
    D.question = compile(questionDrawing(.55), 'sd/q');
    return D;
  }
  const cable = (pull = 0) => { const q = Math.round(pull / 5) * 5; return _cab.get(q) ?? (_cab.set(q, compile(cableDrawing([LAMP.x - 30, DESK.y + 10], [SOCK.x - (150 + q) * SOCK.s, SOCK.y], 60,
    [[LAMP.x - 60, FLOOR - 20], [SOCK.x - (150 + q) * SOCK.s - 160, SOCK.y + 50]]), 'sd/cable@' + q)), _cab.get(q)); };
  const _cab = new Map();

  // ---- the room: floor, the wall corner; light on/off ----
  function room(c, o = {}) {
    const d = build(); pencilMarks(c, d.room, { progress: o.u ?? 1, alpha: o.alpha ?? 1 });
  }
  // darkness when the power is off: soft graphite hatching over the whole room
  // (drawn through a layer so it fades out under the caption band: captions stay on a quiet ground)
  function dark(c, k) {
    if (k <= 0) return;
    const [L] = fxLayers(), g = L.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, L.width, L.height); g.setTransform(c.getTransform());
    g.fillStyle = 'rgba(40,36,30,0.30)'; g.fillRect(-400, -400, W + 800, H + 800);
    g.strokeStyle = 'rgba(30,28,24,0.35)'; g.lineWidth = 1.3; g.beginPath();
    for (let x = -600; x < W + 600; x += 11) { g.moveTo(x, -200); g.lineTo(x + 520, H + 300); } g.stroke();
    g.setTransform(S, 0, 0, S, 0, 0); g.globalCompositeOperation = 'destination-out';
    const gr = g.createLinearGradient(0, 0, 0, 330); gr.addColorStop(0, 'rgba(0,0,0,.82)'); gr.addColorStop(.7, 'rgba(0,0,0,.82)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, 330); g.globalCompositeOperation = 'source-over';
    c.save(); resetT(c); c.globalAlpha *= k; c.drawImage(L, 0, 0, W, H); c.restore();
  }
  function lamp(c, on = 1, u = 1) {
    const d = build(); c.save(); c.translate(LAMP.x, LAMP.y); pencilMarks(c, d.lamp, { progress: u });
    if (on > 0 && u >= 1) pencilMarks(c, d.rays, { alpha: on * .8 });
    c.restore();
  }
  function desk(c, u = 1) { const d = build(); c.save(); c.translate(DESK.x, DESK.y); pencilMarks(c, d.desk, { progress: u }); c.restore(); }
  function at(c, P, cel, o = {}) { c.save(); c.translate(P.x, P.y); if (o.s) c.scale(o.s, o.s); pencilMarks(c, cel, { progress: o.u ?? 1, color: o.color, alpha: o.alpha ?? 1 }); c.restore(); }
  // socket rig: plug pulled by `pull`, optional hand {pose, x, y, rot}, spark 0..1
  function socketRig(c, o = {}) {
    const d = build(), pull = o.pull ?? 0, s = SOCK.s, pa = o.plugAlpha ?? 1;
    if (pa > 0) pencilMarks(c, cable(pull), { alpha: pa, progress: o.cable ?? 1 });
    c.save(); c.translate(SOCK.x, SOCK.y); c.scale(s, s); pencilMarks(c, d.socket, { progress: o.socket ?? 1 });
    if (pa > 0) {
      if (pull > 1) { c.save(); c.translate(-pull, 0); c.beginPath(); c.rect(0, -40, pull, 80); c.clip(); pencilMarks(c, d.prongs, { alpha: pa }); c.restore(); }
      c.save(); c.translate(-pull, 0); c.fillStyle = COL.paper; c.globalAlpha *= pa; c.fill(plugFillPath()); c.globalAlpha = 1; pencilMarks(c, d.plug, { alpha: pa, progress: o.plug ?? 1 }); c.restore();
    }
    if (o.hand) { const h = o.hand; c.save(); c.translate(-75 - pull + (h.x ?? 0), h.y ?? 0); if (h.rot) c.rotate(h.rot); c.fillStyle = COL.paper; c.fill(d.handFill[h.pose]); pencilMarks(c, d.hand[h.pose]); c.restore(); }
    if (o.spark) { c.save(); c.translate(-2, 0); pencilMarks(c, d.spark, { color: 'red', alpha: o.spark }); c.restore(); }
    c.restore();
  }
  return { ENV, CAM, DESK, AG, LAMP, TRAY, PRINTER, CAB, FLOOR, WALL, SOCK, NOTE, D, build, room, dark, lamp, desk, at, socketRig, cable };
})();

// ---------- room drawings (origin noted per drawing) ----------
function roomDrawing() {   // world coordinates
  const F = 968;
  return { strokes: [
    stroke('floor', bow([40, F], [1800, F], 1.2, 7), { width: 2.8 }),
    stroke('wall', bow([1800, 330], [1800, F], 1.2, 8), { width: 2.8 }),
    stroke('wall/base', [[1800, F], [1880, 1060]], { width: 2.4 }),
    stroke('floor/front', bow([40, F + 18], [1790, F + 18], 1, 9), { width: 1.2, opacity: .35, pressure: PRESS.inner }),
    ...[0, 1, 2, 3, 4, 5].map(k => stroke('wall/tick/' + k, [[1800, 420 + k * 90], [1812, 426 + k * 90]], { width: 1.2, opacity: .4, pressure: PRESS.inner })),
  ] };
}
function lampDrawing() {    // origin: base centre on the desk
  return { strokes: [
    loopStroke('lamp/base', ellPoints(0, -6, 48, 10, 0, TAU, 20).slice(0, -1), { width: 3, corner: 2, over: 6 }),
    stroke('lamp/arm1', [[0, -12], [-30, -120]], { width: 3.2 }),
    stroke('lamp/arm2', [[-30, -120], [40, -200]], { width: 3.2 }),
    stroke('lamp/joint', ellPoints(-30, -120, 7, 7, 0, TAU, 10), { width: 2.2, corner: 2 }),
    stroke('lamp/shade', [[20, -222], [96, -230], [120, -160], [58, -150], [20, -222]], { width: 3.4, corner: .7 }),
    stroke('lamp/bulb', ellPoints(88, -156, 14, 7, 0, Math.PI, 10), { width: 2, opacity: .8, corner: 2 }),
    ...[0, 1, 2, 3, 4].map(k => stroke('lamp/hatch/' + k, [[32 + k * 14, -214 + k * 2], [66 + k * 12, -158 + k * 1]], { width: 1.2, opacity: .45, pressure: PRESS.inner })),
  ] };
}
function raysDrawing() {    // light from the lamp's bulb (origin as the lamp)
  const S_ = []; for (let k = 0; k < 6; k++) { const a = .55 + k * .16, x = 88 + Math.cos(a) * 30, y = -150 + Math.sin(a) * 30; S_.push(stroke('ray/' + k, [[x, y], [88 + Math.cos(a) * 92, -150 + Math.sin(a) * 92]], { width: 2, opacity: .55, pressure: [[0, .3], [.4, 1], [1, .2]] })); }
  return { strokes: S_ };
}
function trayDrawing() {    // origin: bottom centre on the desk
  return { strokes: [
    stroke('tray', [[-70, -40], [-62, 0], [62, 0], [70, -40]], { width: 3, corner: .6 }),
    stroke('tray/lip', bow([-70, -40], [70, -40], 1, 3), { width: 1.6, opacity: .6, pressure: PRESS.inner }),
    stroke('tray/paper', [[-48, -44], [-40, -62], [44, -60], [50, -42]], { width: 2, opacity: .8, corner: .6 }),
  ] };
}
const PRINTER_FILL = () => polyPath(rrectPts(-145, -64, 290, 64, 10, 2));   // paper fill so the printer hides what is behind it
function printerDrawing() { // origin: bottom centre on the desk
  return { strokes: [
    loopStroke('printer', rrectPts(-145, -64, 290, 64, 10, 2), { width: 3.2, start: 1, over: 8 }),
    stroke('printer/slot', [[-136, -64], [136, -64]], { width: 3.6 }),
    stroke('printer/led', ellPoints(122, -30, 5, 5, 0, TAU, 8), { width: 2, corner: 2 }),
    ...[0, 1, 2, 3].map(k => stroke('printer/shade/' + k, [[-135 + k * 10, -8], [-129 + k * 10, -2]], { width: 1.1, opacity: .4, pressure: PRESS.inner })),
  ] };
}
function cabinetDrawing() { // origin: bottom centre on the floor
  const w = 220, h = 320;
  return { strokes: [
    loopStroke('cab', [[-w / 2, 0], [-w / 2, -h], [w / 2, -h], [w / 2, 0]], { width: 3.4, corner: .6, over: 8 }),
    stroke('cab/mid', [[-w / 2 + 4, -h / 2], [w / 2 - 4, -h / 2]], { width: 2.2 }),
    loopStroke('cab/h1', rrectPts(-40, -h + 60, 80, 18, 6, 2), { width: 2, start: 1, over: 4 }),
    loopStroke('cab/h2', rrectPts(-40, -h / 2 + 60, 80, 18, 6, 2), { width: 2, start: 1, over: 4 }),
    loopStroke('cab/card', rrectPts(-26, -h + 100, 52, 30, 3, 1), { width: 1.6, opacity: .6, pressure: PRESS.inner, over: 3 }),
    ...[0, 1, 2, 3, 4, 5].map(k => stroke('cab/shadow/' + k, [[w / 2 + 6, -h + 40 + k * 46], [w / 2 + 16, -h + 58 + k * 46]], { width: 1.2, opacity: .4, pressure: PRESS.inner })),
  ] };
}
function drawerOutDrawing() { // the top drawer pulled out (origin: cabinet bottom centre)
  const h = 320;
  return { strokes: [stroke('drawer', [[-104, -h + 10], [-130, -h + 40], [130, -h + 40], [104, -h + 10]], { width: 2.8, corner: .6 }),
    ...[0, 1, 2, 3].map(k => stroke('drawer/file/' + k, [[-80 + k * 44, -h + 32], [-72 + k * 44, -h - 4], [-44 + k * 44, -h - 4], [-40 + k * 44, -h + 32]], { width: 1.8, opacity: .7, corner: .6 }))] };
}
function folderDrawing() {    // the order folder he reads (origin: centre)
  const S_ = [loopStroke('folder', [[-150, -90], [-40, -90], [-26, -106], [40, -106], [52, -90], [150, -90], [150, 90], [-150, 90]], { width: 3.2, corner: .6, over: 10 })];
  S_.push(...textStrokes('A-1001', 0, -26, { cap: 36, align: 'center', condense: .86, id: 'folder/t1', seed: 12 }).strokes);
  S_.push(...textStrokes('49.99 EUR', 0, 54, { cap: 36, align: 'center', condense: .82, id: 'folder/t2', seed: 13 }).strokes);
  return { strokes: S_ };
}
function notebookClosedDrawing() {  // Temporal's notebook lying on the desk (origin: bottom centre), indigo
  return { strokes: [
    stroke('nbc/top', [[-86, -34], [-70, -52], [92, -52], [80, -34]], { width: 3, corner: .6 }),
    loopStroke('nbc/front', [[-86, -34], [80, -34], [80, 0], [-86, 0]], { width: 3.2, corner: .6, over: 6 }),
    stroke('nbc/spiral', [[-80, -40], [70, -40]], { width: 1.4, opacity: .7, pressure: PRESS.inner }),
  ] };
}
function requestSlipDrawing() {  // the refund request (origin: centre)
  const S_ = [loopStroke('req', [[-120, -70], [100, -70], [120, -52], [120, 70], [-120, 70]], { width: 3, corner: .6, over: 8 })];
  S_.push(...textStrokes('Refund', 0, -8, { cap: 36, align: 'center', condense: .86, id: 'req/t1', seed: 21 }).strokes);
  S_.push(...textStrokes('A-1001', 0, 52, { cap: 33, align: 'center', condense: .86, id: 'req/t2', seed: 22 }).strokes);
  return { strokes: S_ };
}
// a receipt printed on his desk (origin: top centre), 'Refund 49.99 EUR'; the paper is as wide as
// its text (same design as act 3's receipts). MINI_RECEIPT gives its width and paper outline.
const MINI_RECEIPT = (() => { const w = Math.ceil(Math.max(measure('Refund', 33, 0, .86), measure('49.99 EUR', 33, 0, .78)) + 34), h = 150, zig = [];
  for (let k = 0; k <= 12; k++) zig.push([w / 2 - k * w / 12, h + (k % 2 ? -8 : 0)]);
  return { w, h, outline: [[-w / 2, h], [-w / 2, 0], [w / 2, 0], [w / 2, h], ...zig.slice(1)] }; })();
function miniReceiptDrawing(seed = 31) {
  return { strokes: [stroke('mr/edge', MINI_RECEIPT.outline, { width: 2.8, corner: .5 }),
    ...textStrokes('Refund', 0, 58, { cap: 33, align: 'center', condense: .86, id: 'mr/t1', seed }).strokes,
    ...textStrokes('49.99 EUR', 0, 116, { cap: 33, align: 'center', condense: .78, id: 'mr/t2', seed: seed + 1 }).strokes] };
}
