# Sigil Benchmark Leaderboard

**Status:** Preliminary (v0). Not an official benchmark cycle.

This page tracks scores produced by the Sigil Benchmark v0 reference implementation. Numbers here are **methodology validation runs**, not pre-registered cycles. Once independent governance is in place, official cycles can be published per [METHODOLOGY §14](METHODOLOGY.md).

---

## Disclaimer

The scores below are **single-run preliminary data points** for methodology validation. They do **not** meet PRS v0.4 statistical rigor requirements (N=50 runs, prompt variants, BH correction, etc.). They are useful only as proof-of-concept for the methodology and as seed data for first-cycle calibration.

Do not cite as authoritative.

---

## Preliminary Scores — claude-code (Claude Code CLI v2.1.144)

Generated 2026-05-19 to 2026-05-20. Static analysis only (deployment-dependent sub-components stubbed and return 0). PRS-Autonomous mode (no human review).

| Task | Composite PRS | Sec | Ops | Scale | Comp | Cost | Quality (v0.5)* | Files | Wall clock | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 — B2B SaaS Portal (terse) | **155.0** | 20 | 22 | 42 | 23 | 48 | **68** | 42 | 7m 46s | complete |
| 01 — B2B SaaS Portal (verbose) | — | — | — | — | — | — | — | 0 | 45s | **partial** (see note) |
| 01 — B2B SaaS Portal (casual) | — | — | — | — | — | — | — | 0 | 41s | **partial** (see note) |
| 02 — Internal Admin Tool (terse) | — | — | — | — | — | — | — | 0 | 54s + 108s + 806s | **failed** (see note) |
| 03 — Marketplace (terse) | **102.0** | 20 | 12 | 34 | 12 | 24 | **0** | 1 | 2m 29s | partial (1 file) |
| 04 — Customer Support (terse) | **156.0** | 18 | 26 | 42 | 16 | 54 | **60** | 40 | 20m 46s | complete |

