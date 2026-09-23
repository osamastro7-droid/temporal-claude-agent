"""Run the refund agent worker. Fake Claude by default, real Claude with --real."""

from __future__ import annotations

import argparse
import asyncio
import os

from temporalio.client import Client
from temporalio.worker import Worker

from temporal_claude_agent import ClaudeAgentPlugin, FileSessionStore, ScriptedClaude

from refund_agent.activities import email_customer, issue_refund, look_up_order
from refund_agent.fake_claude import refund_policy
from refund_agent.workflows import LookupAgentWorkflow, RefundAgentWorkflow


def build_runner(real: bool):
    if real:
        from temporal_claude_agent.claude_sdk import ClaudeAgentSdkRunner

        budget = os.environ.get("MAX_SEGMENT_BUDGET_USD")
        return ClaudeAgentSdkRunner(session_store=FileSessionStore(os.environ.get("SESSION_DIR", ".sessions")),
                                    model=os.environ.get("CLAUDE_MODEL") or None,
                                    cli_path=os.environ.get("CLAUDE_CLI_PATH") or None,
                                    max_budget_usd=float(budget) if budget else None)
    return ScriptedClaude(refund_policy, os.environ.get("FAKE_STATE_DIR", ".fake_claude"),
                          think_seconds=float(os.environ.get("FAKE_THINK", "0")))


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--address", default="localhost:7233")
    parser.add_argument("--task-queue", default="refunds")
    parser.add_argument("--real", action="store_true")
    args = parser.parse_args()
    args.real = args.real or "--real" in os.environ.get("WORKER_ARGS", "")
    client = await Client.connect(args.address)
    worker = Worker(client, task_queue=args.task_queue, workflows=[RefundAgentWorkflow, LookupAgentWorkflow],
                    activities=[look_up_order, issue_refund, email_customer],
                    plugins=[ClaudeAgentPlugin(build_runner(args.real), heartbeat_every=1.0)])
    print("worker ready", flush=True)
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
