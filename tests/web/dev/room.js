'use strict';
// Dev harness for room.html (see the comment there). Not published; no CSP here.
(() => {
  const q = new URLSearchParams(location.search), info = document.getElementById('info');
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d', BOOT.raster === 'cpu' ? { alpha: false, willReadFrequently: true } : { alpha: false });
  const w = clamp(+(q.get('w') || 1920) || 1920, 320, 3840);
  setFormat({ ar: '16:9', width: w }); cv.width = OUT_W; cv.height = OUT_H;
  SHOP.init();
  const caps = new Map();
  /** Draw one scene from a state, the runtime's draw() sequence without the runtime. */
  function draw(scene = 'room', state = {}, captionId = null) {
    ctx.save();
    try {
      resetFrame(ctx); let vig = false;
      if (scene === 'start') vig = CARDS.start(ctx, state);
      else if (scene === 'end') vig = CARDS.end(ctx, state);
      else if (scene === 'room') vig = state.notes ? ROOM.notes(ctx, state) : ROOM.frame(ctx, state);
      else if (scene === 'notes') vig = ROOM.notes(ctx, { ...state, notes: state.notes ?? {} });
      else vig = SHOP.frame(ctx, state);
      resetT(ctx);
      if (captionId && CONTENT.drawn.captions[captionId]) {
        const sp = CONTENT.drawn.captions[captionId];
        if (!caps.has(captionId)) caps.set(captionId, makeCaption('dev/' + captionId, { lines: sp.lines, t0: 0, hold: 60, colors: sp.colors }));
        caps.get(captionId).draw(ctx, 30);
      }
      if (!vig) vignette(ctx);
    } finally { ctx.restore(); }
  }
  window.__dev = { ready: false, draw, canvas: cv, ctx };
  let state = {};
  try { state = q.has('state') ? JSON.parse(q.get('state')) : {}; } catch (e) { info.textContent = 'bad state json: ' + e.message; }
  const scene = q.get('scene') || 'room';
  try { draw(scene, state, q.get('caption')); info.textContent = `${scene} ${OUT_W}x${OUT_H} raster=${BOOT.raster}`; }
  catch (e) { window.__devError = String(e && e.stack || e); console.error(e); }
  window.__dev.ready = true;
})();
