'use strict';
// ============================================================
// game/shop.js: the shop and the player's laptop (GAME_SPEC §4 P1, P2, the stage 1 wide shot, stage 9's
// refund email page).
//
// Draws from a shop state S (story.js SCHEMAS "SHOP STATE"). Coordinates: the shop camera is
// cam(c, CX, CY, 1), so shop world == screen (logical 1920x1080); the laptop's display is display-local
// (x -480..480, y -300..300), world = SC.toWorld(at, p) (stageC.js:317).
// Called by runtime.js (init, frame, pointer), ui.js via runtime (hotspots) and story.js (SHOP.seq: the
// shop beats' durations, states, idles and sound cues).
//
// THE SHOP TIMELINE (SHOP.seq). Each shop beat maps its local time onto one continuous timeline built
// with the film's own formulas (a1.js:39-64, a2.js:49-82), so the live laptop continues exactly where a
// film window stops and ends exactly on SC.END_A1 / SC.END_A2 (stageC.js:479-480):
//   product    a1 window tau 0 -> T.curIn (the product page is complete, the cursor not in yet), then
//              the hold for Buy: the film's cursor comes in, rests on the price tag (hover), goes to Buy.
//   checkout   Buy is pressed (3 drawings), the page slides (SC.slideAt .62), the cursor clicks the Name
//              field by itself, the player's name types itself at 14 letters/s (NAME.typedName, or the
//              fallback drawing), the address scrawl; the cursor goes to Pay; the hold for Pay.
//   ordered    Pay is pressed, the page slides, the check, "Order A-1001"; ends on SC.END_A1.
//   broken     a2 window tau 0 -> T.toRefund[0] ("My orders" is drawn), then the hold for Request refund.
//   reason     the press, the slide, the click into Reason, "Arrived broken" at 18 letters/s, the cursor
//              to Submit; the hold for Submit.
//   requested  Submit is pressed, the slide, the check, "Refund requested"; ends on SC.END_A2.
//   wide       a3 window tau 0 -> T.cut (4.72): the wide shot, the rack, the slip's flight, the push.
//   mail       stage 9: the laptop on END_A2; the page slides to the refund email ("Your refund",
//              "Hi <name>," / "we refunded 49.99 EUR."; the name in pencil or the fallback drawing).
// The live pointer: states carry live: true and follow 0..1 (how much the drawn cursor follows the real
// pointer; runtime adds S.pointer). Without a pointer (keyboard, touch after the finger lifts) the cursor
// glides along the film's own track (SC.cursorTrack, stageC.js:392). Automatic moves (the click into
// Name / Reason, the drift aside at the end) blend the cursor from the pointer to the film's track.
// ============================================================
window.SHOP = (() => {
  /** Typing rates (letters per second): the name at checkout, the refund reason (a2.js:75). */
  const RATE = { name: 14, reason: 18 };
  const g = n => Math.round(n * 12) / 12;                  // snap a beat to the twos grid (a1.js:40)
  const SLIDE = .62;                                        // a page change (a1.js:42, a2.js:52)
  const lin = (a, t) => sm(a[0], a[1], t, x => x);
  /** The act object pushed by film/<act>.js. @param {'a1'|'a2'|'a3'} key */
  const act = key => SCENES.find(s => s.key === key) ?? null;
  let blanked = false, capHook = null;
  const orig = new Map();   // act key -> the act's own caption objects' draw functions (dev checks)

  // ---------- the film's timings ----------
  // from scenes2/a1.js:43-64 (T chain and DUR). The one change: the name's typing time is a parameter
  // (the film types "Maria" in .48 s; the game types the player's name at RATE.name letters per second).
  function a1Times(nameDur = .48) {
    const D = SC.build(), MACHINE = 11000, pageT = id => SC.pageLen(id) / MACHINE, T = {};
    T.lap = [.2, .2 + drawTime(D.body)];
    const L = T.lap[0] + D.displayDone * (T.lap[1] - T.lap[0]);
    Object.assign(T, { light: [L, L + .12], chrome: [L + .1, L + .38], head: [L + .34, L + .62], url: [L + .55, L + .85] });
    T.page = [g(L + 1.0), g(L + 1.0) + pageT('product')];
    T.load0 = [L + .8, T.page[0] - 1 / 24];
    T.curIn = g(Math.max(T.page[1], T.lap[1]) + .2);
    T.toTag = [T.curIn, T.curIn + .6]; T.hover = [T.toTag[1] + .04, T.toTag[1] + .34];
    T.toBuy = [g(T.toTag[1] + .8), g(T.toTag[1] + .8) + .5]; T.hoverOff = [T.toBuy[0] + .08, T.toBuy[0] + .25];
    T.clickBuy = g(T.toBuy[1] + .12);
    T.slide1 = [T.clickBuy + SC.PRESS_N / 12, T.clickBuy + SC.PRESS_N / 12 + SLIDE]; T.load1 = [T.clickBuy + .08, T.slide1[1] - .04];
    T.toName = [T.slide1[1] + .06, T.slide1[1] + .44]; T.clickName = g(T.toName[1] + .08);
    T.name = [T.clickName + .14, T.clickName + .14 + nameDur]; T.addr = [T.name[1] + .14, T.name[1] + .76];
    T.toPay = [g(T.addr[1] + .1), g(T.addr[1] + .1) + .5]; T.clickPay = g(T.toPay[1] + .12);
    T.slide2 = [T.clickPay + SC.PRESS_N / 12, T.clickPay + SC.PRESS_N / 12 + SLIDE]; T.load2 = [T.clickPay + .08, T.slide2[1] - .04];
    T.check = [g(T.slide2[1] + .12), g(T.slide2[1] + .12) + .3];
    T.title = [T.check[1] + .08, T.check[1] + .08 + D.ordered.title.plan.total / 5200];
    T.note = [T.title[1], T.title[1] + .25];
    T.rest = [T.slide2[1] + .1, T.slide2[1] + .7];
    T.DUR = +(T.title[1] + 1.45).toFixed(3);
    T.settled = Math.max(T.note[1], T.rest[1], T.load2[1] + 1 / 24);   // from here the screen equals SC.END_A1
    return T;
  }
  // from scenes2/a2.js:53-82 (T chain and DUR). The caption's written time is read from the act's own
  // caption object (a2.js:62 computes it from the same lines and t0), so no film text is repeated here.
  function a2Times() {
    const D = SC.build(), MACHINE = 14000, pageT = id => SC.pageLen(id) / MACHINE;
    const T = { shrink: [.1, .85], fade: [.1, .45], sleep: [.3, .85] };
    T.box = [.7, .7 + drawTime(D.parcelClosed)]; T.boxDet = [T.box[1], T.box[1] + drawTime(D.parcelDetail, 9000)];
    T.squash = g(T.boxDet[1] + .25); T.pop = T.squash + 2 / 12; T.popB = T.pop + 1 / 12; T.open = T.popB + 1 / 12;
    T.push = [T.open + .4, T.open + .98];
    T.crack = [g(T.push[1] - .08), g(T.push[1] - .08) + drawTime(D.crack, 1300)];
    T.capT0 = T.crack[0] + .1;                                          // the P2 caption starts with the red line
    const capWritten = act('a2').captions[0].written;
    T.back = [g(capWritten - .12), g(capWritten - .12) + .75]; T.parcelOut = [T.back[0], T.back[0] + .58]; T.lapBack = [T.back[0] + .08, T.back[1]];
    T.wake = [T.back[1] - .08, T.back[1] + .17];
    T.orders = [g(T.wake[0] + .2), g(T.wake[0] + .2) + pageT('orders')];
    T.load0 = [T.wake[0], T.orders[0] + .1];
    T.toRefund = [g(T.orders[1] - .2), g(T.orders[1] - .2) + .5]; T.clickRefund = g(T.toRefund[1] + .12);
    T.slide1 = [T.clickRefund + SC.PRESS_N / 12, T.clickRefund + SC.PRESS_N / 12 + SLIDE]; T.load1 = [T.clickRefund + .08, T.slide1[1] - .04];
    T.toReason = [T.slide1[1] + .04, T.slide1[1] + .39]; T.clickReason = g(T.toReason[1] + .08);
    T.type = [T.clickReason + .12, T.clickReason + .12 + D.reason.typed.n / RATE.reason];
    T.toSubmit = [g(T.type[1] + .1), g(T.type[1] + .1) + .45]; T.clickSubmit = g(T.toSubmit[1] + .12);
    T.slide2 = [T.clickSubmit + SC.PRESS_N / 12, T.clickSubmit + SC.PRESS_N / 12 + SLIDE]; T.load2 = [T.clickSubmit + .08, T.slide2[1] - .04];
    T.check = [g(T.slide2[1] + .12), g(T.slide2[1] + .12) + .3];
    T.title = [T.check[1] + .08, T.check[1] + .08 + D.requested.title.plan.total / 5200];
    T.note = [T.title[1], T.title[1] + .25];
    T.rest = [T.slide2[1] + .1, T.slide2[1] + .7];
    T.DUR = +(T.title[1] + .6).toFixed(3);
    T.settled = Math.max(T.note[1], T.rest[1], T.load2[1] + 1 / 24);   // from here the screen equals SC.END_A2
    return T;
  }
  // a3's cut (a3.js:378, T.cut = T.push[1]; T.push = [p0, p0 + .72] and the act's second whoosh cue is at p0 + .2)
  const a3Cut = () => { const w = act('a3').cues.filter(k => k.type === 'whoosh')[1]; return +(w.t - .2 + .72).toFixed(6); };
  let A1 = null, A2 = null, CUT = null;
  const t1Cache = new Map();
  const film1 = () => (A1 ??= a1Times());
  const film2 = () => (A2 ??= a2Times());
  /** The P1 timeline for a name of n letters (the film's own for n = 0: "Maria" in .48 s). */
  const p1 = n => { if (!n) return film1(); if (!t1Cache.has(n)) t1Cache.set(n, a1Times(n / RATE.name)); return t1Cache.get(n); };

  /** Film windows replayed frame for frame (GAME_SPEC §2), act-local tau, half-open [t0, t1). */
  const WINDOWS = {};
  Object.defineProperties(WINDOWS, {
    a1: { enumerable: true, get: () => [0, film1().curIn] },
    a2: { enumerable: true, get: () => [0, film2().toRefund[0]] },
    a3: { enumerable: true, get: () => [0, CUT ??= a3Cut()] },
  });

  /**
   * Once, before the first shop frame: SC.build(), blank the captions of film acts a1-a3 (GAME_SPEC §2),
   * so replayed windows show no film text, and register the refund email page ('mail') with SC.
   * The act's FIRST caption slot becomes a hook: film() routes the game's caption through it, so a film
   * window draws the game caption where the film drew its own (after resetT, BEFORE the act's vignette;
   * a1.js:115-116, a2.js:162-163, a3.js:512-513). Idempotent. Called by runtime.js at start.
   */
  function init() {
    SC.build(); mailPage();
    if (blanked) return; blanked = true;
    for (const s of SCENES) if (['a1', 'a2', 'a3'].includes(s.key)) (s.captions ?? []).forEach((k, i) => {
      if (!orig.has(s.key)) orig.set(s.key, []); orig.get(s.key).push(k.draw);
      k.draw = i === 0 ? c => { const h = capHook; capHook = null; if (h) h(c); } : () => {};
    });
  }
  /**
   * Draw a film act at act-local tau exactly as the film does: its own camera, paper, props and its own
   * vignette (every act fn ends with vignette(c)). The caller did resetFrame before and must NOT draw a
   * second vignette nor the caption again (frame() returns true; the caption went through o.caption).
   * @param {CanvasRenderingContext2D} c @param {'a1'|'a2'|'a3'} key @param {number} tau seconds
   * @param {{caption?: (c) => void}=} o  draws the game's caption (runtime's drawCaption) in the act's
   *   caption slot; if the act has no caption object it is drawn after the act
   * @returns {boolean} true (the vignette is drawn)
   */
  function film(c, key, tau, o = {}) {
    const s = act(key); capHook = o.caption ?? null;
    if (s) s.fn(c, tau);
    if (capHook) { const h = capHook; capHook = null; resetT(c); h(c); }
    return true;
  }
  /** The act's OWN captions as the film drew them (dev/film.html ?via=shop checks the hook path). */
  function filmCaption(c, key, tau) { for (const d of orig.get(key) ?? []) d(c, tau); }

  // ---------- the refund email page (stage 9), cloned from D.requested (stageC.js:193-199) ----------
  // The ring and the check are D.requested's own cels; the title is new ("Your refund", the same place and
  // size as "Refund requested"); the note scrawl becomes two lettered lines (CONTENT.drawn.mail.lines, cap
  // 36 / condense .86 like the page lettering, SC CAP/CD stageC.js:49), drawn by overlay() because line 0
  // carries the player's name (pencil, or the fallback drawing).
  const MAIL = { cap: 36, cd: .86, y: [172, 236], width: 2.9, seed: 91, rest: [414, 232] };
  function mailPage() {
    const D = SC.build(); if (D.mail) return D.mail;
    const M = CONTENT.drawn.mail;
    D.mail = { parts: D.requested.parts,
      title: compile({ strokes: textStrokes(M.title, 0, 96, { cap: 44, condense: .86, align: 'center', id: 'game/mail/title', seed: 38, width: 3.3 }).strokes }, 'game/mail/title'),
      check: D.requested.check };
    // the address bar's scrawl for the new page (stageC.js:154's recipe, its own seed)
    D.addr.mail = compile({ strokes: scrawl('game/mail/addr', SC.DSP.x + 198, SC.DSP.y + 38, 290, 12, 74, { width: 1.8, opacity: .75 }) }, 'game/mail/addr');
    return D.mail;
  }
  /** "Hi {name}," split around the name: [before, after]. */
  const around = s => { const i = s.indexOf('{name}'); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 6)]; };
  /** A mail line lettered in pencil (font mode): one cel per text (the name is in the compile id). */
  const mailCel = (k, text) => compile({ strokes: textStrokes(text, 0, MAIL.y[k], { cap: MAIL.cap, condense: MAIL.cd, align: 'center', id: `game/mail/l${k}/${text}`, seed: MAIL.seed + k * 17, width: MAIL.width }).strokes }, `game/mail/l${k}/${text}`);
  /** Machine-writing time of the two mail lines (s), for a name. */
  function mailLens(name) {
    const L = CONTENT.drawn.mail.lines, [pre, post] = around(L[0]);
    const l0 = name.mode === 'font' ? mailCel(0, pre + name.text + post).plan.total : mailCel(0, pre + post).plan.total + NAME.measureName(name.text, 'fallback', MAIL.cap, MAIL.cd) * 3;
    return [l0 / 5200, mailCel(1, L[1]).plan.total / 5200];
  }
  function drawMailLines(c, name, u, a) {
    const L = CONTENT.drawn.mail.lines, [pre, post] = around(L[0]), f0 = clamp(u, 0, 1), f1 = clamp(u - 1, 0, 1);
    if (f0 > 0 && name) {
      if (name.mode === 'font') pencilMarks(c, mailCel(0, pre + name.text + post), { progress: f0, alpha: a });
      else {
        // the name by NAME's fallback drawing between the pencil's "Hi " and ","
        const wp = measure(pre, MAIL.cap, 0, MAIL.cd), wn = NAME.measureName(name.text, 'fallback', MAIL.cap, MAIL.cd), wq = measure(post, MAIL.cap, 0, MAIL.cd), x0 = -(wp + wn + wq) / 2;
        const cPre = compile({ strokes: textStrokes(pre, x0, MAIL.y[0], { cap: MAIL.cap, condense: MAIL.cd, id: 'game/mail/pre', seed: MAIL.seed, width: MAIL.width }).strokes }, 'game/mail/pre@' + x0.toFixed(2));
        const cPost = compile({ strokes: textStrokes(post, x0 + wp + wn, MAIL.y[0], { cap: MAIL.cap, condense: MAIL.cd, id: 'game/mail/post', seed: MAIL.seed + 5, width: MAIL.width }).strokes }, 'game/mail/post@' + x0.toFixed(2));
        const k = [.25, .9];   // the parts of the line's writing time: before, the name, after
        c.save(); c.globalAlpha *= a;
        pencilMarks(c, cPre, { progress: clamp(f0 / k[0], 0, 1) });
        if (f0 > k[0]) NAME.drawText(c, name.text, x0 + wp, MAIL.y[0], { mode: 'fallback', cap: MAIL.cap, cd: MAIL.cd, align: 'left', u: clamp((f0 - k[0]) / (k[1] - k[0]), 0, 1), id: 'mail' });
        if (f0 > k[1]) pencilMarks(c, cPost, { progress: clamp((f0 - k[1]) / (1 - k[1]), 0, 1) });
        c.restore();
      }
    }
    if (f1 > 0) pencilMarks(c, mailCel(1, L[1]), { progress: f1, alpha: a });
  }

  /**
   * A mail page given only its write-on u (story.js's s9.mail: u 0..1, no dyn.mail.lines): the two lines are
   * the page's last parts, so u is shared out by length (SC.page's rule, stageC.js:347-349): the ring and the
   * title get the first share (SC.page runs them on u' = their share of u), then "Hi <name>," and the second
   * line write themselves. Without this the lines would be missing while u < 1 and then appear at once.
   * A screen that sets dyn.mail.lines itself (SHOP.seq.mail) is returned as it is.
   */
  function mailWriteOn(s, name) {
    const dm = (s.dyn ?? {}).mail ?? {}, u = s.u ?? 1;
    if (dm.lines !== undefined || u >= 1) return s;
    const D = mailPage(), tot = [...D.parts, D.title].reduce((a, p) => a + (p.cel ?? p).plan.total, 0);
    const [l0, l1] = mailLens(name ?? { text: '', mode: 'font' }).map(t => t * 5200), all = tot + l0 + l1, U = u * all, f = clamp(U - tot, 0, l0 + l1);
    const u1 = Math.min(1, U / tot);
    return { ...s, u: u1, dyn: { ...s.dyn, mail: { ...dm, title: u1, note: u1, lines: f <= 0 ? 0 : f < l0 ? f / l0 : 1 + (f - l0) / l1 } } };
  }

  // ---------- the checkout Name field ----------
  /**
   * Make the checkout page type THIS name (already fitted to NAME.BUDGET.field): NAME.install puts it into
   * SC.D.checkout.name (font mode: NAME.typedName, code-point indexed, compile ids 'game/co/name/<drawn>@<i>';
   * fallback: empty cels whose `ends` move the page's own caret, the letters by NAME.drawTyped in overlay()).
   * runtime.js installs it at start; this keeps the drawing right whoever called install last. Idempotent.
   */
  function field(name) {
    const k = NAME.checkout; if (!name || (k && k.text === name.text && k.mode === name.mode)) return;
    NAME.install({ drawnName: name.text, nameMode: name.mode });
  }
  /** Letters of a fitted field name (code points in font mode, as typedName counts; graphemes otherwise). */
  const letters = name => (!name ? 0 : name.mode === 'font' ? [...name.text].length : NAME.graphemes(name.text).length);
  // names fitted for their places, memoised (R() runs every drawing)
  const fitted = new Map();
  function fitName(G, where) {
    if (!G || !G.drawnName) return null;
    const key = where + '|' + G.nameMode + '|' + G.drawnName;
    if (!fitted.has(key)) { if (fitted.size > 16) fitted.clear(); fitted.set(key, { text: NAME.fit(G.drawnName, G.nameMode, NAME.BUDGET[where]), mode: G.nameMode }); }
    return fitted.get(key);
  }

  // ---------- the screens along the timeline ----------
  const AT = () => SC.AT;
  const loadK = (a, tau) => (tau >= a[0] && tau < a[1] + 1 / 24 ? Math.min(.999, lin(a, tau)) : 0);   // full width for one frame, then gone
  // from scenes2/a1.js:75-103 (screenAt), with T as a parameter (the name's typing time)
  function screenP1(tau, T) {
    const q = tw(tau), A = AT();
    const s = { light: sm(T.light[0], T.light[1], q, easeOut) * (1 + .5 * (1 - sm(T.light[1], T.light[1] + .3, q, easeOut))),
      chrome: lin(T.chrome, tau), head: lin(T.head, tau), addr: lin(T.url, tau), addrPage: 'product', page: 'product', u: lin(T.page, tau), dyn: {} };
    s.load = loadK(T.load0, tau);
    s.dyn.product = { press: SC.pressed(q, T.clickBuy), hover: lin(T.hover, tau), hoverA: 1 - sm(T.hoverOff[0], T.hoverOff[1], q, x => x) };
    if (tau >= T.load1[0]) { s.load = loadK(T.load1, tau); s.addrPage = 'checkout'; }
    if (tau >= T.slide1[0]) { const k = SC.slideAt(tau, T.slide1[0], SLIDE); s.to = 'checkout'; s.slide = k.slide; s.smear = k.smear; }
    s.dyn.checkout = { name: lin(T.name, tau), addr: lin(T.addr, tau), caret: tau >= T.clickName && tau < T.toPay[1] ? (tau >= T.name[1] + .1 ? 'addr' : 'name') : 0,
      press: SC.pressed(q, T.clickPay) };
    if (tau >= T.slide1[1]) { s.page = 'checkout'; s.to = null; s.slide = 0; s.smear = 0; }
    if (tau >= T.load2[0]) { s.load = loadK(T.load2, tau); s.addrPage = 'ordered'; }
    if (tau >= T.slide2[0]) { const k = SC.slideAt(tau, T.slide2[0], SLIDE); s.to = 'ordered'; s.slide = k.slide; s.smear = k.smear; }
    s.dyn.ordered = { check: lin(T.check, tau), title: lin(T.title, tau), note: lin(T.note, tau) };
    if (tau >= T.slide2[1]) { s.page = 'ordered'; s.to = null; s.slide = 0; s.smear = 0; }
    if (s.dyn.checkout.caret && tau > T.name[1] && tau < T.addr[0] && Math.floor((tau - T.name[1]) / .2) % 2) s.dyn.checkout.caret = 0;
    if (s.dyn.checkout.caret && tau > T.addr[1] && Math.floor((tau - T.addr[1]) / .4) % 2) s.dyn.checkout.caret = 0;
    if (q >= T.curIn) s.cursor = SC.cursorTrack(q, A.enter, [
      { t: T.toTag, to: A.tag, lift: 24 }, { t: T.toBuy, to: A.buy, lift: 30 }, { t: T.toName, to: A.name, lift: 30 },
      { t: T.toPay, to: A.pay, lift: 30 }, { t: T.rest, to: A.rest, lift: 16 },
    ], [T.clickBuy, T.clickName, T.clickPay]);
    return s;
  }
  // from scenes2/a2.js:106-132 (screenAt)
  function screenP2(tau, T) {
    const q = tw(tau), A = AT();
    if (tau < T.wake[0]) return { ...SC.END_A1, alpha: 1 - sm(T.fade[0], T.fade[1], q, x => x), light: 1 - sm(T.sleep[0], T.sleep[1], q, x => x) };
    const s = { light: sm(T.wake[0], T.wake[1], q, easeOut) * (1 + .4 * (1 - sm(T.wake[1], T.wake[1] + .3, q, easeOut))), alpha: sm(T.wake[0], T.wake[0] + .17, q, x => x),
      chrome: 1, head: 1, addr: 1, addrPage: 'orders', page: 'orders', u: lin(T.orders, tau), dyn: {} };
    s.load = loadK(T.load0, tau);
    s.dyn.orders = { press: SC.pressed(q, T.clickRefund) };
    if (tau >= T.load1[0]) { s.load = loadK(T.load1, tau); s.addrPage = 'reason'; }
    if (tau >= T.slide1[0]) { const k = SC.slideAt(tau, T.slide1[0], SLIDE); s.to = 'reason'; s.slide = k.slide; s.smear = k.smear; }
    const blink = tau < T.type[0] || tau > T.type[1] ? Math.floor((tau - T.clickReason) / .2) % 2 === 0 : true;
    s.dyn.reason = { typed: tau < T.type[0] ? 0 : Math.floor((tau - T.type[0]) * RATE.reason) + 1, caret: tau >= T.clickReason && tau < T.clickSubmit && blink,
      press: SC.pressed(q, T.clickSubmit) };
    if (tau >= T.slide1[1]) { s.page = 'reason'; s.to = null; s.slide = 0; s.smear = 0; }
    if (tau >= T.load2[0]) { s.load = loadK(T.load2, tau); s.addrPage = 'requested'; }
    if (tau >= T.slide2[0]) { const k = SC.slideAt(tau, T.slide2[0], SLIDE); s.to = 'requested'; s.slide = k.slide; s.smear = k.smear; }
    s.dyn.requested = { check: lin(T.check, tau), title: lin(T.title, tau), note: lin(T.note, tau) };
    if (tau >= T.slide2[1]) { s.page = 'requested'; s.to = null; s.slide = 0; s.smear = 0; }
    s.cursor = SC.cursorTrack(q, A.wake, [
      { t: T.toRefund, to: A.refund, lift: 30 }, { t: T.toReason, to: A.reason, lift: 20 },
      { t: T.toSubmit, to: A.submit, lift: 36 }, { t: T.rest, to: A.restLow, lift: 16 },
    ], [T.clickRefund, T.clickReason, T.clickSubmit]);
    return s;
  }
  // the mail page's timeline (stage 9): END_A2 held, the loading line, the slide, the check, the title,
  // the two lines (the page timing idiom of a1.js:55-62; machine lettering at 5200 px/s)
  function mailTimes(name) {
    const D = mailPage(), T = { load: [.3, .3 + .08 + SLIDE - .04] }, [l0, l1] = mailLens(name ?? { text: '', mode: 'font' });
    T.slide = [.38, .38 + SLIDE];
    T.check = [g(T.slide[1] + .12), g(T.slide[1] + .12) + .3];
    T.title = [T.check[1] + .08, T.check[1] + .08 + D.title.plan.total / 5200];
    T.lines = [T.title[1] + .08, T.title[1] + .08 + l0 + .06 + l1];
    T.split = (l0 + .06) / (l0 + .06 + l1);   // line 0's share of the lines' time
    T.done = T.lines[1] + 1 / 24;
    return T;
  }
  function screenMail(tau, T) {
    const s = { ...SC.END_A2, dyn: { ...SC.END_A2.dyn, mail: { check: lin(T.check, tau), title: lin(T.title, tau), lines: 0 } } };
    if (tau >= T.load[0]) { s.load = loadK(T.load, tau); s.addrPage = 'mail'; }
    if (tau >= T.slide[0]) { const k = SC.slideAt(tau, T.slide[0], SLIDE); s.to = 'mail'; s.slide = k.slide; s.smear = k.smear; }
    if (tau >= T.slide[1]) { s.page = 'mail'; s.to = null; s.slide = 0; s.smear = 0; }
    s.cursor = SC.cursorTrack(tw(tau), SC.AT.restLow, [{ t: T.slide, to: MAIL.rest, lift: 16 }]);   // it drifts clear of the new page's lines
    const f = lin(T.lines, tau); s.dyn.mail.lines = f <= 0 ? 0 : f < T.split ? f / T.split : 1 + (f - T.split) / (1 - T.split);
    return s;
  }

  // ---------- the shop beats (story.js wraps these; see SHOP.seq) ----------
  const HOME = () => SC.HOME;
  const filmS = (key, tau) => ({ film: { act: key, tau } });
  /**
   * Reduced motion (GAME_SPEC §2 "Reduced motion"): instant page changes, the new page at once. Exported
   * as SHOP.calm so story.js can apply it to its own shop beats. Pure: returns a new screen, or s itself
   * when nothing changes (not reduced, no slide in progress, or s null).
   * @param {{settings?: {reduced?: boolean}}|null} G  game state
   * @param {{page: string, to?: string|null, slide?: number, smear?: number}|null} s  a laptop screen (SHOP STATE .screen)
   * @returns {object|null}
   */
  const calm = (G, s) => (s && G && G.settings && G.settings.reduced && s.to && (s.slide ?? 0) > 0 ? { ...s, page: s.to, to: null, slide: 0, smear: 0 } : s);
  const liveS = (G, screen, follow, name = null) => ({ at: HOME(), screen: calm(G, screen), live: true, follow: clamp(follow, 0, 1), name });
  const nameOf = G => fitName(G, 'field');
  const n1 = G => letters(nameOf(G));
  const EPS = 1 / 48;
  // the typing sounds: one laptop key per letter (GAME_SPEC §8 "Name and reason typing")
  const keys = (t0, n, rate, from = 0) => Array.from({ length: n }, (_, i) => [t0 + i / rate, 'key', { k: from + i }]);
  const seq = {
    product: {
      scene: 'shop', hold: 'buy',
      dur: () => film1().curIn,
      R: (G, q) => filmS('a1', q),
      idle(G, hq) { const T = p1(n1(G)); return liveS(G, screenP1(Math.min(T.curIn + hq, T.clickBuy - EPS), T), sm(0, .3, hq)); },
      sfx: () => [],
    },
    checkout: {
      scene: 'shop', hold: 'pay',
      dur: G => { const T = p1(n1(G)); return T.toPay[1] - T.clickBuy; },
      R(G, q) { const T = p1(n1(G)), tau = T.clickBuy + q; return liveS(G, screenP1(tau, T), 1 - sm(T.toName[0], T.toName[1], tau), nameOf(G)); },
      idle(G, hq) { const T = p1(n1(G)); return liveS(G, screenP1(Math.min(T.toPay[1] + hq, T.clickPay - EPS), T), sm(0, .3, hq), nameOf(G)); },
      sfx(G) { const T = p1(n1(G)), o = T.clickBuy, n = n1(G);
        return [[0, 'click', { k: 0 }], [T.slide1[0] - o, 'swipe', { k: 0 }], [T.clickName - o, 'click', { k: 1 }],
          ...keys(T.name[0] - o, n, RATE.name), ...keys(T.addr[0] - o, Math.round((T.addr[1] - T.addr[0]) * RATE.name), RATE.name, n)]; },
    },
    ordered: {
      scene: 'shop',
      dur: G => { const T = p1(n1(G)); return T.DUR - T.clickPay; },
      R(G, q) { const T = p1(n1(G)), tau = T.clickPay + q; return tau >= T.settled ? { at: HOME(), screen: SC.END_A1 } : liveS(G, screenP1(tau, T), 1 - sm(T.rest[0], T.rest[1], tau), nameOf(G)); },
      sfx(G) { const T = p1(n1(G)), o = T.clickPay; return [[0, 'click', { k: 2 }], [T.slide2[0] - o, 'swipe', { k: 1 }], [T.check[0] + .1 - o, 'done']]; },
    },
    broken: {
      scene: 'shop', hold: 'refund',
      dur: () => film2().toRefund[0],
      R: (G, q) => filmS('a2', q),
      idle(G, hq) { const T = film2(); return liveS(G, screenP2(Math.min(T.toRefund[0] + hq, T.clickRefund - EPS), T), sm(0, .3, hq)); },
      sfx: () => [],
    },
    reason: {
      scene: 'shop', hold: 'submit',
      dur: () => { const T = film2(); return T.toSubmit[1] - T.clickRefund; },
      R(G, q) { const T = film2(), tau = T.clickRefund + q; return liveS(G, screenP2(tau, T), 1 - sm(T.toReason[0], T.toReason[1], tau)); },
      idle(G, hq) {
        const T = film2(), tau = T.toSubmit[1] + hq, s = screenP2(Math.min(tau, T.clickSubmit - EPS), T);
        s.dyn.reason.caret = Math.floor((tau - T.clickReason) / .2) % 2 === 0;   // the caret keeps blinking while it waits (a2.js:117)
        return liveS(G, s, sm(0, .3, hq));
      },
      sfx() { const T = film2(), o = T.clickRefund; return [[0, 'click', { k: 2 }], [T.slide1[0] - o, 'swipe', { k: 2 }], [T.clickReason - o, 'click', { k: 1 }], ...keys(T.type[0] - o, SC.D.reason.typed.n, RATE.reason)]; },
    },
    requested: {
      scene: 'shop',
      dur: () => { const T = film2(); return T.DUR - T.clickSubmit; },
      R(G, q) { const T = film2(), tau = T.clickSubmit + q; return tau >= T.settled ? { at: HOME(), screen: SC.END_A2 } : liveS(G, screenP2(tau, T), 1 - sm(T.rest[0], T.rest[1], tau)); },
      sfx() { const T = film2(), o = T.clickSubmit; return [[0, 'click', { k: 3 }], [T.slide2[0] - o, 'swipe', { k: 0 }], [T.check[0] + .1 - o, 'tick']]; },
    },
    wide: {
      scene: 'wide',
      dur: () => WINDOWS.a3[1],
      R: (G, q) => filmS('a3', Math.min(q, WINDOWS.a3[1] - EPS)),
      sfx: () => [],
    },
    mail: {
      scene: 'mail',
      dur: G => mailTimes(fitName(G, 'mail')).done,
      R(G, q) { const nm = fitName(G, 'mail'), T = mailTimes(nm); return { ...liveS(G, screenMail(q, T), sm(0, .3, q), nm), at: HOME() }; },
      sfx(G) { const T = mailTimes(fitName(G, 'mail')); return [[T.slide[0], 'swipe', { k: 1 }], [T.check[0] + .1, 'tick']]; },
    },
  };

  // ---------- drawing ----------
  const TAG = [42, 66, 352, 84];   // the price tag's box, display-local (stageC.js:171)
  const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[0] + b[2] && p[1] >= b[1] && p[1] <= b[1] + b[3];
  /** Where page `id` sits in the view now (x offset, display-local), or null when it is not on the screen. */
  function pageOffset(s, id) {
    const V = SC.VIEW.w;
    if (s.to && (s.slide ?? 0) > 0) return s.to === id ? V - V * s.slide : s.page === id && s.slide < 1 ? -V * s.slide : null;
    return s.page === id && (s.u ?? 1) >= 1 ? 0 : null;
  }
  /** What SC.page cannot draw: the fallback name in the Name field (NAME.drawTyped), the mail page's lines. */
  function overlay(c, s, at, name) {
    const oc = name && name.mode !== 'font' ? pageOffset(s, 'checkout') : null, om = pageOffset(s, 'mail');
    if (oc === null && om === null) return;
    const D = SC.DSP, V = SC.VIEW, A = s.alpha ?? 1;
    c.save(); SC.frame(c, at); c.beginPath(); c.rect(D.x + 3, D.y + 3, D.w - 6, D.h - 6); c.clip(); c.beginPath(); c.rect(V.x, V.y, V.w, V.h); c.clip();
    const both = dx => {
      if (oc !== null) { c.save(); c.translate(oc + dx, 0); NAME.drawTyped(c, ((s.dyn ?? {}).checkout ?? {}).name ?? 0, A); c.restore(); }
      if (om !== null) { c.save(); c.translate(om + dx, 0); drawMailLines(c, name, ((s.dyn ?? {}).mail ?? {}).lines ?? 2, A); c.restore(); }
    };
    // during a slide the page's ghosts trail to the right (stageC.js:437-438); these marks trail with it
    if (s.to && (s.slide ?? 0) > 0 && (s.smear ?? 0) > 0) smear(c, 2, -s.smear, both); else both(0);
    c.restore();
  }

  /**
   * Draw the shop for S: a film window, or the live laptop (SC.body + SC.screen at S.at, with the cursor
   * at S.pointer blended by S.follow, or the film's cursor in S.screen.cursor).
   * S.name {text, mode}: the name fitted for where it is drawn (the checkout field or the mail page).
   * @param {CanvasRenderingContext2D} c @param {object} S  story.js SCHEMAS "SHOP STATE"
   * @param {{caption?: (c) => void}=} o  see film()
   * @returns {boolean} true when the vignette (and, for a film window, the caption) is already drawn
   */
  function frame(c, S, o = {}) {
    if (S.film) return film(c, S.film.act, S.film.tau, o);
    const at = S.at ?? SC.HOME; let scr = S.screen ?? SC.END_A1;
    const shows = id => scr.page === id || scr.to === id;
    if (shows('mail')) mailPage();
    // the checkout's name: S.name, else what NAME.install put into the field (story.js's shop beats build their
    // screens without S.name; in fallback mode the letters are drawn here, by NAME.drawTyped in overlay())
    const name = S.name ?? (shows('checkout') ? NAME.checkout : null) ?? null;
    if (name && shows('checkout')) field(name);
    if (S.pointer && S.live) {
      const k = S.follow ?? 1, b = scr.cursor ?? { x: S.pointer[0], y: S.pointer[1], a: 1 };
      const cur = { ...b, x: lerp(b.x, S.pointer[0], k), y: lerp(b.y, S.pointer[1], k), a: 1 };
      scr = { ...scr, cursor: cur };
      if (scr.page === 'product' && !scr.to && k > .5) { const over = inBox([cur.x, cur.y], TAG) ? 1 : 0; scr.dyn = { ...scr.dyn, product: { ...(scr.dyn ?? {}).product, hover: over, hoverA: over } }; }
    }
    if (scr.page === 'mail' && !scr.to) scr = mailWriteOn(scr, name);
    cam(c, CX, CY, 1); paperSheet(c);
    SC.body(c, { at });
    const lay = shows('mail') || (name && name.mode !== 'font' && shows('checkout'));
    if (!lay) { SC.screen(c, scr, { at }); return false; }
    // the page, then what SC.page cannot draw, then the cursor on top (stageC.js:441 draws it last)
    SC.screen(c, { ...scr, cursor: null }, { at });
    overlay(c, scr, at, name);
    if (scr.cursor && (scr.alpha ?? 1) > 0) { const D = SC.DSP; c.save(); SC.frame(c, at); c.beginPath(); c.rect(D.x + 3, D.y + 3, D.w - 6, D.h - 6); c.clip(); c.globalAlpha *= scr.alpha ?? 1; SC.cursor(c, scr.cursor); c.restore(); }
    return false;
  }

  /**
   * Map a screen point (logical 1920x1080) to display-local coordinates of the laptop at `at`, or
   * null when it is outside the display (the film's cursor only lives on the screen).
   * @param {[number, number]} p @param {{x, y, s}=} at  default SC.HOME
   * @returns {[number, number]|null}
   */
  function pointer(p, at = SC.HOME) {
    if (!p) return null;
    const x = (p[0] - at.x) / at.s, y = (p[1] - at.y) / at.s, D = SC.DSP;
    return x >= D.x && x <= D.x + D.w && y >= D.y && y <= D.y + D.h ? [x, y] : null;
  }
  /** Which page each drawn button is on, and its box (display-local, SC.D.<page>.<button>.box). */
  const BUTTONS = { buy: ['product', 'buy'], pay: ['checkout', 'pay'], refund: ['orders', 'refund'], submit: ['reason', 'submit'] };
  /**
   * Clickable drawn buttons for ui.js (GAME_SPEC §2): WORLD boxes [x, y, w, h] (== screen in the shop,
   * logical 1920x1080), SC.toWorld(at, box) of the button's own box (Buy [52, 162, 290, 110], Pay
   * [-110, 144, 560, 104], Request refund [-110, 154, 562, 96], Submit [-360, 96, 340, 76]). A box is
   * given only while its page stands on the screen (not during a film window or a slide).
   * @param {object} S @param {{buy, pay, refund, submit}} on  which acts are live now
   * @returns {{act: string, world: number[]}[]}
   */
  function hotspots(S, on = {}) {
    const out = []; if (!S || S.film || !S.screen) return out;
    const at = S.at ?? SC.HOME, s = S.screen, D = SC.build();
    for (const [k, [page, b]] of Object.entries(BUTTONS)) {
      if (!on[k] || s.page !== page || (s.to && (s.slide ?? 0) > 0)) continue;
      const box = D[page][b].box, p = SC.toWorld(at, [box[0], box[1]]);
      out.push({ act: k, world: [p[0], p[1], box[2] * at.s, box[3] * at.s] });
    }
    return out;
  }
  /** The timelines (tests and the story builder: caption times such as the P2 crack, A2.capT0). */
  const times = G => ({ a1: film1(), p1: p1(n1(G)), a2: film2(), cut: WINDOWS.a3[1], mail: mailTimes(fitName(G, 'mail')) });
  return { WINDOWS, RATE, init, act, film, filmCaption, frame, pointer, hotspots, seq, times, field, fitName, calm };
})();
