"""Jinja2 template configuration and the shared `render` helper.

Autoescaping is on for every template, which — combined with the strict CSP in
app.middleware — is the primary XSS defence: any value interpolated into a
page is HTML-escaped unless explicitly marked safe (which the codebase never
does for user-controlled data).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings
from app.context import AuthContext
from app.csrf import csrf_cookie_name, new_anonymous_csrf, read_anonymous_csrf, set_csrf_cookie
from app.enums import Plan, Role
from app.flash import clear_flash, read_flash
from app.rbac import Permission

_TEMPLATE_DIR = Path(__file__).parent / "templates"

templates = Jinja2Templates(directory=str(_TEMPLATE_DIR))

# Autoescape is already enabled by Jinja2Templates; make values available to
# every template without re-passing them on each render call.
templates.env.globals.update(
    {
        "app_name": "Sigil Portal",
        "Permission": Permission,
        "Role": Role,
        "Plan": Plan,
        "current_year": datetime.now().year,
        "base_url": settings.base_url,
    }
)


def _humanise_action(value: str) -> str:
    """Turn an audit action code ('member.role_changed') into prose."""
    return value.split(".", 1)[-1].replace("_", " ").capitalize()


templates.env.filters["humanise_action"] = _humanise_action


def render(
    request: Request,
    template: str,
    context: dict[str, Any] | None = None,
    *,
    auth: AuthContext | None = None,
    status_code: int = 200,
) -> Response:
    """Render `template`, injecting the auth context and one-shot flash message.

    Centralising this guarantees every page has `auth` available for the nav
    and that flash messages are consumed exactly once.
    """
    flash = read_flash(request)

    # CSRF token: the session's for authenticated users, otherwise a signed
    # double-submit cookie token (minted here if the visitor has none yet).
    issue_anon_cookie: str | None = None
    if auth is not None:
        csrf_token = auth.session.csrf_token
    else:
        csrf_token = read_anonymous_csrf(request.cookies.get(csrf_cookie_name()))
        if csrf_token is None:
            csrf_token = new_anonymous_csrf()
            issue_anon_cookie = csrf_token

    ctx: dict[str, Any] = {
        "auth": auth,
        "current_user": auth.user if auth else None,
        "organization": auth.organization if auth else None,
        "role": auth.role if auth else None,
        "csrf_token": csrf_token,
        "flash": flash,
        **(context or {}),
    }
    response = templates.TemplateResponse(
        request, template, ctx, status_code=status_code
    )
    if flash:
        clear_flash(response)
    if issue_anon_cookie:
        set_csrf_cookie(response, issue_anon_cookie)
    return response
