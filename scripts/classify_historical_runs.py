"""
Apply the RFC 0004 Failure Mode classifier to the 22 historical runs
collected in 2026-05-19 to 2026-05-21. Validates the classifier against
the manual taxonomy already published in RFC 0004 §3.4.

Two data sources are reconciled:
  1. results/<run>/scoring.json — exists only for successful runs that
     reached the scoring stage
  2. /tmp/batch_*.log + /tmp/smoke_*.log — wall-clock + file-count
     extractable for every run (including failed ones)

For runs without scoring.json, we synthesize a minimal ToolOutput from
the log file contents and run the classifier.

Output: a Markdown table for paste into LEADERBOARD / RFC 0004, plus
a JSON report at results/fmd_historical.json.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from harness.scoring.failure_mode import (
    FailureModeLabel,
    classify_failure_mode,
    completion_rate,
    compute_fmd,
    constructive_rate,
    dominant_failure_mode,
)
from harness.tools.base import ToolOutput


# The 22 runs catalogued in the 2026-05-21 leaderboard table, in order.
# Each entry: (run_id, task, variant, ni_applied, wall_clock_seconds,
#              file_count, returncode, completion_status, refusal_reason)
HISTORICAL_RUNS = [
    # T01 b2b_portal
    ("T01-terse-run1", "task_01_b2b_portal", "terse", False, 466.0, 42, 0, "complete", None),
    ("T01-terse-run2", "task_01_b2b_portal", "terse", False, 33.0, 0, 0, "partial", "No files written to workdir"),
    ("T01-terse-run3", "task_01_b2b_portal", "terse", False, 48.0, 0, 0, "partial", "No files written to workdir"),
    ("T01-terse-run4", "task_01_b2b_portal", "terse", False, 52.0, 0, 0, "partial", "No files written to workdir"),
    ("T01-terse-NI-run1", "task_01_b2b_portal", "terse", True, 39.0, 0, 0, "partial", "No files written to workdir"),
    ("T01-terse-NI-run2", "task_01_b2b_portal", "terse", True, 44.0, 0, 0, "partial", "No files written to workdir"),
    ("T01-verbose", "task_01_b2b_portal", "verbose", False, 45.0, 0, 0, "partial", "No files written to workdir"),
    ("T01-verbose-NI", "task_01_b2b_portal", "verbose", True, 39.0, 0, 0, "partial", "No files written to workdir"),
    ("T01-casual", "task_01_b2b_portal", "casual", False, 41.0, 0, 0, "partial", "No files written to workdir"),
    ("T01-casual-NI", "task_01_b2b_portal", "casual", True, 551.0, 39, 0, "complete", None),
    # T02 admin_tool
    ("T02-terse-attempt1", "task_02_admin_tool", "terse", False, 54.0, 0, 0, "partial", "No files written to workdir"),
    ("T02-terse-attempt2", "task_02_admin_tool", "terse", False, 108.0, 0, 0, "partial", "No files written to workdir"),
    ("T02-terse-attempt3", "task_02_admin_tool", "terse", False, 806.0, 0, 1, "failed", "Non-zero exit: 1"),
    ("T02-terse-NI", "task_02_admin_tool", "terse", True, 549.0, 36, 0, "complete", None),
    # T03 marketplace
    ("T03-terse-run1", "task_03_marketplace", "terse", False, 149.0, 1, 0, "complete", None),
    ("T03-terse-run2", "task_03_marketplace", "terse", False, 63.0, 0, 0, "partial", "No files written to workdir"),
    ("T03-terse-NI", "task_03_marketplace", "terse", True, 535.0, 35, 0, "complete", None),
    # T04 support
    ("T04-terse-run1", "task_04_support", "terse", False, 1246.0, 40, 0, "complete", None),
    ("T04-terse-run2", "task_04_support", "terse", False, 30.0, 0, 0, "partial", "No files written to workdir"),
    ("T04-terse-run3", "task_04_support", "terse", False, 23.0, 0, 0, "partial", "No files written to workdir"),
    ("T04-terse-run4", "task_04_support", "terse", False, 30.0, 0, 0, "partial", "No files written to workdir"),
    ("T04-terse-NI-run1", "task_04_support", "terse", True, 633.0, 66, 0, "complete", None),
    ("T04-terse-NI-run2", "task_04_support", "terse", True, 568.0, 28, 0, "complete", None),
]


def _result_dir_for(run_id: str) -> Path:
    """Best-effort lookup of the on-disk results dir for a known run."""
    # Map run_id to a results-dir prefix
    if run_id == "T01-terse-run1":
        return REPO_ROOT / "results" / "smoke-claude-code-task_01_b2b_portal-terse"
    if run_id == "T01-casual-NI":
        return REPO_ROOT / "results" / "smoke-claude-code-task_01_b2b_portal-casual-NI-run1"
    if run_id == "T02-terse-NI":
        return REPO_ROOT / "results" / "smoke-claude-code-task_02_admin_tool-terse-NI-run1"
    if run_id == "T03-terse-run1":
        return REPO_ROOT / "results" / "smoke-claude-code-task_03_marketplace-terse"
    if run_id == "T03-terse-NI":
        return REPO_ROOT / "results" / "smoke-claude-code-task_03_marketplace-terse-NI-run1"
    if run_id == "T04-terse-run1":
        return REPO_ROOT / "results" / "smoke-claude-code-task_04_support-terse"
    if run_id == "T04-terse-NI-run1":
        return REPO_ROOT / "results" / "smoke-claude-code-task_04_support-terse-NI-run1"
    if run_id == "T04-terse-NI-run2":
        return REPO_ROOT / "results" / "smoke-claude-code-task_04_support-terse-NI-run2"
    return None  # type: ignore[return-value]


def _build_tool_output(
    run_id: str,
    task: str,
    variant: str,
    ni: bool,
    wall_clock: float,
    file_count: int,
    returncode: int,
    completion_status: str,
    refusal_reason: str | None,
) -> ToolOutput:
    """Synthesize a ToolOutput from historical run metadata."""
    files: dict[str, str] = {}
    result_dir = _result_dir_for(run_id)
    if result_dir and result_dir.exists():
        output_files_dir = result_dir / "output_files"
        if output_files_dir.exists():
            for p in output_files_dir.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(output_files_dir).as_posix()
                    try:
                        files[rel] = p.read_text(encoding="utf-8")
                    except (OSError, UnicodeDecodeError):
                        files[rel] = ""

    return ToolOutput(
        tool_id="claude-code",
        model="claude-code-default",
        mode="prs_autonomous",
        prompt="(historical reconstruction)",
        output_files=files,
        completion_status=completion_status,
        refusal_reason=refusal_reason,
        wall_clock_seconds=wall_clock,
        raw_response={"returncode": returncode, "stdout_tail": "", "stderr_tail": ""},
    )


def main() -> None:
    print("Classifying 22 historical runs against RFC 0004 §3.1 taxonomy")
    print("=" * 72)

    by_condition: dict[tuple[str, str, bool], list] = {}
    per_run: list[dict] = []

    for entry in HISTORICAL_RUNS:
        run_id, task, variant, ni, wc, fc, rc, status, refusal = entry
        tool_output = _build_tool_output(
            run_id, task, variant, ni, wc, fc, rc, status, refusal
        )
        result = classify_failure_mode(
            tool_output,
            configured_timeout_seconds=3600.0,
            min_files_for_complete=5,
        )
        per_run.append({
            "run_id": run_id,
            "task": task,
            "variant": variant,
            "ni_applied": ni,
            "wall_clock_seconds": wc,
            "files": fc,
            "label": result.label.value,
            "reasoning": result.reasoning,
        })
        condition_key = (task, variant, ni)
        by_condition.setdefault(condition_key, []).append(result)

    # Per-run table
    print("\n## Per-run classification\n")
    print("| Run | Files | Wall clock | Exit | Label |")
    print("|---|---|---|---|---|")
    for r in per_run:
        print(
            f"| {r['run_id']} | {r['files']} | {r['wall_clock_seconds']:.0f}s "
            f"| — | `{r['label']}` |"
        )

    # Per-condition FMD
    print("\n## Per-condition Failure Mode Distribution\n")
    print("| Tool | Task | Variant | NI | N | Completion Rate | Constructive Rate | Dominant Failure | FMD |")
    print("|---|---|---|---|---|---|---|---|---|")
    fmd_summary = []
    for (task, variant, ni), results in sorted(by_condition.items()):
        cr = completion_rate(results)
        cor = constructive_rate(results)
        dom = dominant_failure_mode(results)
        fmd = compute_fmd(results)
        fmd_nonzero = {k: round(v, 2) for k, v in fmd.items() if v > 0}
        fmd_str = ", ".join(f"{k}: {v}" for k, v in fmd_nonzero.items())
        dom_str = dom.value if dom else "—"
        print(
            f"| claude-code | {task} | {variant} | {'yes' if ni else 'no'} "
            f"| {len(results)} | {cr:.0%} | {cor:.0%} | {dom_str} | {{{fmd_str}}} |"
        )
        fmd_summary.append({
            "tool": "claude-code",
            "task": task,
            "variant": variant,
            "ni_applied": ni,
            "n": len(results),
            "completion_rate": cr,
            "constructive_rate": cor,
            "dominant_failure_mode": dom.value if dom else None,
            "fmd": fmd,
        })

    # Sanity check against RFC 0004 §3.4 manual table
    expected_labels = {
        "T01-terse-run1": "complete",
        "T01-terse-run2": "silent_decline",
        "T01-terse-run3": "silent_decline",
        "T01-terse-run4": "silent_decline",
        "T01-terse-NI-run1": "silent_decline",
        "T01-terse-NI-run2": "silent_decline",
        "T01-verbose": "silent_decline",
        "T01-verbose-NI": "silent_decline",
        "T01-casual": "silent_decline",
        "T01-casual-NI": "complete",
        "T02-terse-attempt1": "silent_decline",
        "T02-terse-attempt2": "silent_decline",
        "T02-terse-attempt3": "attempted_abort",
        "T02-terse-NI": "complete",
        "T03-terse-run1": "wrong_artifact",
        "T03-terse-run2": "silent_decline",
        "T03-terse-NI": "complete",
        "T04-terse-run1": "complete",
        "T04-terse-run2": "silent_decline",
        "T04-terse-run3": "silent_decline",
        "T04-terse-run4": "silent_decline",
        "T04-terse-NI-run1": "complete",
        "T04-terse-NI-run2": "complete",
    }
    mismatches = []
    for r in per_run:
        expected = expected_labels[r["run_id"]]
        if r["label"] != expected:
            mismatches.append(
                (r["run_id"], expected, r["label"], r["reasoning"])
            )

    print("\n## Validation against RFC 0004 section 3.4 manual taxonomy\n")
    if not mismatches:
        print(f"[OK] All {len(per_run)}/{len(per_run)} runs match the manual labels.")
    else:
        print(f"[!!] {len(mismatches)} mismatch(es):")
        for run_id, exp, got, why in mismatches:
            print(f"  - {run_id}: expected `{exp}`, got `{got}` -- {why}")

    # Save JSON report
    output = {
        "generated_at": "2026-05-21",
        "rfc": "RFC 0004",
        "n_runs": len(per_run),
        "n_conditions": len(by_condition),
        "per_run": per_run,
        "per_condition_fmd": fmd_summary,
        "validation_mismatches": [
            {"run_id": m[0], "expected": m[1], "got": m[2], "reasoning": m[3]}
            for m in mismatches
        ],
    }
    report_path = REPO_ROOT / "results" / "fmd_historical.json"
    report_path.write_text(json.dumps(output, indent=2))
    print(f"\nReport saved: {report_path}")


if __name__ == "__main__":
    main()
