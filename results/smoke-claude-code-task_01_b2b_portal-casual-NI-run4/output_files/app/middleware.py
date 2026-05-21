"""HTTP middleware: request identifiers and security response headers."""

from __future__ import annotations

import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings

# Content-Security-Policy. `script-src 'self'` is the part that matters for
# XSS: the app loads no third-party scripts and uses no inline <script> blocks
# or event-handler attributes, so an injected <script> simply will not run.
# `style-src` additionally allows 'unsafe-inline' for a handful of dynamically
# sized elements (e.g. the dashboard sparkline) — inline styles cannot execute
# code, so this does not weaken the XSS protection.
_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "object-src 'none'",
    ]
)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assigns each request a unique id, binds it to the logging context, and
    echoes it back in the `X-Request-ID` header for traceability."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            path=request.url.path,
            method=request.method,
        )
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds defence-in-depth security headers to every response."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)
        headers = response.headers
        headers["Content-Security-Policy"] = _CSP
        headers["X-Content-Type-Options"] = "nosniff"
        headers["X-Frame-Options"] = "DENY"
        headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        headers["Cross-Origin-Opener-Policy"] = "same-origin"
        # HSTS only over HTTPS deployments, to avoid breaking local http dev.
        if settings.session_cookie_secure:
            headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )
        return response
