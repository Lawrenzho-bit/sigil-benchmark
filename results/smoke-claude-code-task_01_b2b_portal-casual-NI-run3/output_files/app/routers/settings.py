"""Settings: user profile/security and organization configuration."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import Response

from app.database import get_db
from app.dependencies import (
    AuthContext,
    redirect,
    require_admin,
    require_auth,
    require_owner,
    verify_csrf,
)
from app.models.session import AuthSession
from app.schemas import OrgSettingsInput, PasswordChangeInput, ProfileInput, SamlSettingsInput
from app.security import hash_password, verify_password
from app.services import auth as auth_service
from app.services.audit import Action, record
from app.templating import flash, render

router = APIRouter(prefix="/settings", tags=["settings"])


# --- User settings ---------------------------------------------------------
@router.get("")
def user_settings(
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> Response:
    sessions = db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == ctx.user.id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.created_at.desc())
    ).all()
    active = [s for s in sessions if s.is_active]
    return render(
        request,
        "settings/user.html",
        {"sessions": active, "current_session_id": ctx.session.id},
    )


@router.post("/profile", dependencies=[Depends(verify_csrf)])
def update_profile(
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
    full_name: str = Form(...),
    marketing_consent: bool = Form(default=False),
) -> Response:
    try:
        data = ProfileInput(full_name=full_name, marketing_consent=marketing_consent)
    except ValidationError as exc:
        flash(request, exc.errors()[0]["msg"], "error")
        return redirect("/settings")

    ctx.user.full_name = data.full_name
    ctx.user.marketing_consent = data.marketing_consent
    db.commit()
    flash(request, "Profile updated.", "success")
    return redirect("/settings")


@router.post("/password", dependencies=[Depends(verify_csrf)])
def change_password(
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
    current_password: str = Form(...),
    new_password: str = Form(...),
) -> Response:
    try:
        data = PasswordChangeInput(current_password=current_password, new_password=new_password)
    except ValidationError as exc:
        flash(request, exc.errors()[0]["msg"], "error")
        return redirect("/settings")

    if not ctx.user.password_hash or not verify_password(
        data.current_password, ctx.user.password_hash
    ):
        flash(request, "Your current password is incorrect.", "error")
        return redirect("/settings")

    ctx.user.password_hash = hash_password(data.new_password)
    db.commit()
    # Keep this session, revoke all others — a password change should boot any
    # attacker holding a stolen session.
    auth_service.revoke_all_sessions(db, ctx.user.id, except_id=ctx.session.id)
    record(
        db,
        action=Action.PASSWORD_CHANGED,
        request=request,
        organization_id=ctx.organization.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        details={"via": "settings"},
    )
    flash(request, "Password changed. Other sessions were signed out.", "success")
    return redirect("/settings")


@router.post("/sessions/revoke-others", dependencies=[Depends(verify_csrf)])
def revoke_other_sessions(
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> Response:
    count = auth_service.revoke_all_sessions(db, ctx.user.id, except_id=ctx.session.id)
    record(
        db,
        action=Action.SESSIONS_REVOKED,
        request=request,
        organization_id=ctx.organization.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        details={"count": count},
    )
    flash(request, f"Signed out {count} other session(s).", "info")
    return redirect("/settings")


# --- Organization settings -------------------------------------------------
@router.get("/organization")
def org_settings(
    request: Request,
    ctx: AuthContext = Depends(require_admin),
) -> Response:
    return render(request, "settings/organization.html")


@router.post("/organization", dependencies=[Depends(verify_csrf)])
def update_org(
    request: Request,
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
    name: str = Form(...),
) -> Response:
    try:
        data = OrgSettingsInput(name=name)
    except ValidationError as exc:
        flash(request, exc.errors()[0]["msg"], "error")
        return redirect("/settings/organization")

    old_name = ctx.organization.name
    ctx.organization.name = data.name
    db.commit()
    record(
        db,
        action=Action.ORG_UPDATED,
        request=request,
        organization_id=ctx.organization.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        details={"name": {"from": old_name, "to": data.name}},
    )
    flash(request, "Organization updated.", "success")
    return redirect("/settings/organization")


@router.post("/organization/saml", dependencies=[Depends(verify_csrf)])
def update_saml(
    request: Request,
    ctx: AuthContext = Depends(require_owner),  # SSO config is owner-only
    db: Session = Depends(get_db),
    saml_enabled: bool = Form(default=False),
    saml_idp_entity_id: str = Form(default=""),
    saml_idp_sso_url: str = Form(default=""),
    saml_idp_x509_cert: str = Form(default=""),
    saml_email_domain: str = Form(default=""),
) -> Response:
    try:
        data = SamlSettingsInput(
            saml_enabled=saml_enabled,
            saml_idp_entity_id=saml_idp_entity_id or None,
            saml_idp_sso_url=saml_idp_sso_url or None,
            saml_idp_x509_cert=saml_idp_x509_cert or None,
            saml_email_domain=saml_email_domain or None,
        )
    except ValidationError as exc:
        flash(request, exc.errors()[0]["msg"], "error")
        return redirect("/settings/organization")

    if data.saml_enabled and not (
        data.saml_idp_entity_id and data.saml_idp_sso_url and data.saml_idp_x509_cert
    ):
        flash(
            request,
            "Provide the IdP entity ID, SSO URL, and certificate to enable SSO.",
            "error",
        )
        return redirect("/settings/organization")

    org = ctx.organization
    org.saml_enabled = data.saml_enabled
    org.saml_idp_entity_id = data.saml_idp_entity_id
    org.saml_idp_sso_url = data.saml_idp_sso_url
    org.saml_idp_x509_cert = data.saml_idp_x509_cert
    org.saml_email_domain = data.saml_email_domain
    db.commit()
    record(
        db,
        action=Action.SAML_UPDATED,
        request=request,
        organization_id=org.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        details={"enabled": data.saml_enabled},
    )
    flash(request, "Single sign-on settings saved.", "success")
    return redirect("/settings/organization")
