from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AuditEvent(Base):
    """Append-only audit log. Never updated. SOC2 baseline."""

    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_actor_created", "actor_id", "created_at"),
        Index("ix_audit_target_created", "target_type", "target_id", "created_at"),
        Index("ix_audit_created_at", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    actor_type: Mapped[str] = mapped_column(String(40))    # user|customer|system|api
    actor_id: Mapped[str | None] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(120))       # ticket.assign, message.send, etc.
    target_type: Mapped[str] = mapped_column(String(60))
    target_id: Mapped[str | None] = mapped_column(String(64))
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
