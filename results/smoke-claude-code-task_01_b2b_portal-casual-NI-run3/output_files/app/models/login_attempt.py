"""Login attempt records, used for per-account lockout.

This complements the per-IP SlowAPI limiter: counting failures per *account*
defends against distributed credential stuffing that rotates source IPs.
"""

from __future__ import annotations

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin as _TS
from app.models.base import UUIDPrimaryKey


class LoginAttempt(UUIDPrimaryKey, _TS, Base):
    __tablename__ = "login_attempts"

    # Stored lower-cased; indexed for the lockout count query.
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64))
