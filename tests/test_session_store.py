"""FileSessionStore follows the SessionStore contracts, checked with the Claude Agent SDK's own suite."""

from __future__ import annotations

import asyncio
import itertools
from pathlib import Path

import pytest

from temporal_claude_agent import FileSessionStore


def test_file_session_store_passes_the_sdk_conformance_suite(tmp_path: Path) -> None:
    conformance = pytest.importorskip("claude_agent_sdk.testing", reason="needs claude-agent-sdk with its test suite")
    fresh = itertools.count()
    # The six required contracts run; the ones for optional methods (list, delete) are skipped.
    asyncio.run(conformance.run_session_store_conformance(lambda: FileSessionStore(tmp_path / f"store-{next(fresh)}")))
