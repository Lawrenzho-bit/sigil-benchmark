# Sigil Benchmark Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLI Entry                              │
│                  (harness/cli.py: sigil-bench)                  │
└──────────────┬──────────────────────────────────────────────────┘
               │
       ┌───────▼─────────┐
       │   Orchestrator  │   harness/orchestrator.py
       │  (plans runs +  │
       │   coordinates)  │
       └─┬─────┬─────┬───┘
         │     │     │
   ┌─────▼─┐ ┌─▼───┐ ┌▼──────────┐
   │ Tools │ │Deploy│ │  Scoring  │
   │       │ │ment  │ │  Engines  │
   │  - Claude│ │Modal│ │  - Security│
   │  - GPT   │ │Fly  │ │  - ProdOps │
   │  - Manual│ │Rail.│ │  - Scale   │
   │          │ │     │ │  - Comp.   │
   │          │ │     │ │  - Cost    │
   └──────────┘ └─────┘ └────┬──────┘
                              │
                       ┌──────▼───────┐
                       │  Analysis    │ harness/analysis/
                       │              │
                       │ Bootstrap CIs│
                       │ BH correction│
                       │ IRT (v0.5)   │
                       │ Factor (v0.5)│
                       └──────┬───────┘
                              │
                       ┌──────▼───────┐
                       │   Results    │ results/{cycle_id}/
                       │   Storage    │
                       └──────────────┘
```

## Components

### Orchestrator (`harness/orchestrator.py`)

Plans the full benchmark grid (tools × tasks × variants × modes × repetitions),
coordinates execution of each run through generation → deployment → scoring,
persists results, and produces aggregate statistics.

### Tool Adapters (`harness/tools/`)

One adapter per AI codegen tool. Implements `ToolAdapter` base class.

| Tool | Adapter | Status |
|---|---|---|
| Claude (Anthropic API) | `claude.ClaudeAdapter` | v0 implemented |
| GPT (OpenAI API) | (to be written) | TODO |
| Cursor / Bolt / Lovable / v0 | `manual.ManualAdapter` | v0 implemented (uses pre-collected outputs) |
| Devin | (to be written) | TODO |
| Sigil Deploy | (to be written) | TODO |

### Deployment Targets (`harness/deployment/`)

Standardized deployment of tool outputs to identical infrastructure
(removes deployment-ergonomics as a confound).

| Target | Status |
|---|---|
| Modal (primary) | v0 stub |
| Fly (secondary) | not yet written |
| Railway (secondary) | not yet written |

### Scoring Engines (`harness/scoring/`)

One engine per PRS dimension. Each engine produces 10 sub-component scores
following the rubric in `tasks/shared/scoring_rubric_v04.yaml`.

| Engine | Sub-components | Status |
|---|---|---|
| `SecurityScoringEngine` | 10 | v0: 3 implemented (Semgrep, npm audit, gitleaks); 7 stubbed |
| `ProductionOpsScoringEngine` | 10 | not yet written |
| `ScalabilityScoringEngine` | 10 | not yet written |
| `ComplianceScoringEngine` | 10 (3-tier functional scoring v0.4) | not yet written |
| `CostEfficiencyScoringEngine` | 10 | not yet written |

### Analysis Module (`harness/analysis/`)

Statistical methods implementing PRS v0.4 §3.

| Method | Status |
|---|---|
| Bootstrap percentile CI | Implemented |
| Benjamini-Hochberg FDR correction | Implemented |
| Rank stability (bootstrap re-ranking) | Implemented |
| Welch's t-test | Implemented |
| Cohen's d effect size | Implemented |
| Minimum Detectable Effect | Implemented |
| IRT (Generalized Partial Credit Model) | Deferred (needs cycle 1 data) |
| Confirmatory Factor Analysis | Deferred (needs cycle 1 data) |

## Data Model

### A run

A single benchmark execution: one tool, one task, one variant, one mode, one repetition.

```
BenchmarkRun:
  run_id: 2026-Q3.claude-sonnet-4-5.task_01.terse.prs_autonomous.r000
  cycle_id: 2026-Q3
  tool_id: claude-sonnet-4-5
  task_id: task_01_b2b_portal
  variant: terse
  mode: prs_autonomous
  repetition: 0
  tool_output: { ... output files, tokens used, etc. }
  deployment: { ... deployed URL, container image, etc. }
  scores:
    security:
      dimension_score: 47.0
      sub_components: [
        { id: sec_01_static_analysis, score: 6, ... },
        ...
      ]
    production_ops: { ... }
    scalability: { ... }
    compliance: { ... }
    cost_efficiency: { ... }
