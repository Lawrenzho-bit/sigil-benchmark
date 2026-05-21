# RFC 0001: Add Maintainability/Quality as 6th Core Dimension (v0.5)

| | |
|---|---|
| **RFC Number** | 0001 |
| **Title** | Add Maintainability/Quality as 6th Core Dimension |
| **Author(s)** | Sigil Benchmark Project Maintainers |
| **Status** | Draft |
| **Opened** | 2026-05-20 |
| **Comment Period** | TBD (target 4 weeks once announced) |
| **Decision Date** | TBD |
| **Decision** | TBD |
| **Supersedes** | — |
| **Superseded By** | — |
| **Methodology Version Impact** | Minor (v0.4 → v0.5) |

---

## 1. Summary

This RFC proposes promoting **Maintainability/Quality** from a partial-coverage status in PRS v0.4 (distributed implicitly across other dimensions) to an explicit **sixth core dimension** at 20% default weight in v0.5.

The proposal adds 10 new sub-components covering cyclomatic complexity, code duplication, function/method size, documentation coverage, type safety, test coverage (with anti-tautology check), linter compliance, naming consistency, module structure, and dead code / unused imports.

A reference implementation (`harness/scoring/quality.py`) is already available and has been validated against three real `claude-code` outputs. The engine **discriminates meaningfully** across them and surfaces a real-world finding the existing 5-dimension methodology partially missed.

## 2. Motivation

### 2.1 Closest Prior Art Treats Maintainability as Top-Level

