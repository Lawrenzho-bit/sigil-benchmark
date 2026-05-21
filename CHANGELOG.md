# Changelog

All notable changes to the Sigil Benchmark are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and methodology versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased] — v0.5 in progress

Work in progress for v0.5 (not yet released):

- **RFC 0001** — Maintainability/Quality as 6th core dimension (Draft). Reference implementation working; 8 codebases scored; T03 wrong-artifact case validated.
- **RFC 0004** — Failure Mode Distribution as parallel metric (Draft). Reference implementation working; classifier validates 23 of 23 historical runs against the manual taxonomy; 5 of 7 modes observed organically.
- **Configurable suffix as default for batch cycles** — whether `--non-interactive` should be on by default for official cycles. Currently opt-in.
- **`wrong_artifact` LLM-as-judge** — heuristic implementation works for the v0 case but RFC 0004 specifies LLM-as-judge for high-stakes use. Deferred until cross-model panel wired in.

## [v0.4.1] — 2026-05-21

Patch release driven by 2026-05-21 test-retest discoveries. PRS v0.4 dimensions and weights unchanged; what changed is the protocol + tooling around them.

### Added

- `tasks/shared/non_interactive_suffix.md` — versioned standardized suffix for batch-benchmarking agentic CLI tools in `-p` / non-interactive mode. Required because tools routinely respond conversationally and ask for confirmation before writing files; the session ends after one turn and produces 0 files (`silent_decline`). The suffix overrides this behavior for most prompts. Updates require an RFC.
- `scripts/smoke_claude_code.py` — `--non-interactive` flag (opt-in) appending the standardized suffix. Configuration disclosed in `scoring.json` as `non_interactive_suffix_applied`.
- `scripts/diag_claude_silent_decline.py` — one-shot diagnostic that mimics the adapter's subprocess invocation and prints stdout/stderr verbatim. Future "silent decline" mysteries root-causable in <1 minute.
- `harness/scoring/failure_mode.py` — reference implementation of RFC 0004 (Failure Mode Distribution). Seven-mode classifier per the §3.1 detection precedence. Aggregators: `compute_fmd`, `completion_rate`, `constructive_rate`, `dominant_failure_mode`.
- `scripts/classify_historical_runs.py` — applies the FMD classifier to all historical runs and validates against the manual taxonomy in RFC 0004 §3.4. Validates 23/23.
- `tests/test_failure_mode.py` — 24-case unit suite (first test suite in the harness itself). Covers all 7 modes + classification-precedence edge cases + aggregator helpers.
- `templates/osf_pre_registration.md` — 11-section + 2-appendix fillable form implementing METHODOLOGY §14 pre-registration requirement. Required for every official cycle.
- Smoke harness now auto-classifies every run per RFC 0004; writes `scoring.json` (with new `failure_mode` field) on success or `failure_record.json` (with full forensic trail) on 0-file runs.

### Changed

- `scripts/smoke_claude_code.py` saves output_files **before** scoring runs (avoiding loss if scoring crashes).
- `scoring.json` schema gained two fields: `non_interactive_suffix_applied: bool` and `failure_mode: object`.
- `README.md` refreshed to reflect 23 real smoke runs + per-finding context.
- `LEADERBOARD.md` rewritten with all runs side-by-side (no-NI and +NI), per-condition FMD summary, and Quality dim scores.
- `scripts/rescore_quality.py` wired to handle new `*-NI-*` result dirs.

### Empirical Findings (documented on the leaderboard)

