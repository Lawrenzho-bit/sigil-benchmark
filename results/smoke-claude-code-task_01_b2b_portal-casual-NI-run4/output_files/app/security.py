"""Low-level security primitives.

Centralises password hashing, opaque-token generation/hashing, cookie signing,
and CSRF token comparison so the rest of the codebase never touches a crypto
primitive directly.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pwdlib import PasswordHash

from app.config import settings

# Argon2id with sensible parameters — the current OWASP-recommended default.
_password_hasher = PasswordHash.recommended()

# Signs the session-id cookie. A tampered or forged cookie fails verification.
_cookie_signer = URLSafeTimedSerializer(settings.secret_key, salt="session-cookie")


# --------------------------------------------------------------------------
# Passwords
# --------------------------------------------------------------------------
def hash_password(password: str) -> str:
    """Return an Argon2id hash of `password`."""
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> tuple[bool, str | None]:
    """Verify `password` against a stored hash.

    Returns ``(is_valid, new_hash)``. ``new_hash`` is non-None when the stored
    hash used outdated parameters and the caller should persist the upgrade.
    Returns ``(False, None)`` for users with no local password, so callers can
    treat "wrong password" and "SSO-only account" uniformly.
    """
    if not password_hash:
        return False, None
    try:
        return _password_hasher.verify_and_update(password, password_hash)
    except Exception:
        return False, None


# --------------------------------------------------------------------------
# Opaque tokens (invitations, password resets, email verification)
# --------------------------------------------------------------------------
def generate_token() -> str:
    """Return a cryptographically random, URL-safe token."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Return a stable SHA-256 hex digest of `token`.

    Tokens are random and high-entropy, so a fast hash is appropriate here
    (unlike passwords) and lets us look them up by an indexed column.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Session cookie signing
# --------------------------------------------------------------------------
def sign_session_id(session_id: str) -> str:
    """Wrap a session id in a signed, tamper-evident cookie value."""
    return _cookie_signer.dumps(session_id)


def unsign_session_id(signed_value: str, max_age_seconds: int) -> str | None:
    """Recover a session id from a signed cookie, or None if invalid/expired."""
    try:
        return _cookie_signer.loads(signed_value, max_age=max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None


# --------------------------------------------------------------------------
# CSRF
# --------------------------------------------------------------------------
def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_tokens_match(expected: str, provided: str | None) -> bool:
    """Constant-time comparison of a submitted CSRF token against the session's."""
    if not provided:
        return False
    return hmac.compare_digest(expected, provided)
