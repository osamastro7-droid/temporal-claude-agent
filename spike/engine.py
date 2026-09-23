"""Run the Claude Code engine that ships inside claude-agent-sdk (the exact version the tests use).

    python -m spike.engine setup-token   # one-time: long-lived login token for your Claude subscription
    python -m spike.engine               # interactive Claude Code (type /login, then /exit)
    python -m spike.engine --version     # which engine the tests use (CLAUDE_CLI_PATH wins if set)
"""

import os
import sys
from pathlib import Path

import claude_agent_sdk


def main() -> None:
    engine = Path(os.environ.get("CLAUDE_CLI_PATH") or Path(claude_agent_sdk.__file__).parent / "_bundled" / "claude")
    if not engine.exists():
        sys.exit(f"Claude engine not found at {engine}")
    os.execv(str(engine), [str(engine), *sys.argv[1:]])


if __name__ == "__main__":
    main()
