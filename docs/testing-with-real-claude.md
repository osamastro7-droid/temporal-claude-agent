# Testing with real Claude

The test matrix runs 8 scenarios on every Claude model and writes a report card. The same
scenarios run in CI with a stand-in model; this guide runs them with real Claude.

## 1. Set up

```bash
# macOS: brew install temporal uv     Linux: curl -sSf https://temporal.download/cli.sh | sh
git clone https://github.com/osamastro7-droid/temporal-claude-agent && cd temporal-claude-agent
uv venv --python 3.12 && source .venv/bin/activate
uv pip install -e ".[dev]"
pytest -v                                    # expect: 17 passed
python -m spike.real_matrix --mock           # expect: 8 PASS (stand-in model)
```

## 2. Connect real Claude (pick one)

**An Anthropic API key (recommended):**

```bash
export ANTHROPIC_API_KEY=sk-ant-...          # only in your terminal, never in a chat or a file
python -m spike.real_matrix --repeat 2
```

**Amazon Bedrock:** model names differ, so list yours and pass them with `--models`.

```bash
export CLAUDE_CODE_USE_BEDROCK=1 AWS_REGION=us-east-1 AWS_PROFILE=your-profile
aws bedrock list-inference-profiles --region $AWS_REGION \
  --query "inferenceProfileSummaries[?contains(inferenceProfileId, 'anthropic')].inferenceProfileId" --output text
python -m spike.real_matrix --models <your model ids, comma separated> --repeat 2
```

Tip: also set `ANTHROPIC_DEFAULT_HAIKU_MODEL` to your Haiku id; the engine uses a small model for
background tasks. Each model must be enabled for your account in the Bedrock console.

**Your own Claude subscription, for testing your own code only:**

```bash
python -m spike.engine setup-token           # a browser opens; approve with your Claude account
export CLAUDE_CODE_OAUTH_TOKEN=<the token it prints>
python -m spike.real_matrix --repeat 2
```

Anthropic does not allow products built on the Agent SDK to run on claude.ai subscription
limits unless approved, so people who use the package need an API key or a cloud provider.
A plain app login does not work for durable agents (see "Logins" in the README).

## 3. Read the report card

`spike/REAL_REPORT.md`: one row per scenario, one column per model, PASS or FAIL, cost and time.
The matrix checks the login first and stops with clear steps if it fails. A model your account
cannot use is skipped with the reason. Every Claude step is capped at 1 USD (`--max-budget-per-step`).

## Newer models need a newer engine

The engine inside claude-agent-sdk can be older than the newest models (Opus 5.5 needs Claude
Code 2.1.280 or newer). Point the tests at a newer Claude Code:

```bash
npm install --prefix .engine @anthropic-ai/claude-code@latest   # needs Node 22+
export CLAUDE_CLI_PATH=$PWD/.engine/node_modules/.bin/claude
python -m spike.engine --version
python -m spike.real_matrix --models claude-opus-5-5 --repeat 2
```

## Troubleshooting

- `login failed` or `OAuth session expired`: use one of the logins above.
- `Connection refused` in a stand-in run: a proxy or VPN setting was catching local calls; local
  calls ignore proxies now, so report it if you still see it.
- To stop a run: `Ctrl+C`.
