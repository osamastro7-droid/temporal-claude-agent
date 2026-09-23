"""A fake Anthropic Messages API. Lets the real Claude Code engine run with no account.

The engine talks to it through ANTHROPIC_BASE_URL. It enforces the real API's
tool_use / tool_result pairing rules (STRICT) and can play different "Claudes":
- default: ask for the durable refund tool once, then answer with what it returned
- POLICY:  a ScriptedClaude-style policy (the refund story)
- ROUTER:  picks the behavior per request (used by the test matrix, --policy matrix)
It answers both the Anthropic API (/v1/messages, server-sent events) and the Amazon
Bedrock API (/model/<id>/invoke-with-response-stream, AWS event-stream framing).
Control endpoints: POST /control {"hang": true|false}, GET /stats.
"""

from __future__ import annotations

import itertools
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

LOG: list[dict[str, Any]] = []
ERRORS: list[str] = []
POLICY: Any = None
ROUTER: Any = None
STRICT = True
HANG_ON_TOOL_RESULT = False  # when True: stall on the answer after a tool result (simulates a crash mid-answer)
PREFIX = "mcp__durable__"
TOOL = PREFIX + "issue_refund"
_ids = itertools.count(1)


def _blocks(message: Any) -> list[dict[str, Any]]:
    return message.get("content") if message and isinstance(message.get("content"), list) else []


def validate(body: dict[str, Any]) -> Optional[str]:
    """The pairing rules the real Messages API enforces (it returns a 400 on these)."""
    msgs = [m for m in body.get("messages", []) if m.get("role") in ("user", "assistant")]
    for i, m in enumerate(msgs):
        if m["role"] == "assistant":
            uses = [b.get("id") for b in _blocks(m) if b.get("type") == "tool_use"]
            nxt = msgs[i + 1] if i + 1 < len(msgs) else None
            if uses and nxt is not None:
                got = {b.get("tool_use_id") for b in _blocks(nxt) if b.get("type") == "tool_result"}
                missing = [u for u in uses if u not in got]
                if nxt["role"] != "user" or missing:
                    return f"tool_use ids were found without tool_result blocks immediately after: {missing or uses}"
        else:
            results = [b for b in _blocks(m) if b.get("type") == "tool_result"]
            if not results:
                continue
            prev = msgs[i - 1] if i > 0 else None
            prev_uses = {b.get("id") for b in _blocks(prev) if b.get("type") == "tool_use"} \
                if prev is not None and prev["role"] == "assistant" else set()
            orphans = [b.get("tool_use_id") for b in results if b.get("tool_use_id") not in prev_uses]
            if orphans:
                return f"unexpected tool_use_id in tool_result blocks: {orphans}"
            kinds = [b.get("type") for b in _blocks(m)]
            first_other = next((k for k, kind in enumerate(kinds) if kind != "tool_result"), None)
            if first_other is not None and "tool_result" in kinds[first_other:]:
                return "tool_result blocks must come first in the user message content"
    return None


def reject_if_invalid(handler: Any, body: dict[str, Any]) -> bool:
    problem = validate(body) if STRICT else None
    if problem is None:
        return False
    ERRORS.append(problem)
    handler._json({"type": "error", "error": {"type": "invalid_request_error", "message": problem}}, status=400)
    return True


def _tool_results(body: dict[str, Any]) -> list[dict[str, Any]]:
    return [b for m in body.get("messages", []) if m.get("role") == "user" for b in _blocks(m)
            if b.get("type") == "tool_result"]


def _text_of(block_content: Any) -> str:
    if isinstance(block_content, list):
        return " ".join(x.get("text", "") for x in block_content if isinstance(x, dict))
    return str(block_content)


def _history(body: dict[str, Any]) -> tuple[dict[str, Any], list[str], list[Any]]:
    """(tool_use id -> (name, input), user texts, HistoryItem list) from the conversation."""
    from temporal_claude_agent import HistoryItem

    uses: dict[str, tuple[str, dict[str, Any]]] = {}
    texts: list[str] = []
    history: list[Any] = []
    for message in body.get("messages", []):
        content = message.get("content")
        if isinstance(content, str):
            if message.get("role") == "user":
                texts.append(content)
            continue
        for block in content or []:
            kind = block.get("type")
            if kind == "text" and message.get("role") == "user":
                texts.append(block.get("text", ""))
            elif kind == "tool_use":
                uses[block["id"]] = (block["name"], block.get("input", {}))
            elif kind == "tool_result":
                name, args = uses.get(block.get("tool_use_id"), ("?", {}))
                raw = _text_of(block.get("content"))
                try:  # the engine may append a <system-reminder> after the JSON; read only the JSON
                    value: Any = json.JSONDecoder().raw_decode(raw.strip())[0]
                except ValueError:
                    value = raw
                history.append(HistoryItem(block.get("tool_use_id"), name.replace(PREFIX, ""), args, value,
                                           bool(block.get("is_error"))))
    return uses, texts, history


