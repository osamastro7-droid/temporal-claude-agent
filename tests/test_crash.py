"""Kill the worker process at the worst moments. Every run must finish, money must move once."""

from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from temporalio.client import Client

from conftest import EXAMPLES, executions, wait_for_approval
from refund_agent import shop
from refund_agent.workflows import MANAGER, RefundAgentWorkflow

PROMPT = "Order A-1001 arrived broken, I want my money back."


def start_worker(address: str, queue: str, env: dict[str, str], log: Path) -> subprocess.Popen:
    full_env = {**os.environ, **env, "PYTHONPATH": str(EXAMPLES) + os.pathsep + os.environ.get("PYTHONPATH", "")}
    proc = subprocess.Popen([sys.executable, "-m", "refund_agent.worker", "--address", address, "--task-queue", queue],
                            cwd=EXAMPLES, env=full_env, stdout=log.open("w"), stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 30
    while "worker ready" not in log.read_text():
        if proc.poll() is not None or time.monotonic() > deadline:
            raise RuntimeError(f"worker failed to start:\n{log.read_text()}")
        time.sleep(0.1)
    return proc


def kill(proc: subprocess.Popen) -> None:
    proc.send_signal(signal.SIGKILL)  # no cleanup, like a power cut
    proc.wait()


async def wait_until(check: Callable[[], Any], timeout: float = 45) -> None:
    deadline = time.monotonic() + timeout
    while not check():
        if time.monotonic() > deadline:
            raise TimeoutError("condition never became true")
        await asyncio.sleep(0.05)


async def activity_completed(handle: Any, activity_type: str) -> bool:
    scheduled: set[int] = set()
    async for event in handle.fetch_history_events():
        if event.HasField("activity_task_scheduled_event_attributes"):
            if event.activity_task_scheduled_event_attributes.activity_type.name == activity_type:
                scheduled.add(event.event_id)
        if event.HasField("activity_task_completed_event_attributes"):
            if event.activity_task_completed_event_attributes.scheduled_event_id in scheduled:
                return True
    return False


def setup(tmp: Path) -> tuple[str, dict[str, str]]:
    os.environ["SHOP_DIR"] = str(tmp / "shop")
    return f"crash-{uuid.uuid4().hex[:8]}", {"SHOP_DIR": str(tmp / "shop"), "FAKE_STATE_DIR": str(tmp / "fake")}


def test_crash_right_after_refund_is_recorded(temporal_address: str, tmp_path: Path) -> None:
    async def scenario() -> str:
        queue, env = setup(tmp_path)
        client = await Client.connect(temporal_address)
        w1 = start_worker(temporal_address, queue, env, tmp_path / "w1.log")
        handle = await client.start_workflow(RefundAgentWorkflow.run, PROMPT, id=queue, task_queue=queue)
        pending = await wait_for_approval(handle)
        await handle.execute_update(RefundAgentWorkflow.review, args=[pending["id"], True, MANAGER])
        deadline = time.monotonic() + 45
        while not await activity_completed(handle, "issue_refund"):
            assert time.monotonic() < deadline
            await asyncio.sleep(0.05)
        kill(w1)
        w2 = start_worker(temporal_address, queue, env, tmp_path / "w2.log")
        try:
            return await asyncio.wait_for(handle.result(), 90)
        finally:
            kill(w2)

    result = asyncio.run(scenario())
    assert result.startswith("Done.")
    assert len(executions("issue_refund")) == 1  # finished call was never run again
    assert len(shop.read("refunds.jsonl")) == 1


def test_crash_after_money_moved_but_before_the_reply(temporal_address: str, tmp_path: Path) -> None:
    async def scenario() -> str:
        queue, env = setup(tmp_path)
        client = await Client.connect(temporal_address)
        w1 = start_worker(temporal_address, queue, {**env, "REFUND_DELAY": "5"}, tmp_path / "w1.log")
        handle = await client.start_workflow(RefundAgentWorkflow.run, PROMPT, id=queue, task_queue=queue)
        pending = await wait_for_approval(handle)
        await handle.execute_update(RefundAgentWorkflow.review, args=[pending["id"], True, MANAGER])
        await wait_until(lambda: len(shop.read("refunds.jsonl")) == 1)
        kill(w1)
        w2 = start_worker(temporal_address, queue, env, tmp_path / "w2.log")
        try:
            return await asyncio.wait_for(handle.result(), 90)
        finally:
            kill(w2)

    result = asyncio.run(scenario())
    assert result.startswith("Done.")
    assert len(executions("issue_refund")) == 2  # Temporal retried the unfinished call...
    assert len(shop.read("refunds.jsonl")) == 1  # ...and the idempotency key kept money moving once


def test_crash_in_the_middle_of_a_claude_segment(temporal_address: str, tmp_path: Path) -> None:
    async def scenario() -> str:
        queue, env = setup(tmp_path)
        client = await Client.connect(temporal_address)
        w1 = start_worker(temporal_address, queue, {**env, "FAKE_THINK": "4"}, tmp_path / "w1.log")
        handle = await client.start_workflow(RefundAgentWorkflow.run, PROMPT, id=queue, task_queue=queue)
        await asyncio.sleep(1.5)  # Claude is still "thinking" about segment 1
        kill(w1)
        w2 = start_worker(temporal_address, queue, env, tmp_path / "w2.log")
        try:
            pending = await wait_for_approval(handle)
            await handle.execute_update(RefundAgentWorkflow.review, args=[pending["id"], True, MANAGER])
            return await asyncio.wait_for(handle.result(), 90)
        finally:
            kill(w2)

    result = asyncio.run(scenario())
    assert result.startswith("Done.")
    for tool in ("look_up_order", "issue_refund", "email_customer"):
        assert len(executions(tool)) == 1, tool
