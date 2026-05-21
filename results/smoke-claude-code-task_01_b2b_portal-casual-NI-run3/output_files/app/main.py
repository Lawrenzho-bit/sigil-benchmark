"""ASGI application: middleware, exception handling, and router wiring."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import RedirectResponse, Response

from app import __version__
from app.config import settings
from app.rate_limit import limiter
from app.routers import (
    audit,
    auth,
    billing,
    dashboard,
    gdpr,
    legal,
    pages,
    sso,
    users,
    webhooks,
)
from app.routers import (
    settings as settings_router,
)
from app.security import SecurityHeadersMiddleware
from app.templating import flash, render

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("acme")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    mode = "production" if settings.is_production else "development"
    logger.info("Acme Portal %s starting in %s mode", __version__, mode)
    yield
    logger.info("Acme Portal shutting down")


app = FastAPI(
    title="Acme Portal",
    version=__version__,
    # Hide interactive API docs in production (this is a server-rendered app).
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    lifespan=lifespan,
)

# --- Middleware (outermost first) -----------------------------------------
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.secret_key,
    session_cookie="acme_state",
    https_only=settings.cookie_secure,
    same_site="lax",
    max_age=60 * 60 * 24,  # short-lived: only holds CSRF token + flashes
)

# --- Rate limiting ---------------------------------------------------------
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> Response:
    """Friendly HTML response when a per-IP limit is hit."""
    logger.warning("Rate limit hit: %s %s", request.method, request.url.path)
    flash(request, "Too many requests. Please slow down and try again shortly.", "error")
    return render(
        request,
        "error.html",
        {"code": 429, "message": "Too many requests"},
        status_code=429,
    )


# --- Exception handling ----------------------------------------------------
@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException) -> Response:
    # require_auth raises a 3xx with a Location header — turn it into a redirect.
    location = exc.headers.get("Location") if exc.headers else None
    if location and 300 <= exc.status_code < 400:
        return RedirectResponse(location, status_code=exc.status_code)

    if exc.status_code == 403:
        return render(
            request,
            "error.html",
            {"code": 403, "message": exc.detail or "You don't have access to that."},
            status_code=403,
        )
    if exc.status_code == 404:
        return render(
            request,
            "error.html",
            {"code": 404, "message": "Page not found."},
            status_code=404,
        )
    return render(
        request,
        "error.html",
        {"code": exc.status_code, "message": exc.detail or "Something went wrong."},
        status_code=exc.status_code,
    )


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> Response:
    # Never leak a stack trace to the client; log it server-side.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return render(
        request,
        "error.html",
        {"code": 500, "message": "An unexpected error occurred."},
        status_code=500,
    )


# --- Static files ----------------------------------------------------------
_static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")

# --- Routers ---------------------------------------------------------------
app.include_router(pages.router)
app.include_router(auth.router)
app.include_router(sso.router)
app.include_router(dashboard.router)
app.include_router(users.router)
app.include_router(settings_router.router)
app.include_router(billing.router)
app.include_router(webhooks.router)
app.include_router(audit.router)
app.include_router(gdpr.router)
app.include_router(legal.router)
