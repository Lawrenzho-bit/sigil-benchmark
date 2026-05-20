"""
Smoke test: run claude -p against a single Sigil task and score the output
across all 5 PRS dimensions.

Usage:
    python scripts/smoke_claude_code.py [--task TASK_ID] [--variant terse|verbose|casual]

Defaults: --task task_01_b2b_portal --variant terse
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from harness.deployment.base import DeploymentResult
from harness.orchestrator import TaskDefinition
from harness.scoring.compliance import ComplianceScoringEngine
from harness.scoring.cost_efficiency import CostEfficiencyScoringEngine
from harness.scoring.production_ops import ProductionOpsScoringEngine
from harness.scoring.scalability import ScalabilityScoringEngine
from harness.scoring.security import SecurityScoringEngine
from harness.tools.claude_code import ClaudeCodeAdapter

CLAUDE_CLI_PATH = "claude"  # npm-installed shim, on PATH

console = Console(legacy_windows=False, force_terminal=True)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sigil smoke test against claude -p")
    parser.add_argument("--task", default="task_01_b2b_portal", help="Task directory name under tasks/")
    parser.add_argument("--variant", default="terse", choices=("terse", "verbose", "casual"))
    parser.add_argument("--timeout", type=int, default=3600, help="Max seconds for claude -p")
    parser.add_argument("--out-dir", default=None, help="Override output directory")
    return parser.parse_args()


async def smoke() -> None:
    args = _parse_args()

    console.print(
        Panel.fit(
            f"[bold cyan]Sigil Smoke Test: claude -p on {args.task}[/bold cyan]\n"
            f"[dim]Variant: {args.variant} | Real AI-generated code -> 5-dimension PRS scoring[/dim]",
            border_style="cyan",
        )
    )

    # Load task definition
    task_dir = REPO_ROOT / "tasks" / args.task
    if not task_dir.is_dir():
        console.print(f"[red]Task directory not found: {task_dir}[/red]")
        sys.exit(2)
    prompt_path = task_dir / f"prompt_{args.variant}.md"
    if not prompt_path.exists():
        console.print(f"[red]Prompt variant not available: {prompt_path}[/red]")
        sys.exit(2)
    prompt = prompt_path.read_text(encoding="utf-8")
    acceptance_path = task_dir / "acceptance_criteria.md"
    acceptance = acceptance_path.read_text(encoding="utf-8") if acceptance_path.exists() else ""

    task = TaskDefinition(
        task_id=args.task,
        name=args.task.replace("_", " ").title(),
        prompts={args.variant: prompt},
        acceptance_criteria=acceptance,
        weight_template={"security": 0.25, "ops": 0.25, "scale": 0.20, "compliance": 0.20, "cost": 0.10},
    )

    adapter = ClaudeCodeAdapter(cli_path=CLAUDE_CLI_PATH, timeout_seconds=args.timeout)

    console.print(f"[bold]Tool:[/bold] {adapter.tool_id}")
    console.print(f"[bold]CLI:[/bold] {CLAUDE_CLI_PATH}")
    console.print(f"[bold]Task:[/bold] {task.task_id} ({args.variant} variant)")
    console.print(f"[bold]Prompt size:[/bold] {len(prompt)} chars")
    console.print()
    console.print("[yellow]Invoking claude -p ... this may take 5-20 minutes.[/yellow]")

    started = time.monotonic()
    tool_output = await adapter.generate(prompt, mode="prs_autonomous")
    gen_elapsed = time.monotonic() - started

    console.print()
    console.print(f"[bold green]Generation complete[/bold green] in {gen_elapsed:.1f}s")
    console.print(f"  Completion status: [bold]{tool_output.completion_status}[/bold]")
    console.print(f"  Files produced: [bold]{len(tool_output.output_files)}[/bold]")
    if tool_output.refusal_reason:
        console.print(f"  Refusal reason: {tool_output.refusal_reason}")

    if tool_output.output_files:
        # Show first 15 file names
        sample_files = sorted(tool_output.output_files.keys())[:15]
        console.print(f"\n[bold]Sample files:[/bold]")
        for f in sample_files:
            size = len(tool_output.output_files[f])
            console.print(f"  • {f} ({size:,} bytes)")
        if len(tool_output.output_files) > 15:
            console.print(f"  ... and {len(tool_output.output_files) - 15} more")

    if not tool_output.output_files:
        console.print("[red]No files produced — cannot score.[/red]")
        return

    # SAVE OUTPUTS IMMEDIATELY so we don't lose Claude's work if scoring crashes
    run_label = f"smoke-claude-code-{args.task}-{args.variant}"
    results_dir = REPO_ROOT / "results" / (args.out_dir or run_label)
    results_dir.mkdir(parents=True, exist_ok=True)
    output_archive = results_dir / "output_files"
    output_archive.mkdir(exist_ok=True)
    for rel_path, content in tool_output.output_files.items():
        target = output_archive / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            target.write_text(content, encoding="utf-8")
        except (OSError, UnicodeEncodeError):
            pass
    console.print(f"[dim]Saved {len(tool_output.output_files)} files to {output_archive}[/dim]")

    # Fake deployment (we're scoring statically)
    deployment = DeploymentResult(
        run_id=run_label,
        target="none",
        success=True,
        deployed_at=datetime.now(timezone.utc),
    )

    # Score across all 5 dimensions
    console.print("\n[bold cyan]Running scoring engines...[/bold cyan]")
    engines = [
        SecurityScoringEngine(),
        ProductionOpsScoringEngine(),
        ScalabilityScoringEngine(),
        ComplianceScoringEngine(),
        CostEfficiencyScoringEngine(),
    ]

    scoring_started = time.monotonic()
    scores = {}
    for engine in engines:
        score_result = await engine.score(deployment=deployment, task=task, tool_output=tool_output)
        scores[engine.dimension_id] = score_result
    scoring_elapsed = time.monotonic() - scoring_started

    console.print(f"[green]Scoring complete[/green] in {scoring_elapsed:.1f}s")
    console.print()

    # Display results table
    table = Table(title=f"PRS Scores — claude-code on {task.task_id}")
    table.add_column("Dimension")
    table.add_column("Score")
    table.add_column("Sub-components")
    table.add_column("Avg (0-10)")
    for engine in engines:
        result = scores[engine.dimension_id]
        avg = result.average_sub_component()
        table.add_row(
            engine.dimension_name,
            f"{result.dimension_score:.1f}/100",
            str(len(result.sub_component_scores)),
            f"{avg:.1f}",
        )

    composite = sum(s.dimension_score for s in scores.values())
    table.add_row("[bold]COMPOSITE PRS[/bold]", f"[bold]{composite:.1f}[/bold]", "—", "—")
    console.print(table)

    # Per sub-component breakdown
    console.print("\n[bold]Sub-component breakdown (non-zero only):[/bold]")
    for dim_id, result in scores.items():
        non_zero = [s for s in result.sub_component_scores if s.score > 0]
        if non_zero:
            console.print(f"  [cyan]{dim_id}:[/cyan]")
            for sub in non_zero:
                console.print(f"    • {sub.name}: {sub.score:.0f}/10  [dim]({sub.rubric_match or 'n/a'})[/dim]")

    # Save scoring results (output_files already saved earlier)
    scoring_summary = {
        "tool_id": adapter.tool_id,
        "task_id": task.task_id,
        "variant": args.variant,
        "mode": "prs_autonomous",
        "generation_wall_clock_seconds": gen_elapsed,
        "scoring_wall_clock_seconds": scoring_elapsed,
        "completion_status": tool_output.completion_status,
        "refusal_reason": tool_output.refusal_reason,
        "files_produced": len(tool_output.output_files),
        "composite_prs": composite,
        "dimensions": {
            dim_id: {
                "score": result.dimension_score,
                "sub_components": [
                    {
                        "id": s.sub_component_id,
                        "name": s.name,
                        "score": s.score,
                        "rubric": s.rubric_match,
                        "tool_used": s.tool_used,
                    }
                    for s in result.sub_component_scores
                ],
            }
            for dim_id, result in scores.items()
        },
    }
    (results_dir / "scoring.json").write_text(json.dumps(scoring_summary, indent=2))

    console.print()
    console.print(
        Panel.fit(
            f"[bold green][OK] Sigil score recorded[/bold green]\n\n"
            f"Tool: [cyan]claude-code[/cyan]\n"
            f"Task: [cyan]{task.task_id} ({args.variant})[/cyan]\n"
            f"Composite PRS: [bold cyan]{composite:.1f}[/bold cyan]\n"
            f"Generation time: [cyan]{gen_elapsed:.1f}s[/cyan]\n"
            f"Files produced: [cyan]{len(tool_output.output_files)}[/cyan]\n\n"
            f"Output archived: [dim]{output_archive}[/dim]\n"
            f"Scoring JSON: [dim]{results_dir / 'scoring.json'}[/dim]",
            border_style="green",
        )
    )


if __name__ == "__main__":
    asyncio.run(smoke())
