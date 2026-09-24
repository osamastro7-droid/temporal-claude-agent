// Copied from temporal-film (stageC.js), unmodified.
'use strict';
// ============================================================
// Stage C: the customer's side (v2 acts 1 and 2; act 3 starts from it).
// Maria is only her laptop, her browser and her cursor. The shop's pages, the teapot and
// the parcel live here. The pencil draws the laptop and the parcel; everything ON the
// screen is drawn by the machine itself (progress, no pencil), like v1's screen.
//
// Coordinates
//   world: the 1920 x 1080 sheet. The laptop's display centre is LAP (960, 630), display
//          960 x 600 (lid 460..1460 x 308..960, deck front 1016). HOME = {x, y, s} placement.
//   display-local: origin = display centre, x -480..480, y -300..300. Every screen drawing
//          (browser bar, shop header, pages, cursor) is in these units. SC.frame(c, at)
//          sets the transform for a placement at = {x, y, s} (world position of the display
//          centre and scale); at s = 1 page lettering is nominal cap >= 33 (>= 44 px real).
//
// Screen layout (display-local)
//   browser bar  y -300..-238   three dots, back arrow, address pill (lock + scrawl address)
//   shop header  y -238..-180   teacup mark + the shop's name "Teahouse" (nominal 34; a scrawl below s .96),
//                               nav scrawl, cart
//   VIEW         y -178..297    where pages sit and slide (clip)
// Pages (ids): product, checkout, ordered (a1), orders, reason, requested (a2).
// Drawing the laptop anywhere: SC.draw(c, {at, screen}) = SC.body(c, {at}) + SC.screen(c, screen, {at}).
//   Act 3 starts exactly where act 2 ends with SC.body/SC.screen(c, SC.END_A2, {at: SC.HOME}) and
//   moves/shrinks it with `at`. On END_A2 the one readable line, "Refund requested", is nominal 44, so
//   it keeps >= 33 nominal (>= 44 px real) down to s = .75; the other pages' lettering (nominal 34-40)
//   needs s >= .92; the header's name swaps to a scrawl below s = .96 (SC.screen does it by `at.s`).
// Screen state for SC.screen(c, s):
//   { light 0..1, alpha 0..1 (everything on the screen), chrome 0..1, head 0..1,
//     addr 0..1 (address typed), addrPage id,
//     page id, u 0..1 (the page drawing itself), to id + slide 0..1 (page change, old slides left)
//     + smear px (ghosts trailing a fast slide; SC.slideAt gives slide and smear for a time),
//     load 0..1 (loading line under the bar, drawn while < 1),
//     dyn: {press, hover, hoverA, name, addr, typed, caret, check, title, note},
//     cursor: {x, y, a, press 0..1, click 0..1} }
// Clicks: SC.cursorTrack dips the cursor for SC.PRESS_N drawings; SC.pressed(q, t) presses the button
//   face for the same drawings (face down 8/9 px onto its drop line, a light graphite tone inside).
// SC.END_A1 / SC.END_A2 are the exact screen states the acts end on (a3 draws SC.END_A2).
// ============================================================
const SC = (() => {
  const LAP = { x: 960, y: 630, dw: 960, dh: 600 };
  const HOME = { x: LAP.x, y: LAP.y, s: 1 };
  const DSP = { x: -LAP.dw / 2, y: -LAP.dh / 2, w: LAP.dw, h: LAP.dh };
  const BAR = DSP.y + 62, HEAD = BAR + 58;
  const VIEW = { x: DSP.x + 3, y: HEAD + 2, w: DSP.w - 6, h: DSP.y + DSP.h - 3 - (HEAD + 2) };
  const SMALL = { x: 420, y: 614, s: .56 };        // a2: the laptop beside the parcel (screen asleep)
  const PARCEL = { x: 1270, y: 844 };              // bottom centre of the parcel's front face (world)
  const TEA_IN = { x: 55, y: -96, s: 1.02 };       // the teapot inside the parcel (parcel-local base centre)
  const CAP = 36, CD = .86;                        // page lettering: nominal 36 = 49 px real capitals
  const SHOP = 'Teahouse';                         // the shop's name in its header (a generic name, no descenders)
  const MARIA = 'Maria';                           // typed into the checkout's Name field
  const PAGES = ['product', 'checkout', 'ordered', 'orders', 'reason', 'requested'];

  // targets for the cursor tip (display-local). A click target sits inside its button, right of the
  // label (with room for the pressed shift), so the click marks never cross the label.
  const AT = { tag: [382, 104], buy: [298, 222], name: [304, -62], pay: [404, 204], rest: [330, 200], restLow: [360, 206],
    refund: [426, 208], reason: [236, -24], submit: [-56, 130], enter: [420, 290], wake: [300, -128] };

  // ---------- helpers ----------
  const T = (id, str, x, y, o = {}) => textStrokes(str, x, y, { cap: o.cap ?? CAP, condense: o.cd ?? CD, align: o.align ?? 'left', id, seed: o.seed ?? 5, width: o.width ?? 2.9 }).strokes;
  const box = (id, x, y, w, h, r = 14, o = {}) => loopStroke(id, rrectPts(x, y, w, h, r, 3), { width: o.width ?? 2.2, opacity: o.opacity ?? .8, pressure: o.pressure ?? PRESS.contour, start: 1, over: 10 });
  const mk = (strokes, id) => compile({ strokes }, id);
  // a button: face (outline + label) and a drop line under it; pressing moves the face onto the line
  // (PRESS_D) and tones the inside with graphite. The label's capitals sit in the middle of the face:
  // EMS Tech capitals are 1.354 x the nominal cap, so baseline = y + h/2 + base * cap with base about
  // .66 (no descender); labels with a descender (y, q) sit a little higher so the tail stays inside.
  const PRESS_D = [8, 9];
  function button(id, x, y, w, h, label, o = {}) {
    const cap = o.cap ?? CAP, face = [loopStroke(id + '/b', rrectPts(x, y, w, h, 16, 3), { width: o.primary ? 3.4 : 2.8, start: 1, over: 12 }),
      ...T(id + '/t', label, x + w / 2, y + h / 2 + cap * (o.base ?? .66), { cap, cd: o.cd, align: 'center', seed: o.seed, width: 3.1 })];
    const [px, py] = PRESS_D, shadow = [stroke(id + '/sh', [[x + 16, y + h + py], [x + w + px, y + h + py], [x + w + px, y + 16]], { width: 2.4, opacity: .55, pressure: PRESS.inner, corner: .5 })];
    return { face: mk(face, id + '/face'), shadow: mk(shadow, id + '/shadow'), box: [x, y, w, h], tone: polyPath(rrectPts(x + 3, y + 3, w - 6, h - 6, 14, 4)) };
  }

  // ---------- the teapot (origin: base centre; about 380 x 210 at s = 1) ----------
  const TEA_BODY = [[-70, 0], [-100, -20], [-116, -60], [-108, -104], [-80, -134], [-40, -150], [0, -154], [40, -150], [80, -134], [108, -104], [116, -60], [100, -20], [70, 0]];
  const TEA_LID = [[-54, -150], [-46, -170], [-24, -184], [0, -188], [24, -184], [46, -170], [54, -150]];
  const TEA_SPOUT_LO = [[110, -36], [136, -44], [160, -70], [178, -110], [194, -138]], TEA_SPOUT_HI = [[114, -84], [134, -92], [150, -110], [166, -134], [180, -146]];
  function teapotRaw(id, s = 1, o = {}) {
    const k = o.w ?? 1, P = pts => pts.map(([x, y]) => [x * s, y * s]), S_ = [], inner = { width: 1.6 * k, opacity: .65, pressure: PRESS.inner };
    S_.push(loopStroke(id + '/body', P(TEA_BODY), { width: 3.4 * k, corner: 1.2, start: 0, over: 8 }));
    S_.push(stroke(id + '/lid', P(TEA_LID), { width: 3 * k, corner: 2 }));
    S_.push(stroke(id + '/rim', P([[-64, -148], [-30, -144], [0, -143], [30, -144], [64, -148]]), { width: 2.2 * k, opacity: .85, corner: 2 }));
    S_.push(stroke(id + '/knob', P(ellPoints(0, -198, 13, 10, Math.PI * .6, Math.PI * 2.4, 14)), { width: 2.8 * k, corner: 2 }));
    S_.push(stroke(id + '/spout/lo', P(TEA_SPOUT_LO), { width: 3.2 * k, corner: 2 }));
    S_.push(stroke(id + '/spout/hi', P(TEA_SPOUT_HI), { width: 3 * k, corner: 2 }));
    S_.push(stroke(id + '/spout/tip', P([[180, -146], [190, -153], [202, -147], [194, -138]]), { width: 2.6 * k, corner: .8 }));
    S_.push(stroke(id + '/handle/o', P([[-106, -112], [-140, -128], [-170, -116], [-182, -84], [-170, -50], [-140, -30], [-110, -28]]), { width: 3.2 * k, corner: 2 }));
    S_.push(stroke(id + '/handle/i', P([[-110, -94], [-136, -106], [-156, -94], [-162, -74], [-152, -54], [-130, -44], [-112, -46]]), { width: 2.4 * k, corner: 2 }));
    S_.push(stroke(id + '/foot', P([[-68, -2], [-64, 8], [64, 8], [68, -2]]), { width: 2.6 * k, corner: .6 }));
    // a painted band with a row of dots, and a gleam on the glaze
    S_.push(stroke(id + '/band', P([[-112, -92], [-60, -84], [0, -82], [60, -84], [112, -92]]), inner));
    S_.push(stroke(id + '/band2', P([[-114, -58], [-60, -50], [0, -48], [60, -50], [114, -58]]), inner));
    for (let j = 0; j < 7; j++) { const x = -78 + j * 26, y = -67 + Math.pow(x / 110, 2) * -6; S_.push(stroke(`${id}/dot/${j}`, P(ellPoints(x, y, 4, 4, 0, TAU, 8)), { width: 1.8 * k, opacity: .7, corner: 2 })); }
    S_.push(stroke(id + '/gleam', P([[-88, -104], [-76, -120], [-58, -131]]), { width: 2 * k, opacity: .55, pressure: PRESS.inner }));
    if (o.shadow !== false) for (let j = 0; j < 9; j++) S_.push(stroke(`${id}/shadow/${j}`, P([[-56 + j * 16, 22], [-44 + j * 16, 13]]), { width: 1.3 * k, opacity: .35, pressure: PRESS.inner }));
    return S_;
  }
  // paper under the teapot's silhouette (so lines behind it do not show through)
  function teapotFill(s = 1) {
    const P = pts => pts.map(([x, y]) => [x * s, y * s]), p = new Path2D();
    const add = pts => { P(pts).forEach((q, i) => i ? p.lineTo(...q) : p.moveTo(...q)); p.closePath(); };
    add(TEA_BODY); add(TEA_LID.concat([[0, -140]])); add(ellPoints(0, -198, 13, 10, 0, TAU, 12));
    add([...TEA_SPOUT_LO, [202, -147], [190, -153], ...TEA_SPOUT_HI.slice().reverse()]);
    return p;
  }
  // the crack (red), teapot-local at s = 1: down the glaze from the lid's rim, with a branch
  function crackRaw(id) {
    return [
      stroke(id + '/lid', [[30, -186], [22, -170], [32, -160], [24, -146]], { width: 3.4, corner: .4, pressure: [[0, .5], [.2, 1], [1, .8]] }),
      stroke(id + '/main', [[24, -146], [12, -128], [30, -112], [14, -94], [34, -76], [20, -58], [30, -40]], { width: 4.2, corner: .4, pressure: [[0, .8], [.1, 1], [.85, .9], [1, .3]] }),
      stroke(id + '/branch', [[30, -112], [52, -108], [60, -122], [78, -118]], { width: 3, corner: .4, pressure: [[0, .9], [.7, .8], [1, .25]] }),
      stroke(id + '/chip', [[14, -94], [-6, -86], [-14, -98]], { width: 2.6, corner: .4, pressure: [[0, .9], [1, .3]] }),
    ];
  }

  // ---------- small icons ----------
  function teacupIcon(id, x, y) {   // the shop's mark (centre x, y)
    return [stroke(id + '/cup', [[x - 16, y - 10], [x - 13, y + 6], [x - 6, y + 12], [x + 6, y + 12], [x + 13, y + 6], [x + 16, y - 10], [x - 16, y - 10]], { width: 2.4, corner: .7 }),
      stroke(id + '/h', [[x + 15, y - 6], [x + 23, y - 5], [x + 23, y + 3], [x + 13, y + 5]], { width: 2, corner: 1.2 }),
      stroke(id + '/saucer', [[x - 22, y + 16], [x + 22, y + 16]], { width: 2.2 }),
      stroke(id + '/steam', [[x - 3, y - 14], [x - 7, y - 19], [x - 3, y - 24]], { width: 1.6, opacity: .6, pressure: PRESS.inner })];
  }
  function cartIcon(id, x, y) {
    return [stroke(id + '/basket', [[x - 26, y - 14], [x - 18, y - 14], [x - 10, y + 8], [x + 16, y + 8], [x + 22, y - 8], [x - 14, y - 8]], { width: 2.4, corner: .6 }),
      stroke(id + '/w1', ellPoints(x - 6, y + 15, 3.5, 3.5, 0, TAU, 8), { width: 2, corner: 2 }), stroke(id + '/w2', ellPoints(x + 12, y + 15, 3.5, 3.5, 0, TAU, 8), { width: 2, corner: 2 })];
  }
  function lockIcon(id, x, y) {
    return [loopStroke(id + '/b', rrectPts(x - 8, y - 4, 16, 13, 3, 1), { width: 1.9, start: 1, over: 4 }), stroke(id + '/s', [[x - 5, y - 4], [x - 5, y - 9], [x, y - 13], [x + 5, y - 9], [x + 5, y - 4]], { width: 1.8, corner: 2 })];
  }
  const checkPts = [[-40, -58], [-12, -30], [44, -96]];

  // ---------- compiled drawings ----------
  const D = {};
  function build() {
    if (D.body) return D;
    // the laptop: the pencil draws the contours in one hand path (as stage A does), the 37 key tops
    // appear under it on twos while it draws the deck; a hatched shadow under the deck comes last
    const mac0 = macDrawing(LAP.dw, LAP.dh, {}), by = id => mac0.strokes.find(s => s.id === id), rev = s => ({ ...s, points: s.points.slice().reverse() });
    const sh = []; for (let k = 0; k < 16; k++) { const x = -470 + k * 58; sh.push(stroke('lap/shadow/' + k, [[x, mac0.deckFront + 14], [x + 18, mac0.deckFront + 5]], { width: 1.3, opacity: .35, pressure: PRESS.inner })); }
    D.body = mk([...['lid', 'display', 'camera'].map(by), rev(by('hinge')), by('deck'), rev(by('deck/front')), by('trackpad'), rev(by('deck/scoop')), ...sh], 'sc/lap');
    D.keys = mk(mac0.strokes.filter(s => s.id.startsWith('key/')), 'sc/lap-keys');
    const at = id => D.body.plan.seg.find(g => !g.lift && D.body.strokes[g.k].id === id).t1 / D.body.plan.total;
    D.keysSpan = [at('hinge'), at('trackpad')]; D.displayDone = at('display');
    D.deckFront = mac0.deckFront;

    // browser bar and shop header (display-local)
    const bar = [stroke('sc/bar/line', bow([DSP.x + 4, BAR], [DSP.x + DSP.w - 4, BAR], .8, 3), { width: 1.8, opacity: .75, pressure: PRESS.inner })];
    for (let k = 0; k < 3; k++) bar.push(stroke('sc/bar/dot' + k, ellPoints(DSP.x + 28 + k * 22, DSP.y + 31, 6, 6, 0, TAU, 12), { width: 1.7, opacity: .8 }));
    bar.push(stroke('sc/bar/back', [[DSP.x + 124, DSP.y + 22], [DSP.x + 114, DSP.y + 31], [DSP.x + 124, DSP.y + 40]], { width: 2.4, corner: .6 }));
    bar.push(loopStroke('sc/bar/pill', rrectPts(DSP.x + 150, DSP.y + 12, 790, 38, 19, 4), { width: 1.9, opacity: .8, start: 1, over: 10 }));
    bar.push(...lockIcon('sc/bar/lock', DSP.x + 176, DSP.y + 32));
    D.chrome = mk(bar, 'sc/chrome');
    D.addr = {}; PAGES.forEach((p, i) => { D.addr[p] = mk(scrawl('sc/addr/' + p, DSP.x + 198, DSP.y + 38, [230, 330, 300, 260, 340, 310][i], 12, 30 + i * 7, { width: 1.8, opacity: .75 }), 'sc/addr/' + p); });
    // the shop's header: its mark, its name, nav, cart and a rule. The name is written (nominal 34 =
    // 46 px capitals at s = 1, no descenders, inside the 58 px band); below readable size (a smaller
    // laptop, act 3's wide shot) a scrawl stands for it (SC.screen crossfades them by the placement's scale)
    D.headCup = mk(teacupIcon('sc/head/cup', DSP.x + 42, BAR + 30), 'sc/head/cup');
    D.headName = mk(T('sc/head/name', SHOP, DSP.x + 80, HEAD - 7, { cap: 34, cd: .86, seed: 4, width: 3.1 }), 'sc/head/name');
    D.headNameSmall = mk(scrawl('sc/head/name-s', DSP.x + 82, BAR + 38, Math.round(measure(SHOP, 34, 0, .86)) - 16, 15, 5, { width: 2.2, opacity: .85 }), 'sc/head/name-s');
    D.head = mk([...scrawl('sc/head/nav1', 186, BAR + 36, 70, 11, 8, { width: 1.6, opacity: .6 }), ...scrawl('sc/head/nav2', 282, BAR + 36, 64, 11, 9, { width: 1.6, opacity: .6 }),
      ...cartIcon('sc/head/cart', 420, BAR + 26), stroke('sc/head/rule', bow([DSP.x + 8, HEAD], [DSP.x + DSP.w - 8, HEAD], .8, 5), { width: 1.3, opacity: .45, pressure: PRESS.inner })], 'sc/head');

    // ---- product page ----
    const tp = 1, tx = -236 - 12 * tp;
    D.product = { parts: [
      mk([box('sc/pr/card', -452, -160, 432, 396, 18, { opacity: .7 })], 'sc/pr/card'),
      { cel: mk(teapotRaw('sc/pr/tea', tp), 'sc/pr/tea'), x: tx, y: 132 },
      mk([...T('sc/pr/t1', 'Ceramic', 52, -94, { cap: 40, seed: 11, width: 3.2 }), ...T('sc/pr/t2', 'Teapot', 52, -34, { cap: 40, seed: 12, width: 3.2 })], 'sc/pr/title'),
      mk([...scrawl('sc/pr/d1', 54, 14, 360, 13, 41, { width: 1.8, opacity: .55 }), ...scrawl('sc/pr/d2', 54, 42, 230, 13, 43, { width: 1.8, opacity: .55 })], 'sc/pr/desc'),
      mk([loopStroke('sc/pr/tag', [[42, 108], [72, 66], [394, 66], [394, 150], [72, 150]], { width: 2.8, corner: .5, over: 10 }),
        stroke('sc/pr/tag/hole', ellPoints(72, 108, 7, 7, 0, TAU, 10), { width: 2, corner: 2 }),
        stroke('sc/pr/tag/string', [[68, 103], [52, 86], [32, 84], [22, 96], [28, 114]], { width: 1.8, opacity: .7, pressure: PRESS.inner, corner: 2 }),
        ...T('sc/pr/price', '49.99 EUR', 236, 128, { cap: 36, cd: .82, align: 'center', seed: 14, width: 3.1 })], 'sc/pr/tag'),
    ], buy: button('sc/pr/buy', 52, 162, 290, 110, 'Buy', { cap: 40, cd: .9, seed: 15, primary: true, base: .42 }),
      // the hover underline under the price (the cursor rests on the tag)
      hover: (() => { const hw = measure('49.99 EUR', 36, 0, .82) / 2; return mk([stroke('sc/pr/ul', bow([236 - hw - 4, 139], [236 + hw + 4, 139], 1.2, 17), { width: 3, opacity: .85, pressure: [[0, .5], [.08, 1], [.9, .9], [1, .4]] })], 'sc/pr/hover'); })() };

    // ---- checkout ----
    const ts = .5;
    D.checkout = { parts: [
      mk([box('sc/co/card', -452, -156, 290, 300, 16, { opacity: .7 })], 'sc/co/card'),
      { cel: mk(teapotRaw('sc/co/tea', ts, { w: .8 }), 'sc/co/tea'), x: -307 - 11 * ts, y: 2 },
      mk([...scrawl('sc/co/s1', -420, 64, 190, 13, 51, { width: 1.8, opacity: .6 }), ...scrawl('sc/co/s2', -420, 100, 120, 13, 52, { width: 1.8, opacity: .6 })], 'sc/co/sum'),
      mk([...T('sc/co/l1', 'Name', -110, -110, { seed: 21 }), box('sc/co/f1', -110, -94, 560, 60, 12)], 'sc/co/f1'),
      mk([...T('sc/co/l2', 'Address', -110, 36, { seed: 22 }), box('sc/co/f2', -110, 52, 560, 60, 12)], 'sc/co/f2'),
    ], pay: button('sc/co/pay', -110, 144, 560, 104, 'Pay 49.99 EUR', { cap: 36, cd: .84, seed: 23, primary: true, base: .48 }),
      // "Maria" is typed into the Name field (nominal 33 = 45 px capitals, centred in the 60 px field)
      name: typedCel('sc/co/name', MARIA, -86, -42, { cap: 33, cd: .86, seed: 61 }),
      addr: mk(scrawl('sc/co/addr', -86, 94, 410, 18, 63, { width: 2.4, opacity: .9 }), 'sc/co/addr'),
      fields: { name: [-94, -34], addr: [52, 112] } };

    // ---- confirmation (a1's end) and "Refund requested" (a2's end) share one layout ----
    const done = (key, text, seed) => ({ parts: [
      mk([loopStroke(`sc/${key}/ring`, ellPoints(0, -64, 78, 78, -Math.PI / 2, Math.PI * 1.5, 36).slice(0, -1), { width: 3.2, corner: 2, over: 12 })], `sc/${key}/ring`)],
      title: mk(T(`sc/${key}/title`, text, 0, 96, { cap: 44, cd: .86, align: 'center', seed, width: 3.3 }), `sc/${key}/title`),
      note: mk(scrawl(`sc/${key}/note`, -150, 164, 300, 13, seed + 3, { width: 1.8, opacity: .55 }), `sc/${key}/note`),
      check: mk([stroke(`sc/${key}/check`, checkPts, { width: 7, corner: .5, pressure: [[0, .5], [.3, 1], [1, .45]] })], `sc/${key}/check`) });
    D.ordered = done('od', 'Order A-1001', 31);
    D.requested = done('rq', 'Refund requested', 36);

    // ---- My orders ----
    const to = .4;
    D.orders = { parts: [
      mk(T('sc/or/h', 'My orders', -440, -114, { cap: 40, seed: 41, width: 3.2 }), 'sc/or/h'),
      mk([box('sc/or/card', -452, -68, 904, 196, 18, { opacity: .75 })], 'sc/or/card'),
      mk([box('sc/or/thumb', -432, -50, 160, 160, 12, { opacity: .6 })], 'sc/or/thumb'),
      { cel: mk(teapotRaw('sc/or/tea', to, { w: .75, shadow: false }), 'sc/or/tea'), x: -352 - 11 * to, y: 70 },
      mk([...T('sc/or/id', 'A-1001', -236, 2, { cap: 34, cd: .84, seed: 42 }), ...T('sc/or/price', '49.99 EUR', 432, 2, { cap: 34, cd: .82, align: 'right', seed: 43 })], 'sc/or/l1'),
      mk(T('sc/or/name', 'Ceramic Teapot', -236, 64, { cap: 34, cd: .84, seed: 44 }), 'sc/or/l2'),
      mk(scrawl('sc/or/st', -234, 106, 150, 12, 45, { width: 1.8, opacity: .55 }), 'sc/or/st'),
    ], refund: button('sc/or/rf', -110, 154, 562, 96, 'Request refund', { cap: 34, cd: .84, seed: 46, base: .46 }) };

    // ---- the refund form ----
    D.reason = { parts: [
      mk(T('sc/rs/l', 'Reason', -360, -98, { seed: 51 }), 'sc/rs/l'),
      mk([box('sc/rs/area', -360, -78, 720, 132, 12)], 'sc/rs/area'),
    ], submit: button('sc/rs/sub', -360, 96, 340, 76, 'Submit', { cap: 36, seed: 52, primary: true, base: .66 }),
      typed: typedCel('sc/rs/typed', 'Arrived broken', -334, -14, { cap: 36, cd: .86, seed: 53 }) };

    // ---- cursor, click marks ----
    const cur = [[0, 0], [0, 46], [11, 36], [20, 55], [29, 51], [20, 32], [34, 31]].map(([x, y]) => [x * 1.25, y * 1.25]);
    D.cursor = mk([loopStroke('sc/cur', cur, { width: 2.8, corner: .5, over: 6, start: 0 })], 'sc/cursor'); D.cursorFill = polyPath(cur);
    // three marks fanned up and to the right of the tip: away from the arrow's body (down-right of the
    // tip) and from the label (every click target sits to the right of its button's label)
    D.clickMarks = mk([270, 314, 358].map((a, k) => { const r = a * Math.PI / 180; return stroke('sc/click/' + k, [[Math.cos(r) * 16, Math.sin(r) * 16], [Math.cos(r) * 50, Math.sin(r) * 50]], { width: 3.2, pressure: [[0, .55], [.35, 1], [1, .35]] }); }), 'sc/click');

    // ---- parcel ----
    D.parcelClosed = mk(parcelClosedRaw(), 'sc/parcel/closed'); D.parcelDetail = mk(parcelClosedDetailRaw(), 'sc/parcel/detail');
    D.parcel = { a: parcelOpenParts(.3), b: parcelOpenParts(.7), open: parcelOpenParts(1) };   // two in-betweens and the open pose
    D.tea = mk(teapotRaw('sc/pc/tea', TEA_IN.s, { shadow: false }), 'sc/pc/tea'); D.teaFill = teapotFill(TEA_IN.s);
    D.crack = mk(crackRaw('sc/pc/crack').map(s => ({ ...s, points: s.points.map(([x, y]) => [x * TEA_IN.s, y * TEA_IN.s]) })), 'sc/pc/crack');
    D.pop = emanataCel('sc/pc/pop', [-240, -440, 700, 300], { n: 12, pad: 20, len: 34, width: 3, seed: 6, skip: (ex, ey) => ey > .35 });
    return D;
  }
  // text that is typed: one glyph group per character (so it appears letter by letter)
  function typedCel(id, str, x, y, o) {
    const t = textStrokes(str, x, y, { cap: o.cap, condense: o.cd, id, seed: o.seed, width: 3 }), groups = [];
    for (const s of t.strokes) { const i = +s.id.split('/').at(-2); (groups[i] ??= []).push(s); }
    const cels = [], ends = []; let acc = []; [...str].forEach((ch, i) => { if (groups[i]) acc = acc.concat(groups[i]); cels.push(mk(acc.slice(), `${id}@${i + 1}`)); ends.push(x + measure(str.slice(0, i + 1), o.cap, 0, o.cd)); });
    return { cels, ends, x, y, n: str.length };
  }

  // ---------- the parcel (parcel-local: origin = bottom centre of the front face) ----------
  const FW = 440, FH = 150, DXP = 110, DYP = -150;
  const FL = [-FW / 2, -FH], FR = [FW / 2, -FH], BL = [-FW / 2 + DXP, -FH + DYP], BR = [FW / 2 + DXP, -FH + DYP];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]], lp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  const FRONT = [[-FW / 2, 0], FL, FR, [FW / 2, 0]], SIDE = [[FW / 2, 0], [FW / 2 + DXP, DYP], BR, FR];
  function parcelShadow() { const S_ = []; for (let k = 0; k < 14; k++) { const x = -FW / 2 + 20 + k * 34; S_.push(stroke('pc/shadow/' + k, [[x, 12], [x + 20, 4]], { width: 1.3, opacity: .38, pressure: PRESS.inner })); }
    for (let k = 0; k < 5; k++) { const t = (k + 1) / 6, p = lp([FW / 2, 0], [FW / 2 + DXP, DYP], t); S_.push(stroke('pc/shadow/s' + k, [[p[0] + 8, p[1] + 6], [p[0] + 26, p[1] - 2]], { width: 1.3, opacity: .38, pressure: PRESS.inner })); }
    return S_; }
  function parcelLabel() {
    const S_ = [loopStroke('pc/label', rrectPts(40, -104, 150, 84, 6, 2), { width: 2.2, opacity: .85, start: 1, over: 6 })];
    [0, 1, 2, 3, 4, 5, 6, 7].forEach(k => S_.push(stroke('pc/bar/' + k, [[54 + k * 8 + (k % 3), -92], [54 + k * 8 + (k % 3), -64]], { width: k % 3 === 1 ? 2.6 : 1.5, opacity: .75, pressure: PRESS.flat })));
    S_.push(...scrawl('pc/lab/a', 128, -70, 50, 9, 71, { width: 1.5, opacity: .7 }), ...scrawl('pc/lab/b', 54, -38, 110, 9, 72, { width: 1.5, opacity: .7 }));
    // "this way up" arrows
    for (let k = 0; k < 2; k++) { const x = -186 + k * 30; S_.push(stroke('pc/up/' + k, [[x, -40], [x, -86]], { width: 2.2 }), stroke('pc/uph/' + k, [[x - 9, -74], [x, -88], [x + 9, -74]], { width: 2.2, corner: .6 })); }
    S_.push(stroke('pc/up/base', [[-196, -30], [-146, -30]], { width: 2 }));
    return S_;
  }
  // the closed parcel: contours (the pencil at hand speed), then details (tape, label, arrows, shadow; a quicker hand)
  function parcelClosedRaw() {
    return [loopStroke('pc/front', FRONT, { width: 3.6, corner: .5, start: 1, over: 14 }),
      stroke('pc/side', [[FW / 2, 0], [FW / 2 + DXP, DYP], BR], { width: 3.4, corner: .5 }),
      stroke('pc/top', [FR, BR, BL, FL], { width: 3.4, corner: .5 }),
      stroke('pc/seam', bow(lp(FL, BL, .5), lp(FR, BR, .5), 1, 3), { width: 2, opacity: .8, pressure: PRESS.inner })];
  }
  function parcelClosedDetailRaw() {
    // tape along the seam, over the right edge and down the side
    const tL1 = lp(FL, BL, .42), tR1 = lp(FR, BR, .42), tL2 = lp(FL, BL, .58), tR2 = lp(FR, BR, .58);
    return [stroke('pc/tape/end', [add(tL1, [6, 0]), add(lp(tL1, tL2, .5), [14, 0]), add(tL2, [6, 0])], { width: 1.6, opacity: .7, corner: .6, pressure: PRESS.inner }),
      stroke('pc/tape/a', [add(tL1, [6, 0]), tR1, add(tR1, [0, 56])], { width: 2, opacity: .75, corner: .6, pressure: PRESS.inner }),
      stroke('pc/tape/b', [add(tR2, [0, 56]), tR2, add(tL2, [6, 0])], { width: 2, opacity: .75, corner: .6, pressure: PRESS.inner }),
      ...parcelLabel().reverse(), ...parcelShadow()];
  }
  // flaps: free edges at closed (lying on the top), f 0..1 with a lift through the middle
  const FLAPS = {
    back: { hinge: [BL, BR], closed: [lp(FL, BL, .5), lp(FR, BR, .5)], open: [add(BL, [8, -112]), add(BR, [8, -112])] },
    left: { hinge: [FL, BL], closed: [add(FL, [100, 0]), add(BL, [100, 0])], open: [add(FL, [-122, -30]), add(BL, [-122, -30])] },
    right: { hinge: [FR, BR], closed: [add(FR, [-100, 0]), add(BR, [-100, 0])], open: [add(FR, [124, -24]), add(BR, [124, -24])] },
    front: { hinge: [FL, FR], closed: [lp(FL, BL, .5), lp(FR, BR, .5)], open: [add(FL, [-12, 46]), add(FR, [12, 46])] },
  };
  function flapPts(k, f) { const F = FLAPS[k], lift = [0, -90 * Math.sin(Math.PI * f)]; return [F.hinge[0], add(lp(F.closed[0], F.open[0], f), lift), add(lp(F.closed[1], F.open[1], f), lift), F.hinge[1]]; }
  // f 0..1: the flaps swing open (in-betweens .3 and .7, the open pose 1). The right flap is drawn after
  // the teapot (while it rises it leans over the box and hides the spout), the front flap last; both get
  // a fold: a firm line along the hinge and a lighter crease just inside the flap, so a standing flap
  // never reads as a taller box.
  function parcelOpenParts(f) {
    const key = 'sc/parcel@' + f, fl = k => flapPts(k, f);
    const flap = (k, w = 3) => stroke(`pc/flap/${k}`, fl(k), { width: w, corner: .5 });
    const fold = (k, w) => { const P = fl(k), v = [(P[1][0] - P[0][0] + P[2][0] - P[3][0]) / 2, (P[1][1] - P[0][1] + P[2][1] - P[3][1]) / 2], L = Math.hypot(v[0], v[1]), e = L > 1 ? Math.min(7, L * .2) / L : 0;
      const off = q => [q[0] + v[0] * e, q[1] + v[1] * e];
      return [stroke(`pc/fold/${k}`, [P[0], P[3]], { width: w, corner: .5 }),
        stroke(`pc/crease/${k}`, [off(lp(P[0], P[3], .08)), off(lp(P[0], P[3], .92))], { width: 1.5, opacity: .55, pressure: PRESS.inner })]; };
    const back = [flap('back'), flap('left'),
      stroke('pc/rim/back', [FL, BL, BR, FR], { width: 3.2, corner: .5 }),
      stroke('pc/in/corner', [BL, add(BL, [0, 96])], { width: 1.8, opacity: .6, pressure: PRESS.inner })];
    for (let k = 0; k < 7; k++) { const p = lp(FL, BL, .15 + k * .11); back.push(stroke('pc/in/hatch/' + k, [add(p, [6, 8]), add(p, [4, 60 - k * 4])], { width: 1.3, opacity: .42, pressure: PRESS.inner })); }
    // torn tape on the back and front flaps' free edges
    const tb = fl('back'), tf = fl('front');
    back.push(stroke('pc/tape/back', [lp(tb[1], tb[2], .45), add(lp(tb[1], tb[2], .45), [0, 18])], { width: 1.6, opacity: .7, pressure: PRESS.inner }));
    const right = [flap('right'), ...fold('right', 3)];
    // crumpled packing paper around the teapot, just inside the front edge
    const paperL = [[-200, -150], [-194, -172], [-178, -186], [-162, -174], [-148, -192], [-132, -180], [-122, -160], [-126, -150]];
    const front = [stroke('pc/paper/l', paperL, { width: 2, opacity: .8, corner: 1.2 }),
      stroke('pc/paper/lc', [[-186, -164], [-174, -172], [-164, -160]], { width: 1.4, opacity: .55, pressure: PRESS.inner }), stroke('pc/paper/lc2', [[-150, -176], [-142, -164], [-134, -170]], { width: 1.4, opacity: .5, pressure: PRESS.inner }),
      loopStroke('pc/front', FRONT, { width: 3.6, corner: .5, start: 1, over: 14 }), stroke('pc/side', [[FW / 2, 0], [FW / 2 + DXP, DYP], BR], { width: 3.4, corner: .5 }),
      ...parcelLabel(), ...parcelShadow()];
    const frontFlap = [flap('front', 3.2), ...fold('front', 3.2), stroke('pc/tape/front', [lp(tf[1], tf[2], .5), add(lp(tf[1], tf[2], .5), [0, -14])], { width: 1.6, opacity: .7, pressure: PRESS.inner })];
    return { f, back: mk(back, key + '/back'), right: mk(right, key + '/right'), front: mk(front, key + '/front'), frontFlap: mk(frontFlap, key + '/fflap'),
      fills: { back: polyPath(fl('back')), left: polyPath(fl('left')), right: polyPath(fl('right')), front: polyPath(FRONT), side: polyPath(SIDE), frontFlap: polyPath(fl('front')),
        paperL: polyPath(paperL) } };
  }

  // ---------- drawing ----------
  // placement: display centre at (at.x, at.y), scale at.s; draws in display-local units inside
  function frame(c, at = HOME) { c.translate(at.x, at.y); if (at.s !== 1) c.scale(at.s, at.s); }
  const toWorld = (at, p) => [at.x + p[0] * at.s, at.y + p[1] * at.s];
  const keysFor = u => { const [k0, k1] = build().keysSpan; return u >= 1 ? 1 : clamp((u - k0) / (k1 - k0), 0, 1); };
  // the laptop body; o.u: the contours (pencil path), o.keys: key tops (default follows u). Returns the world tip.
  function body(c, o = {}) {
    const d = build(), at = o.at ?? HOME, u = o.u ?? 1; c.save(); frame(c, at);
    const ws = o.ws ?? (at.s < 1 ? Math.pow(at.s, -.5) : 1);   // a smaller laptop keeps most of its line weight
    const t = pencilMarks(c, d.body, { progress: u, alpha: o.alpha ?? 1, widthScale: ws });
    const k = o.keys ?? keysFor(u); if (k > 0) pencilMarks(c, d.keys, { progress: k, alpha: o.alpha ?? 1, widthScale: ws });
    c.restore();
    return t && u < 1 ? toWorld(at, t) : null;
  }
  const bodyTip = (u, at = HOME) => toWorld(at, u >= 1 ? build().body.strokes.at(-1).samples.at(-1).p : planAt(build().body, u).tip);

  function drawButton(c, b, press = 0, u = 1, o = {}) {
    if (u <= 0) return; const p = clamp(press, 0, 1), a = o.alpha ?? 1;
    if (p < .5) pencilMarks(c, b.shadow, { progress: u, alpha: a });
    c.save(); c.translate(PRESS_D[0] * p, PRESS_D[1] * p);
    // pressed: a light graphite tone inside the face (reads at phone size)
    if (p > 0) { c.save(); c.fillStyle = COL.graphite; c.globalAlpha *= .1 * p * a; c.fill(b.tone); c.restore(); }
    pencilMarks(c, b.face, { progress: u, alpha: a }); c.restore();
  }
  // total machine length of a page (for timing its write-on)
  function pageLen(id) { const d = build(), P = d[id], parts = [...P.parts]; if (P.buy) parts.push(P.buy.face); if (P.pay) parts.push(P.pay.face); if (P.refund) parts.push(P.refund.face); if (P.submit) parts.push(P.submit.face); if (P.title) parts.push(P.title); return parts.reduce((a, p) => a + (p.cel ?? p).plan.total, 0); }
  // one page at write-on u, with its dynamic state
  function page(c, id, u = 1, dyn = {}, a = 1) {
    const d = build(), P = d[id]; if (!P || u <= 0) return;
    const btn = P.buy ?? P.pay ?? P.refund ?? P.submit;
    const parts = [...P.parts, ...(btn ? [btn.face] : []), ...(P.title ? [P.title] : [])];
    // the whole page draws itself in order; buttons last (their shadow comes with the face)
    const lens = parts.map(p => (p.cel ?? p).plan.total), tot = lens.reduce((x, y) => x + y, 0); let acc = 0;
    parts.forEach((p, i) => {
      const f = u >= 1 ? 1 : clamp((u * tot - acc) / lens[i], 0, 1); acc += lens[i]; if (f <= 0) return;
      if (btn && p === btn.face) { drawButton(c, btn, dyn.press ?? 0, f, { alpha: a }); return; }
      if (P.title && p === P.title) { pencilMarks(c, P.title, { progress: Math.min(f, dyn.title ?? 1), alpha: a }); return; }
      const cel = p.cel ?? p; c.save(); if (p.x !== undefined) c.translate(p.x, p.y);
      pencilMarks(c, cel, { progress: f, alpha: a }); c.restore();
    });
    if (u < 1) return;
    // dynamic parts
    if (id === 'product' && (dyn.hover ?? 0) > 0 && (dyn.hoverA ?? 1) > 0) pencilMarks(c, P.hover, { progress: dyn.hover, alpha: a * (dyn.hoverA ?? 1) });
    if (id === 'checkout') {
      // the name is typed letter by letter over dyn.name 0..1; the address is a scrawl written over dyn.addr
      const nName = (dyn.name ?? 0) <= 0 ? 0 : dyn.name >= 1 ? P.name.n : Math.min(P.name.n, Math.floor(dyn.name * P.name.n) + 1);
      if (nName > 0) pencilMarks(c, P.name.cels[nName - 1], { alpha: a });
      if ((dyn.addr ?? 0) > 0) pencilMarks(c, P.addr, { progress: dyn.addr, alpha: a });
      if (dyn.caret) { const uu = dyn.addr ?? 0, [y0, y1] = P.fields[dyn.caret];
        if (dyn.caret === 'name') caretAt(c, (nName ? P.name.ends[nName - 1] : P.name.x) + TEXT_CARET.gap, P.name.y + 3, a, 50, TEXT_CARET);
        else caretAt(c, (uu <= 0 ? -86 : uu >= 1 ? P.addr.bounds[0] + P.addr.bounds[2] : planAt(P.addr, uu).tip[0]) + 10, y1 - 10, a, y1 - y0 - 20); }
    }
    if (id === 'reason') {
      const n = Math.min(P.typed.n, Math.max(0, Math.floor(dyn.typed ?? 0)));
      if (n > 0) pencilMarks(c, P.typed.cels[n - 1], { alpha: a });
      if (dyn.caret) caretAt(c, (n ? P.typed.ends[n - 1] : P.typed.x) + TEXT_CARET.gap, P.typed.y + 9, a, 60, TEXT_CARET);
    }
    if (P.check && (dyn.check ?? 1) > 0) pencilMarks(c, P.check, { progress: dyn.check ?? 1, alpha: a });
    if (P.note && (dyn.note ?? 1) > 0) pencilMarks(c, P.note, { progress: dyn.note ?? 1, alpha: a });
  }
  // the text caret; after typed letters it stands a clear gap to their right, thinner and lighter than the
  // letters and taller than them (below the baseline too), so it never reads as one more letter (an 'l')
  function caretAt(c, x, yb, a = 1, h = 52, o = {}) { c.save(); c.strokeStyle = COL.graphite; c.globalAlpha *= (o.alpha ?? .85) * a; c.lineWidth = o.width ?? 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, yb - h); c.lineTo(x, yb); c.stroke(); c.restore(); }
  const TEXT_CARET = { gap: 15, alpha: .62, width: 2.2 };
  // the arrow pointer; press 0..1 dips it, click 0..1 shows the click marks at the tip
  function cursor(c, k) {
    if (!k || (k.a ?? 1) <= 0) return; const d = build();
    c.save(); c.translate(k.x, k.y); c.globalAlpha *= k.a ?? 1;
    if (k.click > 0) pencilMarks(c, d.clickMarks, { progress: 1, alpha: k.click });
    const s = 1 - .2 * (k.press ?? 0); c.scale(s, s);
    c.fillStyle = '#fffdf7'; c.fill(d.cursorFill); pencilMarks(c, d.cursor);
    c.restore();
  }
  // where the cursor is at time q (snap q to twos first): it starts at `from`, each move {t:[t0,t1], to}
  // glides along a shallow arc; clicks at the times in `clicks` dip it (to .8) for PRESS_N drawings
  // (the button face is pressed for the same drawings) and flash 3 marks that fade over 3 more
  const PRESS_N = 3, pressed = (q, tc) => q >= tc && q < tc + PRESS_N / 12 - 1e-6 ? 1 : 0;
  function cursorTrack(q, from, moves, clicks = [], a = 1) {
    let p = from;
    for (const m of moves) { if (q < m.t[0]) break; const u = sm(m.t[0], m.t[1], q, easeIO), b = m.to; p = [lerp(p[0], b[0], u), lerp(p[1], b[1], u) - Math.sin(Math.PI * u) * (m.lift ?? 24)]; if (u < 1) break; p = b; }
    let press = 0, click = 0;
    for (const tc of clicks) { press = Math.max(press, pressed(q, tc)); if (q >= tc && q < tc + (PRESS_N + 3) / 12) click = 1 - sm(tc + PRESS_N / 12, tc + (PRESS_N + 3) / 12, q, x => x); }
    return { x: p[0], y: p[1], press, click, a };
  }
  // a page change: the old page slides out left, the new one in from the right, on ones with a gentle
  // ease (easeInOutSine: about 100 px per frame at the peak for a .62 s slide). While a frame moves
  // more than 60 px, a light smear trails the pages (span .35 x that frame's step).
  function slideAt(tau, t0, dur) {
    const f = t => easeInOutSine(clamp((t - t0) / dur, 0, 1)), slide = f(tau), step = VIEW.w * (slide - f(tau - 1 / 24));
    return { slide, smear: step > 60 ? .35 * step : 0 };
  }
  // the shop's header written to progress u (mark, name, then nav, cart and rule). The name is readable
  // (>= 44 px capitals) only while the laptop is at s >= .96; below that a scrawl stands for it (a
  // replacement drawing, swapped within the first drawings of a shrink, never a double exposure).
  function header(c, u, a, sc = 1) {
    const d = build(), k = sc >= .96 ? 1 : 0, lens = [d.headCup, d.headName, d.head].map(x => x.plan.total), tot = lens[0] + lens[1] + lens[2];
    const f = i => u >= 1 ? 1 : clamp((u * tot - lens.slice(0, i).reduce((x, y) => x + y, 0)) / lens[i], 0, 1);
    if (f(0) > 0) pencilMarks(c, d.headCup, { progress: f(0), alpha: a });
    if (f(1) > 0) { if (k > 0) pencilMarks(c, d.headName, { progress: f(1), alpha: a * k }); if (k < 1) pencilMarks(c, d.headNameSmall, { progress: f(1), alpha: a * (1 - k) }); }
    if (f(2) > 0) pencilMarks(c, d.head, { progress: f(2), alpha: a });
  }
  // the lit screen and everything on it (display-local, clipped to the display)
  function screen(c, s = {}, o = {}) {
    const d = build(), at = o.at ?? HOME, A = s.alpha ?? 1;
    c.save(); frame(c, at);
    c.beginPath(); c.rect(DSP.x + 3, DSP.y + 3, DSP.w - 6, DSP.h - 6); c.clip();
    if ((s.light ?? 0) > 0) {
      const g = c.createRadialGradient(0, -60, 60, 0, 0, DSP.w * .62);
      g.addColorStop(0, `rgba(255,254,249,${Math.min(1, .7 * s.light).toFixed(3)})`); g.addColorStop(1, `rgba(255,253,246,${Math.min(1, .45 * s.light).toFixed(3)})`);
      c.fillStyle = g; c.fillRect(DSP.x, DSP.y, DSP.w, DSP.h);
    }
    if (A > 0) {
      if ((s.chrome ?? 0) > 0) pencilMarks(c, d.chrome, { progress: s.chrome, alpha: A });
      if ((s.addr ?? 0) > 0) pencilMarks(c, d.addr[s.addrPage ?? s.to ?? s.page], { progress: s.addr, alpha: A });
      if ((s.load ?? 0) > 0 && s.load < 1) { c.save(); c.strokeStyle = COL.graphite; c.globalAlpha *= .6 * A; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(DSP.x + 6, BAR + 3); c.lineTo(lerp(DSP.x + 6, DSP.x + DSP.w - 6, s.load), BAR + 3); c.stroke(); c.restore(); }
      if ((s.head ?? 0) > 0) header(c, s.head, A, at.s);
      c.save(); c.beginPath(); c.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h); c.clip();
      const dyn = s.dyn ?? {};
      if (s.to && (s.slide ?? 0) > 0) {
        const off = VIEW.w * s.slide, both = dx => {
          if (s.slide < 1) { c.save(); c.translate(-off + dx, 0); page(c, s.page, 1, dyn[s.page] ?? {}, A); c.restore(); }
          c.save(); c.translate(VIEW.w - off + dx, 0); page(c, s.to, 1, dyn[s.to] ?? {}, A); c.restore(); };
        // the pages move left; the smear's ghosts trail to the right
        if ((s.smear ?? 0) > 0) smear(c, 2, -s.smear, both); else both(0);
      } else if (s.page) page(c, s.page, s.u ?? 1, dyn[s.page] ?? {}, A);
      c.restore();
      cursor(c, s.cursor);
    }
    c.restore();
  }

  // ---------- the parcel ----------
  // o: {state: 'closed'|'a'|'b'|'open' (a, b: the flaps' in-betweens), u (closed draw-on), teapot 0..1 alpha, crack 0..1, at: {x, y, s}}
  function parcel(c, o = {}) {
    const d = build(), at = o.at ?? { x: PARCEL.x, y: PARCEL.y, s: 1 }, a = o.alpha ?? 1; let tip = null;
    c.save(); c.translate(at.x, at.y); if (at.s !== 1) c.scale(at.s, at.s); if (o.squash) c.scale(1 / o.squash, o.squash);
    if (!o.state || o.state === 'closed') {
      if ((o.u ?? 1) >= 1) { c.fillStyle = COL.paper; c.globalAlpha *= a; c.fill(polyPath([[-FW / 2, 0], FL, BL, BR, [FW / 2 + DXP, DYP], [FW / 2, 0]])); c.globalAlpha = 1; }
      const t = pencilMarks(c, d.parcelClosed, { progress: o.u ?? 1, alpha: a }); if (t && (o.u ?? 1) < 1) tip = t;
      if ((o.ud ?? 1) > 0) { const t2 = pencilMarks(c, d.parcelDetail, { progress: o.ud ?? 1, alpha: a }); if (t2 && (o.ud ?? 1) < 1) tip = t2; }
    } else {
      const P = d.parcel[o.state], F = P.fills, fill = p => { c.save(); c.fillStyle = COL.paper; c.globalAlpha *= a; c.fill(p); c.restore(); };
      fill(F.back); fill(F.left);
      fill(polyPath([FL, BL, BR, FR]));
      pencilMarks(c, P.back, { alpha: a });
      // the teapot inside
      c.save(); c.translate(TEA_IN.x + (o.jolt ?? 0), TEA_IN.y); fill(d.teaFill); pencilMarks(c, d.tea, { alpha: a * (o.teapot ?? 1) });
      if ((o.crack ?? 0) > 0) { const t = pencilMarks(c, d.crack, { progress: o.crack, color: 'red', alpha: a }); if (t && o.crack < 1) tip = [t[0] + TEA_IN.x + (o.jolt ?? 0), t[1] + TEA_IN.y]; }
      c.restore();
      fill(F.right); pencilMarks(c, P.right, { alpha: a });
      fill(F.paperL); fill(F.front); fill(F.side);
      pencilMarks(c, P.front, { alpha: a });
      fill(F.frontFlap); pencilMarks(c, P.frontFlap, { alpha: a });
      if ((o.pop ?? 0) > 0) pencilMarks(c, d.pop, { alpha: o.pop });
    }
    c.restore();
    return tip ? [at.x + tip[0] * at.s, at.y + tip[1] * at.s] : null;
  }
  const parcelTip = (u, at = { x: PARCEL.x, y: PARCEL.y, s: 1 }, detail = false) => { const cel = detail ? build().parcelDetail : build().parcelClosed, t = u >= 1 ? cel.strokes.at(-1).samples.at(-1).p : planAt(cel, u).tip; return [at.x + t[0] * at.s, at.y + t[1] * at.s]; };
  const crackTip = (u, at = { x: PARCEL.x, y: PARCEL.y, s: 1 }) => { const cel = build().crack, t = u >= 1 ? cel.strokes.at(-1).samples.at(-1).p : planAt(cel, u).tip; return [at.x + (t[0] + TEA_IN.x) * at.s, at.y + (t[1] + TEA_IN.y) * at.s]; };

  // the laptop and its screen in one call (at = placement, screen = a screen state)
  function draw(c, o = {}) { const at = o.at ?? HOME; body(c, { at, alpha: o.alpha }); if (o.screen) screen(c, o.screen, { at }); }
  // the screens the acts end on
  const END_A1 = { light: 1, chrome: 1, addr: 1, addrPage: 'ordered', head: 1, page: 'ordered', u: 1, dyn: { ordered: { check: 1, title: 1, note: 1 } }, cursor: { x: AT.rest[0], y: AT.rest[1], a: 1 } };
  const END_A2 = { light: 1, chrome: 1, addr: 1, addrPage: 'requested', head: 1, page: 'requested', u: 1, dyn: { requested: { check: 1, title: 1, note: 1 } }, cursor: { x: AT.restLow[0], y: AT.restLow[1], a: 1 } };

  return { LAP, HOME, DSP, BAR, HEAD, VIEW, SMALL, PARCEL, TEA_IN, AT, D, PRESS_N, build, frame, toWorld, body, bodyTip, keysFor, draw, screen, page, pageLen, cursor, cursorTrack, pressed, slideAt, parcel, parcelTip, crackTip, END_A1, END_A2 };
})();
