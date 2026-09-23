"""Shared test setup: one local Temporal dev server for the whole test session."""

from __future__ import annotations

import asyncio
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Optional

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"
sys.path.insert(0, str(EXAMPLES))


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _cli() -> str:
    return os.environ.get("TEMPORAL_CLI") or shutil.which("temporal") or "temporal"


@pytest.fixture(scope="session")
def temporal_address() -> Any:
    port = _free_port()
    proc = subprocess.Popen(
        [_cli(), "server", "start-dev", "--headless", "--port", str(port), "--log-level", "error"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    address = f"127.0.0.1:{port}"

    async def ready() -> None:
        from temporalio.client import Client

        for _ in range(80):
            try:
                await Client.connect(address)
                return
            except Exception:
                await asyncio.sleep(0.25)
        raise RuntimeError("Temporal dev server did not start")

    asyncio.run(ready())
    yield address
    proc.terminate()
    proc.wait(timeout=15)


async def wait_for_approval(handle: Any, timeout: float = 45) -> Optional[dict[str, Any]]:
    from refund_agent.workflows import RefundAgentWorkflow

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pending = await handle.query(RefundAgentWorkflow.pending_approvals)
        if pending:
            return pending[0]
        if (await handle.describe()).status.name != "RUNNING":
            return None
        await asyncio.sleep(0.2)
    raise TimeoutError("no approval request arrived")


def executions(tool: str) -> list[dict[str, Any]]:
    from refund_agent import shop

    return [e for e in shop.read("executions.jsonl") if e["tool"] == tool]
