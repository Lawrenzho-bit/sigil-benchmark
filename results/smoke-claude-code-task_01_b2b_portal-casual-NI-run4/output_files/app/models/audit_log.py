"""Append-only audit log model.

Rows are never updated or deleted in normal operation — the table is the
evidence shown to auditors. Actor identity is captured both as a foreign key
(for joins) and as a denormalised email string (so the record is still
meaningful after the user is deleted under GDPR).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Index, String, Uuid
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, UUIDPrimaryKey

if TYPE_CHECKING:
    import uuid


class AuditLog(Base, UUIDPrimaryKey, Timestamps):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_org_created", "organization_id", "created_at"),
    )

    # Nullable: some events (e.g. failed login for an unknown email) have no org.
    organization_id: Mapped["uuid.UUID | None"] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="SET NULL")
    )
    actor_user_id: Mapped["uuid.UUID | None"] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    # Preserved verbatim so the log stays readable after account deletion.
    actor_email: Mapped[str | None] = mapped_column(String(255))

    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # The object the action was performed on, if any.
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(64))

    ip_address: Mapped[str | None] = mapped_column(String(45))  # fits IPv6
    user_agent: Mapped[str | None] = mapped_column(String(400))

    # Extra structured context. Named `meta` because `metadata` is reserved by
    # SQLAlchemy's declarative API.
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
