"""Trace every hook decision per segment, for the normal 3-tool flow and the parallel flow."""
import asyncio, os, sys, tempfile, uuid
from pathlib import Path
from spike import mock_model as mock
from temporal_claude_agent import FileSessionStore, SegmentInput, ToolOutcome, ToolSpec
from temporal_claude_agent.claude_sdk import ClaudeAgentSdkRunner
mode = sys.argv[1]
if mode == "parallel":
    from spike.parallel_mock import install
    port = install()
    tools = [ToolSpec("look_up_order", "Look up.", {"type": "object", "properties": {"order_id": {"type": "string"}}})]
    prompt = "Check orders A-1001 and A-1002."
    fake = lambda name, a: {"order": a.get("order_id"), "status": "found"}
else:
    from refund_agent.fake_claude import refund_policy
    from refund_agent.workflows import ORDER, REFUND, EMAIL
    mock.POLICY = refund_policy
    port = mock.start()
    tools = [ToolSpec("look_up_order", "Look up.", ORDER), ToolSpec("issue_refund", "Refund.", REFUND), ToolSpec("email_customer", "Email.", EMAIL)]
    prompt = "Order A-1001 arrived broken, refund please."
    table = {"look_up_order": {"order_id": "A-1001", "customer": "m@x.com", "item": "Teapot", "total": 49.99, "currency": "EUR"},
             "issue_refund": {"refund_id": "R-1", "amount": 49.99}, "email_customer": {"sent": True}}
    fake = lambda name, a: table[name]
work = Path(tempfile.mkdtemp()); log = work / "hook.log"
env = {"ANTHROPIC_BASE_URL": f"http://127.0.0.1:{port}", "ANTHROPIC_API_KEY": "sk-ant-mock", "DISABLE_TELEMETRY": "1",
       "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "CLAUDE_CONFIG_DIR": str(work/"cfg"), "TCA_HOOK_LOG": str(log)}
runner = ClaudeAgentSdkRunner(session_store=FileSessionStore(work/"store"), env=env,
                              extra_options={"max_turns": 6})   # stop runaway loops quickly
async def main():
    seg = await runner.run(SegmentInput(session_id=str(uuid.uuid4()), prompt=prompt, tools=tools, segment_index=0), 1)
    i = 1
    while True:
        lines = log.read_text().split("\n") if log.exists() else []
        print(f"segment {i}: hook decisions {[l for l in lines if l]} -> {'paused at ' + seg.deferred.id if seg.deferred else 'final ' + repr(seg.result) + ' ' + str(seg.error or '')}", flush=True)
        log.write_text("")
        if not seg.deferred or i >= 5: break
        seg = await runner.run(SegmentInput(session_id=seg.session_id, prompt=None, tools=tools,
                                            injected={seg.deferred.id: ToolOutcome(fake(seg.deferred.name, seg.deferred.input))}, segment_index=i), 1)
        i += 1
asyncio.run(main())
