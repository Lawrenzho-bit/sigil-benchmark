"""Dashboard: organization metrics overview."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from starlette.responses import Response

from app.database import get_db
from app.dependencies import AuthContext, require_auth
from app.services import metrics
from app.templating import render

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
def dashboard(
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> Response:
    data = metrics.collect(db, ctx.organization)
    return render(request, "dashboard.html", {"metrics": data})
