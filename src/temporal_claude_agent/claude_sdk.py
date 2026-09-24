"""Real runner: drives the Claude Agent SDK and its bundled Claude Code engine.

How one segment works (every step below was tested against the real engine):

1. Durable tools are declared to Claude as in-process SDK MCP tools.
2. A settings-based PreToolUse hook answers "defer" when Claude calls one. The run
   stops and the SDK returns ResultMessage.deferred_tool_use. The Workflow runs the
   tool as a Temporal Activity.
3. The next segment resumes the session and sends the stored result as a normal
   tool_result message for that tool_use_id. Claude continues, and can pause again.
   The hook keeps answering "defer" (never "allow") for durable tools.

Why not "resume and let the hook allow a stub tool"? On that auto-resume path the
engine (2.1.277) ignores a second "defer" and turns it into an internal error. On a retry after a crash,
if the transcript already holds that tool_result, we resume without resending it.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import sys
import tempfile
import uuid
import warnings
from pathlib import Path
from typing import Any, AsyncIterator, Optional

from ._models import DeferredCall, SegmentInput, SegmentOutput, ToolOutcome

# Logins that survive resumes. A Claude app login (Keychain OAuth) does not: when the SDK resumes a
# session from a session store it copies the login without its refresh token (on purpose), so once
# the short-lived access token expires, resumed steps fail with "OAuth session expired".
ENV_AUTH = ("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY")

def _hook_command() -> str:
    """The PreToolUse command hook (a function so tests can simulate other engine behavior)."""
    return f"{shlex.quote(sys.executable)} -m temporal_claude_agent._defer_hook"


PAUSE_CONTRACT = ("Durable tools never run inside the engine (the in-engine tool only returns an error), so nothing "
                  "ran outside Temporal. This step stops instead of continuing. Use a Claude Code version that "
                  "passes the test matrix (python -m spike.real_matrix --mock).")

SERVER = "durable"
PREFIX = f"mcp__{SERVER}__"
# Tested: with parallel tool calls the engine keeps only the last paused call and drops
# the others from the history. Until that changes, ask Claude for one call at a time.
ONE_TOOL_HINT = "Call at most one tool per message, then wait for its result before calling another."


def _as_outcome(value: Any) -> ToolOutcome:
    if isinstance(value, ToolOutcome):
        return value
    return ToolOutcome(content=value.get("content"), is_error=bool(value.get("is_error")))


def _text(content: Any) -> str:
    return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, default=str)


class ClaudeAgentSdkRunner:
    def __init__(
        self,
        *,
        session_store: Any = None,
        cwd: Optional[str] = None,
        env: Optional[dict[str, str]] = None,
        cli_path: Optional[str] = None,
        extra_options: Optional[dict[str, Any]] = None,
        one_tool_at_a_time: bool = True,
        model: Optional[str] = None,
        max_budget_usd: Optional[float] = None,
    ) -> None:
        self._store = session_store
        self._cwd = cwd
        self._env = env or {}
        self._cli_path = cli_path
        self._extra = extra_options or {}
        self._one_tool = one_tool_at_a_time
        self._model = model
        self._max_budget = max_budget_usd
        self.stub_calls = 0  # should stay 0: tools never run inside the engine

        def is_set(name: str) -> bool:
            return (self._env.get(name) or os.environ.get(name, "")).lower() not in ("", "0", "false", "no")

        if session_store is not None and not any(is_set(name) for name in ENV_AUTH):
            warnings.warn("temporal-claude-agent: no API key, cloud provider, or CLAUDE_CODE_OAUTH_TOKEN is set. "
                          "A Claude app login cannot refresh itself when a session is resumed from a session "
                          "store, so long-running agents can fail with 'OAuth session expired'. Set "
                          "ANTHROPIC_API_KEY, use Bedrock/Vertex, or run `claude setup-token` and set "
                          "CLAUDE_CODE_OAUTH_TOKEN.", stacklevel=2)

    async def _already_answered(self, session_id: str, tool_use_ids: list[str]) -> bool:
        if self._store is None or not tool_use_ids:
            return False
        from claude_agent_sdk import project_key_for_directory

        entries = await self._store.load({"project_key": project_key_for_directory(self._cwd),
                                          "session_id": session_id}) or []
        dumped = [json.dumps(e) for e in entries]
        return all(any('"tool_result"' in d and tid in d for d in dumped) for tid in tool_use_ids)

    async def run(self, inp: SegmentInput, attempt: int) -> SegmentOutput:
        from claude_agent_sdk import (ClaudeAgentOptions, ResultMessage, SystemMessage, create_sdk_mcp_server,
                                      query, tool)
        from claude_agent_sdk._errors import ResultError

        injected = {k: _as_outcome(v) for k, v in inp.injected.items()}
        runner = self
        ran_inside: list[str] = []  # durable tools the engine ran itself in this step (must stay empty)

        def make_stub(spec: Any) -> Any:
            @tool(spec.name, spec.description, spec.input_schema)
            async def stub(args: dict[str, Any]) -> dict[str, Any]:
                runner.stub_calls += 1  # should never happen: the hook always defers
                ran_inside.append(spec.name)
                return {"content": [{"type": "text", "text": "This tool must run through Temporal."}], "is_error": True}

            return stub

        hook_dir = tempfile.mkdtemp(prefix="tca-hook-")
        settings_file = Path(hook_dir) / "settings.json"
        command = _hook_command()
        settings_file.write_text(json.dumps({"hooks": {"PreToolUse": [
            {"matcher": f"{PREFIX}.*", "hooks": [{"type": "command", "command": command}]}]}}))

        first = inp.segment_index == 0
        session_id = inp.session_id
        options: dict[str, Any] = dict(
            system_prompt="\n\n".join(p for p in (inp.system_prompt, ONE_TOOL_HINT if self._one_tool else None) if p) or None,
            model=inp.model or self._model,
            tools=list(inp.builtin_tools),  # no built-in Claude Code tools unless asked for
            max_turns=inp.max_turns,
            mcp_servers={SERVER: create_sdk_mcp_server(SERVER, tools=[make_stub(t) for t in inp.tools])},
            strict_mcp_config=True,
            setting_sources=[],
            allowed_tools=[PREFIX + t.name for t in inp.tools] + list(inp.builtin_tools),
            settings=str(settings_file),
            session_store=self._store,
            cwd=self._cwd,
            env={**self._env, "TCA_HOOK_DIR": hook_dir, "TCA_ANSWERED_IDS": " ".join(injected)},
            cli_path=self._cli_path,
        )
        if self._max_budget is not None:
            options["max_budget_usd"] = self._max_budget  # safety cap per segment
        prompt: Any
        if first:
            if attempt > 1:  # a crashed first segment may have left a partial transcript: start clean
                session_id = str(uuid.uuid5(uuid.UUID(inp.session_id), f"attempt-{attempt}"))
            options["session_id"] = session_id
            prompt = inp.prompt or ""
        else:
            options["resume"] = session_id
            if attempt > 1 and await self._already_answered(session_id, list(injected)):
                prompt = ""  # the tool_result is already in the transcript: plain resume
            else:
                prompt = self._tool_results(session_id, injected)
        options.update(self._extra)

        result: Any = None
        engine_version = "(unknown version)"
        paused_by_hook: Optional[str] = None
        try:
            async for message in query(prompt=prompt, options=ClaudeAgentOptions(**options)):
                if isinstance(message, SystemMessage) and message.subtype == "init":
                    engine_version = str(message.data.get("claude_code_version") or engine_version)
                if isinstance(message, ResultMessage):
                    result = message
            marker = Path(hook_dir) / "paused_call"  # written by the hook when it defers a new call
            if marker.exists():
                paused_by_hook = marker.read_text().strip() or None
        except ResultError as err:
            if not any(word in str(err) for word in ("maximum number of turns", "budget")):
                raise  # other engine errors: let Temporal retry the segment
            return SegmentOutput(session_id=session_id, is_error=True, error=str(err))  # retrying will not help
        finally:
            shutil.rmtree(hook_dir, ignore_errors=True)

        if result is None:
            return SegmentOutput(session_id=session_id, is_error=True, error="Claude returned no result message")
        sid = result.session_id or session_id
        cost = float(result.total_cost_usd or 0.0)
        deferred = result.deferred_tool_use
        broken = self._pause_contract_problem(ran_inside, paused_by_hook, deferred, set(injected), engine_version,
                                              getattr(result, "stop_reason", None))
        if broken:
            return SegmentOutput(session_id=sid, is_error=True, error=broken, cost_usd=cost)
        if deferred is not None:
            name = deferred.name[len(PREFIX):] if deferred.name.startswith(PREFIX) else deferred.name
            return SegmentOutput(session_id=sid, deferred=DeferredCall(id=deferred.id, name=name,
                                                                        input=dict(deferred.input)), cost_usd=cost)
        if result.is_error:
            return SegmentOutput(session_id=sid, is_error=True, error=str(result.errors or result.subtype), cost_usd=cost)
        return SegmentOutput(session_id=sid, result=result.result, cost_usd=cost)

    @staticmethod
    def _pause_contract_problem(ran_inside: list[str], paused_by_hook: Optional[str], deferred: Any,
                                answered: set[str], version: str, stop_reason: Any) -> Optional[str]:
        """Fail closed if the engine did not honor the pause. Returns an error message, or None if all is well."""
        if ran_inside:
            return (f"Claude Code {version} ran durable tool(s) {', '.join(sorted(set(ran_inside)))} inside the "
                    f"engine instead of pausing. {PAUSE_CONTRACT}")
        if deferred is not None and deferred.id in answered:
            return (f"Claude Code {version} paused again at tool call {deferred.id}, whose result was just "
                    f"delivered. {PAUSE_CONTRACT}")
        if paused_by_hook and (deferred is None or deferred.id != paused_by_hook):
            got = f"paused at {deferred.id}" if deferred is not None else "did not pause"
            return (f"The pause hook deferred tool call {paused_by_hook}, but Claude Code {version} {got} "
                    f"(stop_reason={stop_reason}). {PAUSE_CONTRACT}")
        return None

    @staticmethod
    async def _tool_results(session_id: str, injected: dict[str, ToolOutcome]) -> AsyncIterator[dict[str, Any]]:
        blocks = [{"type": "tool_result", "tool_use_id": tid, "content": _text(o.content), "is_error": o.is_error}
                  for tid, o in injected.items()]
        yield {"type": "user", "message": {"role": "user", "content": blocks},
               "parent_tool_use_id": None, "session_id": session_id}
