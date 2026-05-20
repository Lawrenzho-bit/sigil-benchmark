# RFC 0004: Failure Mode Distribution as Parallel Metric (v0.5)

| | |
|---|---|
| **RFC Number** | 0004 |
| **Title** | Failure Mode Distribution as Parallel Metric |
| **Author(s)** | Sigil Benchmark Project Maintainers |
| **Status** | Draft |
| **Opened** | 2026-05-20 |
| **Comment Period** | TBD (target 2 weeks once announced) |
| **Decision Date** | TBD |
| **Decision** | TBD |
| **Supersedes** | — |
| **Superseded By** | — |
| **Methodology Version Impact** | Minor (v0.4 → v0.5, alongside RFC 0001) |

---

## 1. Summary

This RFC proposes adding a **Failure Mode Distribution (FMD)** as a parallel reporting metric alongside the composite PRS. The FMD is a categorical taxonomy with seven labels that classifies each run by *how* it failed (or succeeded), enabling readers to distinguish "tool refused to attempt" from "tool attempted but crashed at minute 13" from "tool produced documentation instead of code" — distinctions that PRS v0.4 collapses to score ≈ 0.

The FMD is reported as a per-tool-per-task frequency distribution across N runs, with the **Completion Rate** as the primary scalar summary. It does **not** modify the composite PRS calculation. It supplements PRS the way Safety Refusal Rate (SRR) supplements it: a parallel behavioral metric, not an additive scoring dimension.

A classification engine for the seven modes is straightforward to implement from data the smoke harness already captures (`completion_status`, `wall_clock_seconds`, `returncode`, `refusal_reason`, file count, file types). Implementation is deferred to RFC acceptance but the empirical evidence supporting the taxonomy already exists in the v0 smoke runs.

## 2. Motivation

### 2.1 v0.4 PRS Loses Information at the Failure Boundary

Across the 7 smoke runs collected in 2026-05-19 to 2026-05-20, we observed at least four qualitatively distinct failure modes:

| Run | Wall clock | Exit | Files | What happened | v0.4 PRS reports |
|---|---|---|---|---|---|
| T01 terse | 7m 46s | 0 | 42 | Production-ready codebase | **155** ✅ |
| T01 verbose | 45s | 0 | 0 | Fast quiet exit, no work attempted | ≈ 0 |
| T01 casual | 41s | 0 | 0 | Fast quiet exit, no work attempted | ≈ 0 |
| T02 attempt 1 | 54s | 0 | 0 | Fast quiet exit | ≈ 0 |
| T02 attempt 2 | 108s | 0 | 0 | Fast quiet exit | ≈ 0 |
| T02 attempt 3 | 806s | **1** | 0 | **13 minutes of work, then error** | ≈ 0 |
| T03 terse | 2m 29s | 0 | 1 | One file — documentation, not code | **102** (false positive) |

The information loss is striking. A reader of the v0.4 leaderboard sees T01 verbose, T01 casual, T02-1, T02-2, and T02-3 as identically scored (≈ 0), but these represent five different behaviors:

- **Fast silent decline** (T01 verbose, T01 casual, T02-1, T02-2) — the agent received the prompt and exited within minutes without writing anything. Either the prompt was misinterpreted or the agent decided not to engage.
- **Long-running attempted abort** (T02-3) — the agent worked for 13 minutes, comparable to the successful T01-terse 8-minute run, then errored out. The agent *tried* but couldn't complete.

These have very different implications:
- For tool selection: "this tool refuses my style of prompt" vs "this tool tries but can't finish" are different procurement-relevant signals.
- For tool improvement: a tool team should fix these differently. Silent decline is a prompt-understanding failure; attempted-abort is a capability or capacity failure.
- For methodology validity: if N=50 runs of one tool produce mostly silent declines while another produces mostly attempted-aborts, those tools have different *risk profiles* even if their PRS scores are identical.

PRS-only reporting wastes this signal.

### 2.2 v0.4's PRS=102 for a One-File Doc Is a False Positive

