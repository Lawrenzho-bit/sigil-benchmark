"""Public marketing/landing page."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import RedirectResponse, Response
from starlette.requests import Request

from app.dependencies import OptionalAuth
from app.enums import Plan
from app.templating import render

router = APIRouter(tags=["pages"])


@router.get("/", include_in_schema=False)
async def landing(request: Request, auth: OptionalAuth) -> Response:
    """Show the landing page, or send signed-in users straight to their app."""
    if auth is not None:
        return RedirectResponse("/app/dashboard", status_code=303)
    return render(
        request,
        "landing.html",
        {"plans": list(Plan)},
        auth=None,
    )
