"""Behavior of the durable loop with a scripted fake Claude (no API key needed)."""

from __future__ import annotations

import asyncio
import inspect
import os
import uuid
from pathlib import Path
from typing import Any, Optional

import pytest
from temporalio.client import Client
from temporalio.worker import Replayer, Worker

from conftest import executions, wait_for_approval
from refund_agent import shop
from refund_agent.activities import email_customer, issue_refund, look_up_order
from refund_agent.fake_claude import refund_policy
from refund_agent.workflows import MANAGER, RefundAgentWorkflow
from temporal_claude_agent import ClaudeAgentPlugin, ScriptedClaude

BROKEN_TEAPOT = "Order A-1001 arrived broken, I want my money back."


async def run_case(address: str, tmp: Path, *, approve: Optional[bool] = True, prompt: str = BROKEN_TEAPOT,
                   env: Optional[dict[str, str]] = None) -> tuple[str, list[dict[str, Any]], float, Any]:
    os.environ["SHOP_DIR"] = str(tmp / "shop")
    for key in ("FAIL_REFUND_TIMES", "REFUND_DELAY"):
        os.environ.pop(key, None)
    os.environ.update(env or {})
    client = await Client.connect(address)
    queue = f"tq-{uuid.uuid4().hex[:8]}"
    plugin = ClaudeAgentPlugin(ScriptedClaude(refund_policy, tmp / "fake"), heartbeat_every=1.0)
    async with Worker(client, task_queue=queue, workflows=[RefundAgentWorkflow],
                      activities=[look_up_order, issue_refund, email_customer], plugins=[plugin]):
        handle = await client.start_workflow(RefundAgentWorkflow.run, prompt,
                                             id=f"wf-{uuid.uuid4().hex[:8]}", task_queue=queue)
        pending = await wait_for_approval(handle)
        if pending is not None and approve is not None:
            await handle.execute_update(RefundAgentWorkflow.review, args=[pending["id"], approve, MANAGER])
        result = await asyncio.wait_for(handle.result(), 60)
        calls = await handle.query(RefundAgentWorkflow.tool_calls)
        cost = await handle.query(RefundAgentWorkflow.cost_usd)
        history = await handle.fetch_history()
    return result, calls, cost, history


def test_approved_refund_runs_each_tool_once(temporal_address: str, tmp_path: Path) -> None:
    result, calls, cost, _ = asyncio.run(run_case(temporal_address, tmp_path))
    assert result.startswith("Done. Refunded 49.99 EUR for order A-1001")
    assert [(c["name"], c["status"]) for c in calls] == [
        ("look_up_order", "done"), ("issue_refund", "done"), ("email_customer", "done")]
    assert len(shop.read("refunds.jsonl")) == 1 and len(shop.read("emails.jsonl")) == 1
    assert len(executions("issue_refund")) == 1
    assert cost == pytest.approx(0.04)  # 4 model segments


def test_rejected_refund_moves_no_money(temporal_address: str, tmp_path: Path) -> None:
    result, calls, _, _ = asyncio.run(run_case(temporal_address, tmp_path, approve=False))
    assert "not approved" in result
    assert calls[1]["status"] == "rejected"
    assert shop.read("refunds.jsonl") == [] and executions("issue_refund") == []


def test_flaky_payment_provider_is_retried(temporal_address: str, tmp_path: Path) -> None:
    result, _, _, _ = asyncio.run(run_case(temporal_address, tmp_path, env={"FAIL_REFUND_TIMES": "2"}))
    assert result.startswith("Done.")
    assert len(executions("issue_refund")) == 3  # 2 simulated timeouts, then success
    assert len(shop.read("refunds.jsonl")) == 1


def test_tool_error_goes_back_to_claude(temporal_address: str, tmp_path: Path) -> None:
    result, calls, _, _ = asyncio.run(run_case(temporal_address, tmp_path, prompt="Order Z-9999 never arrived."))
    assert "could not find that order" in result
    assert calls[0]["status"] == "failed"


def test_history_replays_without_nondeterminism(temporal_address: str, tmp_path: Path) -> None:
    _, _, _, history = asyncio.run(run_case(temporal_address, tmp_path))
    plugin = ClaudeAgentPlugin(ScriptedClaude(refund_policy, tmp_path / "replay"))
    if "plugins" in inspect.signature(Replayer.__init__).parameters:
        replayer = Replayer(workflows=[RefundAgentWorkflow], plugins=[plugin])
    else:
        replayer = Replayer(workflows=[RefundAgentWorkflow])
    asyncio.run(replayer.replay_workflow(history))


def test_only_an_allowed_approver_can_approve(temporal_address: str, tmp_path: Path) -> None:
    async def scenario() -> tuple[str, list[dict[str, Any]], str]:
        os.environ["SHOP_DIR"] = str(tmp_path / "shop")
        client = await Client.connect(temporal_address)
        queue = f"tq-{uuid.uuid4().hex[:8]}"
        plugin = ClaudeAgentPlugin(ScriptedClaude(refund_policy, tmp_path / "fake"), heartbeat_every=1.0)
        async with Worker(client, task_queue=queue, workflows=[RefundAgentWorkflow],
                          activities=[look_up_order, issue_refund, email_customer], plugins=[plugin]):
            handle = await client.start_workflow(RefundAgentWorkflow.run, BROKEN_TEAPOT,
                                                 id=f"wf-{uuid.uuid4().hex[:8]}", task_queue=queue)
            pending = await wait_for_approval(handle)
            refused = ""
            try:
                await handle.execute_update(RefundAgentWorkflow.review, args=[pending["id"], True, "intruder@example.com"])
            except Exception as err:  # the validator refuses it before it reaches the history
                refused = str(err) or type(err).__name__
            assert shop.read("refunds.jsonl") == []  # no money moved
            await handle.execute_update(RefundAgentWorkflow.review, args=[pending["id"], True, MANAGER])
            result = await asyncio.wait_for(handle.result(), 60)
            return result, await handle.query(RefundAgentWorkflow.tool_calls), refused

    result, calls, refused = asyncio.run(scenario())
    assert refused, "the intruder's approval should have been refused"
    assert result.startswith("Done.")
    assert calls[1]["decided_by"] == MANAGER
    assert len(shop.read("refunds.jsonl")) == 1


def test_refund_above_the_order_total_is_refused(tmp_path: Path) -> None:
    from temporalio.exceptions import ApplicationError
    from temporalio.testing import ActivityEnvironment

    os.environ["SHOP_DIR"] = str(tmp_path / "shop")
    with pytest.raises(ApplicationError) as err:
        asyncio.run(ActivityEnvironment().run(issue_refund, {"order_id": "A-1001", "amount": 500}))
    assert err.value.non_retryable and "not allowed" in str(err.value)
    assert shop.read("refunds.jsonl") == []
