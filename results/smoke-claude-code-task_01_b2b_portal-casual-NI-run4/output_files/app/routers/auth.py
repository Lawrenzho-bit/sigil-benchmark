"""Authentication routes: email/password, password reset, invitations, SSO."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.responses import RedirectResponse, Response
from starlette.requests import Request

from app.config import settings
from app.dependencies import (
    CsrfProtected,
    DbSession,
    OptionalAuth,
    client_ip,
    user_agent,
)
from app.enums import AuditAction
from app.exceptions import AuthenticationError, NotFoundError, RateLimitedError, ValidationError
from app.flash import set_flash
from app.models import Session
from app.security import sign_session_id
from app.services import (
    audit_service,
    auth_service,
    invitation_service,
    metrics_service,
    organization_service,
    saml_service,
)
from app.services.rate_limit import enforce_login_rate_limit, record_login_attempt
from app.templating import render

router = APIRouter(prefix="/auth", tags=["auth"])


# --------------------------------------------------------------------------
# Session cookie helpers
# --------------------------------------------------------------------------
def _set_session_cookie(response: Response, session: Session) -> None:
    """Attach the signed session-id cookie. HttpOnly + SameSite=Lax + (in
    production) Secure — so it is invisible to JS and not sent cross-site."""
    response.set_cookie(
        settings.session_cookie_name,
        sign_session_id(str(session.id)),
        max_age=settings.session_lifetime_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/")


# --------------------------------------------------------------------------
# Sign up
# --------------------------------------------------------------------------
@router.get("/signup", include_in_schema=False)
async def signup_form(request: Request, auth: OptionalAuth) -> Response:
    if auth is not None:
        return RedirectResponse("/app/dashboard", status_code=303)
    return render(request, "auth/signup.html", auth=None)


@router.post("/signup", include_in_schema=False, dependencies=[CsrfProtected])
async def signup_submit(
    request: Request,
    db: DbSession,
    full_name: Annotated[str, Form()],
    email: Annotated[str, Form()],
    password: Annotated[str, Form()],
    organization_name: Annotated[str, Form()],
    marketing_consent: Annotated[bool, Form()] = False,
) -> Response:
    ip, ua = client_ip(request), user_agent(request)
    user, org = await auth_service.register_user(
        db,
        full_name=full_name,
        email=email,
        password=password,
        organization_name=organization_name,
        marketing_consent=marketing_consent,
        ip_address=ip,
        user_agent=ua,
    )
    # Log the founder straight in.
    session = await auth_service.start_session(
        db, user, ip_address=ip, user_agent=ua, active_organization_id=org.id
    )
    await metrics_service.record_usage(db, org.id, "login")
    response: Response = RedirectResponse("/app/dashboard", status_code=303)
    _set_session_cookie(response, session)
    set_flash(
        response,
        "Welcome to Sigil Portal! Check your inbox to verify your email.",
        "success",
    )
    return response


# --------------------------------------------------------------------------
# Log in
# --------------------------------------------------------------------------
@router.get("/login", include_in_schema=False)
async def login_form(request: Request, auth: OptionalAuth) -> Response:
    if auth is not None:
        return RedirectResponse("/app/dashboard", status_code=303)
    return render(request, "auth/login.html", auth=None)


@router.post("/login", include_in_schema=False, dependencies=[CsrfProtected])
async def login_submit(
    request: Request,
    db: DbSession,
    email: Annotated[str, Form()],
    password: Annotated[str, Form()],
) -> Response:
    """Authenticate with email + password.

    Failures are handled in-line (not via the global error handler) so the
    failed-attempt and audit rows are committed — the global handler would
    roll the request back and the rate limiter would never see the failure.
    """
    ip, ua = client_ip(request), user_agent(request)
    normalized = email.strip().lower()

    try:
        await enforce_login_rate_limit(db, normalized, ip)
    except RateLimitedError as exc:
        await audit_service.record(
            db,
            AuditAction.LOGIN_RATE_LIMITED,
            actor_email=normalized,
            ip_address=ip,
            user_agent=ua,
        )
        response: Response = RedirectResponse("/auth/login", status_code=303)
        set_flash(response, exc.message, "error")
        return response

    try:
        user = await auth_service.authenticate(db, normalized, password)
    except AuthenticationError as exc:
        await record_login_attempt(db, normalized, ip, successful=False)
        await audit_service.record(
            db,
            AuditAction.USER_LOGIN_FAILED,
            actor_email=normalized,
            ip_address=ip,
            user_agent=ua,
        )
        response = RedirectResponse("/auth/login", status_code=303)
        set_flash(response, exc.message, "error")
        return response

    await record_login_attempt(db, normalized, ip, successful=True)
    session = await auth_service.start_session(db, user, ip_address=ip, user_agent=ua)
    await audit_service.record(
        db,
        AuditAction.USER_LOGGED_IN,
        organization_id=session.active_organization_id,
        actor_user_id=user.id,
        actor_email=user.email,
        ip_address=ip,
        user_agent=ua,
    )
    response = RedirectResponse("/app/dashboard", status_code=303)
    _set_session_cookie(response, session)
    return response


@router.post("/logout", include_in_schema=False, dependencies=[CsrfProtected])
async def logout(request: Request, db: DbSession, auth: OptionalAuth) -> Response:
    if auth is not None:
        await auth_service.revoke_session(db, auth.session)
        await audit_service.record(
            db,
            AuditAction.USER_LOGGED_OUT,
            organization_id=auth.organization.id if auth.organization else None,
            actor_user_id=auth.user.id,
            actor_email=auth.user.email,
            ip_address=client_ip(request),
            user_agent=user_agent(request),
        )
    response: Response = RedirectResponse("/", status_code=303)
    _clear_session_cookie(response)
    set_flash(response, "You have been signed out.", "info")
    return response


# --------------------------------------------------------------------------
# Email verification
# --------------------------------------------------------------------------
@router.get("/verify-email", include_in_schema=False)
async def verify_email(
    request: Request, db: DbSession, auth: OptionalAuth, token: str = ""
) -> Response:
    await auth_service.verify_email(db, token)
    destination = "/app/dashboard" if auth else "/auth/login"
    response: Response = RedirectResponse(destination, status_code=303)
    set_flash(response, "Your email address has been verified.", "success")
    return response


# --------------------------------------------------------------------------
# Password reset
# --------------------------------------------------------------------------
@router.get("/forgot-password", include_in_schema=False)
async def forgot_password_form(request: Request, auth: OptionalAuth) -> Response:
    return render(request, "auth/forgot_password.html", auth=None)


@router.post(
    "/forgot-password", include_in_schema=False, dependencies=[CsrfProtected]
)
async def forgot_password_submit(
    request: Request, db: DbSession, email: Annotated[str, Form()]
) -> Response:
    await auth_service.request_password_reset(
        db, email, ip_address=client_ip(request), user_agent=user_agent(request)
    )
    response: Response = RedirectResponse("/auth/login", status_code=303)
    # Deliberately identical regardless of whether the email exists.
    set_flash(
        response,
        "If an account exists for that address, a reset link is on its way.",
        "info",
    )
    return response


@router.get("/reset-password", include_in_schema=False)
async def reset_password_form(
    request: Request, auth: OptionalAuth, token: str = ""
) -> Response:
    if not token:
        raise ValidationError("This reset link is missing its token.")
    return render(request, "auth/reset_password.html", {"token": token}, auth=None)


@router.post(
    "/reset-password", include_in_schema=False, dependencies=[CsrfProtected]
)
async def reset_password_submit(
    request: Request,
    db: DbSession,
    token: Annotated[str, Form()],
    password: Annotated[str, Form()],
    password_confirm: Annotated[str, Form()],
) -> Response:
    if password != password_confirm:
        raise ValidationError("The two passwords do not match.")
    await auth_service.reset_password(
        db,
        token,
        password,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    response: Response = RedirectResponse("/auth/login", status_code=303)
    set_flash(
        response, "Your password has been reset. Please sign in.", "success"
    )
    return response


# --------------------------------------------------------------------------
# Invitations
# --------------------------------------------------------------------------
@router.get("/accept-invite", include_in_schema=False)
async def accept_invite_form(
    request: Request, db: DbSession, auth: OptionalAuth, token: str = ""
) -> Response:
    invitation = await invitation_service.get_valid_invitation(db, token)
    org = await organization_service.get_organization(
        db, invitation.organization_id
    )
    existing = await auth_service.get_user_by_email(db, invitation.email)
    return render(
        request,
        "auth/accept_invite.html",
        {
            "token": token,
            "invitation": invitation,
            "organization": org,
            "needs_account": existing is None and auth is None,
            "email_matches": auth is not None
            and auth.user.email == invitation.email,
        },
        auth=auth,
    )


@router.post(
    "/accept-invite", include_in_schema=False, dependencies=[CsrfProtected]
)
async def accept_invite_submit(
    request: Request,
    db: DbSession,
    auth: OptionalAuth,
    token: Annotated[str, Form()],
    full_name: Annotated[str | None, Form()] = None,
    password: Annotated[str | None, Form()] = None,
    marketing_consent: Annotated[bool, Form()] = False,
) -> Response:
    invitation = await invitation_service.get_valid_invitation(db, token)
    ip, ua = client_ip(request), user_agent(request)

    # Case 1: already signed in — accept directly.
    if auth is not None:
        await invitation_service.accept_invitation(
            db, invitation=invitation, user=auth.user, ip_address=ip, user_agent=ua
        )
        auth.session.active_organization_id = invitation.organization_id
        response: Response = RedirectResponse("/app/dashboard", status_code=303)
        set_flash(response, "Invitation accepted.", "success")
        return response

    # Case 2: an account already exists — ask them to sign in first.
    if await auth_service.get_user_by_email(db, invitation.email) is not None:
        response = RedirectResponse("/auth/login", status_code=303)
        set_flash(
            response,
            "You already have an account — sign in, then open the invite link "
            "again to accept.",
            "info",
        )
        return response

    # Case 3: brand-new user — create the account and join in one step.
    if not full_name or not password:
        raise ValidationError("Please provide your name and choose a password.")
    user = await auth_service.create_user_account(
        db,
        full_name=full_name,
        email=invitation.email,
        password=password,
        marketing_consent=marketing_consent,
        email_verified=True,
    )
    await invitation_service.accept_invitation(
        db, invitation=invitation, user=user, ip_address=ip, user_agent=ua
    )
    session = await auth_service.start_session(
        db,
        user,
        ip_address=ip,
        user_agent=ua,
        active_organization_id=invitation.organization_id,
    )
    response = RedirectResponse("/app/dashboard", status_code=303)
    _set_session_cookie(response, session)
    set_flash(response, "Welcome aboard! Your account is ready.", "success")
    return response


# --------------------------------------------------------------------------
# SAML Single Sign-On
# --------------------------------------------------------------------------
@router.get("/sso", include_in_schema=False)
async def sso_form(request: Request, auth: OptionalAuth) -> Response:
    return render(
        request,
        "auth/sso.html",
        {"saml_available": saml_service.is_available()},
        auth=None,
    )


@router.post("/sso", include_in_schema=False, dependencies=[CsrfProtected])
async def sso_lookup(
    request: Request, db: DbSession, organization_slug: Annotated[str, Form()]
) -> Response:
    from sqlalchemy import select

    from app.models import Organization

    org = await db.scalar(
        select(Organization).where(
            Organization.slug == organization_slug.strip().lower()
        )
    )
    if org is None or org.deleted_at is not None or not org.sso_enabled:
        response: Response = RedirectResponse("/auth/sso", status_code=303)
        set_flash(
            response,
            "No organization with single sign-on was found for that workspace ID.",
            "error",
        )
        return response
    return RedirectResponse(f"/auth/saml/{org.id}/login", status_code=303)


@router.get("/saml/metadata", include_in_schema=False)
async def saml_metadata() -> Response:
    return Response(saml_service.sp_metadata(), media_type="application/xml")


@router.get("/saml/{org_id}/login", include_in_schema=False)
async def saml_login(request: Request, db: DbSession, org_id: uuid.UUID) -> Response:
    org = await organization_service.get_organization(db, org_id)
    if not org.sso_enabled:
        raise NotFoundError("Single sign-on is not enabled for this organization.")
    redirect_url = await saml_service.begin_login(
        org, request, return_to=f"{settings.base_url}/app/dashboard"
    )
    return RedirectResponse(redirect_url, status_code=303)


@router.post("/saml/{org_id}/acs", include_in_schema=False)
async def saml_acs(request: Request, db: DbSession, org_id: uuid.UUID) -> Response:
    """SAML Assertion Consumer Service.

    Exempt from CSRF: the request originates from the IdP, not a same-site
    form, and is authenticated by the signed SAML assertion itself.
    """
    org = await organization_service.get_organization(db, org_id)
    if not org.sso_enabled:
        raise NotFoundError("Single sign-on is not enabled for this organization.")

    email, display_name = await saml_service.process_acs(org, request)
    ip, ua = client_ip(request), user_agent(request)

    user = await auth_service.get_or_create_sso_user(
        db, email=email, display_name=display_name
    )
    await organization_service.ensure_membership(
        db, user=user, org=org, default_role=org.saml_default_role
    )
    session = await auth_service.start_session(
        db, user, ip_address=ip, user_agent=ua, active_organization_id=org.id
    )
    await audit_service.record(
        db,
        AuditAction.USER_LOGGED_IN_SSO,
        organization_id=org.id,
        actor_user_id=user.id,
        actor_email=user.email,
        ip_address=ip,
        user_agent=ua,
    )
    await metrics_service.record_usage(db, org.id, "login")
    response: Response = RedirectResponse("/app/dashboard", status_code=303)
    _set_session_cookie(response, session)
    return response
