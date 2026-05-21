"""Shared Redis connection.

Redis backs rate limiting (and could back sessions). It is optional: when
``REDIS_URL`` is unset or unreachable the callers fall back to in-process
state, which is correct for a single worker and degrades gracefully otherwise.
"""

from __future__ import annotations

import logging

from app.config import settings

logger = logging.getLogger(__name__)

_client = None
_checked = False


def get_redis():
    """Return a connected Redis client, or ``None`` if Redis is unavailable."""
    global _client, _checked
    if _checked:
        return _client
    _checked = True
    if not settings.redis_url:
        logger.info("REDIS_URL not set — using in-process fallbacks.")
        return None
    try:
        import redis

        client = redis.Redis.from_url(
            settings.redis_url, socket_connect_timeout=2, socket_timeout=2, decode_responses=True
        )
        client.ping()
        _client = client
        logger.info("Connected to Redis.")
    except Exception as exc:  # noqa: BLE001 - degrade gracefully on any failure
        logger.warning("Redis unavailable (%s) — using in-process fallbacks.", exc)
        _client = None
    return _client
