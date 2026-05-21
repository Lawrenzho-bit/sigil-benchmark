"""Append-only audit log.

Rows are never updated or deleted by application code. Every security-relevant
action writes one row through `app.services.audit.record`.
"""

from __future__ import annotations

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin as _TS
from app.models.base import UUIDPrimaryKey


class AuditLog(UUIDPrimaryKey, _TS, Base):
    __tablename__ = "audit_logs"

    # Org may be null for account-level events (e.g. global account deletion).
    organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )

    # Actor identity is captured both as an FK (nullable, may be deleted later)
    # and as a denormalized email string so the record survives user deletion.
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_email: Mapped[str] = mapped_column(String(255), default="", nullable=False)

    action: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(60))
    target_id: Mapped[str | None] = mapped_column(String(64))

    # Free-form structured detail (old/new values, plan codes, etc.).
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
