"""Legal pages and cookie consent."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from starlette.responses import Response

from app.dependencies import verify_csrf
from app.templating import render

router = APIRouter(tags=["legal"])

CONSENT_COOKIE = "cookie_consent"
CONSENT_MAX_AGE = 60 * 60 * 24 * 180  # 180 days


@router.get("/legal/privacy")
def privacy(request: Request) -> Response:
    return render(request, "legal/privacy.html")


@router.get("/legal/terms")
def terms(request: Request) -> Response:
    return render(request, "legal/terms.html")


@router.post("/cookie-consent", dependencies=[Depends(verify_csrf)])
def cookie_consent(
    request: Request,
    decision: str = Form(...),
) -> Response:
    """Record the visitor's cookie choice.

    Only strictly-necessary cookies (the session + CSRF) are ever set before
    consent; this app sets no analytics/marketing cookies, so "reject" simply
    dismisses the banner.
    """
    value = "accepted" if decision == "accept" else "rejected"
    referer = request.headers.get("referer", "/")
    target = referer if referer.startswith(str(request.base_url)) else "/"
    response = Response(status_code=303, headers={"Location": target})
    response.set_cookie(
        CONSENT_COOKIE,
        value,
        max_age=CONSENT_MAX_AGE,
        httponly=False,  # read by the banner script to stay hidden
        samesite="lax",
        path="/",
    )
    return response
