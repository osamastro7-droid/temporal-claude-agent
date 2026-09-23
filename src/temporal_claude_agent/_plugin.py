"""One-line setup: registers the segment Activity and the sandbox passthrough."""

from __future__ import annotations

import dataclasses
from typing import Any, Optional, Sequence

from temporalio.plugin import SimplePlugin
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

from ._activity import SegmentRunner, make_segment_activity

_PASSTHROUGH = "temporal_claude_agent"


class ClaudeAgentPlugin(SimplePlugin):
    def __init__(self, runner: SegmentRunner, *, heartbeat_every: float = 5.0) -> None:
        segment_activity = make_segment_activity(runner, heartbeat_every=heartbeat_every)

        def activities(existing: Optional[Sequence[Any]]) -> list[Any]:
            return [*(existing or []), segment_activity]

        def workflow_runner(existing: Any) -> Any:
            if existing is None:
                return SandboxedWorkflowRunner(
                    restrictions=SandboxRestrictions.default.with_passthrough_modules(_PASSTHROUGH)
                )
            if isinstance(existing, SandboxedWorkflowRunner):
                return dataclasses.replace(
                    existing, restrictions=existing.restrictions.with_passthrough_modules(_PASSTHROUGH)
                )
            return existing

        super().__init__("temporal-claude-agent", activities=activities, workflow_runner=workflow_runner)
