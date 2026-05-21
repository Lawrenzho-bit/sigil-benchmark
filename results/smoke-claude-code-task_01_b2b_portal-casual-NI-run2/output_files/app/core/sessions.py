"""Server-side session management and the session cookie.

Cookie format: ``<session_id>.<raw_secret>`` in an HttpOnly, SameSite=Lax,
Secure (in prod) cookie. The server looks the session up by id and verifies
the secret against a stored SHA-256 hash, so the cookie cannot be forged or
replayed after the session is revoked.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import constant_time_equals
from app.models.base import utcnow
from app.models.session import AuthSession, hash_session_secret, new_session_secret

COOKIE_NAME = "sp_session"
# Refresh last_seen / sliding expiry at most once per this interval.
_TOUCH_INTERVAL = timedelta(minutes=15)


def _client_ip(request: Request) -> str:
    """Best-effort client IP. Trusts X-Forwarded-For only behind a known proxy
    (the ASGI server is run with --forwarded-allow-ips on the platform)."""
    return (request.client.host if request.client else "") or ""


def create_session(
    db: Session, *, user_id: str, organization_id: str | None, request: Request
) -> str:
    """Create a session row and return the raw cookie value to set."""
    raw_secret, secret_hash = new_session_secret()
    auth = AuthSession(
        user_id=user_id,
        organization_id=organization_id,
        secret_hash=secret_hash,
        expires_at=utcnow() + AuthSession.lifetime(settings.session_lifetime_hours),
        ip_address=_client_ip(request)[:64],
        user_agent=(request.headers.get("user-agent", ""))[:400],
    )
    db.add(auth)
    db.flush()
    return f"{auth.id}.{raw_secret}"


def load_session(db: Session, request: Request) -> AuthSession | None:
    """Resolve and validate the session referenced by the request cookie.

    Expired sessions are deleted on sight. The session's sliding expiry and
    ``last_seen_at`` are refreshed at most once per :data:`_TOUCH_INTERVAL`.
    """
    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie or "." not in cookie:
        return None
    session_id, _, raw_secret = cookie.partition(".")
    auth = db.get(AuthSession, session_id)
    if auth is None:
        return None
    if not constant_time_equals(auth.secret_hash, hash_session_secret(raw_secret)):
        return None
    if auth.is_expired:
        db.delete(auth)
        return None

    now = utcnow()
    last_seen = auth.last_seen_at
    if last_seen.tzinfo is None:
        from datetime import timezone

        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if now - last_seen > _TOUCH_INTERVAL:
        auth.last_seen_at = now
        auth.expires_at = now + AuthSession.lifetime(settings.session_lifetime_hours)
    return auth


def revoke_session(db: Session, auth: AuthSession) -> None:
    db.delete(auth)


def revoke_all_user_sessions(db: Session, user_id: str, *, except_id: str | None = None) -> int:
    """Revoke every session for a user (e.g. on password change). Returns count."""
    stmt = select(AuthSession).where(AuthSession.user_id == user_id)
    count = 0
    for auth in db.scalars(stmt):
        if except_id and auth.id == except_id:
            continue
        db.delete(auth)
        count += 1
    return count


def set_session_cookie(response: Response, value: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        value,
        max_age=settings.session_lifetime_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", samesite="lax")
