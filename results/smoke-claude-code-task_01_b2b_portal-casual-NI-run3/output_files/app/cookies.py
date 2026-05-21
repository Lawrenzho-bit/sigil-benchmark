"""Session cookie helpers.

The session cookie carries only an opaque token. It is always HttpOnly and
SameSite=Lax; it is Secure whenever COOKIE_SECURE is enabled (required in prod).
"""

from __future__ import annotations

from starlette.responses import Response

from app.config import settings


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_lifetime_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