- **Non-Interactive Suffix Discovery** — claude-code in `-p` mode routinely responds conversationally and asks for confirmation; the session ends and produces 0 files. The original PRS 155 / 156 headlines were stochastic exceptions, not modal behavior. Discovery → root-cause → fix → validation all in one session.
- **T03 false-positive caught by Quality dimension** — doc-only run PRS 102 / Quality 0; real codebase PRS 138 / Quality 62. The Quality gap of 62 points is **1.7× the PRS-only gap** of 36 points. Cleanest empirical case for RFC 0001.
- **T04 test-retest variance** — N=3: PRS 150/162/164, mean 159, range 14. Tighter than expected at coarse grain.
- **All-or-nothing completion pattern** — 12 conditions: 7 at 0%, 5 at 100%, 2 at 25%. Consistent with claude-code's agentic mode having a discrete internal state set early in the session.
- **First organic `timeout` observation** — T02 +NI run 4 hit the 3600s wall, stderr `"API Error: Stream idle timeout - partial response received"`. Five of seven FMD modes now have organic evidence.

### Deprecated / Known Issues

- `time.monotonic()` in `scripts/smoke_claude_code.py` produces inflated wall-clock values (29525s, 32084s) when many subprocesses run concurrently on Windows. The adapter's inner `wall_clock_seconds` is accurate; the outer measurement is metadata noise, not data corruption. Investigation deferred.

## [v0.4] — 2026-05-19

Initial public release.

### Added

- 5-dimension PRS methodology (Security 25% / Production Ops 25% / Scalability 20% / Compliance 20% / Cost Efficiency 10%)
- 50 sub-components (10 per dimension); 32 implemented via static analysis, 18 require deployment-tier
- Statistical infrastructure: bootstrap percentile CIs (10k resamples), Benjamini-Hochberg FDR, Cohen's d gates, rank stability, MDES per tool
- Dual-mode scoring (PRS-Autonomous + PRS-Reviewed)
- Safety Refusal Rate (SRR) as parallel metric
- AI-Involvement Spectrum (6 positions)
- 6 per-task weight templates
- 4 of 10 tasks specified (T01 fully with 3 variants; T02/T03/T04 terse + acceptance criteria)
- Working tool adapters: claude-code CLI, Anthropic API, OpenAI API, manual
- Working local Docker deployment with auto-Dockerfile generation
- Demo pipeline running end-to-end with mock data
- Statistical analysis modules (CycleAggregator, PromptSensitivityCoefficient, etc.)
- Apache 2.0 licensed
- Pushed publicly to https://github.com/Lawrenzho-bit/sigil-benchmark

### Initial smoke data

- T01 b2b_portal terse: PRS 155 (42 files) — later determined to be a stochastic outlier (see v0.4.1 findings)
- T03 marketplace terse: PRS 102 (1 file) — later identified as `wrong_artifact`
- T04 support terse: PRS 156 (40 files) — later determined to be similarly fortunate
- T02 admin_tool terse: failed 3 attempts — later identified as conversational-refusal pattern

### Methodology Versioning History

- **v0.1** (internal): Initial 5-dimension structure
- **v0.2** (internal): Nuanced 0-10 rubrics, per-task weight templates, deployment harness specification, completion rate metric
- **v0.3** (internal): Statistical rigor (N=50, BH correction, bootstrap), dual-mode scoring (Autonomous + Reviewed), safety refusal track, AI-involvement spectrum, jurisdictional compliance
- **v0.4** (first public): IRT aggregation, factor analysis, validity studies (test-retest, concurrent, discriminant, convergent), full pre-registration on OSF, LLM-as-judge policy, composite score deprecation, rank stability with confidence bands, output archival, causal language style guide, adversarial robustness testing, optional domain dimensions (Payment Security, Real-Time, API, Data Pipeline, File Storage), standardized integration mocks, 3-tier functional compliance scoring, 9 jurisdictional compliance bundles

### Roadmap

- **v0.5** (target Q1 2027): Add Maintainability/Quality dimension (RFC 0001) + Failure Mode Distribution (RFC 0004). Empirical refinement based on first real benchmark cycle data. IRT model fitted; factor structure validated; sub-component weights empirically adjusted.
- **v0.6** (Speculative): Architecture-driven / verification-driven generation dimension (RFC 0003). Activated only if the paradigm materializes.
- **v1.0** (target Q3 2027): Stable public release with 12 months of longitudinal validation data, TSC sign-off, independent audit complete.
