"""Outbound email log — a record that transactional emails were dispatched."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, UUIDPrimaryKey

if TYPE_CHECKING:
    import uuid


class EmailLog(Base, UUIDPrimaryKey, Timestamps):
    """One row per transactional email send attempt.

    Useful for support ("did the invite go out?") and as supporting evidence
    in the audit trail for billing receipts.
    """

    __tablename__ = "email_logs"

    organization_id: Mapped["uuid.UUID | None"] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="SET NULL")
    )
    to_email: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    template: Mapped[str] = mapped_column(String(64), nullable=False)
    # "sent" or "failed".
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    error: Mapped[str | None] = mapped_column(String(512))