def _use(name: str, args: dict[str, Any]) -> dict[str, Any]:
    return {"type": "tool_use", "id": f"toolu_mock{next(_ids):04d}", "name": PREFIX + name, "input": args}


def decide(body: dict[str, Any]) -> dict[str, Any]:
    results = _tool_results(body)
    if results:
        return {"type": "text", "text": "FINAL: the tool returned " + _text_of(results[-1].get("content"))}
    if TOOL in [t.get("name") for t in body.get("tools") or []]:
        return _use("issue_refund", {"order_id": "A-1001", "amount": 49.99})
    return {"type": "text", "text": "ok"}


def _decide_with_policy(body: dict[str, Any]) -> dict[str, Any]:
    from temporal_claude_agent import Final

    _, texts, history = _history(body)
    action = POLICY(" ".join(texts), history)
    if isinstance(action, Final):
        return {"type": "text", "text": action.text}
    return _use(action.name, action.input)


def _parallel_lookups(body: dict[str, Any]) -> list[dict[str, Any]]:
    """Behaves like Claude often does: asks for both lookups in ONE message."""
    uses, _, history = _history(body)
    wanted = ("A-1001", "A-1002")
    if not uses:
        return [_use("look_up_order", {"order_id": o}) for o in wanted]
    totals = {h.content["order_id"]: h.content["total"] for h in history
              if h.name == "look_up_order" and not h.is_error and isinstance(h.content, dict) and "order_id" in h.content}
    missing = [o for o in wanted if o not in totals]
    if missing:
        return [_use("look_up_order", {"order_id": missing[0]})]
    return [{"type": "text", "text": f"A-1001 costs {totals['A-1001']} EUR and A-1002 costs {totals['A-1002']} EUR."}]


def matrix_router(body: dict[str, Any]) -> list[dict[str, Any]]:
    durable = [str(t.get("name", "")) for t in body.get("tools") or [] if str(t.get("name", "")).startswith(PREFIX)]
    if not durable:
        return [{"type": "text", "text": "ok"}]
    if durable == [TOOL]:
        return [decide(body)]  # the Milestone 1 checks
    _, texts, _ = _history(body)
    if "both totals" in " ".join(texts):
        return _parallel_lookups(body)
    return [_decide_with_policy(body)]  # the refund story


