# Running Sigil Benchmark with Claude Code CLI

## Why use Claude Code over the API?

| | Claude Code CLI (`claude -p`) | Anthropic API (ClaudeAdapter) |
|---|---|---|
| Auth | One-time `claude` login (uses your Pro/Max subscription) | API key required (metered tokens) |
| Cost | Already paying for subscription | Per-token API costs |
| What it benchmarks | Agentic experience (Position 4 on AI-Involvement Spectrum) | Raw model output (Position 2) |
| Setup complexity | One interactive login, then automatic | API key in `.env`, billing |
| Suited for | Phase 0 / Tier 1 pilot, demos | Phase 2+ when N=50 runs needed |

For your first preliminary scoring, **Claude Code CLI is the path of least resistance**.

## One-Time Setup

The Sigil benchmark adapter calls `claude -p` as a subprocess. The CLI requires
**its own authentication token**, separate from any Claude Code session you may
already be running.

### Step 1: Find your Claude executable

If you installed Claude Code via the Anthropic desktop installer:
```
C:\Users\<you>\AppData\Roaming\Claude\claude-code\<version>\claude.exe
```

If you installed via npm:
```
npm root -g
# look in: <npm-root>/@anthropic-ai/claude-code/cli.js
```

### Step 2: Authenticate the CLI

Open a fresh terminal (not inside another Claude Code session) and run:

```
claude
```

Follow the prompts to log in via browser. This stores a token at:
- Windows: `%APPDATA%\Claude\claude-code\auth.json`
- macOS / Linux: `~/.config/claude-code/auth.json`

### Step 3: Verify

```
claude --version
# Should print something like: 2.1.128 (Claude Code)

claude -p "say hello"
# Should produce some output, not "Not logged in"
```

## Running a Smoke Test

Once authenticated:

```bash
cd C:\Users\asus\blockcode\sigil-benchmark

# Option A: via CLI command
sigil-bench smoke --task task_01_b2b_portal --tool claude-code --variant terse

# Option B: via dedicated smoke script (gives more detail)
python scripts/smoke_claude_code.py
```

Expected behavior:
1. Sigil prints the prompt + setup info
2. Spawns `claude -p` in a fresh temp dir
3. **Waits 3-10 minutes** while Claude Code agentically builds the codebase
4. Reads all files Claude Code wrote
5. Scores them across 5 PRS dimensions
6. Prints the scoring table
7. Saves results to `results/smoke-claude-code-01/`

Total time per run: **5-15 minutes** depending on task complexity.

## Common Issues

### "Not logged in · Please run /login"

You skipped the one-time `claude` interactive login. Open a fresh terminal,
run `claude` without `-p`, complete the login flow, then retry.

### Adapter says "Claude Code CLI not found"

Set the full path explicitly in `harness/tools/claude_code.py` or pass to
`ClaudeCodeAdapter(cli_path=r"C:\Users\...\claude.exe")`.

### Temp dir lock errors on Windows

Fixed in the adapter via `ignore_cleanup_errors=True`. Sigil leaves a few
empty temp dirs behind; cleanup happens periodically.

### Runs take very long / hang

Some Sigil tasks are large (Task 01 B2B portal expects ~30+ files). Claude Code
may take 10+ minutes to complete. Increase `timeout_seconds` in
`ClaudeCodeAdapter(timeout_seconds=1800)` if needed.

### Running claude -p from inside another claude session

This works but is awkward — the nested session has its own auth state.
Easiest: open a separate terminal outside any active Claude Code session
to run benchmarks.

## What to Expect Performance-Wise

A typical run on Task 01 (B2B SaaS portal):
- Wall clock: 5-15 minutes
- Files produced: 15-60
- Tokens consumed: 50k-200k (counted against your subscription quota)
- Composite PRS: 30-70 range typical for agentic single-shot output

For N=10 runs across 3 tools on 3 tasks = 90 runs:
- Wall clock: 7-25 hours sequentially (use --runs to limit)
- Subscription quota usage: significant — be mindful of your plan limits
- For higher N, switch to the API adapter (`claude-sonnet-4-5`)
