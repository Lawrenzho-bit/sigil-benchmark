"""
Unit tests for harness.scoring.failure_mode (RFC 0004 reference implementation).

These tests exercise every mode in the seven-mode taxonomy plus the
classification-precedence edge cases. They are independent of any
historical smoke data — synthetic ToolOutput fixtures are used so
the tests don't drift if the historical data is rewritten.

Run:
    pytest tests/test_failure_mode.py -v
    python -m unittest tests.test_failure_mode

Both runners work; the tests are written with unittest so they have
no external dependency beyond the stdlib.
"""

from __future__ import annotations

import unittest

from harness.scoring.failure_mode import (
    FailureModeLabel,
    classify_failure_mode,
    completion_rate,
    compute_fmd,
    constructive_rate,
    dominant_failure_mode,
)
from harness.tools.base import ToolOutput


def _make_output(
    *,
    files: dict[str, str] | None = None,
    completion_status: str = "complete",
    refusal_reason: str | None = None,
    wall_clock: float | None = None,
    returncode: int | None = 0,
    stdout_tail: str = "",
) -> ToolOutput:
    """Minimal ToolOutput factory for tests."""
    return ToolOutput(
        tool_id="claude-code",
        model="test",
        mode="prs_autonomous",
        prompt="(test)",
        output_files=files or {},
        completion_status=completion_status,
        refusal_reason=refusal_reason,
        wall_clock_seconds=wall_clock,
        raw_response={
            "returncode": returncode,
            "stdout_tail": stdout_tail,
            "stderr_tail": "",
        },
    )


class CompleteModeTests(unittest.TestCase):
    """Mode: complete — files >= min_files, exit 0, status=complete."""

    def test_large_codebase_is_complete(self):
        files = {f"src/file_{i}.py": "x" for i in range(20)}
        output = _make_output(
            files=files, completion_status="complete", wall_clock=600.0
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.complete)


class PartialCompleteModeTests(unittest.TestCase):
    """Mode: partial_complete — some files but below threshold or status != complete."""

    def test_few_files_partial(self):
        output = _make_output(
            files={"a.py": "x", "b.py": "x", "c.py": "x"},
            completion_status="partial",
            wall_clock=400.0,
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.partial_complete)

    def test_below_threshold_files_partial(self):
        # 4 files < default min_files_for_complete (5), all code-extension
        files = {f"src/{i}.py": "x" for i in range(4)}
        output = _make_output(
            files=files, completion_status="complete", wall_clock=200.0
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.partial_complete)


class WrongArtifactModeTests(unittest.TestCase):
    """Mode: wrong_artifact — files produced but predominantly documentation."""

    def test_single_md_file_is_wrong_artifact(self):
        output = _make_output(
            files={"PLAN.md": "design doc"},
            completion_status="complete",
            wall_clock=150.0,
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.wrong_artifact)

    def test_two_md_files_is_wrong_artifact(self):
        output = _make_output(
            files={"README.md": "x", "ARCHITECTURE.md": "x"},
            completion_status="complete",
            wall_clock=120.0,
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.wrong_artifact)

    def test_majority_md_is_wrong_artifact(self):
        """Larger output, but >50% are docs — still wrong_artifact."""
        files = {f"doc_{i}.md": "x" for i in range(8)}
        files.update({"src/main.py": "x", "src/util.py": "x"})  # 2 code, 8 docs
        output = _make_output(
            files=files, completion_status="complete", wall_clock=200.0
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.wrong_artifact)


class SilentDeclineModeTests(unittest.TestCase):
    """Mode: silent_decline — fast no-output exit with clean returncode."""

    def test_fast_zero_files_is_silent_decline(self):
        output = _make_output(
            files={},
            completion_status="partial",
            wall_clock=45.0,
            returncode=0,
            refusal_reason="No files written to workdir",
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.silent_decline)

    def test_default_for_no_other_match(self):
        """A run with no diagnostic info defaults to silent_decline."""
        output = _make_output(files={}, wall_clock=10.0)
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.silent_decline)


class HardRefusalModeTests(unittest.TestCase):
    """Mode: hard_refusal — explicit refusal phrase wins precedence."""

    def test_refusal_phrase_in_stdout(self):
        output = _make_output(
            files={},
            wall_clock=8.0,
            stdout_tail="I cannot help with that request, sorry.",
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.hard_refusal)

    def test_refusal_phrase_case_insensitive(self):
        output = _make_output(
            files={},
            wall_clock=8.0,
            stdout_tail="I CAN'T HELP WITH MALWARE GENERATION.",
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.hard_refusal)

    def test_refusal_phrase_in_refusal_reason_field(self):
        output = _make_output(
            files={},
            wall_clock=8.0,
            refusal_reason="I won't provide instructions for this",
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.hard_refusal)


