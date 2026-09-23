# Claude Code engine findings (Milestone 1)

Setup: claude-agent-sdk 0.2.157 (bundled Claude Code engine 2.1.277), temporalio 1.33.0,
Python 3.12. The model is a fake (spike/mock_model.py via ANTHROPIC_BASE_URL), so the
engine is real but no Claude account was used. Real Claude is the next step.

## Works (tested)
1. Pause: a settings-based PreToolUse command hook answering "defer" stops the run.
   ResultMessage.deferred_tool_use gives id, name and input.
2. Continue: resume the session and send a user message with a tool_result block for
   that tool_use_id (streaming input). Claude continues and can pause again at the next
   tool. The engine never runs the tool itself (stub_calls == 0).
3. Move: a fresh machine (empty CLAUDE_CONFIG_DIR) resumes from the SessionStore alone.
4. Crash mid-answer: a plain resume on a fresh machine finishes correctly. If the
   transcript already holds the tool_result, resume without sending it again.
5. Full refund agent on Temporal (tests/test_real_engine.py): 4 Claude segments, each
   tool exactly once, also when the worker is SIGKILLed right after the refund.

## Does not work (and what we do instead)
A. Letting the hook "allow" a resumed paused call sends the engine down its
   auto-resume path. There, a later "defer" is ignored and turns into
   "[Tool result missing due to internal error]". PostToolUse {"continue": false}
   is ignored there too. Same with in-process hooks, settings hooks, fork_session.
   Instead: the hook always answers "defer" and we deliver results as tool_result messages.
B. Rewinding with resume_session_at (to the assistant message or to the last saved
   entry) loses the paused state (same internal error). Instead: plain resume on retry.
C. Parallel tool calls: the engine keeps only one paused call per run and silently
   drops the others from the history. Instead: the hook defers the first new call in a
   run and denies other new calls with a clear "one at a time, call again" message.
   Claude asks again in the next step. Tested with a fake model that asks for 2 tools at
   once: both ran, one at a time, nothing lost. The system prompt also asks for one call
   at a time. Later: ask upstream for multi-call defer, then run parallel Activities.
D. On every resume the engine re-announces the call we just answered to PreToolUse,
   before continuing. The hook answers "defer" there (harmless on that path) and does
   not count it as a new call. Without this rule, Claude's next real call was denied.
E. Strict fake model: every request is checked against the real API's tool_use and
   tool_result pairing rules (the ones that return a 400). All flows pass.

F. When a model is set, the engine may add a <system-reminder> (token budget) after a tool
   result's text. Real Claude reads it fine. The fake model now reads only the leading JSON.

G. Amazon Bedrock mode (CLAUDE_CODE_USE_BEDROCK=1): the engine lists inference profiles, then
   streams from /model/<model id>/invoke-with-response-stream. The runner needs no changes.
   Tested with a fake Bedrock endpoint (AWS event-stream framing, verified with botocore's
   decoder): all 8 matrix scenarios pass, and the model ID arrives exactly as passed.

H. Logins and resumes (seen on a real Mac: every step failed with "OAuth session expired and could
   not be refreshed"). With a Claude app login (OAuth in the macOS Keychain), the SDK copies the login
   into a temp folder when it resumes a session from a session store, and removes the refresh token on
   purpose, so the main login is not revoked. Once the short-lived access token expires, resumed steps
   cannot renew it. Durable agents must use a login from the environment: ANTHROPIC_API_KEY, Bedrock
   or Vertex, or for personal testing CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`. The runner
   warns when none is set; the test matrix checks the login first and stops with the fix steps.

I. Engine version matters. The first real run (Max subscription) passed on Haiku 4.5, Sonnet 5 and
   Fable 5.1, but Opus 5.5 was refused: "Claude Code 2.1.277 does not support this model; version
   2.1.280 or newer is required". claude-agent-sdk 0.2.157 (the newest on PyPI) bundles 2.1.277, so the
   package now accepts a newer engine through CLAUDE_CLI_PATH. On engine 2.1.280 all 8 fake scenarios
   pass in both Anthropic API mode and Bedrock mode, so the workarounds above still hold.

## Draft upstream issue (github.com/anthropics/claude-code)
Title: Headless defer: after auto-resuming a deferred tool, a second PreToolUse "defer"
is ignored ("[Tool result missing due to internal error]")

Version: Claude Code 2.1.277 (claude-agent-sdk 0.2.157), headless via the Python SDK.
Steps: (1) PreToolUse hook defers tool X, run stops with deferred_tool_use. (2) Resume;
hook now allows X; X runs. (3) Model calls tool Y; hook answers "defer".
Expected: run stops with deferred_tool_use = Y.
Actual: debug log shows "Hook result has permissionBehavior=defer", then Y gets
"[Tool result missing due to internal error]" and the run continues. PostToolUse
continue:false is also ignored on this path.
Workaround: never allow on resume; send a tool_result message for X instead.
Also: with two parallel tool_use blocks, only the last one is kept as deferred.
