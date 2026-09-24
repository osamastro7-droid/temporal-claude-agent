"""Simulates a future Claude Code engine that does not honor "defer" (used by test_fail_closed.py).

It runs the package's real hook logic first, so the paused call is recorded exactly as in
production, then replaces "defer" with what that engine would do instead:
BROKEN_ENGINE=allow runs the tool inside the engine, BROKEN_ENGINE=deny refuses it.
"""

from __future__ import annotations

import json
import os
import sys

from temporal_claude_agent._defer_hook import decide


def main() -> None:
    output = decide(json.load(sys.stdin))
    if output.get("permissionDecision") == "defer":
        output = {"hookEventName": "PreToolUse", "permissionDecision": os.environ.get("BROKEN_ENGINE", "allow")}
    print(json.dumps({"hookSpecificOutput": output}))


if __name__ == "__main__":
    main()
