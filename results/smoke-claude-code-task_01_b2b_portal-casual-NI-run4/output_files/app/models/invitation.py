"""Pending invitation model."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.enums import InvitationStatus, Role
from app.models.base import Base, Timestamps, UUIDPrimaryKey, enum_column

if TYPE_CHECKING:
    import uuid

    from app.models.organization import Organization


class Invitation(Base, UUIDPrimaryKey, Timestamps):
    """An invitation for an email address to join an organization with a role.

    Only the SHA-256 hash of the invite token is stored; the raw token lives
    only in the emailed link, so a database leak cannot be used to accept
    invitations.
    """

    __tablename__ = "invitations"

    organization_id: Mapped["uuid.UUID"] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    role: Mapped[Role] = mapped_column(enum_column(Role), nullable=False)

    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    status: Mapped[InvitationStatus] = mapped_column(
        enum_column(InvitationStatus), default=InvitationStatus.PENDING, nullable=False
    )

    invited_by_id: Mapped["uuid.UUID | None"] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    organization: Mapped["Organization"] = relationship(back_populates="invitations")

    @property
    def is_expired(self) -> bool:
        expires = self.expires_at
        if expires.tzinfo is None:  # SQLite returns naive datetimes
            expires = expires.replace(tzinfo=UTC)
        return datetime.now(UTC) > expires

    @property
    def is_pending(self) -> bool:
        return self.status == InvitationStatus.PENDING and not self.is_expired
