"""
Cycle-level aggregation module.

Reads completed BenchmarkRun JSON files from a cycle's results directory,
computes aggregate statistics, and produces:
  - Per-tool aggregate scores (across tasks, variants, modes, repetitions)
  - Per-task aggregate scores (which tasks differentiate tools most?)
  - Per-dimension breakdowns
  - Rank stability via bootstrap re-ranking
  - Pairwise significance testing with Benjamini-Hochberg correction
  - Prompt Sensitivity Coefficients (PSC) per tool

Output: aggregates JSON written to results/{cycle_id}/aggregates/.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any

import numpy as np

from harness.analysis.statistics import (
    benjamini_hochberg,
    bootstrap_ci,
    cohens_d,
    minimum_detectable_effect,
    rank_stability,
    welch_t_test,
)

logger = logging.getLogger(__name__)


@dataclass
class RunRecord:
    """Lightweight view of a BenchmarkRun for aggregation."""

    run_id: str
    tool_id: str
    task_id: str
    variant: str
    mode: str
    repetition: int
    status: str
    completion_status: str
    dimension_scores: dict[str, float] = field(default_factory=dict)
    sub_component_scores: dict[str, float] = field(default_factory=dict)


@dataclass
class AggregateOutput:
    """All aggregates for a cycle."""

    cycle_id: str
    total_runs: int
    complete_runs: int
    failed_runs: int
    per_tool: dict[str, dict[str, Any]] = field(default_factory=dict)
    per_task: dict[str, dict[str, Any]] = field(default_factory=dict)
    per_dimension: dict[str, dict[str, Any]] = field(default_factory=dict)
    rank_distributions: dict[str, dict[str, float]] = field(default_factory=dict)
    pairwise_comparisons: list[dict[str, Any]] = field(default_factory=list)
    prompt_sensitivity: dict[str, float] = field(default_factory=dict)
    mdes_per_tool: dict[str, float] = field(default_factory=dict)


class CycleAggregator:
    """Aggregates a benchmark cycle's runs into publishable statistics."""

    def __init__(self, cycle_dir: Path):
        self.cycle_dir = Path(cycle_dir)
        self.cycle_id = self.cycle_dir.name

    def aggregate(self) -> AggregateOutput:
        """Run the full aggregation pipeline."""
        runs = self._load_runs()
        logger.info("Loaded %d runs for cycle %s", len(runs), self.cycle_id)

        complete = [r for r in runs if r.status == "complete"]
        failed = [r for r in runs if r.status == "failed"]

        output = AggregateOutput(
            cycle_id=self.cycle_id,
            total_runs=len(runs),
            complete_runs=len(complete),
            failed_runs=len(failed),
        )

        if not complete:
            logger.warning("No complete runs to aggregate for cycle %s", self.cycle_id)
            return output

        # Per-tool aggregates
        output.per_tool = self._aggregate_per_tool(complete)

        # Per-task aggregates
        output.per_task = self._aggregate_per_task(complete)

        # Per-dimension aggregates
        output.per_dimension = self._aggregate_per_dimension(complete)

        # Rank distributions (v0.4 §9)
        output.rank_distributions = self._compute_rank_distributions(complete)

        # Pairwise significance testing with BH correction (v0.4 §3.2)
        output.pairwise_comparisons = self._pairwise_with_bh(complete)

        # Prompt Sensitivity Coefficient (v0.4 §9)
        output.prompt_sensitivity = self._prompt_sensitivity(complete)

        # MDES per tool (v0.4 §3.1)
        output.mdes_per_tool = self._mdes_per_tool(complete)

        self._persist(output)
        return output

    # ----- Loading -----

    def _load_runs(self) -> list[RunRecord]:
        """Load all run JSON files in this cycle."""
        runs_dir = self.cycle_dir / "runs"
        if not runs_dir.exists():
            return []

        records: list[RunRecord] = []
        for run_file in runs_dir.rglob("*.json"):
            try:
                data = json.loads(run_file.read_text())
                records.append(self._record_from_data(data))
            except (json.JSONDecodeError, KeyError) as exc:
                logger.warning("Failed to load %s: %s", run_file, exc)
        return records

    @staticmethod
    def _record_from_data(data: dict[str, Any]) -> RunRecord:
        scores = data.get("scores") or {}
        dim_scores = {
            dim_id: dim_data.get("dimension_score", 0.0)
            for dim_id, dim_data in scores.items()
        }
        sub_scores: dict[str, float] = {}
        for dim_data in scores.values():
            for sub in dim_data.get("sub_component_scores", []) or []:
                sub_scores[sub["sub_component_id"]] = sub["score"]

        tool_output = data.get("tool_output") or {}
        completion_status = tool_output.get("completion_status", "complete") if tool_output else "unknown"

        return RunRecord(
            run_id=data["run_id"],
            tool_id=data["tool_id"],
            task_id=data["task_id"],
            variant=data["variant"],
            mode=data["mode"],
            repetition=data["repetition"],
            status=data["status"],
            completion_status=completion_status,
            dimension_scores=dim_scores,
            sub_component_scores=sub_scores,
        )

    # ----- Aggregates -----

    def _aggregate_per_tool(self, runs: list[RunRecord]) -> dict[str, dict[str, Any]]:
        """Per-tool composite + per-dimension + completion rate."""
        per_tool: dict[str, dict[str, Any]] = {}
        by_tool: dict[str, list[RunRecord]] = defaultdict(list)
        for r in runs:
            by_tool[r.tool_id].append(r)

        for tool_id, tool_runs in by_tool.items():
            # Composite PRS = sum of dimension scores
            composites = [
                sum(r.dimension_scores.values()) for r in tool_runs if r.dimension_scores
            ]
            ci = bootstrap_ci(composites) if composites else None

            # Per-dimension averages
            dim_avgs: dict[str, dict[str, float]] = {}
            for dim in {dim for r in tool_runs for dim in r.dimension_scores}:
                dim_values = [
                    r.dimension_scores[dim]
                    for r in tool_runs
                    if dim in r.dimension_scores
                ]
                dim_ci = bootstrap_ci(dim_values) if dim_values else None
                dim_avgs[dim] = {
                    "mean": float(np.mean(dim_values)) if dim_values else 0.0,
                    "median": float(np.median(dim_values)) if dim_values else 0.0,
                    "ci_lower": dim_ci.lower if dim_ci else 0.0,
                    "ci_upper": dim_ci.upper if dim_ci else 0.0,
                    "n": len(dim_values),
                }

            # Completion rate
            completion_count = sum(1 for r in tool_runs if r.completion_status == "complete")
            completion_rate = completion_count / len(tool_runs)

            # CES = Composite × Completion Rate
            composite_mean = float(np.mean(composites)) if composites else 0.0
            ces = composite_mean * completion_rate

            per_tool[tool_id] = {
                "tool_id": tool_id,
                "n_runs": len(tool_runs),
                "composite_prs": {
                    "mean": composite_mean,
                    "median": float(np.median(composites)) if composites else 0.0,
                    "ci_lower": ci.lower if ci else 0.0,
                    "ci_upper": ci.upper if ci else 0.0,
                    "n": len(composites),
                },
                "dimensions": dim_avgs,
                "completion_rate": completion_rate,
                "composite_effective_score": ces,
            }
        return per_tool

    def _aggregate_per_task(self, runs: list[RunRecord]) -> dict[str, dict[str, Any]]:
        """Per-task: which tasks differentiate tools most?"""
        per_task: dict[str, dict[str, Any]] = {}
        by_task: dict[str, list[RunRecord]] = defaultdict(list)
        for r in runs:
            by_task[r.task_id].append(r)

        for task_id, task_runs in by_task.items():
            composites = [
                sum(r.dimension_scores.values()) for r in task_runs if r.dimension_scores
            ]
            per_task[task_id] = {
                "task_id": task_id,
                "n_runs": len(task_runs),
                "composite_mean": float(np.mean(composites)) if composites else 0.0,
                "composite_std": float(np.std(composites)) if composites else 0.0,
                "tools_evaluated": sorted(set(r.tool_id for r in task_runs)),
                "differentiation_score": float(np.std(composites)) if composites else 0.0,
            }
        return per_task

    def _aggregate_per_dimension(
        self, runs: list[RunRecord]
    ) -> dict[str, dict[str, Any]]:
        """Per-dimension cross-tool aggregates."""
        per_dim: dict[str, dict[str, Any]] = {}
        all_dims = {dim for r in runs for dim in r.dimension_scores}

        for dim in all_dims:
            values = [r.dimension_scores[dim] for r in runs if dim in r.dimension_scores]
            ci = bootstrap_ci(values) if values else None
            per_dim[dim] = {
                "dimension": dim,
                "n": len(values),
                "mean": float(np.mean(values)) if values else 0.0,
                "median": float(np.median(values)) if values else 0.0,
                "ci_lower": ci.lower if ci else 0.0,
                "ci_upper": ci.upper if ci else 0.0,
                "std": float(np.std(values)) if values else 0.0,
            }
        return per_dim

    def _compute_rank_distributions(
        self, runs: list[RunRecord]
    ) -> dict[str, dict[str, float]]:
        """v0.4 §9: Bootstrap rank distributions per tool."""
        composites_per_tool: dict[str, list[float]] = defaultdict(list)
        for r in runs:
            if r.dimension_scores:
                composites_per_tool[r.tool_id].append(sum(r.dimension_scores.values()))

        if len(composites_per_tool) < 2:
            return {}

        return rank_stability(dict(composites_per_tool))

    def _pairwise_with_bh(self, runs: list[RunRecord]) -> list[dict[str, Any]]:
        """v0.4 §3.2: Pairwise t-tests with BH correction."""
        composites_per_tool: dict[str, list[float]] = defaultdict(list)
        for r in runs:
            if r.dimension_scores:
                composites_per_tool[r.tool_id].append(sum(r.dimension_scores.values()))

        tools = sorted(composites_per_tool.keys())
        if len(tools) < 2:
            return []

        raw_results = []
        for tool_a, tool_b in combinations(tools, 2):
            a_scores = composites_per_tool[tool_a]
            b_scores = composites_per_tool[tool_b]
            if len(a_scores) < 2 or len(b_scores) < 2:
                continue
            t_stat, p_value = welch_t_test(a_scores, b_scores)
            d = cohens_d(a_scores, b_scores)
            mean_diff = float(np.mean(a_scores) - np.mean(b_scores))
            raw_results.append({
                "tool_a": tool_a,
                "tool_b": tool_b,
                "mean_a": float(np.mean(a_scores)),
                "mean_b": float(np.mean(b_scores)),
                "mean_diff": mean_diff,
                "t_statistic": float(t_stat),
                "p_value": float(p_value),
                "cohens_d": float(d),
                "n_a": len(a_scores),
                "n_b": len(b_scores),
            })

        if not raw_results:
            return []

        # Apply Benjamini-Hochberg correction
        p_values = [r["p_value"] for r in raw_results]
        q_values, rejected = benjamini_hochberg(p_values)

        for r, q, rej in zip(raw_results, q_values, rejected):
            r["q_value"] = float(q)
            r["bh_rejected_at_5pct"] = bool(rej)
            r["practically_significant"] = bool(rej) and abs(r["cohens_d"]) >= 0.5

        return raw_results

    def _prompt_sensitivity(self, runs: list[RunRecord]) -> dict[str, float]:
        """v0.4 §9.3: PSC per tool — how much score varies across prompt variants."""
        sensitivities: dict[str, float] = {}
        by_tool_task: dict[tuple[str, str], dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

        for r in runs:
            if r.dimension_scores:
                composite = sum(r.dimension_scores.values())
                by_tool_task[(r.tool_id, r.task_id)][r.variant].append(composite)

        # Per tool: average PSC across tasks where the tool was tested on multiple variants
        tool_psc_values: dict[str, list[float]] = defaultdict(list)
        for (tool_id, _task_id), variants in by_tool_task.items():
            if len(variants) < 2:
                continue
            variant_means = [float(np.mean(scores)) for scores in variants.values() if scores]
            if not variant_means:
                continue
            mean_of_means = float(np.mean(variant_means))
            if mean_of_means == 0:
                continue
            psc = (max(variant_means) - min(variant_means)) / mean_of_means
            tool_psc_values[tool_id].append(psc)

        for tool_id, values in tool_psc_values.items():
            sensitivities[tool_id] = float(np.mean(values))

        return sensitivities

    def _mdes_per_tool(self, runs: list[RunRecord]) -> dict[str, float]:
        """v0.4 §3.1: Minimum Detectable Effect per tool, published with cycle."""
        mdes: dict[str, float] = {}
        by_tool: dict[str, list[float]] = defaultdict(list)
        for r in runs:
            if r.dimension_scores:
                by_tool[r.tool_id].append(sum(r.dimension_scores.values()))

        for tool_id, scores in by_tool.items():
            if len(scores) < 2:
                continue
            sigma = float(np.std(scores, ddof=1))
            n = len(scores)
            mdes[tool_id] = minimum_detectable_effect(n=n, sigma=sigma)

        return mdes

    # ----- Persistence -----

    def _persist(self, output: AggregateOutput) -> None:
        aggregates_dir = self.cycle_dir / "aggregates"
        aggregates_dir.mkdir(parents=True, exist_ok=True)

        # Per-tool
        (aggregates_dir / "per_tool.json").write_text(
            json.dumps(output.per_tool, indent=2)
        )
        # Per-task
        (aggregates_dir / "per_task.json").write_text(
            json.dumps(output.per_task, indent=2)
        )
        # Per-dimension
        (aggregates_dir / "per_dimension.json").write_text(
            json.dumps(output.per_dimension, indent=2)
        )
        # Rank distributions
        (aggregates_dir / "rank_distributions.json").write_text(
            json.dumps(output.rank_distributions, indent=2)
        )
        # Pairwise comparisons
        (aggregates_dir / "pairwise_comparisons.json").write_text(
            json.dumps(output.pairwise_comparisons, indent=2)
        )
        # Prompt sensitivity
        (aggregates_dir / "prompt_sensitivity.json").write_text(
            json.dumps(output.prompt_sensitivity, indent=2)
        )
        # MDES
        (aggregates_dir / "mdes_per_tool.json").write_text(
            json.dumps(output.mdes_per_tool, indent=2)
        )
        # Summary
        (aggregates_dir / "summary.json").write_text(
            json.dumps(
                {
                    "cycle_id": output.cycle_id,
                    "total_runs": output.total_runs,
                    "complete_runs": output.complete_runs,
                    "failed_runs": output.failed_runs,
                    "completion_rate": output.complete_runs / max(output.total_runs, 1),
                    "n_tools": len(output.per_tool),
                    "n_tasks": len(output.per_task),
                    "methodology_version": "0.4.0",
                },
                indent=2,
            )
        )
        logger.info("Wrote aggregates to %s", aggregates_dir)
