"""
Re-score existing smoke-test outputs with the v0.5 candidate Quality engine.

Takes already-collected output_files directories under results/, reconstructs
a ToolOutput-like object, and runs only the QualityScoringEngine. Writes
results to a quality_scoring.json file alongside the original scoring.json.

Usage:
    python scripts/rescore_quality.py
    python scripts/rescore_quality.py --results-dir results/smoke-claude-code-task_01_b2b_portal-terse
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from rich.console import Console
from rich.table import Table

from harness.deployment.base import DeploymentResult
from harness.orchestrator import TaskDefinition
from harness.scoring.quality import QualityScoringEngine
from harness.tools.base import ToolOutput

console = Console(legacy_windows=False, force_terminal=True)


def _collect_files(output_dir: Path) -> dict[str, str]:
    """Recursively read all files under output_dir into a {relpath: content} dict."""
    files: dict[str, str] = {}
    for path in output_dir.rglob("*"):
        if not path.is_file():
            continue
        # Skip node_modules and friends
        if any(part in {"node_modules", ".git", "dist", "build", ".next"}
               for part in path.parts):
            continue
        try:
            if path.stat().st_size > 1_000_000:
                continue
        except OSError:
            continue
        try:
            rel = path.relative_to(output_dir).as_posix()
            files[rel] = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
    return files


async def rescore_one(results_dir: Path) -> dict | None:
    output_files_dir = results_dir / "output_files"
    if not output_files_dir.is_dir():
        console.print(f"[yellow]Skipping {results_dir.name}: no output_files/[/yellow]")
        return None

    files = _collect_files(output_files_dir)
    if not files:
        console.print(f"[yellow]Skipping {results_dir.name}: no files collected[/yellow]")
        return None

    console.print(f"[cyan]Scoring {results_dir.name}[/cyan] ({len(files)} files)")

    tool_output = ToolOutput(
        tool_id="claude-code",
        model="claude-code",
        mode="prs_autonomous",
        prompt="(rescored from disk)",
        output_files=files,
        completion_status="complete",
        generated_at=datetime.now(timezone.utc),
    )

    task = TaskDefinition(
        task_id=results_dir.name,
        name=results_dir.name,
        prompts={},
        acceptance_criteria="",
        weight_template={},
    )

    deployment = DeploymentResult(
        run_id=results_dir.name,
        target="none",
        success=True,
        deployed_at=datetime.now(timezone.utc),
    )

    engine = QualityScoringEngine()
    result = await engine.score(deployment=deployment, task=task, tool_output=tool_output)

    summary = {
        "results_dir": results_dir.name,
        "files_scored": len(files),
        "dimension_score": result.dimension_score,
        "sub_components": [
            {
                "id": s.sub_component_id,
                "name": s.name,
                "score": s.score,
                "rubric": s.rubric_match,
                "tool_used": s.tool_used,
                "findings": s.raw_findings,
                "notes": s.notes,
            }
            for s in result.sub_component_scores
        ],
    }

    out_path = results_dir / "quality_scoring.json"
    out_path.write_text(json.dumps(summary, indent=2))

    return summary


async def main() -> None:
    parser = argparse.ArgumentParser(description="Re-score existing outputs with Quality engine (v0.5 candidate)")
    parser.add_argument("--results-dir", default=None, help="Score a single directory; defaults to all smoke-claude-code-* dirs")
    args = parser.parse_args()

    results_root = REPO_ROOT / "results"

    if args.results_dir:
        dirs = [Path(args.results_dir)]
    else:
        dirs = sorted(d for d in results_root.iterdir()
                      if d.is_dir() and d.name.startswith("smoke-claude-code-"))

    summaries: list[dict] = []
    for d in dirs:
        summary = await rescore_one(d)
        if summary:
            summaries.append(summary)

    if not summaries:
        console.print("[red]No outputs scored.[/red]")
        return

    # Print comparison table
    table = Table(title="Quality Dimension Scores (v0.5 candidate)")
    table.add_column("Result Dir", overflow="fold")
    table.add_column("Files")
    table.add_column("Quality /100")
    for s_id in [
        "qual_01_cyclomatic_complexity",
        "qual_02_duplication",
        "qual_03_function_size",
        "qual_04_documentation_coverage",
        "qual_05_type_safety",
        "qual_06_test_coverage",
        "qual_07_linter_compliance",
        "qual_08_naming_consistency",
        "qual_09_module_structure",
        "qual_10_dead_code",
    ]:
        short = s_id.replace("qual_", "").split("_", 1)[0]
        table.add_column(short)

    for s in summaries:
        row = [
            s["results_dir"].replace("smoke-claude-code-", ""),
            str(s["files_scored"]),
            f"{s['dimension_score']:.0f}",
        ]
        by_id = {sub["id"]: sub for sub in s["sub_components"]}
        for s_id in [
            "qual_01_cyclomatic_complexity",
            "qual_02_duplication",
            "qual_03_function_size",
            "qual_04_documentation_coverage",
            "qual_05_type_safety",
            "qual_06_test_coverage",
            "qual_07_linter_compliance",
            "qual_08_naming_consistency",
            "qual_09_module_structure",
            "qual_10_dead_code",
        ]:
            sub = by_id.get(s_id)
            row.append(f"{sub['score']:.0f}" if sub else "—")
        table.add_row(*row)

    console.print()
    console.print(table)
    console.print()
    console.print("[dim]quality_scoring.json written per result dir[/dim]")


if __name__ == "__main__":
    asyncio.run(main())
