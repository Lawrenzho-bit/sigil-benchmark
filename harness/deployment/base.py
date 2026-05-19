"""
Deployment target base class.

Standardizes deployment across Modal (primary), Fly (secondary), Railway
(secondary) so tool outputs can be tested under identical infrastructure.

The deployment process itself isn't scored — PRS scores the code's behavior
post-deployment, not the tool's deployment ergonomics.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from harness.tools.base import ToolOutput


class DeploymentResult(BaseModel):
    """Result of deploying a tool's output to a standardized environment."""

    run_id: str
    target: str  # "modal" | "fly" | "railway"
    success: bool
    deployed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    public_url: str | None = None
    internal_endpoint: str | None = None
    deployment_logs: str = ""
    container_image: str | None = None
    build_duration_seconds: float | None = None
    failure_reason: str | None = None
    cost_usd: float | None = None  # for Cost Efficiency dimension
    metadata: dict[str, Any] = Field(default_factory=dict)


class DeploymentTarget(ABC):
    """Base class for deployment targets."""

    target_name: str

    @abstractmethod
    async def deploy(
        self,
        tool_output: ToolOutput,
        run_id: str,
    ) -> DeploymentResult:
        """Deploy the tool output and return endpoint metadata."""
        ...

    @abstractmethod
    async def teardown(self, deployment: DeploymentResult) -> None:
        """Clean up deployed resources after scoring is complete."""
        ...
