"""
Auto-discover all runs under results/ and produce a per-condition Failure
Mode Distribution report. Unlike classify_historical_runs.py (which has
a hardcoded list of 23 runs for validation purposes), this script reads
whatever's currently on disk and self-updates.

Discovers two kinds of run records:
  * scoring.json — successful runs (files produced, PRS computed)
  * failure_record.json — 0-file runs with FMD classification

Both files contain enough metadata to extract: tool, task, variant,
NI-applied, files produced, completion status, and (for newer runs) the
auto-classified failure_mode.

For older scoring.json files lacking the failure_mode field, the classifier
is re-applied from the run's metadata. Output is a Markdown table
suitable for paste into LEADERBOARD.md, plus a JSON summary at
results/fmd_report.json.

Usage:
    python scripts/fmd_report.py
    python scripts/fmd_report.py --json-only      # suppress markdown
    python scripts/fmd_report.py --tool claude-code  # filter
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
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


# Regex to parse the result-dir name into (tool, task, variant, suffix-suffix)
# Examples:
#   smoke-claude-code-task_01_b2b_portal-terse
#   smoke-claude-code-task_04_support-terse-NI-run3
DIR_RE = re.compile(
    r"^smoke-(?P<tool>[a-z0-9_-]+?)-"
    r"(?P<task>task_\d+_[a-z0-9_]+)-"
    r"(?P<variant>terse|verbose|casual)"
    r"(?:-(?P<suffix>.+))?$"
)


def _parse_dir_name(name: str) -> dict | None:
    m = DIR_RE.match(name)
    if not m:
        return None
    suffix = m.group("suffix") or ""
    is_ni = "NI" in suffix.upper().split("-")
    # Run number — last component that starts with "run" + digits
    run_num = None
    for part in suffix.split("-"):
        if part.lower().startswith("run") and part[3:].isdigit():
            run_num = int(part[3:])
            break
    if run_num is None and suffix == "":
        run_num = 1  # canonical first run
    return {
        "tool": m.group("tool"),
        "task": m.group("task"),
        "variant": m.group("variant"),
        "ni_applied": is_ni,
        "run_num": run_num,
        "raw_suffix": suffix,
    }


def _load_run(result_dir: Path, meta: dict) -> dict | None:
    """Load run data + classify, returning a unified record. None if unparseable."""
    scoring_path = result_dir / "scoring.json"
    failure_path = result_dir / "failure_record.json"

    if scoring_path.exists():
        data = json.loads(scoring_path.read_text(encoding="utf-8"))
        # Reconstruct a ToolOutput-like for classification if `failure_mode` missing
        # Always reclassify from disk using the current classifier code.
        # We do NOT trust the failure_mode field that was stored at run
        # time, because classifier criteria evolve (e.g., the 2026-05-21
        # criterion update that requires file_count==0 for timeout makes
        # the older stored "timeout" labels obsolete for runs with files).
        # The stored field is forensic record; this report is for
        # current analysis using the current criteria.
        files_dir = result_dir / "output_files"
        file_dict = (
            {
                p.relative_to(files_dir).as_posix(): ""
                for p in files_dir.rglob("*")
                if p.is_file()
            }
            if files_dir.exists()
            else {}
        )
        tool_output = ToolOutput(
            tool_id=data.get("tool_id", "unknown"),
            model="unknown",
            mode="prs_autonomous",
            prompt="(reconstruction)",
            output_files=file_dict,
            completion_status=data.get("completion_status", "complete"),
            refusal_reason=data.get("refusal_reason"),
            wall_clock_seconds=data.get("generation_wall_clock_seconds"),
            raw_response={"returncode": 0, "stdout_tail": "", "stderr_tail": ""},
        )
        result = classify_failure_mode(
            tool_output, configured_timeout_seconds=3600.0
        )
        label = result.label.value
        return {
            "result_dir": result_dir.name,
            "tool": meta["tool"],
            "task": meta["task"],
            "variant": meta["variant"],
            "ni_applied": meta["ni_applied"],
            "run_num": meta["run_num"],
            "files": data.get("files_produced", 0),
            "prs": data.get("composite_prs"),
            "wall_clock_seconds": data.get("generation_wall_clock_seconds"),
            "label": label,
        }

    if failure_path.exists():
        data = json.loads(failure_path.read_text(encoding="utf-8"))
        return {
            "result_dir": result_dir.name,
            "tool": meta["tool"],
            "task": meta["task"],
            "variant": meta["variant"],
            "ni_applied": meta["ni_applied"],
            "run_num": meta["run_num"],
            "files": 0,
            "prs": None,
            "wall_clock_seconds": data.get("generation_wall_clock_seconds"),
            "label": data.get("failure_mode", {}).get("label", "silent_decline"),
        }

    return None  # neither file present — skip


def _to_fmr(label: str):
    """Convert label string to a minimal FailureModeResult-like object for aggregators."""
    from harness.scoring.failure_mode import FailureModeResult

    return FailureModeResult(
        label=FailureModeLabel(label),
        reasoning="(reconstructed)",
        file_count=0,
        doc_ratio=None,
        wall_clock_seconds=None,
        returncode=None,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto-discover + classify all runs in results/")
    parser.add_argument("--json-only", action="store_true", help="Suppress markdown output")
    parser.add_argument("--tool", default=None, help="Filter by tool ID")
    args = parser.parse_args()

    results_root = REPO_ROOT / "results"
    runs: list[dict] = []
    skipped: list[str] = []

    for sub in sorted(results_root.iterdir()):
        if not sub.is_dir() or not sub.name.startswith("smoke-"):
            continue
        meta = _parse_dir_name(sub.name)
        if meta is None:
            skipped.append(sub.name)
            continue
        if args.tool and meta["tool"] != args.tool:
            continue
        record = _load_run(sub, meta)
        if record is None:
            skipped.append(sub.name)
            continue
        runs.append(record)

    if not args.json_only:
        print(f"# FMD Report — auto-discovered from {len(runs)} run(s)")
        print(f"# (Skipped {len(skipped)} dir(s) without scoring.json / failure_record.json)\n")

    # Group by condition
    by_condition: dict[tuple, list[dict]] = defaultdict(list)
    for r in runs:
        key = (r["tool"], r["task"], r["variant"], r["ni_applied"])
        by_condition[key].append(r)

    if not args.json_only:
        print("## Per-condition Failure Mode Distribution\n")
        print("| Tool | Task | Variant | NI | N | Completion | Constructive | Dominant Failure | PRS scores (when complete) |")
        print("|---|---|---|---|---|---|---|---|---|")
        for (tool, task, variant, ni) in sorted(by_condition.keys()):
            records = by_condition[(tool, task, variant, ni)]
            results = [_to_fmr(r["label"]) for r in records]
            cr = completion_rate(results)
            cor = constructive_rate(results)
            dom = dominant_failure_mode(results)
            dom_str = dom.value if dom else "—"
            complete_prs = [r["prs"] for r in records if r["label"] == "complete" and r["prs"] is not None]
            prs_str = ", ".join(f"{p:.0f}" for p in complete_prs) if complete_prs else "—"
            print(
                f"| {tool} | {task} | {variant} | {'yes' if ni else 'no'} "
                f"| {len(results)} | {cr:.0%} | {cor:.0%} | {dom_str} | {prs_str} |"
            )

    summary = {
        "generated_at": "2026-05-21",
        "n_runs": len(runs),
        "n_conditions": len(by_condition),
        "skipped_dirs": skipped,
        "per_run": runs,
        "per_condition_fmd": [
            {
                "tool": tool,
                "task": task,
                "variant": variant,
                "ni_applied": ni,
                "n": len(records),
                "completion_rate": completion_rate([_to_fmr(r["label"]) for r in records]),
                "constructive_rate": constructive_rate([_to_fmr(r["label"]) for r in records]),
                "fmd": compute_fmd([_to_fmr(r["label"]) for r in records]),
                "prs_when_complete": [r["prs"] for r in records if r["label"] == "complete" and r["prs"] is not None],
            }
            for (tool, task, variant, ni), records in sorted(by_condition.items())
        ],
    }
    out_path = REPO_ROOT / "results" / "fmd_report.json"
    out_path.write_text(json.dumps(summary, indent=2))
    if not args.json_only:
        print(f"\nFull JSON: {out_path}")


if __name__ == "__main__":
    main()
