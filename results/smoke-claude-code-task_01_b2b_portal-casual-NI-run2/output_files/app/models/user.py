"""User account model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.membership import Membership
    from app.models.session import AuthSession


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A person. A user may belong to several organizations via memberships.

    ``password_hash`` is null for SSO-only accounts. Email is stored
    lower-cased and is globally unique.
    """

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")

    # argon2id hash; null means this account authenticates via SSO only.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Marketing-cookie consent captured for GDPR; null = not yet decided.
    marketing_consent: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def has_password(self) -> bool:
        return self.password_hash is not None

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.email!r}>"
