"""FastAPI application entry point: app assembly, middleware, error handling."""

from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.exceptions import AppError, AuthenticationError
from app.flash import set_flash
from app.logging_config import configure_logging, get_logger
from app.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from app.routers import (
    audit,
    auth,
    billing,
    dashboard,
    gdpr,
    health,
    legal,
    members,
    pages,
    settings_routes,
    webhooks,
)
from app.templating import render

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    configure_logging()
    logger.info("app.startup", environment=settings.environment)
    yield
    logger.info("app.shutdown")


app = FastAPI(
    title="Sigil Portal",
    version="1.0.0",
    lifespan=lifespan,
    # The interactive API docs are disabled in production — this is a portal,
    # not a public API, and the docs would only enlarge the attack surface.
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
    openapi_url="/openapi.json" if not settings.is_production else None,
)

# Middleware executes bottom-up on the way in: request id first, headers last.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestContextMiddleware)

_STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")


# --------------------------------------------------------------------------
# Error handling
# --------------------------------------------------------------------------
def _wants_html(request: Request) -> bool:
    return "text/html" in request.headers.get("accept", "")


def _safe_referer(request: Request) -> str:
    """Return the Referer only if it is same-origin; otherwise the home page.

    Prevents the post-error redirect from being steered to another site.
    """
    referer = request.headers.get("referer", "")
    if referer.startswith(settings.base_url) or referer.startswith("/"):
        return referer
    return "/"


@app.exception_handler(AppError)
async def handle_app_error(request: Request, exc: AppError) -> Response:
    """Map a handled application error to a response.

    Browsers get a redirect-with-flash (for form posts) or an error page;
    API clients get JSON. Internal details are never exposed.
    """
    logger.info("app.error", status=exc.status_code, detail=exc.message)

    if isinstance(exc, AuthenticationError) and _wants_html(request):
        response: Response = RedirectResponse("/auth/login", status_code=303)
        set_flash(response, exc.message, "error")
        return response

    if _wants_html(request):
        if request.method != "GET":
            response = RedirectResponse(_safe_referer(request), status_code=303)
            set_flash(response, exc.message, "error")
            return response
        return render(
            request,
            "errors/error.html",
            {"status_code": exc.status_code, "message": exc.message},
            status_code=exc.status_code,
        )

    return JSONResponse({"error": exc.message}, status_code=exc.status_code)


@app.exception_handler(StarletteHTTPException)
async def handle_http_exception(
    request: Request, exc: StarletteHTTPException
) -> Response:
    if _wants_html(request):
        return render(
            request,
            "errors/error.html",
            {"status_code": exc.status_code, "message": exc.detail or "Error"},
            status_code=exc.status_code,
        )
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def handle_unexpected(request: Request, exc: Exception) -> Response:
    # Log the real error server-side; show the user a generic message only.
    logger.error("app.unhandled_exception", error=str(exc), exc_info=True)
    if _wants_html(request):
        return render(
            request,
            "errors/error.html",
            {
                "status_code": 500,
                "message": "Something went wrong on our end. Please try again.",
            },
            status_code=500,
        )
    return JSONResponse({"error": "Internal server error."}, status_code=500)


# --------------------------------------------------------------------------
# Routers
# --------------------------------------------------------------------------
app.include_router(health.router)
app.include_router(pages.router)
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(members.router)
app.include_router(billing.router)
app.include_router(settings_routes.router)
app.include_router(audit.router)
app.include_router(gdpr.router)
app.include_router(legal.router)
app.include_router(webhooks.router)
