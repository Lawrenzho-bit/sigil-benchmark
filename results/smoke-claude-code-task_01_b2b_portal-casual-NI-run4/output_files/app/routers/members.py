"""Member management: invitations, role changes, and removals."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Form
from fastapi.responses import RedirectResponse, Response
from starlette.requests import Request

from app.context import AuthContext
from app.dependencies import CsrfProtected, DbSession, client_ip, require, user_agent
from app.enums import Role
from app.exceptions import PermissionDenied, ValidationError
from app.flash import set_flash
from app.rbac import Permission, assignable_roles
from app.services import invitation_service, organization_service
from app.templating import render

router = APIRouter(prefix="/app/members", tags=["members"])


def _parse_role(value: str) -> Role:
    try:
        return Role(value.strip().lower())
    except ValueError as exc:
        raise ValidationError("Unknown role.") from exc


def _back(message: str, level: str = "success") -> Response:
    response: Response = RedirectResponse("/app/members", status_code=303)
    set_flash(response, message, level)  # type: ignore[arg-type]
    return response


@router.get("", include_in_schema=False)
async def members_page(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.MEMBERS_VIEW))],
) -> Response:
    assert auth.organization is not None and auth.role is not None
    members = await organization_service.list_members(db, auth.organization.id)
    invitations = await invitation_service.list_pending(db, auth.organization.id)
    return render(
        request,
        "members.html",
        {
            "members": members,
            "invitations": invitations,
            "assignable_roles": assignable_roles(auth.role),
            "can_manage": auth.can(Permission.MEMBERS_MANAGE),
            "can_invite": auth.can(Permission.MEMBERS_INVITE),
        },
        auth=auth,
    )


@router.post("/invite", include_in_schema=False, dependencies=[CsrfProtected])
async def invite_member(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.MEMBERS_INVITE))],
    email: Annotated[str, Form()],
    role: Annotated[str, Form()],
) -> Response:
    assert auth.organization is not None and auth.role is not None
    new_role = _parse_role(role)
    # An inviter may only grant a role they are themselves allowed to assign.
    if new_role not in assignable_roles(auth.role):
        raise PermissionDenied(f"You cannot invite members as {new_role.label}.")

    await invitation_service.create_invitation(
        db,
        org=auth.organization,
        inviter=auth.user,
        email=email,
        role=new_role,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _back(f"Invitation sent to {email.strip().lower()}.")


@router.post(
    "/invitations/{invitation_id}/revoke",
    include_in_schema=False,
    dependencies=[CsrfProtected],
)
async def revoke_invitation(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.MEMBERS_INVITE))],
    invitation_id: uuid.UUID,
) -> Response:
    assert auth.organization is not None
    await invitation_service.revoke_invitation(
        db,
        org=auth.organization,
        actor=auth.user,
        invitation_id=invitation_id,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _back("Invitation revoked.", "info")


@router.post(
    "/{membership_id}/role", include_in_schema=False, dependencies=[CsrfProtected]
)
async def change_role(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.MEMBERS_MANAGE))],
    membership_id: uuid.UUID,
    role: Annotated[str, Form()],
) -> Response:
    assert auth.organization is not None and auth.role is not None
    target = await organization_service.get_membership(
        db, auth.organization.id, membership_id
    )
    await organization_service.change_member_role(
        db,
        org=auth.organization,
        actor=auth.user,
        actor_role=auth.role,
        target=target,
        new_role=_parse_role(role),
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _back("Member role updated.")


@router.post(
    "/{membership_id}/remove", include_in_schema=False, dependencies=[CsrfProtected]
)
async def remove_member(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.MEMBERS_MANAGE))],
    membership_id: uuid.UUID,
) -> Response:
    assert auth.organization is not None and auth.role is not None
    target = await organization_service.get_membership(
        db, auth.organization.id, membership_id
    )
    await organization_service.remove_member(
        db,
        org=auth.organization,
        actor=auth.user,
        actor_role=auth.role,
        target=target,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _back("Member removed.", "info")
