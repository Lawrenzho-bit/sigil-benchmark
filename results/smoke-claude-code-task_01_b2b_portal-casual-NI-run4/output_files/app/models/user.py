"""User account model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Timestamps, UUIDPrimaryKey

if TYPE_CHECKING:
    from app.models.membership import Membership


class User(Base, UUIDPrimaryKey, Timestamps):
    """A person. A user may belong to multiple organizations via memberships.

    Emails are always stored lower-cased (see app.services.auth_service) so the
    unique index is effectively case-insensitive on every database.
    """

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)

    # Null for SSO-only accounts that have never set a local password.
    password_hash: Mapped[str | None] = mapped_column(String(255))

    is_email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Hash of the pending email-verification token (never the raw token).
    email_verification_hash: Mapped[str | None] = mapped_column(String(255))

    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # GDPR marketing consent — explicit opt-in, with a timestamp for proof.
    marketing_consent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    marketing_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Set when the account is erased under GDPR. PII columns are scrubbed at the
    # same time; the row is retained so audit-log foreign keys stay valid.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    @property
    def has_password(self) -> bool:
        return self.password_hash is not None
