'use strict';
// ============================================================
// content.js: every string the game shows. Edit text here, never in the game code.
//
//   CONTENT.drawn  text drawn by the pencil on the canvas. Only characters the EMS Tech font has
//                  (ASCII, Latin-1 letters; no curly quotes, no ellipsis): tests/web/static-checks.mjs
//                  checks glyph coverage and widths (captions <= 1760 at cap 46, rows <= 540, slips
//                  <= the slip width). Captions: at most 2 lines, about 10 words (kit.js:469-484).
//   CONTENT.html   text for the DOM (panel, buttons, rail, name form, lower sections). Written with
//                  textContent only, so it may use any character.
//   CONTENT.facts  the numbers and identifiers the story is built on (facts.md). Code reads these
//                  instead of repeating them.
//
// Placeholders, replaced at run time (never concatenate the player's name into HTML):
//   {name}  the player's cleaned name (html) or the drawn name (drawn)
//   {slug}  ASCII lower-case letters of the drawn name, up to 12, else "you" (so "{slug}@example.com")
//   {n}     a count
// Keys marked DRAFT were written by the foundation builder; the content writer confirms them.
// Keys without that mark are exact texts from GAME_SPEC.md.
// ============================================================
window.CONTENT = {
  drawn: {
    // Caption ids are what beats list in `captions: [capId, ...]` (see game/story.js, BEAT).
    // lines: 1 or 2 lines; colors: per line {wordIndex: colourKey} as in makeCaption (kit.js:469).
    captions: {
      buy: { lines: ['You order a teapot online.'] },
      broken: { lines: ['It arrives broken.', 'You ask for a refund.'] },
      s1: { lines: ['Behind the scenes,', 'an AI agent handles it.'] },
      s1b: { lines: ['Temporal writes down', 'every finished step.'] },
      s2: { lines: ['He reads your request:', 'Claude step 1.'] },
      s3: { lines: ['Claude pauses', 'at every tool call.'] },
      s4: { lines: ['Temporal runs it,', 'and writes it down.'] },
      s5: { lines: ['He reads the answer', 'and asks for a refund.'] },
      s6: { lines: ['Risky steps', 'wait for a human.'] },
      s6b: { lines: ['You are the manager now.'] },
      s7: { lines: ['The refund gets', 'a fixed receipt number.'] },
      s8: { lines: ['Then the email,', 'and his final answer.'] },
      s9: { lines: ['The refund happens once.'], colors: [{ 3: 'green' }] },
      reject: { lines: ['Rejected: no money moves.', 'The case stays open.'] },
      // the crash sequence (GAME_SPEC §4 "The crash sequence")
      crash: { lines: ['The server crashes.'] },
      crashAgain: { lines: ['The server crashes again.'] },
      notes: { lines: ['Before touching anything,', 'he checks his notes.'] },
      // outcome captions, shown after the notes (GAME_SPEC §4, per stage)
      out1: { lines: ['Your request was already', 'written down.'] },
      out2: { lines: ['Step 1 never finished:', 'it starts over.'] },
      out4: { lines: ['The lookup never finished:', 'it runs again.'] },
      outSkip: { lines: ['It is written down.', 'He skips it.'] },
      out5: { lines: ['Step 2 never finished:', 'it runs again.'] },
      out6: { lines: ['Nothing was running.', 'The approval still waits.'] },
      out7before: { lines: ['The refund runs again', 'with the same number.'] },
      out7money: { lines: ['Same receipt number:', 'still one refund.'] },
      out8email: { lines: ['Same receipt number:', 'still one email.'] },
      out8step3: { lines: ['Step 3 never finished:', 'it runs again.'] },   // DRAFT (spec: "stage 5's crash rules")
      out8step4: { lines: ['Step 4 never finished:', 'it runs again.'] },   // DRAFT
      out9: { lines: ['Everything is written down.', 'Nothing runs again.'] },
    },
    // the notebook rows (GAME_SPEC §3). rowsReject replaces rows 3-4 on the Reject branch.
    rows: ['request', 'look_up_order', 'issue_refund', 'approved', 'email_customer', 'done'],
    rowsReject: { 3: 'rejected', 4: 'done' },
    // tool slips (a8 slips, cast.js:198 slipDrawing). Keys are the `which` of R.wait.
    slips: {
      look_up_order: 'look_up_order',
      answer: '49.99 EUR',
      issue_refund: 'issue_refund',
      refund_id: 'R-0cb_02',
      email_customer: 'email_customer',
    },
    folder: ['A-1001', '49.99 EUR'],          // stageD.js:153-154 already draws these; listed for reference
    stamp: { approved: 'Approved', rejected: 'Rejected' },
    // the player's laptop after stage 9: a new page cloned from D.requested (stageC.js:193-199), lettered
    // at the page's cap 36 / condense .86. The note is two lines so a real name fits the display's text
    // column (880 of 960): lines[0] carries the name, drawn with NAME.fit(.., NAME.BUDGET.mail), whose max
    // is the width left for the NAME ALONE after "Hi ," (game/name.js).
    mail: { title: 'Your refund', lines: ['Hi {name},', 'we refunded 49.99 EUR.'] },
    // start card (a12 layout, cards.js)
    start: { title: 'temporal-claude-agent', sub: 'Durable Claude agents on Temporal' },
    // end card (a12 layout, cards.js). plugs: N >= 2; plugs1: N = 1 (DRAFT); N = 0 shows only `once`.
    end: {
      title: 'temporal-claude-agent',
      plugs: 'You pulled the plug {n} times.',
      plugs1: 'You pulled the plug 1 time.',
      once: { text: 'The refund happened once.', colors: { 3: 'green' } },
      noMoney: 'No money moved.',
      thanks: 'Thanks, {name}',   // the name is fitted to NAME.BUDGET.line: 1500 minus the width of "Thanks, " (game/name.js)
    },
  },

  html: {
    // title and description are also written in index.html (<title>, <h1>, <meta name=description>) as
    // the no-JS fallback; tests/web/static-checks.mjs checks that the copies there equal these.
    title: 'The refund that can\u2019t happen twice',
    description: 'A playable pencil film: a Claude agent running durably on Temporal. Buy a teapot, ask for a refund, approve it, and pull the plug at any moment.',
    noscript: 'This page is a game drawn with JavaScript. Please turn JavaScript on to play.',
    // accessible names of page regions (ui.js sets them at start; index.html has no text of its own)
    aria: {
      game: 'The game', controls: 'Controls', endbar: 'Play again', panel: 'What is happening',
      cases: 'Special cases', findings: 'What we found inside the engine', proven: 'Proven with real Claude',
    },
    lede: 'A playable pencil film of a Claude agent running on Temporal. Buy a teapot, ask for a refund, approve it as the manager, and pull the plug whenever you like.',   // DRAFT
    name: {
      label: 'What\u2019s your name?',
      start: 'Start',
      remember: 'Remember my name on this device',
      privacy: 'Your name stays in this browser. It is never sent anywhere.',
      // reasons shown under the input while Start is disabled (NAME.clean -> reason key)
      invalid: {
        empty: 'Type your name to start.',                                           // DRAFT
        chars: 'Use letters, spaces, apostrophes, dots or hyphens.',                 // DRAFT
        long: 'Please use at most 40 letters.',                                      // DRAFT; must match NAME.MAX (game/name.js)
      },
    },
    // control bar labels (ui.js). `action` keys are the act names of window.__game.act
    buttons: {
      buy: 'Buy', pay: 'Pay', refund: 'Request refund', submit: 'Submit',
      approve: 'Approve', reject: 'Reject', next: 'Next',
      plug: 'Pull the plug', unplug: 'Plug it back in',
      pause: 'Pause', sound: 'Sound', stepMode: 'Stop after each stage',
      playAgain: 'Play again', changeName: 'Change name', tryBreak: 'Try to break it',
    },
    // why a button is disabled (shown as text next to it). DRAFT wording.
    disabled: {
      plugShop: 'The plug is in the server room, behind the scenes.',
      plugWide: 'Wait until you are inside the server room.',
      plugMoving: 'The plug is moving right now.',
      plugNotes: 'He is reading his notes.',
      plugDone: 'The game is over.',
      action: 'Nothing to do right now: watch.',
      queued: 'Your decision is made. It is stamped once the power is back.',
      // a NOTE shown under Approve / Reject while the power is off; the buttons stay enabled (the
      // decision is queued, GAME_SPEC §4 st. 6)
      approveOff: 'The power is off. Your decision waits until it is back.',
    },
    tryBreakHint: 'Pull the plug at any moment. Try it while the slip is still in the air.',   // DRAFT
    // the panel under the controls (ui.js). now[k] / proof[k] are per stage 0..9 (DRAFT; the content
    // writer fills them, true to facts.md §4).
    panel: {
      nowLabel: 'Now:',
      ifPlugLabel: 'If you pull the plug now:',
      notebookLabel: 'Temporal\u2019s notebook',
      historyLabel: 'History',
      now: ['', '', '', '', '', '', '', '', '', ''],
      // ifPlug[k] is keyed by the crash class STORY.crashWhen(G) gives at the current moment (GAME_SPEC §4
      // per stage): 'any' | 'before'/'after' (the commit) | 'money' (stage 7 between t_m and t_c) | 'wait'.
      // Stage 0 is the shop: no plug there (the disabled reason shows instead).
      ifPlug: [
        { any: '' },
        { any: '' },
        { any: '' },
        { before: '', after: '' },
        { before: '', after: '' },
        { before: '', after: '' },
        { wait: '' },
        { before: '', money: '', after: '' },
        { before: '', after: '' },
        { any: '' },
      ],
      proof: ['', '', '', '', '', '', '', '', '', ''],
      // after a crash (in its stage): what happened, keyed by the outcome caption id (CONTENT.drawn.captions).
      // retry: true adds retryNote and retryTable under it (GAME_SPEC §3 "Retries").
      outcome: {
        out1: { text: '', retry: false },
        out2: { text: '', retry: true },
        out4: { text: '', retry: true },
        outSkip: { text: '', retry: false },
        out5: { text: '', retry: true },
        out6: { text: '', retry: false },
        out7before: { text: '', retry: true },
        out7money: { text: '', retry: true },
        out8email: { text: '', retry: true },
        out8step3: { text: '', retry: true },
        out8step4: { text: '', retry: true },
        out9: { text: '', retry: false },
      },
      wait: 'Nothing is written while it waits. Only manager@shop.example may approve: a validated Update.',
      // facts.md §3 lists this among the history lines, but it is a note, not an event: nothing is
      // written, so it never goes into G.events or tests/web/fixtures/history-approved.json.
      waitNote: '(nothing is written while it waits for approval)',
      untestedWait: 'A crash while it waits is not covered by a test; it holds by design.',          // DRAFT
      noLookupTest: 'No test crashes during the lookup itself.',                                     // DRAFT
      retryNote: 'In real life Temporal first waits for a timeout before it retries. The game skips that wait.',   // DRAFT
      retryTable: {
        head: ['Retried thing', 'Demo timeout', 'Default'],
        rows: [['Claude step (heartbeat)', '5 s', '2 min'], ['Tool (start-to-close)', '10 s', '1 min']],
      },
    },
    // History lines for the panel and the tests (GAME_SPEC §3, facts.md §3). Exact texts.
    events: {
      started: 'Workflow started: "Order A-1001 arrived broken, I want my money back."',
      step1Scheduled: 'Claude step 1 scheduled',
      step1Done: 'Claude step 1 done: wants look_up_order (A-1001)',
      lookupScheduled: 'look_up_order scheduled, ID tool-toolu_d1afa0cb_01',
      lookupDone: 'look_up_order done: Ceramic teapot, 49.99 EUR, {slug}@example.com',
      step2Done: 'Claude step 2 done: wants issue_refund (A-1001, 49.99, "item arrived broken")',
      approved: 'Approved by manager@shop.example (a validated Update)',
      rejected: 'Rejected by manager@shop.example',
      refundScheduled: 'issue_refund scheduled, ID tool-toolu_d1afa0cb_02 (also the receipt number)',   // §3's wording (GAME_SPEC.md:241), also in the fixture
      refundDone: 'issue_refund done: refund R-0cb_02',
      step3Done: 'Claude step 3 done: wants email_customer',
      emailDone: 'email_customer done',
      step4Done: 'Claude step 4 done: "Done. Refunded 49.99 EUR for order A-1001 (refund R-0cb_02) and emailed {slug}@example.com."',
      step3Reject: 'Claude step 3 done: "The refund was not approved, so no money was moved. The case stays open for review."',
      completed: 'Workflow completed',
      // a retried Activity: "{what} started again (attempt {n})", e.g. "Claude step 1 started again (attempt 2)"
      retry: '{what} started again (attempt {n})',
    },
    rail: {
      label: 'Stages',
      shop: 'Shop',
      stages: ['Request', 'Claude step 1', 'Claude pauses', 'Temporal runs the tool', 'Claude continues', 'You approve', 'The refund', 'Email and answer', 'Done'],   // DRAFT short names, stages 1..9
      crashedBefore: 'crashed before',
      crashedAfter: 'crashed after',
    },
    // lower sections (GAME_SPEC §5), rendered by ui.js into #lower. DRAFT except the exact quotes.
    lower: {
      cases: {
        title: 'Special cases',
        intro: 'Real agents don\u2019t always follow the happy path.',
        items: [
          { title: 'Claude asks for two tools at once', text: 'The engine can only pause one call. The first pauses; the second gets this message: "Only one tool call can run at a time. Your other tool call is running now. Call this tool again after you get that result." Claude asks again after the first result.' },
          { title: 'A tool fails', text: 'An unknown order makes the lookup fail. Claude gets "Tool failed: No order with id Z-9999" as the tool result and explains instead of guessing. No refund is made.' },
          { title: 'The manager says no', text: 'Claude is told the refund was rejected and asked not to retry it. No money moves. If it did retry, the new call would need approval again.' },
          { title: 'The manager answers in two days', text: 'The wait lives in Temporal, not in a running program. This holds by design; no test waits that long.' },
        ],
      },
      findings: {
        title: 'What we found inside the engine',
        intro: 'The Claude engine is closed source, so we tested it until it broke, then worked around each problem.',
        items: [
          ['After it had allowed a paused call, the engine\u2019s automatic resume ignored the next pause.', 'Hand the saved result back as a normal message. Our hook always says pause.'],
          ['Rewinding a conversation after a crash broke the paused state.', 'A plain resume after a crash, which works even on a different machine.'],
          ['With two tools asked at once, the engine kept one and silently dropped the other.', 'The first pauses; the second is told to wait and is asked for again.'],
          ['On every resume, the engine announces the call we just answered again.', 'We recognize the repeat and ignore it.'],
          ['A Claude app login cannot renew itself when a paused session resumes.', 'A long-lived login token, an API key, or Amazon Bedrock.'],
          ['Opus 5.5 needs a newer engine than the one inside the SDK.', 'Point the package at Claude Code 2.1.280 with one setting.'],
        ],
      },
      proven: {
        title: 'Proven with real Claude',
        text: [
          'Eight scenarios, 2 runs each, on Haiku 4.5, Sonnet 5, Opus 5.5 and Fable 5.1: 2 of 2 each, 16 of 16 per model.',
          'Opus 5.5 ran on Claude Code 2.1.280.',
          '12 automated tests, 4 of which kill a worker.',
          'The same eight pass through Amazon Bedrock with a stand-in model.',
        ],
      },
    },
    footer: {
      text: 'temporal-claude-agent, built in Python by Osamah Al-Harazi. Temporal and Claude marks belong to Temporal Technologies and Anthropic; this is a community project, not affiliated with or endorsed by either.',
      licences: 'Licences and credits',
    },
  },

  facts: {
    order: 'A-1001',
    item: 'Ceramic teapot',
    amount: '49.99 EUR',
    request: 'Order A-1001 arrived broken, I want my money back.',
    toolIds: { lookup: 'tool-toolu_d1afa0cb_01', refund: 'tool-toolu_d1afa0cb_02', email: 'tool-toolu_d1afa0cb_03' },
    refundId: 'R-0cb_02',
    approver: 'manager@shop.example',
    rejectMessage: 'A human reviewer rejected this action. Do not retry it.',
    finalApproved: 'Done. Refunded 49.99 EUR for order A-1001 (refund R-0cb_02) and emailed {slug}@example.com.',
    finalRejected: 'The refund was not approved, so no money was moved. The case stays open for review.',
    timeouts: { heartbeatDemo: 5, heartbeatDefault: 120, toolDemo: 10, toolDefault: 60 },   // seconds
    models: ['Haiku 4.5', 'Sonnet 5', 'Opus 5.5', 'Fable 5.1'],
    scenarios: 8, runsPerScenario: 2, tests: 12, killTests: 4,
    proofs: {
      2: 'tests/test_crash.py:113 (test_crash_in_the_middle_of_a_claude_segment)',
      3: 'pause_resume (real-Claude matrix) proves the pause only',
      5: 'crash_mid_answer (real-Claude matrix) and spike/m1_checks.py:91-111',
      6: 'tests/test_agent.py:49, :59, :89; matrix refund_approved / refund_rejected',
      7: 'tests/test_crash.py:91 (money moved, before the reply); tests/test_crash.py:66, matrix crash_after_refund, tests/test_real_engine.py:21 (after)',
    },
  },
};
