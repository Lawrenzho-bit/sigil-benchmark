"""Jinja2 templating setup and the shared `render` helper.

Autoescaping is on for every template, which is the project's primary XSS
control: any value interpolated into HTML is escaped unless explicitly marked
safe (which the codebase never does for user input).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from starlette.responses import HTMLResponse

from app.config import settings
from app.models.enums import PLAN_LABELS, PLAN_PRICE_USD, PLAN_SEATS
from app.security import get_or_create_csrf_token

_TEMPLATE_DIR = Path(__file__).parent / "templates"

templates = Jinja2Templates(directory=str(_TEMPLATE_DIR))
templates.env.autoescape = True

# Plan reference data is read-only and handy in many templates.
templates.env.globals["PLAN_LABELS"] = {p.value: label for p, label in PLAN_LABELS.items()}
templates.env.globals["PLAN_SEATS"] = {p.value: n for p, n in PLAN_SEATS.items()}
templates.env.globals["PLAN_PRICE_USD"] = {p.value: n for p, n in PLAN_PRICE_USD.items()}


# --- Flash messages --------------------------------------------------------
def flash(request: Request, message: str, category: str = "info") -> None:
    """Queue a one-shot message to show on the next rendered page."""
    request.session.setdefault("_flash", []).append({"message": message, "category": category})


def _pop_flashes(request: Request) -> list[dict]:
    return request.session.pop("_flash", [])


def render(
    request: Request,
    template_name: str,
    context: dict[str, Any] | None = None,
    *,
    status_code: int = 200,
) -> HTMLResponse:
    """Render a template with common context (auth, CSRF token, flashes) merged in."""
    ctx: dict[str, Any] = {
        "request": request,
        "csrf_token": get_or_create_csrf_token(request),
        "flashes": _pop_flashes(request),
        "settings": settings,
        # `auth` is attached to request.state by the auth dependency when present.
        "auth": getattr(request.state, "auth", None),
    }
    if context:
        ctx.update(context)
    return templates.TemplateResponse(request, template_name, ctx, status_code=status_code)
