"""Legal / compliance pages: privacy policy, terms, and cookie policy."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response
from starlette.requests import Request

from app.dependencies import OptionalAuth
from app.templating import render

router = APIRouter(tags=["legal"])


@router.get("/privacy", include_in_schema=False)
async def privacy(request: Request, auth: OptionalAuth) -> Response:
    return render(request, "legal/privacy.html", auth=auth)


@router.get("/terms", include_in_schema=False)
async def terms(request: Request, auth: OptionalAuth) -> Response:
    return render(request, "legal/terms.html", auth=auth)


@router.get("/cookies", include_in_schema=False)
async def cookies(request: Request, auth: OptionalAuth) -> Response:
    return render(request, "legal/cookies.html", auth=auth)
