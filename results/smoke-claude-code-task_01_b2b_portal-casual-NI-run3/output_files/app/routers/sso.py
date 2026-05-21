"""SAML 2.0 single sign-on (SP-initiated).

Flow:
  1. GET /sso/login?org=<slug>  -> redirect the browser to the org's IdP.
  2. IdP authenticates the user and POSTs an assertion to /sso/acs.
  3. /sso/acs verifies the signed assertion, then provisions/loads the user
     (just-in-time) and issues a session.

JIT provisioning: a verified SSO identity whose email matches the org's
configured domain is auto-created as a `viewer`. Privilege beyond that is granted
explicitly by an admin afterwards.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse, Response

from app.cookies import set_session_cookie
from app.database import get_db
from app.dependencies import redirect
from app.models.enums import Role
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.user import User
from app.services import auth as auth_service
from app.services import saml as saml_service
from app.services.audit import Action, record
from app.templating import flash, render

logger = logging.getLogger("acme.sso")
router = APIRouter(prefix="/sso", tags=["sso"])


def _client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("/login")
def sso_login(request: Request, org: str = "", db: Session = Depends(get_db)) -> Response:
    """Begin SP-initiated SSO for the organization identified by slug."""
    organization = db.scalar(select(Organization).where(Organization.slug == org))
    if organization is None or not organization.saml_enabled:
        flash(request, "Single sign-on is not enabled for that organization.", "error")
        return redirect("/auth/login")

    try:
        # RelayState carries the org id so the ACS endpoint knows which IdP
        # configuration to validate the returned assertion against.
        url = saml_service.build_login_redirect(organization, request, organization.id)
    except saml_service.SamlError as exc:
        flash(request, str(exc), "error")
        return redirect("/auth/login")
    return RedirectResponse(url, status_code=303)


@router.post("/acs")
async def sso_acs(request: Request, db: Session = Depends(get_db)) -> Response:
    """Assertion Consumer Service.

    CSRF-exempt by design: the request is authenticated by the IdP's XML
    signature on the SAML assertion, verified inside `process_response`.
    """
    form = dict(await request.form())
    org_id = form.get("RelayState", "")
    organization = db.get(Organization, org_id) if org_id else None
    if organization is None or not organization.saml_enabled:
        flash(request, "Single sign-on response could not be matched to an organization.", "error")
        return redirect("/auth/login")

    try:
        email = saml_service.process_response(organization, request, form)
    except saml_service.SamlError as exc:
        record(
            db,
            action=Action.LOGIN_FAILED,
            request=request,
            organization_id=organization.id,
            actor_email=form.get("RelayState", ""),
            details={"method": "saml", "reason": str(exc)},
        )
        flash(request, str(exc), "error")
        return redirect("/auth/login")

    # Resolve or just-in-time provision the user.
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, full_name=email.split("@")[0], is_active=True)
        db.add(user)
        db.flush()

    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == organization.id,
        )
    )
    if membership is None:
        membership = Membership(user_id=user.id, organization_id=organization.id, role=Role.VIEWER)
        db.add(membership)

    from app.models.base import utcnow

    user.last_login_at = utcnow()
    db.commit()

    record(
        db,
        action=Action.SSO_LOGIN,
        request=request,
        organization_id=organization.id,
        actor_user_id=user.id,
        actor_email=user.email,
    )
    token = auth_service.create_session(
        db,
        user=user,
        organization_id=organization.id,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    response = redirect("/dashboard")
    set_session_cookie(response, token)
    return response


@router.get("/metadata")
def sso_metadata(request: Request) -> Response:
    """Human-readable SP metadata hint (the values an IdP admin needs)."""
    return render(request, "sso_metadata.html")
