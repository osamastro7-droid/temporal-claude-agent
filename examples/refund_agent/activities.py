"""The shop's tools, as plain Temporal Activities (one dict argument each)."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from temporalio import activity
from temporalio.exceptions import ApplicationError

from refund_agent import shop


@activity.defn
async def look_up_order(args: dict[str, Any]) -> dict[str, Any]:
    """Look up an order by id. Returns item, total, currency, customer email and delivery status."""
    shop.log_execution("look_up_order", activity.info().activity_id, str(args.get("order_id", "")))
    try:
        return shop.get_order(args["order_id"])
    except KeyError:
        raise ApplicationError(f"No order with id {args.get('order_id')}", non_retryable=True)


@activity.defn
async def issue_refund(args: dict[str, Any]) -> dict[str, Any]:
    """Refund money to the customer for an order. This moves real money."""
    key = activity.info().activity_id  # "tool-<tool_use_id>": stable across retries
    shop.log_execution("issue_refund", key)
    order = shop.ORDERS.get(args.get("order_id", ""))
    amount = float(args.get("amount", 0))
    if order is None:
        raise ApplicationError(f"No order with id {args.get('order_id')}", non_retryable=True)
    if not 0 < amount <= order["total"]:
        raise ApplicationError(f"Refund of {amount} is not allowed: the order total is {order['total']}",
                               non_retryable=True)  # checked in code, not left to the model
    if activity.info().attempt <= int(os.environ.get("FAIL_REFUND_TIMES", "0")):
        raise ApplicationError("Payment provider timed out (simulated)")  # retryable
    record = shop.refund(args["order_id"], float(args["amount"]), args.get("reason", ""), idempotency_key=key)
    delay = float(os.environ.get("REFUND_DELAY", "0"))
    if delay:
        await asyncio.sleep(delay)  # money already moved, slow reply: the worst moment to crash
    return record


@activity.defn
async def email_customer(args: dict[str, Any]) -> dict[str, Any]:
    """Send an email to the customer."""
    key = activity.info().activity_id
    shop.log_execution("email_customer", key)
    return shop.send_email(args["to"], args["subject"], args["body"], idempotency_key=key)
