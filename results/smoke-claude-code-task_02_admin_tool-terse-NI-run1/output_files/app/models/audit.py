import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import UUIDPk


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AuditLog(UUIDPk, Base):
    __tablename__ = "audit_logs"

    actor_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admins.id"), index=True, nullable=True
    )
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)

    action: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    target_type: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    target_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)

    diff: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    extra: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    impersonating_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False, index=True
    )

    __table_args__ = (
        Index("ix_audit_actor_created", "actor_admin_id", "created_at"),
        Index("ix_audit_target", "target_type", "target_id"),
    )
