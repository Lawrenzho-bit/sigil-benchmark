"""GDPR / data-protection endpoints: data export and account deletion."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse, Response

from app.cookies import clear_session_cookie
from app.database import get_db
from app.dependencies import AuthContext, redirect, require_auth, verify_csrf
from app.models.audit_log import AuditLog
from app.models.enums import Role
from app.models.invitation import Invitation
from app.models.membership import Membership
from app.models.organization import Organization
from app.security import verify_password
from app.services import auth as auth_service
from app.services.audit import Action, record
from app.templating import flash, render

logger = logging.getLogger("acme.gdpr")
router = APIRouter(prefix="/gdpr", tags=["gdpr"])


@router.get("")
def gdpr_home(request: Request, ctx: AuthContext = Depends(require_auth)) -> Response:
    return render(request, "gdpr.html", {"has_password": ctx.user.has_password})


@router.get("/export")
def export_data(
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> Response:
    """Download a complete JSON export of the caller's personal data (GDPR Art. 20)."""
    user = ctx.user
    memberships = db.scalars(select(Membership).where(Membership.user_id == user.id)).all()
    audit_rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.actor_user_id == user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(1000)
    ).all()

    payload = {
        "account": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "created_at": user.created_at.isoformat(),
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
            "marketing_consent": user.marketing_consent,
        },
        "organizations": [
            {
                "organization_id": m.organization_id,
                "organization_name": m.organization.name if m.organization else None,
                "role": m.role.value,
                "joined_at": m.created_at.isoformat(),
            }
            for m in memberships
        ],
        "activity": [
            {
                "timestamp": a.created_at.isoformat(),
                "action": a.action,
                "ip_address": a.ip_address,
                "details": a.details,
            }
            for a in audit_rows
        ],
    }

    record(
        db,
        action=Action.DATA_EXPORTED,
        request=request,
        organization_id=ctx.organization.id,
        actor_user_id=user.id,
        actor_email=user.email,
    )
    return JSONResponse(
        payload,
        headers={"Content-Disposition": "attachment; filename=acme-portal-data-export.json"},
    )


@router.post("/delete-account", dependencies=[Depends(verify_csrf)])
def delete_account(
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
    confirm: str = Form(default=""),
    password: str = Form(default=""),
) -> Response:
    """Permanently delete the caller's account (GDPR Art. 17 — right to erasure).

    Guard rails:
      * The literal word DELETE must be typed.
      * Password-backed accounts must re-enter their password.
      * If the user is the sole owner of an organization, that organization (and
        its data) is deleted with them; otherwise only their membership is.
    """
    user = ctx.user

    if confirm.strip() != "DELETE":
        flash(request, "Type DELETE to confirm account deletion.", "error")
        return redirect("/gdpr")

    if user.has_password:
        if not verify_password(password, user.password_hash or ""):
            flash(request, "Incorrect password.", "error")
            return redirect("/gdpr")

    memberships = db.scalars(select(Membership).where(Membership.user_id == user.id)).all()

    orgs_deleted: list[str] = []
    for membership in memberships:
        org_id = membership.organization_id
        if membership.role is Role.OWNER:
            other_owners = (
                db.scalar(
                    select(func.count())
                    .select_from(Membership)
                    .where(
                        Membership.organization_id == org_id,
                        Membership.role == Role.OWNER,
                        Membership.user_id != user.id,
                    )
                )
                or 0
            )
            if other_owners == 0:
                # Sole owner -> the organization is erased along with the user.
                org = db.get(Organization, org_id)
                if org is not None:
                    # Detach pending invitations explicitly (no FK cascade needed).
                    db.execute(
                        Invitation.__table__.delete().where(Invitation.organization_id == org_id)
                    )
                    db.delete(org)  # cascades memberships + subscription
                    orgs_deleted.append(org_id)

    # Audit BEFORE deletion so the record's FKs (SET NULL on user) stay valid.
    record(
        db,
        action=Action.ACCOUNT_DELETED,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        details={"organizations_deleted": orgs_deleted},
        commit=False,
    )

    auth_service.revoke_all_sessions(db, user.id)
    db.delete(user)  # cascades remaining memberships + sessions
    db.commit()

    logger.info("Account deleted: user removed, %d org(s) erased.", len(orgs_deleted))
    response = redirect("/")
    clear_session_cookie(response)
    return response
