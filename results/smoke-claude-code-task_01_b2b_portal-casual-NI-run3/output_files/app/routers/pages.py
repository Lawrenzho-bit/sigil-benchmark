"""Public marketing/landing pages, health check, and the org switcher."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse, Response

from app.database import get_db
from app.dependencies import AuthContext, get_optional_auth, redirect, require_auth, verify_csrf
from app.models.enums import PLAN_LABELS, PLAN_PRICE_USD, PLAN_SEATS, Plan
from app.models.membership import Membership
from app.templating import flash, render

router = APIRouter(tags=["pages"])


@router.get("/")
def landing(request: Request, auth=Depends(get_optional_auth)) -> Response:
    if auth is not None:
        return redirect("/dashboard")
    plans = [
        {
            "code": p.value,
            "label": PLAN_LABELS[p],
            "price": PLAN_PRICE_USD[p],
            "seats": PLAN_SEATS[p],
        }
        for p in Plan
    ]
    return render(request, "landing.html", {"plans": plans})


@router.get("/healthz", include_in_schema=False)
def healthz(db: Session = Depends(get_db)) -> JSONResponse:
    """Liveness + DB connectivity probe used by Docker/Fly/Railway."""
    try:
        db.execute(select(1))
        return JSONResponse({"status": "ok"})
    except Exception:  # noqa: BLE001
        return JSONResponse({"status": "degraded"}, status_code=503)


@router.post("/switch-org", dependencies=[Depends(verify_csrf)])
def switch_org(
    request: Request,
    organization_id: str = Form(...),
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> Response:
    """Re-point the current session at another org the user belongs to."""
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == ctx.user.id,
            Membership.organization_id == organization_id,
        )
    )
    if membership is None:
        flash(request, "You are not a member of that organization.", "error")
        return redirect("/dashboard")
    ctx.session.organization_id = organization_id
    db.commit()
    return redirect("/dashboard")
