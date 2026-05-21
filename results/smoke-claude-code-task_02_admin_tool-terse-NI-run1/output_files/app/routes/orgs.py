import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.audit.logger import record, snapshot
from app.auth.deps import CurrentAdmin, require
from app.auth.rbac import P_ORG_EDIT, P_ORG_VIEW
from app.db import get_db
from app.models.org import Organization
from app.models.user import User

router = APIRouter()
ORG_AUDIT_FIELDS = ["name", "slug", "plan", "billing_email", "is_active"]


@router.get("", response_class=HTMLResponse)
def list_orgs(
    request: Request,
    q: str = Query(""),
    plan: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_ORG_VIEW)),
):
    stmt = select(Organization).order_by(Organization.created_at.desc())
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            func.lower(Organization.name).like(like),
            func.lower(Organization.slug).like(like),
        ))
    if plan:
        stmt = stmt.where(Organization.plan == plan)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    orgs = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return request.app.state.templates.TemplateResponse(
        "orgs/list.html",
        {"request": request, "admin": admin, "orgs": orgs,
         "q": q, "plan": plan, "page": page, "page_size": page_size, "total": total},
    )


@router.get("/{org_id}", response_class=HTMLResponse)
def org_detail(
    org_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_ORG_VIEW)),
):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    user_count = db.scalar(
        select(func.count()).select_from(User).where(User.org_id == org_id)
    ) or 0
    return request.app.state.templates.TemplateResponse(
        "orgs/detail.html",
        {"request": request, "admin": admin, "org": org, "user_count": user_count},
    )


@router.post("/{org_id}/edit")
def edit_org(
    org_id: uuid.UUID,
    name: str = Form(""),
    plan: str = Form("free"),
    billing_email: str = Form(""),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_ORG_EDIT)),
):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    before = snapshot(org, ORG_AUDIT_FIELDS)
    org.name = name.strip() or org.name
    org.plan = plan.strip() or org.plan
    org.billing_email = billing_email.strip().lower()
    db.flush()
    after = snapshot(org, ORG_AUDIT_FIELDS)
    record(db, actor=admin, action="org.edit", target_type="org",
           target_id=org.id, before=before, after=after)
    return RedirectResponse(f"/admin/orgs/{org.id}", status_code=303)
