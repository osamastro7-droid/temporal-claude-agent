"""Start a refund request, approve it like a manager would, print what happened."""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid

from temporalio.client import Client

from refund_agent import shop
from refund_agent.workflows import MANAGER, RefundAgentWorkflow


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--address", default="localhost:7233")
    parser.add_argument("--task-queue", default="refunds")
    parser.add_argument("--reject", action="store_true")
    args = parser.parse_args()
    client = await Client.connect(args.address)
    handle = await client.start_workflow(
        RefundAgentWorkflow.run, "Order A-1001 arrived broken, I want my money back.",
        id=f"refund-{uuid.uuid4().hex[:8]}", task_queue=args.task_queue)
    print("started", handle.id)
    while not (pending := await handle.query(RefundAgentWorkflow.pending_approvals)):
        await asyncio.sleep(0.3)
    print("waiting for a manager:", json.dumps(pending[0]["input"]))
    await handle.execute_update(RefundAgentWorkflow.review, args=[pending[0]["id"], not args.reject, MANAGER])
    print("result:", await handle.result())
    for call in await handle.query(RefundAgentWorkflow.tool_calls):
        print(f"  {call['name']:<14} {call['status']}")
    print(f"cost: ${await handle.query(RefundAgentWorkflow.cost_usd):.2f} | refunds in ledger: {len(shop.read('refunds.jsonl'))}")


if __name__ == "__main__":
    asyncio.run(main())
