"""Durable Claude Agent SDK agents on Temporal.

Workflow side: DurableClaudeAgent, durable_tool.
Worker side:   ClaudeAgentPlugin with a runner (ScriptedClaude for tests,
               temporal_claude_agent.claude_sdk.ClaudeAgentSdkRunner for real Claude).
"""

from ._activity import SegmentRunner, make_segment_activity
from ._models import DeferredCall, SegmentInput, SegmentOutput, ToolOutcome, ToolSpec
from ._plugin import ClaudeAgentPlugin
from ._scripted import Final, HistoryItem, ScriptedClaude, ToolCall
from ._session_store import FileSessionStore
from ._workflow import SEGMENT_ACTIVITY_NAME, DurableClaudeAgent, DurableTool, durable_tool

__all__ = [
    "ClaudeAgentPlugin", "DeferredCall", "DurableClaudeAgent", "DurableTool", "FileSessionStore",
    "Final", "HistoryItem", "SEGMENT_ACTIVITY_NAME", "ScriptedClaude", "SegmentInput",
    "SegmentOutput", "SegmentRunner", "ToolCall", "ToolOutcome", "ToolSpec",
    "durable_tool", "make_segment_activity",
]
