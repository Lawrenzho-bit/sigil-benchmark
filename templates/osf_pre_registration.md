# OSF Pre-Registration Template — Sigil Index Cycle

| | |
|---|---|
| **Template version** | v0.4.1 (2026-05-21) |
| **Bound methodology version** | PRS v0.4 (or successor — see §1) |
| **Companion methodology spec** | [METHODOLOGY.md](../METHODOLOGY.md) |
| **Submission target** | [OSF.io](https://osf.io/) — register before any data collection begins |

This template implements METHODOLOGY §14. **Every official Sigil Index cycle must be pre-registered on OSF.io before any benchmark data is collected**, and the registration must include all sections of this template. Deviations from the registration are not forbidden, but must be flagged as "exploratory" in any publication of cycle results.

The template is intentionally long. Pre-registration's value comes from forcing decisions *before* seeing the data, so cycle authors should expect to spend several days drafting and reviewing this document before submitting.

---

## 1. Cycle Identification

| Field | Value |
|---|---|
| **Cycle name** | (e.g., "Sigil Index 2027-Q1") |
| **Cycle number** | (e.g., "1" for the first official cycle) |
| **Methodology version bound** | (e.g., "PRS v0.4" or "PRS v0.5 with RFC 0001 + RFC 0004") |
| **Pre-registration submission date** | YYYY-MM-DD |
| **Anticipated data-collection start date** | YYYY-MM-DD (must be ≥ pre-reg + 7 days) |
| **Anticipated data-collection end date** | YYYY-MM-DD |
| **Anticipated publication date** | YYYY-MM-DD |
| **Cycle authors** | (names + affiliations) |
| **Approving body** | (maintainer signoff initially; TSC vote once formed) |
| **OSF DOI** | (assigned at registration submission) |

### 1.1 Methodology Version Lock

The exact commit SHA of the methodology repository at the moment of submission. Any patch to METHODOLOGY.md after this point requires either re-registration or explicit acknowledgment in the publication.

| | |
|---|---|
| Repository | https://github.com/Lawrenzho-bit/sigil-benchmark |
| Commit SHA | (40-char SHA, e.g., `7810b32b...`) |
| Branch | `main` |
| Methodology file path | `METHODOLOGY.md` |
| Task pack path | `tasks/` |
| Scoring rubric path | `tasks/shared/scoring_rubric_v04.yaml` (or successor) |

---

## 2. Tools Under Evaluation

List every tool that will be scored. Each tool gets a row. Adding tools mid-cycle requires re-registration. Removing tools mid-cycle is allowed only with documented reason (e.g., tool vendor withdrew access).

| Tool ID | Vendor | Version (exact) | API or CLI | Spectrum position (§9) | Auth method | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

### 2.1 Tool Configuration Disclosure

For each tool, attach (as an OSF appendix) the exact configuration that will be used:
- CLI flags
- API parameters (temperature, max_tokens, system prompt overrides, etc.)
- Model version pinning
- Whether `tasks/shared/non_interactive_suffix.md` (or its successor) is applied — yes/no per condition
- Permission modes / sandboxing
- Any rate-limit-handling strategy
- Anti-training detection protocol (METHODOLOGY §10)

This is the "Configuration Disclosure" required by METHODOLOGY §11.

---

## 3. Tasks

### 3.1 Public Task Set

The set of public tasks the cycle will use. Pre-registration locks this set; tasks cannot be added or removed mid-cycle.

| Task ID | Name | Variants used | Weight template | Domain dimensions activated |
|---|---|---|---|---|
| | | | | |

### 3.2 Held-Out Task Set

Per METHODOLOGY §16 ("Anti-gaming"), 30% of tasks are held out. The held-out task IDs are NOT listed here in the public registration — they are registered as a separate confidential OSF entry and revealed only after data collection ends.

| Field | Value |
|---|---|
| Held-out task count | (must be ≥ 30% of total) |
| Confidential OSF entry DOI | (separate registration) |
| Held-out task revelation date | (must be ≥ publication date) |

### 3.3 Task Pack Hash

To prevent silent task modification post-registration, the SHA-256 hash of the task pack tarball at registration time:

```
sha256sum tasks/ -r | sort | sha256sum  # canonicalized hash
```

| | |
|---|---|
| Task pack canonicalized SHA-256 | |
| Task pack archive URL (if external) | |

---

## 4. Sample Sizes & Power

### 4.1 Per-Condition N

| Field | Value | Notes |
|---|---|---|
| N per (tool, task, variant, mode) condition | (e.g., 50) | METHODOLOGY §13 default is N=50 |
| N per (tool, task) summary | N × variant count | |
| Total run count | N × tool count × task count × variant count × mode count | |
| Estimated compute cost | $ | Pre-budgeted; cycle aborts if cost exceeds 1.5× estimate |
| Estimated wall-clock budget | hours | |

### 4.2 Power Analysis

| Field | Value |
|---|---|
| Minimum detectable effect (MDE) | (e.g., 5 PRS points at α=0.05, β=0.20) |
| Justification for MDE choice | (reference to a procurement-meaningful difference) |
| Per-condition standard deviation estimate | (basis: prior cycle data or pilot studies) |
| Power calculation (formula or software) | (e.g., `statsmodels.stats.power`) |

### 4.3 Stopping Rules

Pre-specified conditions under which data collection is halted:

| Condition | Action |
|---|---|
| Budget exceeds 1.5× estimate | Pause; require TSC re-approval to continue |
| Tool vendor revokes API access mid-cycle | Drop tool from cycle; document |
| Safety incident (e.g., harmful code produced and not refused) | Halt; trigger safety review |
| Task ambiguity flagged by ≥ 3 conditions | Defer task to next cycle; document |
| Repeated systematic failure mode (>50% of runs) | Halt; investigate per RFC 0004 |

---

## 5. Hypotheses

Hypotheses MUST be specified BEFORE data collection. Each hypothesis is either confirmatory (pre-stated) or exploratory (data-driven; flagged as such in the publication).

### 5.1 Primary Hypotheses

These drive the cycle's main publishable claims. Limit to ≤ 3.

| H# | Statement | Test | α | Direction |
|---|---|---|---|---|
| H1 | (e.g., "Tool A's mean PRS on greenfield tasks ≥ Tool B's by ≥ 5 points") | (e.g., one-sided t-test of paired tool diffs per task) | 0.05/3 (Bonferroni for 3 primary tests) | Greater |
| H2 | | | | |
| H3 | | | | |

### 5.2 Secondary Hypotheses

Lower-stakes tests. Reported with Benjamini-Hochberg FDR correction (METHODOLOGY §13).

| H# | Statement | Test | α (uncorrected) |
|---|---|---|---|
| | | | |

### 5.3 Exploratory Hypotheses

Hypotheses NOT pre-specified. Findings here are explicitly labeled "exploratory" in the publication and require validation in a future cycle to be treated as confirmed.

---

## 6. Statistical Analysis Plan

### 6.1 Primary Outcome Measure

| | |
|---|---|
| Primary outcome | (e.g., Composite PRS) |
| Secondary outcomes | (e.g., per-dimension PRS, Quality, FMD, completion_rate, generation cost, wall clock) |
| Outcome computation | (reference to specific scoring engine commit; e.g., `harness/scoring/` at SHA xxx) |

### 6.2 Aggregation Rules

| | |
|---|---|
| Per-condition aggregator | (mean of N runs, with bootstrap CI) |
| Cross-task aggregator | (per-task weights from `tasks/shared/scoring_rubric_v04.yaml`) |
| Cross-tool comparison | (paired by task; ranks reported with bootstrap rank stability per METHODOLOGY §13) |
| Outlier handling | (e.g., "winsorize at 5th/95th percentile if Cohen's d > 1.5"; pre-specified, not data-driven) |
| Missing data | (e.g., "runs labeled `timeout` or `silent_decline` contribute to FMD but not to PRS aggregation; report N separately") |

### 6.3 Confidence Intervals

| | |
|---|---|
| Method | Bootstrap percentile (METHODOLOGY §13) |
| Resamples | 10,000 |
| Confidence level | 95% (or 99% if pre-registered for high-stakes claims) |
| Reporting | All point estimates accompanied by CI; CIs displayed in publication tables |

### 6.4 Multiple Comparisons

| | |
|---|---|
| Family-wise approach | Benjamini-Hochberg FDR (METHODOLOGY §13) |
| FDR target | 0.05 |
| Family definition | (e.g., "all pairwise tool comparisons within a task") |
| Sensitivity analysis | (e.g., "report results under both BH-FDR and Bonferroni; treat BH-FDR as primary") |

### 6.5 Effect Sizes

| | |
|---|---|
| Reported | Cohen's d (paired or independent as appropriate); ΔPRS in raw points |
| Minimum reportable effect | d ≥ 0.2 with CI excluding 0 |
| Practical significance threshold | (pre-specified procurement-meaningful threshold) |

### 6.6 Failure Mode Distribution (if RFC 0004 accepted)

| | |
|---|---|
| FMD reported per condition? | Yes |
| Completion-rate threshold for PRS reporting | (e.g., "report PRS only for conditions with completion_rate ≥ 0.5") |
| Subgroup analysis | (e.g., "stratify PRS by dominant failure mode") |

---

## 7. Quality Controls

### 7.1 Inter-Run Variance

- Test-retest reliability target: (e.g., "Pearson r ≥ 0.7 across N=10 replication subset per tool")
- Replication subset specification: (which conditions get the N=10 replications)
- Action if reliability fails: (e.g., "scoring engine flagged for revision in next methodology bump")

### 7.2 Cross-Model LLM-as-Judge Validation (METHODOLOGY §13)

- Judge model panel: (list with version-pinning)
- Inter-judge agreement target: (e.g., "Cohen's κ ≥ 0.7 across all LLM-judged sub-components")
- Human validation subset: 10% of LLM-judged outputs also human-judged
- Action if agreement fails: (defer sub-component to next cycle; document)

### 7.3 Anti-Training Detection

- Per-tool detection protocol (METHODOLOGY §10)
- Action if a tool is detected as trained-on-task: (drop tool from cycle; document; notify vendor)

### 7.4 Safety Refusal Track

- Safety prompt set used: (path under tasks/safety/ or external reference)
- SRR computation: (reward refusal of harmful, penalize compliance)
- Disclosure: SRR reported separately from PRS, never mixed

---

## 8. Publication Plan

### 8.1 What Will Be Released

- Per-condition PRS (point estimate + 95% CI)
- Per-dimension scores
- FMD per condition (if RFC 0004 accepted)
- Per-tool aggregate ranking (with rank stability CIs)
- All scoring code at the pre-registered commit SHA
- All raw output files for at least one randomly-sampled run per condition (storage permitting; otherwise SHA-256 hash of full outputs preserved)
- The exact pre-registration document (this filled-out template)
- All deviations from pre-registration, flagged as such

### 8.2 What Will NOT Be Released

- Held-out task contents (revealed at the date specified in §3.2)
- Individual tool vendors' proprietary configuration beyond what's required by §2.1
- Personal data from any task that incidentally generated such data

### 8.3 Publication Venues

- Primary: Sigil Index leaderboard ([https://github.com/Lawrenzho-bit/sigil-benchmark](https://github.com/Lawrenzho-bit/sigil-benchmark))
- Secondary: (e.g., academic preprint, blog post, conference paper)
- Embargo period: None (open immediately) OR (specify embargo for academic venue compliance)

### 8.4 Deviations From Pre-Registration

A separate section in the publication will list every deviation from this pre-registration with:
- What changed
- When the change was decided
- Why (data-driven justification if exploratory; methodological reason if confirmatory)
- Impact on primary hypotheses

---

## 9. Conflict-of-Interest Disclosure

Per METHODOLOGY §17 (Governance) and the spirit of RFC procedural fairness:

| Cycle author | Affiliations | Tools evaluated they have a financial interest in | Recusal status |
|---|---|---|---|
| | | | |

For any conflicted author, document the recusal scope (which decisions they did not participate in).

---

## 10. Reproducibility Commitments

| Asset | Where | License |
|---|---|---|
| Scoring code | `harness/` at registered SHA | Apache 2.0 |
| Task definitions | `tasks/` at registered SHA | Apache 2.0 |
| Analysis scripts | `analysis/` (per-cycle directory) | Apache 2.0 |
| Raw run outputs | `results/cycle-NNNN/` (per-cycle directory) | Apache 2.0 + per-task LICENSE if applicable |
| Statistical environment | `requirements.txt` + Python version pin | (specify) |
| Random seeds | All seeded with values listed in `results/cycle-NNNN/seeds.json` | (specify) |

---

## 11. Approval Signatures

| Role | Name | Affiliation | Date | Initial |
|---|---|---|---|---|
| Cycle lead | | | | |
| Statistical reviewer | | | | |
| Methodology reviewer | | | | |
| Maintainer or TSC chair | | | | |
| OSF submitter | | | | |

---

## Appendix A: Worked Example (T03 Marketplace Cycle, hypothetical)

A filled-out example for a hypothetical cycle evaluating 3 tools on Task 03 (Marketplace) is available at [`templates/osf_pre_registration_example_t03.md`](osf_pre_registration_example_t03.md) (to be added). The example demonstrates how to fill out every section concretely.

## Appendix B: Lessons From the v0 Cycle

The 2026-05-19 to 2026-05-21 preliminary smoke runs surfaced several methodology decisions that future pre-registrations should explicitly address:

1. **Non-interactive suffix.** Whether `--non-interactive` is applied is a first-order design choice. Cycles should pre-register either "with suffix" or "with and without (as separate conditions)" — never leave it ambiguous. The discovery saga is documented in LEADERBOARD.md under "Non-Interactive Suffix Discovery."

2. **Failure mode distribution.** If RFC 0004 is accepted, pre-registration must include the FMD-per-condition reporting plan. The 2026-05-21 data shows that completion rate by condition is itself first-order signal that PRS-only reporting suppresses.

3. **Wall-clock measurement caveats.** Parallel-batch execution can confound wall-clock measurements. Single-run timing per condition (sequential, not parallel) is what should be reported and pre-registered.

4. **Bimodal failure timing.** The empirical fast-decline vs long-running-abort distinction is real. Pre-registrations should include the 300s threshold (or whatever cutoff is current) as a pre-specified parameter, not a post-hoc choice.

5. **Test-retest variance underestimation risk.** The first N=2 estimate (T04 PRS 162 vs 164) suggested ~2-point spread; N=3-4 revealed the true within-condition spread is closer to 25-30 PRS points. Pre-registrations should plan for the larger spread and not assume tight reproducibility from small N pilots.
