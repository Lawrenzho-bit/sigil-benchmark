"""
Sigil Benchmark CLI.

Entry point for running benchmark cycles, smoke tests, and analysis.

Usage:
  sigil-bench list-tasks
  sigil-bench list-tools
  sigil-bench smoke --task task_01_b2b_portal --tool claude-sonnet-4-5 --variant terse
  sigil-bench run --cycle 2026-Q3 --tasks task_01_b2b_portal --tools claude-sonnet-4-5,openai-gpt-5 --runs 5
  sigil-bench analyze --cycle 2026-Q3
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

import click
from rich.console import Console
from rich.logging import RichHandler
from rich.table import Table

from harness.analysis.aggregation import CycleAggregator
from harness.deployment.modal_target import ModalDeploymentTarget
from harness.orchestrator import BenchmarkConfig, Orchestrator
from harness.scoring.compliance import ComplianceScoringEngine
from harness.scoring.cost_efficiency import CostEfficiencyScoringEngine
from harness.scoring.production_ops import ProductionOpsScoringEngine
from harness.scoring.quality import QualityScoringEngine
from harness.scoring.scalability import ScalabilityScoringEngine
from harness.scoring.security import SecurityScoringEngine
from harness.tools.claude import ClaudeAdapter
from harness.tools.claude_code import ClaudeCodeAdapter
from harness.tools.openai_adapter import OpenAIAdapter

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    handlers=[RichHandler(rich_tracebacks=True, show_time=False)],
)

console = Console()

REPO_ROOT = Path(__file__).resolve().parent.parent
TASKS_DIR = REPO_ROOT / "tasks"
RESULTS_DIR = REPO_ROOT / "results"


def _build_tools_registry() -> dict[str, ClaudeAdapter | OpenAIAdapter | ClaudeCodeAdapter]:
    """Build the registry of available tool adapters."""
    return {
        # CLI-based (uses your existing subscription, no API key)
        "claude-code": ClaudeCodeAdapter(),

        # API-based (raw model output, requires API keys)
        "claude-sonnet-4-5": ClaudeAdapter(model="claude-sonnet-4-5"),
        "claude-opus-4": ClaudeAdapter(model="claude-opus-4"),
        "claude-haiku-4-5": ClaudeAdapter(model="claude-haiku-4-5"),
        "openai-gpt-5": OpenAIAdapter(model="gpt-5"),
        "openai-gpt-4o": OpenAIAdapter(model="gpt-4o"),
        "openai-o3": OpenAIAdapter(model="o3", reasoning_effort="medium"),
    }


def _build_scoring_engines() -> list:
    """Build the list of scoring engines (one per dimension)."""
    return [
        SecurityScoringEngine(),
        ProductionOpsScoringEngine(),
        ComplianceScoringEngine(),
        CostEfficiencyScoringEngine(),
        # ScalabilityScoringEngine — not yet implemented
    ]


@click.group()
@click.version_option(version="0.1.0")
def main() -> None:
    """Sigil Benchmark — Production Readiness Score (PRS v0.4)."""


@main.command("list-tasks")
def list_tasks() -> None:
    """List all available benchmark tasks."""
    table = Table(title="Available Tasks")
    table.add_column("Task ID")
    table.add_column("Status")
    table.add_column("Variants")

    for task_dir in sorted(TASKS_DIR.iterdir()):
        if not task_dir.is_dir() or task_dir.name == "shared":
            continue
        variants = sorted(p.stem.replace("prompt_", "") for p in task_dir.glob("prompt_*.md"))
        status = "Ready" if variants else "Stubbed"
        table.add_row(task_dir.name, status, ", ".join(variants) or "—")

    console.print(table)


@main.command("list-tools")
def list_tools() -> None:
    """List tool adapters available."""
    table = Table(title="Available Tools")
    table.add_column("Tool ID")
    table.add_column("Type")
    table.add_column("Status")

    for tool_id, adapter in _build_tools_registry().items():
        adapter_type = type(adapter).__name__
        table.add_row(tool_id, adapter_type, "Ready")

    # Manual-adapter-only tools
    for tool_id in ("cursor", "bolt", "lovable", "v0", "replit-ai"):
        table.add_row(tool_id, "ManualAdapter", "Requires pre-collected outputs")

    # Not yet wired
    for tool_id in ("devin", "mythos", "sigil-deploy"):
        table.add_row(tool_id, "—", "Adapter not yet written")

    console.print(table)


@main.command("list-scoring")
def list_scoring() -> None:
    """List scoring engines registered."""
    table = Table(title="Available Scoring Engines")
    table.add_column("Dimension")
    table.add_column("Class")
    table.add_column("Sub-components Implemented")

    impl = {
        "security": "3 of 10 (Semgrep, npm audit, gitleaks)",
        "production_ops": "7 of 10 (observability, health, backup, pooling, cache, CI/CD, time)",
        "compliance": "10 of 10 (static analysis; functionality tier 4 deployment-only)",
        "cost_efficiency": "7 of 10 (vendor lockin, multi-cloud, OSS ratio, egress, auto-shutdown, sizing, pricing)",
        "scalability": "0 of 10 (engine not yet implemented)",
    }
    for engine in _build_scoring_engines():
        table.add_row(
            engine.dimension_id,
            type(engine).__name__,
            impl.get(engine.dimension_id, "?"),
        )
    table.add_row("scalability", "ScalabilityScoringEngine", impl["scalability"])

    console.print(table)


@main.command("smoke")
@click.option("--task", default="task_01_b2b_portal", help="Task to run")
@click.option("--tool", default="claude-sonnet-4-5", help="Tool ID")
@click.option("--variant", default="terse", help="Prompt variant: terse|verbose|casual")
@click.option("--cycle", default="smoke-test", help="Cycle ID for results storage")
def smoke(task: str, tool: str, variant: str, cycle: str) -> None:
    """Smoke test: run a single task on a single tool."""
    config = BenchmarkConfig(
        cycle_id=cycle,
        tasks=[task],
        tools=[tool],
        runs_per_condition=1,
        modes=["prs_autonomous"],
    )

    registry = _build_tools_registry()
    if tool not in registry:
        console.print(f"[red]Tool {tool} not registered.[/red]")
        console.print("Run 'sigil-bench list-tools' to see available tools.")
        sys.exit(1)

    orchestrator = Orchestrator(
        config=config,
        tasks_dir=TASKS_DIR,
        results_dir=RESULTS_DIR,
        tools_registry=registry,
        deployment_target=ModalDeploymentTarget(),
        scoring_engines=_build_scoring_engines(),
    )

    console.print(f"[bold cyan]Smoke test:[/bold cyan] {tool} on {task} ({variant})")
    run = asyncio.run(orchestrator.run_single(tool, task, variant))

    console.print()
    console.print(f"[bold]Status:[/bold] {run.status}")
    if run.error:
        console.print(f"[red]Error:[/red] {run.error}")
    if run.tool_output:
        console.print(f"[bold]Files generated:[/bold] {len(run.tool_output.output_files)}")
        console.print(f"[bold]Completion:[/bold] {run.tool_output.completion_status}")
        if run.tool_output.tokens_output:
            console.print(f"[bold]Output tokens:[/bold] {run.tool_output.tokens_output}")
        if run.tool_output.wall_clock_seconds:
            console.print(f"[bold]Wall clock:[/bold] {run.tool_output.wall_clock_seconds:.1f}s")

    if run.scores:
        score_table = Table(title="Scores by Dimension")
        score_table.add_column("Dimension")
        score_table.add_column("Score")
        score_table.add_column("Sub-components")
        for dim_id, score_result in run.scores.items():
            score_table.add_row(
                dim_id,
                f"{score_result.dimension_score:.1f}/100",
                str(len(score_result.sub_component_scores)),
            )
        console.print(score_table)


@main.command("run")
@click.option("--cycle", required=True, help="Cycle ID, e.g. 2026-Q3")
@click.option("--tasks", required=True, help="Comma-separated task IDs")
@click.option("--tools", required=True, help="Comma-separated tool IDs")
@click.option("--runs", default=50, help="Runs per condition (v0.4 spec: 50)")
@click.option("--modes", default="prs_autonomous", help="Comma-separated modes")
def run_cycle(cycle: str, tasks: str, tools: str, runs: int, modes: str) -> None:
    """Run a full benchmark cycle."""
    config = BenchmarkConfig(
        cycle_id=cycle,
        tasks=tasks.split(","),
        tools=tools.split(","),
        runs_per_condition=runs,
        modes=modes.split(","),
    )

    console.print(f"[bold cyan]Running cycle:[/bold cyan] {cycle}")
    console.print(f"  Tasks: {config.tasks}")
    console.print(f"  Tools: {config.tools}")
    console.print(f"  Runs per condition: {config.runs_per_condition}")
    console.print(f"  Modes: {config.modes}")

    total_runs = (
        len(config.tasks) * len(config.tools) * len(config.modes) * 3 * config.runs_per_condition
    )
    console.print(f"  Total runs: {total_runs:,}")

    console.print(
        "[yellow]v0 scaffold: orchestrator will run but deployment "
        "step is stubbed; scoring is static-analysis-only.[/yellow]"
    )

    orchestrator = Orchestrator(
        config=config,
        tasks_dir=TASKS_DIR,
        results_dir=RESULTS_DIR,
        tools_registry=_build_tools_registry(),
        deployment_target=ModalDeploymentTarget(),
        scoring_engines=_build_scoring_engines(),
    )

    cycle_result = asyncio.run(orchestrator.run_cycle())
    console.print(f"[green]Cycle complete:[/green] {len(cycle_result.runs)} runs persisted")
    console.print(f"[bold]Next step:[/bold] sigil-bench analyze --cycle {cycle}")


@main.command("analyze")
@click.option("--cycle", required=True, help="Cycle ID to analyze")
def analyze(cycle: str) -> None:
    """Aggregate scores across runs and compute publication-grade statistics."""
    cycle_dir = RESULTS_DIR / cycle
    if not cycle_dir.exists():
        console.print(f"[red]Cycle directory not found: {cycle_dir}[/red]")
        sys.exit(1)

    console.print(f"[bold cyan]Analyzing cycle:[/bold cyan] {cycle}")
    aggregator = CycleAggregator(cycle_dir)
    output = aggregator.aggregate()

    console.print()
    console.print(f"[bold]Total runs:[/bold] {output.total_runs}")
    console.print(f"[bold]Complete:[/bold] {output.complete_runs}")
    console.print(f"[bold]Failed:[/bold] {output.failed_runs}")
    console.print(f"[bold]Tools evaluated:[/bold] {len(output.per_tool)}")
    console.print(f"[bold]Tasks evaluated:[/bold] {len(output.per_task)}")

    if output.per_tool:
        tool_table = Table(title="Per-Tool Composite PRS")
        tool_table.add_column("Tool")
        tool_table.add_column("Composite PRS (mean)")
        tool_table.add_column("95% CI")
        tool_table.add_column("Completion Rate")
        tool_table.add_column("CES (PRS × Completion)")
        for tool_id, stats in sorted(
            output.per_tool.items(), key=lambda x: -x[1]["composite_prs"]["mean"]
        ):
            tool_table.add_row(
                tool_id,
                f"{stats['composite_prs']['mean']:.1f}",
                f"[{stats['composite_prs']['ci_lower']:.1f}, {stats['composite_prs']['ci_upper']:.1f}]",
                f"{stats['completion_rate']:.0%}",
                f"{stats['composite_effective_score']:.1f}",
            )
        console.print(tool_table)

    if output.rank_distributions:
        rank_table = Table(title="Rank Stability (v0.4 §9)")
        rank_table.add_column("Tool")
        rank_table.add_column("Mean Rank")
        rank_table.add_column("80% CI")
        rank_table.add_column("RSC")
        for tool_id, ranks in sorted(
            output.rank_distributions.items(), key=lambda x: x[1]["mean_rank"]
        ):
            rank_table.add_row(
                tool_id,
                f"{ranks['mean_rank']:.1f}",
                f"[{ranks['p10_rank']:.0f}, {ranks['p90_rank']:.0f}]",
                f"{ranks['rsc']:.2f}",
            )
        console.print(rank_table)

    significant = [
        c for c in output.pairwise_comparisons if c.get("practically_significant")
    ]
    if significant:
        sig_table = Table(title="Statistically + Practically Significant Differences")
        sig_table.add_column("Tool A")
        sig_table.add_column("Tool B")
        sig_table.add_column("Δ mean")
        sig_table.add_column("Cohen's d")
        sig_table.add_column("q-value")
        for c in significant[:10]:
            sig_table.add_row(
                c["tool_a"],
                c["tool_b"],
                f"{c['mean_diff']:+.1f}",
                f"{c['cohens_d']:+.2f}",
                f"{c['q_value']:.4f}",
            )
        console.print(sig_table)

    console.print()
    console.print(f"[green]Aggregates written to[/green] {cycle_dir / 'aggregates'}")


if __name__ == "__main__":
    main()
