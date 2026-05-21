"""Authentication: API tokens (ingestion) and sessions (dashboard).

Tenant identity is always resolved here, server-side, from a credential — never
from request bodies. This is the boundary that enforces multi-tenant isolation.
"""
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import HTTPException, Request, status

from .config import settings
from .db import get_pool
from .redis_client import get_redis

_PBKDF_ROUNDS = 200_000


# --------------------------------------------------------------------------
# Password hashing (PBKDF2-HMAC-SHA256, standard library only)
# --------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, rounds, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


# --------------------------------------------------------------------------
# API token auth (ingestion) — small in-process cache to avoid a DB hit per event
# --------------------------------------------------------------------------
_token_cache: dict[str, tuple[int, float]] = {}
_TOKEN_TTL = 30.0


async def require_api_tenant(request: Request) -> int:
    """Resolve the tenant id from a Bearer API token. Raises 401 if invalid."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer API token")
    token = auth[7:].strip()

    now = time.time()
    cached = _token_cache.get(token)
    if cached and cached[1] > now:
        return cached[0]

    row = await get_pool().fetchrow("SELECT id FROM tenants WHERE api_token = $1", token)
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid API token")
    _token_cache[token] = (row["id"], now + _TOKEN_TTL)
    return row["id"]


# --------------------------------------------------------------------------
# Session auth (dashboard) — opaque session id stored in Redis
# --------------------------------------------------------------------------
async def create_session(user_id: int, tenant_id: int, username: str) -> str:
    sid = secrets.token_urlsafe(32)
    payload = json.dumps(
        {"user_id": user_id, "tenant_id": tenant_id, "username": username}
    )
    await get_redis().set(f"session:{sid}", payload, ex=settings.session_ttl_seconds)
    return sid


async def destroy_session(sid: str) -> None:
    await get_redis().delete(f"session:{sid}")


async def require_session(request: Request) -> dict:
    """Resolve the authenticated dashboard session. Raises 401 if missing/expired."""
    sid = request.cookies.get("session_id")
    if not sid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = await get_redis().get(f"session:{sid}")
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    return json.loads(payload)
