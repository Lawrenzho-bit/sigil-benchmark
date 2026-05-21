"""Security primitives: password hashing, token generation, CSRF, headers.

Centralising these here keeps every other module free of crypto details.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from itsdangerous import BadSignature, URLSafeTimedSerializer
from passlib.context import CryptContext
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings

# bcrypt with an explicit cost factor. passlib transparently handles salts and
# the modular-crypt format stored in the DB.
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

# Signed, expiring tokens for invitations and password resets.
_serializer = URLSafeTimedSerializer(settings.secret_key, salt="acme-tokens")

CSRF_FIELD = "csrf_token"
CSRF_SESSION_KEY = "_csrf"


# --- Passwords -------------------------------------------------------------
def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd_context.verify(plain, hashed)
    except ValueError:
        # Malformed hash in the DB — treat as a non-match, never raise to caller.
        return False


def password_needs_rehash(hashed: str) -> bool:
    return _pwd_context.needs_update(hashed)


# --- Opaque tokens (sessions, etc.) ---------------------------------------
def generate_token(nbytes: int = 32) -> str:
    """A cryptographically strong URL-safe token."""
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """SHA-256 of a token, for at-rest storage.

    Session/invite tokens are high-entropy random values, so a fast hash is
    appropriate (unlike passwords). We never store the raw token.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


# --- Signed payloads (invitations, password reset) -------------------------
def sign_payload(payload: dict) -> str:
    return _serializer.dumps(payload)


def unsign_payload(token: str, max_age_seconds: int) -> dict | None:
    try:
        return _serializer.loads(token, max_age=max_age_seconds)
    except BadSignature:
        return None


# --- CSRF ------------------------------------------------------------------
def get_or_create_csrf_token(request: Request) -> str:
    """Return the session's CSRF token, creating one on first use."""
    token = request.session.get(CSRF_SESSION_KEY)
    if not token:
        token = generate_token(24)
        request.session[CSRF_SESSION_KEY] = token
    return token


def validate_csrf(request: Request, submitted: str | None) -> bool:
    expected = request.session.get(CSRF_SESSION_KEY)
    if not expected or not submitted:
        return False
    return constant_time_equals(expected, submitted)


# --- Security headers ------------------------------------------------------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach defensive headers to every response.

    The CSP is intentionally strict: no inline scripts, no third-party origins
    except Stripe's hosted checkout/portal which run on their own domains.
    """

    CSP = (
        "default-src 'self'; "
        "script-src 'self' https://js.stripe.com; "
        "frame-src https://js.stripe.com https://hooks.stripe.com; "
        "style-src 'self'; "
        "img-src 'self' data:; "
        "form-action 'self'; "
        "base-uri 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'none'"
    )

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("Content-Security-Policy", self.CSP)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response
