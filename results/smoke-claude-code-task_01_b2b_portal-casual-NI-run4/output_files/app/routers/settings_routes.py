"""Settings routes: organization profile, SSO configuration, and the user's
own account (profile + password)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Form
from fastapi.responses import RedirectResponse, Response
from starlette.requests import Request

from app.context import AuthContext
from app.dependencies import Auth, CsrfProtected, DbSession, client_ip, require, user_agent
from app.enums import Role
from app.exceptions import ValidationError
from app.flash import set_flash
from app.rbac import Permission
from app.services import auth_service, organization_service, saml_service
from app.templating import render

router = APIRouter(prefix="/app", tags=["settings"])


def _redirect(target: str, message: str, level: str = "success") -> Response:
    response: Response = RedirectResponse(target, status_code=303)
    set_flash(response, message, level)  # type: ignore[arg-type]
    return response


# --------------------------------------------------------------------------
# Organization settings
# --------------------------------------------------------------------------
@router.get("/settings", include_in_schema=False)
async def organization_settings(
    request: Request,
    auth: Annotated[AuthContext, Depends(require(Permission.ORG_VIEW))],
) -> Response:
    return render(
        request,
        "settings_organization.html",
        {
            "can_edit": auth.can(Permission.ORG_EDIT),
            "can_manage_sso": auth.can(Permission.ORG_SSO_MANAGE),
            "saml_available": saml_service.is_available(),
            "sso_default_roles": [Role.ADMIN, Role.VIEWER],
        },
        auth=auth,
    )


@router.post(
    "/settings/organization", include_in_schema=False, dependencies=[CsrfProtected]
)
async def update_organization(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.ORG_EDIT))],
    name: Annotated[str, Form()],
) -> Response:
    assert auth.organization is not None
    if not name.strip():
        raise ValidationError("Organization name cannot be empty.")
    await organization_service.update_settings(
        db,
        org=auth.organization,
        actor=auth.user,
        name=name,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _redirect("/app/settings", "Organization settings saved.")


@router.post(
    "/settings/sso", include_in_schema=False, dependencies=[CsrfProtected]
)
async def configure_sso(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.ORG_SSO_MANAGE))],
    idp_entity_id: Annotated[str, Form()],
    idp_sso_url: Annotated[str, Form()],
    idp_x509_cert: Annotated[str, Form()],
    default_role: Annotated[str, Form()],
) -> Response:
    assert auth.organization is not None
    if not (idp_entity_id.strip() and idp_sso_url.strip() and idp_x509_cert.strip()):
        raise ValidationError("All SSO fields are required to enable SSO.")
    try:
        role = Role(default_role.strip().lower())
    except ValueError as exc:
        raise ValidationError("Invalid default role.") from exc
    # Owner cannot be auto-granted via SSO — too privileged for JIT provisioning.
    if role == Role.OWNER:
        raise ValidationError("The SSO default role must be Admin or Viewer.")

    await organization_service.configure_sso(
        db,
        org=auth.organization,
        actor=auth.user,
        idp_entity_id=idp_entity_id,
        idp_sso_url=idp_sso_url,
        idp_x509_cert=idp_x509_cert,
        default_role=role,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _redirect("/app/settings", "Single sign-on is now enabled.")


@router.post(
    "/settings/sso/disable", include_in_schema=False, dependencies=[CsrfProtected]
)
async def disable_sso(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.ORG_SSO_MANAGE))],
) -> Response:
    assert auth.organization is not None
    await organization_service.disable_sso(
        db,
        org=auth.organization,
        actor=auth.user,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _redirect("/app/settings", "Single sign-on has been disabled.", "info")


# --------------------------------------------------------------------------
# Personal account settings
# --------------------------------------------------------------------------
@router.get("/account", include_in_schema=False)
async def account_settings(request: Request, auth: Auth) -> Response:
    return render(request, "settings_account.html", auth=auth)


@router.post(
    "/account/profile", include_in_schema=False, dependencies=[CsrfProtected]
)
async def update_profile(
    request: Request,
    db: DbSession,
    auth: Auth,
    full_name: Annotated[str, Form()],
) -> Response:
    if not full_name.strip():
        raise ValidationError("Your name cannot be empty.")
    auth.user.full_name = full_name.strip()
    await db.flush()
    return _redirect("/app/account", "Profile updated.")


@router.post(
    "/account/password", include_in_schema=False, dependencies=[CsrfProtected]
)
async def change_password(
    request: Request,
    db: DbSession,
    auth: Auth,
    current_password: Annotated[str, Form()],
    new_password: Annotated[str, Form()],
    new_password_confirm: Annotated[str, Form()],
) -> Response:
    if not auth.user.has_password:
        raise ValidationError(
            "Your account signs in via SSO and has no password to change."
        )
    if new_password != new_password_confirm:
        raise ValidationError("The new passwords do not match.")

    await auth_service.change_password(
        db,
        auth.user,
        current_password=current_password,
        new_password=new_password,
        keep_session_id=auth.session.id,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _redirect(
        "/app/account",
        "Password changed. Other devices have been signed out.",
    )
