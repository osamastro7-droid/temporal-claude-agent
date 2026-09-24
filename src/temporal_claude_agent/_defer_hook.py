"""PreToolUse command hook for the Claude Code engine (settings-based, not in-process).

Always "defer" durable tool calls, so the Workflow runs them as Temporal Activities.
Never "allow" them: tested on engine 2.1.277, "allow" on a resumed paused call sends
the engine down its auto-resume path, where a second "defer" is ignored.

Parallel calls: the engine keeps only one paused call per run. So the first new durable
call in a run is deferred, and any other new call in the same run is denied with a clear
message, so Claude knows to ask again (instead of the call silently disappearing).
"""

from __future__ import annotations

import json
import os
import sys

ONE_AT_A_TIME = ("Only one tool call can run at a time. Your other tool call is running now. "
                 "Call this tool again after you get that result.")


def decide(event: dict) -> dict:
    """Return the hookSpecificOutput for one PreToolUse event (and record the paused call)."""
    tool_use_id = str(event.get("tool_use_id") or "")
    output = {"hookEventName": "PreToolUse", "permissionDecision": "defer"}
    answered = set(os.environ.get("TCA_ANSWERED_IDS", "").split())
    run_dir = os.environ.get("TCA_HOOK_DIR")
    # Tested: on resume the engine re-announces the call we just answered. It must not
    # take the "one paused call per run" slot, or Claude's next real call gets denied.
    if run_dir and tool_use_id not in answered:
        marker = os.path.join(run_dir, "paused_call")
        try:
            fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY)  # atomic: exactly one call wins
            with os.fdopen(fd, "w") as handle:
                handle.write(tool_use_id)
        except FileExistsError:
            with open(marker) as handle:
                if handle.read().strip() != tool_use_id:
                    output = {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                              "permissionDecisionReason": ONE_AT_A_TIME}
    log = os.environ.get("TCA_HOOK_LOG")
    if log:  # debugging aid: one line per decision
        with open(log, "a") as handle:
            handle.write(f"{tool_use_id} {output['permissionDecision']}\n")
    return output


def main() -> None:
    print(json.dumps({"hookSpecificOutput": decide(json.load(sys.stdin))}))


if __name__ == "__main__":
    main()
