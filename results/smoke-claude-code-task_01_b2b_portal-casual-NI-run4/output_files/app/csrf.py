"""CSRF protection.

Every state-changing browser request must present a CSRF token that matches a
server-held secret:

  * Authenticated requests use the token bound to the server-side session.
  * Anonymous flows (login, signup, password reset) use a signed double-submit
    cookie — the token lives in an HttpOnly signed cookie and is also placed in
    the form; an attacker on another origin can do neither.

Combined with SameSite=Lax session cookies this blocks cross-site form posts.
Machine-to-machine endpoints (the Stripe webhook, the SAML ACS) are exempt:
they authenticate via signature/assertion verification instead, and are simply
not given the `verify_csrf` dependency.
"""

from __future__ import annotations

from itsdangerous import BadSignature, URLSafeSerializer
from starlette.responses import Response

from app.config import settings
from app.security import generate_csrf_token

_CSRF_COOKIE = "portal_csrf"
_signer = URLSafeSerializer(settings.secret_key, salt="csrf")


def read_anonymous_csrf(cookie_value: str | None) -> str | None:
    """Recover the anonymous CSRF token from its signed cookie value."""
    if not cookie_value:
        return None
    try:
        return _signer.loads(cookie_value)
    except BadSignature:
        return None


def new_anonymous_csrf() -> str:
    return generate_csrf_token()


def set_csrf_cookie(response: Response, token: str) -> None:
    """Persist `token` in a signed, HttpOnly cookie on `response`."""
    response.set_cookie(
        _CSRF_COOKIE,
        _signer.dumps(token),
        max_age=60 * 60 * 12,
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
    )


def csrf_cookie_name() -> str:
    return _CSRF_COOKIE
