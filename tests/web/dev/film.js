'use strict';
// Dev harness for film.html (see the comment there). Not published; no CSP here.
(async () => {
  const q = new URLSearchParams(location.search), info = document.getElementById('info');
  const cv = document.getElementById('cv');
  const opts = BOOT.raster === 'cpu' ? { willReadFrequently: true } : {};
  if (q.get('alpha') === '0') opts.alpha = false;
  const ctx = cv.getContext('2d', opts);
  const w = clamp(+(q.get('w') || 1920) || 1920, 320, 3840);
  setFormat({ ar: '16:9', width: w }); cv.width = OUT_W; cv.height = OUT_H;

  // more acts from the film repo (read-only), loaded in order after a3
  for (const k of (q.get('more') || '').split(',').filter(x => /^a([4-9]|1[0-2])$/.test(x))) {
    await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = `/film-src/scenes2/${k}.js`; s.onload = ok; s.onerror = () => bad(new Error('load ' + k)); document.head.append(s); });
  }
  const act = k => SCENES.find(s => s.key === k);
  // the film's frame -> (act, tau), exactly as core.js locate() did (acc sums act durations in order)
  function tauOf(i) { const t = i / 24; let acc = 0; for (const s of SCENES) { if (t < acc + s.dur - 1e-9) return { act: s.key, tau: t - acc }; acc += s.dur; } return null; }
  // one frame, the film's drawFrame sequence (core.js:559) through the game's resetFrame.
  // ?via=shop: the game's film-window path instead: SHOP.init() blanks the act's captions and SHOP.film()
  // routes a caption through the act's first caption slot; the caption drawn there is the act's own
  // (SHOP.filmCaption), so the frame must still equal the film's exactly.
  const viaShop = q.get('via') === 'shop';
  if (viaShop) SHOP.init();
  function draw(key, tau) {
    const s = act(key); if (!s) throw new Error('no act ' + key);
    ctx.save(); try { resetFrame(ctx); if (viaShop) SHOP.film(ctx, key, tau, { caption: c => SHOP.filmCaption(c, key, tau) }); else s.fn(ctx, tau); } finally { ctx.restore(); }
  }
  const times = [];
  function perf() { const a = times.slice().sort((x, y) => x - y), p = f => a[Math.min(a.length - 1, Math.floor(f * a.length))] ?? 0;
    return { n: a.length, mean: a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), p50: p(.5), p95: p(.95), max: a.at(-1) ?? 0 }; }
  window.__dev = { ready: false, draw, tauOf, perf, canvas: cv, ctx, times, act };

  if (q.has('loop')) {
    const [k, a, b] = q.get('loop').split(':'), t0 = +a, t1 = +b; let start = null, last = -1;
    const tick = now => {
      if (start === null) start = now;
      const tau = t0 + (((now - start) / 1000) % (t1 - t0)), f = Math.floor(tau * 24);
      if (f !== last) { last = f; const s = performance.now(); draw(k, f / 24); times.push(performance.now() - s); }
      window.__dev.frames = (window.__dev.frames || 0) + 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } else {
    let key = q.get('act') || 'a3', tau = +(q.get('tau') || 0);
    if (q.has('frame')) { const L = tauOf(+q.get('frame')); key = L.act; tau = L.tau; }
    draw(key, tau); info.textContent = `${key} tau=${tau} ${OUT_W}x${OUT_H} S=${S.toFixed(3)} raster=${BOOT.raster}`;
  }
  window.__dev.ready = true;
})().catch(e => { window.__devError = String(e && e.stack || e); console.error(e); });
