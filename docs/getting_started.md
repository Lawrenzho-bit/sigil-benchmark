# Getting Started

## What This Is

The Sigil Benchmark is a v0 scaffold for the Production Readiness Score (PRS).
It implements a portion of the PRS v0.4 methodology and provides a foundation
for a technical contractor or co-founder to extend into a production benchmark.

**This is NOT yet a runnable benchmark.** It's a structured starting point.

## What Works Today

Without any further development, you can:

1. **Read the methodology** at `../memory/project_prs_methodology_v04.md`
2. **Inspect the Task 1 specification** at `tasks/task_01_b2b_portal/`
3. **Inspect the scoring rubric** at `tasks/shared/scoring_rubric_v04.yaml`
4. **Send Task 1 prompts to Claude** via the `ClaudeAdapter` (requires `ANTHROPIC_API_KEY`)
5. **Score the resulting code** through Semgrep + npm audit + gitleaks (if installed locally)
6. **Compute bootstrap CIs and BH correction** via the statistics module

## What Doesn't Work Yet

- Deployment to Modal (stub only)
- 7 of 10 Security sub-components (stubbed)
- All of Production Ops / Scalability / Compliance / Cost Efficiency dimensions
- OpenAI / GPT tool adapter
- Manual tools' output collection workflow
- Dashboard / leaderboard
- IRT model fitting (needs data)
- Factor analysis (needs data)
- Pre-registration submission to OSF
- Long-term archival

## Quickstart (Smoke Test)

Even with all the stubs, you can verify the scaffolding works:

```bash
# From repo root
cd sigil-benchmark

# Install (Python 3.11+)
pip install -e .

# Copy and fill in environment variables
cp .env.example .env
# At minimum, set ANTHROPIC_API_KEY in .env

# List available tasks
sigil-bench list-tasks

# List available tools
sigil-bench list-tools

# Run a smoke test (1 run, Claude on Task 1)
sigil-bench smoke --task task_01_b2b_portal --tool claude-sonnet-4-5 --variant terse
```

If everything is configured correctly, this will:
1. Send the Task 1 terse prompt to Claude
2. Get back a (large) codebase response
3. Parse files from the response
4. Attempt deployment (will fail with v0 stub message)
5. Run Security scoring against the parsed files (Semgrep + others if installed)
6. Save results to `results/smoke-test/`

The deployment step will fail in v0 — that's expected. The interesting output
is the scoring step.

## Path to a Real Pilot

To go from this scaffold to a publishable preliminary benchmark:

**Person-effort estimate:** 1 senior engineer × 12-20 weeks
**Cost estimate:** $15-40k (engineer + API credits + cloud compute)

See `docs/architecture.md` § "Build Order Recommendation" for the sprint plan.

## For Non-Technical Founders

If you're the founder and not the engineer, here's how to use this:

### To validate the methodology yourself this week

1. Read the methodology (`../memory/project_prs_methodology_v04.md`)
2. Open a tool (Cursor or Bolt or Lovable)
3. Paste in the terse Task 1 prompt
4. Save the output to a folder
5. Open the acceptance criteria
6. Walk through it manually, checking each item
7. Score using the rubric (use Claude to help analyze code if needed)
8. Repeat with 2 more tools

You'll get a real preliminary scoring. You'll find rubric items that are
unclear (note them — they're feedback for v0.5).

### To recruit a technical co-founder or contractor

Show them this scaffold. Specifically:

- `README.md` — describes the project
- `docs/architecture.md` — shows the technical design
- `harness/orchestrator.py` — shows the engineering approach
- `harness/scoring/security.py` — shows what implemented scoring looks like
- `tasks/task_01_b2b_portal/` — shows the standard of task specification

The scaffold demonstrates engineering seriousness. It's far more credible
than a methodology document alone.

### To pitch this to investors

The scaffold + methodology together demonstrate:
- Real technical work, not just slideware
- A reproducible plan to build the Sigil Index
- Engineering taste (the design is defensible)
- Operational scale of what's being committed to

## License

Apache 2.0. The intent is that this code lives under Sigil Foundation governance
once the Foundation is incorporated. Open methodology + open code + open data.

## Questions

This is a v0 scaffold. Many design decisions are open. Document open questions
as you discover them in `docs/open_questions.md` (to be created) for TSC review.
