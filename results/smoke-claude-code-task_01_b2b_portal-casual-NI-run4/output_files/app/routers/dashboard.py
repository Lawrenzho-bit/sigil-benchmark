"""Dashboard and organization-context routes."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from starlette.requests import Request

from app.dependencies import (
    Auth,
    CsrfProtected,
    DbSession,
    client_ip,
    user_agent,
)
from app.enums import MembershipStatus
from app.exceptions import NotFoundError
from app.flash import set_flash
from app.models import Membership, Subscription
from app.rbac import Permission, require_permission
from app.services import metrics_service, organization_service
from app.templating import render

router = APIRouter(prefix="/app", tags=["dashboard"])


@router.get("/dashboard", include_in_schema=False)
async def dashboard(request: Request, db: DbSession, auth: Auth) -> Response:
    """Render the metrics dashboard for the active organization."""
    if auth.organization is None or auth.role is None:
        # The user belongs to no organization (e.g. their only org was closed).
        return render(request, "no_organization.html", auth=auth)

    require_permission(auth.role, Permission.DASHBOARD_VIEW)

    subscription = await db.scalar(
        select(Subscription).where(
            Subscription.organization_id == auth.organization.id
        )
    )
    metrics = await metrics_service.compute_dashboard(
        db, auth.organization.id, subscription
    )

    # All organizations the user can switch between.
    memberships = await db.scalars(
        select(Membership).where(
            Membership.user_id == auth.user.id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    other_orgs = [
        m
        for m in memberships
        if m.organization is not None and m.organization.deleted_at is None
    ]

    return render(
        request,
        "dashboard.html",
        {
            "metrics": metrics,
            "subscription": subscription,
            "memberships": other_orgs,
        },
        auth=auth,
    )


@router.post("/organizations", include_in_schema=False, dependencies=[CsrfProtected])
async def create_organization(
    request: Request,
    db: DbSession,
    auth: Auth,
    organization_name: Annotated[str, Form()],
) -> Response:
    """Create an additional organization; the creator becomes its owner."""
    org = await organization_service.create_organization(
        db,
        owner=auth.user,
        name=organization_name,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    auth.session.active_organization_id = org.id
    response: Response = RedirectResponse("/app/dashboard", status_code=303)
    set_flash(response, f"Organization '{org.name}' created.", "success")
    return response


@router.post(
    "/switch-organization", include_in_schema=False, dependencies=[CsrfProtected]
)
async def switch_organization(
    request: Request,
    db: DbSession,
    auth: Auth,
    organization_id: Annotated[uuid.UUID, Form()],
) -> Response:
    """Change which organization the current session is acting within."""
    membership = await db.scalar(
        select(Membership).where(
            Membership.user_id == auth.user.id,
            Membership.organization_id == organization_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    if membership is None:
        raise NotFoundError("You are not a member of that organization.")
    auth.session.active_organization_id = organization_id
    response: Response = RedirectResponse("/app/dashboard", status_code=303)
    set_flash(response, "Switched organization.", "info")
    return response
