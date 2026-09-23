"""Workflow side: the durable agent loop. Everything here must stay deterministic."""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Callable, Optional, Sequence

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

from ._models import DeferredCall, SegmentInput, SegmentOutput, ToolOutcome, ToolSpec

SEGMENT_ACTIVITY_NAME = "run_claude_segment"

_OPEN_SCHEMA: dict[str, Any] = {"type": "object", "additionalProperties": True}


@dataclass
class DurableTool:
    activity: Callable[..., Any]
    name: str
    description: str
    input_schema: dict[str, Any]
    needs_approval: bool = False
    start_to_close_timeout: timedelta = timedelta(minutes=1)
    retry_policy: Optional[RetryPolicy] = None

    def spec(self) -> ToolSpec:
        return ToolSpec(self.name, self.description, self.input_schema)


def durable_tool(
    activity_fn: Callable[..., Any],
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    input_schema: Optional[dict[str, Any]] = None,
    needs_approval: bool = False,
    start_to_close_timeout: timedelta = timedelta(minutes=1),
    retry_policy: Optional[RetryPolicy] = None,
) -> DurableTool:
    """Turn a Temporal Activity (taking one dict argument) into a tool Claude can call.

    The call runs as its own Activity with ID ``tool-<tool_use_id>``. Pass
    ``activity.info().activity_id`` to external systems as an idempotency key.
    """
    return DurableTool(
        activity=activity_fn,
        name=name or activity_fn.__name__,
        description=description or inspect.getdoc(activity_fn) or activity_fn.__name__,
        input_schema=input_schema or dict(_OPEN_SCHEMA),
        needs_approval=needs_approval,
        start_to_close_timeout=start_to_close_timeout,
        retry_policy=retry_policy,
    )


class DurableClaudeAgent:
    """Runs a Claude agent loop inside a Temporal Workflow.

    Each model segment is one Activity. Each durable tool call is its own
    Activity. Tools marked ``needs_approval`` wait for ``decide()``.
    """

    def __init__(
        self,
        *,
        system_prompt: Optional[str] = None,
        tools: Sequence[DurableTool] = (),
        model: Optional[str] = None,
        max_turns: Optional[int] = None,
        builtin_tools: Sequence[str] = (),
        segment_timeout: timedelta = timedelta(minutes=10),
        segment_heartbeat_timeout: Optional[timedelta] = timedelta(minutes=2),
        segment_retry_policy: Optional[RetryPolicy] = None,
        max_segments: int = 50,
        approvers: Optional[Sequence[str]] = None,
    ) -> None:
        self._tools = {t.name: t for t in tools}
        self._system_prompt = system_prompt
        self._model = model
        self._max_turns = max_turns
        self._builtin_tools = list(builtin_tools)
        self._segment_timeout = segment_timeout
        self._segment_heartbeat_timeout = segment_heartbeat_timeout
        self._segment_retry_policy = segment_retry_policy
        self._max_segments = max_segments
        self._approvers = set(approvers) if approvers else None
        self._decisions: dict[str, bool] = {}
        self._waiting: dict[str, DeferredCall] = {}
        self._calls: dict[str, dict[str, Any]] = {}
        self.total_cost_usd = 0.0
        self.segments = 0

    # ---- handlers the user's Workflow exposes ----
    def validate_decision(self, tool_use_id: str, approver: Optional[str] = None) -> None:
        """Raise ValueError if this decision must be refused. Call it from an Update validator:
        a refused Update is never written to the workflow history."""
        if tool_use_id not in self._waiting:
            raise ValueError(f"No tool call {tool_use_id} is waiting for approval")
        if self._approvers is not None and approver not in self._approvers:
            raise ValueError(f"{approver!r} is not allowed to approve tool calls")

    def decide(self, tool_use_id: str, approved: bool, approver: Optional[str] = None) -> None:
        self._decisions[tool_use_id] = approved
        if approver and tool_use_id in self._calls:
            self._calls[tool_use_id]["decided_by"] = approver

    def pending_approvals(self) -> list[dict[str, Any]]:
        return [{"id": c.id, "name": c.name, "input": c.input} for c in self._waiting.values()]

    @property
    def tool_calls(self) -> list[dict[str, Any]]:
        return list(self._calls.values())

    # ---- the loop ----
    async def run(self, prompt: str) -> str:
        session_id = str(workflow.uuid4())
        checkpoint: Optional[str] = None
        injected: dict[str, ToolOutcome] = {}
        for index in range(self._max_segments):
            seg: SegmentOutput = await workflow.execute_activity(
                SEGMENT_ACTIVITY_NAME,
                SegmentInput(
                    session_id=session_id,
                    prompt=prompt if index == 0 else None,
                    tools=[t.spec() for t in self._tools.values()],
                    system_prompt=self._system_prompt,
                    model=self._model,
                    max_turns=self._max_turns,
                    builtin_tools=self._builtin_tools,
                    checkpoint=checkpoint,
                    injected=injected,
                    segment_index=index,
                ),
                result_type=SegmentOutput,
                start_to_close_timeout=self._segment_timeout,
                heartbeat_timeout=self._segment_heartbeat_timeout,
                retry_policy=self._segment_retry_policy,
                summary=f"claude segment {index + 1}",
            )
            self.segments += 1
            self.total_cost_usd += seg.cost_usd
            session_id = seg.session_id or session_id
            checkpoint = seg.last_message_uuid or checkpoint
            if seg.is_error:
                raise ApplicationError(f"Claude run failed: {seg.error}", non_retryable=True)
            if seg.deferred is None:
                return seg.result or ""
            injected = {seg.deferred.id: await self._run_tool(seg.deferred)}
        raise ApplicationError(f"Stopped after {self._max_segments} segments", non_retryable=True)

    async def _run_tool(self, call: DeferredCall) -> ToolOutcome:
        self._calls[call.id] = {"id": call.id, "name": call.name, "input": call.input, "status": "started"}
        tool = self._tools.get(call.name)
        if tool is None:
            self._calls[call.id]["status"] = "unknown tool"
            return ToolOutcome(content=f"Unknown tool: {call.name}", is_error=True)
        if tool.needs_approval:
            self._waiting[call.id] = call
            self._calls[call.id]["status"] = "waiting for approval"
            await workflow.wait_condition(lambda: call.id in self._decisions)
            self._waiting.pop(call.id, None)
            if not self._decisions[call.id]:
                self._calls[call.id]["status"] = "rejected"
                return ToolOutcome(content="A human reviewer rejected this action. Do not retry it.", is_error=True)
        try:
            result = await workflow.execute_activity(
                tool.activity,
                call.input,
                activity_id=f"tool-{call.id}",
                start_to_close_timeout=tool.start_to_close_timeout,
                retry_policy=tool.retry_policy,
                summary=f"tool {call.name}",
            )
        except ActivityError as err:
            cause = err.cause
            message = cause.message if isinstance(cause, ApplicationError) else str(cause or err)
            self._calls[call.id]["status"] = "failed"
            return ToolOutcome(content=f"Tool failed: {message}", is_error=True)
        self._calls[call.id]["status"] = "done"
        return ToolOutcome(content=result)
