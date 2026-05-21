"""Audit log routes: a paginated viewer and a CSV export for auditors."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from starlette.requests import Request

from app.context import AuthContext
from app.dependencies import DbSession, require
from app.enums import AuditAction
from app.rbac import Permission
from app.services import audit_service
from app.templating import render

router = APIRouter(prefix="/app/audit", tags=["audit"])

_PAGE_SIZE = 50


@router.get("", include_in_schema=False)
async def audit_page(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.AUDIT_VIEW))],
    page: int = 1,
    action: str | None = None,
) -> Response:
    assert auth.organization is not None
    page = max(page, 1)
    entries, total = await audit_service.list_for_organization(
        db,
        auth.organization.id,
        limit=_PAGE_SIZE,
        offset=(page - 1) * _PAGE_SIZE,
        action_filter=action or None,
    )
    total_pages = max((total + _PAGE_SIZE - 1) // _PAGE_SIZE, 1)
    return render(
        request,
        "audit.html",
        {
            "entries": entries,
            "page": page,
            "total_pages": total_pages,
            "total": total,
            "action_filter": action or "",
            "all_actions": sorted(a.value for a in AuditAction),
        },
        auth=auth,
    )


@router.get("/export", include_in_schema=False)
async def export_audit_csv(
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.AUDIT_VIEW))],
) -> Response:
    """Download the organization's complete audit history as a CSV file."""
    assert auth.organization is not None
    csv_text = await audit_service.export_csv(db, auth.organization.id)
    filename = f"audit-log-{auth.organization.slug}.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
