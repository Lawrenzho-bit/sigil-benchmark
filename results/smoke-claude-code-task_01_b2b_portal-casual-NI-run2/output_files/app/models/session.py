"""Server-side authentication sessions.

The browser only ever holds a signed, opaque session id in an HttpOnly cookie.
All session state lives here, so a session can be revoked instantly (logout,
"sign out everywhere", role change, account deletion) — unlike a stateless JWT.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.user import User


def new_session_secret() -> tuple[str, str]:
    """Return ``(raw_secret, secret_hash)`` for a fresh session."""
    raw = secrets.token_urlsafe(32)
    return raw, hashlib.sha256(raw.encode()).hexdigest()


def hash_session_secret(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class AuthSession(UUIDPrimaryKeyMixin, Base):
    """One logged-in browser session.

    The cookie carries ``<id>.<raw_secret>``; only the secret's hash is stored,
    so reading this table does not let an attacker forge a session.
    """

    __tablename__ = "auth_sessions"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    # Active organization for this session (a user may belong to several).
    organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String(400), nullable=False, default="")

    user: Mapped["User"] = relationship(back_populates="sessions")

    @staticmethod
    def lifetime(hours: int) -> timedelta:
        return timedelta(hours=hours)

    @property
    def is_expired(self) -> bool:
        expires = self.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return expires < utcnow()
