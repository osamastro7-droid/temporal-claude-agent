'use strict';
// ============================================================
// game/cards.js: the start card and the end card (GAME_SPEC §4 "Start card" and "End card"), copied and
// adapted from the film's title card, scenes2/a12.js.
//
// Both cards are a12's sequence on a fresh sheet: the pencil slides in and writes the title, then the
// line(s) under it; the marks draw themselves (Temporal in indigo, Claude's spark; no Python); the pencil
// draws the agent small at his desk (scale .5) and gives him his badge; his screen switches on (a blink);
// on the end card the pencil then writes "Thanks, <name>" in a12's signature slot while he looks down at
// it; the pencil leaves, he cheers once (a12.js:113-122) and the card holds still. The start card then
// blinks every 3 s (GAME_SPEC §4); the end card stays completely still.
// The marks and the agent are centred as one row by a12's own rule (a12.js:52-55) with two marks.
//
// Rules: no full-frame layer is allocated per frame. a12's figure() (a12.js:137-158) gave his small
// lines a second pass through a full-frame layer every frame; here both passes are rendered ONCE per
// distinct drawing into a small canvas around him (a pool of FIG_POOL canvases, reused) and laid on the
// sheet with one drawImage; the still hold alternates between two cached drawings (eyes open / closed).
// Every text comes from CONTENT.drawn.start / .end; the name only through NAME.fit / NAME.drawText.
// Screen coordinates (cam(c, CX, CY, 1)). Called by runtime.js draw() for scenes 'start' and 'end'.
// ============================================================
window.CARDS = (() => {
  const G = n => n / 12;
  const n12 = t => Math.ceil(t * 12 - 1e-6);                                   // seconds -> drawings (up), a12.js:94
  // from a12.js:42-55: the title card's lettering and the row of marks + the agent at his desk
  const AS = .5, DESK_W = 620, DESK_H = 120, LOGO_SIZE = 84, LOGO_STEP = 148, GAP = 40;
  const deskHalf = (DESK_W / 2 + 20) * AS;
  const MARKS = [{ id: 'temporal', color: 'indigo' }, { id: 'claude', color: 'graphite' }];   // no Python (GAME_SPEC §0 "Logos")
  const L0 = CX - (LOGO_STEP * (MARKS.length - 1) + LOGO_SIZE + GAP + deskHalf * 2) / 2 + LOGO_SIZE / 2;
  const AGX = L0 + LOGO_STEP * (MARKS.length - 1) + LOGO_SIZE / 2 + GAP + deskHalf;
  /** Layouts (world y): a12's (one line under the title) and the end card's two-line variant. */
  const LAYOUT = {
    one: { title: 312, lines: [432], logos: 650, agent: 700, thanks: 872 },          // a12.js:43-45, :52, :55
    two: { title: 276, lines: [400, 488], logos: 710, agent: 760, thanks: 920 },     // one more line: the lines open up, the row moves 60 down
  };
  const TITLE = { cap: 72, condense: 1, width: 5.4, seed: 71 }, LINE = { cap: 46, condense: .88, width: 3.3, seed: 83 }, THANKS = { cap: 46, condense: .92, width: 3.3, seed: 97 };
  /** @deprecated shape kept for callers of the stub: the start card's layout. */
  const L = { title: { y: 312, cap: 72 }, sub: { y: 432, cap: 46 }, logos: { y: 650, size: LOGO_SIZE, temporal: L0, claude: L0 + LOGO_STEP }, agent: { x: AGX, y: 700, s: AS } };

  // from a12.js:63-75, with word colours kept across the runs (a run starts after each r, and textStrokes
  // counts words per call: a run's local word k is the line's word k + the spaces before the run)
  const KERN_AFTER = { r: 78 };
  function kernedStrokes(str, x, y, o) {
    const cd = o.condense ?? 1, k = o.cap / FONT_EMS_TECH.cap * cd, runs = [];
    let cur = ''; for (const ch of str) { cur += ch; if (KERN_AFTER[ch]) { runs.push([cur, KERN_AFTER[ch] * k]); cur = ''; } }
    if (cur) runs.push([cur, 0]);
    const widths = runs.map(([s]) => measure(s, o.cap, 0, cd));
    const total = widths.reduce((a, b) => a + b, 0) - runs.slice(0, -1).reduce((a, [, kk]) => a + kk, 0);
    let px = o.align === 'center' ? x - total / 2 : x, words = 0; const strokes = [];
    runs.forEach(([s, kk], n) => {
      let colors; if (o.colors) { colors = {}; for (const [w, col] of Object.entries(o.colors)) if (+w - words >= 0) colors[+w - words] = col; }
      strokes.push(...textStrokes(s, px, y, { ...o, colors, align: 'left', id: `${o.id}/r${n}`, seed: o.seed + n * 13 }).strokes); px += widths[n] - kk;
      words += (s.match(/ /g) ?? []).length;
    });
    return { strokes, total };
  }
  /** A kerned line as one cel: sid = the strokes' id base (their seeds come from it), cid = the compile (cache) id. */
  const lettered = (cid, sid, text, y, st, o = {}) => compile({ strokes: kernedStrokes(text, o.x ?? CX, y, { cap: st.cap, condense: st.condense, width: st.width, align: o.align ?? 'center', id: sid, seed: o.seed ?? st.seed, colors: o.colors }).strokes }, cid);

  // the agent's stroke length (a12.js:87-93: his rest drawing, compiled by AGENT.draw under 'agent/rest')
  let AGENT_LEN = 0;
  function agentLength() {
    if (AGENT_LEN) return AGENT_LEN;
    AGENT.draw(scratchCtx(), 0, 0, 1, 'rest', { progress: .5 });
    const cel = _compiled.get('agent/rest'), arm = s => /^(arm|hand|thumb|cuff|elbow)\//.test(s.id);
    return (AGENT_LEN = makePlan({ strokes: cel.strokes.filter(s => !arm(s)) }).total + makePlan({ strokes: cel.strokes.filter(arm) }).total);
  }
  const DESK = () => compile(deskDrawing(DESK_W, DESK_H), 'a12/desk');

  // ---------- one card: its drawings, its timetable and its pencil (a12.js:76-187) ----------
  // spec = { key, title, lines: [{text, colors}], thanks: null | {pre, name: {text, mode}, post} }
  const cards = new Map();
  function card(spec) {
    if (cards.has(spec.key)) return cards.get(spec.key);
    const Y = spec.lines.length > 1 ? LAYOUT.two : LAYOUT.one, AG = { x: AGX, y: Y.agent };
    // the title and the first line use a12's stroke ids (a12/title, a12/sub) and seeds: with a12's texts and
    // places they are the film's card's own marks
    const D = { title: lettered(`game/card/title/${spec.title}@${Y.title}`, 'a12/title', spec.title, Y.title, TITLE),
      lines: spec.lines.map((l, i) => lettered(`game/card/l${i}/${l.text}@${Y.lines[i]}`, i ? 'game/card/l' + i : 'a12/sub', l.text, Y.lines[i], LINE, { seed: LINE.seed + i * 6, colors: l.colors })),
      desk: DESK() };
    // "Thanks, <name>": pencil lettering, or the pencil's "Thanks, " + NAME's fallback drawing of the name
    let TH = null;
    if (spec.thanks) {
      const t = spec.thanks, font = t.name.mode === 'font';
      if (font) TH = { cel: lettered(`game/card/thanks/${t.pre}${t.name.text}${t.post}@${Y.thanks}`, 'game/card/thanks', t.pre + t.name.text + t.post, Y.thanks, THANKS) };
      else {
        const wp = measure(t.pre, THANKS.cap, 0, THANKS.condense), wn = NAME.measureName(t.name.text, 'fallback', THANKS.cap, THANKS.condense), wq = measure(t.post, THANKS.cap, 0, THANKS.condense), x0 = CX - (wp + wn + wq) / 2;
        TH = { pre: lettered(`game/card/thanks-pre/${t.pre}@${x0.toFixed(1)},${Y.thanks}`, 'game/card/thanks-pre', t.pre, Y.thanks, THANKS, { x: x0, align: 'left' }),
          post: t.post ? lettered(`game/card/thanks-post/${t.post}@${(x0 + wp + wn).toFixed(1)},${Y.thanks}`, 'game/card/thanks-post', t.post, Y.thanks, THANKS, { x: x0 + wp + wn, align: 'left', seed: THANKS.seed + 7 }) : null,
          name: t.name, x: x0 + wp, y: Y.thanks, wn };
      }
    }
    // ---- the timetable (a12.js:86-128), on the 1/12 s grid ----
    const S0 = CONTENT.drawn.start.sub, speed = lettered(`game/card/l0/${S0}@${LAYOUT.one.lines[0]}`, 'a12/sub', S0, LAYOUT.one.lines[0], LINE).plan.total / G(12);   // the lettering speed of a12's sub line: 12 drawings (a12.js:44)
    const T = { title: [G(4), G(19)] };                                                                  // a12.js:43
    let e = 19; T.lines = D.lines.map(cel => { const d = Math.max(6, n12(cel.plan.total / speed)); const t = [G(e + 2), G(e + 2 + d)]; e += 2 + d; return t; });
    T.marks = MARKS.map((m, i) => [G(e + i * 2), G(e + i * 2 + 4)]);                                    // a12.js:58-60, straight after the line
    T.agent = [G(e + 2), G(e + 2 + n12(agentLength() * AS / DRAW_SPEED))];                             // a12.js:96
    const a1 = Math.round(T.agent[1] * 12);
    T.desk = [G(a1 + 1), G(a1 + 1 + n12(drawTime(D.desk) * AS))];
    const d1 = Math.round(T.desk[1] * 12);
    T.badge = [G(d1 + 1), G(d1 + 4)];
    T.faceOn = T.badge[1] + G(1);                                                                        // closed for 2 frames, then open
    const b1 = Math.round(T.badge[1] * 12);
    let s1 = b1 + 2;                                                                                     // no signature: the pencil lifts off after the badge
    if (TH) { const len = TH.cel ? TH.cel.plan.total : TH.pre.plan.total + (TH.post ? TH.post.plan.total : 0) + TH.wn * 3; T.thanks = [G(b1 + 2), G(b1 + 2 + Math.max(6, n12(len / speed)))]; s1 = Math.round(T.thanks[1] * 12); }
    T.park = G(s1 + 4); T.lookUp = G(s1 + 1);
    const c0 = s1 + 4, CROUCH = t => ({ from: 'rest', to: 'typeA', t });
    // a12.js:113-122: into the crouch, held, up, the cheer held 10 frames, down, rest
    T.cheer = [
      [c0, CROUCH(.25), 'open', .94], [c0 + 1, CROUCH(.5), 'closed', .875],
      [c0 + 3, { from: 'rest', to: 'cheer', t: .42 }, 'happy', 1.035], [c0 + 4, { from: 'rest', to: 'cheer', t: .83 }, 'happy', 1.015],
      [c0 + 5, 'cheer', 'happy', 1],
      [c0 + 10, { from: 'cheer', to: 'rest', t: .33 }, 'happy', 1], [c0 + 11, { from: 'cheer', to: 'rest', t: .75 }, 'happy', 1],
      [c0 + 12, 'rest', 'happy', 1],
    ].map(([n, pose, face, sy]) => ({ t: G(n), pose, face, sy }));
    T.cheerUp = T.cheer.find(k => k.pose === 'cheer').t;
    T.still = Math.max(T.cheer.at(-1).t, T.park + G(1));

    // ---- the pencil's jobs (a12.js:169-187) ----
    const BADGE = [AG.x, AG.y - 164 * AS];
    const textJob = (id, t, cel, o = {}) => ({ id, t, pencil: true, ones: true, color: 'graphite', ...o, render: (c, u) => pencilMarks(c, cel, { progress: u }) });
    const jobs = [textJob('title', T.title, D.title, { enter: T.title[0] }), ...D.lines.map((cel, i) => textJob('l' + i, T.lines[i], cel)),
      { id: 'agent', t: T.agent, pencil: true, ones: true, color: 'graphite', x: AG.x, y: AG.y, render: (c, u) => agent(c, AG, 'rest', { progress: u, face: 'off', badge: 0 }).tip },
      { id: 'desk', t: T.desk, pencil: true, ones: true, color: 'graphite', x: AG.x, y: AG.y, render(c, u) { const tip = desk(c, AG, D.desk, u); return tip ? [AG.x + tip[0] * AS, AG.y + tip[1] * AS] : null; } },
      { id: 'badge', t: T.badge, pencil: true, color: 'graphite', x: BADGE[0], y: BADGE[1],
        render(c, u) { const t = drawLogo(scratchCtx(), 'claude', 0, 0, 36, u); if (t) return [BADGE[0] + t[0] * AS, BADGE[1] + t[1] * AS];
          const f = clamp((u - .6) / .4, 0, 1); return [BADGE[0] + lerp(-12, 12, f) * AS, BADGE[1] + Math.sin(f * Math.PI * 5) * 8 * AS]; } }];
    if (TH) jobs.push({ id: 'thanks', t: T.thanks, pencil: true, ones: true, color: 'graphite', render: (c, u) => thanks(c, TH, u) });
    const EXIT = [W + 140, 900], HOME = [W + 320, H * .6];
    const wp = (id, t, color, at) => ({ id, t: [t, t], pencil: true, color, render: () => at });
    const stage = makeStage([...jobs, wp('park', T.park, 'graphite', EXIT)]);
    const out = { spec, D, T, TH, AG, Y, stage, HOME };
    cards.set(spec.key, out); if (cards.size > 8) cards.delete(cards.keys().next().value);
    return out;
  }

  // the agent and his desk (a12.js:131-136)
  function agent(c, AG, pose, o, sy = 1) {
    if (sy === 1) return AGENT.draw(c, AG.x, AG.y, AS, pose, o);
    c.save(); c.translate(AG.x, AG.y); c.scale(1 + (1 - sy) * .5, sy); const r = AGENT.draw(c, 0, 0, AS, pose, o); c.restore();
    return r;
  }
  const desk = (c, AG, cel, u) => { c.save(); c.translate(AG.x, AG.y); c.scale(AS, AS); const tip = pencilMarks(c, cel, { progress: u }); c.restore(); return tip; };
  function thanks(c, TH, u) {
    if (TH.cel) return pencilMarks(c, TH.cel, { progress: u });
    // pencil "Thanks, ", the name by NAME's fallback drawing, then the pencil again
    const k = [.3, .9]; let tip = pencilMarks(c, TH.pre, { progress: clamp(u / k[0], 0, 1) });
    if (u > k[0]) tip = NAME.drawText(c, TH.name.text, TH.x, TH.y, { mode: 'fallback', cap: THANKS.cap, cd: THANKS.condense, align: 'left', u: clamp((u - k[0]) / (k[1] - k[0]), 0, 1), id: 'thanks' }) ?? tip;
    if (u > k[1] && TH.post) tip = pencilMarks(c, TH.post, { progress: clamp((u - k[1]) / (1 - k[1]), 0, 1) }) ?? tip;
    return u < 1 ? tip : null;
  }
  // the agent's pose and face at time q (on twos), a12.js:160-166
  function agentState(K, q) {
    const T = K.T;
    if (q < T.badge[1]) return { pose: 'rest', face: 'off', badge: clamp((q - T.badge[0]) / (T.badge[1] - T.badge[0]), 0, 1) };
    if (q < T.faceOn) return { pose: 'rest', face: 'closed' };
    if (q < T.cheer[0].t) return { pose: 'rest', face: T.thanks && q >= T.thanks[0] && q < T.lookUp ? 'down' : 'open' };
    let k = T.cheer[0]; for (const c of T.cheer) if (q >= c.t) k = c;
    return { pose: k.pose, face: k.face, sy: k.sy };
  }

  // ---------- the second pass of weight, rendered once per drawing (a12.js:137-158, cached) ----------
  // fn draws the agent + desk in world units. A cache entry holds pass 1 (drawn normally: paper fills paint
  // paper) with pass 2 on top (drawn into a scratch canvas whose paper fills ERASE, so it holds exactly the
  // visible lines, then laid over pass 1), in a small canvas around him; the sheet gets one drawImage. Same
  // pixels as a12's two passes up to rounding (source-over only).
  const BOX = { x: -250, y: -330, w: 500, h: 440 };   // around his desk-top origin, world units (the cheer's hands and the desk's shadow inside)
  const FIG_POOL = 4, FILL = CanvasRenderingContext2D.prototype.fill, PAPER = COL.paper.toLowerCase();
  const figs = new Map(); let figS = 0, spare = [], eraser = null;
  function eraserCtx(w, h) {
    if (!eraser) {
      eraser = document.createElement('canvas');
      const e = eraser.getContext('2d');
      e.fill = function (...a) {                 // this canvas only: paper fills erase (a12.js:150-153)
        if (String(this.fillStyle).toLowerCase() !== PAPER) return FILL.apply(this, a);
        const op = this.globalCompositeOperation; this.globalCompositeOperation = 'destination-out'; FILL.apply(this, a); this.globalCompositeOperation = op;
      };
    }
    if (eraser.width < w || eraser.height < h) { eraser.width = Math.max(w, eraser.width); eraser.height = Math.max(h, eraser.height); }
    return eraser.getContext('2d');
  }
  function figure(c, AG, key, fn) {
    if (figS !== S) { for (const e of figs.values()) spare.push(e.cv); figs.clear(); spare = spare.slice(-FIG_POOL); figS = S; }
    const k = `${AG.x},${AG.y}|${key}`;
    let e = figs.get(k);
    if (e) { figs.delete(k); figs.set(k, e); }   // most recent last
    else {
      const px = Math.floor((AG.x + BOX.x) * S), py = Math.floor((AG.y + BOX.y) * S), pw = Math.ceil(BOX.w * S) + 2, ph = Math.ceil(BOX.h * S) + 2;
      if (figs.size >= FIG_POOL) { const [ok, old] = figs.entries().next().value; figs.delete(ok); spare.push(old.cv); }
      const cv = spare.pop() ?? document.createElement('canvas');
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      const a = cv.getContext('2d'); a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, pw, ph); a.globalAlpha = 1; a.globalCompositeOperation = 'source-over';
      a.setTransform(S, 0, 0, S, -px, -py); const tip = fn(a);
      const b = eraserCtx(pw, ph); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, eraser.width, eraser.height); b.globalAlpha = 1; b.globalCompositeOperation = 'source-over';
      b.setTransform(S, 0, 0, S, -px, -py); fn(b);
      a.setTransform(1, 0, 0, 1, 0, 0); a.drawImage(eraser, 0, 0, pw, ph, 0, 0, pw, ph);
      e = { cv, px, py, tip }; figs.set(k, e);
    }
    c.save(); resetT(c); c.drawImage(e.cv, e.px / S, e.py / S, e.cv.width / S, e.cv.height / S); c.restore();
    return e.tip;
  }

  // ---------- drawing a card at time q ----------
  function draw(c, K, q0, o = {}) {
    const q = tw(q0), tau = q0, { D, T, AG, stage } = K;
    stage.begin();
    cam(c, CX, CY, 1); paperSheet(c);
    stage.draw(c, tau, 'title'); D.lines.forEach((_, i) => stage.draw(c, tau, 'l' + i));
    MARKS.forEach((m, i) => { const u = clamp((q - T.marks[i][0]) / (T.marks[i][1] - T.marks[i][0]), 0, 1); if (u > 0) drawLogo(c, m.id, L0 + LOGO_STEP * i, K.Y.logos, LOGO_SIZE, u, { color: m.color }); });
    if (tau >= T.agent[0]) {
      const drawing = q < T.agent[1] || q < T.desk[1];
      const s = drawing ? null : agentState(K, Math.min(q, T.still)), face = s && o.blink && q >= T.still ? 'closed' : s && s.face;
      const key = drawing ? `draw@${Math.round(tau * 24)}` : `${JSON.stringify(s.pose)}|${face}|${s.sy ?? 1}|${s.badge ?? 1}`;
      const tip = figure(c, AG, key, g => {
        let t = null;
        if (q < T.agent[1]) t = stage.draw(g, tau, 'agent');
        else { const a = agentState(K, Math.min(q, T.still)); agent(g, AG, a.pose, { face: o.blink && q >= T.still ? 'closed' : a.face, badge: a.badge ?? 1 }, a.sy ?? 1); }
        if (q < T.desk[1]) t = stage.draw(g, tau, 'desk') ?? t; else desk(g, AG, D.desk, 1);
        return t;
      });
      // the cache hit keeps the pencil on the drawing's tip (makeStage records tips only when it draws)
      if (tip) stage._tips.set(q < T.agent[1] ? 'agent' : 'desk', tip);
    }
    if (q >= T.badge[0] && q < T.badge[1]) stage.draw(c, tau, 'badge');
    if (K.TH) stage.draw(c, tau, 'thanks');
    if (tau < T.still) stage.pencil(c, tau, { rest: .6, home: K.HOME, enterEase: t => t });
    return false;
  }

  // ---------- the two cards ----------
  /**
   * The start card (scene 'start'): title, subtitle, the two marks, the agent drawn, his cheer, then a
   * still hold with a blink every 3 s (C.blink, else every 3 s of the still).
   * @param {CanvasRenderingContext2D} c @param {object} C  story.js SCHEMAS "CARD STATE" (C.q seconds since the card began)
   * @returns {boolean} false (the caller draws the vignette)
   */
  function start(c, C = {}) {
    const T = CONTENT.drawn.start, K = card({ key: 'start|' + T.title + '|' + T.sub, title: T.title, lines: [{ text: T.sub }], thanks: null });
    const q = Math.max(0, C.q ?? 1e3), hq = q - K.T.still;
    const blink = hq >= 0 && (C.blink !== undefined ? !!C.blink : (hq % 3) >= 3 - 2 / 24);
    return draw(c, K, q, { blink });
  }
  /** The end card's texts for a card state (exported for tests and the panel). */
  function endSpec(C = {}) {
    const E = CONTENT.drawn.end, n = Math.max(0, Math.round(C.n ?? 0)), rej = C.branch === 'reject';
    const lines = [];
    if (n > 0) lines.push({ text: n === 1 ? E.plugs1 : STORY.fill(E.plugs, { n }) });
    lines.push(rej ? { text: E.noMoney } : { text: E.once.text, colors: E.once.colors });
    let th = null;
    if (C.drawnName) {
      const mode = C.nameMode === 'fallback' ? 'fallback' : 'font', i = E.thanks.indexOf('{name}');
      const fitted = NAME.fit(C.drawnName, mode, NAME.BUDGET.line);
      if (fitted && i >= 0) th = { pre: E.thanks.slice(0, i), name: { text: fitted, mode }, post: E.thanks.slice(i + 6) };
    }
    return { key: ['end', E.title, ...lines.map(l => l.text), th ? th.name.mode + ':' + th.name.text : ''].join('|'), title: E.title, lines, thanks: th };
  }
  /**
   * The end card (scene 'end'): title, "You pulled the plug N times." (plugs1 for N = 1, none for N = 0)
   * and "The refund happened once." with "once" in green (or "No money moved." on the reject branch), the
   * marks, the agent cheering, "Thanks, <name>" (NAME.fit to NAME.BUDGET.line; fallback drawing for other
   * scripts), then a still hold.
   * @param {CanvasRenderingContext2D} c @param {object} C  story.js SCHEMAS "CARD STATE"
   * @returns {boolean} false
   */
  function end(c, C = {}) {
    const K = card(endSpec(C));
    return draw(c, K, Math.max(0, C.q ?? 1e3), { blink: false });
  }
  /** Card timings (tests, the story's card beats: T.still is when the card is a still picture). */
  const times = (which, C = {}) => (which === 'end' ? card(endSpec(C)).T : card({ key: 'start|' + CONTENT.drawn.start.title + '|' + CONTENT.drawn.start.sub, title: CONTENT.drawn.start.title, lines: [{ text: CONTENT.drawn.start.sub }], thanks: null }).T);
  return { L, LAYOUT, start, end, endSpec, times };
})();
