import structlog
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.routes import (
    announcements,
    audit,
    auth,
    bulk,
    flags,
    health,
    orgs,
    tokens,
    users,
)

structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger()

settings = get_settings()

app = FastAPI(title="Internal Admin Tool", docs_url=None, redoc_url=None)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    https_only=settings.env != "dev",
    same_site="lax",
    max_age=60 * 60 * 8,
)

templates = Jinja2Templates(directory="app/templates")
app.state.templates = templates

try:
    app.mount("/static", StaticFiles(directory="app/static"), name="static")
except RuntimeError:
    pass

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(users.router, prefix="/admin/users", tags=["users"])
app.include_router(orgs.router, prefix="/admin/orgs", tags=["orgs"])
app.include_router(audit.router, prefix="/admin/audit", tags=["audit"])
app.include_router(flags.router, prefix="/admin/flags", tags=["flags"])
app.include_router(tokens.router, prefix="/admin/tokens", tags=["tokens"])
app.include_router(announcements.router, prefix="/admin/announcements", tags=["announcements"])
app.include_router(bulk.router, prefix="/admin/bulk", tags=["bulk"])
app.include_router(health.router, prefix="/admin/health", tags=["health"])


@app.get("/", response_class=HTMLResponse)
def root(request: Request):
    if not request.session.get("admin_id"):
        return RedirectResponse("/auth/login", status_code=302)
    return RedirectResponse("/admin/dashboard", status_code=302)


@app.get("/admin/dashboard", response_class=HTMLResponse)
def dashboard(request: Request):
    if not request.session.get("admin_id"):
        return RedirectResponse("/auth/login", status_code=302)
    return templates.TemplateResponse(
        "dashboard.html",
        {"request": request, "admin": request.session.get("admin")},
    )


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
