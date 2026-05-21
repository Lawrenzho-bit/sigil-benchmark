"""Authentication-related models: server-side sessions, login attempts, and
password-reset tokens.

Sessions are stored server-side (not as self-contained JWTs) so they can be
revoked immediately — on logout, password change, or account deletion.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, UUIDPrimaryKey

if TYPE_CHECKING:
    import uuid


def _aware(dt: datetime) -> datetime:
    """Normalise a possibly-naive datetime (SQLite) to UTC-aware."""
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


class Session(Base, UUIDPrimaryKey, Timestamps):
    """A server-side login session.

    The browser cookie carries only the session id, signed with the app secret
    (see app.security). The CSRF token is bound to the session and required on
    every state-changing request.
    """

    __tablename__ = "sessions"

    user_id: Mapped["uuid.UUID"] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The organization the user is currently acting within (users can belong
    # to several). Null until the first org context is chosen.
    active_organization_id: Mapped["uuid.UUID | None"] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="SET NULL")
    )

    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(400))

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def is_valid(self) -> bool:
        now = datetime.now(UTC)
        return self.revoked_at is None and now < _aware(self.expires_at)


class LoginAttempt(Base, UUIDPrimaryKey, Timestamps):
    """One row per login attempt. Drives DB-backed login rate limiting, which
    works correctly across multiple web workers without needing Redis."""

    __tablename__ = "login_attempts"

    # Lower-cased email the attempt targeted.
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), index=True)
    successful: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class PasswordResetToken(Base, UUIDPrimaryKey, Timestamps):
    """A single-use password-reset token. Only the hash is stored."""

    __tablename__ = "password_reset_tokens"

    user_id: Mapped["uuid.UUID"] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def is_usable(self) -> bool:
        return self.used_at is None and datetime.now(UTC) < _aware(self.expires_at)
