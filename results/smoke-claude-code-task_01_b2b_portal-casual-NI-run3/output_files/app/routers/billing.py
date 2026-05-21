"""Billing: plan selection, Stripe Checkout, and the Customer Portal.

Billing actions are owner-only (admins manage people/settings, not money).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Form, Request
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse, Response

from app.config import settings
from app.database import get_db
from app.dependencies import AuthContext, redirect, require_owner, verify_csrf
from app.models.enums import PLAN_LABELS, PLAN_PRICE_USD, PLAN_SEATS, Plan
from app.schemas import PlanSelection
from app.services import stripe_service
from app.services.audit import Action, record
from app.templating import flash, render

logger = logging.getLogger("acme.billing")
router = APIRouter(prefix="/billing", tags=["billing"])


def _plan_catalog() -> list[dict]:
    return [
        {
            "code": p.value,
            "label": PLAN_LABELS[p],
            "price": PLAN_PRICE_USD[p],
            "seats": PLAN_SEATS[p],
        }
        for p in Plan
    ]


@router.get("")
def billing_home(
    request: Request,
    ctx: AuthContext = Depends(require_owner),
    db: Session = Depends(get_db),
) -> Response:
    return render(
        request,
        "billing.html",
        {
            "plans": _plan_catalog(),
            "subscription": ctx.organization.subscription,
            "current_plan": ctx.organization.plan,
            "billing_configured": stripe_service.is_configured(),
        },
    )


@router.post("/checkout", dependencies=[Depends(verify_csrf)])
def start_checkout(
    request: Request,
    ctx: AuthContext = Depends(require_owner),
    db: Session = Depends(get_db),
    plan: str = Form(...),
) -> Response:
    """Begin a Stripe Checkout for an org without a live subscription."""
    try:
        selection = PlanSelection(plan=plan)
    except ValidationError:
        flash(request, "Unknown plan.", "error")
        return redirect("/billing")

    org = ctx.organization
    sub = org.subscription
    if sub is not None and sub.is_live and sub.stripe_subscription_id:
        # Already subscribed -> this is a plan change, not a new checkout.
        return _do_change_plan(request, ctx, db, selection.plan)

    try:
        customer_id = stripe_service.ensure_customer(org.name, org.id, org.stripe_customer_id)
        org.stripe_customer_id = customer_id
        db.commit()
        url = stripe_service.create_checkout_session(
            customer_id=customer_id,
            plan=selection.plan,
            organization_id=org.id,
            success_url=f"{settings.base_url}/billing/success",
            cancel_url=f"{settings.base_url}/billing/cancel",
        )
    except stripe_service.BillingNotConfigured as exc:
        flash(request, str(exc), "error")
        return redirect("/billing")
    except Exception:  # noqa: BLE001
        logger.exception("Stripe checkout failed for org=%s", org.id)
        flash(request, "We couldn't start checkout. Please try again.", "error")
        return redirect("/billing")

    record(
        db,
        action=Action.BILLING_CHECKOUT,
        request=request,
        organization_id=org.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        details={"plan": selection.plan.value},
    )
    return RedirectResponse(url, status_code=303)


@router.post("/change-plan", dependencies=[Depends(verify_csrf)])
def change_plan(
    request: Request,
    ctx: AuthContext = Depends(require_owner),
    db: Session = Depends(get_db),
    plan: str = Form(...),
) -> Response:
    try:
        selection = PlanSelection(plan=plan)
    except ValidationError:
        flash(request, "Unknown plan.", "error")
        return redirect("/billing")
    return _do_change_plan(request, ctx, db, selection.plan)


def _do_change_plan(request: Request, ctx: AuthContext, db: Session, new_plan: Plan) -> Response:
    org = ctx.organization
    sub = org.subscription
    if sub is None or not sub.stripe_subscription_id:
        flash(request, "Start a subscription first.", "error")
        return redirect("/billing")
    if sub.plan is new_plan:
        flash(request, f"You're already on the {PLAN_LABELS[new_plan]} plan.", "info")
        return redirect("/billing")

    # Block a downgrade that would leave more members than the target plan allows.
    from app.services import metrics  # local import avoids a cycle at module load

    member_count = PLAN_SEATS[org.plan] - metrics.seats_available(db, org)
    if PLAN_SEATS[new_plan] < member_count:
        flash(
            request,
            f"You have {member_count} seats in use — remove members before "
            f"downgrading to {PLAN_LABELS[new_plan]}.",
            "error",
        )
        return redirect("/billing")

    try:
        stripe_service.change_plan(sub.stripe_subscription_id, new_plan)
    except stripe_service.BillingNotConfigured as exc:
        flash(request, str(exc), "error")
        return redirect("/billing")
    except Exception:  # noqa: BLE001
        logger.exception("Stripe plan change failed for org=%s", org.id)
        flash(request, "We couldn't change your plan. Please try again.", "error")
        return redirect("/billing")

    old_plan = sub.plan
    record(
        db,
        action=Action.PLAN_CHANGED,
        request=request,
        organization_id=org.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
        details={"from": old_plan.value, "to": new_plan.value},
    )
    # The webhook will confirm and sync; show optimistic feedback now.
    flash(
        request,
        f"Plan change to {PLAN_LABELS[new_plan]} requested — it will update shortly.",
        "success",
    )
    return redirect("/billing")


@router.post("/portal", dependencies=[Depends(verify_csrf)])
def open_portal(
    request: Request,
    ctx: AuthContext = Depends(require_owner),
    db: Session = Depends(get_db),
) -> Response:
    org = ctx.organization
    if not org.stripe_customer_id:
        flash(request, "No billing account yet — choose a plan first.", "error")
        return redirect("/billing")
    try:
        url = stripe_service.create_portal_session(
            org.stripe_customer_id, f"{settings.base_url}/billing"
        )
    except stripe_service.BillingNotConfigured as exc:
        flash(request, str(exc), "error")
        return redirect("/billing")
    except Exception:  # noqa: BLE001
        logger.exception("Stripe portal failed for org=%s", org.id)
        flash(request, "We couldn't open the billing portal.", "error")
        return redirect("/billing")

    record(
        db,
        action=Action.BILLING_PORTAL,
        request=request,
        organization_id=org.id,
        actor_user_id=ctx.user.id,
        actor_email=ctx.user.email,
    )
    return RedirectResponse(url, status_code=303)


@router.get("/success")
def checkout_success(request: Request, ctx: AuthContext = Depends(require_owner)) -> Response:
    flash(
        request,
        "Payment received. Your subscription will activate within a few seconds.",
        "success",
    )
    return redirect("/billing")


@router.get("/cancel")
def checkout_cancel(request: Request, ctx: AuthContext = Depends(require_owner)) -> Response:
    flash(request, "Checkout canceled — no charge was made.", "info")
    return redirect("/billing")
