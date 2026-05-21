"""
Failure Mode classifier — reference implementation of RFC 0004.

Classifies each run into one of seven categorical labels:

  complete           — files >= min_files AND criteria met
  partial_complete   — some files, criteria not fully met
  wrong_artifact     — files produced but mostly documentation, not code
  silent_decline     — < 120s + 0 files + exit 0 + no refusal phrase
  hard_refusal       — explicit refusal phrase in stdout
  attempted_abort    — >= 300s + 0 files + exit != 0
  timeout            — wall clock at/near configured timeout

Used alongside (not inside) the composite PRS. See RFC 0004 §3.1 for the
full taxonomy specification and §3.4 for worked examples.

Wrong-artifact detection currently uses a simple heuristic — if the
ratio of documentation files (.md, .txt, .rst, .adoc) to total files
is > 0.5, or if file count <= 3 AND >80% are docs, the run is labeled
wrong_artifact. RFC 0004 specifies LLM-as-judge for high-stakes cases;
this initial implementation defers that to a future patch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from harness.tools.base import ToolOutput


class FailureModeLabel(str, Enum):
    """The seven-mode taxonomy from RFC 0004 §3.1."""

    complete = "complete"
    partial_complete = "partial_complete"
    wrong_artifact = "wrong_artifact"
    silent_decline = "silent_decline"
    hard_refusal = "hard_refusal"
    attempted_abort = "attempted_abort"
    timeout = "timeout"


# Mode classification thresholds (RFC 0004 §3.1 + §6 "Unresolved Questions" §1)
SILENT_DECLINE_MAX_SECONDS = 120.0
ATTEMPTED_ABORT_MIN_SECONDS = 300.0
WRONG_ARTIFACT_DOC_RATIO = 0.5
WRONG_ARTIFACT_SMALL_OUTPUT_MAX_FILES = 3
WRONG_ARTIFACT_SMALL_OUTPUT_DOC_RATIO = 0.8
TIMEOUT_PROXIMITY_RATIO = 0.95  # if wall_clock >= 0.95 * configured timeout

# Documentation file extensions (extend as needed; conservative on
# false positives — text files in code dirs are usually docs not code).
DOC_EXTENSIONS = {".md", ".markdown", ".txt", ".rst", ".adoc", ".org"}

# Hard-refusal phrase list — substring-matched against stdout (case-insensitive).
HARD_REFUSAL_PHRASES = (
    "i can't help with",
    "i cannot help with",
    "i cannot assist with",
    "i can't assist with",
    "i won't provide",
    "i will not provide",
    "i'm not able to",
    "i am not able to",
    "i refuse to",
    "i'm declining to",
)


@dataclass
class FailureModeResult:
    """Output of a classification."""

    label: FailureModeLabel
    reasoning: str  # one-line human-readable explanation
    file_count: int = 0
    doc_ratio: float | None = None
    wall_clock_seconds: float | None = None
    returncode: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "label": self.label.value,
            "reasoning": self.reasoning,
            "file_count": self.file_count,
            "doc_ratio": self.doc_ratio,
            "wall_clock_seconds": self.wall_clock_seconds,
            "returncode": self.returncode,
        }


def _doc_ratio(files: dict[str, str]) -> float:
    """Fraction of files whose extension is a documentation extension."""
    if not files:
        return 0.0
    n_docs = sum(
        1
        for path in files
        if any(path.lower().endswith(ext) for ext in DOC_EXTENSIONS)
    )
    return n_docs / len(files)


def _is_hard_refusal(stdout_text: str) -> bool:
    """True if any refusal phrase substring-matches case-insensitively."""
    if not stdout_text:
        return False
    lowered = stdout_text.lower()
    return any(phrase in lowered for phrase in HARD_REFUSAL_PHRASES)


def classify_failure_mode(
    tool_output: ToolOutput,
    *,
    configured_timeout_seconds: float | None = None,
    min_files_for_complete: int = 5,
) -> FailureModeResult:
    """
    Classify a single ToolOutput run into one of the seven modes.

    Detection precedence (RFC 0004 §3.1, most-specific first):
        1. hard_refusal — if refusal phrase in stdout
        2. timeout — if wall clock at/near configured timeout
        3. attempted_abort — wall clock >= 300s AND 0 files AND exit != 0
        4. complete — files >= min_files AND completion_status == "complete"
        5. wrong_artifact — files >= 1 AND doc-heavy per heuristic
        6. partial_complete — files >= 1 but not enough to be complete
        7. silent_decline — fast no-output exit (the default for failures)
    """
    raw = tool_output.raw_response or {}
    stdout_tail = raw.get("stdout_tail", "") or ""
    returncode = raw.get("returncode")
    wall_clock = tool_output.wall_clock_seconds
    file_count = len(tool_output.output_files)
    doc_ratio = _doc_ratio(tool_output.output_files) if file_count > 0 else None

    base_fields = dict(
        file_count=file_count,
        doc_ratio=doc_ratio,
        wall_clock_seconds=wall_clock,
        returncode=returncode,
    )

    # 1. hard_refusal
    if _is_hard_refusal(stdout_tail) or _is_hard_refusal(
        tool_output.refusal_reason or ""
    ):
        return FailureModeResult(
            label=FailureModeLabel.hard_refusal,
            reasoning="explicit refusal phrase detected in stdout/refusal_reason",
            **base_fields,
        )

    # 2. timeout
    if (
        configured_timeout_seconds is not None
        and wall_clock is not None
        and wall_clock >= configured_timeout_seconds * TIMEOUT_PROXIMITY_RATIO
    ):
        return FailureModeResult(
            label=FailureModeLabel.timeout,
            reasoning=f"wall_clock {wall_clock:.1f}s at/near configured timeout {configured_timeout_seconds:.1f}s",
            **base_fields,
        )

    # 3. attempted_abort
    if (
        wall_clock is not None
        and wall_clock >= ATTEMPTED_ABORT_MIN_SECONDS
        and file_count == 0
        and returncode is not None
        and returncode != 0
    ):
        return FailureModeResult(
            label=FailureModeLabel.attempted_abort,
            reasoning=(
                f"long run ({wall_clock:.1f}s) + 0 files + non-zero exit ({returncode}) — "
                "tool attempted but couldn't complete"
            ),
            **base_fields,
        )

    # 4-6. Cases where files were produced
    if file_count > 0:
        # 5. wrong_artifact (must come before complete — a 30-file doc-only output
        # would otherwise be labeled complete)
        is_small_doc_heavy = (
            file_count <= WRONG_ARTIFACT_SMALL_OUTPUT_MAX_FILES
            and doc_ratio is not None
            and doc_ratio >= WRONG_ARTIFACT_SMALL_OUTPUT_DOC_RATIO
        )
        is_large_doc_heavy = (
            doc_ratio is not None and doc_ratio >= WRONG_ARTIFACT_DOC_RATIO
        )
        if is_small_doc_heavy or is_large_doc_heavy:
            return FailureModeResult(
                label=FailureModeLabel.wrong_artifact,
                reasoning=(
                    f"{file_count} file(s) produced, doc_ratio={doc_ratio:.2f} — "
                    "output is documentation/specs rather than executable code"
                ),
                **base_fields,
            )

        # 4. complete — successful build with enough code
        if (
            file_count >= min_files_for_complete
            and tool_output.completion_status == "complete"
        ):
            return FailureModeResult(
                label=FailureModeLabel.complete,
                reasoning=(
                    f"{file_count} files produced, doc_ratio={doc_ratio:.2f}, "
                    "completion_status=complete"
                ),
                **base_fields,
            )

        # 6. partial_complete — files produced but criteria not met
        return FailureModeResult(
            label=FailureModeLabel.partial_complete,
            reasoning=(
                f"{file_count} file(s) produced but completion_status="
                f"{tool_output.completion_status!r} or below threshold "
                f"({min_files_for_complete})"
            ),
            **base_fields,
        )

    # 7. silent_decline — default for fast no-output exits
    return FailureModeResult(
        label=FailureModeLabel.silent_decline,
        reasoning=(
            f"0 files, exit={returncode}, wall_clock="
            f"{f'{wall_clock:.1f}s' if wall_clock is not None else 'n/a'} — "
            "tool exited without producing output and without explicit refusal"
        ),
        **base_fields,
    )


def compute_fmd(
    results: list[FailureModeResult],
) -> dict[str, float]:
    """
    Compute the Failure Mode Distribution across N runs of the same condition.

    Returns a 7-element probability vector keyed by mode label. The vector
    sums to 1.0 (modulo float error) and matches RFC 0004 §3.2's expected
    reporting format.
    """
    if not results:
        return {mode.value: 0.0 for mode in FailureModeLabel}

    counts = {mode.value: 0 for mode in FailureModeLabel}
    for r in results:
        counts[r.label.value] += 1

    total = len(results)
    return {mode: counts[mode] / total for mode in counts}


def completion_rate(results: list[FailureModeResult]) -> float:
    """% of runs labeled `complete` — the primary scalar summary (RFC 0004 §3.2)."""
    if not results:
        return 0.0
    n_complete = sum(1 for r in results if r.label == FailureModeLabel.complete)
    return n_complete / len(results)


def constructive_rate(results: list[FailureModeResult]) -> float:
    """
    % of runs producing any output — complete, partial_complete, or
    wrong_artifact. Catches tools that always produce something.
    """
    if not results:
        return 0.0
    constructive_modes = {
        FailureModeLabel.complete,
        FailureModeLabel.partial_complete,
        FailureModeLabel.wrong_artifact,
    }
    n_constructive = sum(1 for r in results if r.label in constructive_modes)
    return n_constructive / len(results)


def dominant_failure_mode(
    results: list[FailureModeResult],
) -> FailureModeLabel | None:
    """The most frequent NON-complete label. None if no failures."""
    failures = [r for r in results if r.label != FailureModeLabel.complete]
    if not failures:
        return None
    counts: dict[FailureModeLabel, int] = {}
    for r in failures:
        counts[r.label] = counts.get(r.label, 0) + 1
    return max(counts, key=counts.get)  # type: ignore[arg-type]
