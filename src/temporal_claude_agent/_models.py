"""Plain data passed between the Workflow and the segment Activity (JSON friendly)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ToolSpec:
    """What Claude sees about a durable tool."""

    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class ToolOutcome:
    """The stored result of a durable tool call, handed back to Claude."""

    content: Any = None
    is_error: bool = False


@dataclass
class DeferredCall:
    """A tool call Claude wants to make. The Workflow runs it as its own Activity."""

    id: str
    name: str
    input: dict[str, Any]


@dataclass
class SegmentInput:
    session_id: str
    prompt: Optional[str]
    tools: list[ToolSpec]
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    max_turns: Optional[int] = None
    builtin_tools: list[str] = field(default_factory=list)
    checkpoint: Optional[str] = None
    injected: dict[str, ToolOutcome] = field(default_factory=dict)
    segment_index: int = 0


@dataclass
class SegmentOutput:
    session_id: str
    result: Optional[str] = None
    deferred: Optional[DeferredCall] = None
    last_message_uuid: Optional[str] = None
    cost_usd: float = 0.0
    is_error: bool = False
    error: Optional[str] = None