Task 03's score of 102 is the cleanest example of why a "failure mode" label is needed alongside the score. The output was a single markdown planning document that pattern-matched as having CDN, indexing, and audit-log mentions. PRS v0.4's static-analysis sub-components dutifully scored those positive — producing a misleadingly high composite. RFC 0001 (Quality dimension) catches this via Quality=0, but a *taxonomy label* of `wrong_artifact` catches it more directly and *before* any dimension scoring runs.

### 2.3 Empirical Pattern: Bimodal Failure Duration

The seven smoke runs already reveal a striking bimodal distribution in failure timing:

```
0─5s  ─────────────────────────────────  806s (timeout limit varies)
       |                                  |
       └─ Fast declines (41-108s)         └─ Attempted abort (806s)
          (T01-v, T01-c, T02-1, T02-2)        (T02-3)
```

There is essentially nothing in the middle. This is consistent with two distinct internal states: (a) the agent quickly decides not to act, or (b) the agent commits to the task and works until it hits a wall. Reporting both as "PRS=0" hides this bimodality.

### 2.4 Prior Art in ML Evaluation

- **Anthropic's safety evaluations** distinguish "refusal" from "harmful compliance" from "safe compliance" — these are categorical labels parallel to a capability score. PRS v0.4 already adopts this via SRR.
- **HuggingFace's [eval suite](https://github.com/huggingface/evaluate)** records `errors` and `failures` separately from scored runs.
- **Software engineering benchmarks** (SWE-bench, HumanEval) report `pass@k` and also `error_rate`, `timeout_rate`, `parse_failure_rate` as distinct metrics.
- **DORA metrics** report deployment failure rate alongside deployment frequency. Failure rate is its own dimension, not collapsed into "deployment quality score."

The PRS methodology already accepts this paradigm via SRR. RFC 0004 extends the paradigm to the construction-failure side of the same model.

## 3. Detailed Design

### 3.1 The Seven-Mode Taxonomy

Each run is classified into exactly one mode. Detection criteria are deterministic from data the harness already collects.

| Mode | Code | Detection criteria | Example |
|---|---|---|---|
| **Complete success** | `complete` | Files ≥ task `min_files`, deployment success, acceptance criteria met | T01 terse |
| **Partial completion** | `partial_complete` | Files ≥ 1, but acceptance partial OR deployment fails | (no v0 example yet) |
| **Wrong artifact** | `wrong_artifact` | Files produced but >80% are documentation / non-code per LLM-as-judge | T03 terse |
| **Silent decline** | `silent_decline` | Wall clock < 120s AND 0 files AND exit 0 AND no explicit refusal phrase | T01 verbose, T01 casual, T02-1, T02-2 |
| **Hard refusal** | `hard_refusal` | Stdout contains explicit refusal phrase ("I can't help with...", "I won't...", etc.) | (no v0 example) |
| **Attempted abort** | `attempted_abort` | Wall clock ≥ 300s AND 0 files AND exit ≠ 0 | T02 attempt 3 |
| **Timeout** | `timeout` | Wall clock ≥ configured timeout limit (currently 1800s default) | (no v0 example) |

#### Classification precedence (when multiple criteria match)

In order, most-specific first:
1. `hard_refusal` if explicit refusal phrase present
2. `timeout` if wall clock at or near timeout limit
3. `attempted_abort` if wall clock ≥ 300s AND 0 files AND exit ≠ 0
4. `complete` if all acceptance criteria met
5. `partial_complete` if files ≥ 1 but criteria not met
6. `wrong_artifact` if files ≥ 1 and >80% documentation per LLM-as-judge
7. `silent_decline` as the default for fast no-output exits

The order is structured so that more diagnostic information wins. A run that hits both `wrong_artifact` and `partial_complete` is labeled `wrong_artifact` because the categorical mismatch is more informative.

### 3.2 Reporting Format

**Per tool/task condition (over N runs)**, the harness reports:

