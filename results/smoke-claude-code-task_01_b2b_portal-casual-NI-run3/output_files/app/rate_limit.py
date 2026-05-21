"""Rate limiting.

Two layers protect authentication endpoints:

1. A SlowAPI limiter (per-IP, fixed window) — cheap first line of defence.
2. A per-account failure counter persisted in the DB (`login_attempts`) — stops
   credential-stuffing that rotates IPs against a single account.

The SlowAPI limiter uses in-memory storage by default; set RATELIMIT_STORAGE_URI
to a Redis URL so limits are shared across instances in production.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.config import settings


def _client_key(request: Request) -> str:
    """Prefer the left-most X-Forwarded-For entry when behind a proxy."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(
    key_func=_client_key,
    storage_uri=settings.ratelimit_storage_uri,
    default_limits=[],
)
