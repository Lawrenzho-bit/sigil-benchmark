"""
Sigil Benchmark Orchestrator

Coordinates the full benchmark cycle:
  1. Load task definitions (prompts + acceptance criteria)
  2. For each (tool, task, variant, run): generate output
  3. Deploy output to standardized environment
  4. Run scoring engines against deployed output
  5. Persist raw data + scores
  6. Compute aggregate statistics

This is a v0 scaffold. Many components stubbed.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from harness.tools.base import ToolAdapter, ToolOutput
from harness.deployment.base import DeploymentTarget, DeploymentResult
from harness.scoring.base import ScoringEngine, ScoreResult

logger = logging.getLogger(__name__)


# ---------- Data models ----------


class BenchmarkConfig(BaseModel):
    """Configuration for a benchmark cycle."""

    cycle_id: str  # e.g. "2026-Q3"
    methodology_version: str = "0.4.0"
    runs_per_condition: int = 50  # v0.4 spec
    tasks: list[str]
    tools: list[str]
    modes: list[str] = Field(default_factory=lambda: ["prs_autonomous", "prs_reviewed"])
    variants_per_task: int = 3
    pre_registration_url: str | None = None
    random_seed: int = 42


class TaskDefinition(BaseModel):
    """Loaded task definition."""

    task_id: str
    name: str
    prompts: dict[str, str]  # {variant_name: prompt_text}
    acceptance_criteria: str
    weight_template: dict[str, float]


class BenchmarkRun(BaseModel):
    """A single benchmark run (one tool, one task, one variant, one mode, one repetition)."""

    run_id: str
    cycle_id: str
    tool_id: str
    task_id: str
    variant: str
    mode: str
    repetition: int
    started_at: datetime
    completed_at: datetime | None = None
    tool_output: ToolOutput | None = None
    deployment: DeploymentResult | None = None
    scores: dict[str, ScoreResult] = Field(default_factory=dict)
    status: str = "pending"  # pending|generating|deploying|scoring|complete|failed
    error: str | None = None


@dataclass
class BenchmarkCycle:
    """A full benchmark cycle (e.g. Sigil Index Q3 2026)."""

    config: BenchmarkConfig
    runs: list[BenchmarkRun] = field(default_factory=list)
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None


# ---------- Orchestrator ----------


class Orchestrator:
    """
    Main orchestrator. Drives a benchmark cycle end-to-end.

    v0 implementation: heavily stubbed. Production version requires:
    - Tool API integrations (some, like Cursor/Bolt/Lovable, lack APIs entirely
      and will require browser automation or manual input)
    - Modal/Fly/Railway deployment automation
    - Scoring engine implementations (only security/static-analysis present in v0)
    - Pre-registration submission to OSF
    - Output archival for long-term reproducibility
    """

    def __init__(
        self,
        config: BenchmarkConfig,
        tasks_dir: Path,
        results_dir: Path,
        tools_registry: dict[str, ToolAdapter],
        deployment_target: DeploymentTarget,
        scoring_engines: list[ScoringEngine],
    ):
        self.config = config
        self.tasks_dir = tasks_dir
        self.results_dir = results_dir
        self.tools_registry = tools_registry
        self.deployment_target = deployment_target
        self.scoring_engines = scoring_engines
        self.cycle = BenchmarkCycle(config=config)

    # ----- Public API -----

    async def run_cycle(self) -> BenchmarkCycle:
        """Execute the full benchmark cycle."""
        logger.info(
            "Starting benchmark cycle %s (methodology v%s)",
            self.config.cycle_id,
            self.config.methodology_version,
        )

        tasks = self._load_tasks()
        runs_to_execute = self._plan_runs(tasks)

        logger.info("Planned %d runs", len(runs_to_execute))

        for run in runs_to_execute:
            await self._execute_run(run, tasks[run.task_id])
            self._persist_run(run)
            self.cycle.runs.append(run)

        self.cycle.completed_at = datetime.now(timezone.utc)
        self._persist_cycle()

        logger.info(
            "Cycle %s complete: %d runs, %d failures",
            self.config.cycle_id,
            len(self.cycle.runs),
            sum(1 for r in self.cycle.runs if r.status == "failed"),
        )

        return self.cycle

    async def run_single(
        self,
        tool_id: str,
        task_id: str,
        variant: str,
        mode: str = "prs_autonomous",
    ) -> BenchmarkRun:
        """Smoke test: execute a single run."""
        tasks = self._load_tasks()
        if task_id not in tasks:
            raise ValueError(f"Task {task_id} not found")

        run = BenchmarkRun(
            run_id=self._make_run_id(tool_id, task_id, variant, mode, 0),
            cycle_id=self.config.cycle_id,
            tool_id=tool_id,
            task_id=task_id,
            variant=variant,
            mode=mode,
            repetition=0,
            started_at=datetime.now(timezone.utc),
        )

        await self._execute_run(run, tasks[task_id])
        self._persist_run(run)
        return run

    # ----- Internal -----

    def _load_tasks(self) -> dict[str, TaskDefinition]:
        """Load task definitions from the tasks/ directory."""
        tasks: dict[str, TaskDefinition] = {}

        rubric_path = self.tasks_dir / "shared" / "scoring_rubric_v04.yaml"
        rubric = yaml.safe_load(rubric_path.read_text()) if rubric_path.exists() else {}
        weight_templates = rubric.get("task_weight_templates", {})

        for task_id in self.config.tasks:
            task_dir = self.tasks_dir / task_id
            if not task_dir.is_dir():
                logger.warning("Task directory missing: %s", task_dir)
                continue

            prompts: dict[str, str] = {}
            for variant in ("terse", "verbose", "casual"):
                prompt_file = task_dir / f"prompt_{variant}.md"
                if prompt_file.exists():
                    prompts[variant] = prompt_file.read_text()

            acceptance_file = task_dir / "acceptance_criteria.md"
            acceptance = acceptance_file.read_text() if acceptance_file.exists() else ""

            tasks[task_id] = TaskDefinition(
                task_id=task_id,
                name=task_id.replace("_", " ").title(),
                prompts=prompts,
                acceptance_criteria=acceptance,
                weight_template=weight_templates.get(task_id, {}),
            )

        return tasks

    def _plan_runs(
        self, tasks: dict[str, TaskDefinition]
    ) -> list[BenchmarkRun]:
        """Compute the full grid of runs to execute."""
        runs: list[BenchmarkRun] = []
        for task_id, task in tasks.items():
            for tool_id in self.config.tools:
                for variant in task.prompts.keys():
                    for mode in self.config.modes:
                        for rep in range(self.config.runs_per_condition):
                            runs.append(
                                BenchmarkRun(
                                    run_id=self._make_run_id(
                                        tool_id, task_id, variant, mode, rep
                                    ),
                                    cycle_id=self.config.cycle_id,
                                    tool_id=tool_id,
                                    task_id=task_id,
                                    variant=variant,
                                    mode=mode,
                                    repetition=rep,
                                    started_at=datetime.now(timezone.utc),
                                )
                            )
        return runs

    async def _execute_run(
        self, run: BenchmarkRun, task: TaskDefinition
    ) -> None:
        """Run the full pipeline for a single benchmark run."""
        try:
            # 1. Generate via tool
            run.status = "generating"
            tool = self.tools_registry[run.tool_id]
            prompt = task.prompts[run.variant]
            run.tool_output = await tool.generate(prompt, mode=run.mode)

            # 2. Deploy to standardized environment
            run.status = "deploying"
            run.deployment = await self.deployment_target.deploy(
                run.tool_output,
                run_id=run.run_id,
            )

            # 3. Score against deployed environment
            run.status = "scoring"
            for engine in self.scoring_engines:
                result = await engine.score(
                    deployment=run.deployment,
                    task=task,
                    tool_output=run.tool_output,
                )
                run.scores[engine.dimension_id] = result

            run.status = "complete"

        except Exception as exc:
            logger.exception("Run %s failed", run.run_id)
            run.status = "failed"
            run.error = str(exc)

        finally:
            run.completed_at = datetime.now(timezone.utc)

    def _make_run_id(
        self, tool_id: str, task_id: str, variant: str, mode: str, rep: int
    ) -> str:
        return f"{self.config.cycle_id}.{tool_id}.{task_id}.{variant}.{mode}.r{rep:03d}"

    def _persist_run(self, run: BenchmarkRun) -> None:
        """Persist a single run's data to disk."""
        run_dir = (
            self.results_dir
            / self.config.cycle_id
            / "runs"
            / run.tool_id
            / run.task_id
        )
        run_dir.mkdir(parents=True, exist_ok=True)
        out_path = run_dir / f"{run.run_id}.json"
        out_path.write_text(run.model_dump_json(indent=2))

    def _persist_cycle(self) -> None:
        """Persist cycle metadata + run summaries."""
        cycle_dir = self.results_dir / self.config.cycle_id
        cycle_dir.mkdir(parents=True, exist_ok=True)
        summary_path = cycle_dir / "cycle_summary.json"
        import json

        summary = {
            "cycle_id": self.config.cycle_id,
            "config": self.config.model_dump(),
            "started_at": self.cycle.started_at.isoformat(),
            "completed_at": self.cycle.completed_at.isoformat() if self.cycle.completed_at else None,
            "total_runs": len(self.cycle.runs),
            "completed": sum(1 for r in self.cycle.runs if r.status == "complete"),
            "failed": sum(1 for r in self.cycle.runs if r.status == "failed"),
        }
        summary_path.write_text(json.dumps(summary, indent=2))
