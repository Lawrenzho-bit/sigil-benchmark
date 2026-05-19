# Changelog

All notable changes to the Sigil Benchmark are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and methodology versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Initial public release of the Sigil Benchmark v0 scaffold
- PRS Methodology v0.4 specification ([METHODOLOGY.md](METHODOLOGY.md))
- Reference implementation in Python
- Tool adapters: Claude Code CLI, Anthropic API, OpenAI API, manual collection
- 5 scoring engines covering all PRS dimensions (32 of 50 sub-components via static analysis)
- Statistical analysis module: bootstrap CIs, Benjamini-Hochberg correction, rank stability
- CycleAggregator for multi-run benchmark cycles
- Demo pipeline with mock data
- Smoke test against Claude Code CLI
- Apache 2.0 license

### Methodology Versioning

- **v0.1** (internal): Initial 5-dimension structure
- **v0.2** (internal): Nuanced 0-10 rubrics, per-task weight templates, deployment harness specification, completion rate metric
- **v0.3** (internal): Statistical rigor (N=50, BH correction, bootstrap), dual-mode scoring (Autonomous + Reviewed), safety refusal track, AI-involvement spectrum, jurisdictional compliance
- **v0.4** (this release): IRT aggregation, factor analysis, validity studies (test-retest, concurrent, discriminant, convergent), full pre-registration on OSF, LLM-as-judge policy, composite score deprecation, rank stability with confidence bands, output archival, causal language style guide, adversarial robustness testing, optional domain dimensions (Payment Security, Real-Time, API, Data Pipeline, File Storage), standardized integration mocks, 3-tier functional compliance scoring, 9 jurisdictional compliance bundles

### Roadmap

- **v0.5** (target Q1 2027): Empirical refinement based on first real benchmark cycle data. IRT model fitted; factor structure validated; sub-component weights empirically adjusted.
- **v1.0** (target Q3 2027): Stable public release with 12 months of longitudinal validation data, TSC sign-off, independent audit complete.
