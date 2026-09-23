"""Test matrix: every scenario on every Claude model, with a report card.

Real Claude (run this on your Mac):
    export ANTHROPIC_API_KEY=sk-ant-...   # recommended. Without it your Claude Code login is used
                                          # and the fresh_machine scenario is skipped.
    python -m spike.real_matrix                       # default models, 1 run of each scenario
    python -m spike.real_matrix --repeat 3            # 3 runs each (catches flaky model behavior)
    python -m spike.real_matrix --models claude-haiku-4-5-20251001 --scenarios refund_approved

Amazon Bedrock (your AWS account; model names differ, so pass them with --models):
    export CLAUDE_CODE_USE_BEDROCK=1 AWS_REGION=us-east-1 AWS_PROFILE=your-profile
    python -m spike.real_matrix --models <your Bedrock model ids, comma separated>

Fake model (no account, used to test this script itself):
    python -m spike.real_matrix --mock            # engine in Anthropic API mode
    python -m spike.real_matrix --mock-bedrock    # engine in Amazon Bedrock mode

Writes spike/REAL_REPORT.md (the report card) and spike/real_results.json (every detail).
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"
for extra in (str(EXAMPLES), str(ROOT / "tests"), str(ROOT)):
    if extra not in sys.path:
        sys.path.insert(0, extra)

from temporalio.client import Client  # noqa: E402

from refund_agent import shop  # noqa: E402
from temporal_claude_agent import FileSessionStore, SegmentInput, ToolOutcome, ToolSpec  # noqa: E402
from temporal_claude_agent.claude_sdk import ClaudeAgentSdkRunner  # noqa: E402
from test_crash import activity_completed, kill, start_worker  # noqa: E402

CLOUD_PROVIDERS = {"CLAUDE_CODE_USE_BEDROCK": "Amazon Bedrock", "CLAUDE_CODE_USE_VERTEX": "Google Vertex AI",
                   "CLAUDE_CODE_USE_FOUNDRY": "Microsoft Foundry"}
NO_CLOUD = {name: "0" for name in CLOUD_PROVIDERS}  # fake API mode must never reach a real cloud account
BEDROCK_HELP = """On Amazon Bedrock the model names are different, so pass them with --models.
List the Anthropic model IDs your account can use:
  aws bedrock list-inference-profiles --region $AWS_REGION \\
    --query "inferenceProfileSummaries[?contains(inferenceProfileId, 'anthropic')].inferenceProfileId" --output text
Then, for example:
  python -m spike.real_matrix --models us.anthropic.claude-haiku-4-5-20251001-v1:0
(copy the exact IDs from your own account; each model must be enabled in the Bedrock console)"""


def provider() -> str:
    for name, label in CLOUD_PROVIDERS.items():
        if os.environ.get(name, "").lower() in ("1", "true", "yes"):
            return label
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "API key"
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return "Claude subscription token"
    return "Claude Code login"


LOGIN_HELP = """Claude could not log in, so the tests were stopped. One-time fix for your Claude subscription:
  1) python -m spike.engine setup-token
     (a browser opens: approve with your Claude account; the terminal then prints a token)
  2) export CLAUDE_CODE_OAUTH_TOKEN=<paste the token here>     (only in this terminal, never in a chat)
  3) run the same command again. The first line should say: Auth: Claude subscription token
