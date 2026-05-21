"""Fixed-window rate limiting.

Used to throttle authentication endpoints (login, signup, password reset) so
credential-stuffing and brute-force attacks are slowed regardless of how many
requests an attacker sends.

Backed by Redis when available (correct across multiple workers); otherwise an
in-process dict is used, which still protects a single-worker deployment.
"""

from __future__ import annotations

import threading
import time

from app.core.redis_client import get_redis

# Parsed once: maps a "5/5m" style spec to (limit, window_seconds).
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def parse_rate(spec: str) -> tuple[int, int]:
    """Parse ``"<count>/<n><unit>"`` (e.g. ``"5/5m"``) -> (count, seconds)."""
    count_str, _, window = spec.partition("/")
    count = int(count_str)
    window = window.strip()
    unit = window[-1]
    magnitude = int(window[:-1] or "1")
    return count, magnitude * _UNIT_SECONDS[unit]


class _InProcessLimiter:
    """Fallback fixed-window counter guarded by a lock."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window: int) -> tuple[bool, int]:
        now = time.time()
        with self._lock:
            bucket = [t for t in self._hits.get(key, []) if t > now - window]
            allowed = len(bucket) < limit
            if allowed:
                bucket.append(now)
            self._hits[key] = bucket
            retry_after = 0 if allowed else int(window - (now - bucket[0])) + 1
            return allowed, retry_after


_fallback = _InProcessLimiter()


class RateLimitExceeded(Exception):
    """Raised when a caller exceeds its quota. Carries a Retry-After hint."""

    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__(f"Rate limit exceeded; retry in {retry_after}s")


def enforce(key: str, spec: str) -> None:
    """Count one hit for ``key``; raise :class:`RateLimitExceeded` if over quota.

    ``key`` should already be namespaced by purpose and client identity,
    e.g. ``"login:198.51.100.7"``.
    """
    limit, window = parse_rate(spec)
    redis = get_redis()
    if redis is None:
        allowed, retry_after = _fallback.hit(key, limit, window)
        if not allowed:
            raise RateLimitExceeded(retry_after)
        return

    # Redis fixed window: INCR then set TTL on the first hit of the window.
    redis_key = f"rl:{key}"
    try:
        count = redis.incr(redis_key)
        if count == 1:
            redis.expire(redis_key, window)
        if count > limit:
            ttl = redis.ttl(redis_key)
            raise RateLimitExceeded(max(ttl, 1))
    except RateLimitExceeded:
        raise
    except Exception:  # noqa: BLE001 - never let a Redis hiccup block traffic
        allowed, retry_after = _fallback.hit(key, limit, window)
        if not allowed:
            raise RateLimitExceeded(retry_after) from None
