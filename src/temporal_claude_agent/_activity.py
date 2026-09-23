"""Activity side: runs one model segment through a pluggable runner."""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Protocol

from temporalio import activity

from ._models import SegmentInput, SegmentOutput
from ._workflow import SEGMENT_ACTIVITY_NAME


class SegmentRunner(Protocol):
    async def run(self, inp: SegmentInput, attempt: int) -> SegmentOutput: ...


def make_segment_activity(runner: SegmentRunner, *, heartbeat_every: float = 5.0) -> Callable[..., Any]:
    @activity.defn(name=SEGMENT_ACTIVITY_NAME)
    async def run_claude_segment(inp: SegmentInput) -> SegmentOutput:
        async def beat() -> None:
            while True:
                activity.heartbeat(inp.segment_index)
                await asyncio.sleep(heartbeat_every)

        beater = asyncio.create_task(beat())
        try:
            return await runner.run(inp, activity.info().attempt)
        finally:
            beater.cancel()

    return run_claude_segment
