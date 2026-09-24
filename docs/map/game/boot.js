'use strict';
// ============================================================
// game/boot.js: runs after the engine and before the film acts (index.html load order, GAME_SPEC §2).
//
// 1. window.SCENES = [] so film/a1-a3.js can push their acts (each act is an IIFE that calls
//    SCENES.push({key, name, dur, fn, captions, stage, cues}); a3 also defines window.V2G2ROOM).
// 2. The film's palette, set once (the film called usePalette(FILM.palette) every frame in
//    drawFrame, core.js:559; v2 drawings read COL, not PAL, but the call keeps PAL identical).
// 3. window.BOOT: the validated flags every later file reads. The query string is read HERE ONLY,
//    and only these exact values are accepted; anything else is ignored. No value from the URL ever
//    sizes a canvas or reaches the drawing code.
//      ?test=1      BOOT.test = true: no rAF loop; window.__game drives time (runtime.js); backing
//                   width fixed at 1920.
//      ?raster=cpu  BOOT.raster = 'cpu': the main canvas is created with {willReadFrequently: true}
//                   so tests can read exact pixels (software raster, like the film). Default 'gpu'.
//    BOOT.reduced   prefers-reduced-motion at load (runtime.js also listens for changes and keeps
//                   the live value in G.settings.reduced).
//    BOOT.V         the cache-busting version of this build (must equal the ?v= in index.html).
// ============================================================
window.SCENES = [];
usePalette(makePalette({ paper: COL.paper, ink: COL.graphite }, 'pencilMinimal'));   // from film.js:29
window.BOOT = (() => {
  let q = null; try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  const get = k => (q && q.has(k) ? q.get(k) : null);
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return Object.freeze({
    V: 1,
    test: get('test') === '1',
    raster: get('raster') === 'cpu' ? 'cpu' : 'gpu',
    reduced: !!(mq && mq.matches),
  });
})();
