from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.deps import CurrentAdmin, require
from app.auth.rbac import P_AUDIT_VIEW
from app.db import get_db
from app.models.audit import AuditLog

router = APIRouter()


@router.get("", response_class=HTMLResponse)
def list_audit(
    request: Request,
    actor_email: str = Query(""),
    action: str = Query(""),
    target_type: str = Query(""),
    target_id: str = Query(""),
    since_hours: int = Query(168, ge=1, le=24 * 90),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_AUDIT_VIEW)),
):
    since = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    stmt = select(AuditLog).where(AuditLog.created_at >= since).order_by(
        AuditLog.created_at.desc()
    )
    if actor_email:
        stmt = stmt.where(func.lower(AuditLog.actor_email).like(f"%{actor_email.lower()}%"))
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return request.app.state.templates.TemplateResponse(
        "audit/list.html",
        {
            "request": request, "admin": admin, "rows": rows, "total": total,
            "actor_email": actor_email, "action": action, "target_type": target_type,
            "target_id": target_id, "since_hours": since_hours,
            "page": page, "page_size": page_size,
        },
    )
