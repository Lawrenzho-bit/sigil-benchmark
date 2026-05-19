"""
Scoring engine base class.

Each PRS dimension (security, production_ops, scalability, compliance,
cost_efficiency) has its own scoring engine that evaluates tool outputs
against the rubric defined in tasks/shared/scoring_rubric_v04.yaml.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, TYPE_CHECKING

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from harness.deployment.base import DeploymentResult
    from harness.tools.base import ToolOutput
    from harness.orchestrator import TaskDefinition


class SubComponentScore(BaseModel):
    """Score for a single sub-component (0-10)."""

    sub_component_id: str  # e.g. "sec_01_static_analysis"
    name: str
    score: float  # 0.0 to 10.0
    method: str  # "automated" | "hybrid" | "manual_review" | "llm_as_judge"
    tool_used: str | None = None  # e.g. "semgrep"
    raw_findings: dict[str, Any] = Field(default_factory=dict)
    rubric_match: str | None = None  # which rubric tier matched
    notes: str | None = None


class ScoreResult(BaseModel):
    """Aggregate result for one dimension."""

    dimension_id: str  # e.g. "security"
    dimension_name: str
    sub_component_scores: list[SubComponentScore]
    dimension_score: float  # 0-100, sum of sub-components
    scored_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    scoring_duration_seconds: float | None = None

    def average_sub_component(self) -> float:
        """Mean of sub-component scores (each 0-10)."""
        if not self.sub_component_scores:
            return 0.0
        return sum(s.score for s in self.sub_component_scores) / len(
            self.sub_component_scores
        )


class ScoringEngine(ABC):
    """Base class for all per-dimension scoring engines."""

    dimension_id: str  # e.g. "security"
    dimension_name: str

    @abstractmethod
    async def score(
        self,
        deployment: "DeploymentResult",
        task: "TaskDefinition",
        tool_output: "ToolOutput",
    ) -> ScoreResult:
        """
        Score the deployed output against this dimension's rubric.

        Args:
            deployment: Result of deploying the tool's output to a standardized env
            task: The task definition (for acceptance criteria etc.)
            tool_output: The raw tool output (for code-level analysis)

        Returns:
            ScoreResult with sub-component scores aggregated to dimension score
        """
        ...

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} dimension={self.dimension_id}>"
