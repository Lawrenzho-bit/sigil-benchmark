import secrets
import uuid
from datetime import datetime, timedelta, timezone
from hashlib import sha256

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.audit.logger import record, snapshot
from app.auth.deps import CurrentAdmin, require
from app.auth.rbac import (
    P_USER_DEACTIVATE,
    P_USER_EDIT,
    P_USER_IMPERSONATE,
    P_USER_VIEW,
)
from app.config import get_settings
from app.db import get_db
from app.models.impersonation import ImpersonationSession
from app.models.org import Organization
from app.models.user import User

router = APIRouter()
settings = get_settings()

USER_AUDIT_FIELDS = ["email", "name", "role_in_org", "is_active"]


@router.get("", response_class=HTMLResponse)
def list_users(
    request: Request,
    q: str = Query("", description="search email or name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    active: str = Query("any"),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_USER_VIEW)),
):
    stmt = select(User).order_by(User.created_at.desc())
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(User.email).like(like), func.lower(User.name).like(like)))
    if active in ("yes", "no"):
        stmt = stmt.where(User.is_active.is_(active == "yes"))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    users = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return request.app.state.templates.TemplateResponse(
        "users/list.html",
        {
            "request": request, "admin": admin, "users": users,
            "q": q, "page": page, "page_size": page_size, "active": active, "total": total,
        },
    )


@router.get("/{user_id}", response_class=HTMLResponse)
def user_detail(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_USER_VIEW)),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    org = db.get(Organization, user.org_id)
    return request.app.state.templates.TemplateResponse(
        "users/detail.html",
        {"request": request, "admin": admin, "user": user, "org": org},
    )


@router.post("/{user_id}/edit")
def edit_user(
    user_id: uuid.UUID,
    request: Request,
    name: str = Form(""),
    email: str = Form(""),
    role_in_org: str = Form("member"),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_USER_EDIT)),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    before = snapshot(user, USER_AUDIT_FIELDS)
    user.name = name.strip() or user.name
    user.email = email.strip().lower() or user.email
    user.role_in_org = role_in_org.strip() or user.role_in_org
    db.flush()
    after = snapshot(user, USER_AUDIT_FIELDS)
    record(db, actor=admin, action="user.edit", target_type="user",
           target_id=user.id, before=before, after=after)
    return RedirectResponse(f"/admin/users/{user.id}", status_code=303)


@router.post("/{user_id}/deactivate")
def deactivate_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_USER_DEACTIVATE)),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not user.is_active:
        return RedirectResponse(f"/admin/users/{user.id}", status_code=303)
    before = snapshot(user, USER_AUDIT_FIELDS)
    user.is_active = False
    db.flush()
    after = snapshot(user, USER_AUDIT_FIELDS)
    record(db, actor=admin, action="user.deactivate", target_type="user",
           target_id=user.id, before=before, after=after)
    return RedirectResponse(f"/admin/users/{user.id}", status_code=303)


@router.post("/{user_id}/reactivate")
def reactivate_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_USER_DEACTIVATE)),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if user.is_active:
        return RedirectResponse(f"/admin/users/{user.id}", status_code=303)
    before = snapshot(user, USER_AUDIT_FIELDS)
    user.is_active = True
    db.flush()
    after = snapshot(user, USER_AUDIT_FIELDS)
    record(db, actor=admin, action="user.reactivate", target_type="user",
           target_id=user.id, before=before, after=after)
    return RedirectResponse(f"/admin/users/{user.id}", status_code=303)


@router.post("/{user_id}/impersonate")
def impersonate(
    user_id: uuid.UUID,
    reason: str = Form(..., min_length=10, max_length=512),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_USER_IMPERSONATE)),
):
    """Issue a short-lived impersonation token. Returned to caller; recorded in audit log."""
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user missing or inactive")

    token = secrets.token_urlsafe(32)
    token_hash = sha256(token.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=settings.impersonation_ttl)
    session = ImpersonationSession(
        admin_id=admin.id,
        user_id=user.id,
        reason=reason,
        token_hash=token_hash,
        started_at=now,
        expires_at=expires,
    )
    db.add(session)
    db.flush()
    record(
        db, actor=admin, action="user.impersonate.start",
        target_type="user", target_id=user.id,
        extra={"reason": reason, "ttl_seconds": settings.impersonation_ttl,
               "session_id": str(session.id)},
        impersonating_user_id=user.id,
    )
    return {
        "session_id": str(session.id),
        "impersonation_token": token,
        "expires_at": expires.isoformat(),
        "user_id": str(user.id),
        "user_email": user.email,
    }


@router.post("/impersonation/{session_id}/end")
def end_impersonation(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_USER_IMPERSONATE)),
):
    sess = db.get(ImpersonationSession, session_id)
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if sess.ended_at is None:
        sess.ended_at = datetime.now(timezone.utc)
        db.flush()
    record(db, actor=admin, action="user.impersonate.end",
           target_type="user", target_id=sess.user_id,
           extra={"session_id": str(sess.id)},
           impersonating_user_id=sess.user_id)
    return {"ok": True}
