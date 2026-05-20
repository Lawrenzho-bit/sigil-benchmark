# Production Readiness Score (PRS) — Methodology v0.4

**Status:** Public draft, open for community review
**Methodology version:** 0.4.0
**Maintainer:** [Project authors](https://github.com/Lawrenzho-bit/sigil-benchmark) (independent governance planned — see [README §Governance](README.md#governance))
**License:** Apache 2.0
**Schema.org type:** ScholarlyArticle / Methodology

---

## 1. Purpose

The Production Readiness Score (PRS) measures whether AI-generated software output can safely face production traffic, real users, and adversarial conditions. PRS is a **screening measure** for production-readiness; it is not a causal claim about the underlying tool's quality.

PRS sits alongside other AI evaluation benchmarks in a complementary role:

| Benchmark | Measures | Methodology |
|---|---|---|
| HELM (Stanford) | LM capability across many tasks | Holistic, multi-metric |
| SWE-bench | GitHub issue resolution | Real-world repo patches |
| HumanEval | Algorithmic correctness | Function-level tests |
| MMLU | Knowledge breadth | Multiple choice |
| MLE-bench | ML engineering tasks | End-to-end ML |
| **PRS** | **Deployable production output** | **Static + dynamic analysis of generated codebases** |

None of the above measure deployable production output. PRS fills that gap.

---

## 2. Theoretical Foundations

PRS rests on prior software-quality theory rather than ad-hoc check-listing.

### 2.1 ISO/IEC 25010 Mapping

ISO/IEC 25010 defines 8 quality characteristics. PRS focuses on the production-readiness subset:

| PRS Dimension | ISO/IEC 25010 Mapping |
|---|---|
| Security | "Security" characteristic |
| Production Readiness Ops | "Reliability" + "Maintainability" |
| Scalability | "Performance efficiency" + "Compatibility" |
| Compliance | Regulatory (not in ISO directly) |
| Cost Efficiency | Operational (not in ISO directly) |

### 2.2 NIST SP 800-160 Alignment

NIST SP 800-160 (Systems Security Engineering) emphasizes engineering practices for trustworthy systems. PRS Security and Compliance dimensions align with NIST control families.

### 2.3 Construct Validity

The 5-factor structure is testable. Confirmatory factor analysis (CFA) will be conducted after the first complete benchmark cycle. Hypothesized structure: 5 factors with allowed correlations between Security ↔ Compliance and Production ↔ Scalability. Acceptance criteria: CFI ≥ 0.95, RMSEA ≤ 0.06.

If empirical evidence rejects the 5-factor structure, the methodology will be revised.

---

## 3. Scoring Overview

PRS produces multiple scores per (tool, task, mode):

| Score | Description |
|---|---|
| **PRS-Autonomous** | Code deployed without any human modification |
| **PRS-Reviewed** | Code after one round of standardized human review (max 5 mods, 30 min cap, no AI assist) |
| **Composite Effective Score (CES)** | PRS × Completion Rate |
| **Safety Refusal Rate (SRR)** | % of adversarial prompts appropriately refused |
| **Prompt Sensitivity Coefficient (PSC)** | Score variance across 3 prompt variants |
| **Rank Stability Coefficient (RSC)** | Bootstrap-derived rank confidence |

The single "composite PRS" number is **deprecated** in v0.4 — radar charts and dimension breakdowns are preferred to prevent procurement misuse.

Statistical reporting requirements (every published score):
- N (sample size)
- Bootstrap 95% confidence intervals (10,000 resamples)
- Cohen's d effect size for comparisons
- Benjamini-Hochberg adjusted q-values for multiple comparisons
- Minimum Detectable Effect Size (MDES) for the cycle
- Inter-rater Cohen's κ for any human-judged sub-components (target ≥ 0.8)

---

## 4. The Five Core Dimensions

### 4.1 Security (default weight 25%)

Ten sub-components scored 0-10 against the rubric in [`tasks/shared/scoring_rubric_v04.yaml`](tasks/shared/scoring_rubric_v04.yaml):

| ID | Sub-component | Tool |
|---|---|---|
| sec_01 | Static analysis findings | Semgrep + Snyk + CodeQL |
| sec_02 | Dependency CVE count | npm/pip/cargo audit |
| sec_03 | Authentication correctness | OWASP ASVS L1 test suite |
| sec_04 | Input validation coverage | Harness probe |
| sec_05 | SQL injection resistance | OWASP ZAP + sqlmap |
| sec_06 | XSS prevention | OWASP ZAP |
| sec_07 | CSRF protection | Harness probe |
| sec_08 | Secret management | gitleaks + trufflehog |
| sec_09 | TLS/HTTPS configuration | testssl.sh |
| sec_10 | Rate limiting | Harness probe |

### 4.2 Production Readiness Ops (default 25%)

Operational concerns: error handling, observability, health checks, backup strategy, DB pooling, N+1 query detection, cache strategy, graceful degradation, deployment automation, **time correctness** (UTC storage + TZ-aware display + DST-aware).

### 4.3 Scalability (default 20%)

Load tests at 1k and 10k concurrent users, async processing, background job systems with DLQ, read replica support, stateless architecture, container readiness (Dockerfile + 12-factor), auto-scaling configuration, CDN, database indexing.

### 4.4 Compliance (default 20%)

**3-tier functional scoring** per sub-component:
- **Presence** (0-3): Does the artifact exist?
- **Functionality** (0-4): Does it actually work?
- **Defaults** (0-3): Are defaults privacy-preserving / user-respecting?

Covers: GDPR cookie consent, privacy policy, terms of service, data export endpoint, data deletion endpoint, audit logging (immutable), access controls (RBAC + ABAC), encryption at rest, DPA template, EU AI Act provenance disclosure.

### 4.5 Cost Efficiency (default 10%)

Cost at 100 / 10k / 100k users, vendor lock-in, multi-cloud portability, OSS dependency ratio, egress optimization, auto-shutdown, resource right-sizing, pricing predictability.

---

## 5. Per-Task Weight Templates

Different task types deserve different weight profiles:

| Task | Sec | Ops | Scale | Comp | Cost |
|---|---|---|---|---|---|
| B2B SaaS portal | 25% | 25% | 20% | 20% | 10% |
| Internal admin tool | 30% | 25% | 10% | 25% | 10% |
| Marketplace | 25% | 20% | 20% | 25% | 10% |
| Customer support | 20% | 30% | 15% | 25% | 10% |
| Analytics dashboard | 20% | 25% | 25% | 20% | 10% |
| Project management | 20% | 30% | 20% | 20% | 10% |
| Subscription portal | 25% | 25% | 15% | 25% | 10% |
| Document management | 25% | 25% | 20% | 20% | 10% |
| Booking system | 20% | 30% | 20% | 20% | 10% |
| API service + webhooks | 25% | 25% | 25% | 15% | 10% |

Both composite (default 25/25/20/20/10) and task-specific scores are published.

---

## 6. Statistical Methodology

### 6.1 Sample Size

N = 50 runs per (tool, task, mode, prompt variant). At α = 0.05 and power = 0.80, this detects PRS effect sizes ≥ ~4 points.

### 6.2 Confidence Intervals

Bootstrap percentile CIs (10,000 resamples) replace parametric standard deviation. PRS distributions are likely heavy-tailed or bimodal; bootstrap handles non-Gaussian shape correctly.

### 6.3 Multiple Comparisons

Benjamini-Hochberg false discovery rate (FDR) correction at α = 0.05 applied to all published comparison families. Q-values reported alongside p-values.

### 6.4 Significance Gates

Differences labeled "statistically significant" only when:
- 95% bootstrap CIs don't overlap, AND
- BH-adjusted q-value < 0.05, AND
- Cohen's d ≥ 0.5 (medium effect)

Differences below this threshold reported as "indistinguishable within margin of error."

### 6.5 Aggregation

Generalized Partial Credit Model (GPCM) — an Item Response Theory variant — fitted to ordinal sub-component data after first cycle. Both summed score and IRT-θ published for continuity.

### 6.6 Rank Stability

Bootstrapped re-ranking (10,000 resamples) per benchmark cycle. Rankings reported with confidence bands (e.g., "Tool X ranks between #3 and #5 with 80% confidence"). Rank Stability Coefficient (RSC) = IQR of bootstrap ranks / total tools tested.

---

## 7. Prompt Variants

Each task has three semantically equivalent prompts with different framing:
- **Variant A (terse)**: Technical, concise
- **Variant B (verbose)**: Business-context, detailed
- **Variant C (casual)**: Vibe-coder phrasing

All three are tested. The median-variant score is the published headline; per-variant scores are in raw data. Prompt Sensitivity Coefficient (PSC) = (max - min) / mean across variants.

PSC < 0.1 → prompt-robust (preferred)
PSC ≥ 0.3 → prompt-sensitive (flagged)

---

## 8. Multi-Mode Scoring

### 8.1 PRS-Autonomous

Score the tool's output with **zero human modification**. Pure tool capability. Favors end-to-end / agentic tools.

### 8.2 PRS-Reviewed

Score after one round of **standardized human review**:
- Reviewer: mid-level engineer (5-8 years experience)
- Maximum 5 modifications
- Cannot rewrite from scratch
- Cannot add features (fixes/improvements only)
- 30-minute time cap
- No AI assistance during review
- Identical protocol across all tools

Favors interactive / assistive tools (Cursor, Claude Code in IDE).

Both modes published. A tool scoring (Autonomous=60, Reviewed=85) is great for human-AI collaboration. A tool scoring (Autonomous=82, Reviewed=85) is great autonomous, less collaboration benefit. Both are valid use cases.

---

## 9. Safety Refusal Track

Each cycle includes 5-10 adversarial prompts requesting:

- Code to bypass authentication
- Code with deliberate SQL injection vectors
- Code that exfiltrates user data
- Code violating GDPR (storing without consent)
- Code with intentional backdoors

**Safety Refusal Rate (SRR)** = % of adversarial prompts appropriately refused.

Refusals **do not** count against Completion Rate. Safety behavior is rewarded.

---

## 10. Held-Out Test Set & Gaming Defenses

30% of test cases are **never publicly disclosed**. They contribute to scores but are invisible to tool vendors. Plus:

- Annual task rotation (2-3 tasks retired and replaced)
- Adversarial probes added each quarter
- Anti-training detection (tools whose outputs suspiciously mirror benchmark patterns flagged for review)
- Methodology audit required for any tool scoring > 85

---

## 11. Tool Configuration Disclosure

Required for every published score:

- Tool name + exact version
- Model used (e.g., "Sonnet 4.5 (2026-Q1)")
- Operating mode (Composer, Agent, Standard)
- System prompt hash
- Temperature / sampling params
- Any non-default configuration

Versions matter. A "Cursor PRS 52" without version is meaningless. Historical scores preserved by version.

---

## 12. AI-Involvement Spectrum

Tools are classified by their position on the AI involvement spectrum:

| Position | Description | Example |
|---|---|---|
| 1 | Suggestive | GitHub Copilot (autocomplete) |
| 2 | Augmentative | Cursor (default), Claude Code in IDE |
| 3 | Conversational | Claude.ai canvas, Cursor Composer |
| 4 | Agentic | Devin, Mythos, Cursor Agent, Claude Code CLI |
| 5 | End-to-end | Lovable, Bolt, Replit AI |
| 6 | Composed | Sigil-style multi-tool pipelines |

Cross-position comparisons require an explicit caveat.

---

## 13. LLM-as-Judge Policy

Where LLM-as-judge is used (e.g., documentation quality, privacy policy coherence):

- **Cross-model judging required**: judge model from a different family than evaluated tool's underlying model
- **Bias mitigations**: length-bias, position-bias, self-favoritism, verbosity-bias all explicitly mitigated
- **Human validation subset**: 10% of LLM-judged sub-components also human-judged; correlation reported
- **Full disclosure**: list of LLM-as-judge sub-components maintained publicly

---

## 14. Pre-Registration

The methodology requires pre-registration of each benchmark cycle:
- Task selection methodology pre-registered
- Hypotheses specified
- Primary vs secondary comparisons designated
- Decision rules for edge cases pre-specified
- Statistical tests pre-committed
- Sensitivity analyses planned

Pre-registration is expected to be submitted to [OSF.io](https://osf.io/) before data collection for each cycle begins. Deviations from pre-registration are explicitly documented as "exploratory" in any published results.

No official cycles have been run under this protocol yet. The first preliminary scores in this repository are methodology-validation runs, not pre-registered benchmark cycles.

---

## 15. Jurisdictional Compliance

PRS Compliance scores default to **EU+US framework**: GDPR, SOC2, HIPAA, EU AI Act.

Optional bundles available for:
- California (CCPA, CPRA)
- Brazil (LGPD)
- China (PIPL, CSL, DSL)
- APAC (Singapore PDPA, Japan APPI, South Africa POPIA)
- Financial Services (PCI DSS, SOX, GLBA)
- Health US (HIPAA, HITECH)
- Health EU (EHDS, MDR)
- Education (FERPA, COPPA)

Every publication explicitly states regional scope.

---

## 16. External Validity Plan

A benchmark is only as valuable as its correlation with real-world outcomes.

**Pre-registered longitudinal observational study** (begins Q3 2026):
- 50+ apps deployed via PRS-evaluated tools tracked over 12 months
- Production metrics tracked: incidents, downtime, security events, churn, support tickets
- Correlation between PRS and real-world outcomes published annually
- Pre-registered on OSF before data collection

If PRS doesn't correlate with real-world outcomes, methodology is revised.

---

## 17. Reproducibility

- Methodology specification: public (this document)
- Benchmark harness code: open-source (Apache 2.0)
- Test data (non-held-out 70%): public
- Held-out test set (30%): private, audited
- Tool outputs archived for 10+ years
- Third-party replication budget: ≤ $5,000 per cycle

---

## 18. Conflict of Interest Handling

Once an independent governing body is established, the following will apply:

- Methodology and scoring owned by the independent body (not by any commercial entity)
- TSC members disclose all vendor affiliations and recuse from scoring related products
- Annual external audit (Big-4-equivalent firm, rotating)
- Tool vendors cannot pay for inclusion or ranking
- Double-blind scoring where feasible
- Funding sources publicly disclosed in each publication

Until the governing body is established, the project maintainers commit to these same principles informally. Any conflict of interest with this repository's results (e.g., maintainers benchmarking tools they have a relationship with) is disclosed in the relevant result files.

---

## 19. Versioning

- **Patch (v0.4.x)**: Typo / clarification, no score impact
- **Minor (v0.5.0)**: Sub-component refinement, scores recalibrated
- **Major (v1.0.0)**: Stable public release with validation data + TSC sign-off

Roadmap:
- v0.4 (current): Open methodology draft, community review
- v0.5 (target Q1 2027): IRT model + factor analysis fitted on first benchmark cycle data
- v1.0 (target Q3 2027): Stable release with longitudinal validation and (ideally) independent governance in place

---

## 20. Open Questions for v0.5

1. Should adversarial robustness be a separate dimension rather than embedded in Security?
2. How to handle tools that score well in EU but poorly in PIPL (composite vs per-region)?
3. Should there be a "frontier model" track with different expectations?
4. How to measure emerging capabilities (reasoning models with extended thinking)?
5. Should latency / responsiveness be its own dimension?
6. Vibe-coded MVP vs enterprise production — different scoring profiles?
7. Code interpretability / explainability — measurable?
8. Causal attribution of production incidents to specific tools — formal modeling?

---

## 21. How to Cite

```bibtex
@misc{prs_methodology_v04,
  title  = {Production Readiness Score (PRS) Methodology v0.4},
  author = {{Sigil Foundation Contributors}},
  year   = {2026},
  url    = {https://github.com/Lawrenzho-bit/sigil-benchmark/blob/main/METHODOLOGY.md},
  note   = {Open methodology for AI-generated code production readiness}
}
```

---

## 22. Acknowledgments

PRS v0.4 incorporates feedback patterns derived from rigorous AI evaluation literature:

- Statistical power: Card et al. (2020) "With Little Power Comes Great Responsibility"
- Multiple comparisons: Benjamini & Hochberg (1995)
- Measurement theory: Stevens (1946); Michell (1999, 2000); Embretson & Reise (2000) on IRT
- Construct validity: Cronbach & Meehl (1955)
- Researcher degrees of freedom: Simmons, Nelson, Simonsohn (2011)
- LLM-as-judge biases: Zheng et al. (2023) "Judging LLM-as-a-Judge with MT-Bench"
- Foundation model evaluation: Bommasani et al. (2023)
- Holistic evaluation: HELM (Liang et al., 2023)
- Software quality: ISO/IEC 25010; NIST SP 800-160
- Security verification: OWASP ASVS

PRS is built on the shoulders of prior work. The methodology is intended to be community-owned, independently governed, and continually refined through public RFC process.
