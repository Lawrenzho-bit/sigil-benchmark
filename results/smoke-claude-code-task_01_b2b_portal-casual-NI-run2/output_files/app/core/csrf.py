"""CSRF protection using the signed double-submit-cookie pattern.

A random token is stored in a (JS-readable) cookie and echoed back in every
state-changing form as a hidden field. The token is signed with the app
secret, so an attacker who cannot read the cookie cannot mint a valid one.
SameSite=Lax on the session cookie is the first line of defence; this is the
second.
"""

from __future__ import annotations

import secrets

from fastapi import Request, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.config import settings

CSRF_COOKIE = "sp_csrf"
CSRF_FIELD = "csrf_token"
CSRF_HEADER = "x-csrf-token"
_MAX_AGE = 8 * 3600

_serializer = URLSafeTimedSerializer(settings.secret_key, salt="csrf-token")
# Methods that never mutate state and so are exempt.
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


def issue_token(response: Response) -> str:
    """Mint a signed CSRF token, attach it as a cookie and return it.

    The cookie is intentionally *not* HttpOnly so templates rendered from a
    fresh token still match the cookie the browser will submit.
    """
    raw = secrets.token_urlsafe(24)
    signed = _serializer.dumps(raw)
    response.set_cookie(
        CSRF_COOKIE,
        signed,
        max_age=_MAX_AGE,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return signed


def get_or_issue_token(request: Request, response: Response) -> str:
    """Return the request's existing valid CSRF token, or issue a new one."""
    existing = request.cookies.get(CSRF_COOKIE)
    if existing:
        try:
            _serializer.loads(existing, max_age=_MAX_AGE)
            return existing
        except BadSignature:
            pass
    return issue_token(response)


def _valid(token: str | None) -> bool:
    if not token:
        return False
    try:
        _serializer.loads(token, max_age=_MAX_AGE)
        return True
    except BadSignature:
        return False


async def verify_request(request: Request) -> bool:
    """Validate CSRF for a state-changing request.

    Both the cookie token and the submitted token (form field or header) must
    be individually valid *and* equal to each other.
    """
    if request.method in _SAFE_METHODS:
        return True
    cookie_token = request.cookies.get(CSRF_COOKIE)
    submitted = request.headers.get(CSRF_HEADER)
    if submitted is None:
        content_type = request.headers.get("content-type", "")
        if "form" in content_type:
            form = await request.form()
            submitted = form.get(CSRF_FIELD)  # type: ignore[assignment]
    if not _valid(cookie_token) or not _valid(submitted):
        return False
    return secrets.compare_digest(cookie_token or "", submitted or "")
