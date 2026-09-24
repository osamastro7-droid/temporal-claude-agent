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
//   #controls      #btn-action + #btn-alt (Reject next to Approve) + #why-action (reason or note; aria-live),
//                  #ready-sr (visually hidden, aria-live: "<action> is ready." when an action becomes live),
//                  #btn-plug + #why-plug, #ctl-if (the panel's "If you pull the plug now" + outcome, repeated under
//                  the plug for the narrow layout; aria-hidden)
//   #toggles       outside #controls so it shows on every scene: #btn-pause, #btn-sound, #btn-step,
//                  #btn-reduced, #btn-keys (single-key shortcuts on/off, WCAG 2.1.4)
//   #endbar        #btn-again, #btn-rename, #btn-break      #status   role=status: the current caption
//   #rail          nav > ol (Shop chip, chips 1-9)          #panel    #p-title (sr h2), #p-now, #p-if, #p-proof, #p-note,
//                  #p-retry-note, #p-retry (table: thead > tr, tbody), #p-book (+ #p-book-note), #p-history,
//                  #p-who (the exact typed name, with #p-who-label)
//   #lower         #sec-cases, #sec-findings, #sec-proven   #footer   #footer-text, #footer-lic
//   #page-title    the h1 (its markup text is the no-JS fallback; set from CONTENT.html.title)
//   #lede          the line under the h1 (CONTENT.html.lede)     #keys   dl: the keyboard legend (CONTENT.html.ui.keys)
//   #game[data-scene], <html>[data-reduced]: set by UI.sync for map.css (the rail and the control bar hide on
//                  the start card; the page's own motion stops under reduced motion, toggle or media query).
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
  /** Single-key shortcuts (P, A, R) on or off (#btn-keys, WCAG 2.1.4). Space and Enter are not affected. */
  let keysOn = true;
  /** Focus that ui.js itself moved to #btn-action right after a POINTER action (a mouse click on Start, the
   *  plug, a toggle or a rail chip) shows no ring. The player did not choose it, so Space on it pauses, as the
   *  legend says, instead of pressing the button; and Enter on it, while it holds a decision (Approve / Reject),
   *  is 'next' (the legend's Enter), never an unseen approval. Enter on a quiet Buy / Pay / Submit / Next still
   *  presses it. Only #btn-action is ever quiet (the end card's "Play again" keeps its own Space and Enter).
   *  Keyboard-moved focus, or any later focus change (Tab), clears it. :focus-visible cannot tell: Chromium
   *  reports it true inside a capture keydown listener. */
  let viaPointer = false, quietEl = null;
  const moveFocus = el => { if (document.activeElement === el) return; el.focus({ preventScroll: true }); quietEl = viaPointer && el.id === 'btn-action' ? el : null; };
  /** The game is on screen: at least a fifth of the canvas is in the viewport (the canvas, not the whole #game
   *  section: at 1440 the panel beside it reaches far below the fold). While the reader is elsewhere, the loose
   *  keys (focus on <body> or outside #game) do nothing, so Space scrolls the page as usual. Measured at the
   *  keydown (one rect read), so it is right even just after a scroll. */
  const gameSeen = () => { const r = cv.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
    return r.height > 0 && (Math.min(r.bottom, vh) - Math.max(r.top, 0)) >= r.height / 5; };
  /** The label of the live action last announced in #ready-sr ('' = none live). */
  let readyLabel = '';
  const T = () => CONTENT.html;
  /** set textContent only when it changed (UI.sync runs every frame) */
  const text = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
  const attr = (el, k, v) => { if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); };
  const pressed = (el, on) => attr(el, 'aria-pressed', on ? 'true' : 'false');
  const off = (el, isOff) => attr(el, 'aria-disabled', isOff ? 'true' : 'false');
  const isOff = el => el.getAttribute('aria-disabled') === 'true';
  const gone = el => !el || !el.isConnected || !!el.closest('[hidden]') || !!el.disabled;
  /** After a MOUSE click (detail > 0) on the plug, a toggle or a rail chip, put the focus back on the action
   *  button (no scroll), so Enter / Space / the letters then do what the legend says instead of pressing
   *  that button again. Keyboard activation (detail 0) keeps the native focus. */
  const refocus = e => { if (e.detail > 0 && !$('controls').hidden) moveFocus($('btn-action')); };

  /**
   * Bind everything once (runtime.js at DOMContentLoaded).
   * @param {{act: (name: string) => void}} h  runtime's act(): the one entry point for player actions
   *   (the act list is in runtime.js's header).
   */
  function init(h) {
    act = h.act; cv = $('cv');
    const B = T().buttons, A = T().aria;
    const U = T().ui ?? {};
    text($('page-title'), T().title); text($('lede'), T().lede ?? '');
    for (const [id, k] of [['game', 'game'], ['controls', 'controls'], ['endbar', 'endbar'], ['sec-cases', 'cases'], ['sec-findings', 'findings'], ['sec-proven', 'proven']]) attr($(id), 'aria-label', A[k]);
    text($('p-title'), A.panel);                                            // the panel's own (visually hidden) h2
    if (U.toggles) attr($('toggles'), 'aria-label', U.toggles);
    text($('btn-pause'), B.pause); text($('btn-sound'), B.sound); text($('btn-step'), B.stepMode); text($('btn-reduced'), U.reduced ?? ''); text($('btn-keys'), U.keysToggle ?? '');
    text($('keys-label'), U.keysLabel ?? '');
    // a single-letter key (P, A, R) is a shortcut #btn-keys turns off: its row is marked (map.css .off) and gets
    // CONTENT.html.ui.keysOff after its words while the shortcuts are off (keysLegend)
    $('keys').replaceChildren(...(U.keys ?? []).flatMap(([k, what]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'), kb = document.createElement('kbd'), w = document.createElement('span'), o = document.createElement('span');
      kb.textContent = k; dt.append(kb); w.textContent = what; o.className = 'key-off'; dd.append(w, o);
      if (/^[a-z]$/i.test(k)) { dt.dataset.letter = dd.dataset.letter = k; } return [dt, dd]; }));
    text($('btn-again'), B.playAgain); text($('btn-rename'), B.changeName); text($('btn-break'), B.tryBreak);
    // After a MOUSE click (detail > 0) on the plug or a toggle, the focus goes back to the action button, so
    // Enter / Space / the letters then do what the legend says instead of pressing that button again.
    // Keyboard activation (detail 0) keeps the native focus.
    const bind = (id, fallback) => { const el = $(id); el.addEventListener('click', e => { if (id === 'btn-plug') refocus(e); if (isOff(el)) return; const a = el.dataset.act || fallback; if (a) act(a); }); };
    bind('btn-action'); bind('btn-alt'); bind('btn-plug', 'plug');
    const toggle = (id, a) => $(id).addEventListener('click', e => { act(a); refocus(e); });
    toggle('btn-pause', 'pause'); toggle('btn-sound', 'sound'); toggle('btn-step', 'step');
    toggle('btn-reduced', 'reduced');                                     // runtime toggles G.settings.reduced
    $('btn-keys').addEventListener('click', e => { keysOn = !keysOn; pressed($('btn-keys'), keysOn); keysLegend(); refocus(e); });
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
    // keys (GAME_SPEC §2): letters are ignored while a text field has focus, and while #btn-keys is off;
    // Space and Enter are left to any focused control (a button, the checkbox, a link) so they keep their
    // own meaning, except Space on a control-bar button that does nothing right now (aria-disabled): that
    // one pauses, as the legend says (the focus rests on #btn-action while the beats play), and Space (and
    // Enter on Approve / Reject) on focus that ui.js moved after a pointer action (quietEl, see moveFocus).
    // Nothing acts while the game is off screen and the focus is outside it (gameSeen).
    let spaceUp = false;
    document.addEventListener('pointerdown', () => { viaPointer = true; }, true);
    document.addEventListener('keydown', () => { viaPointer = false; }, true);
    document.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || e.isComposing) return;
      const t = e.target instanceof Element ? e.target : null, tag = t ? t.tagName : '';
      const textEntry = !!t && (t.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset)$/i.test(t.type)));
      if (textEntry) return;
      // reading below the game (it is off screen, the focus is not in it): Space scrolls, the keys do nothing
      if (!(t && $('game').contains(t)) && !gameSeen()) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!keysOn && /^[a-z]$/.test(k)) return;                          // single-key shortcuts turned off
      const idle = !!t && tag === 'BUTTON' && isOff(t) && !!t.closest('#controls');
      // quiet focus (see moveFocus): Space pauses; Enter is 'next' on a decision (Approve / Reject: act('next')
      // does nothing at the approval hold), and still presses a quiet Buy / Pay / Submit / Next
      const decides = !!t && /^(approve|reject)$/.test(t.dataset.act || '');
      const quiet = !!t && t === quietEl && (k === ' ' || (k === 'Enter' && decides));
      const control = !idle && !quiet && !!t && (/^(INPUT|BUTTON|A|SELECT|TEXTAREA|SUMMARY)$/.test(tag) || t.hasAttribute('tabindex'));
      if (e.repeat && k !== ' ') { if (k === 'p' || k === 'Enter' && !control) e.preventDefault(); return; }   // a held key acts once
      if (k === 'p') { const b = $('btn-plug'); if (!b.closest('[hidden]') && !isOff(b)) act(b.dataset.act || 'plug'); e.preventDefault(); }
      else if (k === 'a') act('approve');
      else if (k === 'r') act('reject');
      else if (k === ' ' && !control) { e.preventDefault(); if (!e.repeat) act('pause'); spaceUp = idle || quiet; }
      else if (k === 'Enter' && !control) { if (idle || quiet) e.preventDefault(); act('next'); }
    });
    // a button activates on Space's keyup: swallow the keyup of a Space that paused
    document.addEventListener('keyup', e => { if (e.key === ' ' && spaceUp) { spaceUp = false; e.preventDefault(); } });
    document.addEventListener('focusin', e => { lastFocus = e.target; if (e.target !== quietEl) quietEl = null; });
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
      b.addEventListener('click', e => { act('rail:' + k); refocus(e); }); li.append(b); ol.append(li); };
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
    $('nameform').hidden = !start; $('controls').hidden = start || end; $('endbar').hidden = !end;
    attr($('game'), 'data-scene', G.scene); attr($('game'), 'data-phase', G.worker.phase);
    attr(document.documentElement, 'data-reduced', G.settings.reduced ? 'true' : 'false');
    const a = V.action, ba = $('btn-action'), alt = $('btn-alt');
    text(ba, B[a.label] ?? a.label); off(ba, !a.enabled); ba.dataset.act = a.act ?? '';
    alt.hidden = !a.alt; if (a.alt) { text(alt, B[a.alt.label] ?? a.alt.label); off(alt, !a.alt.enabled); alt.dataset.act = a.alt.act; } else alt.dataset.act = '';
    text($('why-action'), a.enabled ? (a.note ? D[a.note] ?? '' : '') : D[a.reason] ?? '');
    // screen readers: say once that an action can now be pressed (the button's name changes silently)
    const live = a.enabled && !start && !end ? (B[a.label] ?? a.label ?? '') : '';
    if (live !== readyLabel) { readyLabel = live; text($('ready-sr'), live ? (D.ready ?? '{label}').replace('{label}', live) : ''); }
    const dark = G.worker.phase === 'dark', bp = $('btn-plug');
    // pressed = the plug is out (not while he wakes)
    text(bp, dark ? B.unplug : B.plug); pressed(bp, ['pulling', 'dark', 'pushing'].includes(G.worker.phase)); bp.dataset.act = dark ? 'unplug' : 'plug';
    off(bp, !V.plug.ok); text($('why-plug'), V.plug.ok ? '' : D[V.plug.reason] ?? '');
    pressed($('btn-pause'), G.settings.paused); pressed($('btn-sound'), G.settings.sound); pressed($('btn-step'), G.settings.stepMode); pressed($('btn-reduced'), G.settings.reduced);
    if (last.caption !== V.caption) { last.caption = V.caption; text($('status'), V.caption); }
    const P = V.panel, Pl = T().panel;
    text($('p-now-label'), Pl.nowLabel); text($('p-now'), P.now); text($('p-if-label'), Pl.ifPlugLabel); text($('p-if'), P.ifPlug); text($('p-proof'), P.proof);
    text($('p-note'), P.note ? P.note.text : ''); text($('p-retry-note'), P.note ? P.note.retryNote : ''); table($('p-retry'), P.note && P.note.table);
    // the same prediction and outcome under the plug, for the layout where the panel is below the canvas (map.css)
    const ci = $('ctl-if'), cIf = $('c-if'), noteText = P.note ? P.note.text : '';
    text($('c-if-label'), Pl.ifPlugLabel); text($('c-if-text'), P.ifPlug); text($('c-note'), noteText);
    if (cIf.hidden !== !P.ifPlug) cIf.hidden = !P.ifPlug;
    if (ci.hidden !== !(P.ifPlug || noteText)) ci.hidden = !(P.ifPlug || noteText);
    // the exact typed name (GAME_SPEC §0: the pencil may draw "Lukasz", the panel says "Łukasz"), textContent only
    text($('p-who-label'), Pl.playerLabel ?? ''); text($('p-who'), G.name ?? '');
    text($('p-book-label'), Pl.notebookLabel); text($('p-book-note'), Pl.notebookNote ?? ''); text($('p-history-label'), Pl.historyLabel);
    // STORY.panel lists the rows whose text is written, in order; G.book says which of them are struck
    const struck = G.book.filter(r => r.t).map(r => !!r.strike);
    list($('p-book'), P.notebook, struck.length === P.notebook.length ? struck : null); list($('p-history'), P.history);
    waitNote(G);
    // a box with nothing to say is hidden (its label too); the keyboard legend always shows
    for (const [sel, empty] of [['.who-box', !G.name], ['.now-box', !P.now], ['.if-box', !P.ifPlug], ['.book-box', !P.notebook.length], ['.history-box', !P.history.length]]) { const el = $('panel').querySelector(sel); if (el.hidden !== empty) el.hidden = empty; }
    rail(G, V.crashes ?? [], start);
    hotspots(V.hotspots);
    focus(G);
  }
  /**
   * GAME_SPEC §3 "HTML panel lines": "(nothing is written while it waits for approval)" between "Claude step 2
   * done" and "Approved by ...". It is a NOTE, not an event (never in G.events or the fixtures), so it is not
   * an <li>: the step-2 line carries it (data-note, drawn by map.css as a line of its own under it; CSS generated
   * text is read by screen readers). Shown while it waits and after the decision.
   */
  function waitNote(G) {
    const key = (T().events ?? {}).step2Done, note = T().panel.waitNote ?? '';
    const on = !!(key && note && G.approval && (G.approval.waiting || G.approval.decision));
    let marked = false;
    for (const li of [...$('p-history').children].reverse()) {
      const want = on && !marked && li.textContent === key; if (want) marked = true;
      if (want) { attr(li, 'data-note', note); if (!li.classList.contains('wait')) li.classList.add('wait'); }
      else if (li.classList.contains('wait')) { li.classList.remove('wait'); li.removeAttribute('data-note'); }
    }
  }
  /** Mark the single-letter rows of the keyboard legend while #btn-keys is off (class 'off' + CONTENT.html.ui.keysOff). */
  function keysLegend() {
    const word = (T().ui ?? {}).keysOff ?? '';
    for (const el of $('keys').querySelectorAll('[data-letter]')) {
      el.classList.toggle('off', !keysOn);
      if (el.tagName === 'DD') text(el.querySelector('.key-off'), keysOn || !word ? '' : ' ' + word);
    }
  }
  function rail(G, crashes, start) {
    const R = T().rail;
    for (const b of $('rail').querySelectorAll('button')) {
      const k = +b.dataset.k, cur = k === G.stage && !start ? 'step' : null;
      if ((b.getAttribute('aria-current') ?? null) !== cur) { if (cur) b.setAttribute('aria-current', cur); else b.removeAttribute('aria-current'); }
      // one span per kind ("crashed before, " / "crashed after"), so two kinds break into two lines, not three
      const words = [...new Set(crashes.filter(c => c.stage === k).map(c => R[c.mark] ?? ''))].filter(Boolean), m = b.querySelector('.chip-crash');
      if (m.dataset.key !== words.join(', ')) { m.dataset.key = words.join(', ');
        m.replaceChildren(...words.map((w, i) => { const sp = document.createElement('span'); sp.textContent = i < words.length - 1 ? w + ', ' : w; return sp; })); }
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
    // a hotspot never takes the focus (mousedown is prevented), but if one had it, losing it leaves the focus where it was
    const hot = !!(lastFocus && lastFocus.classList && lastFocus.classList.contains('hot'));
    if ((group !== prev && (lost || ours)) || (lost && lastFocus && gone(lastFocus) && !hot)) moveFocus(target);
  }
  /**
   * Replace an <ol>'s items only when the list changed. A struck row (a notebook line Temporal crossed out,
   * GAME_SPEC §4 st. 6 reject) is an <s> plus a visually hidden CONTENT.html.panel.struck for screen readers.
   * @param {HTMLOListElement} ol @param {string[]} items @param {boolean[]|null=} struck  per item
   */
  function list(ol, items, struck = null) {
    const key = items.map((s, i) => (struck && struck[i] ? '~' : '') + s).join('\n'); if (ol.dataset.key === key) return; ol.dataset.key = key;
    ol.replaceChildren(...items.map((s, i) => {
      const li = document.createElement('li');
      if (struck && struck[i]) { li.className = 'struck'; const x = document.createElement('s'), sr = document.createElement('span'); x.textContent = s; sr.className = 'sr'; sr.textContent = ' ' + (T().panel.struck ?? ''); li.append(x, sr); }
      else li.textContent = s;
      return li; }));
  }
  /**
   * Place the hotspot buttons (GAME_SPEC §2): <button aria-hidden="true" tabindex="-1">, >= 44x44 css px,
   * positioned in % of the canvas box. @param {{act: string, box: number[]}[]} list  screen boxes
   */
  function hotspots(list) {
    const r = cv.getBoundingClientRect(), k = r.width / W;   // css px per screen unit (the 44 px minimum depends on it)
    const key = JSON.stringify([Math.round(r.width), list.map(h => [h.act, h.box.map(v => Math.round(v))])]); if (last.hot === key) return; last.hot = key;
    const layer = $('hotspots');
    layer.replaceChildren(...list.map(h => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'hot'; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); b.dataset.act = h.act;
      let [x, y, w, hh] = h.box; const minW = 44 / Math.max(k, 1e-6); if (w < minW) { x -= (minW - w) / 2; w = minW; } if (hh < minW) { y -= (minW - hh) / 2; hh = minW; }
      b.style.left = (x / W * 100) + '%'; b.style.top = (y / H * 100) + '%'; b.style.width = (w / W * 100) + '%'; b.style.height = (hh / H * 100) + '%';
      b.addEventListener('mousedown', e => e.preventDefault());           // a click must not move the focus (Space = pause)
      b.addEventListener('click', () => act(h.act)); return b; }));
  }
  return { init, sync, toLogical, pointer: getPointer, nameValue, setName, renderLower };
})();
