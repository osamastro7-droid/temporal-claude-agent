'use strict';
// ============================================================
// game/shop.js: the shop and the player's laptop (GAME_SPEC §4 P1, P2, the stage 1 wide shot,
// stage 9's refund email page). STUB with contracts (foundation): frame/film/pointer work; the shop
// builder adds the live pages (product hover, checkout typing via NAME.typedName, orders, reason,
// requested), the 'mail' page and the exact hotspot boxes.
//
// Draws from a shop state S (story.js SCHEMAS "SHOP STATE"). Coordinates: the shop camera is
// cam(c, CX, CY, 1), so shop world == screen (logical 1920x1080); the laptop's display is
// display-local (x -480..480, y -300..300), world = SC.toWorld(at, p) (stageC.js:317).
// Called by runtime.js (init, frame, pointer) and ui.js (hotspots).
// ============================================================
window.SHOP = (() => {
  /** Film windows replayed frame for frame (GAME_SPEC §2 "Reusing film windows"), act-local tau.
   *  a1 ends at its T.curIn (a1.js:49, the product page is complete, before the cursor enters). */
  const WINDOWS = { a1: [0, 4.0], a2: [0, 6.2], a3: [0, 4.72] };   // STUB values: the shop builder pins them
  /** Typing rates (letters per second): the name at checkout, the refund reason. */
  const RATE = { name: 14, reason: 18 };
  let blanked = false, capHook = null;
  const orig = new Map();   // act key -> the act's own caption objects' draw functions (dev checks)

  /**
   * Once, before the first shop frame: SC.build() and blank the captions of film acts a1-a3
   * (GAME_SPEC §2), so replayed windows show no film text. The act's FIRST caption slot becomes a hook:
   * film() routes the game's caption through it, so a film window draws the game caption where the
   * film drew its own (after resetT, BEFORE the act's vignette; a1.js:115-116, a2.js:162-163,
   * a3.js:512-513). Idempotent. Called by runtime.js at start.
   */
  function init() {
    SC.build();
    if (blanked) return; blanked = true;
    for (const s of SCENES) if (['a1', 'a2', 'a3'].includes(s.key)) (s.captions ?? []).forEach((k, i) => {
      if (!orig.has(s.key)) orig.set(s.key, []); orig.get(s.key).push(k.draw);
      k.draw = i === 0 ? c => { const h = capHook; capHook = null; if (h) h(c); } : () => {};
    });
  }
  /** The act object pushed by film/<act>.js. @param {'a1'|'a2'|'a3'} key */
  const act = key => SCENES.find(s => s.key === key) ?? null;
  /**
   * Draw a film act at act-local tau exactly as the film does: its own camera, paper, props and its own
   * vignette (every act fn ends with vignette(c)). The caller did resetFrame before and must NOT draw a
   * second vignette nor the caption again (frame() returns true; the caption went through o.caption).
   * @param {CanvasRenderingContext2D} c @param {'a1'|'a2'|'a3'} key @param {number} tau seconds
   * @param {{caption?: (c) => void}=} o  draws the game's caption (runtime's drawCaption) in the act's
   *   caption slot; if the act has no caption object it is drawn after the act (film order lost: none of
   *   a1-a3 is such an act)
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

  /**
   * Draw the shop for S: a film window, or the live laptop (SC.body + SC.screen at S.at, with the
   * cursor at S.pointer or S.screen.cursor). Sets the shop camera and the paper itself.
   * The 'mail' page (stage 9) letters CONTENT.drawn.mail.lines with S.name (already fitted to
   * NAME.BUDGET.mail by the beat) via NAME.drawText.
   * @param {CanvasRenderingContext2D} c @param {object} S  story.js SCHEMAS "SHOP STATE"
   * @param {{caption?: (c) => void}=} o  see film()
   * @returns {boolean} true when the vignette (and, for a film window, the caption) is already drawn
   */
  function frame(c, S, o = {}) {
    if (S.film) return film(c, S.film.act, S.film.tau, o);
    const at = S.at ?? SC.HOME, screen = { ...(S.screen ?? SC.END_A1) };
    if (S.pointer) screen.cursor = { x: S.pointer[0], y: S.pointer[1], a: 1, press: screen.cursor?.press ?? 0, click: screen.cursor?.click ?? 0 };
    cam(c, CX, CY, 1); paperSheet(c);
    SC.body(c, { at }); SC.screen(c, screen, { at });   // STUB: no 'mail' page yet
    return false;
  }

  /**
   * Map a screen point (logical 1920x1080) to display-local coordinates of the laptop at `at`, or
   * null when it is outside the display (the film's cursor only lives on the screen).
   * @param {[number, number]} p @param {{x, y, s}=} at  default SC.HOME
   * @returns {[number, number]|null}
   */
  function pointer(p, at = SC.HOME) {
    const x = (p[0] - at.x) / at.s, y = (p[1] - at.y) / at.s, D = SC.DSP;
    return x >= D.x && x <= D.x + D.w && y >= D.y && y <= D.y + D.h ? [x, y] : null;
  }
  /**
   * Clickable drawn buttons for ui.js (GAME_SPEC §2): WORLD boxes [x, y, w, h] (== screen in the shop),
   * made with SC.toWorld(at, ...) from the page's button box (SC.D.product.buy.box = [52, 162, 290, 110],
   * pay [-110, 144, 560, 104], refund [-110, 154, 562, 96], submit [-360, 96, 340, 76]).
   * @param {object} S @param {{buy, pay, refund, submit}} on  which acts are live now
   * @returns {{act: string, world: number[]}[]}
   */
  function hotspots(S, on = {}) {
    const at = S.at ?? SC.HOME, out = [], B = { buy: [52, 162, 290, 110], pay: [-110, 144, 560, 104], refund: [-110, 154, 562, 96], submit: [-360, 96, 340, 76] };
    for (const k of Object.keys(B)) if (on[k]) { const b = B[k], p = SC.toWorld(at, [b[0], b[1]]); out.push({ act: k, world: [p[0], p[1], b[2] * at.s, b[3] * at.s] }); }
    return out;
  }
  return { WINDOWS, RATE, init, act, film, filmCaption, frame, pointer, hotspots };
})();
