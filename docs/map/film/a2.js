// Copied from temporal-film (scenes2/a2.js), unmodified.
'use strict';
// ============================================================
// Act 2 (v2): it arrives broken; she asks for a refund.
// Starts on act 1's last frame (SC.END_A1, pixel-identical). The laptop slides left and shrinks
// while its screen goes to sleep (days pass). The pencil draws a parcel beside it; the box
// squashes, its flaps swing open (two in-betweens) and show the teapot inside; we hold on it, then the camera leans in and the
// red pencil draws the crack (red = wrong). One continuous move takes us back to her laptop: the
// camera eases out, the parcel slides away right, the laptop returns to the middle and wakes on
// "My orders" (the row "A-1001 / Ceramic Teapot / 49.99 EUR" and "Request refund"). Click; a
// "Reason" form; she clicks into the box and "Arrived broken" is typed; "Submit"; the page slides
// to "Refund requested" with a graphite check.
// Ends on SC.END_A2 at SC.HOME (act 3 starts from this laptop and screen).
//
// Beat sheet (scene-local seconds; computed below from the drawings' lengths, values as built)
//  t      what the viewer notices                        action / exposure                     sound
//  0.0    act 1's last frame                              hold                                   -
//  0.1    the laptop slides left and shrinks; its         on twos, eased; screen fades out       -
//         screen goes to sleep (to 0.85)                  (the shop's name turns to a scrawl
//                                                         below readable size, as it fades)
//  0.7    the pencil draws a parcel beside it (closed,    graphite, on ones at hand speed;       pencil
//         taped, a label, "this way up"), to 1.78         details with a quicker hand
//  2.0    the box squashes (4 frames); 2.17 the flaps     replacement drawings: in-between a     box
//         rise (a: leaning in, a fold line at the front   (2 frames), b (2 frames), open with
//         hinge), 2.25 swing out (b: the teapot's top     a settle; pop marks (gone by 2.67)
//         half shows), 2.33 open: the teapot inside
//  2.33   hold on the open box (wide) for 0.4 s           -                                      -
//  2.73   the camera leans in on the teapot (x1.6)        camera on ones, 0.58 s                 -
//  3.25   the red pencil draws the crack (to 3.51)        red, on ones                           crack
//  3.35   "It arrives broken. / She asks for a refund."    caption on ones, written 4.84,         -
//                                                         lifts off 11.85 (gone 12.15)
//  4.75   back to her laptop in one move (to 5.5): the    camera on ones (easeInOutSine); the    whoosh
//         camera eases out, the parcel slides out right,  parcel (accelerating) and the laptop
//         the laptop returns to the middle                (SMALL -> HOME) on twos
//  5.5    the screen wakes as it arrives (first lit       machine, on ones                       boot (5.5,
//         drawing); loading line; "My orders" draws                                              the lit frame)
//         itself (5.67-6.5)
//  6.33   the cursor glides to "Request refund"; 6.83     3 pressed drawings, grey tone          click
//         click
//  7.08   the page slides to the form (to 7.7)            on ones, easeInOutSine, light smear    paper
//  7.74   the cursor moves into the Reason box, 8.17      caret appears with the click           click
//         click; 8.29 "Arrived broken" is typed           letters on ones                        type
//  9.75   click "Submit"                                  3 pressed drawings                     click
//  10.0   the page slides to "Refund requested"; 10.75    on ones                                paper, tick
//         check, 11.13 the words
//  10.72  the cursor drifts aside; hold to 12.2 (= SC.END_A2; a3 holds it 0.17 s more, then shrinks it)
// ============================================================
(() => {
  const D = SC.build(), AT = SC.AT;
  const g = n => Math.round(n * 12) / 12;
  const MACHINE = 14000;
  const SLIDE = .62;                                                  // a page change (on ones, SC.slideAt)
  const pageT = id => SC.pageLen(id) / MACHINE;
  const T = { shrink: [.1, .85], fade: [.1, .45], sleep: [.3, .85] };
  T.box = [.7, .7 + drawTime(D.parcelClosed)]; T.boxDet = [T.box[1], T.box[1] + drawTime(D.parcelDetail, 9000)];   // the pencil enters while the laptop still moves
  // the box squashes (held 4 frames), then the flaps swing open in two in-betweens on twos (a: rising and
  // leaning in, b: swinging out, the teapot's top half shows) to the open pose
  T.squash = g(T.boxDet[1] + .25); T.pop = T.squash + 2 / 12; T.popB = T.pop + 1 / 12; T.open = T.popB + 1 / 12;
  T.push = [T.open + .4, T.open + .98];                                // hold the open box, then the camera leans in on the teapot
  T.crack = [g(T.push[1] - .08), g(T.push[1] - .08) + drawTime(D.crack, 1300)];
  const capT0 = T.crack[0] + .1;                                      // the words start with the red line
  const CAP_LINES = ['It arrives broken.', 'She asks for a refund.'], capWritten = makeCaption('a2a', { lines: CAP_LINES, t0: capT0, out: 99 }).written;
  // back to her laptop in one continuous move once the caption is written: the camera eases out, the
  // parcel slides away to the right, the laptop comes back to the middle and wakes as it arrives
  // (the camera sets off while the caption's last letters are written: the caption is on the screen, not on the sheet)
  T.back = [g(capWritten - .12), g(capWritten - .12) + .75]; T.parcelOut = [T.back[0], T.back[0] + .58]; T.lapBack = [T.back[0] + .08, T.back[1]];
  T.wake = [T.back[1] - .08, T.back[1] + .17];
  T.lit = Math.floor(T.wake[0] * 12 + 1e-6) / 12 + 1 / 12;           // the first drawing (twos) on which the screen is lit: the boot cue
  T.orders = [g(T.wake[0] + .2), g(T.wake[0] + .2) + pageT('orders')];
  T.load0 = [T.wake[0], T.orders[0] + .1];                            // the loading line runs on a little into the page's drawing, then goes
  T.toRefund = [g(T.orders[1] - .2), g(T.orders[1] - .2) + .5]; T.clickRefund = g(T.toRefund[1] + .12);   // it sets off while the button draws
  T.slide1 = [T.clickRefund + SC.PRESS_N / 12, T.clickRefund + SC.PRESS_N / 12 + SLIDE]; T.load1 = [T.clickRefund + .08, T.slide1[1] - .04];   // the page goes as the button comes up
  // she clicks into the Reason box, then types
  T.toReason = [T.slide1[1] + .04, T.slide1[1] + .39]; T.clickReason = g(T.toReason[1] + .08);
  T.type = [T.clickReason + .12, T.clickReason + .12 + 14 / 18];     // 14 letters, 18 per second, on ones
  T.toSubmit = [g(T.type[1] + .1), g(T.type[1] + .1) + .45]; T.clickSubmit = g(T.toSubmit[1] + .12);
  T.slide2 = [T.clickSubmit + SC.PRESS_N / 12, T.clickSubmit + SC.PRESS_N / 12 + SLIDE]; T.load2 = [T.clickSubmit + .08, T.slide2[1] - .04];
  T.check = [g(T.slide2[1] + .12), g(T.slide2[1] + .12) + .3];
  T.title = [T.check[1] + .08, T.check[1] + .08 + D.requested.title.plan.total / 5200];
  T.note = [T.title[1], T.title[1] + .25];
  T.rest = [T.slide2[1] + .1, T.slide2[1] + .7];
  const DUR = +(T.title[1] + .6).toFixed(3);                          // a3 holds this screen for about 4 s more
  // the caption lifts off once the note under "Refund requested" is written and is gone 0.05 s before the
  // act ends (the last frame is pixel-identical to a3's first)
  const cap = [makeCaption('a2a', { lines: CAP_LINES, t0: capT0, out: DUR - .35 })];

  // the laptop: home -> small (left, asleep), then back home for the rest of the act (on twos)
  const lapAt = q => {
    const H0 = SC.HOME, S1 = SC.SMALL;
    const k = q < T.lapBack[0] ? sm(T.shrink[0], T.shrink[1], q, easeIO) : 1 - sm(T.lapBack[0], T.lapBack[1], q, easeIO);
    return k <= 0 ? H0 : { x: lerp(H0.x, S1.x, k), y: lerp(H0.y, S1.y, k), s: lerp(H0.s, S1.s, k) }; };
  // the camera: still, a lean-in on the teapot for the crack, and the ease back out (on ones)
  const TEA = [SC.PARCEL.x + SC.TEA_IN.x + 10, SC.PARCEL.y + SC.TEA_IN.y - 120];
  // (zoom 1.6 on the teapot takes the small laptop out at the left and keeps the open flaps below the caption band)
  const camAt = tau => { const k = sm(T.push[0], T.push[1], tau, easeInOutSine) * (1 - sm(T.back[0], T.back[1], tau, easeInOutSine));
    return { x: lerp(CX, TEA[0], k), y: lerp(CY, 580, k), zoom: lerp(1, 1.6, k) }; };
  // the parcel slides out to the right, accelerating (on twos)
  const parcelDX = q => 1150 * Math.pow(sm(T.parcelOut[0], T.parcelOut[1], q, x => x), 2);

  const st = makeStage([
    { id: 'box', t: T.box, pencil: true, ones: true, enter: .45, color: 'graphite', render(c, u) { SC.parcel(c, { state: 'closed', u, ud: 0 }); return SC.parcelTip(u); } },
    { id: 'boxDet', t: T.boxDet, pencil: true, ones: true, color: 'graphite', render(c, u) { SC.parcel(c, { state: 'closed', u: 1, ud: u }); return SC.parcelTip(u, undefined, true); } },
    { id: 'crack', t: T.crack, pencil: true, ones: true, enter: .5, color: 'red', render(c, u) { SC.parcel(c, { state: 'open', crack: u }); return SC.crackTip(u); } },
  ]);

  function screenAt(tau) {
    const q = tw(tau), lin = (a, t = tau) => sm(a[0], a[1], t, x => x);
    const loadK = a => tau >= a[0] && tau < a[1] + 1 / 24 ? Math.min(.999, lin(a)) : 0;   // full width for one frame, then gone
    if (tau < T.wake[0]) return { ...SC.END_A1, alpha: 1 - sm(T.fade[0], T.fade[1], q, x => x), light: 1 - sm(T.sleep[0], T.sleep[1], q, x => x) };   // act 1's confirmation, going to sleep
    const s = { light: sm(T.wake[0], T.wake[1], q, easeOut) * (1 + .4 * (1 - sm(T.wake[1], T.wake[1] + .3, q, easeOut))), alpha: sm(T.wake[0], T.wake[0] + .17, q, x => x),
      chrome: 1, head: 1, addr: 1, addrPage: 'orders', page: 'orders', u: lin(T.orders), dyn: {} };
    s.load = loadK(T.load0);
    s.dyn.orders = { press: SC.pressed(q, T.clickRefund) };
    if (tau >= T.load1[0]) { s.load = loadK(T.load1); s.addrPage = 'reason'; }
    if (tau >= T.slide1[0]) { const k = SC.slideAt(tau, T.slide1[0], SLIDE); s.to = 'reason'; s.slide = k.slide; s.smear = k.smear; }
    // the caret appears with the click into the box and blinks (0.2 s) while it waits
    const blink = tau < T.type[0] || tau > T.type[1] ? Math.floor((tau - T.clickReason) / .2) % 2 === 0 : true;
    s.dyn.reason = { typed: tau < T.type[0] ? 0 : Math.floor((tau - T.type[0]) * 18) + 1, caret: tau >= T.clickReason && tau < T.clickSubmit && blink,
      press: SC.pressed(q, T.clickSubmit) };
    if (tau >= T.slide1[1]) { s.page = 'reason'; s.to = null; s.slide = 0; s.smear = 0; }
    if (tau >= T.load2[0]) { s.load = loadK(T.load2); s.addrPage = 'requested'; }
    if (tau >= T.slide2[0]) { const k = SC.slideAt(tau, T.slide2[0], SLIDE); s.to = 'requested'; s.slide = k.slide; s.smear = k.smear; }
    s.dyn.requested = { check: lin(T.check), title: lin(T.title), note: lin(T.note) };
    if (tau >= T.slide2[1]) { s.page = 'requested'; s.to = null; s.slide = 0; s.smear = 0; }
    s.cursor = SC.cursorTrack(q, AT.wake, [
      { t: T.toRefund, to: AT.refund, lift: 30 },
      { t: T.toReason, to: AT.reason, lift: 20 },
      { t: T.toSubmit, to: AT.submit, lift: 36 },
      { t: T.rest, to: AT.restLow, lift: 16 },
    ], [T.clickRefund, T.clickReason, T.clickSubmit]);
    return s;
  }

  function scene(c, tau) {
    SC.build(); st.begin();
    const q = tw(tau), cm = camAt(tau), at = lapAt(q);
    cam(c, cm.x, cm.y, cm.zoom);
    paperSheet(c);

    // the parcel: drawn closed by the pencil, squashes, pops open (mid, open), the crack; then it slides away
    const dx = parcelDX(q);
    if (tau >= T.box[0] && q < T.parcelOut[1]) {
      if (dx > 0) { c.save(); c.translate(dx, 0); }
      if (tau < T.box[1]) st.draw(c, tau, 'box');
      else if (tau < T.boxDet[1]) st.draw(c, tau, 'boxDet', { u: Math.max(1e-4, progressOf(st.byId.boxDet, tau)) });   // never a frame without the box
      else if (q < T.squash) SC.parcel(c, { state: 'closed' });
      else if (q < T.pop) SC.parcel(c, { state: 'closed', squash: .94 });
      else if (q < T.popB) SC.parcel(c, { state: 'a', squash: 1.04 });
      else if (q < T.open) SC.parcel(c, { state: 'b', squash: 1.02 });
      else {
        const settle = q < T.open + 2 / 12 ? 1.03 : 1, pop = q < T.open + 4 / 12 ? 1 - sm(T.open + 2 / 12, T.open + 4 / 12, q, x => x) : 0;
        if (tau >= T.crack[0] && tau < T.crack[1]) st.draw(c, tau, 'crack', { u: Math.max(1e-4, progressOf(st.byId.crack, tau)) });
        else SC.parcel(c, { state: 'open', squash: settle, pop, crack: tau >= T.crack[1] ? 1 : 0 });
      }
      if (dx > 0) c.restore();
    }
    // the laptop (the parcel never overlaps it: it has left before the laptop reaches its old place)
    SC.body(c, { at });
    SC.screen(c, screenAt(tau), { at });

    st.pencil(c, tau, { rest: .6, home: [W + 300, H * .62] });
    resetT(c); for (const k of cap) k.draw(c, tau);
    vignette(c);
  }

  SCENES.push({ key: 'a2', name: 'broken, refund request', dur: DUR, fn: scene, captions: cap, stage: st,
    cues: [
      { t: T.box[0], type: 'pencil' },
      { t: T.pop, type: 'box' },
      { t: T.crack[0], type: 'crack' },
      { t: T.parcelOut[0], type: 'whoosh' },
      { t: T.lit, type: 'boot' },
      { t: T.clickRefund, type: 'click' },
      { t: T.slide1[0], type: 'paper' },
      { t: T.clickReason, type: 'click' },
      { t: T.type[0], type: 'type', dur: +(T.type[1] - T.type[0]).toFixed(2) },
      { t: T.clickSubmit, type: 'click' },
      { t: T.slide2[0], type: 'paper' },
      { t: T.check[0] + .1, type: 'tick' },
    ] });
})();
