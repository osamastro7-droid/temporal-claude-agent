'use strict';
// ============================================================
// game/name.js: the player's name (GAME_SPEC §6). STUB with contracts (foundation): clean/drawn/
// slug/fit have simple working bodies; the name builder completes them against the §10 name table.
//
// Who calls what:
//   ui.js      NAME.clean(input.value) on every input event (Start enabled iff ok; reason as text),
//              NAME.store.load/save/forget for the "Remember my name" checkbox.
//   runtime.js NAME.prepare(raw) on 'start' -> the G name fields; NAME.install(G) before the shop.
//   shop.js    NAME.install(G) (checkout field), NAME.drawText for the refund email page.
//   cards.js   NAME.drawText / NAME.fit for "Thanks, <name>" on the end card.
// Never: innerHTML, the URL, document.title, the console, or any request (GAME_SPEC §6 "Never").
// Spaces: every x/y/width here is world units (the 1920x1080 sheet); cap is the NOMINAL cap
// (real capitals are cap * CAP_REAL = cap * 1.354 px at S = 1, kit.js:31).
// ============================================================
window.NAME = (() => {
  /** The longest valid name, in graphemes. GAME_SPEC §6 step 5 says 24, but its §10 name table expects
   *  "a 40-character name | fits" and "Alexandra-Katharina Wolfgang (28) | first word only", which a
   *  24 limit would reject. The input's maxlength is 40 (§4, §6), so the limit is 40 and NAME.fit
   *  shortens the name where it is drawn. CONTENT.html.name.invalid.long must say the same number.
   *  (Fixer decision pending the orchestrator: see the fix report.) */
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
  /** Characters mapped before decomposition (GAME_SPEC §6 "Map for the pencil" step 2). */
  const MAP = { '\u2019': "'", '\u2018': "'", '\u0141': 'L', '\u0142': 'l', '\u0110': 'D', '\u0111': 'd', '\u0131': 'i', '\u0152': 'OE', '\u0153': 'oe', '\u00c6': 'AE', '\u00e6': 'ae', '\u00de': 'Th', '\u00fe': 'th', '\u00f0': 'd' };
  const STORE_KEY = 'tca-map-name';

  /**
   * Clean a raw input value (GAME_SPEC §6 "Clean", steps 1-6).
   * @param {string} raw  input.value (maxlength 40)
   * @returns {{ok: boolean, name: string, reason: null|'empty'|'chars'|'long'}}
   *   reason = CONTENT.html.name.invalid key; name = the cleaned name ('' when not ok)
   */
  function clean(raw) {
    let s = String(raw ?? '').normalize('NFC');
    s = s.replace(/[\u202a-\u202e\u2066-\u2069\u200b\ufeff]/g, '').replace(/[\p{Cc}]/gu, '');
    s = joinersBetweenLetters(s);                                                           // ZWNJ/ZWJ only between letters
    s = s.replace(/[\p{Extended_Pictographic}\p{S}\ufe0f]/gu, '');                        // emoji and symbols go first
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return { ok: false, name: '', reason: 'empty' };
    if (!/^[\p{L}\p{M} '\u2019.\-\u200c\u200d]+$/u.test(s)) return { ok: false, name: '', reason: 'chars' };
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
    const cp = [...s], L = /\p{L}/u, LM = /[\p{L}\p{M}]/u, J = /[\u200c\u200d]/u;
    return cp.filter((ch, i) => !J.test(ch) || (i > 0 && LM.test(cp[i - 1]) && i + 1 < cp.length && L.test(cp[i + 1]))).join('');
  }
  /** @returns {string[]} grapheme clusters (Intl.Segmenter, else code points) */
  function graphemes(s) {
    try { if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map(x => x.segment); } catch (e) { /* fall through */ }
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
      if (/\p{M}/u.test(ch)) continue;                     // a mark left over after NFC (e.g. U+0332): dropped (§6 step 3)
      if (MAP[ch]) { out += MAP[ch]; continue; }
      const d = ch.normalize('NFD').replace(/\p{M}/gu, ''), k = d && [...d].every(has) ? d : ch.normalize('NFKD').replace(/\p{M}/gu, '');
      if (k && [...k].every(has)) { out += k; continue; }
      if (/[\u200c\u200d]/.test(ch)) continue;
      return { text: name, mode: 'fallback' };
    }
    return { text: out, mode: 'font' };
  }
  /**
   * The e-mail name (GAME_SPEC §6 "slug"): the ASCII lower-case letters of the drawn name, up to 12,
   * else 'you'. Accents are folded first (NFD, marks dropped), so 'Zoë' -> 'zoe' and 'José María' ->
   * 'josemaria' instead of 'zo' / 'josmara'. (Reading of the spec's "ASCII letters of the drawn name":
   * see the fix report.)
   * @param {string} text a drawn name @returns {string}
   */
  function slug(text) { const s = String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12); return s || 'you'; }

  /**
   * Width of a name line in world units: measure() for 'font', ctx.measureText at the equivalent px
   * size for 'fallback' (fallbackFont(cap)).
   * @param {string} text @param {'font'|'fallback'} mode @param {number} cap @param {number} cd condense
   */
  function measureName(text, mode, cap, cd = 1) {
    if (mode === 'font') return measure(text, cap, 0, cd);
    const g = scratchCtx(); g.save(); g.font = fallbackFont(cap); const w = g.measureText(text).width; g.restore(); return w;
  }
  /** CSS font for the fallback at a nominal cap: capitals as tall as the pencil's (cap * CAP_REAL). */
  const fallbackFont = cap => `${Math.round(cap * CAP_REAL / .7)}px ${HAND_FONT}`;
  /**
   * Fit a name to a budget: whole name, else the first word, else cut + "..." (GAME_SPEC §6 "Widths").
   * The budget is for the name alone (BUDGET above); the text around it is not measured here.
   * @param {string} text @param {'font'|'fallback'} mode @param {{cap, cd, max}} budget  BUDGET.field|mail|line
   * @returns {string}
   */
  function fit(text, mode, budget) {
    const ok = t => measureName(t, mode, budget.cap, budget.cd) <= budget.max;
    if (ok(text)) return text;
    const first = text.split(' ')[0]; if (ok(first)) return first;
    const ch = [...first]; while (ch.length > 1 && !ok(ch.join('') + '...')) ch.pop();
    return ch.join('') + '...';
  }
  /**
   * Everything the game stores about the name, from a raw input value.
   * @returns {{ok, reason, name, drawnName, nameMode, slug}}  (the G name fields when ok)
   */
  function prepare(raw) {
    const c = clean(raw); if (!c.ok) return { ok: false, reason: c.reason, name: '', drawnName: '', nameMode: 'font', slug: 'you' };
    const d = drawn(c.name);
    return { ok: true, reason: null, name: c.name, drawnName: d.text, nameMode: d.mode, slug: d.mode === 'font' ? slug(d.text) : 'you' };
  }
  /**
   * The checkout Name field's typed cels (stageC.js:236-241 typedCel, fixed to index by code point),
   * compile ids 'game/co/name/<drawn>@<i>'. Shape = SC.D.checkout.name: {cels, ends, x, y, n};
   * show k letters with dyn.checkout.name = (k - .5) / n (stageC.js:359).
   * @param {string} text  a font-mode drawn name already fitted to BUDGET.field
   */
  function typedName(text) {
    const id = 'game/co/name/' + text, x = -86, y = -42, cap = 33, cd = .86;   // from stageC.js:188
    const t = textStrokes(text, x, y, { cap, condense: cd, id, seed: 61, width: 3 }), g = [];
    for (const s of t.strokes) { const i = +s.id.split('/').at(-2); (g[i] ??= []).push(s); }
    const ch = [...text], cels = [], ends = []; let acc = [];
    ch.forEach((c, i) => { if (g[i]) acc = acc.concat(g[i]); cels.push(compile({ strokes: acc.slice() }, `${id}@${i + 1}`)); ends.push(x + measure(ch.slice(0, i + 1).join(''), cap, 0, cd)); });
    return { cels, ends, x, y, n: ch.length };
  }
  /**
   * Put the player's name into the shop's checkout page (SC.D.checkout.name). Fallback mode: the
   * field gets an empty typed cel list and shop.js draws the name with drawText instead.
   * STUB: fallback mode is the name builder's.
   * @param {object} G
   */
  function install(G) {
    SC.build(); if (G.nameMode === 'font' && G.drawnName) SC.D.checkout.name = typedName(fit(G.drawnName, 'font', BUDGET.field));
  }
  /**
   * Draw a name (or a line containing it) in the current transform: pencil text in 'font' mode
   * (compile id 'game/name/<id>/<text>'), else fillText in HAND_FONT, graphite, revealed by a
   * growing clip (ctx.direction = 'rtl' for RTL text).
   * @param {CanvasRenderingContext2D} c
   * @param {string} text @param {number} x @param {number} y  baseline, world units
   * @param {{mode, cap, cd, align: 'left'|'center'|'right', u: 0..1, color, id: string}} o
   * @returns {[number, number]|null} the pencil tip (world) while writing, else null
   */
  function drawText(c, text, x, y, o = {}) {
    const cap = o.cap ?? 46, u = o.u ?? 1, mode = o.mode ?? 'font';
    if (mode === 'font') {
      const cel = textCel(`game/name/${o.id ?? 'line'}/${text}`, [{ text, x, y, cap, align: o.align ?? 'left' }], { condense: o.cd ?? 1, width: cap * .064 });
      return pencilMarks(c, cel, { progress: u, color: o.color ?? 'graphite' });
    }
    return null;   // STUB: fallback drawing (fillText + clip reveal) is the name builder's
  }
  /** Opt-in persistence (GAME_SPEC §6 "Storage"): key 'tca-map-name', every access in try/catch. */
  const store = {
    load() { try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; } },
    save(name) { try { localStorage.setItem(STORE_KEY, name); } catch (e) { /* storage blocked */ } },
    forget() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* storage blocked */ } },
  };
  return { MAX, BUDGET, MAP, clean, graphemes, drawn, slug, measureName, fallbackFont, fit, prepare, typedName, install, drawText, store };
})();
