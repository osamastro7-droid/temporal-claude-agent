"""What a sensible Claude would do in this story, scripted, so tests need no API key."""

from __future__ import annotations

import re

from temporal_claude_agent import Final, HistoryItem, ToolCall


def refund_policy(prompt: str, history: list[HistoryItem]) -> "ToolCall | Final":
    if not history:
        match = re.search(r"[A-Z]-\d{4}", prompt)
        return ToolCall("look_up_order", {"order_id": match.group(0) if match else "unknown"})
    last = history[-1]
    if last.name == "look_up_order":
        if last.is_error:
            return Final(f"I could not find that order ({last.content}). Please double check the order number.")
        order = last.content
        return ToolCall("issue_refund", {"order_id": order["order_id"], "amount": order["total"],
                                         "reason": "item arrived broken"})
    if last.name == "issue_refund":
        if last.is_error:
            return Final("The refund was not approved, so no money was moved. The case stays open for review.")
        order = history[0].content
        return ToolCall("email_customer", {
            "to": order["customer"],
            "subject": f"Your refund for order {order['order_id']}",
            "body": f"We refunded {last.content['amount']} {order['currency']} (refund {last.content['refund_id']}).",
        })
    if last.name == "email_customer":
        order, refund = history[0].content, history[1].content
        return Final(f"Done. Refunded {refund['amount']} {order['currency']} for order {order['order_id']} "
                     f"(refund {refund['refund_id']}) and emailed {order['customer']}.")
    return Final("I am not sure what to do next.")
