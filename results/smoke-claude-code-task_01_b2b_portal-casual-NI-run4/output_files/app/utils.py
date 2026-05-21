"""Small, dependency-free helpers shared across the app."""

from __future__ import annotations

import re
import secrets
import unicodedata
from datetime import UTC, datetime

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    """Return a lower-case, hyphenated, ASCII-only slug fragment."""
    normalised = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    slug = _SLUG_STRIP.sub("-", normalised).strip("-")
    return slug or "org"


def unique_slug(base: str) -> str:
    """A slug with a short random suffix, for collision-free org slugs."""
    return f"{slugify(base)[:120]}-{secrets.token_hex(3)}"


def now_utc() -> datetime:
    return datetime.now(UTC)


def normalize_email(email: str) -> str:
    """Canonical storage form for an email address: trimmed and lower-cased."""
    return email.strip().lower()
