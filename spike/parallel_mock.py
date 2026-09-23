"""Fake model that asks for TWO tools in one message, like real Claude often does.

It then re-asks for any lookup it did not get a good result for, and finishes when it
has both. Strict API rules apply (see mock_model.validate).
"""

import json
from typing import Any

from spike import mock_model as mock

NEEDED = ("A-1001", "A-1002")


def decide(body: dict[str, Any]) -> list[dict[str, Any]]:
    inputs: dict[str, dict[str, Any]] = {}
    done: set[str] = set()
    for m in body.get("messages", []):
        for b in m.get("content") if isinstance(m.get("content"), list) else []:
            if b.get("type") == "tool_use":
                inputs[b["id"]] = b.get("input", {})
            elif b.get("type") == "tool_result" and not b.get("is_error"):
                done.add(inputs.get(b.get("tool_use_id"), {}).get("order_id", "?"))
    if not inputs:
        return [{"type": "tool_use", "id": f"toolu_par{x}", "name": "mcp__durable__look_up_order",
                 "input": {"order_id": o}} for x, o in zip("AB", NEEDED)]
    missing = [o for o in NEEDED if o not in done]
    if missing:
        return [{"type": "tool_use", "id": f"toolu_retry{len(inputs)}", "name": "mcp__durable__look_up_order",
                 "input": {"order_id": missing[0]}}]
    return [{"type": "text", "text": "FINAL: looked up " + ", ".join(NEEDED)}]


def install() -> int:
    def do_POST(self: Any) -> None:
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        mock.LOG.append({"path": self.path, "body": body})
        if not self.path.startswith("/v1/messages") or "count_tokens" in self.path:
            return self._json({"input_tokens": 10} if "count_tokens" in self.path else {})
        if mock.reject_if_invalid(self, body):
            return
        durable = any(str(t.get("name", "")).startswith("mcp__durable__") for t in body.get("tools") or [])
        out = decide(body) if durable else [{"type": "text", "text": "ok"}]
        stop = "tool_use" if out[0]["type"] == "tool_use" else "end_turn"
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("connection", "close")
        self.end_headers()

        def ev(name: str, data: dict[str, Any]) -> None:
            self.wfile.write(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode())
            self.wfile.flush()

        ev("message_start", {"type": "message_start", "message": {"id": "msg_par", "type": "message",
            "role": "assistant", "model": body.get("model", "m"), "content": [], "stop_reason": None,
            "stop_sequence": None, "usage": {"input_tokens": 5, "output_tokens": 1}}})
        for i, b in enumerate(out):
            if b["type"] == "text":
                ev("content_block_start", {"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}})
                ev("content_block_delta", {"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": b["text"]}})
            else:
                ev("content_block_start", {"type": "content_block_start", "index": i, "content_block": {
                    "type": "tool_use", "id": b["id"], "name": b["name"], "input": {}}})
                ev("content_block_delta", {"type": "content_block_delta", "index": i, "delta": {
                    "type": "input_json_delta", "partial_json": json.dumps(b["input"])}})
            ev("content_block_stop", {"type": "content_block_stop", "index": i})
        ev("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
                             "usage": {"output_tokens": 9}})
        ev("message_stop", {"type": "message_stop"})
        self.close_connection = True

    mock.Handler.do_POST = do_POST
    return mock.start()
