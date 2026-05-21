# Sigil Benchmark Leaderboard

**Status:** Preliminary (v0). Not an official benchmark cycle.

This page tracks scores produced by the Sigil Benchmark v0 reference implementation. Numbers here are **methodology validation runs**, not pre-registered cycles. Once independent governance is in place, official cycles can be published per [METHODOLOGY §14](METHODOLOGY.md).

---

## Disclaimer

The scores below are **single-run preliminary data points** for methodology validation. They do **not** meet PRS v0.4 statistical rigor requirements (N=50 runs, prompt variants, BH correction, etc.). They are useful only as proof-of-concept for the methodology and as seed data for first-cycle calibration.

Do not cite as authoritative.

---

## Preliminary Scores — claude-code (Claude Code CLI v2.1.144 / v2.1.145)

Generated 2026-05-19 to 2026-05-21. Static analysis only (deployment-dependent sub-components stubbed and return 0). PRS-Autonomous mode (no human review).

**Two configurations are reported:**

- **no-NI** — prompt run as written, no execution instruction appended. Reflects the variant's behavior on agentic claude-code at default settings.
- **+NI** — prompt run with `tasks/shared/non_interactive_suffix.md` appended (the `--non-interactive` smoke-script flag). Recommended for batch benchmarking; see the "Non-Interactive Suffix Discovery" methodology finding below.

| Task / Variant | Cfg | PRS | Sec | Ops | Scale | Comp | Cost | Quality* | Files | Wall clock | Run | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 — B2B Portal (terse) | no-NI | **155.0** | 20 | 22 | 42 | 23 | 48 | **68** | 42 | 7m 46s | 1 | complete |
| 01 — B2B Portal (terse) | no-NI | — | — | — | — | — | — | — | 0 | 33s | 2 | silent_decline |
| 01 — B2B Portal (terse) | no-NI | — | — | — | — | — | — | — | 0 | 48s | 3 | silent_decline |
| 01 — B2B Portal (terse) | no-NI | — | — | — | — | — | — | — | 0 | 52s | 4 | silent_decline |
| 01 — B2B Portal (terse) | +NI | — | — | — | — | — | — | — | 0 | 39s | 1 | silent_decline |
| 01 — B2B Portal (terse) | +NI | — | — | — | — | — | — | — | 0 | 44s | 2 | silent_decline |
| 01 — B2B Portal (verbose) | no-NI | — | — | — | — | — | — | — | 0 | 45s | 1 | silent_decline |
| 01 — B2B Portal (verbose) | +NI | — | — | — | — | — | — | — | 0 | 39s | 1 | silent_decline |
| 01 — B2B Portal (casual) | no-NI | — | — | — | — | — | — | — | 0 | 41s | 1 | silent_decline |
| 01 — B2B Portal (casual) | +NI | **167.0** | 18 | 22 | 56 | 21 | 50 | **64** | 39 | 9m 11s | 1 | complete |
| 01 — B2B Portal (casual) | +NI | **181.0** | 20 | 32 | 56 | 18 | 55 | **72** | 29 | 39m 35s | 2 | complete |
| 02 — Admin Tool (terse) | no-NI | — | — | — | — | — | — | — | 0 | 54s | 1 | silent_decline |
| 02 — Admin Tool (terse) | no-NI | — | — | — | — | — | — | — | 0 | 108s | 2 | silent_decline |
| 02 — Admin Tool (terse) | no-NI | — | — | — | — | — | — | — | 0 | 806s | 3 | attempted_abort (exit 1) |
| 02 — Admin Tool (terse) | +NI | **156.0** | 20 | 30 | 32 | 18 | 56 | **70** | 36 | 9m 09s | 1 | complete |
| 02 — Admin Tool (terse) | +NI | **128.0** | 20 | 24 | 20 | 12 | 52 | **66** | 17 | ~9m gen | 2 | complete |
| 02 — Admin Tool (terse) | +NI | **146.0** | 20 | 24 | 32 | 18 | 52 | **60** | 26 | 39m 30s | 3 | complete |
| 02 — Admin Tool (terse) | +NI | — | — | — | — | — | — | — | 0 | 3600s | 4 | **timeout** |
| 03 — Marketplace (terse) | no-NI | **102.0** | 20 | 12 | 34 | 12 | 24 | **0** | 1 | 2m 29s | 1 | wrong_artifact (docs only) |
| 03 — Marketplace (terse) | no-NI | — | — | — | — | — | — | — | 0 | 63s | 2 | silent_decline |
| 03 — Marketplace (terse) | +NI | **138.0** | 20 | 20 | 48 | 10 | 40 | **62** | 35 | 8m 55s | 1 | complete |
| 03 — Marketplace (terse) | +NI | **152.0** | 20 | 28 | 48 | 16 | 40 | **58** | 25 | 39m 39s | 2 | complete |
| 04 — Customer Support (terse) | no-NI | **156.0** | 18 | 26 | 42 | 16 | 54 | **60** | 40 | 20m 46s | 1 | complete |
| 04 — Customer Support (terse) | no-NI | — | — | — | — | — | — | — | 0 | 30s | 2 | silent_decline |
| 04 — Customer Support (terse) | no-NI | — | — | — | — | — | — | — | 0 | 23s | 3 | silent_decline |
| 04 — Customer Support (terse) | no-NI | — | — | — | — | — | — | — | 0 | 30s | 4 | silent_decline |
| 04 — Customer Support (terse) | +NI | **162.0** | 20 | 34 | 38 | 18 | 52 | **68** | 66 | 10m 33s | 1 | complete |
| 04 — Customer Support (terse) | +NI | **164.0** | 20 | 18 | 38 | 36 | 52 | **56** | 28 | 9m 28s | 2 | complete |
| 04 — Customer Support (terse) | +NI | **150.0** | 20 | 22 | 38 | 18 | 52 | **70** | 19 | 39m 34s | 3 | complete |

