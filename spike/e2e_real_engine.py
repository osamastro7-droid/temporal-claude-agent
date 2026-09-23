"""End to end: Temporal + the REAL Claude Code engine + a fake model playing Claude.

Run 1: normal run with a manager approval.
Run 2: same, but the worker is killed right after the refund, and a fresh worker
       (empty Claude config folder = a different machine) finishes the job.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"
sys.path.insert(0, str(EXAMPLES))
sys.path.insert(0, str(ROOT / "tests"))

from temporalio.client import Client  # noqa: E402

from refund_agent import shop  # noqa: E402
from refund_agent.workflows import MANAGER, RefundAgentWorkflow  # noqa: E402
from test_crash import activity_completed, kill, start_worker  # noqa: E402
from conftest import executions, wait_for_approval  # noqa: E402

PROMPT = "Order A-1001 arrived broken, I want my money back."


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def one_run(address: str, work: Path, base_env: dict[str, str], crash: bool) -> dict:
    label = "run 2 (crash after refund)" if crash else "run 1 (clean)"
    shop_dir = work / f"shop-{int(crash)}"
    os.environ["SHOP_DIR"] = str(shop_dir)
    env = {**base_env, "SHOP_DIR": str(shop_dir)}
    queue = f"e2e-{uuid.uuid4().hex[:6]}"
    client = await Client.connect(address)
    w1 = start_worker(address, queue, {**env, "CLAUDE_CONFIG_DIR": str(work / f"cfg-{queue}-1")}, work / f"{queue}-1.log")
    started = time.monotonic()
    handle = await client.start_workflow(RefundAgentWorkflow.run, PROMPT, id=queue, task_queue=queue)
    pending = await wait_for_approval(handle, timeout=120)
    if pending is None:
        desc = await handle.describe()
        try:
            outcome = await handle.result()
        except Exception as err:  # show why it stopped
            outcome = f"{err!r} cause={getattr(err, 'cause', None)!r}"
        log = (work / f"{queue}-1.log").read_text()[-2500:]
        raise SystemExit(f"workflow stopped before approval: {desc.status.name}: {outcome}\n--- worker log ---\n{log}")
    print(f"\n== {label}\nmanager is asked to approve: {pending['input']}")
    await handle.execute_update(RefundAgentWorkflow.review, args=[pending["id"], True, MANAGER])
    workers = [w1]
    if crash:
        while not await activity_completed(handle, "issue_refund"):
            await asyncio.sleep(0.05)
        kill(w1)
        print("worker 1 KILLED right after the refund; starting worker 2 on an empty Claude folder")
        workers.append(start_worker(address, queue, {**env, "CLAUDE_CONFIG_DIR": str(work / f"cfg-{queue}-2")},
                                    work / f"{queue}-2.log"))
    try:
        result = await asyncio.wait_for(handle.result(), 240)
    finally:
        for w in workers:
            if w.poll() is None:
                kill(w)
    kinds = Counter()
    async for event in handle.fetch_history_events():
        if event.HasField("activity_task_scheduled_event_attributes"):
            kinds[event.activity_task_scheduled_event_attributes.activity_type.name] += 1
    print(f"result: {result}")
    print(f"activities in Temporal history: {dict(kinds)}")
    print(f"refunds in ledger: {len(shop.read('refunds.jsonl'))} | issue_refund executions: "
          f"{len(executions('issue_refund'))} | took {time.monotonic() - started:.1f}s")
    return {"result": result, "activities": dict(kinds), "refunds": len(shop.read("refunds.jsonl")),
            "refund_executions": len(executions("issue_refund"))}


async def main() -> list:
    work = Path(tempfile.mkdtemp(prefix="e2e-"))
    cli = os.environ.get("TEMPORAL_CLI") or shutil.which("temporal") or "temporal"
    port = free_port()
    server = subprocess.Popen([cli, "server", "start-dev", "--headless", "--port", str(port), "--log-level", "error"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port_file = work / "model.port"
    model = subprocess.Popen([sys.executable, "-m", "spike.mock_model", "--policy", "refund", "--port-file", str(port_file)],
                             cwd=ROOT, env={**os.environ, "PYTHONPATH": f"{EXAMPLES}{os.pathsep}{ROOT}"})
    try:
        while not port_file.exists():
            time.sleep(0.1)
        address = f"127.0.0.1:{port}"
        for _ in range(80):
            try:
                await Client.connect(address)
                break
            except Exception:
                await asyncio.sleep(0.25)
        base_env = {"ANTHROPIC_BASE_URL": f"http://127.0.0.1:{port_file.read_text()}",
                    "ANTHROPIC_API_KEY": "sk-ant-mock-not-real", "DISABLE_TELEMETRY": "1",
                    "DISABLE_ERROR_REPORTING": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                    "SESSION_DIR": str(work / "sessions"), "WORKER_ARGS": "--real",
                    "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
        return [await one_run(address, work, base_env, crash=False),
                await one_run(address, work, base_env, crash=True)]
    finally:
        model.send_signal(signal.SIGKILL)
        server.terminate()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