def stream_events(body: dict[str, Any], blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    model = body.get("model", "claude-mock")
    stop = "tool_use" if any(b["type"] == "tool_use" for b in blocks) else "end_turn"
    usage = {"input_tokens": 12, "output_tokens": 1, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
    events: list[dict[str, Any]] = [{"type": "message_start", "message": {
        "id": f"msg_mock{next(_ids):04d}", "type": "message", "role": "assistant", "model": model, "content": [],
        "stop_reason": None, "stop_sequence": None, "usage": usage}}]
    for i, block in enumerate(blocks):
        if block["type"] == "text":
            events.append({"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}})
            events.append({"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": block["text"]}})
        else:
            events.append({"type": "content_block_start", "index": i, "content_block": {
                "type": "tool_use", "id": block["id"], "name": block["name"], "input": {}}})
            events.append({"type": "content_block_delta", "index": i, "delta": {
                "type": "input_json_delta", "partial_json": json.dumps(block["input"])}})
        events.append({"type": "content_block_stop", "index": i})
    events.append({"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
                   "usage": {"output_tokens": 20}})
    events.append({"type": "message_stop"})
    return events


def _full_message(body: dict[str, Any], blocks: list[dict[str, Any]]) -> dict[str, Any]:
    stop = "tool_use" if any(b["type"] == "tool_use" for b in blocks) else "end_turn"
    return {"id": f"msg_mock{next(_ids):04d}", "type": "message", "role": "assistant",
            "model": body.get("model", "claude-mock"), "content": blocks, "stop_reason": stop, "stop_sequence": None,
            "usage": {"input_tokens": 12, "output_tokens": 20}}


def write_blocks(handler: Any, body: dict[str, Any], blocks: list[dict[str, Any]]) -> None:
    """Anthropic API style: server-sent events."""
    if not body.get("stream"):
        return handler._json(_full_message(body, blocks))
    handler.send_response(200)
    handler.send_header("content-type", "text/event-stream")
    handler.send_header("connection", "close")
    handler.end_headers()
    for event in stream_events(body, blocks):
        handler.wfile.write(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n".encode())
        handler.wfile.flush()
    handler.close_connection = True


def _aws_header(name: str, value: str) -> bytes:
    import struct

    raw_name, raw_value = name.encode(), value.encode()
    return struct.pack("B", len(raw_name)) + raw_name + b"\x07" + struct.pack(">H", len(raw_value)) + raw_value


def aws_event_frame(payload: bytes, event_type: str = "chunk") -> bytes:
    """One AWS event-stream message (the binary framing Bedrock streams use)."""
    import struct
    import zlib

    headers = (_aws_header(":event-type", event_type) + _aws_header(":content-type", "application/json")
               + _aws_header(":message-type", "event"))
    prelude = struct.pack(">II", 12 + len(headers) + len(payload) + 4, len(headers))
    message = prelude + struct.pack(">I", zlib.crc32(prelude) & 0xFFFFFFFF) + headers + payload
    return message + struct.pack(">I", zlib.crc32(message) & 0xFFFFFFFF)


def write_bedrock_stream(handler: Any, body: dict[str, Any], blocks: list[dict[str, Any]]) -> None:
    """Amazon Bedrock style: each Anthropic event, base64 inside an AWS event-stream 'chunk'."""
    import base64

    handler.send_response(200)
    handler.send_header("content-type", "application/vnd.amazon.eventstream")
    handler.send_header("connection", "close")
    handler.end_headers()
    for event in stream_events(body, blocks):
        payload = json.dumps({"bytes": base64.b64encode(json.dumps(event).encode()).decode()}).encode()
        handler.wfile.write(aws_event_frame(payload))
        handler.wfile.flush()
    handler.close_connection = True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args: Any) -> None:
        pass

    def _json(self, payload: dict[str, Any], status: int = 200) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path.startswith("/inference-profiles"):
            return self._json({"inferenceProfileSummaries": []})
        if self.path.startswith("/stats"):
            models = sorted({str(e["body"].get("model")) for e in LOG if e["body"].get("tools")})
            return self._json({"requests": len(LOG), "models": models, "errors": ERRORS})
        self._json({})

    def do_POST(self) -> None:
        global HANG_ON_TOOL_RESULT
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        if self.path.startswith("/control"):
            HANG_ON_TOOL_RESULT = bool(body.get("hang"))
            return self._json({"hang": HANG_ON_TOOL_RESULT})
        bedrock = self.path.startswith("/model/")
        if bedrock:  # Amazon Bedrock: the model id is in the path, not the body
            from urllib.parse import unquote

            body = {**body, "model": unquote(self.path.split("/")[2])}
        LOG.append({"path": self.path, "body": body})
        if self.headers.get("x-api-key") == "sk-ant-expired":  # pretend the login expired
            return self._json({"type": "error", "error": {"type": "authentication_error",
                               "message": "OAuth session expired and could not be refreshed"}}, status=401)
        if "count_tokens" in self.path or "count-tokens" in self.path:
            return self._json({"input_tokens": 10, "inputTokens": 10})
        if not (self.path.startswith("/v1/messages") or bedrock):
            return self._json({})
        if reject_if_invalid(self, body):
            return
        if HANG_ON_TOOL_RESULT and _tool_results(body):
            time.sleep(120)
            return
        durable = any(str(t.get("name", "")).startswith(PREFIX) for t in body.get("tools") or [])
        if ROUTER is not None:
            blocks = ROUTER(body)
        elif POLICY is not None and durable:
            blocks = [_decide_with_policy(body)]
        else:
            blocks = [decide(body)]
        if bedrock and self.path.endswith("/invoke-with-response-stream"):
            write_bedrock_stream(self, body, blocks)
        elif bedrock:
            self._json(_full_message(body, blocks))
        else:
            write_blocks(self, body, blocks)


def start() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server.server_address[1]


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", default="refund", choices=["refund", "matrix", "simple"])
    parser.add_argument("--port-file", required=True)
    cli = parser.parse_args()
    if cli.policy in ("refund", "matrix"):
        from refund_agent.fake_claude import refund_policy

        POLICY = refund_policy
    if cli.policy == "matrix":
        ROUTER = matrix_router
    Path(cli.port_file).write_text(str(start()))
    while True:
        time.sleep(3600)