\* **Quality** is a v0.5-candidate 6th dimension ([RFC 0001](rfcs/0001-add-quality-dimension.md), see also [METHODOLOGY §16.6](METHODOLOGY.md#166-v05-candidate-maintainabilityquality-as-6th-dimension)). Not included in composite PRS. **The Quality dimension does diagnostic work the existing 5 dimensions miss most starkly on T03**: the doc-only run scored Quality=0 (composite PRS=102); the real-code +NI run scored Quality=62 (composite PRS=138). PRS v0.4's 36-point gap between the false-positive and the real codebase becomes a 62-point gap when Quality is included. This is the cleanest empirical case for shipping RFC 0001 in v0.5.

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

### Failure Mode Distribution (RFC 0004 applied to 23 runs)

The 23 runs above, classified per the [RFC 0004](rfcs/0004-failure-mode-index.md) taxonomy (auto-generated by [`scripts/classify_historical_runs.py`](scripts/classify_historical_runs.py); full report at [`results/fmd_historical.json`](results/fmd_historical.json)):

| Tool | Task | Variant | NI | N | Completion | Constructive | Dominant Failure |
|---|---|---|---|---|---|---|---|
| claude-code | T01 b2b_portal | terse | no | 4 | 25% | 25% | silent_decline |
| claude-code | T01 b2b_portal | terse | yes | 2 | 0% | 0% | silent_decline |
| claude-code | T01 b2b_portal | verbose | no | 1 | 0% | 0% | silent_decline |
| claude-code | T01 b2b_portal | verbose | yes | 1 | 0% | 0% | silent_decline |
| claude-code | T01 b2b_portal | casual | no | 1 | 0% | 0% | silent_decline |
| claude-code | T01 b2b_portal | casual | yes | 1 | **100%** | 100% | — |
| claude-code | T02 admin_tool | terse | no | 3 | 0% | 0% | silent_decline (1× attempted_abort) |
| claude-code | T02 admin_tool | terse | yes | 1 | **100%** | 100% | — |
| claude-code | T03 marketplace | terse | no | 2 | 0% | 50% | wrong_artifact |
| claude-code | T03 marketplace | terse | yes | 1 | **100%** | 100% | — |
| claude-code | T04 support | terse | no | 4 | 25% | 25% | silent_decline |
| claude-code | T04 support | terse | yes | 2 | **100%** | 100% | — |

**Aggregate read**: across the 12 conditions, completion rate is **0%** in 7 conditions, **25%** in 2, and **100%** in 5. The bimodality is itself a finding — claude-code's agentic CLI behavior on a given (task, variant, NI) condition tends to be all-or-nothing, not stochastically continuous. This is consistent with the conversational-refusal mechanism: claude either decides up front to ask (→ silent_decline always) or to build (→ complete with the usual stochastic variance).

The reference implementation validates 23 of 23 runs against the taxonomy specification.

---

### Non-Interactive Suffix Discovery (Headline Methodology Finding, 2026-05-21)

**The single most important methodology finding from the v0 cycle.** Initial benchmarking showed claude-code achieving PRS 155 on Task 01 (42 files in 7m 46s). Test-retest runs of the *same prompt* produced **zero files in 30-60 seconds** — eight times in a row across Tasks 01/03/04. Root cause:

In non-interactive mode (`claude -p`), claude-code routinely responds *conversationally* — asking 3-4 clarifying questions about stack / SSO provider / deployment target / scope — instead of writing files. The session ends after that single turn. The smoke harness reports the run as "0 files / silent_decline" without surfacing the conversational text.

Confirmed via direct CLI capture (`scripts/diag_claude_silent_decline.py`):

> *"The question prompt was dismissed without a selection, so I'll stop here rather than guess. Let me know which of the four options (or a different scope) you want and I'll proceed."*

This is **correct agentic UX behavior** (asking before scaffolding 30+ files of someone else's code is good!) but it makes benchmark-style non-interactive evaluation produce dramatically misleading single-run numbers. The original PRS 155 was a stochastic exception where claude *happened* to skip the question.

**Fix:** A standardized suffix appended to the prompt for batch use:

> *"IMPORTANT: Begin writing files immediately. Do not ask for confirmation. Use sensible defaults for any ambiguities. Build the complete codebase in the current working directory now."*

Versioned at [`tasks/shared/non_interactive_suffix.md`](tasks/shared/non_interactive_suffix.md). Opt-in via `--non-interactive` on the smoke script; disclosed in `scoring.json` as `non_interactive_suffix_applied`. Updates require an RFC.

**Effect on completion rate:**

| Task / Variant | no-NI complete | +NI complete | Lift |
|---|---|---|---|
| T01 terse | 1 of 4 (25%) | 0 of 2 (0%) | **NI did not help** (still asks despite suffix) |
| T01 verbose | 0 of 1 | 0 of 1 | NI did not help |
| T01 casual | 0 of 1 | 1 of 1 (100%) | **+100 pp** |
| T02 terse | 0 of 3 (0%) | 1 of 1 (100%) | **+100 pp** |
| T03 terse | 1 of 2 (50%, wrong_artifact) | 1 of 1 (100%, real code) | quality lift |
| T04 terse | 1 of 4 (25%) | 2 of 2 (100%) | **+75 pp** |

**Five observations:**

1. **N=1 benchmarking is dangerously misleading.** The "PRS 155 / 156" headline numbers came from runs that don't reproduce. Real per-prompt completion rates without the suffix are 0-25%, not 100%.
2. **The suffix works for most prompts, not all.** T01 terse and T01 verbose remain resistant; claude continues to ask for clarification even with the explicit instruction. This is itself first-order signal: tool behavior on the *same task* depends on prompt phrasing in ways no methodology had previously controlled for.
3. **PRS scores when builds do complete are remarkably stable.** T04 +NI runs 1 and 2 produced PRS 162 and 164 — within 2 points despite file counts varying 2.4× (66 vs 28). PRS converges at coarse grain across stochastic verbosity.
4. **T02 finally completed.** After 3 prior attempts failed, T02 +NI run 1 produced 36 files with PRS 156 — same score magnitude as T04. The Task 02 Failure Mode finding's "implies pre-existing context" hypothesis is partly vindicated: claude was asking the same clarifying questions on T02 as on T01, the suffix overrode that ambiguity-seeking on T02 but not on T01.
5. **T03 false positive sharply exposed.** The no-NI T03 run produced 1 doc file scored at PRS 102 / Quality **0**. The +NI T03 run produced 35 code files scored at PRS 138 / Quality **62**. PRS v0.4 over-rewarded the doc-only output — only 36 points separated it from the real codebase. The Quality dimension's gap is 62 points — **1.7× the discrimination of v0.4 alone**. This is the cleanest empirical case for shipping RFC 0001 in v0.5.

**Combined with [RFC 0004 (Failure Mode Distribution)](rfcs/0004-failure-mode-index.md):** the FMD taxonomy now has concrete grounding. Every no-NI run that previously appeared as "PRS ≈ 0" is actually classifiable as `silent_decline` (conversational refusal), `attempted_abort` (T02 attempt 3), or `wrong_artifact` (T03 run 1). RFC 0004's worked examples can be re-grounded in this richer dataset.

**Methodology version impact:** v0.4.1 patch (suffix is opt-in, configuration-disclosed). v0.5 should likely make the suffix the default for batch cycles, with an explicit "ambiguity-sensitivity" track that runs without it as a controlled comparison.

---

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
| N=50 runs per condition | ⚠ Partial (N≤4 per condition; T01-terse no-NI=4, T04-terse no-NI=4, T04-terse +NI=3) |
| 3 prompt variants per task | ⚠ Partial (T01 tested all three; T02/T03/T04 terse only) |
| Test-retest reliability data | ⚠ Partial (T04 +NI N=3: PRS 150/162/164, mean 159, range 14; T01 casual / T02 / T03 +NI all N=2 with ~10-14 point PRS spreads) |
| Configuration disclosure (e.g. NI suffix) | ✅ Enforced via `non_interactive_suffix_applied` in scoring.json |
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
# Recommended for batch/non-interactive use — appends the standardized
# execution instruction documented in tasks/shared/non_interactive_suffix.md
python scripts/smoke_claude_code.py --task task_01_b2b_portal --variant terse --non-interactive

# Without --non-interactive, claude-code in -p mode will most often respond
# conversationally and ask for clarification, producing 0 files. See the
# "Non-Interactive Suffix Discovery" methodology finding above.
python scripts/smoke_claude_code.py --task task_04_support --variant terse --non-interactive
```

Scores will vary run-to-run (LLM stochasticity). Completion is itself stochastic — even with `--non-interactive`, some prompt variants (e.g., T01 terse and verbose) still trigger claude-code's clarification-seeking behavior strongly enough to refuse the run. This is **the reason** N=50 is the methodology requirement.

---

## Submitting a Tool for Scoring

This is an open repository — anyone can:

1. Fork it
2. Add a tool adapter under [`harness/tools/`](harness/tools/)
3. Run it against the tasks
4. Submit a PR with your results

See [CONTRIBUTING.md](CONTRIBUTING.md).

If/when an independent governing body is established, a formal submission process will be published. Until then, community submissions are welcomed via PR.
