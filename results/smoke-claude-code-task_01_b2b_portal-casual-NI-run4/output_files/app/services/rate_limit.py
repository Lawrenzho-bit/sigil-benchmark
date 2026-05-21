"""Login rate limiting.

Backed by the `login_attempts` table rather than in-process memory, so the
limit holds across every Gunicorn worker and survives restarts — no Redis
required. Both the targeted email and the source IP are throttled, which
covers password-guessing against one account and spraying across many.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.exceptions import RateLimitedError
from app.models import LoginAttempt


async def _failed_count(db: AsyncSession, column, value, since: datetime) -> int:
    count = await db.scalar(
        select(func.count())
        .select_from(LoginAttempt)
        .where(
            column == value,
            LoginAttempt.successful.is_(False),
            LoginAttempt.created_at >= since,
        )
    )
    return int(count or 0)


async def enforce_login_rate_limit(
    db: AsyncSession, email: str, ip_address: str | None
) -> None:
    """Raise RateLimitedError if too many recent failures exist.

    Called *before* the password is checked, so a locked account cannot be
    logged into even with correct credentials until the window elapses.
    """
    window = timedelta(minutes=settings.login_attempt_window_minutes)
    since = datetime.now(UTC) - window
    retry_after = settings.login_lockout_minutes * 60

    if await _failed_count(db, LoginAttempt.email, email, since) >= settings.login_max_attempts:
        raise RateLimitedError(
            "This account is temporarily locked after too many failed sign-in "
            "attempts. Please wait a few minutes and try again.",
            retry_after=retry_after,
        )

    if ip_address:
        # An IP gets more headroom than a single account (shared NATs exist).
        ip_limit = settings.login_max_attempts * 4
        if await _failed_count(db, LoginAttempt.ip_address, ip_address, since) >= ip_limit:
            raise RateLimitedError(
                "Too many sign-in attempts from your network. Please try again "
                "shortly.",
                retry_after=retry_after,
            )


async def record_login_attempt(
    db: AsyncSession, email: str, ip_address: str | None, *, successful: bool
) -> None:
    """Persist the outcome of a login attempt for rate-limit accounting."""
    db.add(
        LoginAttempt(
            email=email.lower().strip(),
            ip_address=ip_address,
            successful=successful,
        )
    )
    await db.flush()