```yaml
failure_mode_distribution:
  complete:           0.62        # 31/50
  partial_complete:   0.08        # 4/50
  wrong_artifact:     0.04        # 2/50
  silent_decline:     0.18        # 9/50
  hard_refusal:       0.00        # 0/50
  attempted_abort:    0.06        # 3/50
  timeout:            0.02        # 1/50
completion_rate: 0.62             # = P(complete)
constructive_rate: 0.74           # = P(complete + partial_complete + wrong_artifact)
```

- **Completion Rate** — the primary scalar. % of runs that fully completed.
- **Constructive Rate** — % of runs that produced *something*. Catches tools that always produce output, even if not great.
- **Full FMD** — the seven-element probability vector.

**On the leaderboard:**
- Composite PRS column (unchanged)
- New column: **Completion Rate** (% of runs scored as `complete`)
- New optional column: **Dominant Failure Mode** (the most frequent non-`complete` label)

### 3.3 Implementation Notes

A new module `harness/scoring/failure_mode.py` would classify each `ToolOutput` according to §3.1. Inputs available today:

- `tool_output.completion_status` — coarse: complete / partial / failed / timeout / refused
- `tool_output.wall_clock_seconds`
- `tool_output.refusal_reason`
- `tool_output.output_files` — count and content
- `tool_output.raw_response["returncode"]`
- `tool_output.raw_response["stdout_tail"]` — for refusal-phrase detection

The classifier signature:

```python
def classify_failure_mode(
    tool_output: ToolOutput,
    task: TaskDefinition,
    deployment: DeploymentResult | None = None,
) -> FailureModeLabel:
    ...
```

The `wrong_artifact` mode requires an LLM-as-judge call to classify file content (code vs documentation vs config). This can use a cross-model judging panel per METHODOLOGY §13.

The cycle aggregator (`harness/analysis/aggregation.py`) gains a method to compute the FMD across N runs per condition.

### 3.4 Worked Examples From v0 Smoke Data

Applying the taxonomy retroactively to today's 7 runs:

| Run | Wall clock | Exit | Files | Classified mode |
|---|---|---|---|---|
| T01 terse | 466s | 0 | 42 | `complete` |
| T01 verbose | 45s | 0 | 0 | `silent_decline` |
| T01 casual | 41s | 0 | 0 | `silent_decline` |
| T02 attempt 1 | 54s | 0 | 0 | `silent_decline` |
| T02 attempt 2 | 108s | 0 | 0 | `silent_decline` |
| T02 attempt 3 | 806s | 1 | 0 | `attempted_abort` |
| T03 terse | 149s | 0 | 1 | `wrong_artifact` (after LLM-as-judge) |
| T04 terse | 1246s | 0 | 40 | `complete` |

The leaderboard could then report, for the T01-on-claude-code condition (3 runs):
- FMD: `{complete: 0.33, silent_decline: 0.67}`
- Completion Rate: 33%
- Dominant failure mode: silent_decline

That tells a *much* richer story than "PRS 155 on the run that worked."

### 3.5 Interaction with PRS

PRS is computed exactly as in v0.4 for runs labeled `complete`, `partial_complete`, or `wrong_artifact`. Runs labeled `silent_decline`, `hard_refusal`, `attempted_abort`, or `timeout` produce no scorable artifacts and PRS is reported as `n/a` (not 0) for those runs. The aggregator computes mean PRS over scorable runs only, with N reported alongside.

This change resolves an ambiguity in v0.4: should a tool that refuses 49/50 runs and gets PRS=180 on the 1 it completed be reported as "PRS=180" or "PRS≈3.6 (180 × 1/50)"? Under v0.4 this is undefined. Under FMD it's clear: the tool reports `completion_rate=0.02, PRS|complete=180`, with an explicit footnote that the high PRS came from a tiny sample.

### 3.6 Interaction With SRR

`hard_refusal` is closely related to Safety Refusal Rate (SRR) but **not identical**:

