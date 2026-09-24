"""Fail closed: if a Claude Code engine ever stops honoring "defer", the agent stops loudly.

Anthropic documents the "defer" decision (https://code.claude.com/docs/en/hooks), and the same page
says it is ignored in some cases, for example several tool calls in one turn. These tests simulate an
engine that ignores it, using the real Claude Code engine and a stand-in model, and check that
nothing runs outside Temporal and that the step fails with a clear, non-retryable error instead of
finishing as if all were well.
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import re
import shlex
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import pytest
from temporalio.client import Client, WorkflowFailureError
from temporalio.worker import Worker

from conftest import executions
from refund_agent import shop
from refund_agent.activities import email_customer, issue_refund, look_up_order
from refund_agent.workflows import EMAIL, ORDER, REFUND, RefundAgentWorkflow
from temporal_claude_agent import (ClaudeAgentPlugin, DeferredCall, FileSessionStore, SegmentInput, SegmentOutput,
                                   ToolSpec)

ROOT = Path(__file__).resolve().parents[1]
BROKEN_HOOK = Path(__file__).with_name("broken_engine_hook.py")
BROKEN_TEAPOT = "Order A-1001 arrived broken, I want my money back."
TOOLS = [ToolSpec("look_up_order", "Look up an order.", ORDER), ToolSpec("issue_refund", "Refund money.", REFUND),
         ToolSpec("email_customer", "Email the customer.", EMAIL)]
needs_sdk = pytest.mark.skipif(importlib.util.find_spec("claude_agent_sdk") is None, reason="needs claude-agent-sdk")


def failure_text(err: BaseException) -> str:
    parts, current = [], err
    while current is not None:
        parts.append(str(current))
        current = getattr(current, "cause", None) or current.__cause__
    return " | ".join(parts)


@pytest.fixture
def fake_model(tmp_path: Path) -> Any:
    """The refund-story stand-in model, in its own process."""
    port_file = tmp_path / "model.port"
    proc = subprocess.Popen(
        [sys.executable, "-m", "spike.mock_model", "--policy", "refund", "--port-file", str(port_file)], cwd=ROOT,
        env={**os.environ, "PYTHONPATH": os.pathsep.join([str(ROOT / "examples"), str(ROOT)])})
    deadline = time.monotonic() + 30
    while not (port_file.exists() and port_file.read_text()):
        assert proc.poll() is None and time.monotonic() < deadline, "the fake model did not start"
        time.sleep(0.1)
    yield int(port_file.read_text())
    proc.kill()
    proc.wait()


@pytest.fixture
def broken_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    from temporal_claude_agent import claude_sdk

    monkeypatch.setattr(claude_sdk, "_hook_command",
                        lambda: f"{shlex.quote(sys.executable)} {shlex.quote(str(BROKEN_HOOK))}")


def real_runner(port: int, tmp_path: Path, mode: str) -> Any:
    from temporal_claude_agent.claude_sdk import ClaudeAgentSdkRunner

    env = {"ANTHROPIC_BASE_URL": f"http://127.0.0.1:{port}", "ANTHROPIC_API_KEY": "sk-ant-mock-not-real",
           "DISABLE_TELEMETRY": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
           "CLAUDE_CONFIG_DIR": str(tmp_path / "cfg"), "NO_PROXY": "127.0.0.1,localhost",
           "no_proxy": "127.0.0.1,localhost", "BROKEN_ENGINE": mode}
    return ClaudeAgentSdkRunner(session_store=FileSessionStore(tmp_path / "store"), cwd=str(tmp_path), env=env)


@needs_sdk
@pytest.mark.parametrize("mode, expected", [
    ("allow", "ran durable tool(s) look_up_order inside the engine instead of pausing"),
    ("deny", "did not pause"),
])
def test_step_fails_closed_when_the_engine_ignores_defer(fake_model: int, broken_engine: None, tmp_path: Path,
                                                         mode: str, expected: str) -> None:
    runner = real_runner(fake_model, tmp_path, mode)
    out = asyncio.run(runner.run(SegmentInput(session_id=str(uuid.uuid4()), prompt=BROKEN_TEAPOT, tools=TOOLS,
                                              segment_index=0), 1))
    assert out.is_error and out.deferred is None and out.result is None
    assert expected in out.error
    assert re.search(r"Claude Code \d+\.\d+\.\d+", out.error), out.error  # names the engine version
    assert "nothing ran outside Temporal" in out.error


@needs_sdk
def test_workflow_stops_loudly_and_no_tool_activity_runs(temporal_address: str, fake_model: int,
                                                        broken_engine: None, tmp_path: Path) -> None:
    os.environ["SHOP_DIR"] = str(tmp_path / "shop")

    async def scenario() -> tuple[BaseException, list[dict[str, Any]]]:
        client = await Client.connect(temporal_address)
        queue = f"broken-{uuid.uuid4().hex[:6]}"
        plugin = ClaudeAgentPlugin(real_runner(fake_model, tmp_path, "allow"), heartbeat_every=1.0)
        async with Worker(client, task_queue=queue, workflows=[RefundAgentWorkflow],
                          activities=[look_up_order, issue_refund, email_customer], plugins=[plugin]):
            handle = await client.start_workflow(RefundAgentWorkflow.run, BROKEN_TEAPOT, id=queue, task_queue=queue)
            with pytest.raises(WorkflowFailureError) as err:
                await asyncio.wait_for(handle.result(), 120)
            return err.value, await handle.query(RefundAgentWorkflow.tool_calls)

    err, calls = asyncio.run(scenario())
    assert "inside the engine instead of pausing" in failure_text(err)
    assert calls == []  # the workflow never ran a tool Activity
    assert executions("look_up_order") == [] and shop.read("refunds.jsonl") == []


class RepeatingRunner:
    """A runner whose engine keeps asking for the same tool call, for example after an engine change."""

    async def run(self, inp: SegmentInput, attempt: int) -> SegmentOutput:
        return SegmentOutput(session_id=inp.session_id,
                             deferred=DeferredCall(id="toolu_same", name="look_up_order", input={"order_id": "A-1001"}))


def test_a_tool_call_never_runs_twice(temporal_address: str, tmp_path: Path) -> None:
    os.environ["SHOP_DIR"] = str(tmp_path / "shop")

    async def scenario() -> BaseException:
        client = await Client.connect(temporal_address)
        queue = f"repeat-{uuid.uuid4().hex[:6]}"
        async with Worker(client, task_queue=queue, workflows=[RefundAgentWorkflow],
                          activities=[look_up_order, issue_refund, email_customer],
                          plugins=[ClaudeAgentPlugin(RepeatingRunner(), heartbeat_every=1.0)]):
            handle = await client.start_workflow(RefundAgentWorkflow.run, BROKEN_TEAPOT, id=queue, task_queue=queue)
            with pytest.raises(WorkflowFailureError) as err:
                await asyncio.wait_for(handle.result(), 60)
            return err.value

    err = asyncio.run(scenario())
    assert "which already ran" in failure_text(err)
    assert len(executions("look_up_order")) == 1  # it ran once, and was not run again
