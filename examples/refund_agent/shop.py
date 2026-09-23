"""A tiny fake online shop. Everything is stored in JSON files so tests can inspect it."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

ORDERS: dict[str, dict[str, Any]] = {
    "A-1001": {"order_id": "A-1001", "customer": "maria@example.com", "item": "Ceramic teapot",
               "total": 49.99, "currency": "EUR", "status": "delivered, arrived broken"},
    "A-1002": {"order_id": "A-1002", "customer": "tom@example.com", "item": "Desk lamp",
               "total": 120.0, "currency": "EUR", "status": "delivered"},
}


def _dir() -> Path:
    path = Path(os.environ.get("SHOP_DIR", ".shop"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _append(name: str, record: dict[str, Any]) -> None:
    with (_dir() / name).open("a") as handle:
        handle.write(json.dumps(record) + "\n")


def read(name: str) -> list[dict[str, Any]]:
    path = _dir() / name
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def get_order(order_id: str) -> dict[str, Any]:
    return ORDERS[order_id]


def refund(order_id: str, amount: float, reason: str, idempotency_key: str) -> dict[str, Any]:
    for existing in read("refunds.jsonl"):
        if existing["idempotency_key"] == idempotency_key:
            return existing  # same key, same refund: money moves once
    record = {"refund_id": "R-" + idempotency_key[-6:], "order_id": order_id, "amount": amount,
              "reason": reason, "idempotency_key": idempotency_key}
    _append("refunds.jsonl", record)
    return record


def send_email(to: str, subject: str, body: str, idempotency_key: str) -> dict[str, Any]:
    for existing in read("emails.jsonl"):
        if existing["idempotency_key"] == idempotency_key:
            return existing
    record = {"to": to, "subject": subject, "body": body, "idempotency_key": idempotency_key}
    _append("emails.jsonl", record)
    return record


def log_execution(tool: str, key: str, detail: str = "") -> None:
    _append("executions.jsonl", {"tool": tool, "key": key, "detail": detail, "pid": os.getpid()})