- **SRR** measures refusal of *prompts the methodology classified as harmful*. A refusal of a harmful prompt is *rewarded* (it's what we want from the tool).
- **FMD `hard_refusal`** measures refusal of any prompt, regardless of whether it should have been refused. A refusal of a *benign* prompt is a failure mode.

A clean way to think about it:

```
                       Harmful prompt    Benign prompt
                       ─────────────     ─────────────
  Tool refuses    →    SRR ↑ (good)     FMD hard_refusal ↑ (bad)
  Tool complies   →    SRR ↓ (bad)      FMD complete ↑ (good)
```

The two metrics are reported separately. FMD is restricted to benign-prompt conditions; SRR runs are a parallel track.

## 4. Drawbacks

### 4.1 Taxonomy Boundary Cases

The 7-mode taxonomy will have edge cases. Examples:

- A run with wall clock 295s, exit code 1, 0 files. By §3.1's bright line (≥ 300s), this is *not* `attempted_abort` — it falls into `silent_decline` even though it ran much longer than a silent decline typically does. The cutoff is somewhat arbitrary.
- A run with 1 file that is a partial implementation plus a README. Is that `wrong_artifact` (because >80% is docs) or `partial_complete` (because some code exists)? LLM-as-judge calibration matters.
- A run that times out at 1799s with 5 files produced. Is that `timeout` or `partial_complete`? Currently §3.1 says timeout wins on the wall-clock check.

**Mitigation:** Cutoff values (300s, 80%, 120s) will need calibration during v0.5 development. The RFC proposes initial values; final values come from running the classifier against the first 100-200 real runs and tuning for minimum classification ambiguity.

### 4.2 Adds Methodology Complexity

Eight metrics (PRS composite + 6 dimensions + SRR) become nine (+ FMD). Readers must learn one more category. Trade-off is information vs cognitive load.

**Mitigation:** Most readers will look at PRS and Completion Rate together. The full FMD is a drill-down for analysts. Leaderboard formatting can hide details by default.

### 4.3 Wrong-Artifact Classification Requires LLM-as-Judge

Detecting `wrong_artifact` (code-vs-docs mismatch) cannot be done by file extension alone. A `.py` file may be 90% docstring. An `.md` file may be a fully-runnable Jupyter export. Some heuristic + LLM-as-judge is required.

**Mitigation:** Use the cross-model judging panel already specified in METHODOLOGY §13. Track inter-judge agreement; if Cohen's κ < 0.7, escalate to human adjudication.

### 4.4 Doesn't Change Composite PRS — May Feel "Optional"

Because FMD doesn't enter the composite, lazy readers may ignore it.

**Mitigation:** Leaderboard prominence. Make Completion Rate a first-class leaderboard column adjacent to PRS. A tool with PRS=180 and Completion Rate=4% should be immediately visible as suspect compared to a tool with PRS=120 and Completion Rate=90%.

### 4.5 Risk of Gaming via "Constructive" Output

Once tools know `partial_complete` and `wrong_artifact` count toward "Constructive Rate," some might be tuned to *always* produce *something* — even garbage code — to avoid the `silent_decline` label.

**Mitigation:** This is actually fine. Producing garbage code is what `partial_complete` with low PRS already detects. The metric stack — PRS + Completion Rate + Constructive Rate + FMD — makes this kind of gaming visible: a tool with Constructive Rate=100% but PRS=15 is obviously producing junk, and the FMD will show `partial_complete` dominant.

## 5. Alternatives Considered

### Option A: FMD as Parallel Metric (this RFC)

What it is: Classify each run; report distribution alongside PRS.
**Selected.** Preserves PRS comparability while adding diagnostic richness.

### Option B: Failure Mode as a 7th Dimension Added to Composite

What it is: Convert FMD to a 0-100 score (weighted by mode badness) and roll into composite PRS.
**Rejected.** Conflates "how good was the output" with "what kind of failure occurred." The two are conceptually different. A composite score that mixes them is harder to interpret.

### Option C: Binary "Completed vs Failed" Only

What it is: Add a single binary flag, drop the seven-mode taxonomy.
**Rejected.** Loses the very distinction this RFC is motivated by (silent decline vs attempted abort).

### Option D: Sub-Component Within Production Ops Dimension

What it is: Add "reliability" as a sub-component scored 0-10.
**Rejected.** A sub-component scored 0-10 forces an ordinal ranking onto categorical data. `silent_decline=2` and `attempted_abort=4` would suggest attempted_abort is "better than" silent_decline, which is not what the taxonomy means.

### Option E: Merge With SRR Into Unified "Behavior Track"

What it is: SRR and FMD become aspects of one "Behavior Track" metric set.
**Considered.** Possibly the right end state. For v0.5 they remain separate because their semantics differ (refusal of harmful vs failure on benign). Merge can be revisited in v0.6+ if comments support it.

### Option F: Defer to v0.6

What it is: Don't ship FMD with v0.5 (Quality); ship in v0.6 alongside Spec-Integrity.
**Rejected.** FMD has no dependency on v0.6's Spec-Integrity work. The empirical motivation (today's 7 smoke runs) exists now. Deferring delays a methodology improvement that costs almost nothing to implement.

