"""The REAL Claude Code engine (bundled in claude-agent-sdk) on Temporal, with a fake model.

No Claude account needed: spike/mock_model.py plays the model. This proves the
engine-side mechanism (defer, tool_result on resume, session store, crash) in CI.
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(importlib.util.find_spec("claude_agent_sdk") is None,
                                reason="needs claude-agent-sdk")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_real_engine_refund_with_approval_and_crash() -> None:
    from spike.e2e_real_engine import main

    for run in asyncio.run(main()):
        assert run["result"].startswith("Done. Refunded 49.99 EUR for order A-1001")
        assert run["activities"] == {"run_claude_segment": 4, "look_up_order": 1,
                                     "issue_refund": 1, "email_customer": 1}
        assert run["refunds"] == 1 and run["refund_executions"] == 1


def test_real_engine_parallel_calls_are_serialized_not_lost(tmp_path: Path) -> None:
    """Claude asks for 2 tools in one message. One pauses, the other is told to wait and is asked again."""
    import os
    import uuid

    from spike import mock_model as mock
    from spike.parallel_mock import install
    from temporal_claude_agent import FileSessionStore, SegmentInput, ToolOutcome, ToolSpec
    from temporal_claude_agent.claude_sdk import ClaudeAgentSdkRunner

    port = install()
    env = {"ANTHROPIC_BASE_URL": f"http://127.0.0.1:{port}", "ANTHROPIC_API_KEY": "sk-ant-mock-not-real",
           "DISABLE_TELEMETRY": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
           "CLAUDE_CONFIG_DIR": str(tmp_path / "cfg"), "NO_PROXY": "127.0.0.1,localhost",
           "no_proxy": "127.0.0.1,localhost"}
    runner = ClaudeAgentSdkRunner(session_store=FileSessionStore(tmp_path / "store"), cwd=str(tmp_path), env=env)
    tools = [ToolSpec("look_up_order", "Look up an order.",
                      {"type": "object", "properties": {"order_id": {"type": "string"}}, "required": ["order_id"]})]

    async def flow() -> tuple[list[str], str]:
        seg = await runner.run(SegmentInput(session_id=str(uuid.uuid4()), prompt="Check orders A-1001 and A-1002.",
                                            tools=tools, segment_index=0), 1)
        paused: list[str] = []
        while seg.deferred is not None and len(paused) < 5:
            paused.append(seg.deferred.input["order_id"])
            outcome = ToolOutcome({"order": seg.deferred.input["order_id"], "status": "found"})
            seg = await runner.run(SegmentInput(session_id=seg.session_id, prompt=None, tools=tools,
                                                injected={seg.deferred.id: outcome}, segment_index=len(paused)), 1)
        return paused, seg.result or ""

    errors_before = len(mock.ERRORS)
    paused, result = asyncio.run(flow())
    assert sorted(paused) == ["A-1001", "A-1002"]  # both lookups ran, one at a time
    assert result == "FINAL: looked up A-1001, A-1002"
    assert len(mock.ERRORS) == errors_before  # every request followed the real API's tool rules
    assert runner.stub_calls == 0  # the engine never ran a tool itself
