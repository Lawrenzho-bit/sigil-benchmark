"""Health and readiness probes used by the deployment platforms."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app import __version__
from app.dependencies import DbSession

router = APIRouter(tags=["health"])


@router.get("/healthz", include_in_schema=False)
async def liveness() -> dict[str, str]:
    """Liveness probe — the process is up. Must not touch external services."""
    return {"status": "ok", "version": __version__}


@router.get("/readyz", include_in_schema=False)
async def readiness(db: DbSession) -> JSONResponse:
    """Readiness probe — the app can serve traffic (database reachable)."""
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ready"})