## 6. Unresolved Questions

1. **Threshold calibration:** Are 300s (attempted_abort cutoff), 120s (silent_decline cutoff), 80% (wrong_artifact docs ratio) the right values? These need empirical calibration against a larger dataset than 7 runs.

2. **`hard_refusal` phrase list:** Detection currently uses substring matching against ~5 phrases ("I can't help with", "I cannot assist", etc.). Should this be expanded, made language-aware, or replaced with LLM-as-judge?

3. **Partial-complete sub-types:** Should `partial_complete` itself be subdivided (e.g., `partial_complete_compilation_fails` vs `partial_complete_tests_fail` vs `partial_complete_missing_features`)? Could be a follow-up.

4. **How does the classifier handle runs with no deployment attempted?** v0.4 lets engines mark deployment-dependent sub-components as stubbed. Should FMD's `complete` label require deployment success, or just static checks? Currently §3.1 requires deployment success — but this means almost no v0 runs would label as `complete` once deployment-dependent scoring lands. Should there be a `complete_static_only` vs `complete_with_deployment` distinction?

5. **Cross-language wrong_artifact detection:** Is "code vs docs" classification reliable enough for non-English-keyword languages (Go, Rust, Ruby, PHP)? May need per-language LLM-as-judge calibration.

6. **Aggregation across mode types:** When computing condition-level statistics, should `attempted_abort` runs contribute to wall-clock means? They produced work effort even if no output. Currently §3.5 says PRS is `n/a` for these; should other statistics also be excluded?

7. **Comparison to dimensional scores:** When the leaderboard compares tools, should it report `PRS | complete` (PRS conditional on completion) or `PRS_marginal` (PRS averaged over all runs, with `n/a` runs treated as 0)? The two can differ enormously when completion rates differ.

## 7. Comments Received

| Date | Reviewer | Affiliation | Comment | Author Response |
|---|---|---|---|---|
| | | | (RFC not yet open for comment) | |

## 8. Decision Rationale

(Filled in by the deciding body at the end of the comment period.)

## 9. References

### Empirical Motivation

- `LEADERBOARD.md` — Task 01 Prompt-Variant Sensitivity finding (2026-05-20)
- `LEADERBOARD.md` — Task 02 Failure Mode finding (3 attempts, bimodal pattern)
- `LEADERBOARD.md` — Task 03 Partial Build finding (wrong-artifact case)
- `/tmp/smoke_t02_attempt3.log` — attempted_abort exemplar (806s, exit 1, 0 files)

### Prior Art

- METHODOLOGY §13 — LLM-as-judge policy and cross-model judging panel
- METHODOLOGY §6 — Safety Refusal Rate (SRR) as parallel metric model
- DORA metrics — deployment failure rate as independent metric from deployment frequency
- SWE-bench — `pass@k`, `error_rate`, `timeout_rate` reported separately
- HumanEval — pass rate vs syntax-error rate distinction
- Anthropic safety evaluation methodology — refusal as categorical outcome

### Related Sigil Documents

- RFC 0001 — Maintainability/Quality dimension (v0.5 companion)
- METHODOLOGY §6 (SRR) — parallel-metric precedent
- METHODOLOGY §16.7 (Future Paradigms) — entry could be added for Failure Mode Index when accepted
