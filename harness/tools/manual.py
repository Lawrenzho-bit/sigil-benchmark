"""
Manual tool adapter.

For tools without public APIs (Cursor, Bolt, Lovable, v0, etc.), this adapter
loads pre-collected outputs from disk. Human operators run the prompts through
the tool's UI, save outputs to a standardized directory, and the benchmark
harness picks them up.

Trade-off acknowledged in methodology: manual collection is more error-prone
and less reproducible than API-driven runs. Configuration disclosure includes
operator identity and collection date for transparency.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from harness.tools.base import ToolAdapter, ToolOutput


class ManualAdapter(ToolAdapter):
    """Tool adapter for manually-collected outputs."""

    spectrum_position = 3  # default: conversational

    def __init__(
        self,
        tool_id: str,
        outputs_dir: Path,
        operator: str,
        spectrum_position: int = 3,
        tool_version: str = "unknown",
    ):
        self.tool_id = tool_id
        self.outputs_dir = Path(outputs_dir)
        self.operator = operator
        self.spectrum_position = spectrum_position
        self.tool_version = tool_version

    async def generate(self, prompt: str, mode: str = "prs_autonomous") -> ToolOutput:
        """Load a pre-collected output for this prompt."""
        # Manual outputs are organized as:
        #   {outputs_dir}/{tool_id}/{prompt_hash}/run_{n}/
        #     ├── metadata.json
        #     ├── output_files/
        #     │   └── ... (the generated codebase)
        prompt_hash = _short_hash(prompt)
        candidates = sorted((self.outputs_dir / self.tool_id / prompt_hash).glob("run_*"))

        if not candidates:
            raise FileNotFoundError(
                f"No manual outputs found for {self.tool_id} on prompt {prompt_hash[:8]}. "
                f"Collect outputs into {self.outputs_dir / self.tool_id / prompt_hash}/"
            )

        # Use the first un-claimed run; mark it claimed via a sentinel file
        for run_dir in candidates:
            claimed = run_dir / ".claimed"
            if claimed.exists():
                continue
            claimed.write_text(datetime.now(timezone.utc).isoformat())
            return self._load_run(run_dir, prompt, mode)

        raise RuntimeError(
            f"All manual runs for {self.tool_id} / {prompt_hash[:8]} already claimed. "
            f"Collect more outputs to support N=10 runs per condition."
        )

    def configuration_disclosure(self) -> dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "tool_name": self.tool_id,
            "tool_version": self.tool_version,
            "collection_method": "manual",
            "operator": self.operator,
            "spectrum_position": self.spectrum_position,
            "limitation_note": (
                "Manual outputs are subject to operator variance; "
                "see methodology section 8 (Tool Configuration Disclosure)"
            ),
        }

    # ----- Helpers -----

    def _load_run(
        self, run_dir: Path, prompt: str, mode: str
    ) -> ToolOutput:
        meta_path = run_dir / "metadata.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}

        files_dir = run_dir / "output_files"
        output_files: dict[str, str] = {}
        if files_dir.exists():
            for path in files_dir.rglob("*"):
                if path.is_file():
                    rel = path.relative_to(files_dir).as_posix()
                    try:
                        output_files[rel] = path.read_text()
                    except UnicodeDecodeError:
                        output_files[rel] = f"<binary file: {path.name}>"

        return ToolOutput(
            tool_id=self.tool_id,
            model=meta.get("model"),
            mode=mode,
            prompt=prompt,
            output_files=output_files,
            completion_status=meta.get("completion_status", "complete"),
            refusal_reason=meta.get("refusal_reason"),
            wall_clock_seconds=meta.get("wall_clock_seconds"),
            generated_at=datetime.fromisoformat(
                meta.get("generated_at", datetime.now(timezone.utc).isoformat())
            ),
            raw_response={"manual_collection_metadata": meta},
        )


def _short_hash(text: str) -> str:
    import hashlib

    return hashlib.sha256(text.encode()).hexdigest()[:16]
