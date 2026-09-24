'use strict';
// ============================================================
// game/cards.js: the start card and the end card (a12's layout, copied and adapted; GAME_SPEC §4
// "Start card" and "End card"). STUB with contracts (foundation): a still start card in a12's layout
// (title lines, Temporal + Claude logos, the agent at .5); the cards builder copies a12's draw-on,
// kernedStrokes (a12.js:66-75), the cheer (a12.js:113-122), the blink and the end card.
//
// Rules: no full-frame layer allocated per frame (a12's figure() pass must draw into one cached
// layer or be replaced); every text drawn from CONTENT.drawn.start / .end; the name only through
// NAME.drawText / NAME.fit (font or fallback). Screen coordinates (cam(c, CX, CY, 1)).
// Called by runtime.js draw() for scenes 'start' and 'end'.
// ============================================================
window.CARDS = (() => {
  /** a12 layout (a12.js): title y 312 cap 72, subtitle y 432, logos 84 px at y 650 (temporal x 627,
   *  claude x 775; no Python), the agent at scale .5 at (1170, 700). */
  const L = { title: { y: 312, cap: 72 }, sub: { y: 432, cap: 46 }, logos: { y: 650, size: 84, temporal: 627, claude: 775 }, agent: { x: 1170, y: 700, s: .5 } };

  /**
   * The start card (scene 'start'): title, subtitle, logos, the agent (cheer once, then a blink every 3 s).
   * @param {CanvasRenderingContext2D} c @param {object} C  story.js SCHEMAS "CARD STATE"
   * @returns {boolean} false (the caller draws the vignette)
   */
  function start(c, C = {}) {
    const T = CONTENT.drawn.start;
    cam(c, CX, CY, 1); paperSheet(c);
    pencilMarks(c, textCel('game/card/title', [{ text: T.title, x: CX, y: L.title.y, cap: L.title.cap, align: 'center' }], { width: 4.2, seed: 3 }));
    pencilMarks(c, textCel('game/card/sub', [{ text: T.sub, x: CX, y: L.sub.y, cap: L.sub.cap, align: 'center' }], { width: 3.2, seed: 5 }));
    drawLogo(c, 'temporal', L.logos.temporal, L.logos.y, L.logos.size, 1, { color: 'indigo' });
    drawLogo(c, 'claude', L.logos.claude, L.logos.y, L.logos.size, 1);
    AGENT.draw(c, L.agent.x, L.agent.y, L.agent.s, 'rest', { face: C.blink ? 'closed' : 'happy' });
    c.save(); c.translate(L.agent.x, L.agent.y); c.scale(L.agent.s, L.agent.s); pencilMarks(c, compile(deskDrawing(), 'game/card/desk')); c.restore();
    return false;
  }
  /**
   * The end card (scene 'end'): title, "You pulled the plug N times." (N >= 1; plugs1 for N = 1) and
   * "The refund happened once." with "once" in green (or "No money moved." on the reject branch),
   * logos, the agent cheering then still, and "Thanks, <name>" only if it fits (NAME.fit, BUDGET.line).
   * STUB: draws the start card.
   * @param {CanvasRenderingContext2D} c @param {object} C  story.js SCHEMAS "CARD STATE"
   * @returns {boolean} false
   */
  function end(c, C = {}) { return start(c, C); }
  return { L, start, end };
})();
