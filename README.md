# Sigil Benchmark — Production Readiness Score (PRS)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Methodology: v0.4](https://img.shields.io/badge/methodology-v0.4-green.svg)](METHODOLOGY.md)
[![Status: v0 scaffold](https://img.shields.io/badge/status-v0_scaffold-orange.svg)](#status)

**An open methodology for measuring AI-generated software production readiness.**

The Sigil Benchmark measures whether AI-generated code can safely face production traffic, real users, and adversarial conditions. It's the production-readiness layer of AI codegen evaluation — complementary to capability benchmarks like [HELM](https://crfm.stanford.edu/helm/), [SWE-bench](https://www.swebench.com/), [HumanEval](https://github.com/openai/human-eval), and [MLE-bench](https://github.com/openai/mle-bench).

While other benchmarks measure *what AI tools can produce*, the **Production Readiness Score (PRS)** measures *whether that output is safe to ship*.

> **Project status:** This is an early open-source release. The methodology is under active development. Governance is currently informal (project maintainers). The intent is to transition to an independent governing body as the project matures; see [Governance](#governance) below.

## What This Measures

PRS evaluates AI-generated codebases across five dimensions:

| Dimension | Weight | What it measures |
|---|---|---|
| **Security** | 25% | Static analysis, CVEs, OWASP ASVS, secret management, TLS |
| **Production Readiness Ops** | 25% | Error handling, observability, health checks, DB pooling, time correctness |
| **Scalability** | 20% | Load tests, async processing, statelessness, container readiness, indexing |
| **Compliance** | 20% | GDPR, SOC2 baseline, audit logging, access controls (3-tier functional scoring) |
| **Cost Efficiency** | 10% | Vendor lock-in, multi-cloud, OSS ratio, pricing predictability |

50 sub-components total. Per-task weight templates allow domain-specific re-weighting (admin tools de-emphasize scalability, marketplaces emphasize compliance, etc.).

Full methodology: **[METHODOLOGY.md](METHODOLOGY.md)** (v0.4, designed for top-venue peer review).

## Why It Exists

> **81% of enterprise technology leaders report production failures from AI-generated code.**
> — [CloudBees State of Code Abundance 2026](https://www.globenewswire.com/news-release/2026/05/19/3297549/0/en/81-of-Enterprise-Technology-Leaders-Report-Production-Failures-from-AI-Generated-Code-New-Research-Shows.html), surveying 200+ enterprise tech leaders

AI codegen tools are rapidly increasing in capability but vary enormously in *deployable* output quality. Existing benchmarks measure capability (HumanEval, MMLU), issue resolution (SWE-bench), or production-derived prompts (ProdCodeBench) — all valuable, all pass/fail. None measure whether the resulting code is actually **safe to ship**: secure, compliant, observable, scalable, cost-efficient.

The Sigil Benchmark aims to fill that gap — open methodology, open code, open data. PRS extends prior work ([Sun et al. 2025](https://arxiv.org/html/2511.10271v2) on ISO/IEC 25010 for LLM code; [GDPR-Bench-Android 2025](https://arxiv.org/pdf/2511.00619) on automated compliance) into the first 5-dimensional rubric covering Security + Production Ops + Scalability + Compliance + Cost in a single integrated score. See [METHODOLOGY §16.5](METHODOLOGY.md#165-related-work) for the full prior-art comparison.

We hope it can eventually be governed by an independent body; see [Governance](#governance).

## Status

**v0.4.1 scaffold + early empirical data** — methodology is peer-review grade; reference implementation is working; first preliminary smoke runs across 4 tasks have been collected and published.

| Component | Status |
|---|---|
| 5-dimension methodology (v0.4) | ✅ Complete, peer-review grade |
| Maintainability/Quality dimension (v0.5 candidate, [RFC 0001](rfcs/0001-add-quality-dimension.md)) | ✅ Reference implementation; 8 codebases scored |
| Failure Mode Distribution ([RFC 0004](rfcs/0004-failure-mode-index.md)) | ✅ Reference implementation; validates 23/23 historical runs |
| Benchmark harness (Python) | ✅ Working |
| Tool adapters (Claude Code, Anthropic API, OpenAI API, manual) | ✅ Working |
| 32 of 50 sub-components implemented | ✅ Static analysis |
| 18 deployment-dependent sub-components | 🚧 Require live deployment + probes |
| Statistical analysis (bootstrap CIs, BH correction, rank stability) | ✅ Working |
| Demo pipeline (`scripts/demo_pipeline.py`) | ✅ Runs end-to-end with mock data |
| Non-interactive batch protocol ([`tasks/shared/non_interactive_suffix.md`](tasks/shared/non_interactive_suffix.md)) | ✅ Versioned, opt-in via `--non-interactive` |
| Diagnostic tooling (`scripts/diag_claude_silent_decline.py`) | ✅ Root-causes silent declines in <1 minute |
| Real benchmark cycle (Sigil Index Q1+) | 📋 Not yet run |

**23 preliminary `claude-code` smoke runs** across 4 tasks have been collected and published, surfacing several methodology findings already documented on the leaderboard:

- The **Non-Interactive Suffix Discovery** — that agentic CLI tools in `-p` mode routinely refuse conversationally, destroying single-run reproducibility (the original "PRS 155" was a stochastic exception, not the modal behavior)
- **T03 false positive caught**: PRS 102 (1-file doc-only) vs PRS 138 (35-file real codebase) → Quality dimension widens the gap to 62 points, demonstrating that v0.5 catches a class of false positive v0.4 over-rewards
- **T04 test-retest within 2 PRS points** (162 vs 164) — early evidence that PRS converges at coarse grain across stochastic verbosity
- **All-or-nothing completion pattern** across 12 conditions — 7 at 0% completion, 5 at 100%, 2 at 25% — points to a discrete internal state in claude-code's agentic mode

See **[LEADERBOARD.md](LEADERBOARD.md)** for the full data and findings.

## Quickstart

```bash
git clone https://github.com/Lawrenzho-bit/sigil-benchmark.git
cd sigil-benchmark
pip install -e .

# Run the demo with mock data (no API keys needed)
python scripts/demo_pipeline.py

# Run against Claude Code (requires `claude` CLI authenticated).
# --non-interactive is recommended for batch use: see LEADERBOARD.md
# "Non-Interactive Suffix Discovery" finding.
python scripts/smoke_claude_code.py --non-interactive

# Re-classify past runs under the RFC 0004 Failure Mode taxonomy
python scripts/classify_historical_runs.py

# Re-score past runs on the v0.5 Quality dimension (RFC 0001)
python scripts/rescore_quality.py
```

Detailed setup: **[docs/getting_started.md](docs/getting_started.md)**.

## Methodology Highlights

- **Dual-mode scoring**: PRS-Autonomous (zero human modification) + PRS-Reviewed (one round of standardized human review). Different AI workflows (Cursor vs Claude Code vs Devin) get fair comparisons.
- **Safety refusal track**: Tools that refuse harmful prompts are rewarded, not penalized.
- **Statistical rigor**: Bootstrap percentile CIs (10,000 resamples), Benjamini-Hochberg FDR correction, Cohen's d effect size gates, minimum detectable effect disclosure.
- **AI-Involvement Spectrum**: Tools classified into 6 positions (Suggestive → Augmentative → Conversational → Agentic → End-to-End → Composed). Cross-position comparisons explicitly caveated.
- **Anti-gaming**: 30% held-out test set, annual task rotation, anti-training detection, methodology audit requirements for high-scoring tools.
- **Validity studies**: Test-retest reliability, concurrent validity (vs expert ratings), discriminant validity, longitudinal real-world correlation study.
- **Pre-registration**: Task selection and analysis plan pre-registered on [OSF.io](https://osf.io/) before each cycle. Fillable template at [`templates/osf_pre_registration.md`](templates/osf_pre_registration.md).

See **[METHODOLOGY.md](METHODOLOGY.md)** for the full specification.

## RFC Process

Substantive methodology changes go through a public Request-for-Comments (RFC) process before being adopted, modeled on [IETF RFCs](https://www.ietf.org/standards/rfcs/), [Rust RFCs](https://github.com/rust-lang/rfcs), and [Python PEPs](https://peps.python.org/).

See **[rfcs/README.md](rfcs/README.md)** for the full process. Current RFCs:

| Number | Title | Status |
|---|---|---|
| [RFC 0001](rfcs/0001-add-quality-dimension.md) | Add Maintainability/Quality as 6th Core Dimension (v0.5) | Draft |
| [RFC 0003](rfcs/0003-specification-composition-integrity.md) | Specification & Composition Integrity as 7th Core Dimension (v0.6) | **Speculative** |
| [RFC 0004](rfcs/0004-failure-mode-index.md) | Failure Mode Distribution as Parallel Metric (v0.5) | Draft |

Methodology forward-looking roadmap: see [METHODOLOGY §16.7](METHODOLOGY.md#167-future-paradigms-known-unincorporated-insights) for the full Future Paradigms log.

## Repository Structure

```
sigil-benchmark/
├── METHODOLOGY.md              # PRS v0.4 — the canonical spec
├── LEADERBOARD.md              # Latest scores
├── CITATION.cff                # How to cite this work
├── llms.txt                    # LLM-readable site map
├── harness/                    # Python implementation
│   ├── orchestrator.py
│   ├── cli.py
│   ├── tools/                  # Tool adapters
│   ├── scoring/                # Per-dimension scoring engines
│   ├── deployment/             # Standardized deployment targets
│   └── analysis/               # Bootstrap CIs, BH correction, IRT, rank stability
├── tasks/                      # 10 standardized benchmark tasks
│   ├── shared/
│   │   └── scoring_rubric_v04.yaml
│   └── task_01_b2b_portal/    # First task fully specified (3 prompt variants + criteria)
├── mocks/                      # Standardized integration mocks
├── scripts/                    # Demo + smoke test entry points
└── results/                    # Per-cycle benchmark outputs
```

## Citation

If you use the Sigil Benchmark in research or evaluation, please cite:

```bibtex
@misc{sigil_benchmark_2026,
  title  = {The Sigil Benchmark: Production Readiness Score (PRS) v0.4},
  author = {{Sigil Foundation Contributors}},
  year   = {2026},
  url    = {https://github.com/Lawrenzho-bit/sigil-benchmark},
  note   = {Open methodology for AI-generated code production readiness}
}
```

See [CITATION.cff](CITATION.cff) for machine-readable citation metadata.

## Governance

This repository is currently maintained informally by the project's authors. The methodology is published under Apache 2.0 to encourage open use and extension.

**Long-term intent:** As the project matures and the community grows, we plan to transition governance to an independent body (working name: *Sigil Foundation*). That body would:

- Hold the methodology under Apache 2.0
- Convene a Technical Steering Committee with rotating members from academia, industry, and regulatory backgrounds
- Run annual methodology RFC processes
- Coordinate independent audits
- Coordinate the publication of regular benchmark cycles

This is aspirational, not currently in place. Until a formal governing body exists, contributions are reviewed by the project maintainers. If you'd like to help shape the governance structure, open a discussion or reach out.

## Related Work

Sigil sits in the AI evaluation landscape alongside:

- **[HELM](https://crfm.stanford.edu/helm/)** (Stanford) — Holistic capability evaluation
- **[SWE-bench](https://www.swebench.com/)** — GitHub issue resolution
- **[HumanEval](https://github.com/openai/human-eval)** — Algorithmic correctness
- **[MMLU](https://github.com/hendrycks/test)** — Knowledge benchmarks
- **[MLE-bench](https://github.com/openai/mle-bench)** — ML engineering tasks

None of these measure **deployable production output**. PRS fills that gap.

Software quality frameworks PRS draws on:
- **[ISO/IEC 25010](https://www.iso.org/standard/35733.html)** — Software quality model
- **[NIST SP 800-160](https://csrc.nist.gov/pubs/sp/800/160/v1/r1/final)** — Systems security engineering
- **[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)** — Application security verification

## Contributing

Contributions welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the contribution process.

Particularly valuable contributions at this stage:

- Implementing deployment-dependent sub-components (load tests, OWASP probes, functional compliance verification)
- Adding tool adapters for new AI codegen tools
- Specifying remaining 5 tasks (Tasks 6-10; T05 specified 2026-05-21)
- Validation studies (concurrent validity vs expert ratings, real-world incident correlation)
- Standardized integration mocks (email, payment, SSO, storage, webhook)

## License

[Apache License 2.0](LICENSE). Open methodology, open code, open data.

## Acknowledgments

This methodology and implementation draws on prior work in:

- AI evaluation: [HELM](https://crfm.stanford.edu/helm/), [SWE-bench](https://www.swebench.com/), [HumanEval](https://github.com/openai/human-eval), Anthropic's evaluation research
- Statistical methodology: Benjamini & Hochberg (1995) on FDR, Card et al. (2020) on benchmark power
- Measurement theory: Item Response Theory (Embretson & Reise, 2000), construct validation (Cronbach & Meehl, 1955)
- Software quality: ISO/IEC 25010, NIST SP 800-160, OWASP ASVS
- LLM-as-judge methodology: Zheng et al. (2023) on MT-Bench biases

PRS is built on the shoulders of prior work in measurement, evaluation, and statistical methodology.
