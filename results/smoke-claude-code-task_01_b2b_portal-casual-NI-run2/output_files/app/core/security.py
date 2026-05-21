"""Password hashing, session lifecycle and the password policy.

Passwords are hashed with argon2id (memory-hard, the OWASP-recommended
algorithm). Session secrets are random 256-bit tokens; only their SHA-256
hash is stored, and lookups use constant-time comparison.
"""

from __future__ import annotations

import hmac
import re

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

# Tuned per OWASP Password Storage Cheat Sheet (2024): 19 MiB, 2 iterations.
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128  # bound the work argon2 must do (DoS guard)


def hash_password(password: str) -> str:
    """Return an argon2id hash string (includes algorithm + parameters)."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """Constant-time-ish password check. False for SSO-only accounts."""
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True if the stored hash uses outdated parameters and should be upgraded."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except (InvalidHashError, ValueError):
        return False


def validate_password_strength(password: str) -> str | None:
    """Return an error message if the password is too weak, else ``None``.

    Requires length plus a mix of character classes. Length is the dominant
    factor; the class checks block trivially weak choices like "aaaaaaaaaaaa".
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"Password must be at most {MAX_PASSWORD_LENGTH} characters."
    classes = sum(
        bool(re.search(pattern, password))
        for pattern in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]")
    )
    if classes < 3:
        return "Password must mix at least 3 of: lowercase, uppercase, digits, symbols."
    return None


def constant_time_equals(a: str, b: str) -> bool:
    """Timing-safe string comparison."""
    return hmac.compare_digest(a.encode(), b.encode())
