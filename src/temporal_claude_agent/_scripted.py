"""A fake Claude for tests and demos (no API key needed).

It keeps each session in a folder, like the SDK's SessionStore, so a brand new
worker process can continue a session that a crashed worker started.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional, Union

from ._models import DeferredCall, SegmentInput, SegmentOutput, ToolOutcome


@dataclass
class ToolCall:
    name: str
    input: dict[str, Any]


@dataclass
class Final:
    text: str


@dataclass
class HistoryItem:
    id: str
    name: str
    input: dict[str, Any]
    content: Any
    is_error: bool


Policy = Callable[[str, "list[HistoryItem]"], Union[ToolCall, Final]]


def _as_outcome(value: Any) -> ToolOutcome:
    if isinstance(value, ToolOutcome):
        return value
    return ToolOutcome(content=value.get("content"), is_error=bool(value.get("is_error")))


class ScriptedClaude:
    def __init__(
        self,
        policy: Policy,
        state_dir: "str | os.PathLike[str]",
        *,
        cost_per_segment: float = 0.01,
        think_seconds: float = 0.0,
    ) -> None:
        self._policy = policy
        self._dir = Path(state_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._cost = cost_per_segment
        self._think = think_seconds

    def _path(self, session_id: str) -> Path:
        return self._dir / f"{session_id}.json"

    def _load(self, session_id: str) -> Optional[dict[str, Any]]:
        path = self._path(session_id)
        return json.loads(path.read_text()) if path.exists() else None

    def _save(self, session_id: str, state: dict[str, Any]) -> None:
        fd, tmp = tempfile.mkstemp(dir=self._dir)
        with os.fdopen(fd, "w") as handle:
            json.dump(state, handle)
        os.replace(tmp, self._path(session_id))

    async def run(self, inp: SegmentInput, attempt: int) -> SegmentOutput:
        state = self._load(inp.session_id) or {"prompt": inp.prompt or "", "history": [], "pending": None, "turn": 0}
        pending = state["pending"]
        if pending is not None:
            raw = inp.injected.get(pending["id"])
            if raw is None:
                # Asked again without an answer (for example a retry): same question, same id.
                return self._out(inp, state, deferred=DeferredCall(**pending), cost=0.0)
            outcome = _as_outcome(raw)
            state["history"].append({**pending, "content": outcome.content, "is_error": outcome.is_error})
            state["pending"] = None
        if self._think:
            await asyncio.sleep(self._think)
        action = self._policy(state["prompt"], [HistoryItem(**h) for h in state["history"]])
        state["turn"] += 1
        if isinstance(action, Final):
            self._save(inp.session_id, state)
            return self._out(inp, state, result=action.text)
        call = {"id": f"toolu_{inp.session_id[:8]}_{state['turn']:02d}", "name": action.name, "input": action.input}
        state["pending"] = call
        self._save(inp.session_id, state)
        return self._out(inp, state, deferred=DeferredCall(**call))

    def _out(
        self,
        inp: SegmentInput,
        state: dict[str, Any],
        *,
        result: Optional[str] = None,
        deferred: Optional[DeferredCall] = None,
        cost: Optional[float] = None,
    ) -> SegmentOutput:
        return SegmentOutput(
            session_id=inp.session_id,
            result=result,
            deferred=deferred,
            last_message_uuid=f"msg_{inp.session_id[:8]}_{state['turn']:02d}",
            cost_usd=self._cost if cost is None else cost,
        )