class AttemptedAbortModeTests(unittest.TestCase):
    """Mode: attempted_abort — long run, 0 files, non-zero exit."""

    def test_long_run_nonzero_exit_no_files(self):
        output = _make_output(
            files={},
            completion_status="failed",
            wall_clock=806.0,
            returncode=1,
            refusal_reason="Non-zero exit: 1",
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.attempted_abort)

    def test_just_under_threshold_is_silent_decline(self):
        """299s + 0 files + exit 1 falls BELOW the 300s attempted_abort cutoff."""
        output = _make_output(
            files={},
            wall_clock=299.0,
            returncode=1,
            refusal_reason="Non-zero exit: 1",
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        # By the precedence in §3.1, this falls into silent_decline (the default
        # for no-output runs that don't match the more specific criteria)
        self.assertEqual(result.label, FailureModeLabel.silent_decline)


class TimeoutModeTests(unittest.TestCase):
    """Mode: timeout — wall_clock at or near configured timeout limit."""

    def test_at_timeout_is_timeout(self):
        # Configured timeout 1800s; run 1750s is within 95% threshold
        output = _make_output(
            files={},
            completion_status="timeout",
            wall_clock=1750.0,
            returncode=-1,
        )
        result = classify_failure_mode(output, configured_timeout_seconds=1800.0)
        self.assertEqual(result.label, FailureModeLabel.timeout)

    def test_below_timeout_proximity_not_timeout(self):
        # Configured timeout 1800s; run at 60% — not timeout, just silent_decline
        output = _make_output(files={}, wall_clock=1000.0, returncode=0)
        result = classify_failure_mode(output, configured_timeout_seconds=1800.0)
        self.assertNotEqual(result.label, FailureModeLabel.timeout)


class PrecedenceTests(unittest.TestCase):
    """Cross-mode precedence: most-specific wins (RFC 0004 §3.1)."""

    def test_hard_refusal_beats_silent_decline(self):
        """A fast-exit refusal phrase outranks the silent_decline default."""
        output = _make_output(
            files={},
            wall_clock=10.0,
            stdout_tail="I cannot help with that.",
            returncode=0,
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.hard_refusal)

    def test_attempted_abort_beats_silent_decline(self):
        """Long-run 0-file with non-zero exit is attempted_abort, not silent."""
        output = _make_output(
            files={},
            wall_clock=500.0,
            returncode=2,
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.attempted_abort)

    def test_wrong_artifact_beats_complete(self):
        """Many doc files would otherwise be 'complete' but are wrong_artifact."""
        files = {f"doc_{i}.md": "x" for i in range(15)}  # 15 docs, 0 code
        output = _make_output(
            files=files, completion_status="complete", wall_clock=300.0
        )
        result = classify_failure_mode(output, configured_timeout_seconds=3600.0)
        self.assertEqual(result.label, FailureModeLabel.wrong_artifact)


class AggregatorTests(unittest.TestCase):
    """Test the FMD aggregator helpers (compute_fmd, rates, dominant)."""

    def _classify_many(self, outputs: list[ToolOutput]):
        return [
            classify_failure_mode(o, configured_timeout_seconds=3600.0)
            for o in outputs
        ]

    def test_compute_fmd_sums_to_one(self):
        outputs = [
            _make_output(files={"a.py": "x"}, wall_clock=600.0),  # partial_complete (1 file)
            _make_output(files={}, wall_clock=40.0),  # silent_decline
            _make_output(files={}, wall_clock=50.0),  # silent_decline
        ]
        results = self._classify_many(outputs)
        fmd = compute_fmd(results)
        total = sum(fmd.values())
        self.assertAlmostEqual(total, 1.0, places=5)

    def test_completion_rate(self):
        """A simple 1-success-out-of-3 condition reports 33% completion."""
        good_files = {f"src/{i}.py": "x" for i in range(20)}
        outputs = [
            _make_output(files=good_files, completion_status="complete", wall_clock=500.0),
            _make_output(files={}, wall_clock=30.0),
            _make_output(files={}, wall_clock=35.0),
        ]
        results = self._classify_many(outputs)
        self.assertAlmostEqual(completion_rate(results), 1 / 3, places=5)

    def test_constructive_rate_includes_partial_and_wrong(self):
        """Constructive includes complete + partial_complete + wrong_artifact."""
        good_files = {f"src/{i}.py": "x" for i in range(20)}
        outputs = [
            _make_output(files=good_files, completion_status="complete", wall_clock=500.0),  # complete
            _make_output(files={"PLAN.md": "x"}, wall_clock=200.0),  # wrong_artifact
            _make_output(files={"a.py": "x"}, completion_status="partial", wall_clock=200.0),  # partial_complete
            _make_output(files={}, wall_clock=30.0),  # silent_decline
        ]
        results = self._classify_many(outputs)
        # 3 of 4 are constructive (complete + wrong_artifact + partial_complete)
        self.assertAlmostEqual(constructive_rate(results), 0.75, places=5)

    def test_dominant_failure_mode_picks_most_frequent(self):
        good_files = {f"src/{i}.py": "x" for i in range(20)}
        outputs = [
            _make_output(files=good_files, completion_status="complete", wall_clock=500.0),
            _make_output(files={}, wall_clock=30.0),  # silent_decline
            _make_output(files={}, wall_clock=35.0),  # silent_decline
            _make_output(files={"PLAN.md": "x"}, wall_clock=200.0),  # wrong_artifact
        ]
        results = self._classify_many(outputs)
        # complete is excluded; among failures silent_decline appears twice
        self.assertEqual(dominant_failure_mode(results), FailureModeLabel.silent_decline)

    def test_dominant_returns_none_when_all_complete(self):
        good_files = {f"src/{i}.py": "x" for i in range(20)}
        outputs = [
            _make_output(files=good_files, completion_status="complete", wall_clock=500.0),
            _make_output(files=good_files, completion_status="complete", wall_clock=500.0),
        ]
        results = self._classify_many(outputs)
        self.assertIsNone(dominant_failure_mode(results))

    def test_empty_results(self):
        self.assertEqual(completion_rate([]), 0.0)
        self.assertEqual(constructive_rate([]), 0.0)
        self.assertIsNone(dominant_failure_mode([]))
        # FMD with no runs returns all-zeros vector summing to 0
        fmd = compute_fmd([])
        self.assertEqual(sum(fmd.values()), 0.0)


if __name__ == "__main__":
    unittest.main()