Or use an API key (export ANTHROPIC_API_KEY=...) or Amazon Bedrock (see RUN_ON_MAC.md)."""
AUTH_WORDS = ("authenticat", "oauth", "login", "api key", "401", "credential", "unauthorized", "expired")


async def check_login(model: Optional[str], ctx: "Ctx") -> Optional[str]:
    """One tiny request before the scenarios. Returns None when Claude answers, else the error text."""
    if ctx.fake_login_error:
        return ctx.fake_login_error
    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

    options = ClaudeAgentOptions(model=model, tools=[], setting_sources=[], max_turns=1, env=dict(ctx.env),
                                 cli_path=os.environ.get("CLAUDE_CLI_PATH") or None,
                                 system_prompt="Reply with the single word OK.",
                                 **({"max_budget_usd": ctx.budget} if ctx.budget else {}))

    async def ask() -> Any:
        found = None
        async for message in query(prompt="Are you there?", options=options):
            if isinstance(message, ResultMessage):
                found = message
        return found

    try:
        result = await asyncio.wait_for(ask(), timeout=60)
    except Exception as err:
        return f"{type(err).__name__}: {err}"
    if result is None:
        return "Claude gave no answer"
    if result.is_error:
        return str(result.errors or result.result or result.subtype)
    return None


DEFAULT_MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5-5", "claude-fable-5-1"]

SCENARIOS = {
    "pause_resume": "Claude pauses at a tool call, our stored result goes back, Claude finishes. The engine never runs the tool.",
    "fresh_machine": "The second step runs on an empty Claude folder (a new machine), from the session store only.",
    "crash_mid_answer": "The engine is killed in the middle of a step. The retry finishes the job.",
    "refund_approved": "Full agent on Temporal: look up, manager approves, refund once, email once.",
    "refund_rejected": "Full agent on Temporal: manager rejects, no money moves.",
    "crash_after_refund": "Worker killed right after the refund. A new worker finishes. The refund happened once.",
    "parallel_lookups": "Two lookups asked at once: both done, one at a time, the answer has both totals.",
    "unknown_order": "A tool error goes back to Claude: no refund, and the run still completes.",
}
ENGINE_SCENARIOS = {"pause_resume", "fresh_machine", "crash_mid_answer"}
BROKEN = "Order A-1001 arrived broken, I want my money back."
TEMPORAL_SCENARIOS = {  # name: (workflow type, request, manager approves?)
    "refund_approved": ("RefundAgentWorkflow", BROKEN, True),
    "refund_rejected": ("RefundAgentWorkflow", BROKEN, False),
    "crash_after_refund": ("RefundAgentWorkflow", BROKEN, True),
    "parallel_lookups": ("LookupAgentWorkflow",
                         "Look up orders A-1001 and A-1002 at the same time and tell me both totals.", False),
    "unknown_order": ("RefundAgentWorkflow", "Order Z-9999 arrived broken, I want my money back.", False),
}
M1_TOOLS = [ToolSpec("issue_refund", "Refund money to the customer for an order.",
                     {"type": "object", "properties": {"order_id": {"type": "string"}, "amount": {"type": "number"}},
                      "required": ["order_id", "amount"]})]
M1_PROMPT = "Order A-1001 (49.99 EUR) arrived broken. Refund it now using the issue_refund tool, then confirm the refund id."
STORED = {"refund_id": "R-777", "amount": 49.99, "status": "refunded"}
# Local calls must ignore proxy settings (a Mac VPN or proxy app can otherwise swallow them).
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))
NO_PROXY_ENV = {"NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}


@dataclass
class Ctx:
    mock: bool
    env: dict[str, str]
    address: str
    client: Any
    budget: Optional[float]
    timeout: float
    can_start_fresh: bool  # a brand new machine can log in (API key, cloud credentials, or fake model)
    mock_port: Optional[int] = None
    fake_login_error: Optional[str] = None  # tests the stop path with a real error text

    def set_hang(self, on: bool) -> None:
        if self.mock_port:
            request = urllib.request.Request(f"http://127.0.0.1:{self.mock_port}/control",
                                             data=json.dumps({"hang": on}).encode(),
                                             headers={"content-type": "application/json"})
            LOCAL.open(request, timeout=5).read()


async def engine_scenario(name: str, model: Optional[str], ctx: Ctx) -> dict[str, Any]:
    if name == "fresh_machine" and not ctx.can_start_fresh:
        return {"status": "SKIP", "why": "needs an API key or Bedrock (a brand new machine has no Claude Code login)"}
    work = Path(tempfile.mkdtemp(prefix=f"eng-{name}-"))
    store = FileSessionStore(work / "store")
    runners: list[ClaudeAgentSdkRunner] = []

    def runner(config_dir: Optional[Path] = None) -> ClaudeAgentSdkRunner:
        env = dict(ctx.env)
        if config_dir is not None:
            env["CLAUDE_CONFIG_DIR"] = str(config_dir)
        made = ClaudeAgentSdkRunner(session_store=store, cwd=str(work), env=env, model=model,
                                    max_budget_usd=ctx.budget, cli_path=os.environ.get("CLAUDE_CLI_PATH") or None)
        runners.append(made)
        return made

    try:
        first_machine = work / "machine-1" if name == "fresh_machine" else None
        seg1 = await runner(first_machine).run(SegmentInput(session_id=str(uuid.uuid4()), prompt=M1_PROMPT,
                                                            tools=M1_TOOLS, segment_index=0), 1)
        cost = seg1.cost_usd
        if seg1.deferred is None or seg1.deferred.name != "issue_refund":
            return {"status": "FAIL", "cost": cost,
                    "why": f"Claude did not pause at issue_refund (answer={seg1.result!r}, error={seg1.error})"}
        step2 = SegmentInput(session_id=seg1.session_id, prompt=None, tools=M1_TOOLS,
                             injected={seg1.deferred.id: ToolOutcome(STORED)}, segment_index=1)
        notes: list[str] = []
        if name == "crash_mid_answer":
            ctx.set_hang(True)
            try:
                await asyncio.wait_for(runner().run(step2, 1), timeout=6 if ctx.mock else 3)
                notes.append("the step finished before the crash timer (fast model); retried anyway")
            except asyncio.TimeoutError:
                notes.append("engine killed in the middle of the step")
            finally:
                ctx.set_hang(False)
            seg2 = await runner().run(step2, 2)
        elif name == "fresh_machine":
            seg2 = await runner(work / "machine-2").run(step2, 1)
        else:
            seg2 = await runner().run(step2, 1)
        cost += seg2.cost_usd
        engine_ran_tools = sum(r.stub_calls for r in runners)
        ok = bool(seg2.result) and not seg2.is_error and engine_ran_tools == 0
        if seg2.result and "R-777" not in seg2.result:
            notes.append("the final answer did not quote the refund id R-777")
        why = "" if ok else f"answer={seg2.result!r} error={seg2.error} engine ran tools itself={engine_ran_tools}"
        return {"status": "PASS" if ok else "FAIL", "why": why, "cost": cost, "final": seg2.result, "notes": notes}
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def temporal_scenario(name: str, model: Optional[str], ctx: Ctx) -> dict[str, Any]:
    workflow_type, request, approve = TEMPORAL_SCENARIOS[name]
    work = Path(tempfile.mkdtemp(prefix=f"tmp-{name}-"))
    os.environ["SHOP_DIR"] = str(work / "shop")
    queue = f"matrix-{name}-{uuid.uuid4().hex[:6]}"
    env = {**ctx.env, "SHOP_DIR": str(work / "shop"), "WORKER_ARGS": "--real",
           "SESSION_DIR": str(work / "sessions"), "TCA_HOOK_LOG": str(work / "hook.log")}
    if model:
        env["CLAUDE_MODEL"] = model
    if ctx.budget:
        env["MAX_SEGMENT_BUDGET_USD"] = str(ctx.budget)
    workers = [start_worker(ctx.address, queue, env, work / "worker-1.log")]
    handle = await ctx.client.start_workflow(workflow_type, request, id=queue, task_queue=queue)
    decided: set[str] = set()
    approvals: list[str] = []
    killed, status = False, "TIMEOUT"
    result: Optional[str] = None
    error: Optional[str] = None
    calls: list[dict[str, Any]] = []
    cost = 0.0
    started = time.monotonic()
    try:
        while time.monotonic() - started < ctx.timeout:
            description = await handle.describe()
            if description.status.name != "RUNNING":
                status = description.status.name
                break
            for pending in await handle.query("pending_approvals"):
                if pending["id"] not in decided:
                    decided.add(pending["id"])
                    approvals.append(pending["name"])
                    await handle.execute_update("review", args=[pending["id"], approve, "manager@shop.example"])
            if name == "crash_after_refund" and not killed and await activity_completed(handle, "issue_refund"):
                kill(workers[-1])
                killed = True
                workers.append(start_worker(ctx.address, queue, env, work / "worker-2.log"))
            await asyncio.sleep(0.3)
        if status == "TIMEOUT":
            await handle.terminate("matrix timeout")
        else:
            try:
                result = await handle.result()
            except Exception as err:  # the workflow failed: keep the reason
                error = f"{type(err).__name__}: {getattr(err, 'cause', None) or err}"
            calls = await handle.query("tool_calls")
            cost = await handle.query("cost_usd")
    finally:
        for worker in workers:
            if worker.poll() is None:
                kill(worker)

    executions = shop.read("executions.jsonl")
    runs_per_call = Counter(e["key"] for e in executions)
    ran_twice = sorted(k for k, n in runs_per_call.items() if n > 1)
    per_tool = Counter(e["tool"] for e in executions)
    lookups = Counter(e.get("detail") for e in executions if e["tool"] == "look_up_order")
    refunds, emails = len(shop.read("refunds.jsonl")), len(shop.read("emails.jsonl"))
    hook_lines = (work / "hook.log").read_text().splitlines() if (work / "hook.log").exists() else []
    told_to_wait = sum(1 for line in hook_lines if line.endswith(" deny"))
    shutil.rmtree(work, ignore_errors=True)

    checks = [("workflow completed", status == "COMPLETED"), ("no tool call ran twice", not ran_twice)]
    if name == "refund_approved":
        checks += [("manager was asked", len(approvals) >= 1), ("refunded exactly once", refunds == 1),
                   ("emailed once", emails == 1)]
    elif name == "refund_rejected":
        checks += [("manager was asked", len(approvals) >= 1),
                   ("no money moved", refunds == 0 and per_tool["issue_refund"] == 0)]
    elif name == "crash_after_refund":
        checks += [("worker was killed after the refund", killed), ("refunded exactly once", refunds == 1),
                   ("refund step ran once", per_tool["issue_refund"] == 1), ("emailed once", emails == 1)]
    elif name == "parallel_lookups":
        checks += [("both orders looked up", lookups["A-1001"] >= 1 and lookups["A-1002"] >= 1),
                   ("answer has both totals", bool(result) and "49.99" in (result or "") and "120" in (result or ""))]
    elif name == "unknown_order":
        checks += [("no money moved", refunds == 0)]

    notes = []
    if told_to_wait:
        notes.append(f"Claude asked for several tools at once; {told_to_wait} extra call(s) were told to wait and asked again")
    if len(approvals) > 1:
        notes.append(f"Claude asked the manager {len(approvals)} times")
    if name == "unknown_order" and approvals:
        notes.append("Claude tried to refund an order that does not exist (the manager rejected it)")
    if any(n > 1 for n in lookups.values()):
        notes.append(f"Claude looked up the same order more than once: {dict(lookups)}")
    failed = [label for label, ok in checks if not ok]
    return {
        "status": "PASS" if not failed else "FAIL",
        "why": ", ".join(f"NOT {label}" for label in failed) + (f" | error: {error}" if error else ""),
        "cost": float(cost or 0.0), "final": result, "notes": notes,
        "facts": {"status": status, "refunds": refunds, "emails": emails, "tool_runs": dict(per_tool),
                  "ran_twice": ran_twice, "approvals": approvals, "told_to_wait": told_to_wait,
                  "calls": [(c["name"], c["status"]) for c in calls]},
    }


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def versions() -> dict[str, str]:
    import claude_agent_sdk

    found = {"claude-agent-sdk": importlib.metadata.version("claude-agent-sdk"),
             "temporalio": importlib.metadata.version("temporalio")}
    engine = Path(os.environ.get("CLAUDE_CLI_PATH") or Path(claude_agent_sdk.__file__).parent / "_bundled" / "claude")
    try:
        found["claude-code-engine"] = subprocess.run([str(engine), "--version"], capture_output=True, text=True,
                                                     timeout=30).stdout.strip()
    except Exception:
        found["claude-code-engine"] = "unknown"
    return found


def write_report(results: list[dict[str, Any]], models: list[str], scenarios: list[str], meta: dict[str, Any]) -> Path:
    lines = ["# Test matrix: durable Claude agents on Temporal", "",
             f"Date: {meta['date']}  ", f"Auth: {meta['auth']}  ",
             f"Versions: {', '.join(f'{k} {v}' for k, v in meta['versions'].items())}  ",
             f"Runs per scenario: {meta['repeat']}", ""] + ([f"**{meta['stopped']}**", ""] if meta.get("stopped") else []) + [
             "| Scenario | " + " | ".join(models) + " |", "|---" * (len(models) + 1) + "|"]
    for scenario in scenarios:
        cells = []
        for model in models:
            rows = [r for r in results if r["model"] == model and r["scenario"] == scenario]
            counted = [r for r in rows if r["status"] != "SKIP"]
            if rows and not counted:
                cells.append("skipped")
            else:
                passed = sum(r["status"] == "PASS" for r in counted)
                cells.append(f"{'PASS' if passed == len(counted) else 'FAIL'} {passed}/{len(counted)}")
        lines.append(f"| {scenario} | " + " | ".join(cells) + " |")
    lines.append("| cost (USD) | " + " | ".join(
        f"{sum(r.get('cost') or 0 for r in results if r['model'] == m):.4f}" for m in models) + " |")
    lines.append("| time (s) | " + " | ".join(
        f"{sum(r.get('seconds') or 0 for r in results if r['model'] == m):.0f}" for m in models) + " |")
    lines += ["", "## Problems", ""]
    problems = [r for r in results if r["status"] in ("FAIL", "ERROR")]
    lines += [f"- **{r['model']} / {r['scenario']} / run {r['run']}**: {r.get('why', '')}" for r in problems] or ["None."]
    lines += ["", "## Notes (not failures)", ""]
    notes = [f"- {r['model']} / {r['scenario']} / run {r['run']}: {n}" for r in results for n in r.get("notes", [])]
    skips = [f"- {r['model']} / {r['scenario']}: skipped, {r['why']}" for r in results if r["status"] == "SKIP"]
    lines += (notes + skips) or ["None."]
    lines += ["", "## What each scenario proves", ""] + [f"- **{s}**: {SCENARIOS[s]}" for s in scenarios]
    report = Path(__file__).parent / "REAL_REPORT.md"
    report.write_text("\n".join(lines) + "\n")
    return report


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models", default=None, help="comma separated model ids (default: the Anthropic API models)")
    parser.add_argument("--scenarios", default=",".join(SCENARIOS))
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--max-budget-per-step", type=float, default=1.0, help="USD safety cap per Claude step")
    parser.add_argument("--timeout", type=float, default=300, help="seconds per Temporal scenario")
    parser.add_argument("--mock", action="store_true", help="use the fake model (no account, tests this script)")
    parser.add_argument("--mock-bedrock", action="store_true", help="fake model, engine in Amazon Bedrock mode")
    parser.add_argument("--mock-login-expired", action="store_true", help=argparse.SUPPRESS)  # tests the login check
    args = parser.parse_args()
    fake = args.mock or args.mock_bedrock or args.mock_login_expired
    auth = provider()
    if fake:
        models = ["us.anthropic.claude-haiku-4-5-20251001-v1:0" if args.mock_bedrock else "claude-haiku-4-5-20251001"]
    elif args.models:
        models = [m.strip() for m in args.models.split(",") if m.strip()]
    elif auth in CLOUD_PROVIDERS.values():
        sys.exit(BEDROCK_HELP if auth == "Amazon Bedrock" else f"On {auth}, pass your model IDs with --models.")
    else:
        models = DEFAULT_MODELS
    scenarios = [s.strip() for s in args.scenarios.split(",") if s.strip()]
    unknown = [s for s in scenarios if s not in SCENARIOS]
    if unknown:
        sys.exit(f"unknown scenarios: {unknown}. Pick from: {', '.join(SCENARIOS)}")
    cli = os.environ.get("TEMPORAL_CLI") or shutil.which("temporal")
    if not cli:
        sys.exit("The Temporal CLI was not found. Install it with: brew install temporal")

    work = Path(tempfile.mkdtemp(prefix="matrix-"))
    procs: list[subprocess.Popen] = []
    port = free_port()
    procs.append(subprocess.Popen([cli, "server", "start-dev", "--headless", "--port", str(port), "--log-level", "error"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    env: dict[str, str] = {}
    mock_port: Optional[int] = None
    if fake:
        port_file = work / "model.port"
        procs.append(subprocess.Popen(
            [sys.executable, "-m", "spike.mock_model", "--policy", "matrix", "--port-file", str(port_file)], cwd=ROOT,
            env={**os.environ, "PYTHONPATH": os.pathsep.join([str(EXAMPLES), str(ROOT), os.environ.get("PYTHONPATH", "")])}))
        while not port_file.exists() or not port_file.read_text():
            time.sleep(0.1)
        mock_port = int(port_file.read_text())
        quiet = {"DISABLE_TELEMETRY": "1", "DISABLE_ERROR_REPORTING": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                 **NO_PROXY_ENV}
        if args.mock_bedrock:
            env = {**quiet, "CLAUDE_CODE_USE_BEDROCK": "1", "AWS_REGION": "us-east-1", "CLAUDE_CODE_SKIP_BEDROCK_AUTH": "1",
                   "ANTHROPIC_BEDROCK_BASE_URL": f"http://127.0.0.1:{mock_port}"}
        else:
            env = {**quiet, **NO_CLOUD, "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{mock_port}",
                   "ANTHROPIC_API_KEY": "sk-ant-mock-not-real"}
    address = f"127.0.0.1:{port}"
    client = None
    for _ in range(80):
        try:
            client = await Client.connect(address)
            break
        except Exception:
            await asyncio.sleep(0.25)
    if client is None:
        sys.exit("The Temporal dev server did not start")
    ctx = Ctx(mock=fake, env=env, address=address, client=client,
              budget=None if fake else args.max_budget_per_step, timeout=args.timeout,
              can_start_fresh=fake or auth != "Claude Code login", mock_port=mock_port,
              fake_login_error=("ResultError: Claude Code returned an error result: Failed to authenticate: OAuth "
                                "session expired and could not be refreshed (exit code: 1)")
              if args.mock_login_expired else None)
    label = ("fake model, login expired on purpose" if args.mock_login_expired else
             "fake model, engine in Amazon Bedrock mode" if args.mock_bedrock else
             "fake model, engine in Anthropic API mode" if args.mock else auth)
    meta = {"date": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "repeat": args.repeat,
            "auth": label, "versions": versions()}
    print(f"Auth: {meta['auth']} | {meta['versions']}", flush=True)
    results: list[dict[str, Any]] = []
    login_failed: Optional[str] = None
    try:
        for model in models:
            print(f"checking that {model} answers ...", flush=True)
            problem = await check_login(model, ctx)
            if problem:
                if any(word in problem.lower() for word in AUTH_WORDS) or problem.startswith("TimeoutError"):
                    login_failed = problem
                    results += [{"status": "SKIP", "why": "login failed", "model": model, "scenario": s_,
                                 "run": 1, "seconds": 0} for s_ in scenarios]
                    print(f"   login failed: {problem[:300]}", flush=True)
                    break
                print(f"   cannot use this model, skipping it: {problem[:300]}", flush=True)
                results += [{"status": "SKIP", "why": f"model not usable: {problem[:200]}", "model": model,
                             "scenario": s_, "run": 1, "seconds": 0} for s_ in scenarios]
                continue
            print("   ok", flush=True)
            for scenario in scenarios:
                for run in range(1, args.repeat + 1):
                    began = time.monotonic()
                    print(f"running [{model}] {scenario} (run {run})", flush=True)
                    runner = engine_scenario if scenario in ENGINE_SCENARIOS else temporal_scenario
                    try:
                        outcome = await runner(scenario, model, ctx)
                    except Exception as err:  # keep going: one broken cell must not stop the matrix
                        outcome = {"status": "ERROR", "why": f"{type(err).__name__}: {err}"[:600]}
                    outcome.update(model=model, scenario=scenario, run=run, seconds=round(time.monotonic() - began, 1))
                    results.append(outcome)
                    print(f"   result: {outcome['status']} {(outcome.get('why') or '')[:160]}", flush=True)
    finally:
        if mock_port:
            try:
                stats = json.loads(LOCAL.open(f"http://127.0.0.1:{mock_port}/stats", timeout=5).read())
                meta["fake_model"] = stats
                print(f"fake model: {stats['requests']} requests, models asked for: {stats['models']}, "
                      f"API rule violations: {len(stats['errors'])}", flush=True)
            except Exception as err:  # never lose the report card over a statistics call
                print(f"(could not read fake model statistics: {err})", flush=True)
        for proc in procs:
            proc.kill()
        shutil.rmtree(work, ignore_errors=True)
    if login_failed:
        meta["stopped"] = f"Login failed: {login_failed[:300]}"
    report = write_report(results, models, scenarios, meta)
    (Path(__file__).parent / "real_results.json").write_text(json.dumps({"meta": meta, "results": results}, indent=2,
                                                                         default=str))
    print(f"\nReport card: {report}")
    if login_failed:
        print("\n" + LOGIN_HELP)


if __name__ == "__main__":
    asyncio.run(main())
