"""Redis-backed fixed-window rate limiting."""
from fastapi import HTTPException, status

from .redis_client import get_redis


async def check_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    """Increment a windowed counter for ``key``; raise 429 once ``limit`` is exceeded."""
    redis = get_redis()
    full_key = f"ratelimit:{key}"
    count = await redis.incr(full_key)
    if count == 1:
        await redis.expire(full_key, window_seconds)
    if count > limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded ({limit} per {window_seconds}s)",
        )
