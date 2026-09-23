"""Milestone 1 checks, run against the REAL Claude Code engine (bundled in claude-agent-sdk).

--mock : use the fake model in mock_model.py (no account needed)
default: use your real Claude login or ANTHROPIC_API_KEY
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from temporal_claude_agent import FileSessionStore, SegmentInput, ToolOutcome, ToolSpec
from temporal_claude_agent.claude_sdk import ClaudeAgentSdkRunner

TOOLS = [ToolSpec("issue_refund", "Refund money to the customer for an order. Always use this tool for refunds.",
                  {"type": "object", "properties": {"order_id": {"type": "string"}, "amount": {"type": "number"}},
                   "required": ["order_id", "amount"]})]
PROMPT = "Order A-1001 (49.99 EUR) arrived broken. Refund it now using the issue_refund tool, then confirm."
STORED = {"refund_id": "R-777", "amount": 49.99}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mock", action="store_true")
    parser.add_argument("--model", default=None)
    args = parser.parse_args()
    work = Path(tempfile.mkdtemp(prefix="m1-"))
    (work / "cwd").mkdir()
    env = {"DISABLE_TELEMETRY": "1", "DISABLE_ERROR_REPORTING": "1", "DISABLE_AUTOUPDATER": "1",
           "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "NO_PROXY": "127.0.0.1,localhost",
           "no_proxy": "127.0.0.1,localhost"}
    mock = None
    if args.mock:
        from spike import mock_model as mock  # type: ignore
        env.update({"ANTHROPIC_BASE_URL": f"http://127.0.0.1:{mock.start()}", "ANTHROPIC_API_KEY": "sk-ant-mock-not-real"})
    store = FileSessionStore(work / "store")
    stderr_lines: list[str] = []

    def runner(config_dir: Path) -> ClaudeAgentSdkRunner:
        return ClaudeAgentSdkRunner(session_store=store, cwd=str(work / "cwd"),
                                    env={**env, "CLAUDE_CONFIG_DIR": str(config_dir)},
                                    extra_options={"stderr": stderr_lines.append})

    report: list[str] = []

    def check(name: str, ok: bool, detail: str) -> None:
        report.append(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")
        print(report[-1], flush=True)

    # CHECK 1: defer stops the run and hands us the tool call
    cfg_a = work / "cfg-a"
    seg1 = await runner(cfg_a).run(SegmentInput(session_id=str(uuid.uuid4()), prompt=PROMPT, tools=TOOLS,
                                                model=args.model, segment_index=0), attempt=1)
    check("1 defer", seg1.deferred is not None and seg1.deferred.name == "issue_refund",
          f"deferred={seg1.deferred} error={seg1.error}")
    if seg1.deferred is None:
        print("\n".join(stderr_lines[-15:]))
        return

    # CHECK 2: resume, Claude receives OUR stored result (the side effect never runs inside the CLI)
    seg2 = await runner(cfg_a).run(SegmentInput(session_id=seg1.session_id, prompt=None, tools=TOOLS, model=args.model,
                                                injected={seg1.deferred.id: ToolOutcome(STORED)}, segment_index=1),
                                   attempt=1)
    r2 = runner(cfg_a)
    seg2 = await r2.run(SegmentInput(session_id=seg1.session_id, prompt=None, tools=TOOLS, model=args.model,
                                     injected={seg1.deferred.id: ToolOutcome(STORED)}, segment_index=1), attempt=1)
    check("2 inject", bool(seg2.result) and "R-777" in seg2.result and r2.stub_calls == 0,
          f"result={seg2.result!r} engine ran the tool itself: {r2.stub_calls} times")

    # CHECK 3: a brand new machine (empty config dir) resumes from the SessionStore only
    cfg_b, cfg_c = work / "cfg-b", work / "cfg-c"
    s1 = await runner(cfg_b).run(SegmentInput(session_id=str(uuid.uuid4()), prompt=PROMPT, tools=TOOLS,
                                              model=args.model, segment_index=0), attempt=1)
    if s1.deferred:
        s2 = await runner(cfg_c).run(SegmentInput(session_id=s1.session_id, prompt=None, tools=TOOLS, model=args.model,
                                                  injected={s1.deferred.id: ToolOutcome(STORED)}, segment_index=1),
                                     attempt=1)
        local_copy = list(cfg_c.rglob(f"{s1.session_id}.jsonl"))
        check("3 move", bool(s2.result) and "R-777" in s2.result,
              f"result={s2.result!r} error={s2.error} | store files={len(list((work / 'store').iterdir()))}")
    else:
        check("3 move", False, f"segment 1 did not defer: {s1.error}")


    # CHECK 4: the machine dies in the middle of Claude's answer; a new machine resumes and finishes
    cfg_d, cfg_e = work / "cfg-d", work / "cfg-e"
    eager = {"session_store_flush": "eager"}
    r1 = await runner(cfg_d).run(SegmentInput(session_id=str(uuid.uuid4()), prompt=PROMPT, tools=TOOLS,
                                              model=args.model, segment_index=0), attempt=1)
    if r1.deferred:
        seg_in = SegmentInput(session_id=r1.session_id, prompt=None, tools=TOOLS, model=args.model,
                              injected={r1.deferred.id: ToolOutcome(STORED)}, segment_index=1,
                              checkpoint=r1.last_message_uuid)
        if mock is not None:
            mock.HANG_ON_TOOL_RESULT = True
        crashed = False
        try:
            await asyncio.wait_for(runner(cfg_d).run(seg_in, attempt=1), timeout=6 if mock else 2)
        except asyncio.TimeoutError:
            crashed = True
        if mock is not None:
            mock.HANG_ON_TOOL_RESULT = False
        r2 = await runner(cfg_e).run(seg_in, attempt=2)
        check("4 crash mid-answer", crashed and bool(r2.result) and "R-777" in r2.result,
              f"crashed mid-answer={crashed} checkpoint={r1.last_message_uuid} result={r2.result!r} error={r2.error}")
    else:
        check("4 crash mid-answer", False, f"segment 1 did not defer: {r1.error}")

    if mock is not None:
        results = [b for e in mock.LOG for m in e["body"].get("messages", []) if m.get("role") == "user"
                   and isinstance(m.get("content"), list) for b in m["content"] if b.get("type") == "tool_result"]
        ids = sorted({b.get("tool_use_id") for b in results})
        print(f"\nmock model saw {len(mock.LOG)} requests; tool_result ids: {ids}")
    (Path(__file__).parent / "REPORT.md").write_text("# Milestone 1 checks\n\n" + "\n".join(report) + "\n")
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
