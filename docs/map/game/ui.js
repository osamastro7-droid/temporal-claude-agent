'use strict';
// ============================================================
// game/ui.js: all DOM work (GAME_SPEC §2 "Input and accessibility", §5, §6). STUB with contracts
// (foundation): binds the control bar, keys, name form, rail and hotspots to runtime's act(), and
// renders the panel and the lower sections with textContent. The UI builder completes the texts,
// the layout details and the look of the rail's crash marks.
//
// DOM contract (ids in index.html; ui.js never creates the page skeleton, only list items / cards / rows):
//   #game          the game section (aria-label from CONTENT.html.aria.game)
//   #cv            the canvas (aria-hidden)        #hotspots   absolutely positioned hotspot layer over it
//   #nameform      form: #name-input, #name-remember, #name-start, #name-why (reason), #name-privacy
//   #controls      #btn-action + #btn-alt (Reject next to Approve) + #why-action (reason or note),
//                  #btn-plug + #why-plug, #btn-pause, #btn-sound, #btn-step
//   #endbar        #btn-again, #btn-rename, #btn-break      #status   role=status: the current caption
//   #rail          nav > ol (Shop chip, chips 1-9)          #panel    #p-now, #p-if, #p-proof, #p-note,
//                  #p-retry-note, #p-retry (table: thead > tr, tbody), #p-book, #p-history
//   #lower         #sec-cases, #sec-findings, #sec-proven   #footer   #footer-text, #footer-lic
//   #page-title    the h1 (its markup text is the no-JS fallback; set from CONTENT.html.title)
// Everything is written with textContent / DOM APIs; never innerHTML (GAME_SPEC §9).
// Coordinates: screen = logical 1920x1080 (story.js SCHEMAS); css px from the canvas rect.
//
// Control buttons (#btn-action, #btn-alt, #btn-plug) are never `disabled`: they use aria-disabled and
// ignore clicks while it is "true", so a focused button keeps its focus while a beat plays (a disabled
// button drops focus to <body>, GAME_SPEC §10 test 5). The reason is shown as text next to it.
// Focus: on a change between the start card, the play and the end card (or when the focused control
// disappears), UI.sync moves focus to #name-input / #btn-action / #btn-again (preventScroll).
// ============================================================
window.UI = (() => {
  const $ = id => document.getElementById(id);
  let act = () => {}, cv = null, pointer = null, last = {}, lastGroup = null, lastFocus = null, check = () => {};
  const T = () => CONTENT.html;
  /** set textContent only when it changed (UI.sync runs every frame) */
  const text = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
  const attr = (el, k, v) => { if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); };
  const pressed = (el, on) => attr(el, 'aria-pressed', on ? 'true' : 'false');
  const off = (el, isOff) => attr(el, 'aria-disabled', isOff ? 'true' : 'false');
  const isOff = el => el.getAttribute('aria-disabled') === 'true';
  const gone = el => !el || !el.isConnected || !!el.closest('[hidden]') || !!el.disabled;

  /**
   * Bind everything once (runtime.js at DOMContentLoaded).
   * @param {{act: (name: string) => void}} h  runtime's act(): the one entry point for player actions
   *   (the act list is in runtime.js's header).
   */
  function init(h) {
    act = h.act; cv = $('cv');
    const B = T().buttons, A = T().aria;
    text($('page-title'), T().title);
    for (const [id, k] of [['game', 'game'], ['controls', 'controls'], ['endbar', 'endbar'], ['panel', 'panel'], ['sec-cases', 'cases'], ['sec-findings', 'findings'], ['sec-proven', 'proven']]) attr($(id), 'aria-label', A[k]);
    text($('btn-pause'), B.pause); text($('btn-sound'), B.sound); text($('btn-step'), B.stepMode);
    text($('btn-again'), B.playAgain); text($('btn-rename'), B.changeName); text($('btn-break'), B.tryBreak);
    const bind = (id, fallback) => { const el = $(id); el.addEventListener('click', () => { if (isOff(el)) return; const a = el.dataset.act || fallback; if (a) act(a); }); };
    bind('btn-action'); bind('btn-alt'); bind('btn-plug', 'plug');
    $('btn-pause').addEventListener('click', () => act('pause'));
    $('btn-sound').addEventListener('click', () => act('sound'));
    $('btn-step').addEventListener('click', () => act('step'));
    $('btn-again').addEventListener('click', () => act('again'));
    $('btn-rename').addEventListener('click', () => act('rename'));
    $('btn-break').addEventListener('click', () => act('break'));
    // name form (GAME_SPEC §6)
    const N = T().name, input = $('name-input');
    text($('name-label'), N.label); text($('name-start'), N.start); text($('name-remember-label'), N.remember); text($('name-privacy'), N.privacy);
    check = () => { const r = NAME.clean(input.value); $('name-start').disabled = !r.ok; text($('name-why'), r.ok ? '' : N.invalid[r.reason] ?? ''); return r; };
    input.addEventListener('input', check);
    $('nameform').addEventListener('submit', e => { e.preventDefault(); if (check().ok) act('start'); });
    const saved = NAME.store.load(); if (saved) { input.value = saved; $('name-remember').checked = true; }
    check();
    // keys (GAME_SPEC §2): letters are ignored while a text field has focus; Space and Enter are left to
    // any focused control (a button, the checkbox, a link) so they keep their own meaning
    document.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null, tag = t ? t.tagName : '';
      const textEntry = !!t && (t.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset)$/i.test(t.type)));
      if (textEntry) return;
      const control = !!t && (/^(INPUT|BUTTON|A|SELECT|TEXTAREA|SUMMARY)$/.test(tag) || t.hasAttribute('tabindex'));
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'p') { const b = $('btn-plug'); if (!b.closest('[hidden]') && !isOff(b)) act(b.dataset.act || 'plug'); e.preventDefault(); }
      else if (k === 'a') act('approve');
      else if (k === 'r') act('reject');
      else if (k === ' ' && !control) { act('pause'); e.preventDefault(); }
      else if (k === 'Enter' && !control) act('next');
    });
    document.addEventListener('focusin', e => { lastFocus = e.target; });
    // the real pointer over the canvas, in screen coordinates (runtime passes it to the shop cursor)
    cv.addEventListener('pointermove', e => { pointer = toLogical(e.clientX, e.clientY); });
    cv.addEventListener('pointerleave', () => { pointer = null; });
    text($('rail-label'), T().rail.label);
    buildRail(); renderLower();
  }
  /** css client point -> screen (logical 1920x1080), using the canvas element's rect. */
  function toLogical(x, y) { const r = cv.getBoundingClientRect(); return [(x - r.left) / r.width * W, (y - r.top) / r.height * H]; }
  /** @returns {[number, number]|null} the live pointer in screen coordinates, or null (not over the canvas) */
  const getPointer = () => pointer;
  /** @returns {{name: string, remember: boolean}} the raw name form value */
  const nameValue = () => ({ name: $('name-input').value, remember: $('name-remember').checked });
  /** Write a name into the form as if typed (window.__game.act('start', name)). @param {string} v */
  function setName(v) { $('name-input').value = v; check(); }

  function buildRail() {
    const ol = $('rail').querySelector('ol'); if (ol.children.length) return;
    const R = T().rail, mk = (k, label) => { const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.k = String(k);
      const n = document.createElement('span'); n.className = 'chip-n'; n.textContent = k ? String(k) : R.shop; b.append(n);
      if (k) { const t = document.createElement('span'); t.className = 'chip-t'; t.textContent = label; b.append(t); }
      const m = document.createElement('span'); m.className = 'chip-crash'; b.append(m);
      b.addEventListener('click', () => act('rail:' + k)); li.append(b); ol.append(li); };
    mk(0, R.shop); R.stages.forEach((s, i) => mk(i + 1, s));
  }
  /** Render the lower sections (GAME_SPEC §5) and the footer from CONTENT.html.lower / .footer. */
  function renderLower() {
    const L = T().lower, el = (tag, cls, s) => { const e = document.createElement(tag); if (cls) e.className = cls; if (s !== undefined) e.textContent = s; return e; };
    const fill = (sec, title, intro) => { sec.replaceChildren(el('h2', null, title)); if (intro) sec.append(el('p', null, intro)); return sec; };
    const cases = fill($('sec-cases'), L.cases.title, L.cases.intro), grid = el('div', 'cards');
    for (const c of L.cases.items) { const d = el('div', 'card'); d.append(el('h3', null, c.title), el('p', null, c.text)); grid.append(d); }
    cases.append(grid);
    const fx = fill($('sec-findings'), L.findings.title, L.findings.intro), ul = el('ul', 'fixes');
    for (const [a, b] of L.findings.items) { const li = el('li'); li.append(el('p', null, a), el('p', 'fix', b)); ul.append(li); }
    fx.append(ul);
    const pr = fill($('sec-proven'), L.proven.title); for (const p of L.proven.text) pr.append(el('p', null, p));
    text($('footer-text'), T().footer.text); text($('footer-lic'), T().footer.licences);
  }

  /**
   * Bring the DOM in line with the game (runtime.js, every drawn frame; cheap: writes only on change).
   * @param {object} G  story.js SCHEMAS
   * @param {{action: object, plug: object, panel: object, hotspots: {act, box}[], caption: string,
   *   crashes: {stage: number, mark: 'crashedBefore'|'crashedAfter'}[]}} V
   *   action = STORY.action(G); plug = STORY.plugState(G); panel = STORY.panel(G);
   *   hotspots = boxes in SCREEN coordinates (runtime converts world boxes with ROOM.boxToScreen or
   *   as-is for the shop); caption = the current caption's text ('' when none), for #status;
   *   crashes = one entry per plug pull with its rail words (STORY.railMark).
   */
  function sync(G, V) {
    const B = T().buttons, D = T().disabled;
    const start = G.scene === 'start', end = G.scene === 'end';
    $('nameform').hidden = !start; $('controls').hidden = start; $('endbar').hidden = !end;
    const a = V.action, ba = $('btn-action'), alt = $('btn-alt');
    text(ba, B[a.label] ?? a.label); off(ba, !a.enabled); ba.dataset.act = a.act ?? '';
    alt.hidden = !a.alt; if (a.alt) { text(alt, B[a.alt.label] ?? a.alt.label); off(alt, !a.alt.enabled); alt.dataset.act = a.alt.act; } else alt.dataset.act = '';
    text($('why-action'), a.enabled ? (a.note ? D[a.note] ?? '' : '') : D[a.reason] ?? '');
    const dark = G.worker.phase === 'dark', bp = $('btn-plug');
    // pressed = the plug is out (not while he wakes)
    text(bp, dark ? B.unplug : B.plug); pressed(bp, ['pulling', 'dark', 'pushing'].includes(G.worker.phase)); bp.dataset.act = dark ? 'unplug' : 'plug';
    off(bp, !V.plug.ok); text($('why-plug'), V.plug.ok ? '' : D[V.plug.reason] ?? '');
    pressed($('btn-pause'), G.settings.paused); pressed($('btn-sound'), G.settings.sound); pressed($('btn-step'), G.settings.stepMode);
    if (last.caption !== V.caption) { last.caption = V.caption; text($('status'), V.caption); }
    const P = V.panel, Pl = T().panel;
    text($('p-now-label'), Pl.nowLabel); text($('p-now'), P.now); text($('p-if-label'), Pl.ifPlugLabel); text($('p-if'), P.ifPlug); text($('p-proof'), P.proof);
    text($('p-note'), P.note ? P.note.text : ''); text($('p-retry-note'), P.note ? P.note.retryNote : ''); table($('p-retry'), P.note && P.note.table);
    text($('p-book-label'), Pl.notebookLabel); text($('p-history-label'), Pl.historyLabel);
    list($('p-book'), P.notebook); list($('p-history'), P.history);
    rail(G, V.crashes ?? [], start);
    hotspots(V.hotspots);
    focus(G);
  }
  function rail(G, crashes, start) {
    const R = T().rail;
    for (const b of $('rail').querySelectorAll('button')) {
      const k = +b.dataset.k, cur = k === G.stage && !start ? 'step' : null;
      if ((b.getAttribute('aria-current') ?? null) !== cur) { if (cur) b.setAttribute('aria-current', cur); else b.removeAttribute('aria-current'); }
      const words = [...new Set(crashes.filter(c => c.stage === k).map(c => R[c.mark] ?? ''))].filter(Boolean).join(', ');
      text(b.querySelector('.chip-crash'), words);
    }
  }
  /** The retry table (GAME_SPEC §3 "Retries"), or hidden. @param {null|{head: string[], rows: string[][]}} t */
  function table(el, t) {
    const key = t ? JSON.stringify(t) : ''; if (el.dataset.key === key) return; el.dataset.key = key; el.hidden = !t;
    const row = (cells, tag) => { const tr = document.createElement('tr'); for (const s of cells) { const td = document.createElement(tag); if (tag === 'th') td.scope = 'col'; td.textContent = s; tr.append(td); } return tr; };
    el.tHead.replaceChildren(...(t ? [row(t.head, 'th')] : [])); el.tBodies[0].replaceChildren(...(t ? t.rows.map(r => row(r, 'td')) : []));
  }
  /**
   * Focus never falls to <body> (GAME_SPEC §10 test 5): when the view changes between the start card,
   * the play and the end card, or the focused control disappears, focus the view's main control.
   * The first sync (page load) never moves focus. Going back to the start card (Change name) also
   * empties the form.
   */
  function focus(G) {
    const group = G.scene === 'start' ? 'start' : G.scene === 'end' ? 'end' : 'play', prev = lastGroup; lastGroup = group;
    if (prev === null) return;
    const target = group === 'start' ? $('name-input') : group === 'end' ? $('btn-again') : $('btn-action');
    if (group !== prev && group === 'start' && !G.name) { $('name-input').value = ''; $('name-remember').checked = false; check(); }
    const ae = document.activeElement, lost = !ae || ae === document.body || gone(ae);
    const ours = !lastFocus || $('game').contains(lastFocus) || !lastFocus.isConnected;
    if ((group !== prev && (lost || ours)) || (lost && lastFocus && gone(lastFocus))) { if (document.activeElement !== target) target.focus({ preventScroll: true }); }
  }
  /** replace an <ol>'s items only when the list changed */
  function list(ol, items) { const key = items.join('\n'); if (ol.dataset.key === key) return; ol.dataset.key = key; ol.replaceChildren(...items.map(s => { const li = document.createElement('li'); li.textContent = s; return li; })); }
  /**
   * Place the hotspot buttons (GAME_SPEC §2): <button aria-hidden="true" tabindex="-1">, >= 44x44 css px,
   * positioned in % of the canvas box. @param {{act: string, box: number[]}[]} list  screen boxes
   */
  function hotspots(list) {
    const key = JSON.stringify(list.map(h => [h.act, h.box.map(v => Math.round(v))])); if (last.hot === key) return; last.hot = key;
    const layer = $('hotspots'), r = cv.getBoundingClientRect(), k = r.width / W;
    layer.replaceChildren(...list.map(h => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'hot'; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); b.dataset.act = h.act;
      let [x, y, w, hh] = h.box; const minW = 44 / Math.max(k, 1e-6); if (w < minW) { x -= (minW - w) / 2; w = minW; } if (hh < minW) { y -= (minW - hh) / 2; hh = minW; }
      b.style.left = (x / W * 100) + '%'; b.style.top = (y / H * 100) + '%'; b.style.width = (w / W * 100) + '%'; b.style.height = (hh / H * 100) + '%';
      b.addEventListener('click', () => act(h.act)); return b; }));
  }
  return { init, sync, toLogical, pointer: getPointer, nameValue, setName, renderLower };
})();