[Sun et al. (2025, Linköping)](https://arxiv.org/html/2511.10271v2) — the closest published prior work on applying ISO/IEC 25010 to LLM-generated code — treats Maintainability as one of three top-level dimensions alongside Security and Performance Efficiency. Their study reports a "misalignment between academic focus, industry priorities, and observed model behavior" where practitioners prioritize maintainability but generated code introduces technical debt.

PRS v0.4 currently hides Maintainability from the headline score, which contradicts both Sun et al.'s framing and the priority practitioners assign.

### 2.2 ISO/IEC 25010 Lists Maintainability as Distinct

The PRS theoretical foundation (METHODOLOGY §2.1) maps to ISO/IEC 25010. The standard lists Maintainability as one of eight quality characteristics, alongside Security, Reliability, Performance Efficiency, etc. PRS already covers Security explicitly; treating Maintainability as second-class is inconsistent with the ISO grounding.

### 2.3 Industry Tools Treat It as First-Class

SonarQube, CodeClimate, Codacy, and other widely-used quality tools treat Maintainability as a separate first-class metric. Enterprise procurement teams reading PRS scores expect a Maintainability number; v0.4 doesn't provide one.

### 2.4 Empirical Evidence: The v0.5 Engine Discriminates

A reference implementation of the proposed Quality engine (`harness/scoring/quality.py`) has been tested against eight real `claude-code` outputs collected during the v0 smoke tests (2026-05-19 to 2026-05-21):

| Output | Files | Composite v0.4 PRS | Quality (v0.5 proposed) |
|---|---|---|---|
| T01 — B2B Portal terse | 42 | 155 | **68** |
| T01 — B2B Portal casual +NI | 39 | 167 | **64** |
| T02 — Admin Tool terse +NI | 36 | 156 | **70** ← highest |
| T03 — Marketplace terse (doc-only) | 1 | 102 | **0** |
| T03 — Marketplace terse +NI | 35 | 138 | **62** |
| T04 — Support Tool terse | 40 | 156 | **60** |
| T04 — Support Tool terse +NI run 1 | 66 | 162 | **68** |
| T04 — Support Tool terse +NI run 2 | 28 | 164 | **56** |

#### 2.4.1 The Headline Empirical Case: T03 Marketplace

The strongest single piece of evidence for promoting Quality to a core dimension comes from the Task 03 false positive:

- **T03 no-NI (1 file, documentation only)**: PRS 102 / **Quality 0**
- **T03 +NI (35 files, runnable code)**: PRS 138 / **Quality 62**

PRS v0.4 alone separated these by **36 points** — a meaningful but easily-missed gap. The Quality dimension separates them by **62 points**, a **1.7× improvement in discrimination** from adding a single dimension. The Quality engine correctly assigns 0/100 to a single-markdown-file output that pattern-matched as positive on indexing / CDN / audit logging in v0.4. This is the cleanest possible demonstration that Quality catches a class of false positive PRS v0.4 systematically over-rewards.

The doc-only run wasn't a designed test case. It was a real failure mode (`wrong_artifact` per [RFC 0004](0004-failure-mode-index.md)) that emerged from the smoke harness — exactly the kind of organically-discovered evidence that's hard to manufacture.

#### 2.4.2 Other Quality Findings

- **Cross-tool / cross-task range**: 56-70 across 7 successful builds. Mean ≈ 64. Reasonable variance for a 0-100 dimension; not pinned at floor or ceiling.
- **Test-retest stability**: T04 +NI runs 1 and 2 produced Quality 68 vs 56 — a 12-point spread that's larger than the composite PRS spread (162 vs 164 = 2 points). This is informative: composite PRS is more stable than Quality alone, suggesting Quality captures finer-grained variation that the composite averages out. For the RFC, this means Quality should be reported with its own confidence interval and not assumed equivalent in stability to PRS.
- **Universal weakness surfaced**: documentation coverage (qual_04) scored 0-2/10 across most builds, confirming Sun et al.'s (2025) finding that LLMs deprioritize maintainability artifacts that industry priorities.
- **Prompt-variant insensitivity (when builds complete)**: T01 terse no-NI = 68, T01 casual +NI = 64. The 4-point gap is small. Quality is largely prompt-variant insensitive when claude-code actually produces output, consistent with the dimension measuring properties of the artifact rather than properties of the prompting.

This validates the dimension produces real signal that PRS v0.4 alone cannot capture sharply.

## 3. Detailed Design

### 3.1 New Dimension Specification

**Dimension ID:** `quality`
**Dimension Name:** Maintainability / Code Quality
**Default Weight:** 20% (subject to adjustment in §3.3)
**Adjustable Range:** 10-30%

### 3.2 Ten Sub-Components

Each scored 0-10; summed to dimension score 0-100.

| ID | Sub-component | Preferred Tool | Fallback |
|---|---|---|---|
| qual_01 | Cyclomatic complexity | radon (Python) / escomplex (JS/TS) | AST + regex |
| qual_02 | Code duplication (%) | jscpd | 6-line block hashing |
| qual_03 | Function/method size | AST measurement | Regex/brace-matching |
| qual_04 | Documentation coverage | interrogate (Python) / documentation (JS) | AST docstring + JSDoc parse |
| qual_05 | Type safety | tsc --strict / mypy --strict | tsconfig flag + type-hint ratio |
| qual_06 | Test coverage (anti-tautology) | coverage.py + mutmut / c8 + cosmic-ray | Test:src LOC + test-fn count |
| qual_07 | Linter compliance | ruff / eslint | Code-smell density per 1k LOC |
| qual_08 | Naming consistency | language-specific linter | Regex case-conformance check |
| qual_09 | Module structure | LLM-as-judge (cross-model) | Directory-signal heuristic |
| qual_10 | Dead code / unused imports | vulture / ts-prune | AST import-usage analysis |

Detailed rubrics for each sub-component (with explicit 0/2/4/6/8/10 thresholds) are specified in the reference implementation `harness/scoring/quality.py` and would be formalized in `tasks/shared/scoring_rubric_v05.yaml` upon acceptance.

### 3.3 Proposed Re-Weighting

| Dimension | v0.4 | v0.5 Proposed | Adjustable Range |
|---|---|---|---|
| Security | 25% | **20%** | 15-30% |
| Production Ops | 25% | **20%** | 15-30% |
| Scalability | 20% | **15%** | 5-25% |
| Compliance | 20% | **15%** | 10-25% |
| Cost Efficiency | 10% | **10%** | 5-15% |
| **Maintainability/Quality** | **partial** | **20%** | 10-30% |

Net change: each existing dimension loses 5 percentage points to fund the new dimension. Cost Efficiency is preserved at 10%.

### 3.4 Migration Plan

- All v0.4 scores remain valid under v0.4 methodology
- v0.5 scores are **not directly comparable** to v0.4 scores (acknowledged in §4 Drawbacks)
- LEADERBOARD continues to display v0.4 scores until v0.5 cycles are run
- Comparison tables explicitly label methodology version
- v0.5 cycles begin only after RFC acceptance and `tasks/shared/scoring_rubric_v05.yaml` is published

### 3.5 Implementation Status

`harness/scoring/quality.py` — implemented and tested
`scripts/rescore_quality.py` — implemented; allows rescoring prior outputs without re-running LLM generation
`results/smoke-claude-code-*/quality_scoring.json` — validation data already on disk

Implementation passes Python AST parse; engine produces meaningful discrimination across the 3 scoreable v0 smoke outputs.

## 4. Drawbacks

### 4.1 Breaks Score Continuity

The most significant drawback: v0.5 composite scores will not be directly comparable to v0.4 composite scores because of re-weighting. Users relying on year-over-year trends will need to either rescore old outputs or maintain separate v0.4 and v0.5 tracks for a transition period.

**Mitigation:** Publish a comparison table in v0.5 release notes showing how the v0.4 → v0.5 composite shift affects published scores. Maintain v0.4 scoring availability indefinitely via methodology versioning.

### 4.2 Static-Analysis Proxies Are Imperfect

Several sub-components (qual_06 test coverage, qual_07 linter compliance, qual_09 module structure) currently rely on static-analysis proxies because the preferred mature tools (coverage.py with mutation testing, full eslint runs, LLM-as-judge for module structure) require either runtime execution or additional infrastructure.

**Mitigation:** Document fallback proxies clearly in `notes` field of each SubComponentScore. Future cycles can substitute preferred tools as deployment infrastructure matures.

### 4.3 Methodology Complexity Increases

Going from 50 to 60 sub-components increases the cycle run cost by ~20% (more scoring passes, more aggregation work, more variance per sub-component to report).

**Mitigation:** Quality sub-components are largely fast static analysis. Empirically measured added time: ~1 second per output. Negligible vs the multi-minute LLM generation step.

### 4.4 Risk of Universal Low Scores Becoming Uninformative

If all AI tools score similarly low on (e.g.) qual_04 documentation coverage (as our v0 data suggests — 2/10 on both T01 and T04), the sub-component may not discriminate between tools and provide little value.

**Mitigation:** Annual TSC review of sub-component discrimination. Sub-components with low between-tool variance get flagged for revision or replacement in subsequent methodology versions.

## 5. Alternatives Considered

### Option A: 6th Core Dimension at 20% (this RFC)

What it is: Promote Quality to top-level with substantial weight, re-weight others down.
**Selected.** Aligns with prior art, ISO/IEC 25010, industry tools, and empirical validation.

### Option B: Keep Distributed Across Existing Dimensions

What it is: Add Quality sub-components within Production Ops, Scalability, etc.
**Rejected.** Hides maintainability concerns from headline number; contradicts Sun et al.'s framing; makes it difficult for procurement teams to evaluate quality independently.

### Option C: Optional Domain Dimension

What it is: Treat Quality like Payment Security or Real-Time — an optional dimension activated only for certain task types.
**Rejected.** Maintainability is universal, not task-specific. Every task benefits from quality assessment. Treating it as optional understates importance.

### Option D: Wait for v1.0

What it is: Defer Quality dimension to the v1.0 release.
**Rejected.** v0.5 is the right time per the existing roadmap (METHODOLOGY §19). Waiting until v1.0 means another year of misleading scores like T03's 102 PRS for a 1-file doc-only output.

### Option E: 6th Dimension at 10% (Lower Weight)

What it is: Same dimension, lower weight (Sec/Ops at 22.5% each, Quality at 10%).
**Considered but not selected as primary.** May be revisited based on RFC comments. The 20% weight reflects Sun et al.'s priority of maintainability as a top concern; lowering it understates that.

## 6. Unresolved Questions

1. **Exact weight for the Quality dimension:** Proposed 20%. Alternatives 10%, 15%, 25%. Final choice depends on TSC consensus + RFC comments.

2. **Should some Quality sub-components require deployment-stage testing?** Test coverage (qual_06) ideally uses real coverage tools requiring code execution. Same for some linter scoring (qual_07). Current proposal uses static proxies. Should v0.5 require deployment-stage scoring for these specific sub-components and drop the proxies? Or allow proxies with explicit "static proxy" labeling?

3. **Cross-language handling:** AST analysis is mature for Python, JS, TS. Less so for Go, Rust, Ruby, PHP. How should Quality scoring handle languages without good static-analysis tool coverage? Current proposal: regex fallbacks. Alternative: language-specific weight adjustments.

4. **LLM-as-judge for qual_09 (module structure):** Currently uses directory-signal heuristic. The preferred approach (LLM-as-judge with cross-model judging per §13) requires more sophisticated infrastructure. Should v0.5 ship with the heuristic, or wait until LLM-as-judge subcomponent is fully built?

5. **Backward compatibility:** Should v0.4 cycles still be runnable after v0.5 ships, or should v0.5 entirely replace v0.4 in the reference implementation? Current proposal: both methodologies coexist (selectable via methodology version flag).

## 7. Comments Received

| Date | Reviewer | Affiliation | Comment | Author Response |
|---|---|---|---|---|
| | | | (RFC not yet open for comment) | |

## 8. Decision Rationale

(Filled in by the deciding body at the end of the comment period.)

## 9. References

### Direct Prior Art

- Sun et al. (2025), "Quality Assurance of LLM-generated Code: Addressing Non-Functional Quality Characteristics" — [arXiv:2511.10271](https://arxiv.org/html/2511.10271v2)
- COMPASS multi-dimensional benchmark — [arXiv:2508.13757](https://arxiv.org/pdf/2508.13757)
- RACE benchmark (Readability, mAintainability, Correctness, Efficiency)

### Standards & Tooling

- ISO/IEC 25010:2011 — Systems and software quality models
- [radon](https://github.com/rubik/radon) — Python complexity metrics
- [jscpd](https://github.com/kucherenko/jscpd) — Cross-language duplication detection
- [interrogate](https://github.com/econchick/interrogate) — Python docstring coverage
- [ts-prune](https://github.com/nadeesha/ts-prune) — TypeScript dead-code detection
- [mutmut](https://github.com/boxed/mutmut) — Python mutation testing
- SonarQube quality metrics taxonomy

### Empirical Validation

- `harness/scoring/quality.py` — reference implementation
- `scripts/rescore_quality.py` — validation tool
- `results/smoke-claude-code-task_01_b2b_portal-terse/quality_scoring.json` — T01 Quality scoring (68/100)
- `results/smoke-claude-code-task_03_marketplace-terse/quality_scoring.json` — T03 Quality scoring (0/100, correctly exposing docs-only output)
- `results/smoke-claude-code-task_04_support-terse/quality_scoring.json` — T04 Quality scoring (60/100)

### Related METHODOLOGY Sections

- §2.4 Prior Work on ISO/IEC 25010 for AI-Generated Code
- §16.5 Related Work
- §16.6 v0.5 Candidate: Maintainability/Quality as 6th Dimension
- §19 Versioning Policy
