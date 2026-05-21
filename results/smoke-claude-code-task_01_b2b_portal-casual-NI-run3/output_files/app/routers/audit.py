"""Audit log viewer and CSV export (for compliance / auditors)."""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.responses import Response, StreamingResponse

from app.database import get_db
from app.dependencies import AuthContext, require_admin
from app.models.audit_log import AuditLog
from app.templating import render

router = APIRouter(prefix="/audit", tags=["audit"])

PAGE_SIZE = 50


@router.get("")
def audit_log(
    request: Request,
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
    page: int = 1,
    action: str = "",
) -> Response:
    """Paginated audit view. Tenant-scoped to the caller's organization."""
    page = max(1, page)
    base = select(AuditLog).where(AuditLog.organization_id == ctx.organization.id)
    if action:
        base = base.where(AuditLog.action == action)

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    rows = db.scalars(
        base.order_by(AuditLog.created_at.desc()).offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
    ).all()

    # Distinct actions present, for the filter dropdown.
    actions = db.scalars(
        select(AuditLog.action)
        .where(AuditLog.organization_id == ctx.organization.id)
        .distinct()
        .order_by(AuditLog.action)
    ).all()

    return render(
        request,
        "audit.html",
        {
            "entries": rows,
            "page": page,
            "has_next": page * PAGE_SIZE < total,
            "total": total,
            "actions": actions,
            "selected_action": action,
        },
    )


@router.get("/export.csv")
def export_csv(
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Stream the full audit trail as CSV for offline review by auditors."""
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.organization_id == ctx.organization.id)
        .order_by(AuditLog.created_at.desc())
    ).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["timestamp_utc", "action", "actor_email", "target_type", "target_id", "ip", "details"]
    )
    for r in rows:
        writer.writerow(
            [
                r.created_at.isoformat(),
                r.action,
                r.actor_email,
                r.target_type or "",
                r.target_id or "",
                r.ip_address or "",
                r.details,
            ]
        )
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit-log.csv"},
    )
