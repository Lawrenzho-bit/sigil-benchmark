"""Invitation — a pending request for someone to join an organization."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow
from app.models.enums import InvitationStatus, Role

if TYPE_CHECKING:
    from app.models.organization import Organization

INVITE_TTL = timedelta(days=7)


def generate_invite_token() -> tuple[str, str]:
    """Return ``(raw_token, token_hash)``.

    Only the SHA-256 hash is stored. The raw token travels in the invite link
    and is never persisted — a database leak cannot be used to accept invites.
    """
    raw = secrets.token_urlsafe(32)
    return raw, hashlib.sha256(raw.encode()).hexdigest()


def hash_invite_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class Invitation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An emailed invitation to join an organization at a given role."""

    __tablename__ = "invitations"

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    role: Mapped[Role] = mapped_column(
        SAEnum(Role, native_enum=False, length=20), nullable=False, default=Role.VIEWER
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    status: Mapped[InvitationStatus] = mapped_column(
        SAEnum(InvitationStatus, native_enum=False, length=20),
        nullable=False,
        default=InvitationStatus.PENDING,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    invited_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    organization: Mapped["Organization"] = relationship(back_populates="invitations")

    @property
    def is_expired(self) -> bool:
        expires = self.expires_at
        if expires.tzinfo is None:  # SQLite may return naive datetimes
            from datetime import timezone

            expires = expires.replace(tzinfo=timezone.utc)
        return expires < utcnow()

    @property
    def is_acceptable(self) -> bool:
        return self.status == InvitationStatus.PENDING and not self.is_expired
