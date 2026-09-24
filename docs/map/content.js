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
// Exact texts from GAME_SPEC.md are kept word for word; every other sentence is checked against the
// code (src/, tests/, spike/, examples/) and facts.md.
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
      out8step3: { lines: ['Step 3 never finished:', 'it runs again.'] },   // steps 3-4 follow stage 5's crash rules
      out8step4: { lines: ['Step 4 never finished:', 'it runs again.'] },
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
    bookCover: 'Temporal',                    // the desk notebook's cover while he lifts it (a9.js:120), game/room.js
    // the player's laptop after stage 9: a new page cloned from D.requested (stageC.js:193-199), lettered
    // at the page's cap 36 / condense .86. The note is two lines so a real name fits the display's text
    // column (880 of 960): lines[0] carries the name, drawn with NAME.fit(.., NAME.BUDGET.mail), whose max
    // is the width left for the NAME ALONE after "Hi ," (game/name.js).
    mail: { title: 'Your refund', lines: ['Hi {name},', 'we refunded 49.99 EUR.'] },
    // start card (a12 layout, cards.js)
    start: { title: 'temporal-claude-agent', sub: 'Durable Claude agents on Temporal' },
    // end card (a12 layout, cards.js). plugs: N >= 2; plugs1: N = 1; N = 0 shows only `once`.
    end: {
      title: 'temporal-claude-agent',
      plugs: 'You pulled the plug {n} times.',
      plugs1: 'You pulled the plug one time.',   // a word, not "1": in the EMS Tech font the digit 1 reads as a capital I
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
    lede: 'A playable pencil film of a Claude agent running on Temporal. Buy a teapot, ask for a refund, approve it as the manager, and pull the plug whenever you like.',
    name: {
      label: 'What\u2019s your name?',
      start: 'Start',
      remember: 'Remember my name on this device',
      privacy: 'Your name stays in this browser. It is never sent anywhere.',
      // reasons shown under the input while Start is disabled (NAME.clean -> reason key)
      invalid: {
        empty: 'Type your name to start.',
        chars: 'Use letters, spaces, apostrophes, dots or hyphens.',
        long: 'Please use at most 40 letters.',                                      // must match NAME.MAX (game/name.js)
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
    // why a button is disabled (shown as text next to it).
    disabled: {
      plugShop: 'No plug here: it is in the server room, behind the scenes.',
      plugWide: 'Wait until you are inside the server room.',
      plugMoving: 'The plug is moving right now.',
      plugNotes: 'Wait: he is reading his notes.',
      plugDone: 'The story is over: everything is written down.',
      action: 'Nothing to do right now: watch.',
      queued: 'Your decision is made. It is stamped once the power is back.',
      // a NOTE shown under Approve / Reject while the power is off; the buttons stay enabled (the
      // decision is queued, GAME_SPEC §4 st. 6)
      approveOff: 'The power is off. Your decision waits until it is back.',
    },
    tryBreakHint: 'Pull the plug at any moment (or press P). Try it while the slip is still in the air.',
    // the panel under the controls (ui.js). now[k] / proof[k] are per stage 0..9, true to
    // facts.md §4.
    panel: {
      nowLabel: 'Now:',
      ifPlugLabel: 'If you pull the plug now:',
      notebookLabel: 'Temporal\u2019s notebook',
      historyLabel: 'History',
      // now[k]: what happens in stage k (0 = the shop). Every sentence is checked against the code; the
      // evidence list is in the content writer's report.
      now: [
        'You are the customer. Buy the teapot, then ask for your money back.',
        'Your request reaches the server. Temporal starts a workflow and writes your request down first.',
        'A worker runs Claude step 1: Claude reads your request. Each Claude step is one Temporal Activity.',
        'Claude wants to look up your order, but he never runs a tool himself. He pauses, and Temporal writes down what he wants.',
        'Temporal runs look_up_order as its own Activity, with a fixed ID, and writes down the answer.',
        'Claude step 2 picks up the same conversation. The saved answer goes back to Claude, and he asks for issue_refund.',
        'issue_refund needs a human. Nothing is written while it waits. Only manager@shop.example may approve: a validated Update. You are the manager: approve or reject.',   // GAME_SPEC §4 st. 6 panel text, then the player's cue
        'Temporal runs issue_refund. Its fixed ID goes to the shop as the receipt number, so the shop makes the refund only once.',
        'Claude step 3 asks for email_customer, and Temporal sends the email with its own fixed ID. Then Claude step 4 writes the final answer.',
        'The workflow is complete: 4 Claude steps, one refund, one email. Everything is written down, so nothing runs again.',   // not "each tool ran once": after a crash a tool can run twice (test_crash.py:109); the money moves once
      ],
      // ifPlug[k] is keyed by the crash class STORY.crashWhen(G) gives at the current moment (GAME_SPEC §4
      // per stage): 'any' | 'before'/'after' (the commit) | 'money' (stage 7 between t_m and t_c) | 'wait'.
      // Stage 0 is the shop: no plug there (the disabled reason shows instead).
      ifPlug: [
        { any: 'There is no plug in the shop. It is in the server room, behind the scenes.' },
        { any: 'Nothing is lost. Your request is already written down, so a new worker picks it up.' },
        { any: 'Step 1 has not finished. It starts over from your request, in a clean new conversation. No tool has run yet.' },
        { before: 'Step 1 is not written down yet. The slip drops, and step 1 starts over from your request.',
          after: 'Step 1 is written down: look_up_order waits in the notebook. Nothing runs again.' },
        { before: 'The lookup is not written down yet. Temporal runs it again with the same ID. Looking up an order twice does no harm.',
          after: 'The lookup’s answer is written down. It never runs again: the new worker reads the saved answer.' },
        { before: 'Step 2 has not finished. It runs again and picks up the same conversation. The saved answer is not lost.',
          after: 'Step 2 is written down: issue_refund waits in the notebook. Step 2 never runs again.' },
        { wait: 'Nothing is running, so nothing is lost: the approval still waits. A decision made while the power is off is written once a worker is back.' },
        { before: 'The refund has not finished. Temporal runs it again with the same receipt number, so the shop still makes one refund.',
          money: 'The shop has made the refund, but the answer is not saved yet. The retry uses the same receipt number, so the shop returns the refund it already made: still one refund.',
          after: 'The refund is written down. It never runs again.' },
        // one text for s8.step3, s8.email and s8.step4: true at all three. The email's key is its own Activity
        // ID tool-toolu_d1afa0cb_03 (activities.py:49, _workflow.py:174), not the refund's receipt number.
        { before: 'This step is not written down yet, so it runs again. A Claude step picks up the same conversation. The email tool keeps its own fixed ID, so the shop still keeps one email.',
          after: 'This step is written down. It never runs again.' },
        { any: 'Everything is written down. Nothing runs again.' },
      ],
      // proof[k]: which tests prove stage k (test names, no line numbers), or why there is none
      proof: [
        'The shop is story: the code has no shop page and no customer name. A script sends the request, and the customer is an email address.',
        'No test crashes here, and none is needed: the request is the first line Temporal writes.',
        'Tested: test_crash_in_the_middle_of_a_claude_segment kills the worker during step 1 (with a scripted Claude). Each tool still runs once.',
        'Tested with real Claude: pause_resume proves the pause. It does not crash; a crash here follows the rules of stage 2.',
        'No test crashes during the lookup itself. The same retry rule is tested on the refund in stage 7.',
        'Tested with real Claude: crash_mid_answer stops the engine in the middle of step 2, and the retry finishes the job (also check 4 in spike/m1_checks.py).',
        'Tested: test_approved_refund_runs_each_tool_once, test_rejected_refund_moves_no_money, test_only_an_allowed_approver_can_approve, and with real Claude refund_approved and refund_rejected. A crash while it waits is not covered by a test; it holds by design.',
        'Tested: test_crash_after_money_moved_but_before_the_reply (2 runs, 1 refund), test_crash_right_after_refund_is_recorded, test_real_engine_refund_with_approval_and_crash, and with real Claude crash_after_refund.',
        'No test crashes during the email or steps 3 and 4; the same rules are tested in stages 2, 5 and 7. Only the delivery is pretend: the demo shop writes the email to a file.',
        'Tested: test_approved_refund_runs_each_tool_once and test_real_engine_refund_with_approval_and_crash check the end: 4 Claude steps, each tool once, 1 refund.',
      ],
      // the Reject branch (after you press Reject): these replace now / ifPlug / proof of the stage it plays in.
      // ifPlug is keyed by crash class like above ('before'/'after' Claude step 3's commit, else 'any').
      reject: {
        now: 'You rejected the refund, so issue_refund never runs. Claude step 3 is told "A human reviewer rejected this action. Do not retry it." and writes the final answer.',
        ifPlug: {
          before: 'Step 3 has not finished. It runs again and picks up the same conversation. No money moves either way.',
          // also shown during the Reject stamp (s6.stampR is 'after' once "rejected" is written, before step 3 runs)
          after: 'Everything so far is written down, so none of it runs again. No money moved.',
          any: 'Everything is written down. Nothing runs again, and no money moved.',
        },
        proof: 'Tested: test_rejected_refund_moves_no_money, and with real Claude refund_rejected: the refund never runs and no money moves.',
      },
      // after a crash (in its stage): what happened, keyed by the outcome caption id (CONTENT.drawn.captions).
      // retry: true adds retryNote and retryTable under it (GAME_SPEC §3 "Retries").
      outcome: {
        out1: { text: 'Your request was written down before the crash. The new worker read it and carried on.', retry: false },
        out2: { text: 'Step 1 had not finished. Temporal started it again (attempt 2), in a clean new conversation, from your request.', retry: true },
        out4: { text: 'The lookup had not been written down. Temporal ran it again (attempt 2) with the same ID. Looking up an order twice does no harm.', retry: true },
        outSkip: { text: 'That step was already written down. The new worker read the saved result and did not run it again.', retry: false },
        out5: { text: 'Step 2 had not finished. It ran again (attempt 2) and picked up the same conversation, with the saved answer.', retry: true },
        out6: { text: 'Nothing was running while it waited, so nothing was lost. The approval still waits for the manager.', retry: false },
        out7before: { text: 'The refund had not finished. Temporal ran it again (attempt 2) with the same receipt number. 2 runs, 1 refund.', retry: true },
        out7money: { text: 'The shop had made the refund, but the answer was not saved. The retry (attempt 2) used the same receipt number, so the shop returned the refund it already made. 2 runs, 1 refund.', retry: true },
        out8email: { text: 'The email had not been written down. It ran again (attempt 2) with the same receipt number, so the shop kept one email.', retry: true },
        out8step3: { text: 'Step 3 had not finished. It ran again (attempt 2) and picked up the same conversation.', retry: true },
        out8step4: { text: 'Step 4 had not finished. It ran again (attempt 2) and picked up the same conversation.', retry: true },
        out9: { text: 'Everything was already written down. Nothing ran again.', retry: false },
      },
      wait: 'Nothing is written while it waits. Only manager@shop.example may approve: a validated Update.',
      // facts.md §3 lists this among the history lines, but it is a note, not an event: nothing is
      // written, so it never goes into G.events or tests/web/fixtures/history-approved.json.
      waitNote: '(nothing is written while it waits for approval)',
      untestedWait: 'A crash while it waits is not covered by a test; it holds by design.',
      noLookupTest: 'No test crashes during the lookup itself.',
      // a line under the notebook label (GAME_SPEC §5: "survives a worker crash", not "any crash")
      notebookNote: 'The workflow history. Every finished step is written here and survives a worker crash.',
      retryNote: 'In real life Temporal first waits for a timeout, to notice that the worker is gone. The game skips that wait.',
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
    // the {what} of events.retry, per Activity (game/story.js run(): the attempts in G.world.attempts)
    retryWhat: { step1: 'Claude step 1', lookup: 'look_up_order', step2: 'Claude step 2', refund: 'issue_refund', step3: 'Claude step 3', email: 'email_customer', step4: 'Claude step 4' },
    rail: {
      label: 'Stages',
      shop: 'Shop',
      stages: ['Request', 'Claude step 1', 'Claude pauses', 'Temporal runs the tool', 'Claude continues', 'You approve', 'The refund', 'Email and answer', 'Done'],   // short names, stages 1..9
      crashedBefore: 'crashed before',
      crashedAfter: 'crashed after',
    },
    // lower sections (GAME_SPEC §5, with its corrections), rendered by ui.js into #lower.
    lower: {
      cases: {
        title: 'Special cases',
        intro: 'Real agents don\u2019t always follow the happy path. Here is what the code does in four special cases.',
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
          ['When a paused call was allowed to run on resume, the engine ignored the next pause.', 'Our hook always says pause, and the saved result goes back to Claude as a normal message.'],
          ['Rewinding a conversation after a crash broke the paused state.', 'A plain resume after a crash, which works even on a different machine.'],
          ['With two tools asked at once, the engine kept one and silently dropped the other.', 'The first pauses; the second is told to wait and is asked for again.'],
          ['On every resume, the engine announces the call we just answered again.', 'We recognize the repeat and ignore it.'],
          ['A Claude app login cannot renew itself when a paused session resumes.', 'Use an API key, Amazon Bedrock or Google Vertex, or a long-lived login token.'],
          ['Opus 5.5 needs a newer engine than the one inside the SDK.', 'Point the package at Claude Code 2.1.280 or newer with one setting.'],
        ],
      },
      proven: {
        title: 'Proven with real Claude',
        text: [
          'Eight scenarios, 2 runs each, on Haiku 4.5, Sonnet 5, Opus 5.5 and Fable 5.1: 2 of 2 each, 16 of 16 per model.',
          'Opus 5.5 ran on Claude Code 2.1.280.',
          '12 automated tests, 4 of which kill a worker on purpose: the 3 crash tests in tests/test_crash.py and test_real_engine_refund_with_approval_and_crash.',
          'The same eight pass through Amazon Bedrock with a stand-in model.',
        ],
      },
    },
    // the page chrome around the canvas (ui.js; added by the UI builder)
    ui: {
      reduced: 'Reduce motion',                // the reduced-motion toggle in the control bar (aria-pressed)
      toggles: 'Settings',                     // accessible name of the toggle group
      keysLabel: 'Keyboard',
      // [key, what it does]: the legend under the panel (the shortcuts of GAME_SPEC §2 "Keys")
      keys: [['P', 'pull the plug, or plug it back in'], ['Space', 'pause'], ['A', 'approve'], ['R', 'reject'], ['Enter', 'next']],
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
