'use strict';
// ============================================================
// game/name.js: the player's name (GAME_SPEC §6).
//
// Who calls what:
//   ui.js      NAME.clean(input.value) on every input event (Start enabled iff ok; reason as text),
//              NAME.store.load/save/forget for the "Remember my name" checkbox.
//   runtime.js NAME.prepare(raw) on 'start' -> the G name fields; NAME.install(G) before the shop.
//   shop.js    NAME.install(G) (checkout field); in fallback mode NAME.drawTyped for the checkout field;
//              NAME.drawText for the refund email page.
//   cards.js   NAME.drawText / NAME.fit for "Thanks, <name>" on the end card.
// Never: innerHTML, the URL, document.title, the console, or any request (GAME_SPEC §6 "Never").
// Spaces: every x/y/width here is world units (the 1920x1080 sheet); cap is the NOMINAL cap
// (real capitals are cap * CAP_REAL = cap * 1.354 px at S = 1, kit.js:47).
// ============================================================
window.NAME = (() => {
  /** The longest valid name, in graphemes. GAME_SPEC §6 step 5 says 24, but its §10 name table expects
   *  "a 40-character name | fits" and "Alexandra-Katharina Wolfgang (28) | first word only", which a
   *  24 limit would reject. The input's maxlength is 40 (§4, §6), so the limit is 40 and NAME.fit
   *  shortens the name where it is drawn. CONTENT.html.name.invalid.long says the same number. */
  const MAX = 40;
  /** "Hi {name}," / "Thanks, {name}" with the name left out: the text around the name on its line. */
  const around = (s, cap, cd) => measure(String(s).replace('{name}', ''), cap, 0, cd);
  /** Width budgets (world units) for the NAME ALONE, GAME_SPEC §6 "Widths".
   *    field  the checkout Name field (cap 33, condense .86): the name <= 512.
   *    mail   the refund email page (cloned from D.requested, lettered at cap 36 / condense .86 on the
   *           960-wide display; text column 880): the name <= 880 - width("Hi ,"), on its own line
   *           (CONTENT.drawn.mail.lines[0]). The spec's "cap 46 <= 1500" cannot hold on that page.
   *    line   the end card's "Thanks, {name}" (cap 46): the name <= 1500 - width("Thanks, "). */
  const BUDGET = {
    field: { cap: 33, cd: .86, max: 512 },
    mail: { cap: 36, cd: .86, max: 880 - around(CONTENT.drawn.mail.lines[0], 36, .86) },
    line: { cap: 46, cd: 1, max: 1500 - around(CONTENT.drawn.end.thanks, 46, 1) },
  };
  /** The checkout Name field (display-local, from stageC.js:185-189): text x, baseline y, cap, condense;
   *  right = the field's inner right edge (box [-110, -94, 560, 60], text inset 24). */
  const FIELD = { x: -86, y: -42, cap: 33, cd: .86, right: -110 + 560 - 24, gap: 15 };   // gap = stageC.js:378 TEXT_CARET.gap
  /** Characters mapped before decomposition (GAME_SPEC §6 "Map for the pencil" step 2). */
  const MAP = { '\u2019': "'", '\u2018': "'", '\u0141': 'L', '\u0142': 'l', '\u0110': 'D', '\u0111': 'd', '\u0131': 'i', '\u0152': 'OE', '\u0153': 'oe', '\u00c6': 'AE', '\u00e6': 'ae', '\u00de': 'Th', '\u00fe': 'th', '\u00f0': 'd' };
  const STORE_KEY = 'tca-map-name';
  const JOINER = /[\u200c\u200d]/u;
  /** Right-to-left scripts (the first strong letter decides the direction). */
  const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u;

  /**
   * Clean a raw input value (GAME_SPEC §6 "Clean", steps 1-6).
   * @param {string} raw  input.value (maxlength 40)
   * @returns {{ok: boolean, name: string, reason: null|'empty'|'chars'|'long'}}
   *   reason = CONTENT.html.name.invalid key; name = the cleaned name ('' when not ok)
   */
  function clean(raw) {
    let s = String(raw ?? '').normalize('NFC');
    s = s.replace(/\s/gu, ' ');                                                             // tabs, newlines, nbsp -> one kind of space (before the control strip, so words stay apart)
    // bidi overrides/isolates, zero-width space, BOM, and every other invisible format character (LRM, RLM,
    // word joiner, soft hyphen, tags) except ZWNJ/ZWJ; control characters; variation selectors
    s = s.replace(/[\u202a-\u202e\u2066-\u2069\u200b\ufeff]/g, '').replace(/[\p{Cc}]/gu, '').replace(/(?![\u200c\u200d])\p{Cf}/gu, '').replace(/[\ufe00-\ufe0f]|\udb40[\udd00-\uddef]/g, '');
    s = joinersBetweenLetters(s);                                                           // ZWNJ/ZWJ only between letters
    const typed = /\S/.test(s);
    s = s.replace(/[\p{Extended_Pictographic}\p{S}\u20e3]/gu, '');                        // emoji and symbols go first (§6 step 6)
    s = joinersBetweenLetters(s).replace(/ +/g, ' ').trim();
    if (!s) return { ok: false, name: '', reason: typed ? 'chars' : 'empty' };
    if (!/^[\p{L}\p{M} '\u2019.\-\u200c\u200d]+$/u.test(s) || !/\p{L}/u.test(s) || /^\p{M}/u.test(s)) return { ok: false, name: '', reason: 'chars' };
    const n = graphemes(s).length;
    if (n < 1 || n > MAX) return { ok: false, name: '', reason: 'long' };
    return { ok: true, name: s, reason: null };
  }
  /**
   * Keep ZWNJ / ZWJ only between letters (GAME_SPEC §6 step 3), by scanning code points. No regex
   * lookbehind: (?<...) is a SyntaxError on Safari/iOS before 16.4 and would stop this whole file.
   * A letter followed by its combining marks counts as the letter on the left.
   */
  function joinersBetweenLetters(s) {
    const cp = [...s], L = /\p{L}/u, LM = /[\p{L}\p{M}]/u;
    return cp.filter((ch, i) => !JOINER.test(ch) || (i > 0 && LM.test(cp[i - 1]) && i + 1 < cp.length && L.test(cp[i + 1]))).join('');
  }
  let seg = null;
  /** @returns {string[]} grapheme clusters (Intl.Segmenter, else code points) */
  function graphemes(s) {
    try { if (!seg && typeof Intl !== 'undefined' && Intl.Segmenter) seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); if (seg) return [...seg.segment(s)].map(x => x.segment); } catch (e) { /* fall through */ }
    return [...s];
  }
  const has = ch => !!FONT_EMS_TECH.glyphs[ch];
  /**
   * Map a cleaned name to the pencil font (GAME_SPEC §6 "Map for the pencil").
   * @param {string} name  a clean() result
   * @returns {{text: string, mode: 'font'|'fallback'}}  mode 'fallback': text = name, drawn by fillText
   */
  function drawn(name) {
    let out = '';
    for (const ch of name) {
      if (has(ch)) { out += ch; continue; }
      if (/\p{M}/u.test(ch) || JOINER.test(ch)) continue;  // a mark left over after NFC (e.g. U+0332), a joiner: dropped (§6 step 3)
      if (MAP[ch]) { out += MAP[ch]; continue; }
      const d = ch.normalize('NFD').replace(/\p{M}/gu, '');
      if (d && [...d].every(has)) { out += d; continue; }
      const k = ch.normalize('NFKD').replace(/\p{M}/gu, '');
      if (k && [...k].every(has)) { out += k; continue; }
      return { text: name, mode: 'fallback' };            // §6 step 4: one undrawable letter -> the whole name
    }
    return { text: out, mode: 'font' };
  }
  /**
   * The e-mail name (GAME_SPEC §6 "slug"): the ASCII lower-case letters of the drawn name, up to 12,
   * else 'you'. Accents are folded first (NFD, marks dropped), so 'Zoë' -> 'zoe' and 'José María' ->
   * 'josemaria' instead of 'zo' / 'josmara'. A fallback-mode name keeps only its ASCII letters too.
   * @param {string} text a drawn name @returns {string}
   */
  function slug(text) { const s = String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12); return s || 'you'; }
  /** @returns {boolean} the text reads right to left (its first strong letter is RTL) */
  function isRtl(text) { for (const ch of String(text)) if (/\p{L}/u.test(ch)) return RTL.test(ch); return false; }

  /**
   * Width of a name line in world units: measure() for 'font', ctx.measureText at the equivalent px
   * size for 'fallback' (fallbackFont(cap)), both at S = 1.
   * @param {string} text @param {'font'|'fallback'} mode @param {number} cap @param {number} cd condense
   */
  function measureName(text, mode, cap, cd = 1) {
    if (mode === 'font') return measure(text, cap, 0, cd);
    const g = scratchCtx(); g.save(); g.font = fallbackFont(cap); g.direction = isRtl(text) ? 'rtl' : 'ltr'; const w = g.measureText(text).width * cd; g.restore(); return w;
  }
  /** CSS font for the fallback at a nominal cap: capitals as tall as the pencil's (cap * CAP_REAL; a
   *  system hand font's capitals are about .7 em). */
  const fallbackFont = cap => `${Math.round(cap * CAP_REAL / .7)}px ${HAND_FONT}`;
  /**
   * Fit a name to a budget: whole name, else the first word, else cut + "..." (GAME_SPEC §6 "Widths";
   * three periods: the font has no ellipsis glyph). Cuts fall between graphemes.
   * The budget is for the name alone (BUDGET above); the text around it is not measured here.
   * @param {string} text @param {'font'|'fallback'} mode @param {{cap, cd, max}} budget  BUDGET.field|mail|line
   * @returns {string}
   */
  function fit(text, mode, budget) {
    const ok = t => measureName(t, mode, budget.cap, budget.cd) <= budget.max;
    if (ok(text)) return text;
    const first = text.split(' ')[0]; if (ok(first)) return first;
    const ch = graphemes(first); while (ch.length > 1 && !ok(ch.join('') + '...')) ch.pop();
    return ch.join('') + '...';
  }
  /**
   * Everything the game stores about the name, from a raw input value.
   * @returns {{ok, reason, name, drawnName, nameMode, slug}}  (the G name fields when ok)
   */
  function prepare(raw) {
    const c = clean(raw); if (!c.ok) return { ok: false, reason: c.reason, name: '', drawnName: '', nameMode: 'font', slug: 'you' };
    const d = drawn(c.name);
    return { ok: true, reason: null, name: c.name, drawnName: d.text, nameMode: d.mode, slug: slug(d.text) };
  }
  /**
   * The checkout Name field's typed cels (stageC.js:236-241 typedCel, fixed to index by code point),
   * compile ids 'game/co/name/<drawn>@<i>'. Shape = SC.D.checkout.name: {cels, ends, x, y, n};
   * show k letters with dyn.checkout.name = (k - .5) / n (stageC.js:360).
   * @param {string} text  a font-mode drawn name already fitted to BUDGET.field
   */
  function typedName(text) {
    const { x, y, cap, cd } = FIELD, id = 'game/co/name/' + text;
    const t = textStrokes(text, x, y, { cap, condense: cd, id, seed: 61, width: 3 }), g = [];
    for (const s of t.strokes) { const i = +s.id.split('/').at(-2); (g[i] ??= []).push(s); }
    const ch = [...text], cels = [], ends = []; let acc = [];
    ch.forEach((c, i) => { if (g[i]) acc = acc.concat(g[i]); cels.push(compile({ strokes: acc.slice() }, `${id}@${i + 1}`)); ends.push(x + measure(ch.slice(0, i + 1).join(''), cap, 0, cd)); });
    return { cels, ends, x, y, n: ch.length };
  }
  /**
   * The fallback checkout field: n = graphemes, one EMPTY cel per grapheme (stageC's page() then draws
   * no pencil strokes but still moves its caret along `ends`), and the text for drawTyped. The caret
   * sits after the typed part: to its right for LTR, to its left for RTL (right-aligned in the field).
   */
  function typedFallback(text) {
    const { x, y, cap, cd, right, gap } = FIELD, gs = graphemes(text), rtl = isRtl(text), none = emptyCel();
    const ends = gs.map((_, i) => { const w = measureName(gs.slice(0, i + 1).join(''), 'fallback', cap, cd); return rtl ? right - w - 2 * gap : x + w; });
    return { cels: gs.map(() => none), ends, x: rtl ? right - 2 * gap : x, y, n: gs.length, fallback: { text, graphemes: gs, rtl } };
  }
  /** A cel that draws nothing: one invisible stroke (opacity 0); pencilMarks cannot take a cel without strokes. */
  const emptyCel = () => compile({ strokes: [stroke('empty', [[FIELD.x, FIELD.y], [FIELD.x + 1, FIELD.y]], { width: .01, opacity: 0 })] }, 'game/co/name/-empty');
  /**
   * Put the player's name into the shop's checkout page (SC.D.checkout.name), fitted to BUDGET.field.
   * Fallback mode: the field gets empty cels (see typedFallback) and shop.js draws the letters with
   * NAME.drawTyped under the same display transform. NAME.checkout keeps what was installed.
   * @param {object} G
   */
  let checkout = null;
  function install(G) {
    SC.build(); checkout = null;
    if (!G.drawnName) return;
    const text = fit(G.drawnName, G.nameMode, BUDGET.field);
    SC.D.checkout.name = G.nameMode === 'font' ? typedName(text) : typedFallback(text);
    checkout = { text, mode: G.nameMode };
  }
  /**
   * Fallback mode only: draw the checkout name's first k graphemes, where k follows stageC's rule for
   * dyn.checkout.name (stageC.js:360). Call it in DISPLAY-LOCAL space (the transform SC.page draws the
   * page in). A no-op in font mode (the page's own cels draw the name).
   * @param {CanvasRenderingContext2D} c @param {number} dynName  dyn.checkout.name 0..1 @param {number=} alpha
   */
  function drawTyped(c, dynName, alpha = 1) {
    const P = SC.D && SC.D.checkout && SC.D.checkout.name; if (!P || !P.fallback || !(dynName > 0)) return;
    const k = dynName >= 1 ? P.n : Math.min(P.n, Math.floor(dynName * P.n) + 1), t = P.fallback.graphemes.slice(0, k).join('');
    c.save(); c.globalAlpha *= alpha;
    drawText(c, t, P.fallback.rtl ? FIELD.right : FIELD.x, FIELD.y, { mode: 'fallback', cap: FIELD.cap, cd: FIELD.cd, align: P.fallback.rtl ? 'right' : 'left', u: 1 });
    c.restore();
  }
  /**
   * Draw a name (or a line containing it) in the current transform: pencil text in 'font' mode
   * (compile id 'game/name/<id>/<text>'), else fillText in HAND_FONT, graphite, revealed by a
   * growing clip (ctx.direction = 'rtl' for RTL text; the clip grows from the right).
   * @param {CanvasRenderingContext2D} c
   * @param {string} text @param {number} x @param {number} y  baseline, world units
   * @param {{mode, cap, cd, align: 'left'|'center'|'right', u: 0..1, color, id: string}} o
   * @returns {[number, number]|null} the pencil tip (world) while writing, else null
   */
  function drawText(c, text, x, y, o = {}) {
    const cap = o.cap ?? 46, u = clamp(o.u ?? 1, 0, 1), mode = o.mode ?? 'font', align = o.align ?? 'left';
    if (mode === 'font') {
      // compile() caches by id only (kit.js:123): the id carries everything the strokes depend on
      const cel = textCel(`game/name/${o.id ?? 'line'}/${text}@${x},${y},${cap},${o.cd ?? 1},${align}`, [{ text, x, y, cap, align }], { condense: o.cd ?? 1, width: cap * .064 });
      return pencilMarks(c, cel, { progress: u, color: o.color ?? 'graphite' });
    }
    if (u <= 0 || !text) return null;
    // the fallback: the system hand font in graphite, condensed like the pencil (cd), revealed by a clip
    const rtl = isRtl(text), cd = o.cd ?? 1, px = Math.round(cap * CAP_REAL / .7);
    c.save();
    c.font = fallbackFont(cap); c.direction = rtl ? 'rtl' : 'ltr'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const w = c.measureText(text).width * cd, left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const shown = w * u, x0 = rtl ? left + w - shown : left;
    c.beginPath(); c.rect(x0 - 2, y - px * 1.25, shown + 4, px * 1.7); c.clip();
    c.translate(left, y); c.scale(cd, 1);
    c.fillStyle = colorOf(o.color ?? 'graphite');
    c.globalAlpha *= .8; c.fillText(text, 0, 0);                        // graphite, lighter than ink (the pencil's line is thin)
    c.globalAlpha *= .25; c.fillText(text, .8, .5);                       // a second, faint pass: pencil grain
    c.restore();
    return u < 1 ? [rtl ? x0 : x0 + shown, y - cap * .5] : null;
  }
  /** Opt-in persistence (GAME_SPEC §6 "Storage"): key 'tca-map-name', every access in try/catch. */
  const store = {
    load() { try { const v = localStorage.getItem(STORE_KEY); return typeof v === 'string' && v.length <= 200 ? v : null; } catch (e) { return null; } },
    save(name) { try { localStorage.setItem(STORE_KEY, name); } catch (e) { /* storage blocked */ } },
    forget() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* storage blocked */ } },
  };
  return { MAX, BUDGET, FIELD, MAP, clean, graphemes, drawn, slug, isRtl, measureName, fallbackFont, fit, prepare, typedName, install, drawTyped, drawText, store, get checkout() { return checkout; } };
})();
