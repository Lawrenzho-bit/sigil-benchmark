from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.api import agents, kb, macros, portal, reports, surveys, tickets, webhooks
from app.config import get_settings

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("app.start", env=settings.app_env)
    yield
    log.info("app.stop")


app = FastAPI(title="Helpdesk", version="0.1.0", lifespan=lifespan)


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        import uuid

        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        structlog.contextvars.bind_contextvars(request_id=rid, path=request.url.path)
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.clear_contextvars()
        response.headers["x-request-id"] = rid
        return response


app.add_middleware(RequestIDMiddleware)

app.include_router(tickets.router, prefix="/api/tickets", tags=["tickets"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(macros.router, prefix="/api/macros", tags=["macros"])
app.include_router(kb.router, prefix="/api/kb", tags=["knowledge-base"])
app.include_router(reports.router, prefix="/api/reports", tags=["reports"])
app.include_router(surveys.router, prefix="/api/surveys", tags=["surveys"])
app.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
app.include_router(portal.router, tags=["portal"])

try:
    app.mount("/static", StaticFiles(directory="app/static"), name="static")
except RuntimeError:
    pass


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled_error", error=str(exc))
    return JSONResponse({"error": "internal_server_error"}, status_code=500)
