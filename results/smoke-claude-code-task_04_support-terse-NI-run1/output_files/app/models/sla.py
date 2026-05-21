import enum
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class SLAKind(str, enum.Enum):
    FIRST_RESPONSE = "first_response"
    RESOLUTION = "resolution"
    NEXT_RESPONSE = "next_response"


class SLAPolicy(Base):
    __tablename__ = "sla_policies"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    # JSON: { "low": {first_response_min: 240, resolution_min: 4320}, ... }
    targets: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Apply business-hours calendar? If null, 24/7.
    business_hours: Mapped[dict | None] = mapped_column(JSONB)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SLATarget(Base):
    """A concrete SLA clock attached to a single ticket."""

    __tablename__ = "sla_targets"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    ticket_id: Mapped[UUID] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    kind: Mapped[SLAKind] = mapped_column(Enum(SLAKind))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    met_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    breached: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    breach_alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pause_seconds_total: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="sla_targets")
