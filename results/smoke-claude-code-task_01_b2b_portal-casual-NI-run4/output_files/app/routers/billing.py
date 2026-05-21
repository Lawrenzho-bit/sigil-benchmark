"""Billing routes: plan selection, checkout, plan changes, and cancellation.

Only an owner reaches the mutating routes — they require BILLING_MANAGE, which
the RBAC matrix grants to the owner role alone. Admins and viewers may still
*view* billing state.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Form
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from starlette.requests import Request

from app.config import settings
from app.context import AuthContext
from app.dependencies import CsrfProtected, DbSession, client_ip, require, user_agent
from app.enums import Plan
from app.exceptions import ValidationError
from app.flash import set_flash
from app.models import Subscription
from app.rbac import Permission
from app.services import billing_service
from app.templating import render

router = APIRouter(prefix="/app/billing", tags=["billing"])


def _parse_plan(value: str) -> Plan:
    try:
        return Plan(value.strip().lower())
    except ValueError as exc:
        raise ValidationError("Unknown plan.") from exc


def _back(message: str, level: str = "success") -> Response:
    response: Response = RedirectResponse("/app/billing", status_code=303)
    set_flash(response, message, level)  # type: ignore[arg-type]
    return response


@router.get("", include_in_schema=False)
async def billing_page(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.BILLING_VIEW))],
    checkout: str | None = None,
) -> Response:
    assert auth.organization is not None
    subscription = await db.scalar(
        select(Subscription).where(
            Subscription.organization_id == auth.organization.id
        )
    )
    return render(
        request,
        "billing.html",
        {
            "subscription": subscription,
            "plans": list(Plan),
            "can_manage": auth.can(Permission.BILLING_MANAGE),
            # The Stripe webhook is the source of truth for activation; this
            # flag only drives a friendly post-checkout banner.
            "checkout_status": checkout,
        },
        auth=auth,
    )


@router.post("/checkout", include_in_schema=False, dependencies=[CsrfProtected])
async def start_checkout(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.BILLING_MANAGE))],
    plan: Annotated[str, Form()],
) -> Response:
    assert auth.organization is not None
    checkout_url = await billing_service.create_checkout_session(
        db,
        org=auth.organization,
        actor=auth.user,
        plan=_parse_plan(plan),
        success_url=f"{settings.base_url}/app/billing?checkout=success",
        cancel_url=f"{settings.base_url}/app/billing?checkout=cancel",
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return RedirectResponse(checkout_url, status_code=303)


@router.post("/change-plan", include_in_schema=False, dependencies=[CsrfProtected])
async def change_plan(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.BILLING_MANAGE))],
    plan: Annotated[str, Form()],
) -> Response:
    assert auth.organization is not None
    new_plan = _parse_plan(plan)
    await billing_service.change_plan(
        db,
        org=auth.organization,
        actor=auth.user,
        new_plan=new_plan,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _back(f"Your plan has been changed to {new_plan.label}.")


@router.post("/cancel", include_in_schema=False, dependencies=[CsrfProtected])
async def cancel_subscription(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.BILLING_MANAGE))],
) -> Response:
    assert auth.organization is not None
    await billing_service.cancel_subscription(
        db,
        org=auth.organization,
        actor=auth.user,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    return _back(
        "Your subscription will end at the close of the current billing period.",
        "info",
    )


@router.post("/portal", include_in_schema=False, dependencies=[CsrfProtected])
async def open_portal(
    request: Request,
    db: DbSession,
    auth: Annotated[AuthContext, Depends(require(Permission.BILLING_MANAGE))],
) -> Response:
    assert auth.organization is not None
    portal_url = await billing_service.create_portal_session(
        db,
        org=auth.organization,
        actor=auth.user,
        return_url=f"{settings.base_url}/app/billing",
    )
    return RedirectResponse(portal_url, status_code=303)
