"""
Tool adapter base class.

Each AI codegen tool being benchmarked needs an adapter implementing this interface.
Some tools (Cursor, Bolt, Lovable) lack public APIs — those use the ManualAdapter
which records human-collected outputs.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


class ToolOutput(BaseModel):
    """The output of a tool generation step."""

    tool_id: str
    model: str | None = None  # e.g. "claude-sonnet-4.5"
    mode: str | None = None  # e.g. "composer" for Cursor; "agent" for Devin
    prompt: str
    output_files: dict[str, str] = Field(default_factory=dict)  # {filepath: content}
    output_archive_path: Path | None = None  # tarball/zip on disk
    completion_status: str = "complete"  # complete|partial|refused|failed|timeout
    refusal_reason: str | None = None
    tokens_input: int | None = None
    tokens_output: int | None = None
    wall_clock_seconds: float | None = None
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    raw_response: dict[str, Any] | None = None  # full API response for archival


class ToolAdapter(ABC):
    """Base class for all tool adapters."""

    tool_id: str  # e.g. "claude-sonnet-4.5"
    spectrum_position: int  # 1-6 per AI-Involvement Spectrum (v0.3)

    @abstractmethod
    async def generate(self, prompt: str, mode: str = "prs_autonomous") -> ToolOutput:
        """
        Generate output for the given prompt.

        Args:
            prompt: The task prompt
            mode: "prs_autonomous" (no human in loop) or "prs_reviewed"
                  (human reviews after generation — implemented at orchestrator level)

        Returns:
            ToolOutput with generated files + metadata
        """
        ...

    @abstractmethod
    def configuration_disclosure(self) -> dict[str, Any]:
        """
        Return the tool configuration for transparency (v0.3 requirement).
        Must include: tool name, version, model, mode, system prompt (if any),
        temperature, any non-default config.
        """
        ...

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.tool_id}>"