```

### A cycle

A full quarterly benchmark. Contains all runs + cycle metadata + aggregate statistics.

### Results layout on disk

```
results/
└── 2026-Q3/                                  # cycle ID
    ├── cycle_summary.json                    # high-level metadata
    ├── pre_registration.osf_url              # OSF link
    ├── runs/
    │   ├── claude-sonnet-4-5/
    │   │   └── task_01_b2b_portal/
    │   │       ├── 2026-Q3.claude-sonnet-4-5.task_01_b2b_portal.terse.prs_autonomous.r000.json
    │   │       ├── ...
    │   │       └── 2026-Q3.claude-sonnet-4-5.task_01_b2b_portal.casual.prs_reviewed.r049.json
    │   └── ...
    ├── aggregates/
    │   ├── per_tool.json
    │   ├── per_task.json
    │   └── rankings.json
    └── archive/
        ├── tool_outputs/                     # raw codebases produced
        └── deployments/                      # container images
```

## Pipeline (Per Run)

```
1. Generate
   tool.generate(prompt) → ToolOutput
   - Records: code, tokens, completion status, refusal, wall clock

2. Deploy
   deployment.deploy(tool_output) → DeploymentResult
   - Builds container, deploys to Modal
   - Records: public URL, build duration, cost

3. Score (parallel across dimensions)
   for each engine in scoring_engines:
       engine.score(deployment, task, tool_output) → ScoreResult
   - Per sub-component: tool used, raw findings, rubric match, score 0-10

4. Persist
   write run JSON to results/{cycle}/runs/{tool}/{task}/{run_id}.json

5. Teardown
   deployment.teardown(deployment) — release resources
```

## Extending

### Adding a new tool

1. Create `harness/tools/{tool_id}.py`
2. Subclass `ToolAdapter`, implement `generate()` and `configuration_disclosure()`
3. Register in `harness/cli.py`'s tools_registry

### Adding a new task

1. Create `tasks/task_NN_name/`
2. Write `prompt_terse.md`, `prompt_verbose.md`, `prompt_casual.md`
3. Write `acceptance_criteria.md`
4. Add weight template to `tasks/shared/scoring_rubric_v04.yaml`

### Adding a new scoring engine

1. Create `harness/scoring/{dimension}.py`
2. Subclass `ScoringEngine`, implement `score()`
3. Register in `harness/cli.py`'s scoring_engines list

### Adding a new deployment target

1. Create `harness/deployment/{target}_target.py`
2. Subclass `DeploymentTarget`, implement `deploy()` and `teardown()`
3. Make selectable via CLI

## Build Order Recommendation

If you're extending this v0 scaffold toward a credible pilot:

**Sprint 1 (1-2 weeks):**
- Implement OpenAI/GPT tool adapter
- Implement working Modal deployment
- Implement production_ops scoring engine (at least 5 sub-components)

**Sprint 2 (2-3 weeks):**
- Implement compliance scoring engine (with 3-tier functional scoring)
- Implement cost_efficiency scoring engine
- Add tasks 2-3 (admin tool + marketplace)

**Sprint 3 (2-3 weeks):**
- Implement scalability scoring with k6 integration
- Run first internal pilot (3 tools × 3 tasks × 1 variant × N=5)
- Tune scoring sensitivity based on real outputs

**Sprint 4 (2-3 weeks):**
- Build aggregate analysis pipeline
- Build basic dashboard for results visualization
- Pre-register first public cycle on OSF

After Sprint 4: ready for first credible pilot.
