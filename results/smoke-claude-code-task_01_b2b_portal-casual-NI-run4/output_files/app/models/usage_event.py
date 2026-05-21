"""Usage event model — raw data behind the dashboard metrics."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, UUIDPrimaryKey

if TYPE_CHECKING:
    import uuid


class UsageEvent(Base, UUIDPrimaryKey, Timestamps):
    """A countable activity within an organization (logins, API calls, etc.).

    The dashboard aggregates these into time series; keeping raw events lets
    new metrics be derived later without a schema change.
    """

    __tablename__ = "usage_events"
    __table_args__ = (
        Index("ix_usage_org_type_created", "organization_id", "event_type", "created_at"),
    )

    organization_id: Mapped["uuid.UUID"] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