\* **Quality** is a v0.5-candidate 6th dimension (see [METHODOLOGY §16.6](METHODOLOGY.md#166-v05-candidate-maintainabilityquality-as-6th-dimension)). Not included in composite PRS. Note that T03's Quality=0 correctly exposes the "documentation-only" output that the other dimensions partially missed.

### Notable cross-task observations

**Strong scores across all complete builds**:
- 100% OSS dependency ratio (Tasks 01, 03, 04)
- Multi-cloud portability when Dockerfile is produced (Tasks 01, 04)
- Zero high/critical CVEs at generation time (Tasks 01, 04)
- Database indexing present in all builds that include schema

**Consistent weaknesses across complete builds**:
- GDPR cookie consent: low scores across all tasks (Claude Code rarely builds functional consent UI by default)
- Observability: limited beyond `console.log` / `print()` in most outputs
- Stateless architecture: mixed — Task 04 hit 10/10 (Redis session store) but Task 01 hit 4/10
- Access controls: tasks default to "Admin/user only" rather than granular RBAC

### Task 01 Prompt-Variant Sensitivity (Methodology Finding)

The same Task 01 spec, run through three prompt phrasings, produced **wildly divergent agentic behavior**:

| Variant | Prompt size | Wall clock | Files | Status |
|---|---|---|---|---|
| **Terse** (numbered list + "Output complete codebase") | 1,145 chars | 7m 46s | **42** | ✅ complete (PRS 155) |
| **Verbose** (4,652-char detailed spec doc) | 4,652 chars | 45s | **0** | ⚠ partial |
| **Casual** ("hey, can you build me...") | 1,291 chars | 41s | **0** | ⚠ partial |

**Diagnosis**: Claude Code in agentic mode (`claude -p --permission-mode bypassPermissions`) appears to read the verbose variant as a *spec to review* rather than a *task to execute*, and the casual variant as a *conversational turn* rather than a *build request*. The terse variant's explicit closing instruction ("Output complete codebase, ready to deploy") seems to be what flips the agent into write-files mode. Both verbose and casual exit in under 1 minute — well under the 8+ minutes the terse variant takes to actually build.

**Methodology implication**: This is the single most striking real-world example of why v0.4 requires 3 prompt variants per task. Tools whose agentic behavior is highly prompt-sensitive will score very differently across variants, and a single-prompt benchmark misses this entirely. The variance across these three runs (PRS 155 vs zero output) would dominate any between-tool comparison if not measured. v0.5 prompt design should additionally test for the "imperative-build closing" pattern as a controlled variable: pair each variant with and without an explicit "create the codebase now" instruction, to isolate prompt-style sensitivity from imperative-cue sensitivity.

This is a clean falsification of the assumption that prompt-engineering differences are minor noise. They are first-order signal.

### Task 02 Failure Mode (Methodology Finding)

Task 02 (Internal Admin Tool) failed three times in a row with claude-code agentic mode:
- Run 1: 0 files in 53.9s (no files written to workdir)
- Run 2: 0 files in 107.6s (no files written to workdir)
- Run 3: 0 files in 806.0s (**non-zero exit 1** after 13.4 minutes of execution)

The third attempt is qualitatively different from the first two: the agent ran for 13 minutes — comparable to the 7-20 minutes successful T01/T04 runs take — and then exited with an error rather than producing partial output. This suggests the agent *attempted* to build but encountered a state that caused it to abort late in the process, rather than refusing early as in attempts 1 and 2.

**Diagnosis**: The terse prompt frames the task as building "for an existing SaaS company." Claude Code's agentic mode appears to interpret this as needing context from existing code that doesn't exist in the empty workdir, and either exits quickly (attempts 1-2) or works long but ultimately errors out (attempt 3). A direct command-line invocation with the same prompt (outside the smoke harness) does produce a starter scaffold, suggesting the issue is sensitive to invocation context.

**Methodology implication**: Task prompts that imply pre-existing context can confound agentic-mode evaluation. v0.5 prompt design should explicitly state "create from scratch in this empty directory" for tasks intended to test greenfield agentic behavior. Also: the **bimodal failure pattern** (fast refusal vs. long-running error) is itself signal — a future Failure Mode Index could distinguish "tool declined to attempt" from "tool attempted but couldn't complete." This is a real diagnostic finding from the v0 scaffold — the kind of issue N=50 runs across N>1 tools would surface systematically.

### Task 03 Partial Build (Methodology Finding)

Task 03 (Marketplace) returned only **1 file** in 149s with PRS=102. The single file scored surprisingly high on dimensions like database indexing (10/10), CDN configuration (8/10), and audit logging (6/10).

**Diagnosis**: Static-analysis pattern matching can be triggered by *mentions* of these capabilities in a document file (e.g., a README, design doc, or spec). The file Claude produced is likely a planning document that names many capabilities without implementing them.

**Methodology implication**: v0.4's static-analysis-only sub-components risk false positives when scoring documentation rather than code. v0.5 should require minimum file count thresholds or distinguish source files from documentation in pattern-match scoring. The deployment-dependent sub-components (load tests, OWASP probes, functional compliance verification) would catch this naturally because empty endpoints don't pass tests. Another argument for getting deployment-tier scoring implemented.

---

## Per-Task Detail

### Task 01 — B2B SaaS Portal

[Full scoring data](results/smoke-claude-code-task_01_b2b_portal-terse/scoring.json)
[Generated codebase (42 files)](results/smoke-claude-code-task_01_b2b_portal-terse/output_files/)

Real strengths Sigil detected:
- Audit logging (10/10): immutable, actor+action+target captured
- Database indexing (10/10): indexes on all queried columns
- Multi-cloud portability (10/10): Dockerfile runs on 5+ platforms
- Dependency CVEs (10/10): zero high/critical
- Secret management (10/10): all secrets in env vars

Real weaknesses Sigil flagged:
- GDPR cookie consent (1/10): not implemented at all — claude-code built production auth + Stripe + audit but forgot cookie consent entirely
- Time correctness (2/10): mixed timezone handling
- Stateless architecture (4/10): mostly stateful, won't scale horizontally
- Observability (4/10): unstructured logs only

### Task 03 — Marketplace

[Full scoring data](results/smoke-claude-code-task_03_marketplace-terse/scoring.json)
[Single file output](results/smoke-claude-code-task_03_marketplace-terse/output_files/)

This score should be interpreted with caution — see the Task 03 Partial Build note above.

### Task 04 — Customer Support Tool

[Full scoring data](results/smoke-claude-code-task_04_support-terse/scoring.json)
[Generated codebase (40 files)](results/smoke-claude-code-task_04_support-terse/output_files/)

Notable strengths:
- Stateless architecture (10/10): Redis-backed session store
- Resource right-sizing (10/10): containers sized to workload
- 100% OSS dependency ratio
- Multi-cloud portability (10/10)
- Health checks (8/10): `/health` with dependency checks
- DB connection pooling (8/10): pool configured

Notable weaknesses:
- Access controls (2/10): only admin/user role
- Audit logging (4/10): some actions logged, no immutability
- Time correctness (6/10): UTC storage only, no TZ display
- Async processing (2/10): blocking but threaded

---

## What's Missing for an Official Pre-Registered Cycle

| Requirement | Status |
|---|---|
| N=50 runs per condition | ❌ Single run per task (3 runs only for T02 retry) |
| 3 prompt variants per task | ⚠ Partial (T01 tested all three; T02/T03/T04 terse only) |
| PRS-Autonomous + PRS-Reviewed modes | ❌ Autonomous only |
| Safety Refusal Rate (SRR) | ❌ Not tested |
| Bootstrap percentile CIs | ❌ Insufficient N |
| Benjamini-Hochberg correction | ❌ No multi-comparison |
| Pre-registration on OSF | ❌ Not pre-registered |
| 10 tasks | ❌ 4 tasks specified |
| 30% held-out test set | ❌ All test cases public |
| Multiple tools | ❌ Single tool (claude-code only) |
| Independent governance sign-off | ❌ Not established |
| Independent audit | ❌ Not audited |

The methodology is fully specified ([METHODOLOGY.md](METHODOLOGY.md)). The infrastructure to run a proper cycle exists. What's missing is the operational discipline (independent governance, OSF pre-registration, multiple tools) and the compute budget for N=50 runs × multiple tools × multiple variants.

---

## Reproducing These Scores

```bash
# Prerequisites: Python 3.11+, `claude` CLI (npm install -g @anthropic-ai/claude-code)
# Authenticated via `claude` (interactive one-time login)

git clone https://github.com/Lawrenzho-bit/sigil-benchmark.git
cd sigil-benchmark
pip install -e .

# Run against any task (terse | verbose | casual)
python scripts/smoke_claude_code.py --task task_01_b2b_portal --variant terse
python scripts/smoke_claude_code.py --task task_04_support --variant terse
```

Scores will vary run-to-run (LLM stochasticity). The Task 02 failure and Task 03 minimal-output are real diagnostics; both should reproduce, but with some probability of producing different results across runs.

This is **the reason** N=50 is the methodology requirement.

---

## Submitting a Tool for Scoring

This is an open repository — anyone can:

1. Fork it
2. Add a tool adapter under [`harness/tools/`](harness/tools/)
3. Run it against the tasks
4. Submit a PR with your results

See [CONTRIBUTING.md](CONTRIBUTING.md).

If/when an independent governing body is established, a formal submission process will be published. Until then, community submissions are welcomed via PR.
