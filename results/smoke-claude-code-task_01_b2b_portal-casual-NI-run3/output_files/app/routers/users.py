"""Team management: members, roles, and invitations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.responses import Response

from app.config import settings
from app.cookies import set_session_cookie
from app.database import get_db
from app.dependencies import (
    AuthContext,
    redirect,
    require_admin,
    require_auth,
    verify_csrf,
)
from app.models.enums import Role
from app.models.invitation import Invitation
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.user import User
from app.schemas import AcceptInviteInput, InviteInput, RoleChangeInput
from app.security import hash_password
from app.services import auth as auth_service
from app.services import invitations as invite_service
from app.services import metrics
from app.services.audit import Action, record
from app.services.email import send_invite, send_welcome
from app.templating import flash, render

router = APIRouter(tags=["team"])


def _count_owners(db: Session, org_id: str) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.organization_id == org_id, Membership.role == Role.OWNER)
        )
        or 0
    )


# --- Member list -----------------------------------------------------------
@router.get("/team")
def team(
    request: Request,
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> Response:
    """Visible to every member — viewers may look but not act."""
    members = db.scalars(
        select(Membership)
        .where(Membership.organization_id == ctx.organization.id)
        .order_by(Membership.created_at)
    ).all()
    pending = db.scalars(
        select(Invitation)
        .where(
            Invitation.organization_id == ctx.organization.id,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
        .order_by(Invitation.created_at.desc())
    ).all()
    return render(
        request,
        "team.html",
        {
            "members": members,
            "pending": [i for i in pending if i.is_pending],
            "seats_available": metrics.seats_available(db, ctx.organization),
            "assignable_roles": [Role.VIEWER, Role.ADMIN],
        },
    )


# --- Invite ----------------------------------------------------------------
@router.post("/team/invite", dependencies=[Depends(verify_csrf)])
async def invite(
    request: Request,
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
    email: str = Form(...),
    role: str = Form(...),
) -> Response:
    try:
        data = InviteInput(email=email, role=role)
    except ValidationError as exc:
        flash(request, exc.errors()[0]["msg"], "error")
        return redirect("/team")

    if metrics.seats_available(db, ctx.organization) <= 0:
        flash(
            request,
            "You've used every seat on your plan. Upgrade to invite more people.",
            "error",
        )
        return redirect("/team")

    try:
        invitation, raw_token = invite_service.create_invitation(
            db,
            organization_id=ctx.organization.id,
            email=data.email,
            role=data.role,
            invited_by_id=ctx.user.id,
        )
    except invite_service.InviteError as exc:
        flash(request, str(exc), "error")
        return redirect("/team")

    record(
        db,
        action=Action.INVITE_SENT,
        request=request,
        organization_id=ctx.organization.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        target_type="invitation",
        target_id=invitation.id,
        details={"email": data.email, "role": data.role.value},
    )
    accept_url = f"{settings.base_url}/invite/accept?token={raw_token}"
    await send_invite(data.email, ctx.organization.name, ctx.user.full_name, accept_url)
    flash(request, f"Invitation sent to {data.email}.", "success")
    return redirect("/team")


@router.post("/team/invite/{invitation_id}/revoke", dependencies=[Depends(verify_csrf)])
def revoke_invite(
    request: Request,
    invitation_id: str,
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    invitation = db.get(Invitation, invitation_id)
    # Tenant check: never act on another org's invitation.
    if invitation is None or invitation.organization_id != ctx.organization.id:
        flash(request, "Invitation not found.", "error")
        return redirect("/team")
    from app.models.base import utcnow

    invitation.revoked_at = utcnow()
    db.commit()
    record(
        db,
        action=Action.INVITE_REVOKED,
        request=request,
        organization_id=ctx.organization.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        target_type="invitation",
        target_id=invitation.id,
        details={"email": invitation.email},
    )
    flash(request, "Invitation revoked.", "info")
    return redirect("/team")


# --- Role changes ----------------------------------------------------------
@router.post("/team/{membership_id}/role", dependencies=[Depends(verify_csrf)])
def change_role(
    request: Request,
    membership_id: str,
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
    role: str = Form(...),
) -> Response:
    target = db.get(Membership, membership_id)
    if target is None or target.organization_id != ctx.organization.id:
        flash(request, "Member not found.", "error")
        return redirect("/team")

    try:
        new_role = RoleChangeInput(role=role).role
    except ValidationError:
        flash(request, "Invalid role.", "error")
        return redirect("/team")

    # Only owners may grant or revoke ownership.
    if (new_role is Role.OWNER or target.role is Role.OWNER) and not ctx.is_owner:
        flash(request, "Only an owner can change ownership.", "error")
        return redirect("/team")

    # Never leave an organization without an owner.
    demoting_owner = target.role is Role.OWNER and new_role is not Role.OWNER
    if demoting_owner and _count_owners(db, ctx.organization.id) <= 1:
        flash(request, "An organization must keep at least one owner.", "error")
        return redirect("/team")

    if target.role is new_role:
        return redirect("/team")

    old_role = target.role
    target.role = new_role
    db.commit()
    record(
        db,
        action=Action.ROLE_CHANGED,
        request=request,
        organization_id=ctx.organization.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        target_type="membership",
        target_id=target.id,
        details={"from": old_role.value, "to": new_role.value, "user_id": target.user_id},
    )
    flash(request, "Role updated.", "success")
    return redirect("/team")


@router.post("/team/{membership_id}/remove", dependencies=[Depends(verify_csrf)])
def remove_member(
    request: Request,
    membership_id: str,
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    target = db.get(Membership, membership_id)
    if target is None or target.organization_id != ctx.organization.id:
        flash(request, "Member not found.", "error")
        return redirect("/team")

    if target.user_id == ctx.user.id:
        flash(request, "You can't remove yourself. Transfer ownership or leave instead.", "error")
        return redirect("/team")

    if target.role is Role.OWNER and not ctx.is_owner:
        flash(request, "Only an owner can remove another owner.", "error")
        return redirect("/team")

    if target.role is Role.OWNER and _count_owners(db, ctx.organization.id) <= 1:
        flash(request, "An organization must keep at least one owner.", "error")
        return redirect("/team")

    removed_user_id = target.user_id
    # Drop any sessions the removed member had bound to this org.
    auth_service.revoke_all_sessions(db, removed_user_id)
    db.delete(target)
    db.commit()
    record(
        db,
        action=Action.MEMBER_REMOVED,
        request=request,
        organization_id=ctx.organization.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        target_type="user",
        target_id=removed_user_id,
    )
    flash(request, "Member removed.", "info")
    return redirect("/team")


# --- Invitation acceptance (public) ----------------------------------------
@router.get("/invite/accept")
def accept_invite_form(
    request: Request, token: str = "", db: Session = Depends(get_db)
) -> Response:
    invitation = invite_service.find_pending(db, token)
    if invitation is None:
        flash(request, "That invitation link is invalid or has expired.", "error")
        return render(request, "invite_invalid.html", status_code=400)

    org = db.get(Organization, invitation.organization_id)
    existing_user = db.scalar(select(User).where(User.email == invitation.email))
    return render(
        request,
        "invite_accept.html",
        {
            "token": token,
            "invitation": invitation,
            "org_name": org.name if org else "",
            "existing_user": existing_user is not None,
        },
    )


@router.post("/invite/accept", dependencies=[Depends(verify_csrf)])
async def accept_invite(
    request: Request,
    db: Session = Depends(get_db),
    token: str = Form(...),
    full_name: str = Form(default=""),
    password: str = Form(...),
) -> Response:
    invitation = invite_service.find_pending(db, token)
    if invitation is None:
        flash(request, "That invitation link is invalid or has expired.", "error")
        return render(request, "invite_invalid.html", status_code=400)

    existing_user = db.scalar(select(User).where(User.email == invitation.email))
    is_new_user = existing_user is None

    if is_new_user:
        try:
            data = AcceptInviteInput(full_name=full_name, password=password)
        except ValidationError as exc:
            flash(request, exc.errors()[0]["msg"], "error")
            return redirect(f"/invite/accept?token={token}")
        user = User(
            email=invitation.email,
            full_name=data.full_name,
            password_hash=hash_password(data.password),
        )
        db.add(user)
        db.commit()
    else:
        # Existing account: the password proves the inviter didn't hijack it.
        from app.security import verify_password

        if not existing_user.password_hash or not verify_password(
            password, existing_user.password_hash
        ):
            flash(request, "Incorrect password for the existing account.", "error")
            return redirect(f"/invite/accept?token={token}")
        user = existing_user

    try:
        membership = invite_service.accept(db, invitation, user)
    except invite_service.InviteError as exc:
        flash(request, str(exc), "error")
        return render(request, "invite_invalid.html", status_code=400)

    record(
        db,
        action=Action.INVITE_ACCEPTED,
        request=request,
        organization_id=membership.organization_id,
        actor_user_id=user.id,
        actor_email=user.email,
        details={"role": membership.role.value},
    )
    if is_new_user:
        await send_welcome(user.email, user.full_name)

    fwd = request.headers.get("x-forwarded-for")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
    session_token = auth_service.create_session(
        db,
        user=user,
        organization_id=membership.organization_id,
        ip=ip,
        user_agent=request.headers.get("user-agent"),
    )
    flash(request, "Welcome aboard!", "success")
    response = redirect("/dashboard")
    set_session_cookie(response, session_token)
    return response
