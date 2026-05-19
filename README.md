# Sigil Benchmark — Production Readiness Score (PRS)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Methodology: v0.4](https://img.shields.io/badge/methodology-v0.4-green.svg)](METHODOLOGY.md)
[![Status: v0 scaffold](https://img.shields.io/badge/status-v0_scaffold-orange.svg)](#status)

**The canonical reference benchmark for AI-generated software production readiness.**

The Sigil Benchmark measures whether AI-generated code can safely face production traffic, real users, and adversarial conditions. It's the production-readiness layer of AI codegen evaluation — complementary to capability benchmarks like [HELM](https://crfm.stanford.edu/helm/), [SWE-bench](https://www.swebench.com/), [HumanEval](https://github.com/openai/human-eval), and [MLE-bench](https://github.com/openai/mle-bench).

While other benchmarks measure *what AI tools can produce*, the **Production Readiness Score (PRS)** measures *whether that output is safe to ship*.

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

AI codegen tools are rapidly increasing in capability but vary enormously in production output quality. There is currently **no canonical benchmark** for whether AI-generated code is actually safe to ship. Procurement teams, regulators, journalists, and developers need an authoritative, transparent, methodologically rigorous reference.

The Sigil Benchmark aims to be that reference — governed by [Sigil Foundation](#governance) as an independent standards body, with open methodology, open code, and open data.

## Status

**v0 scaffold** — this is an early, working reference implementation. Not yet ready for publication as an official Sigil Index cycle.

| Component | Status |
|---|---|
| 5-dimension methodology (v0.4) | ✅ Complete, peer-review grade |
| Benchmark harness (Python) | ✅ Working |
| Tool adapters (Claude Code, Anthropic API, OpenAI API, manual) | ✅ Working |
| 32 of 50 sub-components implemented | ✅ Static analysis |
| 18 deployment-dependent sub-components | 🚧 Require live deployment + probes |
| Statistical analysis (bootstrap CIs, BH correction, rank stability) | ✅ Working |
| Demo pipeline (`scripts/demo_pipeline.py`) | ✅ Runs end-to-end with mock data |
| Real benchmark cycle (Sigil Index Q1+) | 📋 Not yet run |

A first real preliminary cycle has been recorded against `claude-code` on Task 01 (B2B SaaS portal). See **[LEADERBOARD.md](LEADERBOARD.md)**.

## Quickstart

```bash
git clone https://github.com/Lawrenzho-bit/sigil-benchmark.git
cd sigil-benchmark
pip install -e .

# Run the demo with mock data (no API keys needed)
python scripts/demo_pipeline.py

# Run against Claude Code (requires `claude` CLI authenticated)
python scripts/smoke_claude_code.py
```

Detailed setup: **[docs/getting_started.md](docs/getting_started.md)**.

## Methodology Highlights

- **Dual-mode scoring**: PRS-Autonomous (zero human modification) + PRS-Reviewed (one round of standardized human review). Different AI workflows (Cursor vs Claude Code vs Devin) get fair comparisons.
- **Safety refusal track**: Tools that refuse harmful prompts are rewarded, not penalized.
- **Statistical rigor**: Bootstrap percentile CIs (10,000 resamples), Benjamini-Hochberg FDR correction, Cohen's d effect size gates, minimum detectable effect disclosure.
- **AI-Involvement Spectrum**: Tools classified into 6 positions (Suggestive → Augmentative → Conversational → Agentic → End-to-End → Composed). Cross-position comparisons explicitly caveated.
- **Anti-gaming**: 30% held-out test set, annual task rotation, anti-training detection, methodology audit requirements for high-scoring tools.
- **Validity studies**: Test-retest reliability, concurrent validity (vs expert ratings), discriminant validity, longitudinal real-world correlation study.
- **Pre-registration**: Task selection and analysis plan pre-registered on [OSF.io](https://osf.io/) before each cycle.

See **[METHODOLOGY.md](METHODOLOGY.md)** for the full specification.

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

The Sigil Benchmark methodology is intended to be governed by **Sigil Foundation**, an independent standards body (formation in progress). The Foundation will:

- Own the methodology IP (Apache 2.0 license)
- Convene a Technical Steering Committee (TSC) with rotating members from academia, industry, and regulatory backgrounds
- Run annual methodology RFC processes
- Coordinate independent audits
- Publish the quarterly **Sigil Index**

Until formally incorporated, this repository serves as the working artifact for the methodology and reference implementation.

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
- Specifying remaining 6 tasks (Tasks 5-10)
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
