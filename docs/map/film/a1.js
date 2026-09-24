// Copied from temporal-film (scenes2/a1.js), unmodified.
'use strict';
// ============================================================
// Act 1 (v2): the shop. Maria orders a teapot online.
// The pencil draws Maria's laptop. The screen comes on by itself while the pencil finishes the
// deck: a browser, the shop's header ("Teahouse"), an address typed, and a product page that draws itself
// (a teapot, "Ceramic Teapot", a price tag "49.99 EUR", a "Buy" button). Her cursor looks at the
// price first (it rests on the tag; the price is underlined), then glides to Buy and clicks; the
// page slides to checkout; "Maria" is typed into "Name", "Address" fills in; "Pay 49.99 EUR" is clicked; the page
// slides to the confirmation: a graphite check and "Order A-1001".
// Ends on SC.END_A1 (act 2 starts from this exact screen).
//
// Beat sheet (scene-local seconds; computed below from the drawings' lengths, values as built)
//  t      what the viewer notices                        action / exposure                     sound
//  0.0    blank sheet; the pencil slides in from right    linear entrance                        -
//  0.2    the pencil draws a big laptop (to 2.99)         graphite, on ones at hand speed;       pencil
//                                                         key tops appear on twos under it
//  0.5    "Maria orders a teapot online."                 caption on ones, held to 12.16         -
//  1.72   the screen lights up (display outline closed)   flash, then settles                    boot
//  1.82   browser bar, shop header ("Teahouse"),          the machine draws its own screen;      -
//         address typed;
//         the loading line runs full (2.52-2.71)          on ones
//  2.75   the product page draws itself (to 3.78):        on ones, machine speed                 -
//         teapot, "Ceramic Teapot", tag "49.99 EUR", Buy
//  4.0    her cursor comes in and glides to the price     on twos, eased arc                     -
//         tag (to 4.6); the price is underlined (4.64-4.94, on ones); she looks 0.8 s
//  5.42   the cursor glides to Buy; the underline fades   on twos                                -
//  6.0    click: Buy presses (face down 8/9 px, grey      3 pressed drawings, cursor to .8,      click
//         tone), click marks                              marks fade over 3 more
//  6.25   the page slides to checkout (to 6.87)           on ones, easeInOutSine, light smear    paper
//  7.42   cursor clicks the Name field; "Maria" is        letters on ones (5 in 0.48 s), caret;  click, type
//         typed (7.56-8.04), then Address (to 8.8)        the address a scrawl
//  9.5    click "Pay 49.99 EUR"                           3 pressed drawings                     click
//  9.75   the page slides to the confirmation (to 10.37)  on ones                                paper
//  10.5   a graphite check, then "Order A-1001" (10.88)   on ones                                tick
//  10.47  the cursor drifts aside; hold to 12.61 (= SC.END_A1)                                   -
// ============================================================
(() => {
  const D = SC.build(), AT = SC.AT;
  const g = n => Math.round(n * 12) / 12;                  // snap a beat to the twos grid
  const MACHINE = 11000;                                    // px of stroke per second when the screen draws itself
  const SLIDE = .62;                                        // a page change (on ones, SC.slideAt)
  const pageT = id => SC.pageLen(id) / MACHINE;
  const T = {};
  T.lap = [.2, .2 + drawTime(D.body)];
  const L = T.lap[0] + D.displayDone * (T.lap[1] - T.lap[0]);   // the display outline is closed: the screen comes on
  Object.assign(T, { light: [L, L + .12], chrome: [L + .1, L + .38], head: [L + .34, L + .62], url: [L + .55, L + .85] });
  T.page = [g(L + 1.0), g(L + 1.0) + pageT('product')];
  T.load0 = [L + .8, T.page[0] - 1 / 24];                   // the loading line is full on the frame before the page starts
  T.curIn = g(Math.max(T.page[1], T.lap[1]) + .2);          // her cursor appears once the pencil has gone and the page is there
  // she looks at the price first: the cursor rests on the tag, the price is underlined (hover)
  T.toTag = [T.curIn, T.curIn + .6]; T.hover = [T.toTag[1] + .04, T.toTag[1] + .34];
  T.toBuy = [g(T.toTag[1] + .8), g(T.toTag[1] + .8) + .5]; T.hoverOff = [T.toBuy[0] + .08, T.toBuy[0] + .25];
  T.clickBuy = g(T.toBuy[1] + .12);
  T.slide1 = [T.clickBuy + SC.PRESS_N / 12, T.clickBuy + SC.PRESS_N / 12 + SLIDE]; T.load1 = [T.clickBuy + .08, T.slide1[1] - .04];   // the page goes as the button comes up
  T.toName = [T.slide1[1] + .06, T.slide1[1] + .44]; T.clickName = g(T.toName[1] + .08);
  T.name = [T.clickName + .14, T.clickName + .62]; T.addr = [T.name[1] + .14, T.name[1] + .76];
  T.toPay = [g(T.addr[1] + .1), g(T.addr[1] + .1) + .5]; T.clickPay = g(T.toPay[1] + .12);
  T.slide2 = [T.clickPay + SC.PRESS_N / 12, T.clickPay + SC.PRESS_N / 12 + SLIDE]; T.load2 = [T.clickPay + .08, T.slide2[1] - .04];
  T.check = [g(T.slide2[1] + .12), g(T.slide2[1] + .12) + .3];
  T.title = [T.check[1] + .08, T.check[1] + .08 + D.ordered.title.plan.total / 5200];
  T.note = [T.title[1], T.title[1] + .25];
  T.rest = [T.slide2[1] + .1, T.slide2[1] + .7];
  const DUR = +(T.title[1] + 1.45).toFixed(3);
  const cap = [makeCaption('a1a', { lines: ['Maria orders a teapot online.'], t0: .5, out: DUR - .45 })];

  const st = makeStage([
    // the body on ones at hand speed; the key tops on twos under the pencil (body progress snapped to twos)
    { id: 'lap', t: T.lap, pencil: true, ones: true, enter: .2, color: 'graphite', render(c, u) {
      const q = u >= 1 ? 1 : clamp((tw(T.lap[0] + u * (T.lap[1] - T.lap[0])) - T.lap[0]) / (T.lap[1] - T.lap[0]), 0, 1);
      SC.body(c, { u, keys: SC.keysFor(q) }); return SC.bodyTip(u); } },
  ]);

  // the screen at scene time tau: the machine types on ones, the cursor on twos, page slides on ones
  function screenAt(tau) {
    const q = tw(tau), lin = (a, t = tau) => sm(a[0], a[1], t, x => x);
    // a loading line runs to full width, shows full for one frame, then goes
    const loadK = a => tau >= a[0] && tau < a[1] + 1 / 24 ? Math.min(.999, lin(a)) : 0;
    const s = { light: sm(T.light[0], T.light[1], q, easeOut) * (1 + .5 * (1 - sm(T.light[1], T.light[1] + .3, q, easeOut))),
      chrome: lin(T.chrome), head: lin(T.head), addr: lin(T.url), addrPage: 'product', page: 'product', u: lin(T.page), dyn: {} };
    s.load = loadK(T.load0);
    s.dyn.product = { press: SC.pressed(q, T.clickBuy), hover: lin(T.hover), hoverA: 1 - sm(T.hoverOff[0], T.hoverOff[1], q, x => x) };
    if (tau >= T.load1[0]) { s.load = loadK(T.load1); s.addrPage = 'checkout'; }
    if (tau >= T.slide1[0]) { const k = SC.slideAt(tau, T.slide1[0], SLIDE); s.to = 'checkout'; s.slide = k.slide; s.smear = k.smear; }
    s.dyn.checkout = { name: lin(T.name), addr: lin(T.addr), caret: tau >= T.clickName && tau < T.toPay[1] ? (tau >= T.name[1] + .1 ? 'addr' : 'name') : 0,
      press: SC.pressed(q, T.clickPay) };
    if (tau >= T.slide1[1]) { s.page = 'checkout'; s.to = null; s.slide = 0; s.smear = 0; }
    if (tau >= T.load2[0]) { s.load = loadK(T.load2); s.addrPage = 'ordered'; }
    if (tau >= T.slide2[0]) { const k = SC.slideAt(tau, T.slide2[0], SLIDE); s.to = 'ordered'; s.slide = k.slide; s.smear = k.smear; }
    s.dyn.ordered = { check: lin(T.check), title: lin(T.title), note: lin(T.note) };
    if (tau >= T.slide2[1]) { s.page = 'ordered'; s.to = null; s.slide = 0; s.smear = 0; }
    // the caret blinks (0.2 s on, 0.2 s off between the fields; 0.4 s after the address) while it waits
    if (s.dyn.checkout.caret && tau > T.name[1] && tau < T.addr[0] && Math.floor((tau - T.name[1]) / .2) % 2) s.dyn.checkout.caret = 0;
    if (s.dyn.checkout.caret && tau > T.addr[1] && Math.floor((tau - T.addr[1]) / .4) % 2) s.dyn.checkout.caret = 0;
    if (q >= T.curIn) s.cursor = SC.cursorTrack(q, AT.enter, [
      { t: T.toTag, to: AT.tag, lift: 24 },
      { t: T.toBuy, to: AT.buy, lift: 30 },
      { t: T.toName, to: AT.name, lift: 30 },
      { t: T.toPay, to: AT.pay, lift: 30 },
      { t: T.rest, to: AT.rest, lift: 16 },
    ], [T.clickBuy, T.clickName, T.clickPay]);
    return s;
  }

  function scene(c, tau) {
    SC.build(); st.begin();
    cam(c, CX, CY, 1);
    paperSheet(c);
    const q = tw(tau);
    st.draw(c, tau, 'lap');
    if (q >= T.light[0]) SC.screen(c, screenAt(tau));
    // the pencil slides in from the right edge (linear, so its first drawing crosses the edge),
    // draws the laptop, then drops away below the sheet
    st.pencil(c, tau, { rest: .6, home: tau < T.lap[0] + .5 ? [W + 240, 420] : [1640, H + 460], enterEase: x => x });
    resetT(c); for (const k of cap) k.draw(c, tau);
    vignette(c);
  }

  SCENES.push({ key: 'a1', name: 'the shop', dur: DUR, fn: scene, captions: cap, stage: st,
    cues: [
      { t: T.lap[0], type: 'pencil' },
      { t: T.light[0], type: 'boot' },
      { t: T.clickBuy, type: 'click' },
      { t: T.slide1[0], type: 'paper' },
      { t: T.clickName, type: 'click' }, { t: T.name[0], type: 'type', dur: +(T.addr[1] - T.name[0]).toFixed(2) },
      { t: T.clickPay, type: 'click' },
      { t: T.slide2[0], type: 'paper' },
      { t: T.check[0] + .1, type: 'tick' },
    ] });
})();
